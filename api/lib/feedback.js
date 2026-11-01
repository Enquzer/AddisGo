/*
 * Feedback domain: cancellation taxonomy + rating scoring.
 *
 * Cancellation reason codes are stable identifiers used by analytics, dispute
 * handling and fee logic. Labels are display-only. `blame` decides who owns the
 * outcome: a rider-fault cancellation may carry a fee, a driver-fault one never
 * does, and a platform fault must never count against either party.
 */

import { nowIso } from './util.js';

export const CANCEL_REASONS = {
  rider: [
    { code: 'ACCIDENTAL', label: 'Requested by accident', blame: 'none', fee: 0 },
    { code: 'CHANGED_MIND', label: 'Changed my mind', blame: 'rider', fee: 1 },
    { code: 'WAIT_TOO_LONG', label: 'Driver took too long', blame: 'driver', fee: 0 },
    { code: 'DRIVER_ASKED', label: 'Driver asked me to cancel', blame: 'driver', fee: 0 },
    { code: 'ETA_INCREASED', label: 'Wait time kept increasing', blame: 'platform', fee: 0 },
    { code: 'FARE_TOO_HIGH', label: 'Fare was too high', blame: 'rider', fee: 1 },
    { code: 'FOUND_ALTERNATIVE', label: 'Found another ride', blame: 'rider', fee: 1 },
    { code: 'ADDRESS_WRONG', label: 'Wrong pickup or drop-off', blame: 'rider', fee: 1 },
    { code: 'SAFETY_CONCERN', label: 'Safety concern', blame: 'none', fee: 0 },
    { code: 'OTHER', label: 'Something else', blame: 'none', fee: 0 },
  ],
  driver: [
    { code: 'RIDER_NO_SHOW', label: 'Rider did not show up', blame: 'rider', fee: 0 },
    { code: 'RIDER_UNREACHABLE', label: 'Could not reach the rider', blame: 'rider', fee: 0 },
    { code: 'UNSAFE_PICKUP', label: 'Unsafe pickup location', blame: 'none', fee: 0 },
    { code: 'VEHICLE_ISSUE', label: 'Vehicle problem', blame: 'driver', fee: 0 },
    { code: 'TOO_FAR', label: 'Pickup too far away', blame: 'driver', fee: 0 },
    { code: 'ACCEPTED_BY_MISTAKE', label: 'Accepted by mistake', blame: 'driver', fee: 0 },
    { code: 'RIDER_REQUESTED', label: 'Rider asked me to cancel', blame: 'rider', fee: 0 },
    { code: 'OTHER', label: 'Something else', blame: 'none', fee: 0 },
  ],
  system: [
    { code: 'NO_DRIVER_FOUND', label: 'No driver available', blame: 'platform', fee: 0 },
    { code: 'PAYMENT_FAILED', label: 'Payment failed', blame: 'platform', fee: 0 },
    { code: 'PROVIDER_ERROR', label: 'Service error', blame: 'platform', fee: 0 },
  ],
};

const BY_ROLE = new Map(
  Object.entries(CANCEL_REASONS).map(([role, list]) => [role, new Map(list.map((r) => [r.code, r]))]),
);

export function cancelReasonsFor(role) {
  return CANCEL_REASONS[role] ?? CANCEL_REASONS.rider;
}

/** Never throws: unknown or missing codes fall back to OTHER for that role. */
export function resolveCancelReason(role, code) {
  const table = BY_ROLE.get(role) ?? BY_ROLE.get('rider');
  const wanted = String(code ?? '').trim().toUpperCase();
  return table.get(wanted) ?? table.get('OTHER');
}

