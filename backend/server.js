import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import session from 'express-session';
import bcrypt from 'bcrypt';
import { fileURLToPath } from 'url';
import { pool } from './db.js';
import { parseStockRowsFromBuffer, normalizeUnit } from './stockXlsImport.js';
import { ensureAuthSchema } from './authSetup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = fs.existsSync(path.join(__dirname, 'public'))
  ? path.join(__dirname, 'public')
  : path.join(__dirname, '..', 'public');
const app = express();
const PORT = Number(process.env.PORT || 3000);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));
app.set('trust proxy', 1);
const sessionSecret = process.env.SESSION_SECRET || 'muhasebe-oturum-gizli-degistirin';
const sessionCookieSecure = process.env.COOKIE_SECURE === 'true';
app.use(
  session({
    name: 'muhasebe.sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: true,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: sessionCookieSecure,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

function isPublicRoute(req) {
  // Modül script / stil istekleri HTML yönlendirmesine düşmesin (MIME: text/html hatası)
  if (req.method === 'GET' && /\.(js|css|map)$/i.test(req.path)) return true;
  if (req.path === '/login.html') return true;
  if (req.path === '/voyage-design-system.css') return true;
  if (req.path === '/favicon.ico') return true;
  if (req.path === '/api/health' && req.method === 'GET') return true;
  if (req.path === '/api/auth/login' && req.method === 'POST') return true;
  return false;
}

function requireAuth(req, res, next) {
  if (isPublicRoute(req)) return next();
  if (!req.session?.userId) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Giriş gerekli' });
    }
    if (req.method === 'GET' && req.accepts('html')) {
      return res.redirect(302, '/login.html');
    }
    return res.status(401).send('Giriş gerekli');
  }
  if (req.path === '/yonetim.html' && req.method === 'GET' && !req.session.isAdmin) {
    return res.redirect(302, '/index.html');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session?.isAdmin) {
    return res.status(403).json({ error: 'Yönetici yetkisi gerekli' });
  }
  next();
}

async function upsertStockItems(client, items) {
  let upserted = 0;
  for (const it of items) {
    const name = String(it?.name ?? '').trim();
    const code = String(it?.code ?? '').trim();
    const u = String(it?.unit ?? '').trim();
    if (!name || !code || !normalizeUnit(u)) continue;
    await client.query(
      `INSERT INTO stock_items (name, code, unit) VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, unit = EXCLUDED.unit`,
      [name, code, u]
    );
    upserted += 1;
  }
  return upserted;
}

function buildSearchPattern(q) {
  if (q == null || String(q).trim() === '') return '%';
  const s = String(q).trim();
  if (s.includes('%')) return s;
  return `%${s}%`;
}

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (e) {
    res.status(503).json({ ok: false, error: String(e.message) });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const username = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '');
    if (!username || !password) {
      return res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli' });
    }
    const { rows } = await pool.query(
      'SELECT id, username, password_hash, is_admin FROM app_users WHERE username = $1',
      [username]
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Geçersiz kullanıcı adı veya şifre' });
    }
    const isAdmin =
      user.is_admin === true ||
      user.is_admin === 't' ||
      user.is_admin === 1;
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.isAdmin = Boolean(isAdmin);
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });
    res.json({ ok: true, username: user.username, is_admin: Boolean(isAdmin) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

app.use(requireAuth);

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Çıkış başarısız' });
    res.clearCookie('muhasebe.sid', { path: '/' });
    res.json({ ok: true });
  });
});

app.get('/api/auth/me', (req, res) => {
  res.json({
    id: req.session.userId,
    username: req.session.username,
    is_admin: !!req.session.isAdmin,
  });
});

app.get('/api/users', requireAdmin, async (_req, res) => {
  const { rows } = await pool.query(
    'SELECT id, username, is_admin, created_at FROM app_users ORDER BY username ASC'
  );
  res.json(rows);
});

app.post('/api/users', requireAdmin, async (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  const isAdmin = Boolean(req.body?.is_admin);
  if (!username || !password) {
    return res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Şifre en az 4 karakter olmalı' });
  }
  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await pool.query(
      `INSERT INTO app_users (username, password_hash, is_admin) VALUES ($1, $2, $3)
       RETURNING id, username, is_admin, created_at`,
      [username, hash, isAdmin]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'Bu kullanıcı adı zaten kayıtlı' });
    }
    throw e;
  }
});

app.delete('/api/users/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Geçersiz id' });
  if (id === req.session.userId) {
    return res.status(400).json({ error: 'Kendi hesabınızı silemezsiniz' });
  }
  const { rows: admins } = await pool.query(
    'SELECT COUNT(*)::int AS c FROM app_users WHERE is_admin = TRUE'
  );
  const { rows: target } = await pool.query(
    'SELECT is_admin FROM app_users WHERE id = $1',
    [id]
  );
  if (!target.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  if (target[0].is_admin && admins[0].c <= 1) {
    return res.status(400).json({ error: 'Son yönetici silinemez' });
  }
  await pool.query('DELETE FROM app_users WHERE id = $1', [id]);
  res.json({ ok: true });
});

app.get('/api/cost-centers', async (_req, res) => {
  const { rows } = await pool.query(
    'SELECT id, code, name FROM cost_centers ORDER BY name ASC'
  );
  res.json(rows);
});

