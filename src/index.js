import express from 'express';
import dotenv from 'dotenv';
import { createAuthRouter } from './routes/auth.js';
import { createWebhooksRouter } from './routes/webhooks.js';

dotenv.config();

const requiredEnv = [
  'SHOPIFY_API_KEY',
  'SHOPIFY_API_SECRET',
  'SHOPIFY_APP_URL',
  'SECTORICE_API_URL',
  'SECTORICE_API_KEY',
];

const missingEnv = requiredEnv.filter((key) => !process.env[key] || !process.env[key].trim());
if (missingEnv.length > 0) {
  console.warn(`[sectorice-shopify-app] Faltan variables: ${missingEnv.join(', ')}`);
}

const appConfig = {
  shopifyApiKey: process.env.SHOPIFY_API_KEY || '',
  shopifyApiSecret: process.env.SHOPIFY_API_SECRET || '',
  shopifyAppUrl: (process.env.SHOPIFY_APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
  sectoriceApiUrl: (process.env.SECTORICE_API_URL || 'https://sectorice.cl').replace(/\/$/, ''),
  sectoriceApiKey: process.env.SECTORICE_API_KEY || '',
  port: Number(process.env.PORT || 3000),
  scopes: ['read_orders'],
};

// Scaffold simple: almacenamiento en memoria.
// Para producción real conviene persistir tiendas/tokens en DB o Redis.
const oauthStateStore = new Map();
const shopInstallStore = new Map();

const app = express();

app.get('/health', (_req, res) => {
  res.json({
    success: true,
    service: 'sectorice-shopify-app',
    status: 'ok',
  });
});

app.use('/webhooks', express.raw({ type: 'application/json' }));
app.use('/shopify', createAuthRouter({ appConfig, oauthStateStore, shopInstallStore }));
app.use('/webhooks', createWebhooksRouter({ appConfig, shopInstallStore }));

app.use(express.json());

app.use((error, _req, res, _next) => {
  console.error('[sectorice-shopify-app] Unhandled error', error);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
  });
});

app.listen(appConfig.port, () => {
  console.log(`[sectorice-shopify-app] Listening on port ${appConfig.port}`);
});
