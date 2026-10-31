import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { AppError } from './errors.js';
import { CLASSES, addisTimeIn, nowIso, splitLanguages } from './util.js';

const API_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SCHEMA_PATH = path.join(API_DIR, 'schema.sql');

export function openDatabase(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  db.exec('PRAGMA journal_mode = WAL;');
  try { db.exec('ALTER TABLE tours ADD COLUMN image_url TEXT NOT NULL DEFAULT ""'); } catch {}
  try { db.exec('ALTER TABLE events ADD COLUMN image_url TEXT NOT NULL DEFAULT ""'); } catch {}
  const wrapped = new Db(db);
  ensureCmsDefaults(wrapped);
  return wrapped;
}

/** Seed the fare table and sample CMS content once per database. */
function ensureCmsDefaults(db) {
  const at = nowIso();
  for (const fare of CLASSES) {
    db.run(
      `INSERT OR IGNORE INTO fare_classes (key, label, base, per_km, per_min, minimum, seats, is_active, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [fare.key, fare.label, fare.base, fare.perKm, fare.perMin, fare.minimum, fare.seats, at],
    );
  }

  const defaults = {
    site_name: 'AddisGo',
    tagline: 'Move through Addis like a local',
    support_email: 'support@addisgo.et',
    footer_note: 'Electric city rides, trusted local guides and small-group tours across Addis Ababa.',
    announcement: '',
    announcement_enabled: '0',
  };
  for (const [key, value] of Object.entries(defaults)) {
    db.run('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)', [key, value]);
  }

  if (Number(db.get('SELECT COUNT(*) AS n FROM events').n) === 0) {
    const rows = [
      ['Addis Jazz Nights at Ghion', 'An evening of Ethiopian jazz, Azmari strings and a rooftop view over the city.', 'Ghion Hotel, Ras Desta Damtew Ave', 9.012, 38.762, 3, 19, 0, 'music', 450],
      ['Merkato Food Walk', 'A guided tasting through the spice alleys, injera kitchens and coffee stalls of Africa\'s largest market.', 'Merkato main gate', 9.035, 38.733, 6, 9, 30, 'food', 900],
      ['Entoto Sunrise Hike', 'A gentle group climb through eucalyptus forest, ending with coffee at the Entoto viewpoint.', 'Entoto Natural Park gate', 9.07, 38.765, 2, 5, 30, 'sport', 0],
      ['Bole Art & Design Market', 'Independent makers, ceramics, textiles and live screen printing at a relaxed Saturday market.', 'Bole Medhanialem square', 8.995, 38.787, 9, 10, 0, 'art', 200],
    ];
    for (const [title, description, venue, lat, lng, days, hour, minute, category, price] of rows) {
      db.run(
        `INSERT INTO events (title, description, venue, lat, lng, starts_at, category, price, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'published', ?)`,
        [title, description, venue, lat, lng, addisTimeIn(days, hour, minute), category, price, at],
      );
    }
  }

  if (Number(db.get('SELECT COUNT(*) AS n FROM city_routes').n) === 0) {
    const rows = [
      ['Airport run', 'Fixed-fare transfer between Bole International Airport and the city centre.', 'Bole International Airport', 'Bole Medhanialem', 6.4, 24, 'e2', 280, 'active'],
      ['City centre loop', 'Piassa, Churchill Avenue and Meskel Square on one quiet electric loop.', 'Piassa / Churchill Avenue', 'Meskel Square', 5.1, 20, 'e2', 220, 'active'],
      ['Sunset to Entoto', 'A scenic uphill ride to Entoto Natural Park for the golden hour.', 'Bole Medhanialem', 'Entoto Natural Park', 12.8, 38, 'comfort', 480, 'active'],
      ['Cross-town express', 'Kazanchis to Megenagna along the Ring Road — the fastest way across town.', 'Kazanchis / ECA Road', 'Megenagna / Ring Road', 9.6, 32, 'van', 520, 'active'],
    ];
    for (const [name, description, startPoint, endPoint, distance, duration, vehicleClass, fare, status] of rows) {
      db.run(
        `INSERT INTO city_routes (name, description, start_point, end_point, distance_km, duration_min,
            vehicle_class, fare, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, description, startPoint, endPoint, distance, duration, vehicleClass, fare, status, at],
      );
    }
  }
}

