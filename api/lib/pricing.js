import { CLASSES } from './util.js';

const FARE_SELECT = 'SELECT key, label, base, per_km, per_min, minimum, seats, is_active, updated_at FROM fare_classes';

export function mapFare(row) {
  return {
    key: row.key,
    label: row.label,
    base: Number(row.base),
    per_km: Number(row.per_km),
    per_min: Number(row.per_min),
    minimum: Number(row.minimum),
    seats: Number(row.seats),
    is_active: Boolean(row.is_active),
    updated_at: row.updated_at,
  };
}

export function listFares(db, { activeOnly = false } = {}) {
  const rows = db.all(`${FARE_SELECT}${activeOnly ? ' WHERE is_active = 1' : ''}`);
  const byKey = new Map(rows.map((row) => [row.key, mapFare(row)]));
  return CLASSES.map((fare) => byKey.get(fare.key)).filter(Boolean);
}

export function fareFor(db, key) {
  const row = db.get(`${FARE_SELECT} WHERE key = ?`, [key]);
  return row && row.is_active ? mapFare(row) : null;
}

/** Same duration model as the original estimate(), but driven by saved fares. */
export function priceFor(fare, distanceKm) {
  if (!fare) return null;
  const duration = Math.max(Math.round((distanceKm / 24) * 60 + 3), 5);
  const raw = fare.base + fare.per_km * distanceKm + fare.per_min * duration;
  return {
    fare: Math.round(Math.max(raw, fare.minimum) / 5) * 5,
    durationMin: duration,
  };
}

export function priceClass(db, key, distanceKm) {
  return priceFor(fareFor(db, key), distanceKm);
}
