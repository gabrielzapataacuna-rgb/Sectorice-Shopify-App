import fs from 'fs';
import Database from 'better-sqlite3';
import path from 'path';

const dataDir = path.join(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'shops.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS shops (
    shop TEXT PRIMARY KEY,
    access_token TEXT NOT NULL,
    scope TEXT,
    installed_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS tracked_orders (
    order_id TEXT NOT NULL,
    shop TEXT NOT NULL,
    import_status TEXT NOT NULL DEFAULT 'pending',
    payload_hash TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (order_id, shop)
  )
`);

export function saveShop(shop, accessToken, scope) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO shops (shop, access_token, scope, installed_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(shop) DO UPDATE SET
      access_token = excluded.access_token,
      scope = excluded.scope,
      updated_at = excluded.updated_at
  `).run(shop, accessToken, scope || '', now, now);
}

export function getShop(shop) {
  return db.prepare('SELECT * FROM shops WHERE shop = ?').get(shop);
}

export function listShops() {
  return db.prepare('SELECT shop, scope, installed_at, updated_at FROM shops').all();
}

export function deleteShop(shop) {
  return db.prepare('DELETE FROM shops WHERE shop = ?').run(shop);
}

export function upsertTrackedOrder(shop, orderId, status, payloadHash, lastError) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO tracked_orders (order_id, shop, import_status, payload_hash, last_error, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(order_id, shop) DO UPDATE SET
      import_status = excluded.import_status,
      payload_hash = excluded.payload_hash,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at
  `).run(orderId, shop, status, payloadHash || null, lastError || null, now, now);
}

export function getTrackedOrder(shop, orderId) {
  return db.prepare('SELECT * FROM tracked_orders WHERE order_id = ? AND shop = ?').get(orderId, shop);
}