/** Thin wrapper: prepared-statement cache + helpers + transactions. */
export class Db {
  constructor(raw) {
    this.raw = raw;
    this.cache = new Map();
  }

  stmt(sql) {
    let prepared = this.cache.get(sql);
    if (!prepared) {
      prepared = this.raw.prepare(sql);
      this.cache.set(sql, prepared);
    }
    return prepared;
  }

  all(sql, params = []) {
    return this.stmt(sql).all(...params);
  }

  get(sql, params = []) {
    return this.stmt(sql).get(...params) ?? null;
  }

  run(sql, params = []) {
    const result = this.stmt(sql).run(...params);
    return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
  }

  exec(sql) {
    this.raw.exec(sql);
  }

  tx(fn) {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.raw.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.raw.exec('ROLLBACK');
      } catch {
        /* connection already rolled back */
      }
      throw error;
    }
  }

  close() {
    this.cache.clear();
    this.raw.close();
  }
}

export function mapPublic(row, prefix = '') {
  const p = prefix ? `${prefix}_` : '';
  const languages = row[`${p}languages`];
  return {
    id: row[`${p}id`],
    name: row[`${p}name`],
    role: row[`${p}role`],
    bio: row[`${p}bio`] ?? '',
    languages: splitLanguages(languages),
    avatar_color: row[`${p}avatar_color`] ?? '#145c45',
    is_verified: Boolean(row[`${p}is_verified`]),
  };
}

export function mapDriver(row, prefix = 'drv') {
  const p = `${prefix}_`;
  return {
    id: row[`${p}id`],
    user_id: row[`${p}user_id`],
    vehicle_class: row[`${p}class`],
    make_model: row[`${p}model`],
    plate: row[`${p}plate`],
    color: row[`${p}color`] ?? '',
    license_no: row[`${p}license`],
    status: row[`${p}status`],
    is_online: Boolean(row[`${p}online`]),
    lat: row[`${p}lat`],
    lng: row[`${p}lng`],
    rating: Number(row[`${p}rating`] ?? 5),
    rating_count: Number(row[`${p}rating_count`] ?? 0),
    trips: Number(row[`${p}trips`] ?? 0),
    created_at: row[`${p}created_at`],
    approved_at: row[`${p}approved_at`],
  };
}

export const BOOKING_SELECT = `SELECT
  b.id AS id, b.code AS code, b.status AS status,
  b.pickup AS pickup, b.pickup_lat AS pickup_lat, b.pickup_lng AS pickup_lng,
  b.dropoff AS dropoff, b.dropoff_lat AS dropoff_lat, b.dropoff_lng AS dropoff_lng,
  b.vehicle_class AS vehicle_class, b.distance_km AS distance_km, b.duration_min AS duration_min,
  b.fare AS fare, b.scheduled_for AS scheduled_for, b.notes AS notes,
  b.rating AS rating, b.review AS review,
  b.created_at AS created_at, b.accepted_at AS accepted_at, b.started_at AS started_at,
  b.completed_at AS completed_at, b.cancelled_at AS cancelled_at,
  cu.id AS cust_id, cu.name AS cust_name, cu.role AS cust_role, cu.bio AS cust_bio,
  cu.languages AS cust_languages, cu.avatar_color AS cust_avatar, cu.is_verified AS cust_verified,
  cu.phone AS cust_phone,
  d.id AS drv_id, d.user_id AS drv_user_id, du.name AS drv_name, du.avatar_color AS drv_avatar,
  d.rating AS drv_rating, d.rating_count AS drv_rating_count, d.trips AS drv_trips,
  d.vehicle_class AS drv_class, d.make_model AS drv_model, d.plate AS drv_plate,
  d.color AS drv_color, d.is_online AS drv_online, d.lat AS drv_lat, d.lng AS drv_lng,
  du.phone AS drv_phone
 FROM bookings b
 JOIN users cu ON cu.id = b.customer_id
 LEFT JOIN drivers d ON d.id = b.driver_id
 LEFT JOIN users du ON du.id = d.user_id`;

