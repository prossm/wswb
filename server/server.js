// wswb.fyi server: serves the static page and a small JSON API backed by SQLite.
// No dependencies. Run with Node 22.13+:  node server/server.js
//
//   GET  /api/ideas?voter=<uuid>   the board
//   POST /api/ideas                submit an idea
//   POST /api/reactions            toggle a reaction  { idea, kind, voter } -> { on }
//   GET  /api/health

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, createStore, KINDS, EVIDENCE, ROLES } from './db.js';

const PORT = Number(process.env.PORT) || 8000;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 'live' (default) or 'pending' for approval-first moderation.
const NEW_IDEA_STATUS = process.env.NEW_IDEA_STATUS === 'pending' ? 'pending' : 'live';
const MAX_BODY = 16 * 1024;

const db = openDb();
const store = createStore(db);

// ---------- Static files: an explicit list, so nothing else in the repo is ever served ----------

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/data.js': ['data.js', 'text/javascript; charset=utf-8'],
  '/demo-data.js': ['demo-data.js', 'text/javascript; charset=utf-8'],
  '/config.js': ['config.js', 'text/javascript; charset=utf-8'],
};
const cache = new Map();

async function serveStatic(req, res, pathname) {
  const entry = STATIC[pathname];
  if (!entry) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  const [file, type] = entry;
  let body = process.env.NODE_ENV === 'production' ? cache.get(file) : undefined;
  if (!body) {
    body = await readFile(path.join(ROOT, file));
    cache.set(file, body);
  }
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': body.length,
    'Cache-Control': 'no-cache',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

// ---------- Validation ----------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GITHUB_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

class BadRequest extends Error {}

function text(v, field, { required = false, min = 3, max }) {
  if (v == null || v === '') {
    if (required) throw new BadRequest(`${field} is required`);
    return null;
  }
  if (typeof v !== 'string') throw new BadRequest(`${field} must be text`);
  const t = v.trim();
  if (t === '') {
    if (required) throw new BadRequest(`${field} is required`);
    return null;
  }
  // Count characters the way the database does (code points, not UTF-16 units).
  const len = [...t].length;
  if (required && len < min) throw new BadRequest(`${field} is too short`);
  if (len > max) throw new BadRequest(`${field} is too long`);
  return t;
}

function uuid(v, field) {
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw new BadRequest(`${field} must be a UUID`);
  return v.toLowerCase();
}

function parseIdea(b) {
  if (!b || typeof b !== 'object') throw new BadRequest('expected a JSON object');
  const roles = b.help_roles ?? [];
  if (!Array.isArray(roles) || roles.some((r) => !ROLES.includes(r))) throw new BadRequest('bad help_roles');
  if (b.evidence != null && !EVIDENCE.includes(b.evidence)) throw new BadRequest('bad evidence');
  const row = {
    id: uuid(b.id, 'id'),
    submitter: uuid(b.submitter, 'submitter'),
    idea: text(b.idea, 'idea', { required: true, max: 1000 }),
    who: text(b.who, 'who', { required: true, max: 200 }),
    pain: text(b.pain, 'pain', { required: true, max: 1000 }),
    why_tech: text(b.why_tech, 'why_tech', { max: 600 }),
    evidence: b.evidence ?? null,
    smallest: text(b.smallest, 'smallest', { max: 600 }),
    help_roles: [...new Set(roles)],
    name: text(b.name, 'name', { max: 80 }),
    github: text(b.github, 'github', { max: 39 }),
    email: text(b.email, 'email', { max: 254 }),
  };
  if (row.github && !GITHUB_RE.test(row.github)) throw new BadRequest('bad github username');
  if (row.email && !EMAIL_RE.test(row.email)) throw new BadRequest('bad email');
  return row;
}

// ---------- Rate limiting (per IP, in memory, fixed window) ----------

const LIMITS = {
  submit: { max: 20, windowMs: 60 * 60_000 },
  react: { max: 300, windowMs: 10 * 60_000 },
  read: { max: 600, windowMs: 10 * 60_000 },
};
const hits = new Map();

function limited(ip, bucket) {
  const { max, windowMs } = LIMITS[bucket];
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  let h = hits.get(key);
  if (!h || now - h.start > windowMs) {
    h = { start: now, count: 0 };
    hits.set(key, h);
  }
  h.count += 1;
  return h.count > max;
}
setInterval(() => {
  const now = Date.now();
  for (const [key, h] of hits) if (now - h.start > 60 * 60_000) hits.delete(key);
}, 10 * 60_000).unref();

function clientIp(req) {
  // Disco's Caddy proxy sets X-Forwarded-For to the real client address.
  const xff = req.headers['x-forwarded-for'];
  return (typeof xff === 'string' && xff.split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';
}

// ---------- HTTP plumbing ----------

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
    "base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(payload);
}

async function readJson(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
    throw new BadRequest('expected application/json');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new BadRequest('body too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new BadRequest('invalid JSON');
  }
}

async function handleApi(req, res, url) {
  const ip = clientIp(req);
  const route = `${req.method} ${url.pathname}`;

  switch (route) {
    case 'GET /api/health':
      return send(res, 200, { ok: true });

    case 'GET /api/ideas': {
      if (limited(ip, 'read')) return send(res, 429, { error: 'slow down' });
      const voter = uuid(url.searchParams.get('voter'), 'voter');
      return send(res, 200, store.listIdeas(voter));
    }

    case 'POST /api/ideas': {
      if (limited(ip, 'submit')) return send(res, 429, { error: 'slow down' });
      const row = parseIdea(await readJson(req));
      store.submitIdea(row, NEW_IDEA_STATUS);
      return send(res, 201, { ok: true });
    }

    case 'POST /api/reactions': {
      if (limited(ip, 'react')) return send(res, 429, { error: 'slow down' });
      const b = await readJson(req);
      if (!KINDS.includes(b?.kind)) throw new BadRequest('bad kind');
      const on = store.toggleReaction(uuid(b.idea, 'idea'), b.kind, uuid(b.voter, 'voter'));
      if (on === null) return send(res, 404, { error: 'idea not found' });
      return send(res, 200, { on });
    }

    default:
      return send(res, 404, { error: 'not found' });
  }
}

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  const started = Date.now();
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else if (req.method === 'GET' || req.method === 'HEAD') await serveStatic(req, res, url.pathname);
    else send(res, 405, 'Method not allowed', 'text/plain; charset=utf-8');
  } catch (err) {
    if (err instanceof BadRequest) {
      send(res, 400, { error: err.message });
    } else {
      console.error(err);
      if (!res.headersSent) send(res, 500, { error: 'server error' });
    }
  } finally {
    // Path only: query strings carry browser IDs.
    console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
  }
});

server.listen(PORT, () => {
  console.log(`wswb listening on http://localhost:${PORT} (new ideas start as '${NEW_IDEA_STATUS}')`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
