import qrcode from 'qrcode-generator';

import { AppError } from '../lib/errors.js';
import { requireUser } from '../lib/context.js';
import { sendReceiptEmail } from '../lib/email.js';
import {
  BOOKING_SELECT,
  getBooking,
  getSelfUser,
  mapBooking,
  notify,
  rideChatMessages,
} from '../lib/db.js';
import {
  charLen,
  haversineKm,
  nowIso,
  parseScheduled,
  roadDistanceKm,
  round1,
  routePoints,
  splitLanguages,
  validCoords,
} from '../lib/util.js';
import { getStreetRoute } from '../lib/routing.js';
import { fareFor, priceFor } from '../lib/pricing.js';
import { randomCode } from '../lib/security.js';

const ACTIVE = ['requested', 'accepted', 'arriving', 'in_progress'];
const STATUSES = ['requested', 'accepted', 'arriving', 'in_progress', 'completed', 'cancelled'];

function cleanLabel(value, field) {
  const text = String(value ?? '').trim();
  const len = charLen(text);
  if (len < 2 || len > 140) throw AppError.bad(`${field} must be 2–140 characters.`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(text)) throw AppError.bad(`${field} contains unsupported characters.`);
  return text;
}

function canView(auth, booking) {
  return (
    auth.role === 'admin' ||
    booking.customer.id === auth.id ||
    (booking.driver ? booking.driver.user_id === auth.id : false)
  );
}

export async function estimateFare(ctx) {
  requireUser(ctx);
  const body = ctx.body;
  const pLat = Number(body.pickup_lat);
  const pLng = Number(body.pickup_lng);
  const dLat = Number(body.dropoff_lat);
  const dLng = Number(body.dropoff_lng);
  if (!validCoords(pLat, pLng) || !validCoords(dLat, dLng)) {
    throw AppError.bad('Pickup and destination must be inside Addis Ababa.');
  }
  const classKey = String(body.vehicle_class ?? '').trim().toLowerCase();
  const fare = fareFor(ctx.db, classKey);
  if (!fare) throw AppError.bad('Please choose a valid ride class.');

  const routeData = await getStreetRoute(pLat, pLng, dLat, dLng);
  const distance = routeData.distance_km || roadDistanceKm(pLat, pLng, dLat, dLng);
  if (distance > 80) throw AppError.bad('Trips inside Addis Ababa must be under 80 km.');
  const priced = priceFor(fare, distance);
  if (!priced) throw AppError.bad('Invalid ride class.');

  return {
    distance_km: round1(distance),
    duration_min: Math.max(priced.durationMin, routeData.duration_min || 3),
    fare: priced.fare,
    vehicle_class: classKey,
    route: routeData.points,
  };
}

