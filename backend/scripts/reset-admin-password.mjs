#!/usr/bin/env node
/**
 * admin kullanıcısının şifresini sıfırlar (unutma / boş env ile yanlış oluşmuş hash için).
 * Kullanım (backend klasöründen):
 *   node scripts/reset-admin-password.mjs
 *   node scripts/reset-admin-password.mjs "YeniSifre123"
 */
import bcrypt from 'bcrypt';
import { pool } from '../db.js';

const pwd = process.argv[2] || 'admin123';
const hash = await bcrypt.hash(pwd, 10);
const r = await pool.query(
  `UPDATE app_users SET password_hash = $1 WHERE username = 'admin'`,
  [hash]
);
if (r.rowCount === 0) {
  await pool.query(
    `INSERT INTO app_users (username, password_hash, is_admin) VALUES ('admin', $1, TRUE)`,
    [hash]
  );
  console.log('admin kullanıcısı oluşturuldu.');
} else {
  console.log('admin şifresi güncellendi.');
}
console.log('Yeni şifre:', pwd);
await pool.end();
