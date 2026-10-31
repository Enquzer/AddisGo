import { AppError } from '../lib/errors.js';
import { currentUser, requireUser } from '../lib/context.js';
import { sendTourConfirmationEmail } from '../lib/email.js';
import {
  notify,
  publicUser,
  tourChatMessages,
  tourView,
} from '../lib/db.js';
import {
  charLen,
  nowIso,
  parseScheduled,
  splitLanguages,
  startsInPast,
  validCoords,
} from '../lib/util.js';

const THEMES = ['entoto', 'merkato', 'museum', 'bole', 'custom'];

function likeValue(text) {
  return `%${String(text).replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
}

export async function list(ctx) {
  const viewer = currentUser(ctx);
  const mine = ctx.query.get('mine') === '1';
  const past = ctx.query.get('past') === '1';
  const q = (ctx.query.get('q') || '').trim();

  let sql = 'SELECT t.id AS id FROM tours t';
  const params = [];

  if (mine) {
    if (!viewer) throw AppError.unauthorized('Sign in to see your tours.');
    sql += ' JOIN tour_members m ON m.tour_id = t.id AND m.user_id = ?';
    params.push(viewer.id);
  }
  sql += ' WHERE 1 = 1';
  if (past) {
    sql += " AND (t.status != 'upcoming' OR t.starts_at <= ?)";
    params.push(nowIso());
  } else {
    sql += " AND t.status = 'upcoming' AND t.starts_at > ?";
    params.push(nowIso());
  }
  if (q) {
    sql += " AND (t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\' OR t.meeting_point LIKE ? ESCAPE '\\')";
    const like = likeValue(q);
    params.push(like, like, like);
  }
  sql += ' ORDER BY t.starts_at ASC LIMIT 60';

  const tours = [];
  for (const row of ctx.db.all(sql, params)) {
    const tour = tourView(ctx.db, row.id, viewer ? viewer.id : null);
    if (tour) tours.push(tour);
  }
  return { tours };
}

export async function detail(ctx) {
  const viewer = currentUser(ctx);
  const tour = tourView(ctx.db, ctx.params.id, viewer ? viewer.id : null);
  if (!tour) throw AppError.notFound('Tour not found.');
  return tour;
}

export async function create(ctx) {
  const auth = requireUser(ctx);
  const body = ctx.body;

  const title = String(body.title ?? '').trim();
  if (charLen(title) < 4 || charLen(title) > 80) throw AppError.bad('Tour title must be 4–80 characters.');
  const description = String(body.description ?? '').trim();
  if (charLen(description) < 20 || charLen(description) > 1200) {
    throw AppError.bad('Describe the tour in 20–1200 characters.');
  }
  const meeting = String(body.meeting_point ?? '').trim();
  if (charLen(meeting) < 3 || charLen(meeting) > 140) throw AppError.bad('Meeting point must be 3–140 characters.');

  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!validCoords(lat, lng)) throw AppError.bad('The meeting point must be inside Addis Ababa.');

  const duration = Number(body.duration_min);
  if (!Number.isInteger(duration) || duration < 30 || duration > 720) {
    throw AppError.bad('Tour length must be between 30 minutes and 12 hours.');
  }
  const capacity = Number(body.capacity);
  if (!Number.isInteger(capacity) || capacity < 2 || capacity > 30) {
    throw AppError.bad('Group size must be between 2 and 30 people.');
  }
  const price = Number(body.price);
  if (!Number.isInteger(price) || price < 0 || price > 100000) {
    throw AppError.bad('Price must be between 0 and 100,000 ETB.');
  }

  let startsAt;
  try {
    startsAt = parseScheduled(body.starts_at, 90);
  } catch (error) {
    throw AppError.bad(error.message);
  }

  const theme = String(body.theme ?? 'entoto').trim().toLowerCase() || 'entoto';
  if (!THEMES.includes(theme)) throw AppError.bad('Please choose a valid tour theme.');
  const imageUrl = String(body.image_url ?? '').trim().slice(0, 500);

  const host = publicUser(ctx.db, auth.id);
  if (!host) throw AppError.notFound('Account not found.');
  if (host.role === 'driver') throw AppError.forbidden('Switch to a rider account to host a city tour.');

  const upcoming = ctx.db.get(
    "SELECT COUNT(*) AS n FROM tours WHERE host_id = ? AND status = 'upcoming' AND starts_at > ?",
    [auth.id, nowIso()],
  );
  if (Number(upcoming.n) >= 6) {
    throw AppError.conflict('You already have 6 upcoming tours. Finish or cancel one first.');
  }

  const tourId = ctx.db.tx(() => {
    const created = ctx.db.run(
      `INSERT INTO tours (host_id, title, description, meeting_point, lat, lng, starts_at, duration_min,
          capacity, price, theme, image_url, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'upcoming', ?)`,
      [auth.id, title, description, meeting, lat, lng, startsAt, duration, capacity, price, theme, imageUrl, nowIso()],
    );
    ctx.db.run('INSERT INTO tour_members (tour_id, user_id, joined_at) VALUES (?, ?, ?)', [
      created.lastInsertRowid,
      auth.id,
      nowIso(),
    ]);
    return created.lastInsertRowid;
  });

  const tour = tourView(ctx.db, tourId, auth.id);
  if (!tour) throw AppError.internal('Tour was created but could not be loaded.');
  return tour;
}

export async function join(ctx) {
  const auth = requireUser(ctx);
  const tour = tourView(ctx.db, ctx.params.id, auth.id);
  if (!tour) throw AppError.notFound('Tour not found.');
  if (tour.status !== 'upcoming') throw AppError.conflict('This tour is no longer open for joining.');
  if (startsInPast(tour.starts_at)) throw AppError.conflict('This tour has already started.');
  if (tour.is_member) return tour;
  if (tour.member_count >= tour.capacity) throw AppError.conflict('This tour is full. Try another date or host.');
  if (tour.is_host) throw AppError.conflict('You are hosting this tour.');

  const inserted = ctx.db.run(
    'INSERT OR IGNORE INTO tour_members (tour_id, user_id, joined_at) VALUES (?, ?, ?)',
    [tour.id, auth.id, nowIso()],
  );
  if (inserted.changes > 0) {
    const name = userName(ctx.db, auth.id);
    notify(ctx.db, tour.host.id, 'tour', 'New tour member', `${name} joined ${tour.title}.`, `#/tour/${tour.id}`);
    const memberRow = ctx.db.get('SELECT email, name FROM users WHERE id = ?', [auth.id]);
    if (memberRow && memberRow.email) {
      sendTourConfirmationEmail(ctx.db, tour, memberRow).catch(() => {});
    }
  }
  const updated = tourView(ctx.db, tour.id, auth.id);
  if (!updated) throw AppError.notFound('Tour not found.');
  return updated;
}

