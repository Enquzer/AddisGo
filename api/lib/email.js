import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import { nowIso } from './util.js';

const API_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LOG_PATH = path.join(path.dirname(API_DIR), 'data', 'emails.log');

export const GMAIL_HOST = 'smtp.gmail.com';
const GMAIL_DOMAINS = ['gmail.com', 'googlemail.com'];

/** Gmail addresses always talk to Google's SMTP server, never a custom host. */
export function isGmailAddress(email) {
  const value = String(email ?? '').trim().toLowerCase();
  const domain = value.split('@').pop();
  return value.includes('@') && GMAIL_DOMAINS.includes(domain);
}

/**
 * Google shows app passwords as four groups of four letters ("abcd efgh ijkl mnop").
 * Users often paste the spaces, so strip whitespace and separators before use.
 */
export function normalizeAppPassword(value) {
  return String(value ?? '').replace(/[\s\-_]+/g, '');
}

/** Google app passwords are exactly 16 letters/digits. */
export function appPasswordLooksValid(value) {
  return /^[a-zA-Z0-9]{16}$/.test(normalizeAppPassword(value));
}

function readMeta(db, key) {
  try {
    const row = db.get('SELECT value FROM meta WHERE key = ?', [key]);
    return row ? row.value : null;
  } catch {
    return null;
  }
}

function writeMeta(db, key, value) {
  try {
    if (value === undefined || value === null) {
      db.run('DELETE FROM meta WHERE key = ?', [key]);
    } else {
      db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
        key,
        String(value),
      ]);
    }
  } catch {
    /* configuration diagnostics are best-effort */
  }
}

/**
 * Retrieve current email configuration from SQLite meta table, falling back to process.env.
 */
export function getEmailConfig(db) {
  const user = readMeta(db, 'smtp_user') || process.env.SMTP_USER || '';
  const pass = normalizeAppPassword(readMeta(db, 'smtp_pass') || process.env.SMTP_PASS || '');
  const gmail = isGmailAddress(user);

  let host = readMeta(db, 'smtp_host') || process.env.SMTP_HOST || GMAIL_HOST;
  let port = Number(readMeta(db, 'smtp_port') || process.env.SMTP_PORT || 465) || 465;
  if (gmail) {
    host = GMAIL_HOST;
    port = port === 587 ? 587 : 465;
  }

  const from = readMeta(db, 'smtp_from') || process.env.SMTP_FROM || (user ? `AddisGo <${user}>` : 'AddisGo <support@addisgo.et>');

  return {
    host,
    port,
    user,
    pass,
    from,
    gmail,
    is_configured: Boolean(user && pass),
    password_set: Boolean(pass),
    password_format_ok: gmail ? appPasswordLooksValid(pass) : Boolean(pass),
    masked_pass: pass ? '••••••••' + pass.slice(-4) : '',
    verified_at: readMeta(db, 'smtp_verified_at') || null,
    last_test_at: readMeta(db, 'smtp_last_test_at') || null,
    last_error: readMeta(db, 'smtp_last_error') || null,
  };
}

/** Merge stored config with candidate values without persisting anything. */
function resolveConnection(base, overrides = {}) {
  const user = String(overrides.user ?? base.user ?? '').trim();
  const pass = normalizeAppPassword(overrides.pass ?? base.pass ?? '');
  const gmail = isGmailAddress(user);

  let host = String(overrides.host ?? base.host ?? GMAIL_HOST).trim() || GMAIL_HOST;
  let port = Number(overrides.port ?? base.port ?? 465) || 465;
  if (gmail) {
    host = GMAIL_HOST;
    port = port === 587 ? 587 : 465;
  }

  return {
    user,
    pass,
    host,
    port,
    gmail,
    from: String(overrides.from ?? base.from ?? '').trim() || (user ? `AddisGo <${user}>` : 'AddisGo <support@addisgo.et>'),
  };
}