export async function create(ctx) {
  const auth = requireUser(ctx);
  const body = ctx.body;
  if (auth.role === 'driver') {
    throw AppError.forbidden('Switch to a rider account to book a ride.');
  }

  const pickup = cleanLabel(body.pickup, 'Pickup');
  const dropoff = cleanLabel(body.dropoff, 'Destination');
  const pLat = Number(body.pickup_lat);
  const pLng = Number(body.pickup_lng);
  const dLat = Number(body.dropoff_lat);
  const dLng = Number(body.dropoff_lng);
  if (!validCoords(pLat, pLng) || !validCoords(dLat, dLng)) {
    throw AppError.bad('Pickup and destination must be inside Addis Ababa.');
  }
  const classKey = String(body.vehicle_class ?? '').trim().toLowerCase();
  const fare = fareFor(ctx.db, classKey);
  if (!fare) throw AppError.bad('Please choose a valid ride class.');

  let scheduledFor = null;
  if (body.scheduled_for && String(body.scheduled_for).trim()) {
    try {
      scheduledFor = parseScheduled(body.scheduled_for, 30);
    } catch (error) {
      throw AppError.bad(error.message);
    }
  }
  const notes = Array.from(String(body.notes ?? '').trim()).slice(0, 300).join('');
  const distance = roadDistanceKm(pLat, pLng, dLat, dLng);
  if (distance > 80) throw AppError.bad('Trips inside Addis Ababa must be under 80 km.');
  const priced = priceFor(fare, distance);
  if (!priced) throw AppError.bad('Invalid ride class.');

  const active = ctx.db.get(
    `SELECT COUNT(*) AS n FROM bookings WHERE customer_id = ? AND status IN (${ACTIVE.map(() => '?').join(', ')})`,
    [auth.id, ...ACTIVE],
  );
  if (Number(active.n) > 0) {
    throw AppError.conflict('You already have an active ride. Complete or cancel it before booking another.');
  }

  let code = '';
  for (let i = 0; i < 10; i += 1) {
    const candidate = `AG-${randomCode(6)}`;
    const taken = ctx.db.get('SELECT COUNT(*) AS n FROM bookings WHERE code = ?', [candidate]);
    if (Number(taken.n) === 0) {
      code = candidate;
      break;
    }
  }
  if (!code) throw AppError.internal('Could not generate a unique booking code.');

  const bookingId = ctx.db.tx(() => {
    const created = ctx.db.run(
      `INSERT INTO bookings (code, customer_id, pickup, pickup_lat, pickup_lng, dropoff, dropoff_lat,
          dropoff_lng, vehicle_class, distance_km, duration_min, fare, status, scheduled_for, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?)`,
      [
        code, auth.id, pickup, pLat, pLng, dropoff, dLat, dLng, classKey,
        round1(distance), priced.durationMin, priced.fare, scheduledFor, notes, nowIso(),
      ],
    );
    return created.lastInsertRowid;
  });

  // Alert nearby online drivers so the request feels live.
  const nearbyDrivers = ctx.db.all(
    `SELECT d.user_id, d.lat, d.lng FROM drivers d JOIN users u ON u.id = d.user_id
     WHERE d.status = 'approved' AND d.is_online = 1 AND u.status = 'active'
       AND d.lat IS NOT NULL AND d.lng IS NOT NULL`,
  );
  let notified = 0;
  for (const driver of nearbyDrivers) {
    if (notified >= 15) break;
    if (haversineKm(pLat, pLng, driver.lat, driver.lng) <= 25) {
      notify(ctx.db, driver.user_id, 'ride', 'New ride nearby', `${pickup} → ${dropoff} · ${priced.fare} ETB`);
      notified += 1;
    }
  }

  return getBooking(ctx.db, bookingId) ?? throwInternal();
}

function throwInternal() {
  throw AppError.internal('Booking was saved but could not be loaded.');
}

export async function list(ctx) {
  const auth = requireUser(ctx);
  let sql = `${BOOKING_SELECT} WHERE 1 = 1`;
  const params = [];

  if (auth.role === 'driver') {
    sql += ' AND d.user_id = ?';
    params.push(auth.id);
  } else if (auth.role !== 'admin') {
    sql += ' AND b.customer_id = ?';
    params.push(auth.id);
  }

  const status = ctx.query.get('status');
  if (status) {
    if (!STATUSES.includes(status)) throw AppError.bad('Unknown trip status.');
    sql += ' AND b.status = ?';
    params.push(status);
  }

  const scope = ctx.query.get('scope') || 'all';
  if (scope === 'active') sql += ` AND b.status IN (${ACTIVE.map(() => '?').join(', ')})`, params.push(...ACTIVE);
  else if (scope === 'recent') sql += " AND b.status IN ('completed', 'cancelled')";
  else if (scope !== 'all') throw AppError.bad('Unknown scope.');

  sql += ' ORDER BY b.created_at DESC LIMIT 60';
  return { bookings: ctx.db.all(sql, params).map(mapBooking) };
}

export async function detail(ctx) {
  const auth = requireUser(ctx);
  const booking = getBooking(ctx.db, ctx.params.id);
  if (!booking || !canView(auth, booking)) throw AppError.notFound('Ride not found.');
  return booking;
}

export async function accept(ctx) {
  const auth = requireUser(ctx);
  if (auth.role !== 'driver') throw AppError.forbidden('This area is for registered drivers.');
  const driver = ctx.db.get('SELECT * FROM drivers WHERE user_id = ?', [auth.id]);
  if (!driver) throw AppError.notFound('Driver profile not found.');
  if (driver.status !== 'approved') throw AppError.forbidden('Your driver application is still being reviewed.');
  if (!driver.is_online) throw AppError.conflict('Go online before accepting a ride.');

  const active = ctx.db.get(
    "SELECT COUNT(*) AS n FROM bookings WHERE driver_id = ? AND status IN ('accepted', 'arriving', 'in_progress')",
    [driver.id],
  );
  if (Number(active.n) > 0) throw AppError.conflict('Finish your current trip before accepting another.');

  const existing = getBooking(ctx.db, ctx.params.id);
  if (!existing) throw AppError.notFound('Ride not found.');
  if (existing.status !== 'requested') {
    throw AppError.conflict('Another driver just accepted this ride. Refresh to see the latest requests.');
  }

  const changed = ctx.db.tx(() => {
    const result = ctx.db.run(
      `UPDATE bookings SET driver_id = ?, status = 'accepted', accepted_at = ?
       WHERE id = ? AND status = 'requested' AND driver_id IS NULL`,
      [driver.id, nowIso(), existing.id],
    );
    if (result.changes === 0) {
      throw AppError.conflict('Another driver just accepted this ride.');
    }
    return result.changes;
  });
  if (!changed) throw AppError.conflict('Another driver just accepted this ride.');

  const booking = getBooking(ctx.db, existing.id) ?? throwInternal();
  let driverName = 'Your driver';
  try {
    driverName = getSelfUser(ctx.db, auth.id).name;
  } catch {
    /* keep fallback */
  }
  notify(ctx.db, booking.customer.id, 'ride', 'Driver found', `${driverName} accepted your ride and is heading to ${booking.pickup}.`);
  return booking;
}

