import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'muhasebe',
  user: process.env.PGUSER || 'muhasebe',
  password: process.env.PGPASSWORD || 'muhasebe',
  max: 20,
  idleTimeoutMillis: 30000,
});
