import express from 'express';
import crypto from 'crypto';
import axios from 'axios';

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

export function createAuthRouter({ appConfig, oauthStateStore, shopInstallStore }) {
  const router = express.Router();

  router.get('/auth', (req, res) => {
    const shop = normalizeShop(req.query.shop);
    if (!shop) {
      return res.status(400).json({
        success: false,
        message: 'Parámetro shop inválido. Debe ser algo como tienda.myshopify.com',
      });
    }

    const state = buildState();
    oauthStateStore.set(state, {
      shop,
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

      shopInstallStore.set(normalizedShop, {
        accessToken: tokenResponse.data.access_token,
        scope: tokenResponse.data.scope,
        installedAt: new Date().toISOString(),
      });
      oauthStateStore.delete(state);

      return res.status(200).send(`
        <html>
          <body style="font-family: sans-serif; padding: 24px;">
            <h2>Shopify conectado con Sectorice</h2>
            <p>Tienda: <strong>${normalizedShop}</strong></p>
            <p>La instalación OAuth quedó registrada en memoria.</p>
            <p>Para producción, persiste access tokens en una base de datos.</p>
          </body>
        </html>
      `);
    } catch (error) {
      console.error('[shopify-auth] Error exchanging token', error?.response?.data || error.message);
      return res.status(500).send('No se pudo completar OAuth con Shopify.');
    }
  });

  return router;
}
