/*
 * Driver presence, heartbeats and air-time.
 *
 * A driver is "online" in two places: drivers.is_online (what dispatch reads)
 * and an open driver_sessions row (what billing/analytics reads). They are kept
 * in sync here so the UI can distinguish:
 *
 *   offline      → no open session
 *   online       → open session with a recent heartbeat
 *   app closed   → heartbeat stopped; the session is closed retroactively at the
 *                  last heartbeat and the driver is removed from dispatch
 *
 * Air-time is the time a driver is online but not carrying a rider. It is the
 * honest measure of supply: a driver who leaves the app open and never accepts
 * trips accumulates air-time, not earnings.
 */

import { nowIso } from './util.js';

export const PRESENCE = {
  /** Clients should beat at least this often. */
  heartbeatMs: 25_000,
  /** Two missed beats (plus slack) means the app is gone. */
  staleMs: 120_000,
  /** Don't count a session shorter than this as a real "shift". */
  minSessionMs: 30_000,
};

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const minutes = (ms) => Math.max(0, Math.round((ms / 60000) * 10) / 10);

function openRow(db, driverId) {
  return db.get(
    'SELECT * FROM driver_sessions WHERE driver_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1',
    [driverId],
  );
}

/** Opens (or refreshes) the driver's current online session. */
export function openSession(db, driverId, { lat = null, lng = null } = {}) {
  const at = nowIso();
  const existing = openRow(db, driverId);
  if (existing) {
    db.run(
      `UPDATE driver_sessions
          SET last_heartbeat = ?, lat = COALESCE(?, lat), lng = COALESCE(?, lng)
        WHERE id = ?`,
      [at, lat == null ? null : Number(lat), lng == null ? null : Number(lng), existing.id],
    );
    return { id: existing.id, started_at: existing.started_at, last_heartbeat: at, resumed: true };
  }
  const created = db.run(
    `INSERT INTO driver_sessions (driver_id, started_at, last_heartbeat, end_reason, lat, lng)
     VALUES (?, ?, ?, 'active', ?, ?)`,
    [driverId, at, at, lat == null ? null : Number(lat), lng == null ? null : Number(lng)],
  );
  return { id: created.lastInsertRowid, started_at: at, last_heartbeat: at, resumed: false };
}

/** Closes any open session for a driver. Idempotent. */
export function closeSession(db, driverId, reason = 'offline', { at = null } = {}) {
  const stamp = at || nowIso();
  const changed = db.run(
    `UPDATE driver_sessions SET ended_at = ?, end_reason = ?
      WHERE driver_id = ? AND ended_at IS NULL`,
    [stamp, reason, driverId],
  );
  return changed.changes;
}

/**
 * Marks app-closed drivers offline. The session ends at the last heartbeat, not
 * "now", so we never credit air-time for a phone that was in a pocket.
 * Safe to call often; it is a single indexed read in the common case.
 */
export function closeStaleSessions(db, { staleMs = PRESENCE.staleMs } = {}) {
  const cutoff = iso(Date.now() - staleMs);
  const rows = db.all(
    `SELECT id, driver_id, last_heartbeat FROM driver_sessions
      WHERE ended_at IS NULL AND last_heartbeat < ?`,
    [cutoff],
  );
  if (!rows.length) return 0;

  db.tx(() => {
    for (const row of rows) {
      db.run(
        `UPDATE driver_sessions SET ended_at = ?, end_reason = 'app_closed' WHERE id = ?`,
        [row.last_heartbeat, row.id],
      );
      db.run('UPDATE drivers SET is_online = 0 WHERE id = ? AND is_online = 1', [row.driver_id]);
    }
  });
  return rows.length;
}

/** Records a beat and keeps drivers.is_online/last_heartbeat current. */
export function heartbeat(db, driverId, { lat = null, lng = null } = {}) {
  closeStaleSessions(db);
  const session = openSession(db, driverId, { lat, lng });
  const at = nowIso();
  db.run('UPDATE drivers SET last_heartbeat = ?, is_online = 1 WHERE id = ?', [at, driverId]);
  if (lat != null && lng != null) {
    db.run('UPDATE drivers SET lat = ?, lng = ? WHERE id = ?', [Number(lat), Number(lng), driverId]);
  }
  const onlineMs = Math.max(0, Date.parse(at) - Date.parse(session.started_at));
  return {
    session_id: session.id,
    started_at: session.started_at,
    last_heartbeat: at,
    online_seconds: Math.round(onlineMs / 1000),
    resumed: session.resumed,
  };
}

/* --- Metrics ------------------------------------------------------------ */

