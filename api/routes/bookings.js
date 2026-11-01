import qrcode from 'qrcode-generator';

import { AppError } from '../lib/errors.js';
import { requireUser } from '../lib/context.js';
import { sendReceiptEmail } from '../lib/email.js';
import {
  BOOKING_SELECT,
  audit,
  getBooking,
  getSelfUser,
  mapBooking,
  notify,
  rideChatMessages,
} from '../lib/db.js';
import { DISPATCH, broadcast, etaMinutes, sweep } from '../lib/dispatch.js';
import { settleBooking } from '../lib/revenue.js';
import {
  RATING_TAGS,
  RIDER_TAGS,
  cancelReasonsFor,
  ratingSummary,
  recordCancellation,
  refreshDriverScore,
  refreshUserScore,
  resolveCancelReason,
  sanitizeTags,
} from '../lib/feedback.js';
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

/** Optional 1–5 sub-score. Blank means "not rated", which is different from 0. */
function readScore(value, field, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw AppError.bad(`${field} is required.`);
    return null;
  }
  const score = Number(value);
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw AppError.bad(`${field} must be a whole number from 1 to 5.`);
  }
  return score;
}

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

/** Attaches cancellation context and per-role rating flags for the ride view. */
function enrichBooking(db, booking) {
  if (!booking) return booking;
  const row = db.get(
    `SELECT reason_code, blame_party, cancelled_by_role, outcome, fee_applied, note, created_at
       FROM cancellations WHERE booking_id = ? ORDER BY id DESC LIMIT 1`,
    [booking.id],
  );
  const rated = db.all('SELECT rater_role FROM ratings WHERE booking_id = ?', [booking.id]);
  const ratedBy = { rider: false, driver: false };
  for (const entry of rated) {
    if (entry.rater_role in ratedBy) ratedBy[entry.rater_role] = true;
  }
  const reason = row
    ? resolveCancelReason(
        row.cancelled_by_role === 'system' ? 'system' : row.cancelled_by_role === 'driver' ? 'driver' : 'rider',
        row.reason_code,
      )
    : null;
  return {
    ...booking,
    rated_by: ratedBy,
    cancellation: row
      ? {
          reason_code: row.reason_code,
          label: reason?.label ?? row.reason_code,
          blame_party: row.blame_party,
          by_role: row.cancelled_by_role,
          outcome: row.outcome,
          fee_applied: Boolean(row.fee_applied),
          note: row.note ?? '',
          created_at: row.created_at,
        }
      : null,
  };
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

  // Dispatch round 0: notify every eligible driver inside 3 km. Later rounds
  // widen automatically via sweep() if nobody accepts before the deadline.
  const fresh = getBooking(ctx.db, bookingId) ?? throwInternal();
  broadcast(ctx.db, fresh, 0);
  return getBooking(ctx.db, bookingId) ?? fresh;
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
  let booking = getBooking(ctx.db, ctx.params.id);
  if (!booking || !canView(auth, booking)) throw AppError.notFound('Ride not found.');
  // Polling this endpoint advances an expired dispatch round (lazy supervisor).
  if (booking.status === 'requested') booking = sweep(ctx.db, booking);
  return enrichBooking(ctx.db, booking);
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

  const pickupDistance = driver.lat != null && driver.lng != null
    ? haversineKm(existing.pickup_lat, existing.pickup_lng, driver.lat, driver.lng)
    : 5;
  const promisedEta = etaMinutes(pickupDistance);

  const changed = ctx.db.tx(() => {
    const result = ctx.db.run(
      `UPDATE bookings SET driver_id = ?, status = 'accepted', accepted_at = ?,
              promised_eta_min = ?, dispatch_state = 'matched', dispatch_deadline = NULL
       WHERE id = ? AND status = 'requested' AND driver_id IS NULL`,
      [driver.id, nowIso(), promisedEta, existing.id],
    );
    if (result.changes === 0) {
      throw AppError.conflict('Another driver just accepted this ride.');
    }
    // Close out the dispatch ledger: this driver won, everyone else is stale.
    ctx.db.run(
      `UPDATE dispatch_attempts SET outcome = 'superseded', responded_at = ?
        WHERE booking_id = ? AND outcome = 'pending' AND driver_id <> ?`,
      [nowIso(), existing.id, driver.id],
    );
    ctx.db.run(
      `UPDATE dispatch_attempts SET outcome = 'accepted', responded_at = ?
        WHERE booking_id = ? AND driver_id = ? AND outcome = 'pending'`,
      [nowIso(), existing.id, driver.id],
    );
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
  notify(ctx.db, booking.customer.id, 'ride', 'Driver found', `${driverName} accepted your ride and is heading to ${booking.pickup}.`, `#/ride/${booking.id}`);
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
       AND d.lat IS NOT NULL AND d.lng IS NOT NULL
       AND d.vehicle_class = ?
       AND NOT EXISTS (
         SELECT 1 FROM bookings b
          WHERE b.driver_id = d.id AND b.status IN ('accepted', 'arriving', 'in_progress')
       )`,
    [booking.vehicle_class],
  );

  let bestDriver = null;
  let bestDist = Infinity;
  for (const d of drivers) {
    const dist = haversineKm(booking.pickup_lat, booking.pickup_lng, d.lat, d.lng);
    if (dist < bestDist) {
      bestDist = dist;
      bestDriver = d;
    }
  }

  // No silent teleporting of an offline driver: if nobody is available for this
  // class, say so and let the dispatch rounds keep trying.
  if (!bestDriver) {
    throw AppError.conflict(
      'No driver is free for this ride class right now. We will keep offering it to drivers nearby.',
    );
  }

  const promisedEta = etaMinutes(bestDist);
  const claimed = ctx.db.tx(() => {
    const result = ctx.db.run(
      `UPDATE bookings SET driver_id = ?, status = 'accepted', accepted_at = ?,
              promised_eta_min = ?, dispatch_state = 'matched', dispatch_deadline = NULL
        WHERE id = ? AND status = 'requested' AND driver_id IS NULL`,
      [bestDriver.id, nowIso(), promisedEta, booking.id],
    );
    if (result.changes === 0) return false;
    ctx.db.run(
      `UPDATE dispatch_attempts SET outcome = 'superseded', responded_at = ?
        WHERE booking_id = ? AND outcome = 'pending' AND driver_id <> ?`,
      [nowIso(), booking.id, bestDriver.id],
    );
    ctx.db.run(
      `UPDATE dispatch_attempts SET outcome = 'accepted', responded_at = ?
        WHERE booking_id = ? AND driver_id = ? AND outcome = 'pending'`,
      [nowIso(), booking.id, bestDriver.id],
    );
    return true;
  });
  if (!claimed) throw AppError.conflict('This ride was just matched to another driver.');

  notify(ctx.db, booking.customer.id, 'ride', 'Driver found', `${bestDriver.name} accepted your ride and is heading to ${booking.pickup}.`, `#/ride/${booking.id}`);
  notify(ctx.db, bestDriver.user_id, 'ride', 'Ride assigned', `You have been matched with ${booking.customer.name} at ${booking.pickup}.`, `#/ride/${booking.id}`);

  return enrichBooking(ctx.db, getBooking(ctx.db, booking.id) ?? throwInternal());
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
    } else if (next === 'arriving') {
      // Stamping arrival is what makes punctuality measurable later.
      changes = ctx.db.run(
        "UPDATE bookings SET status = 'arriving', arrived_at = COALESCE(arrived_at, ?) WHERE id = ? AND status = ?",
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
    if (next === 'completed') {
      // Revenue split is written once per trip; the UNIQUE booking_id guards it.
      settleBooking(ctx.db, {
        id: booking.id,
        fare: booking.fare,
        driver_id: booking.driver?.id ?? null,
        customer_id: booking.customer?.id ?? null,
      });
    }
    return changes;
  });
  if (!changed) throw AppError.conflict('This trip was updated somewhere else. Refresh and try again.');

  const updated = getBooking(ctx.db, booking.id) ?? throwInternal();
  if (next === 'arriving') {
    notify(ctx.db, updated.customer.id, 'ride', 'Your driver is arriving', 'Head to the pickup point — your driver is close.', `#/ride/${updated.id}`);
  } else if (next === 'in_progress') {
    notify(ctx.db, updated.customer.id, 'ride', 'Trip started', 'Sit back and enjoy the ride. You can message your driver in the app.', `#/ride/${updated.id}`);
  } else if (next === 'completed') {
    const driverName = updated.driver ? updated.driver.name : 'your driver';
    notify(ctx.db, updated.customer.id, 'ride', 'Trip complete', `How was your ride with ${driverName}? Tap to leave a rating.`, `#/ride/${updated.id}`);
    const customerRow = ctx.db.get('SELECT email, name FROM users WHERE id = ?', [updated.customer.id]);
    if (customerRow && customerRow.email) {
      sendReceiptEmail(ctx.db, updated, customerRow, updated.driver).catch(() => {});
    }
  }
  return updated;
}

/**
 * Cancellation is a first-class event, not a free-text note.
 *
 *  - rider / admin  → the trip ends, with a coded reason and a blame party.
 *  - driver         → the trip does NOT end: it returns to the dispatch pool and
 *                     is automatically re-offered to another driver.
 *
 * The `reason_code` body field is optional for backward compatibility and falls
 * back to OTHER for the caller's role.
 */
export async function cancel(ctx) {
  const auth = requireUser(ctx);
  const booking = getBooking(ctx.db, ctx.params.id);
  if (!booking) throw AppError.notFound('Ride not found.');
  if (booking.status === 'cancelled') return enrichBooking(ctx.db, booking);
  if (booking.status === 'completed') throw AppError.conflict('Completed trips cannot be cancelled.');

  const isCustomer = booking.customer.id === auth.id;
  const isDriver = booking.driver ? booking.driver.user_id === auth.id : false;
  const isAdmin = auth.role === 'admin';
  if (!isCustomer && !isDriver && !isAdmin) throw AppError.notFound('Ride not found.');

  if (isCustomer) {
    if (!['requested', 'accepted', 'arriving'].includes(booking.status)) {
      throw AppError.conflict('This trip can no longer be cancelled in the app. Contact support.');
    }
  } else if (isDriver) {
    if (!['accepted', 'arriving'].includes(booking.status)) {
      throw AppError.conflict('You can only release a trip you have accepted but not started.');
    }
  }

  const role = isCustomer ? 'rider' : isDriver ? 'driver' : 'admin';
  const reason = resolveCancelReason(role, ctx.body.reason_code);
  const note = Array.from(String(ctx.body.reason ?? ctx.body.note ?? '').trim()).slice(0, 200).join('');

  if (isDriver) {
    // Too many driver releases means this request is effectively undeliverable.
    if (Number(booking.dispatch?.driver_releases ?? 0) >= 2) {
      markUndeliverable(ctx.db, booking, { reason, userId: auth.id, note });
      audit(ctx.db, auth.id, 'booking.undeliverable', `Ride ${booking.code} abandoned after repeated driver releases`);
      return enrichBooking(ctx.db, getBooking(ctx.db, booking.id) ?? throwInternal());
    }

    ctx.db.tx(() => {
      const changed = ctx.db.run(
        `UPDATE bookings
            SET driver_id = NULL, status = 'requested', accepted_at = NULL, started_at = NULL,
                arrived_at = NULL, promised_eta_min = NULL, dispatch_state = 'searching',
                dispatch_round = 0, dispatch_deadline = NULL,
                driver_release_count = driver_release_count + 1
          WHERE id = ? AND status IN ('accepted', 'arriving')`,
        [booking.id],
      );
      if (changed.changes === 0) throw AppError.conflict('This trip was updated somewhere else.');
      ctx.db.run(
        `UPDATE dispatch_attempts SET outcome = 'declined', responded_at = ?
          WHERE booking_id = ? AND driver_id = ? AND outcome = 'pending'`,
        [nowIso(), booking.id, booking.driver.id],
      );
      recordCancellation(ctx.db, {
        bookingId: booking.id,
        role: 'driver',
        userId: auth.id,
        reason,
        outcome: 'redispatch',
        note,
      });
    });

    const reopened = getBooking(ctx.db, booking.id) ?? throwInternal();
    broadcast(ctx.db, reopened, 0);

    notify(
      ctx.db,
      reopened.customer.id,
      'ride',
      'Finding you another driver',
      `${booking.driver.name} released this trip (${reason.label.toLowerCase()}). We are offering it to other drivers now — no need to rebook.`,
      `#/ride/${reopened.id}`,
    );
    audit(ctx.db, auth.id, 'booking.driver_released', `Ride ${booking.code} released by driver · ${reason.code}`);
    return enrichBooking(ctx.db, getBooking(ctx.db, booking.id) ?? reopened);
  }

  // Terminal cancellation (rider or admin).
  ctx.db.tx(() => {
    const changed = ctx.db.run(
      `UPDATE bookings SET status = 'cancelled', cancelled_at = ?, dispatch_state = 'cancelled',
              dispatch_deadline = NULL
        WHERE id = ? AND status = ?`,
      [nowIso(), booking.id, booking.status],
    );
    if (changed.changes === 0) throw AppError.conflict('This trip was updated somewhere else.');
    ctx.db.run(
      `UPDATE dispatch_attempts SET outcome = 'timeout', responded_at = ?
        WHERE booking_id = ? AND outcome = 'pending'`,
      [nowIso(), booking.id],
    );
    recordCancellation(ctx.db, {
      bookingId: booking.id,
      role,
      userId: auth.id,
      reason,
      outcome: 'trip_cancelled',
      note,
    });
  });

  const updated = getBooking(ctx.db, booking.id) ?? throwInternal();
  const feeNote = reason.fee ? ' A cancellation fee may apply.' : '';
  if (updated.driver && isCustomer) {
    notify(
      ctx.db,
      updated.driver.user_id,
      'ride',
      'Ride cancelled',
      `The rider cancelled ${updated.pickup} (${reason.label.toLowerCase()}).`,
      `#/ride/${updated.id}`,
    );
  }
  notify(
    ctx.db,
    updated.customer.id,
    'ride',
    'Ride cancelled',
    `Your ride was cancelled.${feeNote}`,
    `#/ride/${updated.id}`,
  );
  audit(ctx.db, auth.id, 'booking.cancelled', `Ride ${booking.code} cancelled · ${reason.code} (${reason.blame})`);
  return enrichBooking(ctx.db, updated);
}

function markUndeliverable(db, booking, { reason, userId = null, note = '' } = {}) {
  const systemReason = resolveCancelReason('system', 'NO_DRIVER_FOUND');
  db.tx(() => {
    // The driver may be holding the trip (accepted/arriving), not just watching
    // it in the pool, so every pre-trip state has to be terminal here.
    const changed = db.run(
      `UPDATE bookings
          SET status = 'cancelled', cancelled_at = ?, dispatch_state = 'failed',
              dispatch_deadline = NULL, driver_id = NULL, accepted_at = NULL,
              started_at = NULL, arrived_at = NULL, promised_eta_min = NULL,
              driver_release_count = driver_release_count + 1
        WHERE id = ? AND status IN ('requested', 'accepted', 'arriving')`,
      [nowIso(), booking.id],
    );
    if (changed.changes === 0) return;
    db.run(
      `UPDATE dispatch_attempts SET outcome = 'timeout', responded_at = ?
        WHERE booking_id = ? AND outcome = 'pending'`,
      [nowIso(), booking.id],
    );
    if (reason) {
      recordCancellation(db, {
        bookingId: booking.id,
        role: 'driver',
        userId,
        reason,
        outcome: 'redispatch',
        note,
      });
    }
    recordCancellation(db, {
      bookingId: booking.id,
      role: 'system',
      userId: null,
      reason: systemReason,
      outcome: 'trip_cancelled',
      note: 'Too many drivers released this trip.',
    });
  });
  notify(
    db,
    booking.customer.id,
    'ride',
    'No driver available',
    'Too many drivers released this trip. You have not been charged — please try again shortly.',
    `#/ride/${booking.id}`,
  );
}

/** Rider- or admin-triggered extra dispatch round. */
export async function redispatch(ctx) {
  const auth = requireUser(ctx);
  const booking = getBooking(ctx.db, ctx.params.id);
  if (!booking) throw AppError.notFound('Ride not found.');
  if (booking.status !== 'requested') {
    throw AppError.conflict('Only a ride that is still searching can be re-dispatched.');
  }
  if (booking.customer.id !== auth.id && auth.role !== 'admin') {
    throw AppError.forbidden('Only the rider can re-dispatch this ride.');
  }

  const next = Math.min(Number(booking.dispatch?.round ?? 0) + 1, DISPATCH.maxRounds - 1);
  broadcast(ctx.db, booking, next);
  audit(ctx.db, auth.id, 'booking.redispatch', `Ride ${booking.code} re-dispatched at round ${next}`);
  return enrichBooking(ctx.db, getBooking(ctx.db, booking.id) ?? booking);
}

/** Public: the reason and tag lists the UI renders. One source of truth. */
export async function cancelReasons() {
  return {
    rider: cancelReasonsFor('rider'),
    driver: cancelReasonsFor('driver'),
    rating_tags: { rider: RATING_TAGS, driver: RIDER_TAGS },
  };
}

/**
 * Converts measured arrival delay into a punctuality sub-score. We never ask the
 * rider "was the driver on time?" — the answer is in the telemetry and asking
 * would only add noise.
 */
function punctualityFromDelay(delayMin) {
  if (delayMin == null || !Number.isFinite(Number(delayMin))) return null;
  const delay = Number(delayMin);
  if (delay <= 0) return 5;
  if (delay <= 3) return 4;
  if (delay <= 7) return 3;
  if (delay <= 12) return 2;
  return 1;
}

/**
 * Two-sided rating.
 *
 *  rider  → rates the driver: overall + car_condition, comfort, cleanliness,
 *           service, safety, plus tag chips. Punctuality comes from telemetry.
 *  driver → rates the rider: overall + rider tag chips.
 *
 * Both sides are written to `ratings` (unique per booking + rater role) and the
 * displayed score is recomputed with Bayesian smoothing over a rolling window.
 */
export async function rate(ctx) {
  const auth = requireUser(ctx);
  const booking = getBooking(ctx.db, ctx.params.id);
  if (!booking) throw AppError.notFound('Ride not found.');

  const isCustomer = booking.customer.id === auth.id;
  const isDriver = booking.driver ? booking.driver.user_id === auth.id : false;
  if (!isCustomer && !isDriver) {
    throw AppError.forbidden('Only the rider or the driver on this trip can rate it.');
  }
  if (booking.status !== 'completed') throw AppError.conflict('You can rate a trip once it is complete.');
  if (isCustomer && !booking.driver) throw AppError.conflict('This trip has no driver to rate.');

  const raterRole = isCustomer ? 'rider' : 'driver';
  const already = ctx.db.get('SELECT id FROM ratings WHERE booking_id = ? AND rater_role = ?', [
    booking.id,
    raterRole,
  ]);
  if (already) throw AppError.conflict('You already rated this trip.');
  // Legacy guard: older rows only carry bookings.rating.
  if (raterRole === 'rider' && booking.rating != null) throw AppError.conflict('You already rated this trip.');

  const overall = readScore(ctx.body.rating, 'Rating', { required: true });
  const review = Array.from(String(ctx.body.review ?? '').trim()).slice(0, 400).join('');
  const tags = sanitizeTags(ctx.body.tags, raterRole);

  const riderScores = raterRole === 'rider'
    ? {
        car_condition: readScore(ctx.body.car_condition, 'Car condition'),
        comfort: readScore(ctx.body.comfort, 'Comfort'),
        cleanliness: readScore(ctx.body.cleanliness, 'Tidiness'),
        service: readScore(ctx.body.service, 'Service'),
        safety: readScore(ctx.body.safety, 'Safety'),
        punctuality: punctualityFromDelay(booking.arrival_delay_min),
      }
    : {
        car_condition: null,
        comfort: null,
        cleanliness: null,
        service: null,
        safety: null,
        punctuality: null,
      };

  ctx.db.tx(() => {
    ctx.db.run(
      `INSERT INTO ratings
         (booking_id, rater_id, rater_role, driver_id, customer_id, overall,
          car_condition, comfort, cleanliness, service, safety, punctuality,
          tags, review, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        booking.id,
        auth.id,
        raterRole,
        booking.driver?.id ?? null,
        booking.customer.id,
        overall,
        riderScores.car_condition,
        riderScores.comfort,
        riderScores.cleanliness,
        riderScores.service,
        riderScores.safety,
        riderScores.punctuality,
        JSON.stringify(tags),
        review,
        nowIso(),
      ],
    );

    if (raterRole === 'rider') {
      // Keep the legacy column populated so old clients and reports still work.
      ctx.db.run('UPDATE bookings SET rating = ?, review = ? WHERE id = ?', [overall, review, booking.id]);
      if (booking.driver) refreshDriverScore(ctx.db, booking.driver.id);
    } else {
      refreshUserScore(ctx.db, booking.customer.id);
    }
  });

  const updated = getBooking(ctx.db, booking.id) ?? throwInternal();

  if (raterRole === 'rider' && updated.driver) {
    notify(
      ctx.db,
      updated.driver.user_id,
      'rating',
      'New rating received',
      `${updated.customer.name} left you ${overall} stars.`,
      `#/ride/${updated.id}`,
    );
  }
  if (raterRole === 'driver') {
    notify(
      ctx.db,
      updated.customer.id,
      'rating',
      'Your driver rated you',
      `${updated.driver?.name ?? 'Your driver'} left you ${overall} stars.`,
      `#/ride/${updated.id}`,
    );
  }

  const summary = raterRole === 'rider' && updated.driver
    ? ratingSummary(ctx.db, { driverId: updated.driver.id })
    : ratingSummary(ctx.db, { customerId: updated.customer.id, raterRole: 'driver' });

  return {
    ...enrichBooking(ctx.db, updated),
    my_rating: {
      role: raterRole,
      overall,
      review,
      tags,
      ...riderScores,
    },
    rating_summary: summary,
  };
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

  const recipientId = (auth.id === booking.customer.id)
    ? (booking.driver ? booking.driver.user_id : null)
    : booking.customer.id;
  if (recipientId) {
    const senderName = auth.name || (auth.id === booking.customer.id ? 'rider' : 'driver');
    const snippet = Array.from(body).slice(0, 100).join('');
    notify(ctx.db, recipientId, 'chat', `New message from ${senderName}`, snippet, `#/ride/${booking.id}`);
  }
  const message = ctx.db.get(
    `SELECT m.id AS id, m.body AS body, m.created_at AS created_at,
            u.id AS uid, u.name AS uname, u.role AS urole, u.bio AS ubio, u.languages AS ulanguages,
            u.avatar_color AS uavatar, u.avatar_url AS uavatar_url, u.is_verified AS uverified
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
      avatar_url: message.uavatar_url ?? '',
      is_verified: Boolean(message.uverified),
    },
    is_own: true,
  };
}
