import { AppError } from '../lib/errors.js';
import { requireAdmin } from '../lib/context.js';
import { audit, notify, tourView } from '../lib/db.js';
import { listFares, mapFare } from '../lib/pricing.js';
import { charLen, nowIso, validCoords, validEmail } from '../lib/util.js';

const EVENT_CATEGORIES = ['culture', 'music', 'food', 'sport', 'community', 'art', 'other'];
const EVENT_STATUSES = ['draft', 'published', 'cancelled'];
const ROUTE_STATUSES = ['active', 'inactive'];
const VEHICLE_CLASSES = ['e2', 'comfort', 'van'];
const THEMES = ['entoto', 'merkato', 'museum', 'bole', 'custom'];
const TOUR_STATUSES = ['upcoming', 'cancelled', 'completed'];
const SITE_KEYS = [
  'site_name',
  'tagline',
  'support_email',
  'footer_note',
  'announcement',
  'announcement_enabled',
];

/* ------------------------------------------------------------------ */
/* Validation helpers                                                  */
/* ------------------------------------------------------------------ */

function text(value, field, { min = 0, max = 160, required = false } = {}) {
  const out = String(value ?? '').trim();
  const len = charLen(out);
  if (required && len === 0) throw AppError.bad(`${field} is required.`);
  if (len < min || len > max) throw AppError.bad(`${field} must be ${min}–${max} characters.`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(out)) {
    throw AppError.bad(`${field} contains unsupported characters.`);
  }
  return out;
}

function integer(value, field, min, max) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < min || num > max) {
    throw AppError.bad(`${field} must be a whole number between ${min} and ${max}.`);
  }
  return num;
}

function decimal(value, field, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < min || num > max) {
    throw AppError.bad(`${field} must be between ${min} and ${max}.`);
  }
  return Math.round(num * 100) / 100;
}

function isoDate(value, field) {
  const raw = String(value ?? '').trim();
  if (!raw) throw AppError.bad(`${field} is required.`);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw AppError.bad(`${field} must be a valid date and time.`);
  return parsed.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function optionalIsoDate(value, field) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  return isoDate(raw, field);
}

function boundedCoords(lat, lng, field) {
  if (lat === null || lat === undefined || lat === '' || lng === null || lng === undefined || lng === '') {
    return { lat: null, lng: null };
  }
  const nLat = Number(lat);
  const nLng = Number(lng);
  if (!validCoords(nLat, nLng)) throw AppError.bad(`${field} must be inside Addis Ababa.`);
  return { lat: nLat, lng: nLng };
}

function oneOf(value, field, allowed, fallback) {
  const out = String(value ?? fallback ?? '').trim().toLowerCase();
  if (!allowed.includes(out)) throw AppError.bad(`Please choose a valid ${field}.`);
  return out;
}

/* ------------------------------------------------------------------ */
/* Fares                                                               */
/* ------------------------------------------------------------------ */

export async function publicFares(ctx) {
  return { fares: listFares(ctx.db, { activeOnly: true }) };
}

export async function fares(ctx) {
  requireAdmin(ctx);
  return { fares: listFares(ctx.db) };
}

