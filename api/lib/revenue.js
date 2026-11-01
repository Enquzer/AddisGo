/*
 * Revenue model: commission or incentive.
 *
 * The admin chooses one platform-wide model:
 *
 *   commission → the driver keeps fare − commission_rate%
 *   incentive  → the driver keeps fare + incentive_rate% (paid by AddisGo)
 *
 * Every completed trip is written once to trip_ledger. The ledger is the source
 * of truth for driver take-home, platform revenue and payouts; `bookings.fare`
 * stays the rider-facing gross price.
 */

import { daysAgo, nowIso, round1, todayUtc } from './util.js';

export const REVENUE_MODELS = ['commission', 'incentive'];

export const REVENUE_DEFAULTS = {
  model: 'commission',
  commission_rate: 15,
  incentive_rate: 5,
};

const META_KEYS = {
  model: 'revenue_model',
  commission_rate: 'commission_rate',
  incentive_rate: 'incentive_rate',
};

const money = (value) => Math.round(Number(value || 0) * 100) / 100;

function readMeta(db, key, fallback) {
  const row = db.get('SELECT value FROM meta WHERE key = ?', [key]);
  return row ? row.value : fallback;
}

function clampRate(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, 0), 50);
}

export function getRevenueConfig(db) {
  const rawModel = String(readMeta(db, META_KEYS.model, REVENUE_DEFAULTS.model)).toLowerCase();
  const model = REVENUE_MODELS.includes(rawModel) ? rawModel : REVENUE_DEFAULTS.model;
  return {
    model,
    commission_rate: clampRate(readMeta(db, META_KEYS.commission_rate, REVENUE_DEFAULTS.commission_rate), REVENUE_DEFAULTS.commission_rate),
    incentive_rate: clampRate(readMeta(db, META_KEYS.incentive_rate, REVENUE_DEFAULTS.incentive_rate), REVENUE_DEFAULTS.incentive_rate),
    updated_at: readMeta(db, 'revenue_updated_at', ''),
  };
}

export function saveRevenueConfig(db, { model, commission_rate, incentive_rate }) {
  const nextModel = String(model ?? '').trim().toLowerCase();
  if (!REVENUE_MODELS.includes(nextModel)) {
    throw new Error('Choose commission or incentive as the revenue model.');
  }
  const commission = clampRate(commission_rate, REVENUE_DEFAULTS.commission_rate);
  const incentive = clampRate(incentive_rate, REVENUE_DEFAULTS.incentive_rate);
  const at = nowIso();
  db.tx(() => {
    db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [META_KEYS.model, nextModel]);
    db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [META_KEYS.commission_rate, String(commission)]);
    db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [META_KEYS.incentive_rate, String(incentive)]);
    db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', ['revenue_updated_at', at]);
  });
  return getRevenueConfig(db);
}

/** Pure quote so the UI can preview a fare split before saving a config. */
export function quoteFare(config, fare) {
  const gross = money(fare);
  const commission = config.model === 'commission'
    ? money((gross * Number(config.commission_rate || 0)) / 100)
    : 0;
  const incentive = config.model === 'incentive'
    ? money((gross * Number(config.incentive_rate || 0)) / 100)
    : 0;
  return {
    model: config.model,
    fare: gross,
    commission_rate: config.model === 'commission' ? Number(config.commission_rate || 0) : 0,
    commission_amount: commission,
    incentive_rate: config.model === 'incentive' ? Number(config.incentive_rate || 0) : 0,
    incentive_amount: incentive,
    driver_earning: money(config.model === 'commission' ? gross - commission : gross + incentive),
    platform_earning: money(config.model === 'commission' ? commission : -incentive),
  };
}

function mapLedger(row) {
  return {
    id: row.id,
    booking_id: row.booking_id,
    driver_id: row.driver_id,
    customer_id: row.customer_id,
    fare: Number(row.fare),
    model: row.model,
    commission_rate: Number(row.commission_rate),
    commission_amount: Number(row.commission_amount),
    incentive_rate: Number(row.incentive_rate),
    incentive_amount: Number(row.incentive_amount),
    driver_earning: Number(row.driver_earning),
    platform_earning: Number(row.platform_earning),
    created_at: row.created_at,
  };
}

/**
 * Writes the ledger row for a completed trip. Idempotent: the UNIQUE booking_id
 * means a double "complete" click can never double-pay a driver.
 */