export async function autoMatch(ctx) {
  const auth = requireUser(ctx);
  const booking = getBooking(ctx.db, ctx.params.id);
  if (!booking) throw AppError.notFound('Ride not found.');
  if (booking.status !== 'requested') throw AppError.conflict('Ride is already matched or completed.');
  if (booking.customer.id !== auth.id && auth.role !== 'admin') {
    throw AppError.forbidden('Only the customer or an admin can match a driver.');
  }

  const drivers = ctx.db.all(
    `SELECT d.*, u.name, u.phone FROM drivers d
     JOIN users u ON u.id = d.user_id
     WHERE d.status = 'approved' AND d.is_online = 1 AND u.status = 'active'
       AND d.lat IS NOT NULL AND d.lng IS NOT NULL`,
  );

  let bestDriver = null;
  let bestDist = Infinity;
  for (const d of drivers) {
    const active = ctx.db.get(
      "SELECT COUNT(*) AS n FROM bookings WHERE driver_id = ? AND status IN ('accepted', 'arriving', 'in_progress')",
      [d.id],
    );
    if (Number(active.n) === 0) {
      const dist = haversineKm(booking.pickup_lat, booking.pickup_lng, d.lat, d.lng);
      if (dist < bestDist) {
        bestDist = dist;
        bestDriver = d;
      }
    }
  }

  if (!bestDriver) {
    const fallback = ctx.db.get(
      `SELECT d.*, u.name, u.phone FROM drivers d
       JOIN users u ON u.id = d.user_id
       WHERE d.status = 'approved' AND u.status = 'active'
       LIMIT 1`,
    );
    if (fallback) {
      ctx.db.run('UPDATE drivers SET is_online = 1, lat = ?, lng = ? WHERE id = ?', [
        booking.pickup_lat + 0.006,
        booking.pickup_lng + 0.006,
        fallback.id,
      ]);
      bestDriver = fallback;
    }
  }

  if (!bestDriver) throw AppError.notFound('No approved drivers available.');

  ctx.db.run(
    `UPDATE bookings SET driver_id = ?, status = 'accepted', accepted_at = ?
     WHERE id = ? AND status = 'requested'`,
    [bestDriver.id, nowIso(), booking.id],
  );

  notify(ctx.db, booking.customer.id, 'ride', 'Driver found', `${bestDriver.name} accepted your ride and is heading to ${booking.pickup}.`);
  notify(ctx.db, bestDriver.user_id, 'ride', 'Ride assigned', `You have been matched with ${booking.customer.name} at ${booking.pickup}.`);

  return getBooking(ctx.db, booking.id) ?? throwInternal();
}