export async function updateFare(ctx) {
  const auth = requireAdmin(ctx);
  const key = String(ctx.params.key ?? '').trim().toLowerCase();
  if (!VEHICLE_CLASSES.includes(key)) throw AppError.notFound('Ride class not found.');
  const found = ctx.db.get('SELECT * FROM fare_classes WHERE key = ?', [key]);
  if (!found) throw AppError.notFound('Ride class not found.');

  const body = ctx.body;
  const base = integer(body.base ?? found.base, 'Base fare', 0, 5000);
  const perKm = decimal(body.per_km ?? found.per_km, 'Per-kilometre rate', 0, 500);
  const perMin = decimal(body.per_min ?? found.per_min, 'Per-minute rate', 0, 500);
  const minimum = integer(body.minimum ?? found.minimum, 'Minimum fare', 0, 100000);
  const seats = body.seats === undefined ? undefined : integer(body.seats, 'Seats', 1, 12);
  const isActive = body.is_active === undefined ? Boolean(found.is_active) : Boolean(body.is_active);

  ctx.db.run(
    `UPDATE fare_classes SET base = ?, per_km = ?, per_min = ?, minimum = ?,
        seats = COALESCE(?, seats), is_active = ?, updated_at = ? WHERE key = ?`,
    [base, perKm, perMin, minimum, seats ?? null, isActive ? 1 : 0, nowIso(), key],
  );
  audit(ctx.db, auth.id, 'fares.updated', `${found.label} fare updated (base ${base}, ${perKm}/km, ${perMin}/min, min ${minimum})`);
  const row = ctx.db.get(
    'SELECT key, label, base, per_km, per_min, minimum, seats, is_active, updated_at FROM fare_classes WHERE key = ?',
    [key],
  );
  return mapFare(row);
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

function mapEvent(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? '',
    venue: row.venue ?? '',
    lat: row.lat,
    lng: row.lng,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    category: row.category,
    price: Number(row.price ?? 0),
    image_url: row.image_url ?? '',
    status: row.status,
    created_at: row.created_at,
  };
}

function readEvent(body) {
  const startsAt = isoDate(body.starts_at, 'Start time');
  const endsAt = optionalIsoDate(body.ends_at, 'End time');
  if (endsAt && endsAt <= startsAt) throw AppError.bad('The event must end after it starts.');
  const price = integer(body.price ?? 0, 'Ticket price', 0, 100000);
  const coords = boundedCoords(body.lat, body.lng, 'Event location');
  return {
    title: text(body.title, 'Event title', { min: 3, max: 120, required: true }),
    description: text(body.description, 'Description', { min: 0, max: 1200 }),
    venue: text(body.venue, 'Venue', { min: 0, max: 160 }),
    lat: coords.lat,
    lng: coords.lng,
    starts_at: startsAt,
    ends_at: endsAt,
    category: oneOf(body.category, 'category', EVENT_CATEGORIES, 'culture'),
    price,
    image_url: String(body.image_url ?? '').trim().slice(0, 500),
    status: oneOf(body.status, 'status', EVENT_STATUSES, 'published'),
  };
}

export async function publicEvents(ctx) {
  const rows = ctx.db.all(
    "SELECT * FROM events WHERE status = 'published' ORDER BY starts_at ASC LIMIT 50",
  );
  return { events: rows.map(mapEvent) };
}

export async function events(ctx) {
  requireAdmin(ctx);
  return { events: ctx.db.all('SELECT * FROM events ORDER BY starts_at DESC LIMIT 200').map(mapEvent) };
}