export function mapBooking(row) {
  const driver = row.drv_id
    ? {
        id: row.drv_id,
        user_id: row.drv_user_id,
        name: row.drv_name,
        avatar_color: row.drv_avatar ?? '#145c45',
        rating: Number(row.drv_rating ?? 5),
        rating_count: Number(row.drv_rating_count ?? 0),
        trips: Number(row.drv_trips ?? 0),
        vehicle_class: row.drv_class,
        make_model: row.drv_model,
        plate: row.drv_plate,
        color: row.drv_color ?? '',
        is_online: Boolean(row.drv_online),
        lat: row.drv_lat,
        lng: row.drv_lng,
      }
    : null;

  return {
    id: row.id,
    code: row.code,
    status: row.status,
    pickup: row.pickup,
    pickup_lat: row.pickup_lat,
    pickup_lng: row.pickup_lng,
    dropoff: row.dropoff,
    dropoff_lat: row.dropoff_lat,
    dropoff_lng: row.dropoff_lng,
    vehicle_class: row.vehicle_class,
    distance_km: row.distance_km,
    duration_min: row.duration_min,
    fare: row.fare,
    scheduled_for: row.scheduled_for,
    notes: row.notes ?? '',
    rating: row.rating,
    review: row.review ?? '',
    created_at: row.created_at,
    accepted_at: row.accepted_at,
    started_at: row.started_at,
    completed_at: row.completed_at,
    cancelled_at: row.cancelled_at,
    customer: mapPublic(row, 'cust'),
    customer_phone: row.cust_phone,
    driver,
    driver_phone: row.drv_phone,
  };
}

export const DRIVER_COLUMNS = `id, user_id, vehicle_class, make_model, plate, color, license_no, status,
  is_online, lat, lng, rating, rating_count, trips, created_at, approved_at`;

export function mapDriverRow(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    vehicle_class: row.vehicle_class,
    make_model: row.make_model,
    plate: row.plate,
    color: row.color ?? '',
    license_no: row.license_no,
    status: row.status,
    is_online: Boolean(row.is_online),
    lat: row.lat,
    lng: row.lng,
    rating: Number(row.rating ?? 5),
    rating_count: Number(row.rating_count ?? 0),
    trips: Number(row.trips ?? 0),
    created_at: row.created_at,
    approved_at: row.approved_at,
  };
}

export function getDriver(db, id) {
  const row = db.get(`SELECT ${DRIVER_COLUMNS} FROM drivers WHERE id = ?`, [id]);
  return row ? mapDriverRow(row) : null;
}

export function driverForUser(db, userId) {
  const row = db.get(`SELECT ${DRIVER_COLUMNS} FROM drivers WHERE user_id = ?`, [userId]);
  return row ? mapDriverRow(row) : null;
}

export function getBooking(db, id) {
  const row = db.get(`${BOOKING_SELECT} WHERE b.id = ?`, [id]);
  return row ? mapBooking(row) : null;
}

export function bookingByCode(db, code) {
  const row = db.get(`${BOOKING_SELECT} WHERE b.code = ?`, [code]);
  return row ? mapBooking(row) : null;
}

export const TOUR_SELECT = `SELECT
  t.id AS id, t.title AS title, t.description AS description, t.meeting_point AS meeting_point,
  t.lat AS lat, t.lng AS lng, t.starts_at AS starts_at, t.duration_min AS duration_min,
  t.capacity AS capacity, t.price AS price, t.theme AS theme, t.status AS status,
  COALESCE(t.image_url, '') AS image_url,
  t.created_at AS created_at,
  u.id AS host_id, u.name AS host_name, u.role AS host_role, u.bio AS host_bio,
  u.languages AS host_languages, u.avatar_color AS host_avatar, u.is_verified AS host_verified
 FROM tours t JOIN users u ON u.id = t.host_id`;

const MEMBER_SELECT = `SELECT u.id AS id, u.name AS name, u.role AS role, u.bio AS bio,
  u.languages AS languages, u.avatar_color AS avatar_color, u.is_verified AS is_verified
 FROM tour_members m JOIN users u ON u.id = m.user_id
 WHERE m.tour_id = ? ORDER BY m.joined_at ASC, m.id ASC`;

