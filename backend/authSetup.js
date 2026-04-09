import bcrypt from 'bcrypt';
import { pool } from './db.js';

export async function ensureAuthSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(128) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      is_admin BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM app_users');
  if (rows[0].c === 0) {
    const raw = process.env.ADMIN_PASSWORD;
    const pwd =
      raw != null && String(raw).trim() !== '' ? String(raw).trim() : 'admin123';
    const hash = await bcrypt.hash(pwd, 10);
    await pool.query(
      `INSERT INTO app_users (username, password_hash, is_admin) VALUES ($1, $2, TRUE)`,
      ['admin', hash]
    );
    console.log(
      '[auth] İlk yönetici oluşturuldu: kullanıcı adı "admin", şifre ADMIN_PASSWORD ortam değişkeni veya varsayılan "admin123"'
    );
  }
}
