function firstNonBlank(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function buildRecipientName(order) {
  return firstNonBlank(
    order?.shipping_address?.name,
    [order?.customer?.first_name, order?.customer?.last_name].filter(Boolean).join(' '),
    order?.customer?.name
  );
}

function buildPhone(order) {
  return firstNonBlank(
    order?.shipping_address?.phone,
    order?.customer?.phone,
    order?.billing_address?.phone
  );
}

function buildAddress(order) {
  return [order?.shipping_address?.address1, order?.shipping_address?.address2]
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim())
    .join(', ');
}

function buildReference(order) {
  const parts = [
    order?.note,
    order?.shipping_address?.zip ? `ZIP ${order.shipping_address.zip}` : null,
    Array.isArray(order?.line_items) ? `${order.line_items.length} items` : null,
    order?.name ? `Shopify order ${order.name}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' | ') : null;
}

export function mapShopifyOrderToSectoriceImportItem(order) {
  const recipientName = buildRecipientName(order);
  const address = buildAddress(order);
  const comuna = firstNonBlank(order?.shipping_address?.city);

  if (!order?.id) {
    throw new Error('Shopify order.id es obligatorio para Sectorice');
  }
  if (!recipientName) {
    throw new Error('No se pudo resolver recipientName desde Shopify');
  }
  if (!address) {
    throw new Error('No se pudo resolver address desde Shopify');
  }
  if (!comuna) {
    throw new Error('No se pudo resolver comuna desde Shopify shipping_address.city');
  }

  return {
    externalOrderId: order?.id != null ? String(order.id) : null,
    externalShipmentId: null,
    externalPackageRef: order?.name ? String(order.name) : null,
    serviceType: 'DELIVERY',
    recipientName,
    phone: buildPhone(order),
    address,
    comuna,
    reference: buildReference(order),
    rawPayload: JSON.stringify(order),
    originName: null,
    originPhone: null,
    originAddress: null,
    originComuna: null,
  };
}
