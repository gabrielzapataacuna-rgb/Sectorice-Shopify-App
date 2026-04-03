import axios from 'axios';

function createSectoriceHttpClient({ sectoriceApiUrl, apiKey }) {
  return axios.create({
    baseURL: sectoriceApiUrl.replace(/\/$/, ''),
    timeout: 20000,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
  });
}

function createSectoriceInternalHttpClient({ sectoriceApiUrl, adapterToken }) {
  return axios.create({
    baseURL: sectoriceApiUrl.replace(/\/$/, ''),
    timeout: 20000,
    headers: {
      'Content-Type': 'application/json',
      'X-Adapter-Token': adapterToken,
    },
  });
}

export async function createOrderInSectorice({ sectoriceApiUrl, apiKey, payload }) {
  const client = createSectoriceHttpClient({ sectoriceApiUrl, apiKey });
  const response = await client.post('/v1/ecommerce/orders', payload);
  return response.data;
}

export async function importOrdersToSectorice({ sectoriceApiUrl, apiKey, payload }) {
  const client = createSectoriceHttpClient({ sectoriceApiUrl, apiKey });
  const response = await client.post('/v1/ecommerce/orders/import', payload);
  return response.data;
}

export async function registerShopifyInstallation({
  sectoriceApiUrl,
  adapterToken,
  integrationId,
  shopDomain,
  accessToken,
  scope,
}) {
  const client = createSectoriceInternalHttpClient({ sectoriceApiUrl, adapterToken });
  const response = await client.post('/v1/internal/shopify/installations', {
    integrationId,
    shopDomain,
    accessToken,
    scope,
  });
  return response.data;
}

export async function resolveShopifyRuntimeConfig({
  sectoriceApiUrl,
  adapterToken,
  shopDomain,
}) {
  const client = createSectoriceInternalHttpClient({ sectoriceApiUrl, adapterToken });
  const encodedShop = encodeURIComponent(shopDomain);
  const response = await client.get(`/v1/internal/shopify/installations/by-shop/${encodedShop}/runtime`);
  return response.data;
}

export async function unregisterShopifyInstallation({
  sectoriceApiUrl,
  adapterToken,
  shopDomain,
}) {
  const client = createSectoriceInternalHttpClient({ sectoriceApiUrl, adapterToken });
  const response = await client.delete('/v1/internal/shopify/installations', {
    data: { shopDomain },
  });
  return response.data;
}
