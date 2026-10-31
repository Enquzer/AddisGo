import { AppError } from './errors.js';
import { tokenFromRequest, verifyToken } from './security.js';

/** Resolves the session cookie/bearer token against the live user row. */
export function currentUser(ctx) {
  const token = tokenFromRequest(ctx.req);
  if (!token) return null;
  const claims = verifyToken(token, ctx.secret);
  if (!claims) return null;
  const row = ctx.db.get('SELECT id, role, status FROM users WHERE id = ?', [claims.sub]);
  if (!row || row.status !== 'active' || row.role !== claims.role) return null;
  return { id: row.id, role: row.role };
}

export function requireUser(ctx, message = 'Please sign in to continue.') {
  const user = currentUser(ctx);
  if (!user) throw AppError.unauthorized(message);
  return user;
}

export function requireAdmin(ctx) {
  const user = requireUser(ctx);
  if (user.role !== 'admin') throw AppError.forbidden('Admin access only.');
  return user;
}

export function requireDriver(ctx) {
  const user = requireUser(ctx);
  if (user.role !== 'driver') throw AppError.forbidden('This area is for registered drivers.');
  return user;
}

export function cleanName(value) {
  const name = String(value ?? '').trim();
  const len = Array.from(name).length;
  if (len < 2 || len > 60) throw AppError.bad('Please enter your full name (2–60 characters).');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) throw AppError.bad('That name contains unsupported characters.');
  return name;
}

export function cleanPassword(value) {
  const password = String(value ?? '');
  const len = Array.from(password).length;
  if (len < 8 || len > 128) throw AppError.bad('Password must be 8–128 characters long.');
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw AppError.bad('Password must include at least one letter and one number.');
  }
  return password;
}