app.get('/api/stock-items/search', async (req, res) => {
  const pattern = buildSearchPattern(req.query.q);
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const { rows } = await pool.query(
    `SELECT id, name, code, unit
     FROM stock_items
     WHERE name ILIKE $1
     ORDER BY name ASC
     LIMIT $2`,
    [pattern, limit]
  );
  res.json(rows);
});

app.post('/api/stock-items/bulk', async (req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items dizisi gerekli.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const upserted = await upsertStockItems(client, items);
    await client.query('COMMIT');
    res.json({ ok: true, upserted });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

app.post('/api/stock-items/import-xls', upload.single('file'), async (req, res) => {
  const orig = req.file?.originalname || '';
  if (!req.file?.buffer || !/\.(xls|xlsx)$/i.test(orig)) {
    return res.status(400).json({ error: '.xls veya .xlsx dosyası yükleyin (alan adı: file).' });
  }
  const parsed = parseStockRowsFromBuffer(req.file.buffer);
  if (!parsed.items.length && parsed.skipped.some((s) => s.reason?.includes('bulunamadı'))) {
    return res.status(400).json({
      error: 'Excel okunamadı veya sütun başlıkları uygun değil.',
      skipped: parsed.skipped,
      sheetName: parsed.sheetName,
    });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const upserted = await upsertStockItems(client, parsed.items);
    await client.query('COMMIT');
    res.json({
      ok: true,
      upserted,
      skippedRows: parsed.skipped,
      sheetName: parsed.sheetName,
      parsedCount: parsed.items.length,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

app.post('/api/stock-items', async (req, res) => {
  const { name, code, unit } = req.body || {};
  if (!name || !code || !unit) {
    return res.status(400).json({ error: 'name, code ve unit zorunludur.' });
  }
  const u = String(unit).toLowerCase();
  if (u !== 'kilogram' && u !== 'adet') {
    return res.status(400).json({ error: 'Birim kilogram veya adet olmalıdır.' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO stock_items (name, code, unit)
       VALUES ($1, $2, $3)
       RETURNING id, name, code, unit, created_at`,
      [String(name).trim(), String(code).trim(), u]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'Bu stok kodu zaten kayıtlı.' });
    }
    throw e;
  }
});

app.get('/api/stock-counts', async (req, res) => {
  const ccId = Number(req.query.cost_center_id);
  if (!ccId) {
    return res.status(400).json({ error: 'cost_center_id gerekli.' });
  }
  const { rows } = await pool.query(
    `SELECT sc.id, sc.quantity, sc.updated_at,
            si.id AS stock_item_id, si.name AS stock_name, si.code AS stock_code, si.unit
     FROM stock_counts sc
     JOIN stock_items si ON si.id = sc.stock_item_id
     WHERE sc.cost_center_id = $1
     ORDER BY si.name ASC`,
    [ccId]
  );
  res.json(rows);
});

app.post('/api/stock-counts', async (req, res) => {
  const { cost_center_id, stock_item_id, quantity } = req.body || {};
  const cc = Number(cost_center_id);
  const si = Number(stock_item_id);
  if (!cc || !si) {
    return res.status(400).json({ error: 'cost_center_id ve stock_item_id gerekli.' });
  }
  const qStr = quantity != null ? String(quantity).trim().replace(',', '.') : '';
  if (qStr === '' || Number.isNaN(Number(qStr))) {
    return res.status(400).json({ error: 'Geçerli bir miktar girin.' });
  }
  const qNum = Number(qStr);
  if (qNum < 0) {
    return res.status(400).json({ error: 'Miktar negatif olamaz.' });
  }
  const { rows } = await pool.query(
    `INSERT INTO stock_counts (cost_center_id, stock_item_id, quantity)
     VALUES ($1, $2, $3)
     ON CONFLICT (cost_center_id, stock_item_id)
     DO UPDATE SET quantity = stock_counts.quantity + EXCLUDED.quantity, updated_at = NOW()
     RETURNING id, cost_center_id, stock_item_id, quantity, updated_at`,
    [cc, si, qNum]
  );
  res.json(rows[0]);
});

app.patch('/api/stock-counts/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { quantity } = req.body || {};
  const qStr = quantity != null ? String(quantity).trim().replace(',', '.') : '';
  if (!id || qStr === '' || Number.isNaN(Number(qStr))) {
    return res.status(400).json({ error: 'Geçerli miktar gerekli.' });
  }
  const qNum = Number(qStr);
  if (qNum < 0) {
    return res.status(400).json({ error: 'Miktar negatif olamaz.' });
  }
  const { rows } = await pool.query(
    `UPDATE stock_counts SET quantity = $1, updated_at = NOW() WHERE id = $2
     RETURNING id, cost_center_id, stock_item_id, quantity, updated_at`,
    [qNum, id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Kayıt bulunamadı.' });
  res.json(rows[0]);
});

app.delete('/api/stock-counts/:id', async (req, res) => {
  const id = Number(req.params.id);
  const r = await pool.query('DELETE FROM stock_counts WHERE id = $1', [id]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'Kayıt bulunamadı.' });
  res.json({ ok: true });
});

app.use(express.static(publicDir));

app.get('/', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'Dosya çok büyük (en fazla 25 MB).' });
  }
  res.status(500).json({ error: err.message || 'Sunucu hatası' });
});

async function start() {
  await ensureAuthSchema();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`API http://0.0.0.0:${PORT}`);
  });
}

start().catch((e) => {
  console.error(e);
  process.exit(1);
});
