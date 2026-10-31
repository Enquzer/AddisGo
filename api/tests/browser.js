/* Headless browser verification over the DevTools protocol (no dependencies).
 * Usage: node api/tests/browser.js [baseUrl]
 *        ADDISGO_CHROME=<browser path>  to force a specific Chromium build.
 * Needs the AddisGo server running. Exits 0 when every check passes.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BROWSERS = [
  process.env.ADDISGO_CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const CHROME = BROWSERS.find((candidate) => {
  try { return fs.existsSync(candidate); } catch { return false; }
});

if (!CHROME) {
  console.log('No Chrome/Edge found — skipping UI checks.');
  console.log('Install Chrome or set ADDISGO_CHROME to a Chromium executable.');
  process.exit(0);
}

const BASE = (process.env.ADDISGO_BASE || process.argv[2] || 'http://localhost:3003').replace(/\/$/, '');
const PORT = Number(process.env.ADDISGO_CDP_PORT) || 9331;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'addisgo-chrome-'));
const REPORT_FILE = path.join(HERE, '.browser-report.json');

try {
  const health = await fetch(`${BASE}/api/health`);
  if (!health.ok) throw new Error(`health returned ${health.status}`);
} catch (error) {
  console.error(`AddisGo is not responding at ${BASE} (${error.message}).`);
  console.error('Start it first: node api/server.js');
  process.exit(1);
}

let pass = 0;
const failures = [];
const consoleErrors = [];
let currentStep = 'boot';

function check(name, condition, extra = '') {
  if (condition) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Minimal CDP client                                                  */
/* ------------------------------------------------------------------ */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (event) => this.#receive(event.data));
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('websocket error')), { once: true });
    });
    return new Cdp(ws);
  }

  #receive(raw) {
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    if (message.id && this.pending.has(message.id)) {
      const entry = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`));
      else entry.resolve(message.result);
      return;
    }
    if (message.method) {
      const key = `${message.sessionId || ''}|${message.method}`;
      for (const fn of this.listeners.get(key) || []) fn(message.params);
    }
  }

  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`));
      }, 20000);
    });
  }

  on(sessionId, method, fn) {
    const key = `${sessionId || ''}|${method}`;
    if (!this.listeners.has(key)) this.listeners.set(key, []);
    this.listeners.get(key).push(fn);
  }

  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

/* ------------------------------------------------------------------ */
/* Browser bootstrap                                                   */
/* ------------------------------------------------------------------ */
const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-sync',
  '--mute-audio',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--window-size=1440,960',
  'about:blank',
], { stdio: 'ignore', detached: false });

async function browserWsUrl() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) {
        const data = await res.json();
        if (data.webSocketDebuggerUrl) return data.webSocketDebuggerUrl;
      }
    } catch { /* not up yet */ }
    await sleep(150);
  }
  throw new Error('Chrome debugging port never became available');
}

const IGNORE_CONSOLE = [
  /tile\.openstreetmap\.org/i,
  /\/vendor\/leaflet/i,
  /favicon/i,
];

function noteConsole(kind, text, url = '') {
  const blob = `${text} ${url}`;
  if (IGNORE_CONSOLE.some((re) => re.test(blob))) return;
  consoleErrors.push(`[${currentStep}] ${kind}: ${text}${url ? ` (${url})` : ''}`);
}

/* ------------------------------------------------------------------ */
/* Page helpers                                                        */
/* ------------------------------------------------------------------ */
let cdp;
let sessionId;

async function evalRaw(expression, { awaitPromise = true } = {}) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
  }, sessionId);
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
    throw new Error(`page exception: ${detail}`);
  }
  return result.result.value;
}

async function waitFor(expression, { timeout = 12000, interval = 120 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await evalRaw(`Boolean(${expression})`, { awaitPromise: false })) return true;
    } catch { /* retry */ }
    await sleep(interval);
  }
  return false;
}

let navSeq = 0;

