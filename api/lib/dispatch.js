/*
 * Dispatch engine.
 *
 * The app uses a broadcast model: every eligible online driver within a radius
 * is notified, and the first to accept wins the atomic claim in
 * bookings.accept(). This module adds the missing supervisor on top:
 *
 *   round 0  →  3 km
 *   round 1  →  6 km
 *   round 2  → 12 km
 *   exhausted → NO_DRIVER_FOUND (platform fault, rider never charged)
 *
 * Timeouts are advanced lazily: the ride page polls GET /bookings/:id, which
 * calls sweep(). That keeps the whole thing dependency-free (no timers, no
 * worker queue) and still converges even if nobody is watching.
 */

import { getBooking, notify } from './db.js';
import { closeStaleSessions } from './sessions.js';
import { haversineKm, nowIso } from './util.js';
import { recordCancellation, resolveCancelReason } from './feedback.js';

export const DISPATCH = {
  offerTtlMs: 25_000,
  maxRounds: 3,
  radiiKm: [3, 6, 12],
  notifyCap: 15,
};

const isoIn = (ms) => new Date(Date.now() + ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

function eligibleDrivers(db) {
  return db.all(
    `SELECT d.id, d.user_id, d.lat, d.lng, d.vehicle_class
       FROM drivers d JOIN users u ON u.id = d.user_id
      WHERE d.status = 'approved' AND d.is_online = 1 AND u.status = 'active'
        AND d.lat IS NOT NULL AND d.lng IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM bookings b
           WHERE b.driver_id = d.id AND b.status IN ('accepted', 'arriving', 'in_progress')
        )`,
  );
}

/**
 * Notifies every eligible driver in this round's radius that has not already
 * been offered this trip. Returns how many new drivers were reached.
 */
export function broadcast(db, booking, round) {
  if (!booking || booking.status !== 'requested') return 0;

  // A phone that stopped beating should stop receiving offers immediately.
  closeStaleSessions(db);

  const radius = DISPATCH.radiiKm[Math.min(round, DISPATCH.radiiKm.length - 1)];
  const already = new Set(
    db.all('SELECT driver_id FROM dispatch_attempts WHERE booking_id = ?', [booking.id]).map((r) => r.driver_id),
  );

  const candidates = eligibleDrivers(db)
    .filter((driver) => driver.vehicle_class === booking.vehicle_class)
    .map((driver) => ({
      ...driver,
      km: haversineKm(booking.pickup_lat, booking.pickup_lng, driver.lat, driver.lng),
    }))
    .filter((driver) => driver.km <= radius && !already.has(driver.id))
    .sort((a, b) => a.km - b.km)
    .slice(0, DISPATCH.notifyCap);

  const at = nowIso();
  const expiresAt = isoIn(DISPATCH.offerTtlMs);
  for (const driver of candidates) {
    db.run(
      `INSERT INTO dispatch_attempts (booking_id, driver_id, round, offered_at, expires_at, outcome)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [booking.id, driver.id, round, at, expiresAt],
    );
    notify(
      db,
      driver.user_id,
      'ride',
      'New ride nearby',
      `${booking.pickup} → ${booking.dropoff} · ${booking.fare} ETB`,
      '#/driver?tab=requests',
    );
  }

  db.run(
    `UPDATE bookings SET dispatch_state = 'searching', dispatch_round = ?, dispatch_deadline = ?
      WHERE id = ? AND status = 'requested'`,
    [round, expiresAt, booking.id],
  );

  return candidates.length;
}

/** Terminal state: nobody accepted after every round. Rider is never charged. */
export function markNoDriverFound(db, booking) {
  const reason = resolveCancelReason('system', 'NO_DRIVER_FOUND');
  db.tx(() => {
    const changed = db.run(
      `UPDATE bookings SET status = 'cancelled', cancelled_at = ?, dispatch_state = 'failed', dispatch_deadline = NULL
        WHERE id = ? AND status = 'requested'`,
      [nowIso(), booking.id],
    );
    if (changed.changes === 0) return;
    db.run(
      `UPDATE dispatch_attempts SET outcome = 'timeout', responded_at = ?
        WHERE booking_id = ? AND outcome = 'pending'`,
      [nowIso(), booking.id],
    );
    recordCancellation(db, {
      bookingId: booking.id,
      role: 'system',
      userId: null,
      reason,
      outcome: 'trip_cancelled',
      note: 'No driver accepted after all dispatch rounds.',
    });
  });

  notify(
    db,
    booking.customer.id,
    'ride',
    'No driver available',
    'We could not find a driver for this trip. You have not been charged — please try again shortly.',
    `#/ride/${booking.id}`,
  );
}

/**
 * Advances an expired dispatch round. Safe to call on every read: it is a no-op
 * while the current round is still inside its deadline.
 */
export function sweep(db, booking) {
  if (!booking || booking.status !== 'requested') return booking;

  const deadline = booking.dispatch?.deadline;
  if (deadline && Date.parse(deadline) > Date.now()) return booking;

  const round = Number(booking.dispatch?.round ?? 0);
  const next = round + 1;

  if (next >= DISPATCH.maxRounds) {
    markNoDriverFound(db, booking);
    return getBooking(db, booking.id) ?? booking;
  }

  const reached = broadcast(db, booking, next);
  if (reached === 0 && next >= DISPATCH.maxRounds - 1) {
    markNoDriverFound(db, booking);
  }
  return getBooking(db, booking.id) ?? booking;
}

/** Distance-based pickup estimate, matching the driver UI formula. */
export function etaMinutes(distanceKm) {
  return Math.max(Math.round((Number(distanceKm) / 24) * 60 + 2), 2);
}
