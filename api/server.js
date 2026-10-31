import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { toAppError } from './lib/errors.js';
import { openDatabase } from './lib/db.js';
import { seed } from './lib/seed.js';
import { readJson, sendJson, sendText } from './lib/http.js';
import { RateLimiter, randomSecret } from './lib/security.js';
import { match, allowedMethods } from './routes/index.js';

const API_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.dirname(API_DIR);

const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://*.google.com https://*.googleapis.com https://*.gstatic.com https://*.arcgisonline.com",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "font-src 'self' data:",
  "connect-src 'self' https://*.google.com https://*.arcgisonline.com",
  "media-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(self), camera=(self), microphone=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.webmanifest', '.txt', '.map']);

function loadEnvFile() {
  const file = path.join(PROJECT_DIR, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^"(.*)"$/, '$1');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function loadSecret(dataDir) {
  const fromEnv = process.env.ADDISGO_JWT_SECRET;
  if (fromEnv) {
    if (Buffer.byteLength(fromEnv) < 32) {
      throw new Error('ADDISGO_JWT_SECRET must be at least 32 characters.');
    }
    return Buffer.from(fromEnv, 'utf8');
  }
  const file = path.join(dataDir, 'jwt_secret');
  if (fs.existsSync(file)) {
    const decoded = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
    if (decoded.length >= 32) return decoded;
  }
  const secret = randomSecret(48);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, secret.toString('base64'), { mode: 0o600 });
  return secret;
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers.host || '';
  if (origin === `http://${host}` || origin === `https://${host}`) return true;
  try {
    const parsed = new URL(origin);
    const h = parsed.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return true;
    if (/^(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+)$/.test(h)) return true;
  } catch {
    return false;
  }
  const extra = String(process.env.ADDISGO_ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return extra.includes(origin);
}

const stats = { requests: 0, apiErrors: 0, startedAt: Date.now() };

function createApp({ db, secret, webRoot }) {
  const limiter = new RateLimiter();
  const gzipCache = new Map();
  const logRequests = process.env.ADDISGO_LOG === '1';

  async function handleApi(req, res, url) {
    const pathname = url.pathname.replace(/^\/api/, '') || '/';
    let route = match(req.method, pathname);
    if (!route) {
      const allowed = allowedMethods(pathname);
      if (allowed.length && req.method === 'OPTIONS') {
        res.writeHead(204, { Allow: allowed.join(', '), ...SECURITY_HEADERS });
        res.end();
        return;
      }
      if (allowed.length) {
        sendJson(res, 405, { error: `Use ${allowed.join(' or ')} for this endpoint.`, code: 'method_not_allowed' });
        return;
      }
      sendJson(res, 404, { error: 'Endpoint not found.', code: 'not_found' });
      return;
    }

    const mutating = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method);
    if (mutating && !originAllowed(req)) {
      sendJson(res, 403, { error: 'Cross-origin request blocked.', code: 'forbidden' });
      return;
    }

    let body = {};
    if (mutating) {
      try {
        body = await readJson(req);
      } catch (error) {
        const appError = toAppError(error);
        stats.apiErrors += 1;
        sendJson(res, appError.status, { error: appError.message, code: appError.code });
        return;
      }
    }

    const ctx = {
      req,
      res,
      url,
      db,
      secret,
      limiter,
      query: url.searchParams,
      params: route.params,
      body,
      setCookies: [],
    };

    try {
      const result = await route.handler(ctx);
      const cookieHeaders = ctx.setCookies.length ? { 'Set-Cookie': ctx.setCookies } : null;
      if (result && result.__raw) {
        const headers = { ...SECURITY_HEADERS, ...(result.headers || {}) };
        if (cookieHeaders) headers['Set-Cookie'] = ctx.setCookies;
        res.writeHead(result.status || 200, headers);
        res.end(result.body);
        return;
      }
      sendJson(res, 200, result, { ...SECURITY_HEADERS, ...(cookieHeaders || {}) });
    } catch (error) {
      const appError = toAppError(error);
      if (appError.status >= 500) stats.apiErrors += 1;
      if (logRequests) console.error(`[addisgo] ${req.method} ${url.pathname} -> ${appError.status} ${appError.message}`);
      sendJson(res, appError.status, { error: appError.message, code: appError.code });
    }
  }

  function resolveStatic(pathname) {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return null;
    }
    if (decoded.includes('\0')) return null;
    const relative = decoded.replace(/^\/+/, '');
    const target = path.resolve(webRoot, relative || 'index.html');
    const root = path.resolve(webRoot);
    if (target !== root && !target.startsWith(root + path.sep)) return null;
    return target;
  }

  function serveFile(req, res, file, status = 200) {
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const stat = fs.statSync(file);
    const etag = `W/"${stat.size}-${Math.round(stat.mtimeMs)}"`;

    const headers = {
      ...SECURITY_HEADERS,
      'Content-Type': type,
      'Last-Modified': stat.mtime.toUTCString(),
      ETag: etag,
      'Cache-Control': /[\\/]vendor[\\/]/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache',
      Vary: 'Accept-Encoding',
    };

    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      res.end();
      return;
    }

    const data = fs.readFileSync(file);
    const acceptsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
    let payload = data;
    if (acceptsGzip && COMPRESSIBLE.has(ext) && data.length > 1024) {
      const key = `${file}:${stat.size}:${Math.round(stat.mtimeMs)}`;
      let cached = gzipCache.get(key);
      if (!cached) {
        cached = zlib.gzipSync(data, { level: 6 });
        if (gzipCache.size > 60) gzipCache.clear();
        gzipCache.set(key, cached);
      }
      payload = cached;
      headers['Content-Encoding'] = 'gzip';
    }

    headers['Content-Length'] = payload.length;
    res.writeHead(status, headers);
    if (req.method === 'HEAD') res.end();
    else res.end(payload);
  }

  function handleStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'Method not allowed.', code: 'method_not_allowed' });
      return;
    }
    if (url.pathname === '/healthz') {
      sendText(res, 200, 'ok', { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      return;
    }

    const file = resolveStatic(url.pathname);
    if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
      serveFile(req, res, file);
      return;
    }

    const wantsAsset = path.extname(url.pathname) !== '';
    const index = path.join(webRoot, 'index.html');
    if (!wantsAsset && fs.existsSync(index)) {
      serveFile(req, res, index);
      return;
    }
    sendText(res, 404, 'Not found', {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    });
  }

  return function handler(req, res) {
    stats.requests += 1;
    let url;
    try {
      url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    } catch {
      res.writeHead(400, SECURITY_HEADERS);
      res.end('Bad request');
      return;
    }

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      handleApi(req, res, url).catch((error) => {
        console.error('[addisgo] unhandled API error:', error);
        if (!res.headersSent) {
          sendJson(res, 500, { error: 'Something went wrong on our side. Please try again.', code: 'server_error' });
        } else {
          res.end();
        }
      });
      return;
    }
    handleStatic(req, res, url);
  };
}