async function goto(hash, selector) {
  // A unique query string forces a real document load even when only the
  // fragment changes, so no stale in-memory app state leaks between checks.
  navSeq += 1;
  const target = `${BASE}/?v=${navSeq}${hash}`;
  await cdp.send('Page.navigate', { url: target }, sessionId);
  await waitFor(`document.readyState === 'complete'`, { timeout: 15000 });
  await waitFor(`document.querySelector('#view') && !document.querySelector('#boot-splash')`, { timeout: 15000 });
  if (selector) {
    const ok = await waitFor(`document.querySelector(${JSON.stringify(selector)})`, { timeout: 15000 });
    if (!ok) throw new Error(`selector never appeared: ${selector} @ ${hash}`);
  }
  await sleep(250);
}

async function setViewport(width, height, mobile) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile,
  }, sessionId);
}

async function overflowPx() {
  return evalRaw(`Math.max(
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
    document.body ? document.body.scrollWidth - document.body.clientWidth : 0
  )`);
}

async function loginAs(email, password, destination) {
  await cdp.send('Network.clearBrowserCookies', {}, sessionId);
  await goto('#/login', '#auth-form');
  const submitted = await evalRaw(`(() => {
    const form = document.querySelector('#auth-form');
    const email = form.querySelector('[name="email"]');
    const password = form.querySelector('[name="password"]');
    email.value = ${JSON.stringify(email)};
    password.value = ${JSON.stringify(password)};
    email.dispatchEvent(new Event('input', { bubbles: true }));
    password.dispatchEvent(new Event('input', { bubbles: true }));
    form.requestSubmit();
    return true;
  })()`);
  if (!submitted) throw new Error('could not submit login form');
  const moved = await waitFor(`location.hash !== '#/login'`, { timeout: 15000 });
  if (!moved) {
    const alert = await evalRaw(`document.querySelector('#auth-error')?.textContent?.trim() || ''`);
    throw new Error(`login did not navigate: ${alert}`);
  }
  const ok = await waitFor(`document.querySelector(${JSON.stringify(destination)})`, { timeout: 15000 });
  if (!ok) throw new Error(`destination never rendered: ${destination}`);
  await sleep(300);
}

