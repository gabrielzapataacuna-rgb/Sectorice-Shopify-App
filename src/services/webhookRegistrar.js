import axios from 'axios';

const WEBHOOK_TOPICS = [
  'orders/create',
  'orders/paid',
  'orders/cancelled',
  'app/uninstalled',
];

export async function registerWebhooks(shop, accessToken, appUrl) {
  const baseUrl = appUrl.replace(/\/$/, '');
  const results = [];

  for (const topic of WEBHOOK_TOPICS) {
    const address = topic === 'app/uninstalled'
      ? `${baseUrl}/shopify/webhooks/app/uninstalled`
      : `${baseUrl}/webhooks/${topic}`;

    try {
      const response = await axios.post(
        `https://${shop}/admin/api/2026-01/webhooks.json`,
        {
          webhook: {
            topic,
            address,
            format: 'json',
          },
        },
        {
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );
      results.push({ topic, status: 'ok', id: response.data.webhook?.id });
      console.log(`[webhook-registrar] Registered ${topic} -> ${address}`);
    } catch (error) {
      const msg = error.response?.data?.errors || error.message;
      results.push({ topic, status: 'error', error: msg });
      console.error(`[webhook-registrar] Failed ${topic}:`, msg);
    }
  }

  return results;
}