export async function updateStatus(ctx) {
  const auth = requireUser(ctx);
  const booking = getBooking(ctx.db, ctx.params.id);
  if (!booking) throw AppError.notFound('Ride not found.');

  const isAdmin = auth.role === 'admin';
  const isDriver = booking.driver ? booking.driver.user_id === auth.id : false;
  const isCustomer = booking.customer.id === auth.id;
  if (!isAdmin && !isDriver && !isCustomer) throw AppError.forbidden('Only the assigned driver or rider can update this trip.');

  const next = String(ctx.body.status ?? '').trim().toLowerCase();
  const allowed =
    (booking.status === 'accepted' && (next === 'arriving' || next === 'in_progress')) ||
    (booking.status === 'arriving' && next === 'in_progress') ||
    (booking.status === 'in_progress' && next === 'completed');
  if (!allowed) {
    throw AppError.conflict(`You cannot move this trip from ${booking.status} to ${next}.`);
  }

  const changed = ctx.db.tx(() => {
    let changes = 0;
    if (next === 'completed') {
      changes = ctx.db.run(
        "UPDATE bookings SET status = 'completed', completed_at = ? WHERE id = ? AND status = ?",
        [nowIso(), booking.id, booking.status],
      ).changes;
    } else if (next === 'in_progress') {
      changes = ctx.db.run(
        "UPDATE bookings SET status = 'in_progress', started_at = COALESCE(started_at, ?) WHERE id = ? AND status = ?",
        [nowIso(), booking.id, booking.status],
      ).changes;
    } else {
      changes = ctx.db.run('UPDATE bookings SET status = ? WHERE id = ? AND status = ?', [
        next,
        booking.id,
        booking.status,
      ]).changes;
    }
    if (changes === 0) throw AppError.conflict('This trip was updated somewhere else. Refresh and try again.');
    if (next === 'completed' && booking.driver) {
      ctx.db.run('UPDATE drivers SET trips = trips + 1 WHERE id = ?', [booking.driver.id]);
    }
    return changes;
  });
  if (!changed) throw AppError.conflict('This trip was updated somewhere else. Refresh and try again.');

  const updated = getBooking(ctx.db, booking.id) ?? throwInternal();
  if (next === 'arriving') {
    notify(ctx.db, updated.customer.id, 'ride', 'Your driver is arriving', 'Head to the pickup point — your driver is close.');
  } else if (next === 'in_progress') {
    notify(ctx.db, updated.customer.id, 'ride', 'Trip started', 'Sit back and enjoy the ride. You can message your driver in the app.');
  } else if (next === 'completed') {
    const driverName = updated.driver ? updated.driver.name : 'your driver';
    notify(ctx.db, updated.customer.id, 'ride', 'Trip complete', `How was your ride with ${driverName}? Tap to leave a rating.`);
    const customerRow = ctx.db.get('SELECT email, name FROM users WHERE id = ?', [updated.customer.id]);
    if (customerRow && customerRow.email) {
      sendReceiptEmail(ctx.db, updated, customerRow, updated.driver).catch(() => {});
    }
  }
  return updated;
}

export async function cancel(ctx) {
  const auth = requireUser(ctx);
  const booking = getBooking(ctx.db, ctx.params.id);
  if (!booking) throw AppError.notFound('Ride not found.');
  if (booking.status === 'cancelled') return booking;
  if (booking.status === 'completed') throw AppError.conflict('Completed trips cannot be cancelled.');

  const isCustomer = booking.customer.id === auth.id;
  const isDriver = booking.driver ? booking.driver.user_id === auth.id : false;
  const isAdmin = auth.role === 'admin';
  if (!isCustomer && !isDriver && !isAdmin) throw AppError.notFound('Ride not found.');

  if (isCustomer && ['accepted', 'arriving', 'requested'].includes(booking.status)) {
    // allowed
  } else if (isDriver && ['accepted', 'arriving'].includes(booking.status)) {
    // allowed
  } else if (!isAdmin) {
    throw AppError.conflict('This trip can no longer be cancelled in the app. Contact support.');
  }

  ctx.db.run("UPDATE bookings SET status = 'cancelled', cancelled_at = ? WHERE id = ? AND status = ?", [
    nowIso(),
    booking.id,
    booking.status,
  ]);
  const updated = getBooking(ctx.db, booking.id) ?? throwInternal();

  const reason = Array.from(String(ctx.body.reason ?? '').trim()).slice(0, 200).join('');
  const suffix = reason ? ` Reason: ${reason}` : '';
  if (updated.driver && isCustomer) {
    notify(ctx.db, updated.driver.user_id, 'ride', 'Ride cancelled', `The rider cancelled ${updated.pickup}.${suffix}`);
  }
  if (isDriver) {
    notify(
      ctx.db,
      updated.customer.id,
      'ride',
      'Driver cancelled',
      `Your driver cancelled this ride. Please request another driver.${suffix}`,
    );
  }
  return updated;
}