export function recordCancellation(db, { bookingId, role, userId, reason, outcome, note = '' }) {
  db.run(
    `INSERT INTO cancellations
       (booking_id, cancelled_by_role, cancelled_by_user, reason_code, blame_party,
        fee_applied, outcome, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      bookingId,
      role,
      userId ?? null,
      reason.code,
      reason.blame,
      reason.fee ? 1 : 0,
      outcome,
      String(note ?? '').slice(0, 200),
      nowIso(),
    ],
  );
}

/* --- Ratings ------------------------------------------------------------ */

export const RATING_TAGS = [
  { code: 'clean_car', label: 'Clean car' },
  { code: 'comfortable', label: 'Comfortable' },
  { code: 'on_time', label: 'On time' },
  { code: 'great_service', label: 'Great service' },
  { code: 'safe_driving', label: 'Safe driving' },
  { code: 'friendly', label: 'Friendly' },
  { code: 'quiet_ride', label: 'Quiet ride' },
  { code: 'smooth_route', label: 'Smooth route' },
];

/** Driver → rider tags. Same storage, different vocabulary. */
export const RIDER_TAGS = [
  { code: 'ready_on_time', label: 'Ready on time' },
  { code: 'polite', label: 'Polite' },
  { code: 'clear_pickup', label: 'Clear pickup point' },
  { code: 'respectful', label: 'Respectful' },
  { code: 'no_show', label: 'Did not show up' },
];

const TAGS_BY_ROLE = {
  rider: new Map(RATING_TAGS.map((t) => [t.code, t])),
  driver: new Map(RIDER_TAGS.map((t) => [t.code, t])),
};

export function tagsFor(role) {
  return role === 'driver' ? RIDER_TAGS : RATING_TAGS;
}

export function sanitizeTags(value, role = 'rider') {
  const allowed = TAGS_BY_ROLE[role] ?? TAGS_BY_ROLE.rider;
  const raw = Array.isArray(value) ? value : [];
  const out = [];
  for (const item of raw) {
    const code = String(item ?? '').trim().toLowerCase();
    if (allowed.has(code) && !out.includes(code)) out.push(code);
    if (out.length >= 6) break;
  }
  return out;
}

/*
 * Bayesian smoothing keeps a driver with two trips from showing 1.0 or 5.0.
 * PRIOR_MEAN is the platform prior; PRIOR_WEIGHT is how many "virtual" ratings
 * it is worth. Scores are computed over the most recent WINDOW ratings only, so
 * a driver can recover from a bad patch.
 */
const PRIOR_MEAN = 4.5;
const PRIOR_WEIGHT = 10;
const WINDOW = 200;

export function bayesianScore(sum, count) {
  return Math.round(((PRIOR_WEIGHT * PRIOR_MEAN + Number(sum)) / (PRIOR_WEIGHT + Number(count))) * 100) / 100;
}

function windowedScore(db, sql, id) {
  const rows = db.all(sql, [id, WINDOW]);
  const count = rows.length;
  const sum = rows.reduce((total, row) => total + Number(row.overall), 0);
  return { count, score: bayesianScore(sum, count) };
}

/** Recomputes a driver's displayed score from real ratings. Leaves seeded demo values alone. */
export function refreshDriverScore(db, driverId) {
  const { count, score } = windowedScore(
    db,
    `SELECT overall FROM ratings WHERE driver_id = ? AND rater_role = 'rider' ORDER BY id DESC LIMIT ?`,
    driverId,
  );
  if (count === 0) return;
  db.run('UPDATE drivers SET rating = ?, rating_count = ? WHERE id = ?', [score, count, driverId]);
}

/** Recomputes a rider's reputation from driver ratings. */
export function refreshUserScore(db, userId) {
  const { count, score } = windowedScore(
    db,
    `SELECT overall FROM ratings WHERE customer_id = ? AND rater_role = 'driver' ORDER BY id DESC LIMIT ?`,
    userId,
  );
  if (count === 0) return;
  db.run('UPDATE users SET rating = ?, rating_count = ? WHERE id = ?', [score, count, userId]);
}

export function ratingSummary(db, { driverId = null, customerId = null, raterRole = 'rider' } = {}) {
  const column = driverId != null ? 'driver_id' : 'customer_id';
  const id = driverId != null ? driverId : customerId;
  if (id == null) return null;

  const rows = db.all(
    `SELECT overall, car_condition, comfort, cleanliness, service, safety, punctuality, tags
       FROM ratings WHERE ${column} = ? AND rater_role = ? ORDER BY id DESC LIMIT ?`,
    [id, raterRole, WINDOW],
  );
  if (!rows.length) return { count: 0, score: null, breakdown: {}, tags: [] };

  const avg = (key) => {
    const values = rows.map((r) => Number(r[key])).filter((n) => Number.isFinite(n) && n > 0);
    if (!values.length) return null;
    return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
  };
  const tagCounts = new Map();
  for (const row of rows) {
    let parsed = [];
    try { parsed = JSON.parse(row.tags || '[]'); } catch { parsed = []; }
    for (const tag of parsed) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }

  return {
    count: rows.length,
    score: bayesianScore(rows.reduce((a, r) => a + Number(r.overall), 0), rows.length),
    breakdown: {
      car_condition: avg('car_condition'),
      comfort: avg('comfort'),
      cleanliness: avg('cleanliness'),
      service: avg('service'),
      safety: avg('safety'),
      punctuality: avg('punctuality'),
    },
    tags: [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ code, count })),
  };
}
