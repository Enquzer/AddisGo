import { AppError } from '../lib/errors.js';
import { requireUser } from '../lib/context.js';
import { audit, notifications as listNotifications, notify } from '../lib/db.js';
import { charLen, nowIso, round1 } from '../lib/util.js';

export async function health() {
  return {
    status: 'ok',
    service: 'addisgo',
    version: '1.0.0',
    time: nowIso(),
  };
}

export async function publicStats(ctx) {
  const scalar = (sql, params = []) => Number(ctx.db.get(sql, params).n ?? 0);
  const driversOnline = scalar("SELECT COUNT(*) AS n FROM drivers WHERE status = 'approved' AND is_online = 1");
  const driversTotal = scalar("SELECT COUNT(*) AS n FROM drivers WHERE status = 'approved'");
  const toursUpcoming = scalar("SELECT COUNT(*) AS n FROM tours WHERE status = 'upcoming' AND starts_at > ?", [nowIso()]);
  const tripsCompleted = scalar("SELECT COUNT(*) AS n FROM bookings WHERE status = 'completed'");
  const row = ctx.db.get(
    "SELECT COALESCE(AVG(rating), 5.0) AS avg FROM drivers WHERE status = 'approved' AND rating_count > 0",
  );
  return {
    drivers_online: driversOnline,
    drivers_total: driversTotal,
    tours_upcoming: toursUpcoming,
    trips_completed: tripsCompleted,
    avg_rating: round1(Number(row?.avg ?? 5)),
  };
}

export async function notifications(ctx) {
  const auth = requireUser(ctx);
  const items = listNotifications(ctx.db, auth.id);
  return { notifications: items, unread: items.filter((n) => !n.is_read).length };
}

export async function markNotificationsRead(ctx) {
  const auth = requireUser(ctx);
  ctx.db.run('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [auth.id]);
  return { ok: true };
}

const TABLES = { message: 'messages', user: 'users', tour: 'tours', booking: 'bookings' };

export async function createReport(ctx) {
  const auth = requireUser(ctx);
  if (!ctx.limiter.allow(`report:${auth.id}`, 5, 3600000)) {
    throw AppError.tooMany('You have submitted several reports recently. Our team is on it.');
  }
  const targetType = String(ctx.body.target_type ?? '').trim().toLowerCase();
  const table = TABLES[targetType];
  if (!table) throw AppError.bad('Unknown report type.');

  const reason = String(ctx.body.reason ?? '').trim();
  if (charLen(reason) < 3 || charLen(reason) > 200) {
    throw AppError.bad('Tell us briefly what happened (3–200 characters).');
  }
  const targetId = Number(ctx.body.target_id);
  if (!Number.isInteger(targetId) || targetId <= 0) throw AppError.bad('Unknown report type.');
  const detail = Array.from(String(ctx.body.detail ?? '').trim()).slice(0, 1000).join('');

  if (targetType === 'user' && targetId === auth.id) {
    throw AppError.bad('You cannot report your own account.');
  }
  const found = ctx.db.get(`SELECT id FROM ${table} WHERE id = ?`, [targetId]);
  if (!found) throw AppError.notFound('That item no longer exists.');

  const duplicate = ctx.db.get(
    "SELECT id FROM reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status = 'open'",
    [auth.id, targetType, targetId],
  );
  if (duplicate) {
    throw AppError.conflict('You already reported this. Our safety team is reviewing it.');
  }

  ctx.db.run(
    `INSERT INTO reports (reporter_id, target_type, target_id, reason, detail, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'open', ?)`,
    [auth.id, targetType, targetId, reason, detail, nowIso()],
  );
  for (const admin of ctx.db.all("SELECT id FROM users WHERE role = 'admin' AND status = 'active'")) {
    notify(ctx.db, admin.id, 'safety', 'New safety report', `A ${targetType} was reported: ${reason}`);
  }
  audit(ctx.db, auth.id, 'safety.report_created', `${targetType} #${targetId} — ${reason}`);
  return { ok: true, message: 'Thanks — our safety team will review this.' };
}

export async function getRoute(ctx) {
  const fromLat = Number(ctx.query.get('from_lat'));
  const fromLng = Number(ctx.query.get('from_lng'));
  const toLat = Number(ctx.query.get('to_lat'));
  const toLng = Number(ctx.query.get('to_lng'));

  if (!Number.isFinite(fromLat) || !Number.isFinite(fromLng) || !Number.isFinite(toLat) || !Number.isFinite(toLng)) {
    throw AppError.bad('Valid from and to coordinates are required.');
  }

  const { getStreetRoute } = await import('../lib/routing.js');
  const result = await getStreetRoute(fromLat, fromLng, toLat, toLng);
  return result;
}

export async function subscribeNewsletter(ctx) {
  const email = String(ctx.body?.email ?? '').trim().toLowerCase();
  const { validEmail } = await import('../lib/util.js');
  if (!validEmail(email)) throw AppError.bad('Please enter a valid email address.');

  try {
    ctx.db.run(
      'INSERT INTO subscribers (email, source, created_at) VALUES (?, ?, ?)',
      [email, 'landing', nowIso()],
    );
  } catch (err) {
    if (!String(err.message || '').includes('UNIQUE')) throw err;
  }

  const { sendNewsletterWelcomeEmail } = await import('../lib/email.js');
  sendNewsletterWelcomeEmail(ctx.db, email).catch(() => {});

  return { ok: true, message: 'Subscribed successfully! You will receive upcoming Addis city updates & tours.' };
}