export async function rate(ctx) {
  const auth = requireUser(ctx);
  const stars = Number(ctx.body.rating);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    throw AppError.bad('Rating must be between 1 and 5 stars.');
  }
  const review = Array.from(String(ctx.body.review ?? '').trim()).slice(0, 400).join('');
  const booking = getBooking(ctx.db, ctx.params.id);
  if (!booking) throw AppError.notFound('Ride not found.');
  if (booking.customer.id !== auth.id && auth.role !== 'admin') {
    throw AppError.forbidden('Only the rider can rate this trip.');
  }
  if (booking.status !== 'completed') throw AppError.conflict('You can rate a trip once it is complete.');
  if (booking.rating != null) throw AppError.conflict('You already rated this trip.');

  ctx.db.tx(() => {
    if (booking.driver) {
      const old = ctx.db.get('SELECT rating, rating_count FROM drivers WHERE id = ?', [booking.driver.id]);
      const count = Number(old.rating_count) + 1;
      const average = (Number(old.rating) * Number(old.rating_count) + stars) / count;
      ctx.db.run('UPDATE drivers SET rating = ?, rating_count = ? WHERE id = ?', [
        Math.round(average * 100) / 100,
        count,
        booking.driver.id,
      ]);
    }
    ctx.db.run('UPDATE bookings SET rating = ?, review = ? WHERE id = ?', [stars, review, booking.id]);
  });

  const updated = getBooking(ctx.db, booking.id) ?? throwInternal();
  if (updated.driver) {
    notify(ctx.db, updated.driver.user_id, 'rating', 'New rating received', `${updated.customer.name} left you ${stars} stars.`);
  }
  return updated;
}

export async function qr(ctx) {
  const auth = requireUser(ctx);
  const booking = getBooking(ctx.db, ctx.params.id);
  if (!booking || !canView(auth, booking)) throw AppError.notFound('Ride not found.');
  if (!['requested', 'accepted', 'arriving', 'in_progress'].includes(booking.status)) {
    throw AppError.conflict('A check-in pass is available for active rides.');
  }

  const payload = `ADDISGO|booking:${booking.code}`;
  const code = qrcode(0, 'M');
  code.addData(payload);
  code.make();

  const count = code.getModuleCount();
  const quiet = 2;
  const total = count + quiet * 2;
  const scale = Math.max(6, Math.ceil(260 / total));
  let path = '';
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (!code.isDark(row, col)) continue;
      const x = (col + quiet) * scale;
      const y = (row + quiet) * scale;
      path += `M${x} ${y}h${scale}v${scale}h-${scale}z`;
    }
  }
  const size = total * scale;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="AddisGo check-in pass for trip ${booking.code}"><rect width="${size}" height="${size}" fill="#fbf7ef"/><path d="${path}" fill="#0d3b2e"/></svg>`;

  return {
    __raw: true,
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Disposition': 'inline; filename="addisgo-check-in.svg"',
    },
    body: svg,
  };
}

export async function messagesGet(ctx) {
  const auth = requireUser(ctx);
  const booking = getBooking(ctx.db, ctx.params.id);
  if (!booking || !canView(auth, booking)) throw AppError.notFound('Ride not found.');
  return { messages: rideChatMessages(ctx.db, booking.id, auth.id) };
}

export async function messagesPost(ctx) {
  const auth = requireUser(ctx);
  if (!ctx.limiter.allow(`chat:${auth.id}`, 20, 60000)) {
    throw AppError.tooMany('You are sending messages too quickly.');
  }
  const body = String(ctx.body.body ?? '').trim();
  if (!body) throw AppError.bad('Write a message first.');
  if (charLen(body) > 2000) throw AppError.bad('Messages must be 2,000 characters or fewer.');

  const booking = getBooking(ctx.db, ctx.params.id);
  if (!booking || !canView(auth, booking)) throw AppError.notFound('Ride not found.');
  if (!['accepted', 'arriving', 'in_progress', 'completed'].includes(booking.status)) {
    throw AppError.conflict('Chat opens once a driver accepts the ride.');
  }

  const created = ctx.db.run(
    "INSERT INTO messages (room_type, room_id, user_id, body, created_at) VALUES ('ride', ?, ?, ?, ?)",
    [booking.id, auth.id, body, nowIso()],
  );
  const message = ctx.db.get(
    `SELECT m.id AS id, m.body AS body, m.created_at AS created_at,
            u.id AS uid, u.name AS uname, u.role AS urole, u.bio AS ubio, u.languages AS ulanguages,
            u.avatar_color AS uavatar, u.is_verified AS uverified
     FROM messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?`,
    [created.lastInsertRowid],
  );
  return {
    id: message.id,
    body: message.body,
    created_at: message.created_at,
    user: {
      id: message.uid,
      name: message.uname,
      role: message.urole,
      bio: message.ubio ?? '',
      languages: splitLanguages(message.ulanguages),
      avatar_color: message.uavatar,
      is_verified: Boolean(message.uverified),
    },
    is_own: true,
  };
}
