/* Profile-picture checks: auth, type/size/dimension validation, serving and
 * removal. Starts an isolated server against a throwaway database.
 *
 * Usage: node api/tests/avatar.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..', '..');
const PORT = 4000 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;

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
  delete(pathname) { return this.call(pathname, { method: 'DELETE' }); }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer(child, logs) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${logs.join('')}`);
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

/* --- Minimal PNG builder so the suite can exercise real image headers ----- */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const name = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, crc]);
}

function makePng(width, height) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height, 0);
  for (let y = 0; y < height; y += 1) raw[y * stride] = 0; // filter: none
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function dataUri(mime, buffer) {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'addisgo-avatar-'));
const logs = [];
const child = spawn(process.execPath, [path.join(PROJECT, 'api', 'server.js')], {
  cwd: PROJECT,
  env: {
    ...process.env,
    PORT: String(PORT),
    ADDISGO_DATA_DIR: tmpDir,
    ADDISGO_DB: path.join(tmpDir, 'avatar.db'),
    ADDISGO_EMAIL_WORKER: '0',
    ADDISGO_LOG: '0',
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
  console.log(`Avatar tests against ${BASE}`);
  await waitForServer(child, logs);

  const anonymous = new Client();
  const anonUpload = await anonymous.post('/api/profile/avatar', { data: dataUri('image/png', makePng(32, 32)) });
  check('anonymous upload -> 401', anonUpload.status === 401, JSON.stringify(anonUpload.data));
  const anonDelete = await anonymous.delete('/api/profile/avatar');
  check('anonymous removal -> 401', anonDelete.status === 401);

  const rider = new Client();
  const login = await rider.post('/api/auth/login', { email: 'meron@example.com', password: 'Rider123!' });
  check('rider login', login.status === 200, JSON.stringify(login.data));

  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const svgUpload = await rider.post('/api/profile/avatar', { data: dataUri('image/svg+xml', svg) });
  check('SVG data URI is rejected', svgUpload.status === 400, JSON.stringify(svgUpload.data));

  const disguisedSvg = await rider.post('/api/profile/avatar', { data: dataUri('image/png', svg) });
  check('SVG bytes labelled PNG are rejected', disguisedSvg.status === 400, JSON.stringify(disguisedSvg.data));

  const truncated = await rider.post('/api/profile/avatar', {
    data: dataUri('image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])),
  });
  check('truncated PNG header is rejected', truncated.status === 400, JSON.stringify(truncated.data));

  const huge = await rider.post('/api/profile/avatar', { data: dataUri('image/png', makePng(5000, 32)) });
  check('oversized dimensions are rejected', huge.status === 400, JSON.stringify(huge.data));

  const oversized = Buffer.concat([makePng(32, 32), Buffer.alloc(1024 * 1024 + 1, 0)]);
  const tooBig = await rider.post('/api/profile/avatar', { data: dataUri('image/png', oversized) });
  check('files over 1 MB are rejected', tooBig.status === 400, JSON.stringify(tooBig.data));

  const firstPng = makePng(64, 64);
  const first = await rider.post('/api/profile/avatar', { data: dataUri('image/png', firstPng) });
  check('valid PNG is accepted', first.status === 200, JSON.stringify(first.data));
  check('upload returns a local avatar URL', /^\/api\/uploads\/[a-f0-9]{32}\.png$/.test(first.data?.avatar_url || ''), String(first.data?.avatar_url));
  check('upload reports real dimensions', first.data?.width === 64 && first.data?.height === 64);

  const firstUrl = first.data?.avatar_url || '';
  const me = await rider.get('/api/auth/me');
  check('profile response includes avatar_url', me.data?.avatar_url === firstUrl, JSON.stringify(me.data?.avatar_url));

  const served = await fetch(`${BASE}${firstUrl}`);
  const servedBytes = Buffer.from(await served.arrayBuffer());
  check('avatar is served', served.status === 200);
  check('avatar has an image content type', served.headers.get('content-type') === 'image/png');
  check('served bytes match the upload', servedBytes.equals(firstPng));
  check('avatar is cached immutably', /immutable/.test(served.headers.get('cache-control') || ''));

  const secondPng = makePng(48, 48);
  const second = await rider.post('/api/profile/avatar', { data: dataUri('image/png', secondPng) });
  check('replacing the avatar works', second.status === 200 && second.data?.avatar_url !== firstUrl);

  const oldServed = await fetch(`${BASE}${firstUrl}`);
  check('replaced file is deleted', oldServed.status === 404);

  const patched = await rider.call('/api/profile', { method: 'PATCH', body: { bio: 'Avatar kept while editing.' } });
  check('editing the profile keeps the avatar', patched.status === 200 && patched.data?.avatar_url === second.data?.avatar_url);

  const removed = await rider.delete('/api/profile/avatar');
  check('removal clears avatar_url', removed.status === 200 && removed.data?.avatar_url === '');

  const afterRemove = await rider.get('/api/auth/me');
  check('profile no longer has an avatar', afterRemove.data?.avatar_url === '');

  const removedFile = await fetch(`${BASE}${second.data?.avatar_url || ''}`);
  check('removed file is deleted', removedFile.status === 404);

  const removedAgain = await rider.delete('/api/profile/avatar');
  check('removing twice is harmless', removedAgain.status === 200 && removedAgain.data?.avatar_url === '');

  const driver = new Client();
  const driverLogin = await driver.post('/api/auth/login', { email: 'dawit@example.com', password: 'Driver123!' });
  const driverUpload = await driver.post('/api/profile/avatar', { data: dataUri('image/png', makePng(32, 32)) });
  check('drivers can upload too', driverLogin.status === 200 && driverUpload.status === 200, JSON.stringify(driverUpload.data));

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