function parse(value) {
  const ms = Date.parse(String(value ?? ''));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Online/busy/idle minutes for one driver since an ISO timestamp.
 * Sessions that straddle `since` are clipped rather than dropped.
 */
export function driverAirtime(db, driverId, since) {
  const sinceMs = parse(since) ?? 0;
  const now = Date.now();

  const rows = db.all(
    `SELECT started_at, ended_at, end_reason FROM driver_sessions
      WHERE driver_id = ? AND (ended_at IS NULL OR ended_at >= ?) AND started_at <= ?`,
    [driverId, iso(sinceMs), iso(now)],
  );

  let onlineMs = 0;
  let sessions = 0;
  let appClosed = 0;
  let explicitOffline = 0;
  let longestMs = 0;
  let openStartedAt = null;

  for (const row of rows) {
    const rawStart = parse(row.started_at);
    if (rawStart == null) continue;
    const start = Math.max(rawStart, sinceMs);
    const end = row.ended_at ? parse(row.ended_at) : now;
    if (end == null || end <= start) continue;
    const span = end - start;
    if (span < PRESENCE.minSessionMs) continue;
    onlineMs += span;
    sessions += 1;
    longestMs = Math.max(longestMs, span);
    if (row.ended_at == null) openStartedAt = row.started_at;
    else if (row.end_reason === 'app_closed') appClosed += 1;
    else if (row.end_reason === 'offline') explicitOffline += 1;
  }

  // Busy = accepted → completed (or now for a live trip). Capped at online time.
  const trips = db.all(
    `SELECT accepted_at, completed_at FROM bookings
      WHERE driver_id = ? AND accepted_at IS NOT NULL
        AND (completed_at IS NULL OR completed_at >= ?)`,
    [driverId, iso(sinceMs)],
  );
  let busyMs = 0;
  for (const trip of trips) {
    const start = Math.max(parse(trip.accepted_at) ?? 0, sinceMs);
    const end = trip.completed_at ? parse(trip.completed_at) : now;
    if (end == null || end <= start) continue;
    busyMs += end - start;
  }
  busyMs = Math.min(busyMs, onlineMs);

  const offers = db.get(
    `SELECT
       SUM(CASE WHEN outcome = 'accepted' THEN 1 ELSE 0 END) AS accepted,
       SUM(CASE WHEN outcome = 'declined' THEN 1 ELSE 0 END) AS declined,
       SUM(CASE WHEN outcome = 'timeout' THEN 1 ELSE 0 END) AS timed_out,
       COUNT(*) AS total
     FROM dispatch_attempts WHERE driver_id = ? AND offered_at >= ?`,
    [driverId, iso(sinceMs)],
  );
  const accepted = Number(offers?.accepted ?? 0);
  const declined = Number(offers?.declined ?? 0);
  const answered = accepted + declined;

  return {
    sessions,
    online_minutes: minutes(onlineMs),
    busy_minutes: minutes(busyMs),
    idle_minutes: minutes(Math.max(onlineMs - busyMs, 0)),
    avg_session_minutes: sessions ? minutes(onlineMs / sessions) : 0,
    longest_session_minutes: minutes(longestMs),
    app_closed_sessions: appClosed,
    offline_sessions: explicitOffline,
    online_since: openStartedAt,
    offers: Number(offers?.total ?? 0),
    accepted_offers: accepted,
    declined_offers: declined,
    timed_out_offers: Number(offers?.timed_out ?? 0),
    acceptance_rate: answered ? Math.round((accepted / answered) * 1000) / 10 : null,
  };
}

/** Fleet-wide air-time and acceptance, plus a per-driver leaderboard. */
export function fleetAirtime(db, since, { onlineNow = null } = {}) {
  const drivers = db.all(
    `SELECT d.id, d.is_online, d.last_heartbeat, u.name
       FROM drivers d JOIN users u ON u.id = d.user_id
      WHERE d.status = 'approved'`,
  );

  const rows = drivers.map((driver) => {
    const air = driverAirtime(db, driver.id, since);
    return {
      id: driver.id,
      name: driver.name,
      is_online: Boolean(driver.is_online),
      last_heartbeat: driver.last_heartbeat ?? null,
      ...air,
    };
  });

  const sum = (key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
  const sessions = sum('sessions');
  const onlineMinutes = sum('online_minutes');
  const idleMinutes = sum('idle_minutes');
  const accepted = sum('accepted_offers');
  const declined = sum('declined_offers');
  const answered = accepted + declined;
  const appClosed = sum('app_closed_sessions');

  return {
    online_now: onlineNow == null
      ? rows.filter((row) => row.is_online).length
      : Number(onlineNow),
    sessions,
    app_closed_sessions: appClosed,
    app_closed_share: sessions ? Math.round((appClosed / sessions) * 1000) / 10 : 0,
    online_minutes: onlineMinutes,
    idle_minutes: idleMinutes,
    avg_session_minutes: sessions ? Math.round((onlineMinutes / sessions) * 10) / 10 : 0,
    avg_idle_minutes: sessions ? Math.round((idleMinutes / sessions) * 10) / 10 : 0,
    acceptance_rate: answered ? Math.round((accepted / answered) * 1000) / 10 : null,
    offers: accepted + declined + sum('timed_out_offers'),
    accepted_offers: accepted,
    declined_offers: declined,
    drivers: rows
      .filter((row) => row.sessions > 0 || row.is_online)
      .sort((a, b) => b.online_minutes - a.online_minutes || b.sessions - a.sessions)
      .slice(0, 12),
  };
}