async function clickTab(key) {
  return evalRaw(`(() => {
    const btn = document.querySelector('.tabs [data-tab="' + ${JSON.stringify(key)} + '"]')
      || document.querySelector('[data-tab="' + ${JSON.stringify(key)} + '"]');
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
}

/* ------------------------------------------------------------------ */
/* Scenarios                                                           */
/* ------------------------------------------------------------------ */
async function main() {
  cdp = await Cdp.connect(await browserWsUrl());
  const created = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const attached = await cdp.send('Target.attachToTarget', { targetId: created.targetId, flatten: true });
  sessionId = attached.sessionId;

  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);
  await cdp.send('Network.enable', {}, sessionId);

  cdp.on(sessionId, 'Runtime.consoleAPICalled', (params) => {
    if (params.type !== 'error') return;
    const text = (params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
    noteConsole('console.error', text);
  });
  cdp.on(sessionId, 'Runtime.exceptionThrown', (params) => {
    const d = params.exceptionDetails;
    noteConsole('exception', d.exception?.description || d.text || 'unknown');
  });
  cdp.on(sessionId, 'Log.entryAdded', (params) => {
    const entry = params.entry;
    if (entry.level !== 'error') return;
    noteConsole('log', entry.text || '', entry.url || '');
  });
  cdp.on(sessionId, 'Page.javascriptDialogOpening', async (params) => {
    noteConsole('dialog', `${params.type}: ${params.message}`);
    try {
      await cdp.send('Page.handleJavaScriptDialog', { accept: false }, sessionId);
    } catch { /* gone already */ }
  });

  /* 1 · Guest landing ------------------------------------------------ */
  currentStep = 'landing';
  await setViewport(1440, 960, false);
  await goto('#/', '.landing');
  check('landing renders hero', await evalRaw(`!!document.querySelector('.hero-copy h1')`));
  check('landing shows feature grid', await evalRaw(`document.querySelectorAll('.feature-grid .feature-card').length >= 3`));
  check('landing lists ride classes', await evalRaw(`document.querySelectorAll('.ride-class-list .ride-class-row').length >= 4`));
  await waitFor(`document.querySelectorAll('.tour-preview .preview-tour').length >= 1`, { timeout: 12000 });
  check('landing previews tours', await evalRaw(`document.querySelectorAll('.tour-preview .preview-tour').length >= 1`));
  check('landing has footer', await evalRaw(`!!document.querySelector('.site-footer')`));
  check('guest nav offers sign in', await evalRaw(`!!document.querySelector('a[href="#/login"]')`));
  check('desktop landing has no horizontal overflow', (await overflowPx()) <= 1, `${await overflowPx()}px`);

  currentStep = 'landing-mobile';
  await setViewport(390, 844, true);
  await sleep(400);
  check('mobile landing hides sidebar', await evalRaw(`(() => {
    const el = document.querySelector('.sidebar');
    if (!el) return true;
    const s = getComputedStyle(el);
    return s.display === 'none' || s.visibility === 'hidden' || el.getBoundingClientRect().right <= 1;
  })()`));
  check('mobile landing shows bottom nav', await evalRaw(`(() => {
    const el = document.querySelector('.bottom-nav');
    if (!el) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && el.getBoundingClientRect().height > 20;
  })()`));
  const mobileOverflow = await overflowPx();
  check('mobile landing has no horizontal overflow', mobileOverflow <= 1, `${mobileOverflow}px`);

  /* 2 · Public tours ------------------------------------------------ */
  currentStep = 'tours';
  await setViewport(1440, 960, false);
  await goto('#/tours', '.tours-page');
  await waitFor(`document.querySelectorAll('.tour-grid-item').length > 0`, { timeout: 15000 });
  const tourCount = await evalRaw(`document.querySelectorAll('.tour-grid-item').length`);
  check('tours grid shows tour cards', tourCount >= 3, `${tourCount} cards`);
  check('tours filters present', await evalRaw(`document.querySelectorAll('[data-scope]').length >= 2`));

  currentStep = 'tour-detail';
  const tourHref = await evalRaw(`document.querySelector('.tour-grid-item a[href^="#/tour/"]')?.getAttribute('href') || ''`);
  check('tour card links to detail page', Boolean(tourHref), tourHref);
  if (tourHref) {
    await goto(tourHref, '.tour-detail');
    check('tour detail hero renders', await evalRaw(`!!document.querySelector('.tour-hero')`));
    check('tour detail lists facts', await evalRaw(`document.querySelectorAll('.tour-fact, .fact').length >= 2`));
    check('tour detail has ride-here action', await evalRaw(`!!document.querySelector('[data-act="ride-here"]')`));
    check('tour detail has report action', await evalRaw(`!!document.querySelector('[data-act="report"]')`));
    check('tour chat panel exists', await evalRaw(`!!document.querySelector('#tour-chat-panel')`));
    check('tour detail initialises the map', await waitFor(`document.querySelectorAll('.leaflet-container, .map-fallback').length >= 1`, { timeout: 8000 }));
    check('guest chat is gated', await evalRaw(`(() => {
      const panel = document.querySelector('#tour-chat-panel');
      if (!panel) return false;
      const disabled = panel.querySelector('[disabled], .chat-disabled, .is-disabled');
      return Boolean(disabled) || /join/i.test(panel.textContent);
    })()`));
  }

  /* 3 · Login form -------------------------------------------------- */
  currentStep = 'login-form';
  await goto('#/login', '#auth-form');
  check('login form has email field', await evalRaw(`!!document.querySelector('#auth-form [name="email"]')`));
  check('login form has password field', await evalRaw(`!!document.querySelector('#auth-form [name="password"]')`));
  check('login form offers demo accounts', await evalRaw(`document.querySelectorAll('.demo-chip').length >= 3`));

  /* 4 · Rider ------------------------------------------------------- */
  currentStep = 'rider-home';
  await loginAs('meron@example.com', 'Rider123!', '.home-page');
  check('rider lands on dashboard', await evalRaw(`!!document.querySelector('.home-page')`));
  check('rider sees active ride panel', await evalRaw(`!!document.querySelector('#active-ride')`));
  check('rider sees nearby map', await evalRaw(`!!document.querySelector('#home-map')`));

  currentStep = 'rider-ride';
  await goto('#/ride', '.ride-booking');
  const classCount = await evalRaw(`document.querySelectorAll('.class-option').length`);
  check('ride page lists four classes', classCount >= 4, `${classCount}`);
  check('ride page has booking form', await evalRaw(`!!document.querySelector('#booking-form')`));
  check('ride page has pickup + dropoff', await evalRaw(`!!document.querySelector('#pickup-input') && !!document.querySelector('#dropoff-input')`));
  check('ride page shows map', await evalRaw(`!!document.querySelector('#booking-map')`));
  check('ride map initialises', await waitFor(`document.querySelector('#booking-map.leaflet-container, #booking-map .map-fallback')`, { timeout: 8000 }));

  const fareBefore = await evalRaw(`document.querySelector('#book-btn')?.disabled`);
  check('book button starts disabled', fareBefore === true);

  await evalRaw(`(() => {
    const set = (sel, value) => {
      const el = document.querySelector(sel);
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('#pickup-input', 'Bole Medhanialem');
    set('#dropoff-input', 'Meskel Square');
    document.querySelector('#dropoff-input').dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  })()`);
  const fareReady = await waitFor(`!document.querySelector('#book-btn')?.disabled`, { timeout: 12000 });
  check('fare estimate enables booking', fareReady);
  const summaryText = await evalRaw(`document.querySelector('#fare-summary')?.textContent?.replace(/\\s+/g, ' ').trim() || ''`);
  check('fare summary shows a price', /ETB|\d/.test(summaryText), summaryText.slice(0, 80));
  check('ride page has no horizontal overflow', (await overflowPx()) <= 1, `${await overflowPx()}px`);

  currentStep = 'rider-trips';
  await goto('#/trips', '.trips-page');
  await waitFor(`document.querySelectorAll('.ride-card').length > 0`, { timeout: 12000 });
  const rideCards = await evalRaw(`document.querySelectorAll('.ride-card').length`);
  check('trips page lists seeded rides', rideCards >= 1, `${rideCards}`);
  check('trips page has filters', await evalRaw(`document.querySelectorAll('[data-filter]').length >= 3`));
  await evalRaw(`document.querySelector('[data-filter="completed"]')?.click()`);
  await sleep(350);
  check('trip filter switches view', await evalRaw(`document.querySelector('[data-filter="completed"]')?.classList.contains('is-active')`));

  currentStep = 'rider-profile';
  await goto('#/profile?tab=profile', '.profile-page');
  check('profile page renders shell', await evalRaw(`!!document.querySelector('.profile-shell')`));
  for (const key of ['profile', 'security', 'safety']) {
    const clicked = await clickTab(key);
    await sleep(450);
    const visible = await evalRaw(`(() => {
      const panel = document.querySelector('[data-panel="' + ${JSON.stringify(key)} + '"]');
      return Boolean(panel) && !panel.hidden;
    })()`);
    check(`profile tab "${key}" switches`, clicked && visible);
  }
  check('profile safety tab loads content', await evalRaw(`(() => {
    const panel = document.querySelector('[data-panel="safety"]');
    return Boolean(panel) && panel.textContent.trim().length > 80;
  })()`));
  check('profile has no visible error block', await evalRaw(`!document.querySelector('.profile-page .error-block')`));

  /* 5 · Mobile rider ------------------------------------------------ */
  currentStep = 'rider-mobile';
  await setViewport(390, 844, true);
  for (const [hash, sel] of [['#/', '.home-page'], ['#/ride', '.ride-booking'], ['#/trips', '.trips-page'], ['#/tours', '.tours-page']]) {
    await goto(hash, sel);
    const px = await overflowPx();
    check(`mobile ${hash} has no overflow`, px <= 1, `${px}px`);
  }
  await setViewport(1440, 960, false);

  /* 6 · Driver ------------------------------------------------------ */
  currentStep = 'driver';
  await loginAs('dawit@example.com', 'Driver123!', '.driver-page');
  check('driver dashboard renders', await evalRaw(`!!document.querySelector('.driver-page')`));
  check('driver has online toggle', await evalRaw(`!!document.querySelector('#online-toggle')`));
  check('driver sees stats', await evalRaw(`document.querySelectorAll('.stat-card').length >= 3`));
  for (const key of ['overview', 'requests', 'vehicle', 'verify']) {
    const clicked = await clickTab(key);
    await sleep(600);
    const visible = await evalRaw(`(() => {
      const panel = document.querySelector('[data-panel="' + ${JSON.stringify(key)} + '"]');
      return Boolean(panel) && !panel.hidden;
    })()`);
    check(`driver tab "${key}" switches`, clicked && visible);
  }
  const driverErrors = await evalRaw(`document.querySelectorAll('.driver-page .error-block').length`);
  check('driver dashboard has no error blocks', driverErrors === 0, `${driverErrors} blocks`);
  const driverHash = await evalRaw(`location.hash`);
  check('driver tab state persists in URL', /tab=verify/.test(driverHash), driverHash);

  currentStep = 'driver-mobile';
  await setViewport(390, 844, true);
  await goto('#/driver', '.driver-page');
  check('mobile driver has no overflow', (await overflowPx()) <= 1, `${await overflowPx()}px`);
  await setViewport(1440, 960, false);

  /* 7 · Admin ------------------------------------------------------- */
  currentStep = 'admin';
  await loginAs('admin@addisgo.et', 'Admin123!', '.admin-page');
  check('admin console renders', await evalRaw(`!!document.querySelector('.admin-page')`));
  const tabs = ['overview', 'drivers', 'users', 'bookings', 'tours', 'safety', 'audit'];
  for (const key of tabs) {
    const clicked = await clickTab(key);
    await sleep(750);
    const state = await evalRaw(`(() => {
      const panel = document.querySelector('[data-panel="' + ${JSON.stringify(key)} + '"]');
      if (!panel || panel.hidden) return 'hidden';
      if (panel.querySelector('.error-block')) return 'error';
      return panel.textContent.trim().length > 40 ? 'ok' : 'empty';
    })()`);
    check(`admin tab "${key}" loads`, clicked && state === 'ok', state);
  }
  check('admin overview shows KPIs', await evalRaw(`document.querySelectorAll('.stat-card').length >= 3`));

  currentStep = 'admin-mobile';
  await setViewport(390, 844, true);
  await goto('#/admin', '.admin-page');
  check('mobile admin has no page overflow', (await overflowPx()) <= 1, `${await overflowPx()}px`);

  /* 8 · Authz + 404 ------------------------------------------------- */
  currentStep = 'authz';
  await setViewport(1440, 960, false);
  await loginAs('meron@example.com', 'Rider123!', '.home-page');
  await goto('#/admin', '#view');
  await sleep(900);
  const adminBlocked = await evalRaw(`(() => {
    const txt = document.querySelector('#view')?.textContent || '';
    return !document.querySelector('.admin-page') || /not allowed|permission|403|admins only/i.test(txt);
  })()`);
  check('rider cannot open admin console', adminBlocked);

  currentStep = 'notfound';
  await goto('#/definitely-not-a-page', '#view');
  await sleep(700);
  check('unknown route shows a friendly page', await evalRaw(`(document.querySelector('#view')?.textContent || '').trim().length > 20`));

  /* 9 · Console health --------------------------------------------- */
  currentStep = 'console';
  await sleep(600);
  check('no browser console errors', consoleErrors.length === 0, consoleErrors.slice(0, 6).join(' | '));

  /* Report ---------------------------------------------------------- */
  const report = {
    passed: pass,
    failed: failures.length,
    failures,
    consoleErrors,
    when: new Date().toISOString(),
  };
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) console.log(`Failed: ${failures.join('; ')}`);
  if (consoleErrors.length) console.log(`Console errors:\n  ${consoleErrors.join('\n  ')}`);
  process.exitCode = failures.length ? 1 : 0;
}

try {
  await main();
} catch (error) {
  console.error(`FATAL [${currentStep}]: ${error.message}`);
  if (consoleErrors.length) console.error(`Console errors:\n  ${consoleErrors.join('\n  ')}`);
  process.exitCode = 1;
} finally {
  cdp?.close();
  try { chrome.kill(); } catch { /* ignore */ }
  await sleep(400);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(process.exitCode ?? 0);
}
