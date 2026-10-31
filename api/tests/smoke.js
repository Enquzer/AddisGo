/* End-to-end API smoke test. Run: node api/tests/smoke.js [baseUrl] */
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

  async call(path, { method = 'GET', body, raw = false } = {}) {
    const headers = { Accept: 'application/json' };
    if (this.cookie) headers.Cookie = this.cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.getSetCookie?.() || [];
    for (const cookie of setCookie) {
      if (cookie.startsWith('addisgo_session=')) this.cookie = cookie.split(';')[0];
    }
    const text = await res.text();
    let data = null;
    if (!raw && text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    return { status: res.status, data, text, headers: res.headers };
  }

  get(path) {
    return this.call(path);
  }

  post(path, body) {
    return this.call(path, { method: 'POST', body });
  }

  patch(path, body) {
    return this.call(path, { method: 'PATCH', body });
  }
}

async function main() {
  console.log(`\nSmoke testing ${BASE}\n`);

  const anon = new Client();

  const health = await anon.get('/api/health');
  check('GET /api/health -> 200', health.status === 200 && health.data?.status === 'ok');
  check('health leaks no secrets', !JSON.stringify(health.data).includes('scrypt$'));

  const stats = await anon.get('/api/public/stats');
  check('GET /api/public/stats -> 200', stats.status === 200);
  check('stats has drivers_total > 0', Number(stats.data?.drivers_total) > 0, String(stats.data?.drivers_total));

  const guard = await anon.get('/api/bookings');
  check('GET /api/bookings anon -> 401 unauthenticated', guard.status === 401 && guard.data?.code === 'unauthenticated');

  const badLogin = await anon.post('/api/auth/login', { email: 'meron@example.com', password: 'wrongpass1' });
  check('bad login -> 401 invalid_credentials', badLogin.status === 401 && badLogin.data?.code === 'invalid_credentials');

  // ---- Rider
  const rider = new Client();
  const login = await rider.post('/api/auth/login', { email: 'meron@example.com', password: 'Rider123!' });
  check('rider login -> 200', login.status === 200, JSON.stringify(login.data));
  check('rider cookie set', rider.cookie.startsWith('addisgo_session='));
  check('login response has driver: null for customer', login.data?.driver === null);

  const me = await rider.get('/api/auth/me');
  check('GET /api/auth/me -> 200', me.status === 200 && me.data?.email === 'meron@example.com');

  const estimate = await rider.post('/api/estimate', {
    pickup_lat: 8.995,
    pickup_lng: 38.787,
    dropoff_lat: 9.01,
    dropoff_lng: 38.761,
    vehicle_class: 'e2',
  });
  check('POST /api/estimate -> 200 with fare', estimate.status === 200 && Number(estimate.data?.fare) > 0);
  check('estimate route has >= 2 points', Array.isArray(estimate.data?.route) && estimate.data.route.length >= 2);

  const nearby = await rider.get('/api/drivers/nearby?lat=8.995&lng=38.787&class=e2');
  check('GET /api/drivers/nearby -> 200', nearby.status === 200 && Array.isArray(nearby.data?.drivers));
  check('nearby has at least one E2', (nearby.data?.drivers || []).length > 0, `count=${nearby.data?.drivers?.length}`);
  check('nearby sorted by distance', (nearby.data?.drivers || []).every((d, i, a) => i === 0 || a[i - 1].distance_km <= d.distance_km));

  const trips = await rider.get('/api/bookings');
  check('GET /api/bookings -> 200', trips.status === 200 && Array.isArray(trips.data?.bookings));
  check('rider sees only own bookings', (trips.data?.bookings || []).every((b) => b.customer.id === me.data.id));

  const tours = await anon.get('/api/tours');
  check('GET /api/tours (public) -> 200', tours.status === 200 && (tours.data?.tours || []).length >= 1);
  const tourId = tours.data?.tours?.[0]?.id;
  const tour = await anon.get(`/api/tours/${tourId}`);
  check('GET /api/tours/:id -> 200', tour.status === 200 && tour.data?.id === tourId);
  check('tour includes members array', Array.isArray(tour.data?.members));

  const adminGuard = await rider.get('/api/admin/overview');
  check('rider -> /api/admin/overview 403', adminGuard.status === 403);

  // ---- Live ride lifecycle
  const driver = new Client();
  const dlogin = await driver.post('/api/auth/login', { email: 'dawit@example.com', password: 'Driver123!' });
  check('driver login -> 200', dlogin.status === 200);
  check('driver profile attached', dlogin.data?.driver?.vehicle_class === 'e2');

  const driverMe = await driver.get('/api/driver/me');
  check('GET /api/driver/me -> 200', driverMe.status === 200 && driverMe.data?.driver?.plate);
  check('driver stats present', Number.isFinite(Number(driverMe.data?.stats?.earnings_total)));

  const requests = await driver.get('/api/driver/requests');
  check('GET /api/driver/requests -> 200', requests.status === 200 && Array.isArray(requests.data?.requests));
  check('seeded requests reachable by online driver', (requests.data?.requests || []).length >= 1);
  check(
    'requests hide rider phone until accepted',
    (requests.data?.requests || []).every((r) => r.customer_phone === null),
  );

  const created = await rider.post('/api/bookings', {
    pickup: 'Bole Medhanialem Church',
    pickup_lat: 8.995,
    pickup_lng: 38.787,
    dropoff: 'Meskel Square',
    dropoff_lat: 9.01,
    dropoff_lng: 38.761,
    vehicle_class: 'e2',
    notes: 'Smoke test ride.',
  });
  check('rider creates booking -> 200', created.status === 200 && created.data?.code?.startsWith('AG-'), JSON.stringify(created.data?.error));

  const duplicate = await rider.post('/api/bookings', {
    pickup: 'Bole Medhanialem Church',
    pickup_lat: 8.995,
    pickup_lng: 38.787,
    dropoff: 'Meskel Square',
    dropoff_lat: 9.01,
    dropoff_lng: 38.761,
    vehicle_class: 'e2',
  });
  check('second active ride blocked -> 409', duplicate.status === 409);

  const target = created.data;

  if (target) {
    const accept = await driver.post(`/api/bookings/${target.id}/accept`);
    check('driver accepts ride -> 200', accept.status === 200 && accept.data?.status === 'accepted', JSON.stringify(accept.data?.error));
    check('driver assigned', accept.data?.driver?.id != null);

    const qr = await rider.get(`/api/bookings/${target.id}/qr`);
    check('GET qr -> 200 svg', qr.status === 200 && qr.text.startsWith('<svg'));

    const verify = await driver.post('/api/driver/verify', { code: target.code });
    check('driver verify code -> valid', verify.status === 200 && verify.data?.valid === true);

    const badCode = await driver.post('/api/driver/verify', { code: 'AG-NOPE99' });
    check('driver verify bad code -> 404', badCode.status === 404);

    const progress = await driver.patch(`/api/bookings/${target.id}/status`, { status: 'in_progress' });
    check('status accepted -> in_progress', progress.status === 200 && progress.data?.status === 'in_progress');

    const chat = await rider.post(`/api/bookings/${target.id}/messages`, { body: 'I am at the gate, silver jacket.' });
    check('rider posts ride chat -> 200', chat.status === 200 && chat.data?.body?.includes('gate'));

    const chatList = await driver.get(`/api/bookings/${target.id}/messages`);
    check('driver reads ride chat', chatList.status === 200 && (chatList.data?.messages || []).length >= 1);

    const done = await driver.patch(`/api/bookings/${target.id}/status`, { status: 'completed' });
    check('status in_progress -> completed', done.status === 200 && done.data?.status === 'completed');

    const rate = await rider.post(`/api/bookings/${target.id}/rate`, { rating: 5, review: 'Great test ride.' });
    check('rider rates completed trip', rate.status === 200 && rate.data?.rating === 5);

    const rateAgain = await rider.post(`/api/bookings/${target.id}/rate`, { rating: 4 });
    check('double rating -> 409', rateAgain.status === 409);
  }

  // ---- Tour lifecycle
  const newTour = await rider.post('/api/tours', {
    title: 'Smoke test coffee walk',
    description: 'A short automated test tour that verifies the tours API works end to end.',
    meeting_point: 'Bole Medhanialem Church',
    lat: 8.995,
    lng: 38.787,
    starts_at: new Date(Date.now() + 26 * 3600_000).toISOString(),
    duration_min: 90,
    capacity: 6,
    price: 500,
    theme: 'bole',
  });
  check('rider creates tour -> 200', newTour.status === 200 && newTour.data?.is_host === true, JSON.stringify(newTour.data?.error));

  const traveler = new Client();
  await traveler.post('/api/auth/login', { email: 'jake@example.com', password: 'Rider123!' });
  const join = await traveler.post(`/api/tours/${newTour.data.id}/join`);
  check('other user joins tour', join.status === 200 && join.data?.is_member === true);

  const tourChat = await traveler.post(`/api/tours/${newTour.data.id}/messages`, { body: 'Looking forward to it!' });
  check('member posts tour chat', tourChat.status === 200);

  const leave = await traveler.post(`/api/tours/${newTour.data.id}/leave`);
  check('member leaves tour', leave.status === 200 && leave.data?.is_member === false);

  const cancelTour = await rider.post(`/api/tours/${newTour.data.id}/cancel`);
  check('host cancels tour', cancelTour.status === 200 && cancelTour.data?.status === 'cancelled');

  // ---- Admin CRM
  const admin = new Client();
  const alogin = await admin.post('/api/auth/login', { email: 'admin@addisgo.et', password: 'Admin123!' });
  check('admin login -> 200', alogin.status === 200 && alogin.data?.role === 'admin');

  const overview = await admin.get('/api/admin/overview');
  check('GET /api/admin/overview -> 200', overview.status === 200 && overview.data?.stats);
  check('overview chart has 7 days', (overview.data?.chart || []).length === 7);
  check('overview recent_bookings present', Array.isArray(overview.data?.recent_bookings));

  const adminDrivers = await admin.get('/api/admin/drivers?status=pending');
  check(
    'GET /api/admin/drivers?status=pending',
    adminDrivers.status === 200 && Array.isArray(adminDrivers.data?.drivers),
  );
  const pending = adminDrivers.data?.drivers?.[0];
  if (pending) {
    const approve = await admin.patch(`/api/admin/drivers/${pending.id}`, { status: 'approved' });
    check('admin approves pending driver', approve.status === 200 && approve.data?.status === 'approved');
  }

  const adminUsers = await admin.get('/api/admin/users');
  check('GET /api/admin/users -> 200', adminUsers.status === 200 && (adminUsers.data?.users || []).length >= 10);

  const adminBookings = await admin.get('/api/admin/bookings?status=completed');
  check('GET /api/admin/bookings?status=completed', adminBookings.status === 200 && (adminBookings.data?.bookings || []).length >= 1);

  const adminTours = await admin.get('/api/admin/tours');
  check('GET /api/admin/tours -> 200', adminTours.status === 200 && Array.isArray(adminTours.data?.tours));

  const audit = await admin.get('/api/admin/audit');
  check('GET /api/admin/audit -> 200', audit.status === 200 && (audit.data?.audit || []).length >= 1);
  check('audit records driver approval', (audit.data?.audit || []).some((a) => a.action === 'driver.status_changed'));

  const reports = await admin.get('/api/admin/reports?status=all');
  check('GET /api/admin/reports -> 200', reports.status === 200 && Array.isArray(reports.data?.reports));

  const report = await rider.post('/api/reports', {
    target_type: 'tour',
    target_id: tourId,
    reason: 'Smoke test report',
    detail: 'Automated check that reporting works.',
  });
  check('POST /api/reports -> 200', report.status === 200);

  const openReports = await admin.get('/api/admin/reports?status=open');
  const newReport = (openReports.data?.reports || []).find((r) => r.reason === 'Smoke test report');
  check('admin sees new safety report', Boolean(newReport));
  if (newReport) {
    const resolve = await admin.patch(`/api/admin/reports/${newReport.id}`, { status: 'resolved' });
    check('admin resolves report', resolve.status === 200);
  }

  // ---- Email & Newsletter
  const newsletterSub = await anon.post('/api/newsletter/subscribe', { email: 'smoke_tester@gmail.com' });
  check('POST /api/newsletter/subscribe -> 200', newsletterSub.status === 200 && newsletterSub.data?.ok === true);

  const emailSettings = await admin.get('/api/admin/email/settings');
  check('GET /api/admin/email/settings -> 200', emailSettings.status === 200 && emailSettings.data?.config !== undefined);

  const emailTest = await admin.post('/api/admin/email/test', { recipient: 'smoke_tester@gmail.com' });
  check('POST /api/admin/email/test -> 200', emailTest.status === 200 && emailTest.data?.ok === true);

  // ---- Media Upload & Packet Security
  const tinyJpg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  const uploadRes = await rider.post('/api/upload', { data: tinyJpg, filename: 'pin.jpg', type: 'image' });
  check('POST /api/upload -> 200', uploadRes.status === 200 && uploadRes.data?.url?.startsWith('/api/uploads/'));
  if (uploadRes.data?.url) {
    const fetchMedia = await anon.get(uploadRes.data.url);
    check('GET /api/uploads/:file -> 200 image/jpeg', fetchMedia.status === 200);
  }

  // ---- Security
  const traversal = await anon.get('/api/../data/addisgo.db');
  check('path traversal blocked', traversal.status !== 200 || !traversal.text.includes('SQLite'));

  const cors = await anon.call('/api/auth/logout', {
    method: 'POST',
    body: {},
  });
  check('same-origin logout ok', cors.status === 200);

  const badJson = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: '{"email":"x@y.z","password":"abc12345"}',
  });
  check('cross-origin mutation blocked', badJson.status === 403);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('Failed checks:');
    for (const name of failures) console.log(` - ${name}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('\nSmoke test crashed:', error);
  process.exitCode = 1;
});