/** Nodemailer transport with Gmail-safe TLS, timeouts and app-password handling. */
export function buildTransport(conn) {
  return nodemailer.createTransport({
    host: conn.host,
    port: conn.port,
    secure: conn.port === 465,
    requireTLS: conn.port === 587,
    auth: conn.user ? { user: conn.user, pass: conn.pass } : undefined,
    tls: { rejectUnauthorized: process.env.SMTP_TLS_INSECURE !== '1' },
    connectionTimeout: 12000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
}

/** Turn SMTP failures into something an admin can act on. */
export function describeSmtpError(error, conn = {}) {
  const detail = String(error?.message || error || '').trim().slice(0, 400);
  const code = String(error?.code || '');
  const server = conn.gmail || isGmailAddress(conn.user) ? 'Gmail' : (conn.host || 'the mail server');

  if (code === 'EAUTH' || /535|534-5\.7\.9|Username and Password not accepted|Invalid login|authentication failed/i.test(detail)) {
    return {
      code: 'auth_failed',
      message: conn.gmail || isGmailAddress(conn.user)
        ? 'Google rejected the sign-in. Use a 16-character App Password (not your normal Gmail password), and make sure 2-Step Verification is turned on.'
        : `${server} rejected the sign-in. Check the username and password.`,
      detail,
    };
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return {
      code: 'dns_failed',
      message: `Could not reach ${server}. Check this server's internet connection and DNS.`,
      detail,
    };
  }
  if (/ETIMEDOUT|ESOCKET|ECONNECTION|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH/i.test(code) || /timeout|connect/i.test(detail)) {
    return {
      code: 'network_failed',
      message: `Could not open a secure connection to ${server}. The SMTP port may be blocked by your network or firewall.`,
      detail,
    };
  }
  if (code === 'EENVELOPE' || /550 5\.1\.1|recipient address rejected/i.test(detail)) {
    return {
      code: 'recipient_rejected',
      message: `${server} rejected the recipient address. Check the email address and try again.`,
      detail,
    };
  }
  if (/self.signed|certificate|CERT_|TLS/i.test(code) || /certificate/i.test(detail)) {
    return {
      code: 'tls_failed',
      message: `The secure TLS connection to ${server} failed. Check the server clock and any network proxy settings.`,
      detail,
    };
  }
  return {
    code: 'smtp_failed',
    message: `${server} could not complete the connection. Check the address and app password, then try again.`,
    detail,
  };
}

function publicConnection(conn) {
  return { host: conn.host, port: conn.port, user: conn.user, gmail: conn.gmail };
}

/**
 * Verify Gmail credentials without sending mail. Safe to call with candidate
 * values from the setup form: candidate credentials are never persisted here.
 */
export async function verifyEmailConfig(db, overrides = {}) {
  const conn = resolveConnection(getEmailConfig(db), overrides);
  const started = Date.now();

  if (!conn.user) {
    return { ok: false, code: 'missing_user', message: 'Enter the Gmail address you want AddisGo to send from.', ...publicConnection(conn) };
  }
  if (!conn.pass) {
    return { ok: false, code: 'missing_password', message: 'Enter the 16-character Google App Password.', ...publicConnection(conn) };
  }
  if (conn.gmail && !appPasswordLooksValid(conn.pass)) {
    return {
      ok: false,
      code: 'bad_app_password',
      message: 'A Google App Password is exactly 16 letters/digits. Remove any extra characters, or create a new app password at myaccount.google.com/apppasswords.',
      ...publicConnection(conn),
    };
  }

  try {
    const transporter = buildTransport(conn);
    await transporter.verify();
    const timestamp = nowIso();
    writeMeta(db, 'smtp_verified_at', timestamp);
    writeMeta(db, 'smtp_last_error', null);
    return {
      ok: true,
      code: 'ok',
      message: conn.gmail
        ? 'Google accepted the sign-in. Real email delivery is ready.'
        : 'The mail server accepted the sign-in.',
      verified_at: timestamp,
      duration_ms: Date.now() - started,
      ...publicConnection(conn),
    };
  } catch (error) {
    const info = describeSmtpError(error, conn);
    writeMeta(db, 'smtp_verified_at', null);
    writeMeta(db, 'smtp_last_error', info.message);
    return {
      ok: false,
      ...info,
      duration_ms: Date.now() - started,
      ...publicConnection(conn),
    };
  }
}

/**
 * Persist email configuration into database meta table.
 */
export function saveEmailConfig(db, { user, pass, from, host, port }) {
  const current = getEmailConfig(db);
  const nextUser = user !== undefined ? String(user).trim() : current.user;
  const nextPass = pass !== undefined && String(pass).trim() !== ''
    ? normalizeAppPassword(pass)
    : current.pass;
  const gmail = isGmailAddress(nextUser);

  let nextHost = host !== undefined ? String(host).trim() : current.host;
  let nextPort = port !== undefined ? Number(port) : current.port;
  if (gmail) {
    nextHost = GMAIL_HOST;
    nextPort = nextPort === 587 ? 587 : 465;
  }
  if (!nextHost) nextHost = GMAIL_HOST;
  if (!nextPort) nextPort = 465;

  let nextFrom = from !== undefined ? String(from).trim() : current.from;
  const builtInSupport = /^AddisGo <support@addisgo\.et>$/i.test(nextFrom);
  if (gmail && (!nextFrom || builtInSupport)) nextFrom = `AddisGo <${nextUser}>`;
  if (!nextFrom) nextFrom = nextUser ? `AddisGo <${nextUser}>` : 'AddisGo <support@addisgo.et>';

  writeMeta(db, 'smtp_user', nextUser);
  if (nextPass) writeMeta(db, 'smtp_pass', nextPass);
  writeMeta(db, 'smtp_from', nextFrom);
  writeMeta(db, 'smtp_host', nextHost);
  writeMeta(db, 'smtp_port', nextPort);

  // Changing the account or password invalidates the previous verification.
  if (current.user !== nextUser || current.pass !== nextPass) {
    writeMeta(db, 'smtp_verified_at', null);
    writeMeta(db, 'smtp_last_error', null);
    writeMeta(db, 'smtp_last_test_at', null);
  }

  return getEmailConfig(db);
}

/** Remove stored Gmail credentials and verification state. */
export function clearEmailConfig(db) {
  for (const key of ['smtp_user', 'smtp_pass', 'smtp_from', 'smtp_verified_at', 'smtp_last_test_at', 'smtp_last_error']) {
    writeMeta(db, key, null);
  }
  return getEmailConfig(db);
}

/**
 * Dispatch an email via Google/SMTP or log locally if not configured.
 */
export async function sendMail(db, { to, subject, html, text, template = 'generic' }) {
  const config = getEmailConfig(db);
  const timestamp = nowIso();

  if (config.is_configured) {
    const conn = resolveConnection(config);
    try {
      const transporter = buildTransport(conn);

      await transporter.sendMail({
        from: config.from,
        to,
        subject,
        text: text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        html,
      });

      try {
        db.run(
          'INSERT INTO email_outbox (recipient, subject, template, status, created_at) VALUES (?, ?, ?, ?, ?)',
          [to, subject, template, 'sent', timestamp],
        );
      } catch {
        /* outbox record non-fatal */
      }

      writeMeta(db, 'smtp_last_error', null);
      writeMeta(db, 'smtp_verified_at', timestamp);

      console.log(`[Email] Dispatched via ${conn.host} to <${to}>: "${subject}"`);
      return { ok: true, method: 'smtp', delivered: true, recipient: to };
    } catch (err) {
      const info = describeSmtpError(err, conn);
      console.error(`[Email Error] Failed to send via SMTP to <${to}>:`, info.detail || info.message);
      writeMeta(db, 'smtp_last_error', info.message);
      try {
        db.run(
          'INSERT INTO email_outbox (recipient, subject, template, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [to, subject, template, 'failed', info.message, timestamp],
        );
      } catch {
        /* ignore */
      }
      return { ok: false, error: info.message, code: info.code, detail: info.detail, method: 'smtp' };
    }
  } else {
    // Development / Offline fallback logger
    const logEntry = `\n--- [OUTBOX ${timestamp}] ---\nTo: ${to}\nSubject: ${subject}\nTemplate: ${template}\n${text || html.slice(0, 300)}...\n------------------------------\n`;
    try {
      fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
      fs.appendFileSync(LOG_PATH, logEntry, 'utf8');
      db.run(
        'INSERT INTO email_outbox (recipient, subject, template, status, created_at) VALUES (?, ?, ?, ?, ?)',
        [to, subject, template, 'logged_offline', timestamp],
      );
    } catch {
      /* ignore */
    }

    console.log(`[Email Logger] (${template}) to <${to}>: "${subject}" (Stored in data/emails.log)`);
    return { ok: true, method: 'logged_offline', delivered: false, recipient: to };
  }
}

// -----------------------------------------------------------------------------
// HTML Email Templates (Branded AddisGo Responsive Styling)
// -----------------------------------------------------------------------------

function emailLayout({ title, previewText, contentHtml }) {
  return `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; }
    .wrapper { max-width: 580px; margin: 30px auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(0, 17, 75, 0.05); }
    .header { background: linear-gradient(135deg, #00114B 0%, #0c2d6b 100%); padding: 32px 28px; text-align: center; color: #ffffff; }
    .header h1 { margin: 12px 0 0 0; font-size: 24px; font-weight: 800; letter-spacing: -0.02em; }
    .header p { margin: 4px 0 0 0; font-size: 13px; color: #93c5fd; }
    .body { padding: 32px 28px; line-height: 1.6; }
    .body h2 { font-size: 20px; color: #00114B; margin-top: 0; }
    .card-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin: 20px 0; }
    .btn { display: inline-block; background: #00114B; color: #ffffff !important; padding: 12px 24px; border-radius: 8px; font-weight: 600; text-decoration: none; margin: 14px 0; }
    .footer { background: #f8fafc; padding: 20px 28px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; }
    .badge { display: inline-block; background: #def7ec; color: #03543f; padding: 4px 10px; border-radius: 99px; font-size: 12px; font-weight: 700; }
  </style>
</head>
<body>
  <div style="display:none;font-size:1px;color:#f1f5f9;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    ${previewText}
  </div>
  <div class="wrapper">
    <div class="header">
      <div style="font-size: 28px; font-weight: 900; letter-spacing: -0.03em;">AddisGo</div>
      <p>Clean Electric Mobility &amp; Addis City Guides</p>
    </div>
    <div class="body">
      ${contentHtml}
    </div>
    <div class="footer">
      <p>AddisGo Digital Mobility · Addis Ababa, Ethiopia</p>
      <p>Need support? Contact us at <a href="mailto:support@addisgo.et" style="color:#2563eb;">support@addisgo.et</a></p>
    </div>
  </div>
</body>
</html>
`;
}

/**
 * 1. User Registration Welcome Email
 */
export async function sendWelcomeEmail(db, user) {
  const isDriver = user.role === 'driver';
  const title = `Welcome to AddisGo, ${user.name}!`;
  const previewText = `Your AddisGo account is ready. Explore electric rides and city tours across Addis Ababa.`;

  const contentHtml = `
    <h2>Selam ${user.name}, welcome aboard! 👋</h2>
    <p>Thank you for joining AddisGo — the digital mobility and verified small-group tour platform built specifically for Addis Ababa.</p>
    
    <div class="card-box">
      <strong>Your Account Summary:</strong><br>
      • <strong>Email:</strong> ${user.email}<br>
      • <strong>Role:</strong> <span class="badge">${isDriver ? 'Driver Partner' : 'Rider / Explorer'}</span><br>
      • <strong>Status:</strong> Active
    </div>

    ${
      isDriver
        ? `<p>Your driver application is in review. Our operations team will verify your driving license and vehicle within 24 hours. Once approved, you can start accepting rides immediately.</p>`
        : `<p>You can now book zero-emission electric rides across all Addis subcities, navigate using genuine local taxi landmarks, and join guided walking tours.</p>`
    }

    <div style="text-align: center; margin: 24px 0;">
      <a href="http://localhost:3003/#/${isDriver ? 'driver' : 'ride'}" class="btn">
        ${isDriver ? 'Open Driver Dashboard' : 'Book Your First Ride'}
      </a>
    </div>

    <p style="font-size: 13px; color: #64748b;">
      Tip: Standard street numbers fail in Addis! When booking, our app uses local neighbourhood landmarks and Amharic phonetic taxi tips to ensure your driver finds you seamlessly.
    </p>
  `;

  return sendMail(db, {
    to: user.email,
    subject: `Welcome to AddisGo, ${user.name}! 🇪🇹`,
    html: emailLayout({ title, previewText, contentHtml }),
    template: 'welcome',
  });
}

/**
 * 2. Ride Booking Confirmation & Receipt Email
 */
export async function sendReceiptEmail(db, booking, user, driver) {
  const title = `AddisGo Ride Receipt #${booking.code}`;
  const previewText = `Your ride receipt for ${booking.pickup} → ${booking.dropoff} (${booking.fare} ETB).`;

  const contentHtml = `
    <h2>Your Trip Receipt 🚗</h2>
    <p>Here are the details for your recent trip with AddisGo.</p>

    <div class="card-box">
      <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
        <strong>Receipt Code:</strong> <code>#${booking.code}</code>
      </div>
      <div style="border-top: 1px dashed #cbd5e1; padding-top: 10px; margin-top: 10px;">
        <p style="margin: 4px 0;">📍 <strong>Pickup:</strong> ${booking.pickup}</p>
        <p style="margin: 4px 0;">🏁 <strong>Drop-off:</strong> ${booking.dropoff}</p>
        <p style="margin: 4px 0;">⚡ <strong>Vehicle Class:</strong> ${booking.vehicle_class.toUpperCase()}</p>
        ${driver ? `<p style="margin: 4px 0;">👤 <strong>Driver:</strong> ${driver.name} (${driver.plate})</p>` : ''}
        <p style="margin: 4px 0;">📏 <strong>Distance:</strong> ${booking.distance_km} km (${booking.duration_min} min)</p>
      </div>
      <div style="border-top: 1px solid #cbd5e1; padding-top: 12px; margin-top: 12px; font-size: 18px; font-weight: 800; color: #00114B;">
        Total Fare: ${booking.fare} ETB
      </div>
    </div>

    <p style="font-size: 13px; color: #03543f; background: #def7ec; padding: 10px; border-radius: 8px;">
      🌱 <strong>Clean Ride Impact:</strong> By choosing an electric E2 ride, you saved ~${Math.round(booking.distance_km * 120)}g of tailpipe CO₂ emissions in Addis Ababa!
    </p>

    <div style="text-align: center; margin: 20px 0;">
      <a href="http://localhost:3003/#/ride" class="btn">View in App</a>
    </div>
  `;

  return sendMail(db, {
    to: user.email,
    subject: `AddisGo Ride Receipt #${booking.code} (${booking.fare} ETB)`,
    html: emailLayout({ title, previewText, contentHtml }),
    template: 'receipt',
  });
}

/**
 * 3. Tour Joined Confirmation Email
 */
export async function sendTourConfirmationEmail(db, tour, user) {
  const title = `Tour Confirmed: ${tour.title}`;
  const previewText = `You're confirmed for ${tour.title} at ${tour.meeting_point}!`;

  const contentHtml = `
    <h2>You're booked for: ${tour.title}! 🧭</h2>
    <p>Selam ${user.name}, you have secured your spot for this upcoming Addis experience.</p>

    <div class="card-box">
      <p style="margin: 4px 0;">📅 <strong>Date &amp; Time:</strong> ${new Date(tour.starts_at).toLocaleString()}</p>
      <p style="margin: 4px 0;">📍 <strong>Meeting Point:</strong> ${tour.meeting_point}</p>
      <p style="margin: 4px 0;">⏳ <strong>Duration:</strong> ${tour.duration_min} minutes</p>
      <p style="margin: 4px 0;">💵 <strong>Price:</strong> ${tour.price === 0 ? 'Free' : `${tour.price} ETB`}</p>
      <p style="margin: 4px 0;">👤 <strong>Host:</strong> ${tour.host ? tour.host.name : 'Verified Local Guide'}</p>
    </div>

    <p>${tour.description || ''}</p>

    <div style="text-align: center; margin: 20px 0;">
      <a href="http://localhost:3003/#/tour/${tour.id}" class="btn">Open Tour &amp; Group Chat</a>
    </div>

    <p style="font-size: 13px; color: #64748b;">
      Tip: You can chat directly with your host and fellow attendees in the live tour group room before the tour begins.
    </p>
  `;

  return sendMail(db, {
    to: user.email,
    subject: `Confirmed: ${tour.title} 🧭`,
    html: emailLayout({ title, previewText, contentHtml }),
    template: 'tour_confirmed',
  });
}

/**
 * 4. Newsletter Subscription Welcome Email
 */
export async function sendNewsletterWelcomeEmail(db, email) {
  const title = `Welcome to AddisGo News & City Highlights`;
  const previewText = `You're subscribed to Addis weekend tours, cultural discoveries and mobility updates.`;

  const contentHtml = `
    <h2>Selam! You're on the list 🗞️</h2>
    <p>Thank you for subscribing to AddisGo updates. You'll receive:</p>

    <div class="card-box">
      • <strong>Weekend City Tours:</strong> New walking routes, Entoto ridge hikes &amp; Merkato food loops.<br>
      • <strong>Addis Mobility News:</strong> Electric vehicle charging spots and corridor route updates.<br>
      • <strong>Community Stories:</strong> Local artisan highlights, driver spotlights, and cultural events.
    </div>

    <p>Zero spam — only curated, thoughtful Addis Ababa discoveries.</p>

    <div style="text-align: center; margin: 20px 0;">
      <a href="http://localhost:3003/#/tours" class="btn">Browse Current Tours</a>
    </div>
  `;

  return sendMail(db, {
    to: email,
    subject: `Welcome to AddisGo News & City Guides! 🇪🇹`,
    html: emailLayout({ title, previewText, contentHtml }),
    template: 'newsletter_welcome',
  });
}

/**
 * 5. Admin Test Email
 */
export async function sendTestEmail(db, to) {
  const config = getEmailConfig(db);
  const title = `AddisGo Google Mail Test`;
  const previewText = `Google SMTP email test sent successfully from AddisGo.`;

  const contentHtml = `
    <h2>Google Email Connected Successfully! ✅</h2>
    <p>This test email confirms that your Google / Gmail SMTP integration with AddisGo is working properly.</p>

    <div class="card-box">
      <strong>Active Connection Details:</strong><br>
      • <strong>SMTP Host:</strong> ${config.host}<br>
      • <strong>Port:</strong> ${config.port}<br>
      • <strong>Google Account:</strong> ${config.user || 'None'}<br>
      • <strong>Timestamp:</strong> ${nowIso()}
    </div>

    <p>Real registration welcomes, ride receipts, and tour notifications will now be delivered reliably via this Google account.</p>
  `;

  const result = await sendMail(db, {
    to,
    subject: `AddisGo Google Mail Test [Success] ✅`,
    html: emailLayout({ title, previewText, contentHtml }),
    template: 'admin_test',
  });

  if (result.ok && result.method === 'smtp') {
    const timestamp = nowIso();
    writeMeta(db, 'smtp_last_test_at', timestamp);
    writeMeta(db, 'smtp_verified_at', timestamp);
    writeMeta(db, 'smtp_last_error', null);
    result.tested_at = timestamp;
  }

  return result;
}
