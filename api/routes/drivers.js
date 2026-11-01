import { AppError } from '../lib/errors.js';
import { requireDriver, requireUser } from '../lib/context.js';
import { BOOKING_SELECT, driverForUser, getDriver, getSelfUser, mapBooking } from '../lib/db.js';
import { driverEarnings, getRevenueConfig } from '../lib/revenue.js';
import {
  closeSession,
  closeStaleSessions,
  driverAirtime,
  heartbeat as recordHeartbeat,
  openSession,
} from '../lib/sessions.js';
import {
  classInfo,
  haversineKm,
  isoFrom,
  nowIso,
  round1,
  todayUtc,
  validCoords,
} from '../lib/util.js';

const CLASS_KEYS = ['e2', 'comfort', 'van'];

export async function nearby(ctx) {
  requireUser(ctx);
  const lat = Number(ctx.query.get('lat'));
  const lng = Number(ctx.query.get('lng'));
  const wanted = ctx.query.get('class') || '';
  if (!validCoords(lat, lng)) throw AppError.bad('Please choose a pickup point inside Addis Ababa.');

  const rows = ctx.db.all(
    `SELECT d.id, d.user_id, u.name, u.avatar_color, u.avatar_url, d.rating, d.rating_count, d.trips,
            d.vehicle_class, d.make_model, d.plate, d.color, d.is_online, d.lat, d.lng
     FROM drivers d JOIN users u ON u.id = d.user_id
     WHERE d.status = 'approved' AND d.is_online = 1 AND u.status = 'active'
       AND d.lat IS NOT NULL AND d.lng IS NOT NULL`,
  );

  const drivers = [];
  for (const row of rows) {
    if (wanted && row.vehicle_class !== wanted) continue;
    if (row.lat == null || row.lng == null) continue;
    const distance = haversineKm(lat, lng, row.lat, row.lng);
    if (distance > 40) continue;
    drivers.push({
      id: row.id,
      user_id: row.user_id,
      name: row.name,
      avatar_color: row.avatar_color,
      avatar_url: row.avatar_url ?? '',
      rating: Number(row.rating ?? 5),
      rating_count: Number(row.rating_count ?? 0),
      trips: Number(row.trips ?? 0),
      vehicle_class: row.vehicle_class,
      make_model: row.make_model,
      plate: row.plate,
      color: row.color ?? '',
      is_online: Boolean(row.is_online),
      lat: row.lat,
      lng: row.lng,
      distance_km: round1(distance),
      eta_min: Math.max(Math.round((distance / 24) * 60 + 2), 2),
    });
  }
  drivers.sort((a, b) => a.distance_km - b.distance_km);
  const trimmed = drivers.slice(0, 12);
  return { drivers: trimmed, online_total: trimmed.length };
}

export async function driverMe(ctx) {
  const auth = requireDriver(ctx);
  closeStaleSessions(ctx.db);
  const driver = driverForUser(ctx.db, auth.id);
  if (!driver) throw AppError.notFound('Driver profile not found.');

  const weekAgo = isoFrom(Date.now() - 7 * 86400000);
  const count = (sql, params) => Number(ctx.db.get(sql, params).n ?? 0);

  const earnings = driverEarnings(ctx.db, driver.id);
  const airtime = driverAirtime(ctx.db, driver.id, weekAgo);
  const revenue = getRevenueConfig(ctx.db);

  const activeBookings = count(
    "SELECT COUNT(*) AS n FROM bookings WHERE driver_id = ? AND status IN ('accepted', 'arriving', 'in_progress')",
    [driver.id],
  );
  const requestsAvailable = count(
    "SELECT COUNT(*) AS n FROM bookings WHERE status = 'requested' AND driver_id IS NULL",
    [],
  );

  return {
    driver,
    revenue_model: revenue,
    stats: {
      // Take-home (ledger), not gross fares. Gross is exposed alongside it.
      earnings_today: earnings.earnings_today,
      earnings_week: earnings.earnings_week,
      earnings_total: earnings.earnings_total,
      gross_today: earnings.gross_today,
      gross_week: earnings.gross_week,
      gross_total: earnings.gross_total,
      commission_today: earnings.commission_today,
      commission_week: earnings.commission_week,
      commission_total: earnings.commission_total,
      incentive_today: earnings.incentive_today,
      incentive_week: earnings.incentive_week,
      incentive_total: earnings.incentive_total,
      trips_today: earnings.trips_today,
      trips_total: driver.trips,
      active_bookings: activeBookings,
      requests_available: requestsAvailable,
      // Phase 2 — presence and air-time (rolling 7 days).
      online_minutes_week: airtime.online_minutes,
      busy_minutes_week: airtime.busy_minutes,
      idle_minutes_week: airtime.idle_minutes,
      avg_session_minutes_week: airtime.avg_session_minutes,
      longest_session_minutes_week: airtime.longest_session_minutes,
      sessions_week: airtime.sessions,
      app_closed_week: airtime.app_closed_sessions,
      offline_sessions_week: airtime.offline_sessions,
      online_since: airtime.online_since,
      acceptance_rate: airtime.acceptance_rate,
      offers_week: airtime.offers,
      accepted_offers_week: airtime.accepted_offers,
      declined_offers_week: airtime.declined_offers,
      last_heartbeat: driver.last_heartbeat ?? null,
    },
  };
}

