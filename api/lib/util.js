/* Shared helpers. Mirrors the pricing, distance and validation rules used by the UI. */

export const CLASSES = [
  { key: 'e2', label: 'Electric E2', base: 70, perKm: 20, perMin: 2.5, minimum: 90, seats: 4 },
  { key: 'comfort', label: 'Comfort', base: 105, perKm: 28, perMin: 3, minimum: 140, seats: 4 },
  { key: 'van', label: 'Tour Van', base: 180, perKm: 38, perMin: 4, minimum: 250, seats: 7 },
  { key: 'bajaj', label: 'Bajaj', base: 40, perKm: 14, perMin: 1.2, minimum: 60, seats: 3 },
];

export const CLASS_KEYS = CLASSES.map((c) => c.key);

export function classInfo(key) {
  return CLASSES.find((c) => c.key === key) || null;
}

export function charLen(value) {
  return Array.from(String(value ?? '')).length;
}

export function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** UTC calendar day (YYYY-MM-DD) used by the earnings and CRM rollups. */
export function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

export function isoFrom(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function daysAgo(days, hours = 0) {
  return isoFrom(Date.now() - days * 86400000 - hours * 3600000);
}

/** Addis Ababa is UTC+3 all year; build a UTC instant from a local wall-clock time. */
export function addisTimeIn(days, hour, minute) {
  const target = new Date(Date.now() + days * 86400000);
  return isoFrom(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate(), hour, minute, 0) - 3 * 3600000,
  );
}

export function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const rad = (v) => (v * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const lat1 = rad(aLat);
  const lat2 = rad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Addis traffic makes the road distance longer than a straight line. */
export function roadDistanceKm(aLat, aLng, bLat, bLng) {
  return Math.max(haversineKm(aLat, aLng, bLat, bLng) * 1.28, 0.4);
}

export function estimate(key, distanceKm) {
  const info = classInfo(key);
  if (!info) return null;
  const duration = Math.max(Math.round((distanceKm / 24) * 60 + 3), 5);
  const raw = info.base + info.perKm * distanceKm + info.perMin * duration;
  const fare = Math.round(Math.max(raw, info.minimum) / 5) * 5;
  return { fare, durationMin: duration };
}

/** A smooth, deterministic approximate route for the map preview. */
export function routePoints(aLat, aLng, bLat, bLng) {
  const dx = bLng - aLng;
  const dy = bLat - aLat;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-9) return [[aLat, aLng], [bLat, bLng]];
  const bend = 0.09;
  const px = (-dy / len) * len * bend;
  const py = (dx / len) * len * bend;
  const points = [];
  for (let i = 0; i <= 17; i += 1) {
    const t = i / 17;
    const curve = 4 * t * (1 - t);
    points.push([aLat + dy * t + py * curve, aLng + dx * t + px * curve]);
  }
  return points;
}

export function validCoords(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= 4 &&
    lat <= 15.5 &&
    lng >= 32 &&
    lng <= 48.5
  );
}

export function splitLanguages(value) {
  const out = [];
  for (const part of String(value ?? '').split(',')) {
    const item = part.trim();
    if (!item || charLen(item) > 30) continue;
    if (!out.some((v) => v.toLowerCase() === item.toLowerCase())) out.push(item);
    if (out.length >= 6) break;
  }
  if (!out.length) out.push('English');
  return out;
}

export function joinLanguages(languages) {
  const cleaned = (Array.isArray(languages) ? languages : [])
    .map((s) => String(s ?? '').trim())
    .filter((s) => s && charLen(s) <= 30)
    .slice(0, 6);
  return cleaned.length ? cleaned.join(', ') : 'English';
}

export function validEmail(email) {
  const value = String(email ?? '').trim();
  if (value.length > 254 || /\s/.test(value)) return false;
  const parts = value.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  return (
    local.length > 0 &&
    local.length <= 64 &&
    domain.includes('.') &&
    !domain.startsWith('.') &&
    !domain.endsWith('.')
  );
}

export function validPhone(phone) {
  const value = String(phone ?? '');
  const digits = (value.match(/[0-9]/g) || []).length;
  return digits >= 7 && digits <= 15 && /^[0-9+\-() ]*$/.test(value);
}

export function validColor(color) {
  return /^#[0-9a-fA-F]{6}$/.test(String(color ?? ''));
}

export function clampText(value, max) {
  return Array.from(String(value ?? '').trim()).slice(0, max).join('');
}

/** Validates a rider/driver supplied ISO timestamp and normalises it to UTC seconds. */
export function parseScheduled(value, maxDays) {
  const raw = String(value ?? '').trim();
  const ms = Date.parse(raw);
  if (!raw || !Number.isFinite(ms)) throw new Error('Please choose a valid date and time.');
  if (ms < Date.now() + 2 * 60000) throw new Error('Please choose a time in the future.');
  if (ms > Date.now() + maxDays * 86400000) {
    throw new Error(`Please choose a time within the next ${maxDays} days.`);
  }
  return isoFrom(ms);
}

export function startsInPast(value) {
  const ms = Date.parse(String(value ?? ''));
  return !Number.isFinite(ms) || ms <= Date.now();
}

export function money(value) {
  return `${Math.round(Number(value) || 0)} ETB`;
}

export function avatarColorFor(name) {
  const palette = ['#145c45', '#e86a4a', '#4a7c9e', '#b06ab3', '#c47c2b', '#3b6ea5'];
  const code = String(name ?? '').codePointAt(0) || 0;
  return palette[code % palette.length];
}

export function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}
