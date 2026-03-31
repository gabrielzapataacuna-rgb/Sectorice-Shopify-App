# Sectorice Shopify App

Adaptador Shopify separado del core de Sectorice. Esta app:

- maneja OAuth de Shopify
- recibe webhooks de pedidos
- transforma el payload Shopify al formato ecommerce de Sectorice
- envía los pedidos a la API existente de Sectorice usando `X-API-Key`

## Stack

- Node.js
- Express
- `@shopify/shopify-api`
- `axios`
- `dotenv`

## Estructura

```text
src/
  index.js
  routes/
    auth.js
    webhooks.js
  services/
    shopifyMapper.js
    sectoriceClient.js
```

## Variables de entorno

Copia `.env.example` a `.env` y completa:

```env
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
SHOPIFY_APP_URL=https://tu-app-publica.com
SECTORICE_API_URL=https://sectorice.cl
SECTORICE_API_KEY=
PORT=3000
```

## Instalación

```bash
npm install
npm run dev
```

## Rutas

### OAuth

- `GET /shopify/auth?shop=tienda.myshopify.com`
- `GET /shopify/auth/callback`

### Webhooks

- `POST /webhooks/orders/create`
- `POST /webhooks/orders/paid`
- `POST /webhooks/orders/cancelled`

## Flujo

1. El merchant instala la app y completa OAuth.
2. Shopify envía webhooks de pedidos a esta app.
3. La app valida `X-Shopify-Hmac-Sha256`.
4. `shopifyMapper` transforma el pedido al formato Sectorice.
5. `sectoriceClient` envía el pedido a:
   - `POST /v1/ecommerce/orders/import`
6. Sectorice autentica con `X-API-Key`, resuelve integración/proveedor/región y entra al pipeline operativo.

## Mapeo principal

- `order.id -> externalOrderId`
- `order.name -> externalPackageRef`
- `shipping_address.name -> recipientName`
- `shipping_address.phone || customer.phone -> phone`
- `shipping_address.address1 + address2 -> address`
- `shipping_address.city -> comuna`
- `order.note -> reference`
- `JSON.stringify(order) -> rawPayload`

## Notas importantes

- Este scaffold usa almacenamiento en memoria para el estado OAuth y los tokens instalados.
- Para producción real hay que persistir tokens y tiendas en una base de datos.
- `orders/cancelled` hoy se acepta y registra, pero no se reenvía a Sectorice porque el core actual no expone un endpoint de cancelación ecommerce.
- La app usa `read_orders` como scope inicial. Si luego se requiere backfill histórico o más eventos, habrá que ampliar scopes y webhooks.
