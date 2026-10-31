import crypto from 'node:crypto';

export const COOKIE_NAME = 'addisgo_session';
export const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64, maxmem: 96 * 1024 * 1024 };
const JWT_HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

/** scrypt is memory-hard, built into Node and therefore has no native build step. */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: SCRYPT.maxmem,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(stored, password) {
  try {
    const parts = String(stored ?? '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, n, r, p, saltB64, hashB64] = parts;
    const salt = Buffer.from(saltB64, 'base64url');
    const expected = Buffer.from(hashB64, 'base64url');
    const actual = crypto.scryptSync(String(password), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: SCRYPT.maxmem,
    });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function createToken(userId, role, secret) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({ sub: userId, role, iat: now, exp: now + TOKEN_TTL_SECONDS }),
  ).toString('base64url');
  const signingInput = `${JWT_HEADER}.${payload}`;
  const signature = crypto.createHmac('sha256', secret).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

export function verifyToken(token, secret) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest();
  let given;
  try {
    given = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (!claims || typeof claims !== 'object') return null;
  if (!Number.isInteger(claims.sub) || claims.sub <= 0) return null;
  if (!Number.isInteger(claims.exp) || claims.exp <= now) return null;
  if (!['customer', 'driver', 'admin'].includes(claims.role)) return null;
  return claims;
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (!key || key in out) continue;
    out[key] = part.slice(index + 1).trim();
  }
  return out;
}

export function tokenFromRequest(req) {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }
  const cookies = parseCookies(req.headers.cookie);
  return cookies[COOKIE_NAME] || null;
}

export function sessionCookie(token) {
  const secure = process.env.ADDISGO_COOKIE_SECURE === '1' ? '; Secure' : '';
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TOKEN_TTL_SECONDS}${secure}`;
}

export function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function randomSecret(bytes = 48) {
  return crypto.randomBytes(bytes);
}

export function randomCode(length = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/** Small in-memory sliding-window limiter. Cheap, and enough for a single-node app. */
export class RateLimiter {
  constructor() {
    this.buckets = new Map();
    this.sweepAt = Date.now() + 60000;
  }

  allow(key, max, windowMs) {
    const now = Date.now();
    if (now > this.sweepAt) this.sweep(now);
    const cutoff = now - windowMs;
    const hits = (this.buckets.get(key) || []).filter((t) => t > cutoff);
    if (hits.length >= max) {
      this.buckets.set(key, hits);
      return false;
    }
    hits.push(now);
    this.buckets.set(key, hits);
    return true;
  }

  clear(key) {
    this.buckets.delete(key);
  }

  sweep(now) {
    this.sweepAt = now + 60000;
    for (const [key, hits] of this.buckets) {
      const newest = hits[hits.length - 1] || 0;
      if (now - newest > 3600000) this.buckets.delete(key);
    }
  }
}
