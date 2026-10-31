import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import { nowIso } from './util.js';

const API_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LOG_PATH = path.join(path.dirname(API_DIR), 'data', 'emails.log');

/**
 * Retrieve current email configuration from SQLite meta table, falling back to process.env.
 */
export function getEmailConfig(db) {
  const getMeta = (key) => {
    try {
      const row = db.get('SELECT value FROM meta WHERE key = ?', [key]);
      return row ? row.value : null;
    } catch {
      return null;
    }
  };

  const user = getMeta('smtp_user') || process.env.SMTP_USER || '';
  const pass = getMeta('smtp_pass') || process.env.SMTP_PASS || '';
  const host = getMeta('smtp_host') || process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(getMeta('smtp_port') || process.env.SMTP_PORT || 465);
  const from = getMeta('smtp_from') || process.env.SMTP_FROM || (user ? `AddisGo <${user}>` : 'AddisGo <support@addisgo.et>');
  const isConfigured = Boolean(user && pass);

  return {
    host,
    port,
    user,
    pass,
    from,
    is_configured: isConfigured,
    masked_pass: pass ? '••••••••' + pass.slice(-4) : '',
  };
}

/**
 * Persist email configuration into database meta table.
 */
export function saveEmailConfig(db, { user, pass, from, host, port }) {
  const setMeta = (key, val) => {
    if (val !== undefined && val !== null) {
      db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
        key,
        String(val).trim(),
      ]);
    }
  };

  if (user !== undefined) setMeta('smtp_user', user);
  if (pass !== undefined && pass !== '') setMeta('smtp_pass', pass);
  if (from !== undefined) setMeta('smtp_from', from);
  if (host !== undefined) setMeta('smtp_host', host || 'smtp.gmail.com');
  if (port !== undefined) setMeta('smtp_port', String(port || 465));

  return getEmailConfig(db);
}

/**
 * Dispatch an email via Google/SMTP or log locally if not configured.
 */
export async function sendMail(db, { to, subject, html, text, template = 'generic' }) {
  const config = getEmailConfig(db);
  const timestamp = nowIso();

  if (config.is_configured) {
    try {
      const transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.port === 465,
        auth: {
          user: config.user,
          pass: config.pass.replace(/\s+/g, ''), // Clean spaces from Google app password
        },
        tls: {
          rejectUnauthorized: false,
        },
      });

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

      console.log(`[Email] Dispatched via ${config.host} to <${to}>: "${subject}"`);
      return { ok: true, method: 'smtp', recipient: to };
    } catch (err) {
      console.error(`[Email Error] Failed to send via SMTP to <${to}>:`, err.message);
      try {
        db.run(
          'INSERT INTO email_outbox (recipient, subject, template, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [to, subject, template, 'failed', err.message, timestamp],
        );
      } catch {
        /* ignore */
      }
      return { ok: false, error: err.message, method: 'smtp' };
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
    return { ok: true, method: 'logged_offline', recipient: to };
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

  return sendMail(db, {
    to,
    subject: `AddisGo Google Mail Test [Success] ✅`,
    html: emailLayout({ title, previewText, contentHtml }),
    template: 'admin_test',
  });
}