export function tourView(db, tourId, viewerId = null) {
  const row = db.get(`${TOUR_SELECT} WHERE t.id = ?`, [tourId]);
  if (!row) return null;
  const members = db.all(MEMBER_SELECT, [tourId]).map((m) => mapPublic(m));
  const capacity = Number(row.capacity);
  const host = mapPublic(row, 'host');
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    meeting_point: row.meeting_point,
    lat: row.lat,
    lng: row.lng,
    starts_at: row.starts_at,
    duration_min: row.duration_min,
    capacity,
    price: row.price,
    theme: row.theme,
    image_url: row.image_url ?? '',
    status: row.status,
    created_at: row.created_at,
    host,
    member_count: members.length,
    spots_left: Math.max(capacity - members.length, 0),
    is_member: viewerId != null && members.some((m) => m.id === viewerId),
    is_host: viewerId != null && host.id === viewerId,
    members,
  };
}

export function isTourMember(db, tourId, userId) {
  const row = db.get('SELECT COUNT(*) AS n FROM tour_members WHERE tour_id = ? AND user_id = ?', [tourId, userId]);
  return Number(row.n) > 0;
}

const MESSAGE_SELECT = `SELECT m.id AS id, m.body AS body, m.created_at AS created_at,
  u.id AS uid, u.name AS uname, u.role AS urole, u.bio AS ubio, u.languages AS ulanguages,
  u.avatar_color AS uavatar, u.is_verified AS uverified
 FROM messages m JOIN users u ON u.id = m.user_id`;

function mapMessage(row, viewerId) {
  return {
    id: row.id,
    body: row.body,
    created_at: row.created_at,
    user: {
      id: row.uid,
      name: row.uname,
      role: row.urole,
      bio: row.ubio ?? '',
      languages: splitLanguages(row.ulanguages),
      avatar_color: row.uavatar ?? '#145c45',
      is_verified: Boolean(row.uverified),
    },
    is_own: row.uid === viewerId,
  };
}

export function tourChatMessages(db, tourId, viewerId) {
  const rows = db.all(
    `${MESSAGE_SELECT} WHERE m.room_type = 'tour' AND m.room_id = ? ORDER BY m.id ASC LIMIT 200`,
    [tourId],
  );
  return rows.map((row) => mapMessage(row, viewerId));
}

export function rideChatMessages(db, bookingId, viewerId) {
  const rows = db.all(
    `${MESSAGE_SELECT} WHERE m.room_type = 'ride' AND m.room_id = ? ORDER BY m.id ASC LIMIT 200`,
    [bookingId],
  );
  return rows.map((row) => mapMessage(row, viewerId));
}

export function messageById(db, id, viewerId) {
  const row = db.get(`${MESSAGE_SELECT} WHERE m.id = ?`, [id]);
  return row ? mapMessage(row, viewerId) : null;
}

export function publicUser(db, userId) {
  const row = db.get(
    `SELECT u.id AS id, u.name AS name, u.role AS role, u.bio AS bio, u.languages AS languages,
            u.avatar_color AS avatar_color, u.is_verified AS is_verified
     FROM users u WHERE u.id = ?`,
    [userId],
  );
  return row ? mapPublic(row) : null;
}

export function getSelfUser(db, userId) {
  const row = db.get(
    `SELECT id, name, email, phone, role, bio, languages, avatar_color, is_verified, status, created_at
     FROM users WHERE id = ?`,
    [userId],
  );
  if (!row) throw AppError.notFound('Account not found.');
  const user = {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    bio: row.bio ?? '',
    languages: splitLanguages(row.languages),
    avatar_color: row.avatar_color,
    is_verified: Boolean(row.is_verified),
    status: row.status,
    created_at: row.created_at,
    driver: null,
  };
  if (user.role === 'driver') user.driver = driverForUser(db, userId);
  return user;
}

export function notify(db, userId, kind, title, body) {
  db.run(
    'INSERT INTO notifications (user_id, kind, title, body, created_at) VALUES (?, ?, ?, ?, ?)',
    [userId, kind, title, body, nowIso()],
  );
}

export function notifications(db, userId) {
  return db
    .all(
      `SELECT id, kind, title, body, is_read, created_at FROM notifications
       WHERE user_id = ? ORDER BY id DESC LIMIT 50`,
      [userId],
    )
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      body: row.body ?? '',
      is_read: Boolean(row.is_read),
      created_at: row.created_at,
    }));
}

export function audit(db, actorId, action, detail) {
  try {
    db.run(
      'INSERT INTO audit_log (actor_id, action, detail, created_at) VALUES (?, ?, ?, ?)',
      [actorId, action, detail, nowIso()],
    );
  } catch (error) {
    console.error('[addisgo] audit write failed:', error.message);
  }
}
