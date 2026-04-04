import express from 'express';
import crypto from 'crypto';
import { getTrackedOrder, upsertTrackedOrder } from '../db/database.js';
import { getShopifyCompleteness, mapShopifyOrderToSectoriceImportItem } from '../services/shopifyMapper.js';
import { importOrdersToSectorice, resolveShopifyRuntimeConfig } from '../services/sectoriceClient.js';

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

async function forwardOrderToSectorice(shop, order, appConfig) {
  const runtimeConfig = await resolveShopifyRuntimeConfig({
    sectoriceApiUrl: appConfig.sectoriceApiUrl,
    adapterToken: appConfig.shopifyAdapterToken,
    shopDomain: shop,
  });
  const mappedOrder = mapShopifyOrderToSectoriceImportItem(order);
  const response = await importOrdersToSectorice({
    sectoriceApiUrl: appConfig.sectoriceApiUrl,
    apiKey: runtimeConfig.sectoriceApiKey,
    payload: {
      uploadName: `Shopify webhook ${order.name || order.id}`,
      confirmOperational: true,
      orders: [mappedOrder],
    },
  });
  return {
    integrationCode: runtimeConfig.integrationCode,
    response,
  };
}

function buildPayloadHash(order) {
  return crypto.createHash('sha256').update(JSON.stringify(order || {})).digest('hex');
}

export function createWebhooksRouter({ appConfig }) {
  const router = express.Router();

  function validateWebhookSignature(req, rawBody) {
    const hmac = req.get('X-Shopify-Hmac-Sha256');
    return verifyShopifyWebhookHmac(rawBody, hmac, appConfig.shopifyApiSecret);
  }

  function handlePrivacyWebhook(req, res) {
    try {
      const { rawBody } = parseWebhookBody(req);

      if (!validateWebhookSignature(req, rawBody)) {
        return res.status(401).json({
          success: false,
          message: 'Invalid Shopify webhook signature',
        });
      }

      const topic = req.get('X-Shopify-Topic');
      const shop = req.get('X-Shopify-Shop-Domain');
      const webhookId = req.get('X-Shopify-Webhook-Id');

      console.log('[shopify-webhook] Privacy webhook received', {
        topic,
        shop,
        webhookId,
      });

      return res.status(200).json({
        success: true,
        topic,
        shop,
      });
    } catch (error) {
      console.error('[shopify-webhook] Privacy webhook error', error);
      return res.status(500).json({
        success: false,
        message: 'No se pudo procesar el webhook de privacidad',
      });
    }
  }

  async function handleOrderWebhook(req, res, next) {
    let parsed;
    try {
      const result = parseWebhookBody(req);
      parsed = result.parsed;
      const { rawBody } = result;

      if (!validateWebhookSignature(req, rawBody)) {
        return res.status(401).json({
          success: false,
          message: 'Invalid Shopify webhook signature',
        });
      }

      const shop = req.get('X-Shopify-Shop-Domain');
      const topic = req.get('X-Shopify-Topic');
      const webhookId = req.get('X-Shopify-Webhook-Id');

      const forwardResult = await forwardOrderToSectoriceWithTracking(shop, parsed, appConfig);

      return res.status(200).json({
        success: true,
        topic,
        shop,
        webhookId,
        trackingStatus: forwardResult.status,
        sectorice: forwardResult.sectoriceResponse ?? null,
      });
    } catch (error) {
      if (error.message && error.message.includes('recipientName')) {
        console.log('[shopify-webhook] PAYLOAD shipping_address:', JSON.stringify(parsed?.shipping_address));
        console.log('[shopify-webhook] PAYLOAD customer.first_name:', parsed?.customer?.first_name);
        console.log('[shopify-webhook] PAYLOAD customer.last_name:', parsed?.customer?.last_name);
        console.log('[shopify-webhook] PAYLOAD customer.email:', parsed?.customer?.email);
        console.log('[shopify-webhook] PAYLOAD customer.default_address:', JSON.stringify(parsed?.customer?.default_address));
        console.log('[shopify-webhook] PAYLOAD shipping_address completo:', JSON.stringify(parsed?.shipping_address));
        console.log('[shopify-webhook] PAYLOAD billing_address:', JSON.stringify(parsed?.billing_address));
      }
      return next(error);
    }
  }

  router.post('/orders/create', handleOrderWebhook);
  router.post('/orders/paid', handleOrderWebhook);
  router.post('/customers/data_request', handlePrivacyWebhook);
  router.post('/customers/redact', handlePrivacyWebhook);
  router.post('/shop/redact', handlePrivacyWebhook);

  router.post('/orders/cancelled', (req, res) => {
    try {
      const { rawBody, parsed } = parseWebhookBody(req);

      if (!validateWebhookSignature(req, rawBody)) {
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

async function forwardOrderToSectoriceWithTracking(shop, parsed, appConfig) {
  const orderId = parsed?.id != null ? String(parsed.id) : null;
  if (!orderId) {
    throw new Error('Shopify order.id es obligatorio para Sectorice');
  }

  const payloadHash = buildPayloadHash(parsed);
  const trackedOrder = getTrackedOrder(shop, orderId);
  if (
    trackedOrder &&
    trackedOrder.payload_hash === payloadHash &&
    ['imported', 'pending_barcode_only_candidate'].includes(trackedOrder.import_status)
  ) {
    console.log(`[shopify-webhook] Pedido ${orderId} omitido por idempotencia local (${trackedOrder.import_status})`);
    return {
      status: trackedOrder.import_status,
      sectoriceResponse: null,
    };
  }

  const completeness = getShopifyCompleteness(parsed);
  if (!completeness.complete) {
    const reason = `Faltan: ${completeness.missing.join(', ')}`;
    upsertTrackedOrder(shop, orderId, 'pending_barcode_only_candidate', payloadHash, reason);
    console.log(`[shopify-webhook] Pedido ${orderId} clasificado como barcode_only_candidate`);
    return {
      status: 'pending_barcode_only_candidate',
      sectoriceResponse: null,
    };
  }

  try {
    const { integrationCode, response: sectoriceResponse } = await forwardOrderToSectorice(shop, parsed, appConfig);
    upsertTrackedOrder(shop, orderId, 'imported', payloadHash, null);
    console.log(`[shopify-webhook] Pedido ${orderId} importado OK`, { shop, integrationCode });
    return {
      status: 'imported',
      sectoriceResponse,
    };
  } catch (error) {
    const message = error?.response?.data?.message || error?.message || 'Error desconocido';
    upsertTrackedOrder(shop, orderId, 'error_forward', payloadHash, message);
    console.error(`[shopify-webhook] Error al importar pedido ${orderId}:`, {
      shop,
      message,
      response: error?.response?.data || null,
    });
    throw error;
  }
}
