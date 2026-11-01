/*
 * Demand geography.
 *
 * Rides are aggregated into geohash cells (~1.2 km at precision 6) instead of a
 * raw lat/lng scatter. That is coarse enough to protect rider privacy and fine
 * enough to see that Bole is hot while Sarbet is quiet. Each cell carries:
 *
 *   requests / hour  → demand
 *   completed / fare → how much of that demand actually paid off
 *   online drivers   → current supply
 *   pressure         → demand ÷ supply, the input to the surge suggestion
 *
 * Success rate is completed ÷ requested, and gross is the sum of fares on
 * completed trips. Both are compared against the citywide totals so the admin
 * map can show which areas outperform the rest.
 *
 * Surge is a *suggestion* for operations, never an automatic price change.
 */

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function geohash(lat, lng, precision = 6) {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let hash = '';
  let bit = 0;
  let ch = 0;
  let even = true;

  while (hash.length < precision) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) { ch = (ch << 1) | 1; lngMin = mid; } else { ch <<= 1; lngMax = mid; }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) { ch = (ch << 1) | 1; latMin = mid; } else { ch <<= 1; latMax = mid; }
    }
    even = !even;
    bit += 1;
    if (bit === 5) {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

/** Centre of a geohash cell, for plotting or a readable label. */
export function cellCenter(hash) {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let even = true;

  for (const char of String(hash || '')) {
    const index = BASE32.indexOf(char);
    if (index < 0) continue;
    for (let mask = 16; mask > 0; mask >>= 1) {
      if (even) {
        const mid = (lngMin + lngMax) / 2;
        if (index & mask) lngMin = mid; else lngMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (index & mask) latMin = mid; else latMax = mid;
      }
      even = !even;
    }
  }
  return {
    lat: Math.round(((latMin + latMax) / 2) * 10000) / 10000,
    lng: Math.round(((lngMin + lngMax) / 2) * 10000) / 10000,
  };
}

/** Requests per driver per hour → a conservative multiplier suggestion. */
export function suggestSurge(pressure) {
  const value = Number(pressure) || 0;
  if (value >= 3) return 2;
  if (value >= 1.5) return 1.6;
  if (value >= 0.8) return 1.3;
  if (value >= 0.4) return 1.1;
  return 1;
}

const hourOf = (iso) => {
  const hour = Number(String(iso ?? '').slice(11, 13));
  return Number.isInteger(hour) && hour >= 0 && hour < 24 ? hour : null;
};

function emptyHours() {
  return Array.from({ length: 24 }, () => 0);
}

function topHour(byHour) {
  let best = 0;
  for (let hour = 1; hour < 24; hour += 1) {
    if (byHour[hour] > byHour[best]) best = hour;
  }
  return byHour[best] > 0 ? best : null;
}

/**
 * @param {object} db
 * @param {{ since: string, days: number }} window
 */
export function demandCells(db, { since, days }) {
  const windowDays = Math.max(Number(days) || 1, 1);

  const bookings = db.all(
    `SELECT pickup_lat, pickup_lng, pickup, status, fare, created_at
       FROM bookings
      WHERE created_at >= ? AND pickup_lat IS NOT NULL AND pickup_lng IS NOT NULL`,
    [since],
  );

  const cells = new Map();
  for (const row of bookings) {
    const lat = Number(row.pickup_lat);
    const lng = Number(row.pickup_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const key = geohash(lat, lng, 6);
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        cell: key,
        requests: 0,
        completed: 0,
        cancelled: 0,
        active: 0,
        gross: 0,
        by_hour: emptyHours(),
        sample: row.pickup || '',
        latSum: 0,
        lngSum: 0,
        points: 0,
      };
      cells.set(key, cell);
    }
    cell.requests += 1;
    if (row.status === 'completed') {
      cell.completed += 1;
      cell.gross += Number(row.fare) || 0;
    } else if (row.status === 'cancelled') cell.cancelled += 1;
    else cell.active += 1;
    const hour = hourOf(row.created_at);
    if (hour != null) cell.by_hour[hour] += 1;
    cell.latSum += lat;
    cell.lngSum += lng;
    cell.points += 1;
    if (!cell.sample && row.pickup) cell.sample = row.pickup;
  }

  // Current online supply, in the same cells.
  const supply = new Map();
  for (const driver of db.all(
    `SELECT lat, lng FROM drivers
      WHERE status = 'approved' AND is_online = 1 AND lat IS NOT NULL AND lng IS NOT NULL`,
  )) {
    const key = geohash(Number(driver.lat), Number(driver.lng), 6);
    supply.set(key, (supply.get(key) ?? 0) + 1);
  }

  const items = [...cells.values()].map((cell) => {
    const center = cellCenter(cell.cell);
    const online = supply.get(cell.cell) ?? 0;
    const hourlyDemand = cell.requests / (windowDays * 24);
    const pressure = hourlyDemand / Math.max(online, 1);
    const peak = topHour(cell.by_hour);
    const gross = Math.round(cell.gross);
    return {
      cell: cell.cell,
      lat: center.lat,
      lng: center.lng,
      sample: cell.sample,
      requests: cell.requests,
      completed: cell.completed,
      cancelled: cell.cancelled,
      active: cell.active,
      gross,
      avg_fare: cell.completed ? Math.round(cell.gross / cell.completed) : 0,
      success_rate: cell.requests ? Math.round((cell.completed / cell.requests) * 1000) / 10 : 0,
      online_drivers: online,
      hourly_demand: Math.round(hourlyDemand * 100) / 100,
      pressure: Math.round(pressure * 100) / 100,
      surge: suggestSurge(pressure),
      peak_hour: peak,
      by_hour: cell.by_hour,
    };
  });

  items.sort((a, b) => b.requests - a.requests || b.pressure - a.pressure);

  // Citywide baseline so every cell can be compared with the rest.
  const totals = items.reduce(
    (acc, cell) => {
      acc.requests += cell.requests;
      acc.completed += cell.completed;
      acc.cancelled += cell.cancelled;
      acc.gross += cell.gross;
      return acc;
    },
    { requests: 0, completed: 0, cancelled: 0, gross: 0 },
  );
  totals.success_rate = totals.requests
    ? Math.round((totals.completed / totals.requests) * 1000) / 10
    : 0;
  totals.avg_fare = totals.completed ? Math.round(totals.gross / totals.completed) : 0;

  for (const cell of items) {
    cell.request_share = totals.requests
      ? Math.round((cell.requests / totals.requests) * 1000) / 10
      : 0;
    cell.gross_share = totals.gross ? Math.round((cell.gross / totals.gross) * 1000) / 10 : 0;
    cell.success_delta = Math.round((cell.success_rate - totals.success_rate) * 10) / 10;
  }

  const hot = items.slice(0, 40);
  return {
    cells: hot,
    heatmap: hot.slice(0, 8).map((cell) => ({
      cell: cell.cell,
      label: `${cell.lat.toFixed(2)}, ${cell.lng.toFixed(2)}`,
      requests: cell.requests,
      completed: cell.completed,
      gross: cell.gross,
      success_rate: cell.success_rate,
      online_drivers: cell.online_drivers,
      surge: cell.surge,
      peak_hour: cell.peak_hour,
      by_hour: cell.by_hour,
    })),
    by_revenue: [...items]
      .filter((cell) => cell.gross > 0)
      .sort((a, b) => b.gross - a.gross)
      .slice(0, 8),
    totals,
    surge_suggestions: items
      .filter((cell) => cell.surge > 1)
      .sort((a, b) => b.pressure - a.pressure)
      .slice(0, 6),
    online_supply: [...supply.values()].reduce((total, n) => total + n, 0),
    cells_covered: items.length,
  };
}
