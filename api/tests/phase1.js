/* Phase 1 end-to-end checks: two-sided ratings, cancellation taxonomy,
 * driver release → re-dispatch, no-driver terminal state and admin insights.
 * Usage: node api/tests/phase1.js [baseUrl]
 */
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

async function createRide(rider) {
  const res = await rider.post('/api/bookings', { ...RIDE, notes: 'Phase 1 automated check.' });
  return res;
}

(async () => {
  console.log(`Phase 1 tests against ${BASE}`);

  const rider = new Client();
  const driver = new Client();
  const admin = new Client();

  await rider.post('/api/auth/login', { email: 'meron@example.com', password: 'Rider123!' });
  await driver.post('/api/auth/login', { email: 'dawit@example.com', password: 'Driver123!' });
  const adminLogin = await admin.post('/api/auth/login', { email: 'admin@addisgo.et', password: 'Admin123!' });
  check('admin login', adminLogin.status === 200);

  /* ---- Public taxonomy ------------------------------------------------ */
  const options = await new Client().get('/api/public/cancel-reasons');
  check('GET /public/cancel-reasons -> 200', options.status === 200);
  const riderCodes = (options.data?.rider || []).map((r) => r.code);
  check(
    'rider reasons include the requested four',
    ['ACCIDENTAL', 'WAIT_TOO_LONG', 'CHANGED_MIND', 'DRIVER_ASKED'].every((code) => riderCodes.includes(code)),
    JSON.stringify(riderCodes),
  );
  check('reasons carry a blame party', (options.data?.rider || []).every((r) => typeof r.blame === 'string'));
  check('rating tags exposed', (options.data?.rating_tags?.rider || []).length > 0);

  /* ---- Full ride with both ratings ------------------------------------ */
  const created = await createRide(rider);
  check('rider creates ride -> 200', created.status === 200, JSON.stringify(created.data?.error));
  const rideId = created.data?.id;
  check('dispatch starts at round 0 searching', created.data?.dispatch?.state === 'searching' && created.data?.dispatch?.round === 0);
  check('dispatch deadline set', Boolean(created.data?.dispatch?.deadline));

  const accepted = await driver.post(`/api/bookings/${rideId}/accept`);
  check('driver accepts -> 200', accepted.status === 200, JSON.stringify(accepted.data?.error));
  check('promised ETA recorded', Number(accepted.data?.promised_eta_min) > 0);
  check('dispatch marked matched', accepted.data?.dispatch?.state === 'matched');

  const arriving = await driver.patch(`/api/bookings/${rideId}/status`, { status: 'arriving' });
  check('driver arriving stamps arrival', arriving.status === 200 && Boolean(arriving.data?.arrived_at));

  const started = await driver.patch(`/api/bookings/${rideId}/status`, { status: 'in_progress' });
  check('trip started', started.status === 200 && started.data?.status === 'in_progress');

  const done = await driver.patch(`/api/bookings/${rideId}/status`, { status: 'completed' });
  check('trip completed', done.status === 200 && done.data?.status === 'completed');
  check('arrival delay computed', done.data?.arrival_delay_min !== undefined);

  const rated = await rider.post(`/api/bookings/${rideId}/rate`, {
    rating: 4,
    review: 'Good ride, slightly dusty car.',
    tags: ['clean_car', 'on_time'],
    car_condition: 3,
    comfort: 4,
    cleanliness: 5,
    service: 4,
    safety: 5,
  });
  check('rider rates -> 200', rated.status === 200, JSON.stringify(rated.data?.error));
  check('rider rating stored on booking', rated.data?.rating === 4);
  check('rider rating role reported', rated.data?.my_rating?.role === 'rider');
  check('sub-scores echoed', rated.data?.my_rating?.car_condition === 3);
  check('tags stored', (rated.data?.my_rating?.tags || []).includes('clean_car'));
  check('punctuality derived from telemetry', rated.data?.my_rating?.punctuality != null);
  check('driver summary returned', Number(rated.data?.rating_summary?.count) >= 1);
  check(
    'aspect averages returned',
    rated.data?.rating_summary?.breakdown?.car_condition != null,
  );

  const driverRated = await driver.post(`/api/bookings/${rideId}/rate`, {
    rating: 5,
    review: 'Ready at the curb, friendly.',
    tags: ['ready_on_time', 'polite'],
  });
  check('driver rates rider -> 200', driverRated.status === 200, JSON.stringify(driverRated.data?.error));
  check('driver rating role reported', driverRated.data?.my_rating?.role === 'driver');
  check('rider reputation summary', Number(driverRated.data?.rating_summary?.count) >= 1);
  check('both sides flagged rated', driverRated.data?.rated_by?.rider === true && driverRated.data?.rated_by?.driver === true);

  const duplicate = await rider.post(`/api/bookings/${rideId}/rate`, { rating: 5 });
  check('double rider rating -> 409', duplicate.status === 409);

  /* ---- Admin insights -------------------------------------------------- */
  const insights = await admin.get('/api/admin/insights?days=30');
  check('GET /admin/insights -> 200', insights.status === 200, JSON.stringify(insights.data?.error));
  check('insights has rating distribution', Array.isArray(insights.data?.ratings?.distribution));
  check('insights has aspect averages', Array.isArray(insights.data?.ratings?.aspects));
  check('insights has cancellation breakdown', Array.isArray(insights.data?.cancellations?.by_reason));
  check('insights has demand by hour', (insights.data?.demand?.by_hour || []).length === 24);
  check('insights has punctuality sample', insights.data?.punctuality?.sample >= 0);

  /* ---- Driver release loop -------------------------------------------- */
  const releasedRide = await createRide(rider);
  const releaseId = releasedRide.data?.id;
  await driver.post(`/api/bookings/${releaseId}/accept`);
  const release1 = await driver.post(`/api/bookings/${releaseId}/cancel`, { reason_code: 'VEHICLE_ISSUE' });
  check('driver release re-opens the ride', release1.status === 200 && release1.data?.status === 'requested');
  check('driver unassigned after release', release1.data?.driver === null);
  check('release counted', release1.data?.dispatch?.driver_releases === 1);
  check('release recorded as redispatch', release1.data?.cancellation?.outcome === 'redispatch');
  check('release reason stored', release1.data?.cancellation?.reason_code === 'VEHICLE_ISSUE');

  await driver.post(`/api/bookings/${releaseId}/accept`);
  const release2 = await driver.post(`/api/bookings/${releaseId}/cancel`, { reason_code: 'TOO_FAR' });
  check('second release counted', release2.data?.dispatch?.driver_releases === 2);

  await driver.post(`/api/bookings/${releaseId}/accept`);
  const release3 = await driver.post(`/api/bookings/${releaseId}/cancel`, { reason_code: 'OTHER' });
  check('third release becomes undeliverable', release3.data?.status === 'cancelled');
  check('undeliverable blamed on platform', release3.data?.cancellation?.reason_code === 'NO_DRIVER_FOUND');
  check('undeliverable is a terminal dispatch state', release3.data?.dispatch?.state === 'failed');

  /* ---- Rider cancellation taxonomy ------------------------------------ */
  const cancelRide = await createRide(rider);
  const cancelId = cancelRide.data?.id;
  const cancelled = await rider.post(`/api/bookings/${cancelId}/cancel`, { reason_code: 'ACCIDENTAL', reason: 'Tapped by mistake' });
  check('rider cancels with a code', cancelled.status === 200 && cancelled.data?.status === 'cancelled');
  check('rider reason stored', cancelled.data?.cancellation?.reason_code === 'ACCIDENTAL');
  check('rider reason labelled', cancelled.data?.cancellation?.label === 'Requested by accident');
  check('no blame for accidental', cancelled.data?.cancellation?.blame_party === 'none');
  check('rider reason note stored', cancelled.data?.cancellation?.note === 'Tapped by mistake');

  /* ---- Manual re-dispatch --------------------------------------------- */
  const redispatched = await createRide(rider);
  const redispatchId = redispatched.data?.id;
  const wider = await rider.post(`/api/bookings/${redispatchId}/redispatch`);
  check('manual redispatch -> 200', wider.status === 200, JSON.stringify(wider.data?.error));
  check('dispatch round advanced', Number(wider.data?.dispatch?.round) === 1);
  await rider.post(`/api/bookings/${redispatchId}/cancel`, { reason_code: 'CHANGED_MIND' });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('Failed checks:');
    for (const name of failures) console.log(` - ${name}`);
  }
  process.exit(fail ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
