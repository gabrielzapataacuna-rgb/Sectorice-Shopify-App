import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import { registerWebhooks } from '../services/webhookRegistrar.js';
import {
  registerShopifyInstallation,
  unregisterShopifyInstallation,
} from '../services/sectoriceClient.js';

const SHOP_REGEX = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

function normalizeShop(shop) {
  if (!shop || typeof shop !== 'string') {
    return null;
  }
  const normalized = shop.trim().toLowerCase();
  return SHOP_REGEX.test(normalized) ? normalized : null;
}

function buildCallbackUrl(shopifyAppUrl) {
  return `${shopifyAppUrl}/shopify/auth/callback`;
}

function buildState() {
  return crypto.randomBytes(24).toString('hex');
}

function parseIntegrationId(rawValue) {
  const parsed = Number.parseInt(String(rawValue ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function buildOAuthHmac(secret, query) {
  const serialized = Object.keys(query)
    .filter((key) => key !== 'hmac' && key !== 'signature')
    .sort()
    .map((key) => `${key}=${Array.isArray(query[key]) ? query[key].join(',') : query[key]}`)
    .join('&');

  return crypto
    .createHmac('sha256', secret)
    .update(serialized)
    .digest('hex');
}

function verifyWebhookHmac(rawBody, providedHmac, secret) {
  if (!providedHmac || !secret) {
    return false;
  }

  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  return (
    digest.length === String(providedHmac).length &&
    crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(String(providedHmac)))
  );
}

export function createAuthRouter({ appConfig, oauthStateStore }) {
  const router = express.Router();

  router.get('/auth', (req, res) => {
    const shop = normalizeShop(req.query.shop);
    const integrationId = parseIntegrationId(req.query.integrationId);
    if (!shop) {
      return res.status(400).json({
        success: false,
        message: 'Parámetro shop inválido. Debe ser algo como tienda.myshopify.com',
      });
    }
    if (!integrationId) {
      return res.status(400).json({
        success: false,
        message: 'integrationId es obligatorio para asociar la tienda Shopify a una integración Sectorice.',
      });
    }

    const state = buildState();
    oauthStateStore.set(state, {
      shop,
      integrationId,
      createdAt: Date.now(),
    });

    const authorizationUrl = new URL(`https://${shop}/admin/oauth/authorize`);
    authorizationUrl.searchParams.set('client_id', appConfig.shopifyApiKey);
    authorizationUrl.searchParams.set('scope', appConfig.scopes.join(','));
    authorizationUrl.searchParams.set('redirect_uri', buildCallbackUrl(appConfig.shopifyAppUrl));
    authorizationUrl.searchParams.set('state', state);

    return res.redirect(authorizationUrl.toString());
  });

  router.get('/auth/callback', async (req, res) => {
    const { code, hmac, shop, state } = req.query;
    const normalizedShop = normalizeShop(shop);

    if (!normalizedShop || !code || !hmac || !state) {
      return res.status(400).send('Faltan parámetros OAuth obligatorios.');
    }

    const pendingState = oauthStateStore.get(state);
    if (!pendingState || pendingState.shop !== normalizedShop) {
      return res.status(400).send('State OAuth inválido o expirado.');
    }

    const expectedHmac = buildOAuthHmac(appConfig.shopifyApiSecret, req.query);
    const receivedHmac = String(hmac);
    const validHmac =
      expectedHmac.length === receivedHmac.length &&
      crypto.timingSafeEqual(Buffer.from(expectedHmac), Buffer.from(receivedHmac));

    if (!validHmac) {
      return res.status(401).send('HMAC OAuth inválido.');
    }

    try {
      const tokenResponse = await axios.post(
        `https://${normalizedShop}/admin/oauth/access_token`,
        {
          client_id: appConfig.shopifyApiKey,
          client_secret: appConfig.shopifyApiSecret,
          code: String(code),
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );

      const accessToken = tokenResponse.data.access_token;
      const scope = tokenResponse.data.scope || '';

      await registerShopifyInstallation({
        sectoriceApiUrl: appConfig.sectoriceApiUrl,
        adapterToken: appConfig.shopifyAdapterToken,
        integrationId: pendingState.integrationId,
        shopDomain: normalizedShop,
        accessToken,
        scope,
      });
      const webhookResults = await registerWebhooks(normalizedShop, accessToken, appConfig.shopifyAppUrl);
      oauthStateStore.delete(state);

      const webhookRows = webhookResults.map((result) => `
        <li>
          <strong>${result.topic}</strong>: ${result.status}
          ${result.id ? `(id ${result.id})` : ''}
          ${result.error ? ` - ${result.error}` : ''}
        </li>
      `).join('');

      return res.status(200).send(`
        <html>
          <body style="font-family: sans-serif; padding: 24px;">
            <h2>Shopify conectado con Sectorice</h2>
            <p>Tienda: <strong>${normalizedShop}</strong></p>
            <p>La instalación OAuth quedó asociada a la integración Sectorice <strong>${pendingState.integrationId}</strong>.</p>
            <p>Webhooks registrados:</p>
            <ul>${webhookRows}</ul>
          </body>
        </html>
      `);
    } catch (error) {
      console.error('[shopify-auth] Error exchanging token', error?.response?.data || error.message);
      return res.status(500).send('No se pudo completar OAuth con Shopify.');
    }
  });

  router.post('/webhooks/app/uninstalled', express.raw({ type: 'application/json' }), async (req, res) => {
    const hmac = req.get('X-Shopify-Hmac-Sha256');
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');

    if (!verifyWebhookHmac(rawBody, hmac, appConfig.shopifyApiSecret)) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Shopify webhook signature',
      });
    }

    const shop = normalizeShop(req.get('X-Shopify-Shop-Domain'));
    if (shop) {
      try {
        await unregisterShopifyInstallation({
          sectoriceApiUrl: appConfig.sectoriceApiUrl,
          adapterToken: appConfig.shopifyAdapterToken,
          shopDomain: shop,
        });
        console.log(`[shopify-auth] App uninstalled for ${shop}`);
      } catch (error) {
        console.error('[shopify-auth] Error unregistering Shopify installation', {
          shop,
          message: error?.response?.data || error?.message,
        });
        return res.status(500).json({
          success: false,
          shop,
          message: 'No se pudo desvincular la tienda en Sectorice.',
        });
      }
    }

    return res.status(202).json({
      success: true,
      shop,
      message: 'Shopify app desinstalada y tienda desvinculada de Sectorice.',
    });
  });

  return router;
}