function listen(server, port, attempts = 8) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      if (error.code === 'EADDRINUSE' && attempts > 0) {
        listen(server, port + 1, attempts - 1).then(resolve, reject);
      } else {
        reject(error);
      }
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '0.0.0.0');
  });
}

async function main() {
  loadEnvFile();

  const dataDir = process.env.ADDISGO_DATA_DIR
    ? path.resolve(process.env.ADDISGO_DATA_DIR)
    : path.join(PROJECT_DIR, 'data');
  const dbFile = process.env.ADDISGO_DB ? path.resolve(process.env.ADDISGO_DB) : path.join(dataDir, 'addisgo.db');
  const webRoot = process.env.ADDISGO_WEB_DIST ? path.resolve(process.env.ADDISGO_WEB_DIST) : path.join(PROJECT_DIR, 'web');

  if (!fs.existsSync(path.join(webRoot, 'index.html'))) {
    console.warn(`[addisgo] warning: frontend not found at ${path.join(webRoot, 'index.html')}`);
  }

  const db = openDatabase(dbFile);
  const seeded = seed(db);
  const secret = loadSecret(dataDir);
  const app = createApp({ db, secret, webRoot });

  const server = http.createServer(app);
  server.headersTimeout = 20000;
  server.requestTimeout = 30000;
  server.keepAliveTimeout = 65000;

  const port = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 3003;
  const bound = await listen(server, port);

  const nets = os.networkInterfaces();
  const lanIps = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254')) {
        lanIps.push(net.address);
      }
    }
  }

  console.log('');
  console.log('  AddisGo is running');
  console.log(`  → Local (Computer): http://localhost:${bound}`);
  for (const ip of lanIps) {
    console.log(`  → Mobile Phone:     http://${ip}:${bound}`);
  }
  console.log(`  → Database:         ${dbFile}`);
  if (seeded.seeded) console.log('  → Demo data seeded (admin@addisgo.et / Admin123!)');
  console.log('');

  let closing = false;
  const shutdown = (signal) => {
    if (closing) return;
    closing = true;
    console.log(`\n[addisgo] ${signal} received, shutting down…`);
    server.close(() => {
      try {
        db.close();
      } catch {
        /* already closed */
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (error) => console.error('[addisgo] unhandled rejection:', error));
  process.on('uncaughtException', (error) => {
    console.error('[addisgo] uncaught exception:', error);
    shutdown('uncaughtException');
  });

  return { server, db };
}

main().catch((error) => {
  console.error('[addisgo] failed to start:', error.message);
  if (error.code === 'ERR_SQLITE_ERROR') console.error('  Is the database file writable?');
  process.exit(1);
});