function userName(db, userId) {
  const row = db.get('SELECT name FROM users WHERE id = ?', [userId]);
  return row ? row.name : 'A new traveller';
}

export async function leave(ctx) {
  const auth = requireUser(ctx);
  const tour = tourView(ctx.db, ctx.params.id, auth.id);
  if (!tour) throw AppError.notFound('Tour not found.');
  if (tour.is_host) throw AppError.conflict('Hosts cannot leave their own tour. Cancel the tour instead.');
  if (!tour.is_member) return tour;
  if (startsInPast(tour.starts_at)) throw AppError.conflict('This tour has already started.');

  ctx.db.run('DELETE FROM tour_members WHERE tour_id = ? AND user_id = ?', [tour.id, auth.id]);
  const updated = tourView(ctx.db, tour.id, auth.id);
  if (!updated) throw AppError.notFound('Tour not found.');
  return updated;
}

export async function cancel(ctx) {
  const auth = requireUser(ctx);
  const tour = tourView(ctx.db, ctx.params.id, auth.id);
  if (!tour) throw AppError.notFound('Tour not found.');
  if (auth.role !== 'admin' && tour.host.id !== auth.id) {
    throw AppError.forbidden('Only the host can cancel this tour.');
  }
  if (tour.status !== 'upcoming') throw AppError.conflict('This tour is already closed.');

  ctx.db.run("UPDATE tours SET status = 'cancelled' WHERE id = ?", [tour.id]);
  const members = ctx.db.all('SELECT user_id FROM tour_members WHERE tour_id = ?', [tour.id]);
  for (const member of members) {
    if (member.user_id === auth.id) continue;
    notify(
      ctx.db,
      member.user_id,
      'tour',
      'Tour cancelled',
      `${tour.title} was cancelled. Any planned ride is unaffected.`,
      `#/tour/${tour.id}`,
    );
  }
  const updated = tourView(ctx.db, tour.id, auth.id);
  if (!updated) throw AppError.notFound('Tour not found.');
  return updated;
}

export async function messagesGet(ctx) {
  const auth = requireUser(ctx);
  const tour = tourView(ctx.db, ctx.params.id, auth.id);
  if (!tour) throw AppError.notFound('Tour not found.');
  if (!tour.is_member && auth.role !== 'admin') {
    throw AppError.forbidden('Join the tour to read the group chat.');
  }
  return { messages: tourChatMessages(ctx.db, tour.id, auth.id) };
}

export async function messagesPost(ctx) {
  const auth = requireUser(ctx);
  if (!ctx.limiter.allow(`chat:${auth.id}`, 20, 60000)) {
    throw AppError.tooMany('You are sending messages too quickly.');
  }
  const body = String(ctx.body.body ?? '').trim();
  if (!body) throw AppError.bad('Write a message first.');
  if (charLen(body) > 2000) throw AppError.bad('Messages must be 2,000 characters or fewer.');

  const tour = tourView(ctx.db, ctx.params.id, auth.id);
  if (!tour) throw AppError.notFound('Tour not found.');
  if (!tour.is_member) throw AppError.forbidden('Join the tour before posting in the group chat.');
  if (tour.status !== 'upcoming') throw AppError.conflict('This tour chat is closed.');

  const created = ctx.db.run(
    "INSERT INTO messages (room_type, room_id, user_id, body, created_at) VALUES ('tour', ?, ?, ?, ?)",
    [tour.id, auth.id, body, nowIso()],
  );
  const senderName = userName(ctx.db, auth.id);
  const snippet = Array.from(body).slice(0, 100).join('');
  const recipientIds = new Set();
  if (tour.host.id !== auth.id) recipientIds.add(tour.host.id);
  for (const m of (tour.members || [])) {
    if (m.id !== auth.id) recipientIds.add(m.id);
  }
  for (const rid of recipientIds) {
    notify(ctx.db, rid, 'chat', `New message in ${tour.title}`, `${senderName}: ${snippet}`, `#/tour/${tour.id}`);
  }
  const user = publicUser(ctx.db, auth.id);
  if (!user) throw AppError.notFound('Account not found.');
  return {
    id: created.lastInsertRowid,
    body,
    created_at: nowIso(),
    user,
    is_own: true,
  };
}

export { splitLanguages };
