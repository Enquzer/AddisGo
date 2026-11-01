/* Hardening checks: request ids, global rate limits, idempotent writes,
 * the durable email queue with backoff, and the browser retry/timeout helper.
 *
 * Starts its own server against a throwaway database so the rate-limit
 * thresholds can be tiny without affecting the main demo instance.
 *
 * Usage: node api/tests/hardening.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { outboxBackoffMs, OUTBOX_MAX_ATTEMPTS } from '../lib/email.js';
import { api as browserApi, newIdempotencyKey } from '../../web/js/api.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..', '..');
const PORT = 3900 + Math.floor(Math.random() * 80);
const BASE = `http://127.0.0.1:${PORT}`;
const READ_LIMIT = 8;
const WRITE_LIMIT = 60;

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

  async call(pathname, { method = 'GET', body, headers = {} } = {}) {
    const sendHeaders = { Accept: 'application/json', ...headers };
    if (this.cookie) sendHeaders.Cookie = this.cookie;
    if (body !== undefined) sendHeaders['Content-Type'] = 'application/json';
    const res = await fetch(`${BASE}${pathname}`, {
      method,
      headers: sendHeaders,
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
    return { status: res.status, data, headers: res.headers };
  }

  get(pathname) { return this.call(pathname); }
  post(pathname, body, headers) { return this.call(pathname, { method: 'POST', body, headers }); }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer(child, logs) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early:\n${logs.join('')}`);
    }
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error(`server did not start:\n${logs.join('')}`);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'addisgo-hardening-'));
const logs = [];
const child = spawn(process.execPath, [path.join(PROJECT, 'api', 'server.js')], {
  cwd: PROJECT,
  env: {
    ...process.env,
    PORT: String(PORT),
    ADDISGO_DATA_DIR: tmpDir,
    ADDISGO_DB: path.join(tmpDir, 'hardening.db'),
    ADDISGO_EMAIL_WORKER: '0',
    ADDISGO_RATE_LIMIT_READ: String(READ_LIMIT),
    ADDISGO_RATE_LIMIT_WRITE: String(WRITE_LIMIT),
    ADDISGO_LOG: '0',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: '1',
    SMTP_USER: 'queue@example.com',
    SMTP_PASS: 'abcdefghijklmnop',
    SMTP_FROM: 'AddisGo <queue@example.com>',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (chunk) => logs.push(String(chunk)));
child.stderr.on('data', (chunk) => logs.push(String(chunk)));

async function stopServer() {
  if (child.exitCode !== null) return;
  child.kill();
  const deadline = Date.now() + 5_000;
  while (child.exitCode === null && Date.now() < deadline) await sleep(100);
  if (child.exitCode === null) child.kill('SIGKILL');
}

(async () => {
  console.log(`Hardening tests against ${BASE}`);
  await waitForServer(child, logs);

  /* ---- Unit-level backoff ------------------------------------------- */
  const d0 = outboxBackoffMs(0, () => 0.5);
  const d1 = outboxBackoffMs(1, () => 0.5);
  const d4 = outboxBackoffMs(4, () => 0.5);
  const d20 = outboxBackoffMs(20, () => 0.5);
  check('backoff starts around 30 s', d0 >= 15_000 && d0 <= 30_000, String(d0));
  check('backoff doubles', d1 > d0 && d4 > d1);
  check('backoff is capped at 6 h', d20 <= 6 * 60 * 60 * 1000, String(d20));
  check('five attempts before permanent failure', OUTBOX_MAX_ATTEMPTS === 5);

  /* ---- Request ids -------------------------------------------------- */
  const health = await fetch(`${BASE}/api/health`);
  const id = health.headers.get('x-request-id');
  check('every response carries X-Request-Id', Boolean(id) && id.length >= 8, String(id));

  const echoed = await fetch(`${BASE}/api/health`, { headers: { 'X-Request-Id': 'support-ticket-12345' } });
  check('caller request id is echoed', echoed.headers.get('x-request-id') === 'support-ticket-12345');

  const rejected = await fetch(`${BASE}/api/health`, { headers: { 'X-Request-Id': 'bad id!' } });
  check('malformed request id is replaced', rejected.headers.get('x-request-id') !== 'bad id!');

  const staticRes = await fetch(`${BASE}/`);
  check('static responses carry a request id', Boolean(staticRes.headers.get('x-request-id')));
  check('HSTS is opt-in (off by default)', !health.headers.get('strict-transport-security'));

  /* ---- Idempotent writes -------------------------------------------- */
  const rider = new Client();
  const login = await rider.post('/api/auth/login', { email: 'meron@example.com', password: 'Rider123!' });
  check('rider login', login.status === 200);

  const body = {
    pickup: 'Bole Medhanialem',
    pickup_lat: 8.995,
    pickup_lng: 38.787,
    dropoff: 'Meskel Square',
    dropoff_lat: 9.0106,
    dropoff_lng: 38.7613,
    vehicle_class: 'e2',
    notes: 'hardening suite',
  };
  const key = newIdempotencyKey();
  const first = await rider.post('/api/bookings', body, { 'Idempotency-Key': key });
  check('booking with idempotency key -> 200', first.status === 200, JSON.stringify(first.data));
  const bookingId = first.data?.id;

  const replay = await rider.post('/api/bookings', body, { 'Idempotency-Key': key });
  check('replayed request returns the same booking', replay.status === 200 && replay.data?.id === bookingId);
  check('replay is labelled', replay.headers.get('idempotency-replayed') === 'true');

  const mismatch = await rider.post(
    '/api/bookings',
    { ...body, dropoff: 'Entoto Natural Park', dropoff_lat: 9.07, dropoff_lng: 38.765 },
    { 'Idempotency-Key': key },
  );
  check('same key with a different body -> 422', mismatch.status === 422 && mismatch.data?.code === 'idempotency_mismatch');

  const shortKey = await rider.post('/api/bookings', body, { 'Idempotency-Key': 'short' });
  check('malformed idempotency key -> 400', shortKey.status === 400);

  if (bookingId) {
    await rider.post(`/api/bookings/${bookingId}/cancel`, { reason_code: 'changed_mind' });
  }

  /* ---- Durable email queue ------------------------------------------ */
  const admin = new Client();
  const adminLogin = await admin.post('/api/auth/login', { email: 'admin@addisgo.et', password: 'Admin123!' });
  check('admin login', adminLogin.status === 200);

  const sent = await admin.post('/api/admin/email/test', { recipient: 'queue-test@example.com' });
  check('failed send is queued, not lost', sent.status === 200 && sent.data?.ok === false && sent.data?.queued === true);
  check('first attempt recorded', sent.data?.attempts === 1);
  check('retry delay is scheduled', Number(sent.data?.retry_in_ms) > 0);

  const settings = await admin.get('/api/admin/email/settings');
  const row = (settings.data?.outbox || []).find((item) => item.recipient === 'queue-test@example.com');
  check('outbox row is queued', Boolean(row) && row.status === 'queued');
  check('outbox row stores the next attempt', Boolean(row?.next_attempt_at));
  check('outbox row counts attempts', Number(row?.attempts) === 1);
  check('queue totals are reported', Number(settings.data?.queue?.pending) >= 1);

  if (row) {
    const retried = await admin.post(`/api/admin/email/outbox/${row.id}/retry`, {});
    check('manual retry re-attempts the message', retried.status === 200 && retried.data?.attempts === 1 && retried.data?.queued === true);
    const after = await admin.get('/api/admin/email/settings');
    const retriedRow = (after.data?.outbox || []).find((item) => item.id === row.id);
    check('manual retry keeps the row queued after another failure', retriedRow?.status === 'queued');
    await admin.call(`/api/admin/email/outbox/${row.id}`, { method: 'DELETE' });
  }

  /* ---- Global rate limiting ----------------------------------------- */
  let limited = null;
  for (let i = 0; i < 20 && !limited; i += 1) {
    const res = await fetch(`${BASE}/api/public/stats`);
    if (res.status === 429) limited = res;
  }
  check('global read limit returns 429', Boolean(limited));
  if (limited) {
    const payload = await limited.json();
    check('429 explains the limit', payload?.code === 'rate_limited');
    check('429 includes Retry-After', Number(limited.headers.get('retry-after')) > 0);
    check('429 includes a request id', Boolean(payload?.request_id));
  }

  let writeLimited = false;
  for (let i = 0; i < WRITE_LIMIT + 10; i += 1) {
    const res = await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (res.status === 429) {
      writeLimited = true;
      break;
    }
  }
  check('global write limit returns 429', writeLimited);

  /* ---- Browser client: timeout and retry ---------------------------- */
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  globalThis.window = { dispatchEvent() {} };

  try {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls < 3) throw new TypeError('network down');
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const data = await browserApi('/retry-me');
    check('GET retries twice then succeeds', calls === 3 && data?.ok === true, `calls=${calls}`);

    calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw new TypeError('network down');
    };
    let writeFailed = false;
    try {
      await browserApi('/writes', { method: 'POST', body: { a: 1 } });
    } catch {
      writeFailed = true;
    }
    check('write without a key is not retried', writeFailed && calls === 1, `calls=${calls}`);

    calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls < 2) throw new TypeError('network down');
      return new Response(JSON.stringify({ id: 7 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const write = await browserApi('/writes', { method: 'POST', body: { a: 1 }, idempotencyKey: newIdempotencyKey() });
    check('write with a key retries safely', calls === 2 && write?.id === 7, `calls=${calls}`);

    globalThis.fetch = (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    });
    let timeoutCode = '';
    try {
      await browserApi('/slow', { timeout: 40 });
    } catch (error) {
      timeoutCode = error.code;
    }
    check('client aborts slow requests', timeoutCode === 'timeout', timeoutCode);

    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'busy' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
    let status = 0;
    try {
      await browserApi('/busy', { retries: 1 });
    } catch (error) {
      status = error.status;
    }
    check('503 is retried and then surfaced', status === 503);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log(`Failures: ${failures.join(', ')}`);
    process.exitCode = 1;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await stopServer();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* Windows may still hold the SQLite file briefly */
  }
});
