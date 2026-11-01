/* Gmail / SMTP integration checks: app-password handling, connection
 * verification, config persistence and the offline fallback.
 * Usage: node api/tests/email.js [baseUrl]
 */
import {
  appPasswordLooksValid,
  describeSmtpError,
  isGmailAddress,
  normalizeAppPassword,
} from '../lib/email.js';

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
  del(path) { return this.call(path, { method: 'DELETE' }); }
}

(async () => {
  console.log(`Gmail integration tests against ${BASE}`);

  /* ---- Unit-level helpers ------------------------------------------- */
  check('detects gmail.com', isGmailAddress('demo@gmail.com'));
  check('detects googlemail.com', isGmailAddress('demo@googlemail.com'));
  check('rejects other domains', !isGmailAddress('demo@example.com'));
  check('strips spaces from app password', normalizeAppPassword('abcd efgh ijkl mnop') === 'abcdefghijklmnop');
  check('accepts 16-letter app password', appPasswordLooksValid('abcdefghijklmnop'));
  check('rejects short app password', !appPasswordLooksValid('short'));
  check('auth errors are actionable', describeSmtpError({ code: 'EAUTH', message: '535' }).code === 'auth_failed');
  check('network errors are actionable', describeSmtpError({ code: 'ECONNREFUSED', message: 'connect' }).code === 'network_failed');

  const admin = new Client();
  const rider = new Client();

  const adminLogin = await admin.post('/api/auth/login', { email: 'admin@addisgo.et', password: 'Admin123!' });
  check('admin login', adminLogin.status === 200);
  const riderLogin = await rider.post('/api/auth/login', { email: 'meron@example.com', password: 'Rider123!' });
  check('rider login', riderLogin.status === 200);

  /* ---- Start from the current state -------------------------------- */
  const settings = await admin.get('/api/admin/email/settings');
  check('GET email settings -> 200', settings.status === 200);
  check('settings expose connection state', settings.data?.config && 'is_configured' in settings.data.config);
  check('settings never leak the password', !JSON.stringify(settings.data?.config || {}).includes('smtp_pass'));

  const forbidden = await rider.get('/api/admin/email/settings');
  check('non-admin cannot read email settings', forbidden.status === 403);

  if (settings.data?.config?.is_configured) {
    console.log('  skip Gmail mutation checks — an account is already configured (disconnect it to run the full suite)');
    console.log(`\n${pass} passed, ${fail} failed`);
    return;
  }
  check('settings start unconfigured', settings.data?.config?.is_configured === false);

  /* ---- Verification validation (no network) ------------------------- */
  const empty = await admin.post('/api/admin/email/verify', {});
  check('verify without account -> missing_user', empty.status === 200 && empty.data?.code === 'missing_user');

  const shortPass = await admin.post('/api/admin/email/verify', { user: 'demo@gmail.com', pass: 'short' });
  check('verify rejects short app password', shortPass.status === 200 && shortPass.data?.code === 'bad_app_password');

  const unreachable = await admin.post('/api/admin/email/verify', {
    user: 'demo@example.com',
    pass: 'not-a-gmail-password',
    host: '127.0.0.1',
    port: 1,
  });
  check('verify reports unreachable server', unreachable.status === 200 && unreachable.data?.code === 'network_failed', unreachable.data?.code);
  check('failed verification clears verified_at', unreachable.data?.ok === false && !unreachable.data?.verified_at);

  /* ---- Save Gmail credentials -------------------------------------- */
  const saved = await admin.post('/api/admin/email/settings', {
    user: 'demo@gmail.com',
    pass: 'abcd efgh ijkl mnop',
    from: '',
  });
  check('save Gmail settings -> 200', saved.status === 200);
  check('Gmail host is forced', saved.data?.config?.host === 'smtp.gmail.com');
  check('Gmail port is 465', saved.data?.config?.port === 465);
  check('Gmail detected', saved.data?.config?.gmail === true);
  check('app password format accepted', saved.data?.config?.password_format_ok === true);
  check('config marked configured', saved.data?.config?.is_configured === true);
  check('password is masked', String(saved.data?.config?.masked_pass || '').endsWith('mnop'));
  check('default sender uses the Gmail account', saved.data?.config?.from === 'AddisGo <demo@gmail.com>');

  const reloaded = await admin.get('/api/admin/email/settings');
  check('Gmail settings persist', reloaded.data?.config?.user === 'demo@gmail.com');
  check('persisted config keeps Gmail defaults', reloaded.data?.config?.host === 'smtp.gmail.com' && reloaded.data?.config?.port === 465);
  check('persisted config hides password', !JSON.stringify(reloaded.data?.config || {}).includes('smtp_pass'));

  const invalidUser = await admin.post('/api/admin/email/settings', { user: 'not-an-email' });
  check('invalid account rejected', invalidUser.status === 400);

  const customSender = await admin.post('/api/admin/email/settings', {
    user: 'demo@gmail.com',
    from: 'AddisGo Support <hello@addisgo.et>',
  });
  check('custom sender saved', customSender.data?.config?.from === 'AddisGo Support <hello@addisgo.et>');

  /* ---- Offline fallback and disconnect ------------------------------ */
  const disconnected = await admin.post('/api/admin/email/disconnect', {});
  check('disconnect -> 200', disconnected.status === 200);
  check('disconnect clears the account', disconnected.data?.config?.user === '');
  check('disconnect clears configuration', disconnected.data?.config?.is_configured === false);
  check('disconnect clears verification', disconnected.data?.config?.verified_at === null);

  const offline = await admin.post('/api/admin/email/test', { recipient: 'email-suite@example.com' });
  check('test email falls back to the dev log', offline.status === 200 && offline.data?.ok === true);
  check('offline test reports logged_offline', offline.data?.method === 'logged_offline');
  check('offline test is not marked delivered', offline.data?.delivered === false);

  const outbox = await admin.get('/api/admin/email/settings');
  const logged = (outbox.data?.outbox || []).find((row) => row.recipient === 'email-suite@example.com');
  check('offline message is recorded in the outbox', Boolean(logged) && logged.status === 'logged_offline');
  if (logged) await admin.del(`/api/admin/email/outbox/${logged.id}`);

  const finalState = await admin.get('/api/admin/email/settings');
  check('suite leaves Gmail disconnected', finalState.data?.config?.is_configured === false);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log(`Failures: ${failures.join(', ')}`);
    process.exitCode = 1;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
