import crypto from 'crypto';
import axios from 'axios';

const SECRET = 'test_api_secret';

const payload = JSON.stringify({
  id: "820982911946154508",
  name: "#1001",
  note: "Timbre roto",
  customer: {
    first_name: "Juan",
    last_name: "Perez",
    phone: "+56912345678"
  },
  shipping_address: {
    name: "Juan Perez",
    address1: "Av. Francisco de Aguirre 123",
    address2: "Depto 403",
    city: "La Serena",
    zip: "1700000",
    phone: "+56912345678"
  },
  line_items: [
    { title: "Producto 1", quantity: 2 }
  ]
});

const hmac = crypto
  .createHmac('sha256', SECRET)
  .update(payload)
  .digest('base64');

console.log('HMAC generado:', hmac);

try {
  const response = await axios.post('http://localhost:3000/webhooks/orders/create', payload, {
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Hmac-Sha256': hmac,
      'X-Shopify-Shop-Domain': 'tienda-prueba.myshopify.com',
      'X-Shopify-Topic': 'orders/create',
      'X-Shopify-Webhook-Id': 'test-webhook-001'
    }
  });
  console.log('Respuesta:', JSON.stringify(response.data, null, 2));
} catch (error) {
  console.log('Error:', error.response?.status, JSON.stringify(error.response?.data, null, 2));
}