export async function setStatus(ctx) {
  const auth = requireDriver(ctx);
  const driver = driverForUser(ctx.db, auth.id);
  if (!driver) throw AppError.notFound('Driver profile not found.');
  if (driver.status !== 'approved') throw AppError.forbidden('Your driver application is still being reviewed.');

  const online = Boolean(ctx.body.is_online);
  const wantedLat = ctx.body.lat ?? driver.lat;
  const wantedLng = ctx.body.lng ?? driver.lng;
  let lat = wantedLat;
  let lng = wantedLng;

  if (online) {
    if (wantedLat == null || wantedLng == null || !validCoords(Number(wantedLat), Number(wantedLng))) {
      throw AppError.bad('Turn on location to start receiving ride requests.');
    }
    lat = Number(wantedLat);
    lng = Number(wantedLng);
  } else {
    lat = wantedLat == null ? null : Number(wantedLat);
    lng = wantedLng == null ? null : Number(wantedLng);
  }

  const at = nowIso();
  ctx.db.run('UPDATE drivers SET is_online = ?, lat = ?, lng = ?, last_heartbeat = ? WHERE id = ?', [
    online ? 1 : 0,
    lat,
    lng,
    online ? at : null,
    driver.id,
  ]);

  // Keep the session ledger in sync: going online opens (or resumes) a shift,
  // going offline closes it so air-time stops accruing immediately.
  let session = null;
  if (online) {
    session = openSession(ctx.db, driver.id, { lat, lng });
  } else {
    closeSession(ctx.db, driver.id, 'offline');
  }

  return {
    ...getDriver(ctx.db, driver.id),
    session,
    heartbeat_ms: 25_000,
  };
}

/**
 * Presence beat. The driver dashboard posts this on a timer while it is open;
 * dispatch treats a silent phone as offline after two missed beats.
 */
export async function heartbeat(ctx) {
  const auth = requireDriver(ctx);
  const driver = driverForUser(ctx.db, auth.id);
  if (!driver) throw AppError.notFound('Driver profile not found.');
  if (driver.status !== 'approved') throw AppError.forbidden('Your driver application is still being reviewed.');
  if (!driver.is_online) return { online: false, heartbeat_ms: 25_000 };

  const lat = ctx.body.lat == null ? null : Number(ctx.body.lat);
  const lng = ctx.body.lng == null ? null : Number(ctx.body.lng);
  const useCoords = lat != null && lng != null && validCoords(lat, lng);
  const beat = recordHeartbeat(ctx.db, driver.id, useCoords ? { lat, lng } : {});
  return { online: true, ...beat, heartbeat_ms: 25_000 };
}

