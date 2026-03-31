import express from 'express';
import crypto from 'crypto';
import { mapShopifyOrderToSectoriceImportItem } from '../services/shopifyMapper.js';
import { importOrdersToSectorice } from '../services/sectoriceClient.js';

function verifyShopifyWebhookHmac(rawBody, providedHmac, secret) {
  if (!providedHmac || !secret) {
    return false;
  }

  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  return (
    digest.length === String(providedHmac).length &&
    crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(String(providedHmac)))
  );
}

function parseWebhookBody(req) {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
  const parsed = JSON.parse(rawBody.toString('utf8'));
  return { rawBody, parsed };
}

async function forwardOrderToSectorice(order, appConfig) {
  const mappedOrder = mapShopifyOrderToSectoriceImportItem(order);
  return importOrdersToSectorice({
    sectoriceApiUrl: appConfig.sectoriceApiUrl,
    apiKey: appConfig.sectoriceApiKey,
    payload: {
      uploadName: `Shopify webhook ${order.name || order.id}`,
      confirmOperational: true,
      orders: [mappedOrder],
    },
  });
}

export function createWebhooksRouter({ appConfig }) {
  const router = express.Router();

  async function handleOrderWebhook(req, res, next) {
    try {
      const { rawBody, parsed } = parseWebhookBody(req);
      const hmac = req.get('X-Shopify-Hmac-Sha256');

      if (!verifyShopifyWebhookHmac(rawBody, hmac, appConfig.shopifyApiSecret)) {
        return res.status(401).json({
          success: false,
          message: 'Invalid Shopify webhook signature',
        });
      }

      const shop = req.get('X-Shopify-Shop-Domain');
      const topic = req.get('X-Shopify-Topic');
      const webhookId = req.get('X-Shopify-Webhook-Id');

      const sectoriceResponse = await forwardOrderToSectorice(parsed, appConfig);

      return res.status(200).json({
        success: true,
        topic,
        shop,
        webhookId,
        sectorice: sectoriceResponse,
      });
    } catch (error) {
      return next(error);
    }
  }

  router.post('/orders/create', handleOrderWebhook);
  router.post('/orders/paid', handleOrderWebhook);

  router.post('/orders/cancelled', (req, res) => {
    try {
      const { rawBody, parsed } = parseWebhookBody(req);
      const hmac = req.get('X-Shopify-Hmac-Sha256');

      if (!verifyShopifyWebhookHmac(rawBody, hmac, appConfig.shopifyApiSecret)) {
        return res.status(401).json({
          success: false,
          message: 'Invalid Shopify webhook signature',
        });
      }

      console.log('[shopify-webhook] Cancelled order received', {
        shop: req.get('X-Shopify-Shop-Domain'),
        webhookId: req.get('X-Shopify-Webhook-Id'),
        orderId: parsed?.id,
        orderName: parsed?.name,
      });

      return res.status(202).json({
        success: true,
        message: 'Webhook recibido. Sectorice no tiene aún endpoint de cancelación ecommerce.',
      });
    } catch (error) {
      console.error('[shopify-webhook] Cancelled webhook error', error);
      return res.status(500).json({
        success: false,
        message: 'No se pudo procesar el webhook cancelled',
      });
    }
  });

  return router;
}
