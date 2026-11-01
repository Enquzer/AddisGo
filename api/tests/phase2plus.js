/* Phase 2–5 end-to-end checks: presence/air-time, commission/incentive
 * ledger, geohash demand cells and privacy-safe website analytics.
 * Usage: node api/tests/phase2plus.js [baseUrl]
 */
import { cellCenter, geohash, suggestSurge } from '../lib/geocell.js';

const BASE = process.argv[2] || 'http://localhost:3003';

let pass = 0;
let fail = 0;
const failures = [];

function check(name, condition, extra = '') {
  if (condition) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

class Client {
  constructor() {
    this.cookie = '';
  }

  async call(path, { method = 'GET', body } = {}) {
    const headers = { Accept: 'application/json' };
    if (this.cookie) headers.Cookie = this.cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const cookie of res.headers.getSetCookie?.() || []) {
      if (cookie.startsWith('addisgo_session=')) this.cookie = cookie.split(';')[0];
    }
    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = null; }
    }
    return { status: res.status, data };
  }

  get(path) { return this.call(path); }
  post(path, body) { return this.call(path, { method: 'POST', body }); }
  patch(path, body) { return this.call(path, { method: 'PATCH', body }); }
}

const RIDE = {
  pickup: 'Bole Medhanialem Church',
  pickup_lat: 8.995,
  pickup_lng: 38.787,
  dropoff: 'Meskel Square',
  dropoff_lat: 9.01,
  dropoff_lng: 38.761,
  vehicle_class: 'e2',
};