export async function updateProfile(ctx) {
  const auth = requireDriver(ctx);
  const driver = driverForUser(ctx.db, auth.id);
  if (!driver) throw AppError.notFound('Driver profile not found.');
  if (driver.status === 'suspended') {
    throw AppError.forbidden('Your driver account is suspended. Please contact support.');
  }
  const body = ctx.body;

  let vehicleClass = driver.vehicle_class;
  if (body.vehicle_class !== undefined) {
    const value = String(body.vehicle_class).trim().toLowerCase();
    if (!CLASS_KEYS.includes(value)) throw AppError.bad('Please choose a valid vehicle class.');
    vehicleClass = value;
  }
  let makeModel = driver.make_model;
  if (body.make_model !== undefined) {
    const value = String(body.make_model).trim();
    if (Array.from(value).length < 2 || Array.from(value).length > 60) {
      throw AppError.bad('Vehicle make and model must be 2–60 characters.');
    }
    makeModel = value;
  }
  let plate = driver.plate;
  if (body.plate !== undefined) {
    const value = String(body.plate).trim().toUpperCase();
    if (Array.from(value).length < 2 || Array.from(value).length > 20) {
      throw AppError.bad('Please enter a valid plate number.');
    }
    plate = value;
  }
  let license = driver.license_no;
  if (body.license_no !== undefined) {
    const value = String(body.license_no).trim().toUpperCase();
    if (Array.from(value).length < 3 || Array.from(value).length > 30) {
      throw AppError.bad('Please enter a valid driving licence number.');
    }
    license = value;
  }
  const color = body.color !== undefined
    ? Array.from(String(body.color).trim()).slice(0, 30).join('')
    : driver.color;

  ctx.db.run(
    'UPDATE drivers SET vehicle_class = ?, make_model = ?, plate = ?, color = ?, license_no = ? WHERE id = ?',
    [vehicleClass, makeModel, plate, color, license, driver.id],
  );
  return getSelfUser(ctx.db, auth.id);
}

export async function requests(ctx) {
  const auth = requireDriver(ctx);
  const driver = driverForUser(ctx.db, auth.id);
  if (!driver) throw AppError.notFound('Driver profile not found.');
  if (driver.status !== 'approved') throw AppError.forbidden('Your driver application is still being reviewed.');
  if (!driver.is_online || driver.lat == null || driver.lng == null) {
    return { requests: [], online: false };
  }

  const rows = ctx.db.all(
    `${BOOKING_SELECT} WHERE b.status = 'requested' AND b.driver_id IS NULL ORDER BY b.created_at ASC LIMIT 50`,
  );

  const items = [];
  for (const row of rows) {
    const booking = mapBooking(row);
    const distance = haversineKm(driver.lat, driver.lng, booking.pickup_lat, booking.pickup_lng);
    if (distance > 35) continue;
    // Customer contact details stay private until a driver accepts.
    booking.customer_phone = null;
    booking.driver_phone = null;
    items.push({
      ...booking,
      driver_distance_km: round1(distance),
      pickup_eta_min: Math.max(Math.round((distance / 24) * 60 + 2), 2),
    });
  }
  items.sort((a, b) => {
    const left = a.scheduled_for ?? '';
    const right = b.scheduled_for ?? '';
    if (left !== right) return left < right ? -1 : 1;
    return a.driver_distance_km - b.driver_distance_km;
  });
  return { requests: items, online: true };
}

export async function verify(ctx) {
  const auth = requireDriver(ctx);
  if (!ctx.limiter.allow(`verify:${auth.id}`, 30, 60000)) {
    throw AppError.tooMany('Too many code checks. Please wait a moment.');
  }
  const code = String(ctx.body.code ?? '').trim().toUpperCase();
  if (!code || code.length > 20) {
    throw AppError.bad("Enter the check-in code shown on the rider's QR pass.");
  }
  const driver = driverForUser(ctx.db, auth.id);
  if (!driver) throw AppError.notFound('Driver profile not found.');
  const found = ctx.db.get(`${BOOKING_SELECT} WHERE b.code = ?`, [code]);
  if (!found) {
    throw AppError.notFound('No trip matches that code. Ask the rider to refresh their QR pass.');
  }
  const booking = mapBooking(found);
  if (!booking.driver) throw AppError.conflict('This trip has not been assigned to a driver yet.');
  if (booking.driver.id !== driver.id) throw AppError.forbidden("This pass belongs to another driver's trip.");
  if (booking.status === 'completed') throw AppError.conflict('This trip is already completed.');
  if (booking.status === 'cancelled') throw AppError.conflict('This trip was cancelled.');
  if (booking.status === 'requested') throw AppError.conflict('Accept the trip before checking in the rider.');
  return { valid: true, booking };
}

export { classInfo, nowIso };