export function settleBooking(db, booking) {
  if (!booking || !booking.id) return null;
  const existing = db.get('SELECT * FROM trip_ledger WHERE booking_id = ?', [booking.id]);
  if (existing) return mapLedger(existing);

  const config = getRevenueConfig(db);
  const split = quoteFare(config, booking.fare);
  db.run(
    `INSERT OR IGNORE INTO trip_ledger
       (booking_id, driver_id, customer_id, fare, model, commission_rate, commission_amount,
        incentive_rate, incentive_amount, driver_earning, platform_earning, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      booking.id,
      booking.driver_id ?? null,
      booking.customer_id ?? null,
      split.fare,
      split.model,
      split.commission_rate,
      split.commission_amount,
      split.incentive_rate,
      split.incentive_amount,
      split.driver_earning,
      split.platform_earning,
      nowIso(),
    ],
  );
  return mapLedger(db.get('SELECT * FROM trip_ledger WHERE booking_id = ?', [booking.id]));
}

/** Backfills any completed trips that predate the ledger (safe to run often). */
export function backfillLedger(db) {
  const rows = db.all(
    `SELECT b.id, b.fare, b.driver_id, b.customer_id
       FROM bookings b LEFT JOIN trip_ledger l ON l.booking_id = b.id
      WHERE b.status = 'completed' AND l.id IS NULL`,
  );
  if (!rows.length) return 0;
  db.tx(() => {
    for (const row of rows) settleBooking(db, row);
  });
  return rows.length;
}

/** Driver take-home rollup, with gross and the platform split alongside it. */
export function driverEarnings(db, driverId) {
  const today = todayUtc();
  const weekAgo = daysAgo(7);
  const scalar = (column, where, params) => {
    const row = db.get(
      `SELECT COALESCE(SUM(${column}), 0) AS total FROM trip_ledger WHERE driver_id = ?${where}`,
      [driverId, ...params],
    );
    return Number(row?.total ?? 0);
  };

  const todayWhere = ' AND substr(created_at, 1, 10) = ?';
  const weekWhere = ' AND created_at >= ?';

  return {
    gross_today: round1(scalar('fare', todayWhere, [today])),
    gross_week: round1(scalar('fare', weekWhere, [weekAgo])),
    gross_total: round1(scalar('fare', '', [])),
    commission_today: round1(scalar('commission_amount', todayWhere, [today])),
    commission_week: round1(scalar('commission_amount', weekWhere, [weekAgo])),
    commission_total: round1(scalar('commission_amount', '', [])),
    incentive_today: round1(scalar('incentive_amount', todayWhere, [today])),
    incentive_week: round1(scalar('incentive_amount', weekWhere, [weekAgo])),
    incentive_total: round1(scalar('incentive_amount', '', [])),
    earnings_today: round1(scalar('driver_earning', todayWhere, [today])),
    earnings_week: round1(scalar('driver_earning', weekWhere, [weekAgo])),
    earnings_total: round1(scalar('driver_earning', '', [])),
    trips_today: Number(db.get(
      'SELECT COUNT(*) AS n FROM trip_ledger WHERE driver_id = ? AND substr(created_at, 1, 10) = ?',
      [driverId, today],
    )?.n ?? 0),
  };
}

/** Admin revenue dashboard: config, window totals, per-driver rollup and ledger. */
export function revenueSummary(db, { days = 30, limit = 50 } = {}) {
  const since = daysAgo(days);
  const config = getRevenueConfig(db);
  const scalar = (column, where = '', params = []) => Number(
    db.get(
      `SELECT COALESCE(SUM(${column}), 0) AS total FROM trip_ledger WHERE created_at >= ?${where}`,
      [since, ...params],
    )?.total ?? 0,
  );
  const count = Number(db.get(
    'SELECT COUNT(*) AS n FROM trip_ledger WHERE created_at >= ?',
    [since],
  )?.n ?? 0);

  const byDriver = db.all(
    `SELECT l.driver_id, u.name, d.vehicle_class,
            COUNT(*) AS trips, SUM(l.fare) AS gross,
            SUM(l.commission_amount) AS commission, SUM(l.incentive_amount) AS incentive,
            SUM(l.driver_earning) AS take_home
       FROM trip_ledger l
       LEFT JOIN drivers d ON d.id = l.driver_id
       LEFT JOIN users u ON u.id = d.user_id
      WHERE l.created_at >= ? AND l.driver_id IS NOT NULL
      GROUP BY l.driver_id
      ORDER BY take_home DESC
      LIMIT 12`,
    [since],
  ).map((row) => ({
    driver_id: row.driver_id,
    name: row.name ?? 'Removed driver',
    vehicle_class: row.vehicle_class ?? null,
    trips: Number(row.trips),
    gross: round1(Number(row.gross ?? 0)),
    commission: round1(Number(row.commission ?? 0)),
    incentive: round1(Number(row.incentive ?? 0)),
    take_home: round1(Number(row.take_home ?? 0)),
  }));

  const recent = db.all(
    `SELECT l.*, b.code, cu.name AS rider_name, du.name AS driver_name
       FROM trip_ledger l
       LEFT JOIN bookings b ON b.id = l.booking_id
       LEFT JOIN users cu ON cu.id = l.customer_id
       LEFT JOIN drivers d ON d.id = l.driver_id
       LEFT JOIN users du ON du.id = d.user_id
      ORDER BY l.id DESC LIMIT ?`,
    [Math.min(Math.max(Number(limit) || 50, 1), 200)],
  ).map((row) => ({
    ...mapLedger(row),
    code: row.code ?? '',
    rider_name: row.rider_name ?? '—',
    driver_name: row.driver_name ?? '—',
  }));

  const daily = db.all(
    `SELECT substr(created_at, 1, 10) AS date, COUNT(*) AS trips,
            SUM(fare) AS gross, SUM(driver_earning) AS take_home,
            SUM(platform_earning) AS platform
       FROM trip_ledger WHERE created_at >= ?
      GROUP BY date ORDER BY date ASC`,
    [since],
  ).map((row) => ({
    date: row.date,
    trips: Number(row.trips),
    gross: round1(Number(row.gross ?? 0)),
    take_home: round1(Number(row.take_home ?? 0)),
    platform: round1(Number(row.platform ?? 0)),
  }));

  return {
    config,
    window_days: days,
    since,
    totals: {
      trips: count,
      gross: round1(scalar('fare')),
      commission: round1(scalar('commission_amount')),
      incentive: round1(scalar('incentive_amount')),
      driver_earnings: round1(scalar('driver_earning')),
      platform_earnings: round1(scalar('platform_earning')),
      avg_fare: count ? round1(scalar('fare') / count) : 0,
    },
    by_driver: byDriver,
    daily,
    recent,
  };
}