(async () => {
  console.log(`Phase 2–5 tests against ${BASE}`);

  const rider = new Client();
  const driver = new Client();
  const admin = new Client();

  await rider.post('/api/auth/login', { email: 'meron@example.com', password: 'Rider123!' });
  await driver.post('/api/auth/login', { email: 'dawit@example.com', password: 'Driver123!' });
  const adminLogin = await admin.post('/api/auth/login', { email: 'admin@addisgo.et', password: 'Admin123!' });
  check('admin login', adminLogin.status === 200);

  /* ---- Phase 4: geohash maths ---------------------------------------- */
  const hash = geohash(9.03, 38.74, 6);
  check('geohash precision 6', hash.length === 6, hash);
  check('geohash stable for Addis', hash === 'scee3e', hash);
  const centre = cellCenter(hash);
  check('cell centre is close to input', Math.abs(centre.lat - 9.03) < 0.01 && Math.abs(centre.lng - 38.74) < 0.01, JSON.stringify(centre));
  check('surge is a suggestion ladder', suggestSurge(3) === 2 && suggestSurge(1.5) === 1.6 && suggestSurge(0.1) === 1);

  /* ---- Phase 5: privacy-safe analytics -------------------------------- */
  const tracked = await new Client().post('/api/public/analytics', {
    path: '/tours/12?token=secret#frag',
    referrer: 'https://www.google.com/search?q=private+query',
    event: 'pageview',
  });
  check('POST /public/analytics -> 200', tracked.status === 200, JSON.stringify(tracked.data?.error));
  check('path ids collapsed', tracked.data?.path === '/tours/:id', JSON.stringify(tracked.data));
  check('query string dropped', !String(tracked.data?.path || '').includes('secret'));
  check('referrer reduced to host', tracked.data?.referrer_host === 'www.google.com', tracked.data?.referrer_host);

  const bogus = await new Client().post('/api/public/analytics', {
    path: '/search?q=hidden',
    referrer: 'not a url',
    event: 'not_a_real_event',
  });
  check('unknown event falls back to pageview', bogus.data?.event === 'pageview', JSON.stringify(bogus.data));
  check('invalid referrer stored empty', bogus.data?.referrer_host === '');
  check('search path stored without query', bogus.data?.path === '/search');

  const audience = await new Client().get('/api/public/audience?days=30');
  check('GET /public/audience -> 200', audience.status === 200, JSON.stringify(audience.data?.error));
  check('audience counts page views', Number(audience.data?.pageviews) >= 2, String(audience.data?.pageviews));
  check('audience declares no cookies', audience.data?.privacy?.cookies === false);
  check('audience declares no IP storage', audience.data?.privacy?.ip_stored === false);
  check('public view hides page detail', audience.data?.top_pages === undefined);
  check('public view hides referrer detail', audience.data?.top_referrers === undefined);

  const riderDenied = await rider.get('/api/admin/analytics');
  check('rider cannot read admin analytics', riderDenied.status === 401 || riderDenied.status === 403, String(riderDenied.status));

  const adminAnalytics = await admin.get('/api/admin/analytics?days=30');
  check('GET /admin/analytics -> 200', adminAnalytics.status === 200, JSON.stringify(adminAnalytics.data?.error));
  check('admin view lists top pages', Array.isArray(adminAnalytics.data?.top_pages));
  check('admin view lists referrers', Array.isArray(adminAnalytics.data?.top_referrers));
  check('admin view lists event types', Array.isArray(adminAnalytics.data?.events_by_type));
  check(
    'tracked path appears in admin view',
    (adminAnalytics.data?.top_pages || []).some((row) => row.path === '/tours/:id'),
  );
  check(
    'tracked referrer appears in admin view',
    (adminAnalytics.data?.top_referrers || []).some((row) => row.host === 'www.google.com'),
  );

  /* ---- Phase 3: revenue configuration --------------------------------- */
  const revenueBefore = await admin.get('/api/admin/revenue?days=30');
  check('GET /admin/revenue -> 200', revenueBefore.status === 200, JSON.stringify(revenueBefore.data?.error));
  check('revenue has a config', ['commission', 'incentive'].includes(revenueBefore.data?.config?.model));
  check('revenue totals present', Number.isFinite(Number(revenueBefore.data?.totals?.gross)));
  check('revenue has per-driver rollup', Array.isArray(revenueBefore.data?.by_driver));
  check('revenue has ledger rows', Array.isArray(revenueBefore.data?.recent));
  check('revenue has daily series', Array.isArray(revenueBefore.data?.daily));
  check(
    'ledger backfilled for completed trips',
    Number(revenueBefore.data?.totals?.trips) >= 1,
    String(revenueBefore.data?.totals?.trips),
  );

  const riderRevenueDenied = await rider.get('/api/admin/revenue');
  check('rider cannot read revenue', riderRevenueDenied.status === 401 || riderRevenueDenied.status === 403, String(riderRevenueDenied.status));

  const switched = await admin.patch('/api/admin/revenue', {
    model: 'incentive',
    commission_rate: 15,
    incentive_rate: 8,
  });
  check('PATCH /admin/revenue -> 200', switched.status === 200, JSON.stringify(switched.data?.error));
  check('incentive model saved', switched.data?.config?.model === 'incentive');
  check('incentive rate saved', Number(switched.data?.config?.incentive_rate) === 8);

  /* A completed trip settles under the active model. */
  const created = await rider.post('/api/bookings', { ...RIDE, notes: 'Phase 2–5 ledger check.' });
  check('rider creates ride -> 200', created.status === 200, JSON.stringify(created.data?.error));
  const rideId = created.data?.id;
  const accepted = await driver.post(`/api/bookings/${rideId}/accept`);
  check('driver accepts -> 200', accepted.status === 200, JSON.stringify(accepted.data?.error));
  await driver.patch(`/api/bookings/${rideId}/status`, { status: 'arriving' });
  await driver.patch(`/api/bookings/${rideId}/status`, { status: 'in_progress' });
  const done = await driver.patch(`/api/bookings/${rideId}/status`, { status: 'completed' });
  check('trip completed under incentive model', done.status === 200 && done.data?.status === 'completed', JSON.stringify(done.data?.error));

  const revenueAfter = await admin.get('/api/admin/revenue?days=30');
  const ledgerRow = (revenueAfter.data?.recent || []).find((row) => row.booking_id === rideId);
  check('completed trip written to ledger', Boolean(ledgerRow), `ride ${rideId}`);
  check('ledger records incentive model', ledgerRow?.model === 'incentive', ledgerRow?.model);
  check('ledger incentive amount is 8% of fare', Math.abs(Number(ledgerRow?.incentive_amount) - Number(ledgerRow?.fare) * 0.08) < 0.02, JSON.stringify(ledgerRow));
  check('driver take-home exceeds fare under incentive', Number(ledgerRow?.driver_earning) > Number(ledgerRow?.fare));
  check('platform earning is negative under incentive', Number(ledgerRow?.platform_earning) < 0);

  const restored = await admin.patch('/api/admin/revenue', {
    model: 'commission',
    commission_rate: 15,
    incentive_rate: 5,
  });
  check('revenue model restored to commission', restored.data?.config?.model === 'commission' && Number(restored.data?.config?.commission_rate) === 15);

  /* ---- Phase 2: presence, heartbeat and air-time ---------------------- */
  const online = await driver.patch('/api/driver/status', {
    is_online: true,
    lat: 9.01,
    lng: 38.76,
  });
  check('driver goes online -> 200', online.status === 200, JSON.stringify(online.data?.error));
  check('online opens a session', Boolean(online.data?.session?.id));
  check('server publishes heartbeat cadence', Number(online.data?.heartbeat_ms) > 0);

  const beat = await driver.post('/api/driver/heartbeat', { lat: 9.011, lng: 38.761 });
  check('POST /driver/heartbeat -> 200', beat.status === 200, JSON.stringify(beat.data?.error));
  check('heartbeat reports online', beat.data?.online === true);
  check('heartbeat echoes session', Number(beat.data?.session_id) === Number(online.data?.session?.id));
  check('heartbeat tracks online seconds', Number.isFinite(Number(beat.data?.online_seconds)));

  const me = await driver.get('/api/driver/me');
  check('GET /driver/me -> 200', me.status === 200, JSON.stringify(me.data?.error));
  check('driver stats include air-time', Number.isFinite(Number(me.data?.stats?.online_minutes_week)));
  check('driver stats include idle time', Number.isFinite(Number(me.data?.stats?.idle_minutes_week)));
  check('driver stats include sessions', Number.isFinite(Number(me.data?.stats?.sessions_week)));
  check('driver stats include acceptance', me.data?.stats?.acceptance_rate === null || Number.isFinite(Number(me.data?.stats?.acceptance_rate)));
  check('driver stats include heartbeat', Boolean(me.data?.stats?.last_heartbeat));
  check('driver sees active revenue model', ['commission', 'incentive'].includes(me.data?.revenue_model?.model));
  check('driver take-home is ledger based', Number.isFinite(Number(me.data?.stats?.earnings_total)));
  check('driver take-home under commission is below gross', Number(me.data?.stats?.earnings_total) <= Number(me.data?.stats?.gross_total));

  const offline = await driver.patch('/api/driver/status', { is_online: false });
  check('driver goes offline -> 200', offline.status === 200, JSON.stringify(offline.data?.error));
  check('offline closes the session', offline.data?.session == null);
  const meOffline = await driver.get('/api/driver/me');
  check('offline driver has no open session', meOffline.data?.stats?.online_since == null, String(meOffline.data?.stats?.online_since));

  // Leave the demo driver online, matching the seeded state other suites expect.
  const backOnline = await driver.patch('/api/driver/status', { is_online: true, lat: 9.01, lng: 38.76 });
  check('demo driver left online for later suites', backOnline.status === 200 && Boolean(backOnline.data?.session?.id));

  /* ---- Phase 2/4: extended admin insights ----------------------------- */
  const insights = await admin.get('/api/admin/insights?days=30');
  check('extended insights -> 200', insights.status === 200, JSON.stringify(insights.data?.error));
  check('insights include geohash cells', Array.isArray(insights.data?.demand?.cells));
  check('insights include demand heatmap', Array.isArray(insights.data?.demand?.heatmap));
  check('insights include surge suggestions', Array.isArray(insights.data?.demand?.surge_suggestions));
  check('insights count covered cells', Number.isFinite(Number(insights.data?.demand?.cells_covered)));
  check('insights include fleet air-time', insights.data?.fleet && Array.isArray(insights.data.fleet.drivers));
  check('fleet reports app-closed sessions', Number.isFinite(Number(insights.data?.fleet?.app_closed_sessions)));
  check('fleet reports acceptance rate', insights.data?.fleet?.acceptance_rate === null || Number.isFinite(Number(insights.data?.fleet?.acceptance_rate)));
  check('insights include demographics', Number.isFinite(Number(insights.data?.demographics?.roles?.customer)));
  check('insights include request frequency buckets', (insights.data?.demographics?.frequency || []).length === 4);
  check('insights include rider languages', Array.isArray(insights.data?.demographics?.languages));
  check('insights include average rides per rider', Number.isFinite(Number(insights.data?.demographics?.avg_rides_per_rider)));

  /* ---- Area performance map (success + money per cell) ----------------- */
  const areas = insights.data?.demand?.areas || [];
  check('areas expose a geohash cell', areas.every((area) => typeof area.cell === 'string' && area.cell.length === 6));
  check('areas expose success rate', areas.every((area) => Number.isFinite(Number(area.success_rate))));
  check('areas expose gross fares', areas.every((area) => Number.isFinite(Number(area.gross))));
  check('areas expose share of city gross', areas.every((area) => Number.isFinite(Number(area.gross_share))));
  check('areas expose success delta vs city', areas.every((area) => Number.isFinite(Number(area.success_delta))));
  check('areas expose pressure for the insights table', areas.every((area) => Number.isFinite(Number(area.pressure))));
  const demandTotals = insights.data?.demand?.totals;
  check('demand totals present', Number.isFinite(Number(demandTotals?.requests)) && Number.isFinite(Number(demandTotals?.gross)));
  check('demand success rate matches completed ÷ requests', areas.length
    ? Math.abs(Number(areas[0].success_rate) - (Number(areas[0].completed) / Number(areas[0].requests)) * 100) < 0.2
    : true);
  check('area gross shares sum to ~100', areas.length
    ? Math.abs(areas.reduce((sum, area) => sum + Number(area.gross_share), 0) - 100) < 1
    : true);
  check('areas ranked by revenue', Array.isArray(insights.data?.demand?.by_revenue)
    && insights.data.demand.by_revenue.every((area, index, list) => index === 0 || Number(list[index - 1].gross) >= Number(area.gross)));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('Failures:');
    for (const name of failures) console.log(`  - ${name}`);
    process.exitCode = 1;
  }
})().catch((error) => {
  console.error('Phase 2–5 tests crashed:', error);
  process.exitCode = 1;
});
