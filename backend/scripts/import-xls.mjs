#!/usr/bin/env node
/**
 * Kullanım (proje kökünden, önce bir kez: npm install):
 *   npm run import:xls -- "C:\...\YİYECEK ENVANTER STOK LİSTESİ.xls"
 *
 * veya backend klasöründen:
 *   npm run import:xls -- "C:\...\dosya.xls"
 *
 * Docker Postgres (5432 yayınlı): PGHOST=localhost PGPORT=5432
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../db.js';
import { parseStockRowsFromBuffer } from '../stockXlsImport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function upsertStockItems(client, items) {
  let upserted = 0;
  for (const it of items) {
    const name = String(it?.name ?? '').trim();
    const code = String(it?.code ?? '').trim();
    const u = String(it?.unit ?? '').toLowerCase();
    if (!name || !code || (u !== 'kilogram' && u !== 'adet')) continue;
    await client.query(
      `INSERT INTO stock_items (name, code, unit) VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, unit = EXCLUDED.unit`,
      [name, code, u]
    );
    upserted += 1;
  }
  return upserted;
}

const fileArg = process.argv[2];
if (!fileArg) {
  console.error('Dosya yolu verin: npm run import:xls -- "C:\\...\\liste.xls"');
  process.exit(1);
}

const abs = path.isAbsolute(fileArg) ? fileArg : path.join(process.cwd(), fileArg);
if (!fs.existsSync(abs)) {
  console.error('Dosya bulunamadı:', abs);
  process.exit(1);
}

const buffer = fs.readFileSync(abs);
const parsed = parseStockRowsFromBuffer(buffer);
console.log('Sayfa:', parsed.sheetName);
console.log('Geçerli satır:', parsed.items.length, 'Atlanan:', parsed.skipped.length);

if (parsed.skipped.length && parsed.skipped[0]?.reason && !parsed.items.length) {
  console.error('Hata:', parsed.skipped[0].reason);
  process.exit(1);
}

let client;
try {
  client = await pool.connect();
  await client.query('BEGIN');
  const n = await upsertStockItems(client, parsed.items);
  await client.query('COMMIT');
  console.log('Veritabanına yazıldı:', n, 'kayıt');
  if (parsed.skipped.length) {
    console.log('Örnek atlanan satırlar:', parsed.skipped.slice(0, 5));
  }
} catch (e) {
  if (client) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
  }
  console.error(e);
  process.exit(1);
} finally {
  if (client) client.release();
  await pool.end();
}
