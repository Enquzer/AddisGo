/*
 * Privacy-safe website analytics.
 *
 * We store aggregate counters only:
 *
 *   day · path · referrer host · event → count
 *
 * No cookies, no IP addresses, no user ids, no query strings, no precise
 * timestamps. That makes the numbers safe to publish to advertisers while
 * still answering "which pages get traffic?" and "where do visits come from?".
 */

import { daysAgo, nowIso, round1 } from './util.js';

export const ANALYTICS_EVENTS = [
  'pageview',
  'tour_view',
  'event_view',
  'signup',
  'ride_request',
  'newsletter',
  'share',
];

const MAX_PATH = 120;
const MAX_HOST = 80;

/** Collapses ids and strips query strings so paths cannot carry personal data. */
export function sanitizePath(raw) {
  let path = String(raw ?? '/').split('?')[0].split('#')[0].trim();
  if (!path.startsWith('/')) path = `/${path}`;
  path = path.replace(/\/\d+(?=\/|$)/g, '/:id');
  path = path.replace(/\/[a-f0-9]{12,}(?=\/|$)/gi, '/:id');
  if (path.length > MAX_PATH) path = path.slice(0, MAX_PATH);
  if (!/^[a-zA-Z0-9/_:.-]*$/.test(path)) return '/';
  return path || '/';
}

/** Keeps only the registrable host, never the full URL or its query string. */
export function sanitizeReferrer(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    return url.hostname.toLowerCase().slice(0, MAX_HOST);
  } catch {
    return '';
  }
}

export function sanitizeEvent(raw) {
  const value = String(raw ?? 'pageview').trim().toLowerCase();
  return ANALYTICS_EVENTS.includes(value) ? value : 'pageview';
}

/** Upserts one aggregate counter. Returns the safe values that were stored. */
export function recordAnalytics(db, { path, referrer, event } = {}) {
  const day = nowIso().slice(0, 10);
  const safePath = sanitizePath(path);
  const host = sanitizeReferrer(referrer);
  const safeEvent = sanitizeEvent(event);
  db.run(
    `INSERT INTO web_analytics (day, path, referrer_host, event, count)
     VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(day, path, referrer_host, event) DO UPDATE SET count = count + 1`,
    [day, safePath, host, safeEvent],
  );
  return { day, path: safePath, referrer_host: host, event: safeEvent };
}

function dayRange(days) {
  const out = [];
  const now = new Date();
  for (let offset = Math.max(days - 1, 0); offset >= 0; offset -= 1) {
    out.push(new Date(now.getTime() - offset * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Aggregate audience report. `publicView` trims it to advertiser-safe totals;
 * the admin view adds page/referrer detail.
 */
export function analyticsSummary(db, { days = 30, publicView = false } = {}) {
  const windowDays = Math.min(Math.max(Number(days) || 30, 1), 365);
  const since = daysAgo(windowDays).slice(0, 10);

  const scalar = (sql, params = []) => Number(db.get(sql, params)?.n ?? 0);
  const pageviews = scalar(
    "SELECT COALESCE(SUM(count), 0) AS n FROM web_analytics WHERE day >= ? AND event = 'pageview'",
    [since],
  );
  const totalEvents = scalar(
    'SELECT COALESCE(SUM(count), 0) AS n FROM web_analytics WHERE day >= ?',
    [since],
  );
  const activeDays = scalar(
    'SELECT COUNT(DISTINCT day) AS n FROM web_analytics WHERE day >= ?',
    [since],
  );

  const dailyRows = db.all(
    `SELECT day, SUM(CASE WHEN event = 'pageview' THEN count ELSE 0 END) AS pageviews,
            SUM(count) AS events
       FROM web_analytics WHERE day >= ? GROUP BY day ORDER BY day ASC`,
    [since],
  );
  const byDay = new Map(dailyRows.map((row) => [row.day, row]));
  const daily = dayRange(windowDays).map((day) => ({
    day,
    pageviews: Number(byDay.get(day)?.pageviews ?? 0),
    events: Number(byDay.get(day)?.events ?? 0),
  }));

  const eventRows = db.all(
    'SELECT event, SUM(count) AS n FROM web_analytics WHERE day >= ? GROUP BY event ORDER BY n DESC',
    [since],
  ).map((row) => ({ event: row.event, count: Number(row.n) }));

  const topPages = db.all(
    `SELECT path, SUM(count) AS n FROM web_analytics
      WHERE day >= ? AND event = 'pageview'
      GROUP BY path ORDER BY n DESC LIMIT 10`,
    [since],
  ).map((row) => ({ path: row.path, pageviews: Number(row.n) }));

  const topReferrers = db.all(
    `SELECT referrer_host, SUM(count) AS n FROM web_analytics
      WHERE day >= ? AND event = 'pageview' AND referrer_host <> ''
      GROUP BY referrer_host ORDER BY n DESC LIMIT 10`,
    [since],
  ).map((row) => ({ host: row.referrer_host, pageviews: Number(row.n) }));

  const base = {
    window_days: windowDays,
    since,
    pageviews,
    events: totalEvents,
    active_days: activeDays,
    daily_average: activeDays ? round1(pageviews / activeDays) : 0,
    daily,
    privacy: {
      cookies: false,
      personal_data: false,
      ip_stored: false,
      note: 'Aggregate page counters only — no cookies, IP addresses, user ids or query strings.',
    },
  };

  if (publicView) return base;
  return { ...base, events_by_type: eventRows, top_pages: topPages, top_referrers: topReferrers };
}