export async function createEvent(ctx) {
  const auth = requireAdmin(ctx);
  const event = readEvent(ctx.body);
  const created = ctx.db.run(
    `INSERT INTO events (title, description, venue, lat, lng, starts_at, ends_at, category, price, image_url, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [event.title, event.description, event.venue, event.lat, event.lng, event.starts_at, event.ends_at,
      event.category, event.price, event.image_url, event.status, nowIso()],
  );
  audit(ctx.db, auth.id, 'events.created', `Event #${created.lastInsertRowid} “${event.title}” created`);
  const row = ctx.db.get('SELECT * FROM events WHERE id = ?', [created.lastInsertRowid]);
  return mapEvent(row);
}

export async function updateEvent(ctx) {
  const auth = requireAdmin(ctx);
  const found = ctx.db.get('SELECT * FROM events WHERE id = ?', [ctx.params.id]);
  if (!found) throw AppError.notFound('Event not found.');
  const event = readEvent({ ...mapEvent(found), ...ctx.body });
  ctx.db.run(
    `UPDATE events SET title = ?, description = ?, venue = ?, lat = ?, lng = ?, starts_at = ?, ends_at = ?,
        category = ?, price = ?, image_url = ?, status = ? WHERE id = ?`,
    [event.title, event.description, event.venue, event.lat, event.lng, event.starts_at, event.ends_at,
      event.category, event.price, event.image_url, event.status, ctx.params.id],
  );
  audit(ctx.db, auth.id, 'events.updated', `Event #${ctx.params.id} “${event.title}” updated`);
  const row = ctx.db.get('SELECT * FROM events WHERE id = ?', [ctx.params.id]);
  return mapEvent(row);
}

export async function deleteEvent(ctx) {
  const auth = requireAdmin(ctx);
  const found = ctx.db.get('SELECT id, title FROM events WHERE id = ?', [ctx.params.id]);
  if (!found) throw AppError.notFound('Event not found.');
  ctx.db.run('DELETE FROM events WHERE id = ?', [ctx.params.id]);
  audit(ctx.db, auth.id, 'events.deleted', `Event #${ctx.params.id} “${found.title}” deleted`);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Curated city routes                                                 */
/* ------------------------------------------------------------------ */

function mapRoute(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    start_point: row.start_point,
    end_point: row.end_point,
    distance_km: Number(row.distance_km ?? 0),
    duration_min: Number(row.duration_min ?? 0),
    vehicle_class: row.vehicle_class,
    fare: Number(row.fare ?? 0),
    status: row.status,
    created_at: row.created_at,
  };
}

function readRoute(body) {
  return {
    name: text(body.name, 'Route name', { min: 3, max: 100, required: true }),
    description: text(body.description, 'Description', { min: 0, max: 800 }),
    start_point: text(body.start_point, 'Start point', { min: 2, max: 140, required: true }),
    end_point: text(body.end_point, 'End point', { min: 2, max: 140, required: true }),
    distance_km: decimal(body.distance_km ?? 0, 'Distance', 0, 120),
    duration_min: integer(body.duration_min ?? 0, 'Duration', 0, 720),
    vehicle_class: oneOf(body.vehicle_class, 'ride class', VEHICLE_CLASSES, 'e2'),
    fare: integer(body.fare ?? 0, 'Suggested fare', 0, 100000),
    status: oneOf(body.status, 'status', ROUTE_STATUSES, 'active'),
  };
}

export async function publicRoutes(ctx) {
  const rows = ctx.db.all("SELECT * FROM city_routes WHERE status = 'active' ORDER BY created_at DESC LIMIT 50");
  return { routes: rows.map(mapRoute) };
}

export async function routes(ctx) {
  requireAdmin(ctx);
  return { routes: ctx.db.all('SELECT * FROM city_routes ORDER BY created_at DESC LIMIT 200').map(mapRoute) };
}

export async function createRoute(ctx) {
  const auth = requireAdmin(ctx);
  const route = readRoute(ctx.body);
  const created = ctx.db.run(
    `INSERT INTO city_routes (name, description, start_point, end_point, distance_km, duration_min,
        vehicle_class, fare, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [route.name, route.description, route.start_point, route.end_point, route.distance_km,
      route.duration_min, route.vehicle_class, route.fare, route.status, nowIso()],
  );
  audit(ctx.db, auth.id, 'routes.created', `Route #${created.lastInsertRowid} “${route.name}” created`);
  const row = ctx.db.get('SELECT * FROM city_routes WHERE id = ?', [created.lastInsertRowid]);
  return mapRoute(row);
}

export async function updateRoute(ctx) {
  const auth = requireAdmin(ctx);
  const found = ctx.db.get('SELECT * FROM city_routes WHERE id = ?', [ctx.params.id]);
  if (!found) throw AppError.notFound('Route not found.');
  const route = readRoute({ ...mapRoute(found), ...ctx.body });
  ctx.db.run(
    `UPDATE city_routes SET name = ?, description = ?, start_point = ?, end_point = ?, distance_km = ?,
        duration_min = ?, vehicle_class = ?, fare = ?, status = ? WHERE id = ?`,
    [route.name, route.description, route.start_point, route.end_point, route.distance_km,
      route.duration_min, route.vehicle_class, route.fare, route.status, ctx.params.id],
  );
  audit(ctx.db, auth.id, 'routes.updated', `Route #${ctx.params.id} “${route.name}” updated`);
  const row = ctx.db.get('SELECT * FROM city_routes WHERE id = ?', [ctx.params.id]);
  return mapRoute(row);
}

export async function deleteRoute(ctx) {
  const auth = requireAdmin(ctx);
  const found = ctx.db.get('SELECT id, name FROM city_routes WHERE id = ?', [ctx.params.id]);
  if (!found) throw AppError.notFound('Route not found.');
  ctx.db.run('DELETE FROM city_routes WHERE id = ?', [ctx.params.id]);
  audit(ctx.db, auth.id, 'routes.deleted', `Route #${ctx.params.id} “${found.name}” deleted`);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Website settings (CRM)                                              */
/* ------------------------------------------------------------------ */

const SITE_DEFAULTS = {
  site_name: 'AddisGo',
  tagline: 'Move through Addis like a local',
  support_email: 'support@addisgo.et',
  footer_note: 'Electric city rides, trusted local guides and small-group tours across Addis Ababa.',
  announcement: '',
  announcement_enabled: '0',
};

function readSite(db) {
  const out = { ...SITE_DEFAULTS };
  for (const row of db.all('SELECT key, value FROM meta')) {
    if (!SITE_KEYS.includes(row.key)) continue;
    out[row.key] = row.value;
  }
  return {
    site_name: out.site_name,
    tagline: out.tagline,
    support_email: out.support_email,
    footer_note: out.footer_note,
    announcement: out.announcement,
    announcement_enabled: out.announcement_enabled === '1',
  };
}

export async function publicSite(ctx) {
  return readSite(ctx.db);
}

export async function getSite(ctx) {
  requireAdmin(ctx);
  return readSite(ctx.db);
}

export async function updateSite(ctx) {
  const auth = requireAdmin(ctx);
  const body = ctx.body;
  const next = {
    site_name: text(body.site_name, 'Site name', { min: 2, max: 60, required: true }),
    tagline: text(body.tagline, 'Tagline', { min: 2, max: 140, required: true }),
    support_email: text(body.support_email, 'Support email', { min: 3, max: 120, required: true }).toLowerCase(),
    footer_note: text(body.footer_note, 'Footer note', { min: 0, max: 300 }),
    announcement: text(body.announcement, 'Announcement', { min: 0, max: 240 }),
    announcement_enabled: body.announcement_enabled ? '1' : '0',
  };
  if (!validEmail(next.support_email)) throw AppError.bad('Support email must be a valid address.');

  for (const [key, value] of Object.entries(next)) {
    ctx.db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
  }
  audit(ctx.db, auth.id, 'site.updated', `Website settings updated for ${next.site_name}`);
  return readSite(ctx.db);
}

/* ------------------------------------------------------------------ */
/* Tours (admin CRUD)                                                  */
/* ------------------------------------------------------------------ */

function readTour(body) {
  const startsAt = isoDate(body.starts_at, 'Start time');
  const theme = oneOf(body.theme, 'tour theme', THEMES, 'entoto');
  return {
    title: text(body.title, 'Tour title', { min: 4, max: 80, required: true }),
    description: text(body.description, 'Description', { min: 20, max: 1200, required: true }),
    meeting_point: text(body.meeting_point, 'Meeting point', { min: 3, max: 140, required: true }),
    lat: Number(body.lat),
    lng: Number(body.lng),
    starts_at: startsAt,
    duration_min: integer(body.duration_min, 'Tour length', 30, 720),
    capacity: integer(body.capacity, 'Group size', 2, 30),
    price: integer(body.price ?? 0, 'Price', 0, 100000),
    theme,
    image_url: String(body.image_url ?? '').trim().slice(0, 500),
    status: oneOf(body.status, 'status', TOUR_STATUSES, 'upcoming'),
    host_id: body.host_id === undefined || body.host_id === '' ? null : Number(body.host_id),
  };
}

export async function createTourAdmin(ctx) {
  const auth = requireAdmin(ctx);
  const tour = readTour(ctx.body);
  if (!validCoords(tour.lat, tour.lng)) throw AppError.bad('The meeting point must be inside Addis Ababa.');

  let hostId = tour.host_id ?? auth.id;
  const host = ctx.db.get('SELECT id, name, role, status FROM users WHERE id = ?', [hostId]);
  if (!host || host.status !== 'active') throw AppError.bad('Choose an active host account.');
  if (host.role === 'admin') hostId = auth.id;

  const created = ctx.db.run(
    `INSERT INTO tours (host_id, title, description, meeting_point, lat, lng, starts_at, duration_min,
        capacity, price, theme, image_url, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [hostId, tour.title, tour.description, tour.meeting_point, tour.lat, tour.lng, tour.starts_at,
      tour.duration_min, tour.capacity, tour.price, tour.theme, tour.image_url, tour.status, nowIso()],
  );
  audit(ctx.db, auth.id, 'tours.created', `Tour #${created.lastInsertRowid} “${tour.title}” created by admin`);
  const row = tourView(ctx.db, created.lastInsertRowid, auth.id);
  if (!row) throw AppError.internal('Could not create this tour.');
  return row;
}

export async function updateTourAdmin(ctx) {
  const auth = requireAdmin(ctx);
  const found = ctx.db.get('SELECT * FROM tours WHERE id = ?', [ctx.params.id]);
  if (!found) throw AppError.notFound('Tour not found.');
  const tour = readTour({
    title: found.title,
    description: found.description,
    meeting_point: found.meeting_point,
    lat: found.lat,
    lng: found.lng,
    starts_at: found.starts_at,
    duration_min: found.duration_min,
    capacity: found.capacity,
    price: found.price,
    theme: found.theme,
    image_url: found.image_url,
    status: found.status,
    host_id: found.host_id,
    ...ctx.body,
  });
  if (!validCoords(tour.lat, tour.lng)) throw AppError.bad('The meeting point must be inside Addis Ababa.');

  const hostId = tour.host_id ?? null;
  if (hostId) {
    const host = ctx.db.get('SELECT id, status FROM users WHERE id = ?', [hostId]);
    if (!host || host.status !== 'active') throw AppError.bad('Choose an active host account.');
  }

  ctx.db.run(
    `UPDATE tours SET title = ?, description = ?, meeting_point = ?, lat = ?, lng = ?, starts_at = ?,
        duration_min = ?, capacity = ?, price = ?, theme = ?, image_url = ?, status = ?,
        host_id = COALESCE(?, host_id) WHERE id = ?`,
    [tour.title, tour.description, tour.meeting_point, tour.lat, tour.lng, tour.starts_at,
      tour.duration_min, tour.capacity, tour.price, tour.theme, tour.image_url, tour.status, hostId, ctx.params.id],
  );

  if (tour.status === 'cancelled') {
    for (const member of ctx.db.all('SELECT user_id FROM tour_members WHERE tour_id = ?', [ctx.params.id])) {
      notify(ctx.db, member.user_id, 'tour', 'Tour cancelled', `${tour.title} has been cancelled by the AddisGo team.`);
    }
  }
  audit(ctx.db, auth.id, 'tours.updated', `Tour #${ctx.params.id} “${tour.title}” updated by admin`);
  return tourView(ctx.db, ctx.params.id, auth.id);
}

export async function deleteTourAdmin(ctx) {
  const auth = requireAdmin(ctx);
  const found = ctx.db.get('SELECT id, title FROM tours WHERE id = ?', [ctx.params.id]);
  if (!found) throw AppError.notFound('Tour not found.');

  ctx.db.tx(() => {
    ctx.db.run("DELETE FROM messages WHERE room_type = 'tour' AND room_id = ?", [ctx.params.id]);
    ctx.db.run('DELETE FROM tour_members WHERE tour_id = ?', [ctx.params.id]);
    ctx.db.run('DELETE FROM tours WHERE id = ?', [ctx.params.id]);
  });
  audit(ctx.db, auth.id, 'tours.deleted', `Tour #${ctx.params.id} “${found.title}” deleted by admin`);
  return { ok: true };
}
