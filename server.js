const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DB_PATH = path.join(__dirname, 'data', 'lennoxjett.db');
const SESSION_COOKIE = 'lj_session';
const SESSION_DAYS = 30;

// ---------- Database setup ----------
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    has_paid INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL
  );
`);

// ---------- Password hashing (built-in crypto, no bcrypt needed) ----------
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function createUser(email, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  const stmt = db.prepare(
    `INSERT INTO users (email, password_hash, salt, created_at) VALUES (?, ?, ?, ?)`
  );
  const info = stmt.run(email.toLowerCase().trim(), hash, salt, new Date().toISOString());
  return info.lastInsertRowid;
}

function findUserByEmail(email) {
  const stmt = db.prepare(`SELECT * FROM users WHERE email = ?`);
  return stmt.get(email.toLowerCase().trim());
}

function verifyPassword(user, password) {
  const hash = hashPassword(password, user.salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(user.password_hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ---------- Sessions ----------
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`).run(
    token,
    userId,
    expires
  );
  return token;
}

function getSessionUser(token) {
  if (!token) return null;
  const row = db
    .prepare(`SELECT s.*, u.id as uid, u.email, u.has_paid FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`)
    .get(token);
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
    return null;
  }
  return { id: row.uid, email: row.email, has_paid: !!row.has_paid };
}

function destroySession(token) {
  if (token) db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
}

// ---------- Helpers ----------
function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    out[key] = decodeURIComponent(val);
  });
  return out;
}

function sendJSON(res, statusCode, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) req.destroy(); // 1MB limit
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

function serveStatic(req, res, urlPath) {
  let filePath = urlPath === '/' ? '/index.html' : urlPath;
  filePath = path.join(PUBLIC_DIR, filePath);

  // prevent path traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

// Sample product data — only served to logged-in users
const PRODUCTS = [
  {
    niche: 'fashion',
    name: 'Cloud-Step Slip-On Sneakers',
    note: "Comfort-shoe searches are climbing on social. Strong for video ads and repeat orders across colorways.",
    markup: '3.1×',
    competition: 'Medium',
  },
  {
    niche: 'gadget',
    name: 'Mini Pocket Projector',
    note: 'Gift-driven demand with strong seasonal spikes. Performs well in demo-style videos.',
    markup: '2.8×',
    competition: 'Low',
  },
  {
    niche: 'fitness',
    name: 'Adjustable Resistance Band Set',
    note: 'Low return rate, low shipping cost, and steady home-workout demand year-round.',
    markup: '4.2×',
    competition: 'Medium',
  },
  {
    niche: 'pet',
    name: 'Automatic Pet Water Fountain',
    note: 'Pet-owner spend keeps rising. High repeat-purchase rate on replacement filters.',
    markup: '2.5×',
    competition: 'Low',
  },
];

// ---------- Request handler ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const cookies = parseCookies(req);
  const sessionToken = cookies[SESSION_COOKIE];

  // ----- API routes -----
  if (pathname === '/api/signup' && req.method === 'POST') {
    try {
      const { email, password } = await readBody(req);
      if (!email || !password || password.length < 8) {
        return sendJSON(res, 400, { error: 'Email and a password of at least 8 characters are required.' });
      }
      if (findUserByEmail(email)) {
        return sendJSON(res, 409, { error: 'An account with that email already exists.' });
      }
      const userId = createUser(email, password);
      const token = createSession(userId);
      return sendJSON(res, 200, { ok: true }, {
        'Set-Cookie': `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${SESSION_DAYS * 86400}; SameSite=Lax`,
      });
    } catch (e) {
      return sendJSON(res, 400, { error: 'Invalid request.' });
    }
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    try {
      const { email, password } = await readBody(req);
      const user = email ? findUserByEmail(email) : null;
      if (!user || !verifyPassword(user, password || '')) {
        return sendJSON(res, 401, { error: 'Incorrect email or password.' });
      }
      const token = createSession(user.id);
      return sendJSON(res, 200, { ok: true }, {
        'Set-Cookie': `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${SESSION_DAYS * 86400}; SameSite=Lax`,
      });
    } catch (e) {
      return sendJSON(res, 400, { error: 'Invalid request.' });
    }
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    destroySession(sessionToken);
    return sendJSON(res, 200, { ok: true }, {
      'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`,
    });
  }

  if (pathname === '/api/me' && req.method === 'GET') {
    const user = getSessionUser(sessionToken);
    if (!user) return sendJSON(res, 401, { error: 'Not signed in.' });
    return sendJSON(res, 200, { email: user.email, has_paid: user.has_paid });
  }

  if (pathname === '/api/products' && req.method === 'GET') {
    const user = getSessionUser(sessionToken);
    if (!user) return sendJSON(res, 401, { error: 'Sign in to view the product list.' });
    return sendJSON(res, 200, { products: PRODUCTS });
  }

  // ----- Static files -----
  if (req.method === 'GET') {
    return serveStatic(req, res, pathname);
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Lennox Jett server running on http://localhost:${PORT}`);
});
