import { AppError } from '../lib/errors.js';
import { cleanName, cleanPassword, currentUser, requireUser } from '../lib/context.js';
import { audit, getSelfUser } from '../lib/db.js';
import { sendWelcomeEmail } from '../lib/email.js';
import {
  createToken,
  hashPassword,
  sessionCookie,
  clearCookie,
  verifyPassword,
} from '../lib/security.js';
import { avatarColorFor, charLen, joinLanguages, splitLanguages, validColor, validEmail, validPhone } from '../lib/util.js';

const CLASSES = ['e2', 'comfort', 'van'];
const LIMIT_WINDOW = 10 * 60 * 1000;

function cleanVehicle(vehicle) {
  if (!vehicle || typeof vehicle !== 'object') throw AppError.bad('Driver applications need vehicle details.');
  const vehicleClass = String(vehicle.vehicle_class ?? '').trim().toLowerCase();
  if (!CLASSES.includes(vehicleClass)) throw AppError.bad('Please choose a valid vehicle class.');
  const makeModel = String(vehicle.make_model ?? '').trim();
  if (charLen(makeModel) < 2 || charLen(makeModel) > 60) {
    throw AppError.bad('Vehicle make and model must be 2–60 characters.');
  }
  const plate = String(vehicle.plate ?? '').trim().toUpperCase();
  if (charLen(plate) < 2 || charLen(plate) > 20) throw AppError.bad('Please enter a valid plate number.');
  const color = Array.from(String(vehicle.color ?? '').trim()).slice(0, 30).join('');
  const license = String(vehicle.license_no ?? '').trim().toUpperCase();
  if (charLen(license) < 3 || charLen(license) > 30) {
    throw AppError.bad('Please enter a valid driving licence number.');
  }
  return { vehicleClass, makeModel, plate, color, license };
}

function issueSession(ctx, userId, role) {
  const token = createToken(userId, role, ctx.secret);
  ctx.setCookies.push(sessionCookie(token));
}

export async function register(ctx) {
  const body = ctx.body;
  const name = cleanName(body.name);
  const email = String(body.email ?? '').trim().toLowerCase();
  if (!validEmail(email)) throw AppError.bad('Please enter a valid email address.');
  const phone = String(body.phone ?? '').trim();
  if (!validPhone(phone)) throw AppError.bad('Please enter a valid phone number.');
  const password = cleanPassword(body.password);

  const role = String(body.role ?? 'customer').trim().toLowerCase() || 'customer';
  if (role !== 'customer' && role !== 'driver') throw AppError.bad('Please choose rider or driver.');
  const vehicle = role === 'driver' ? cleanVehicle(body.vehicle) : null;

  const passwordHash = hashPassword(password);
  const existing = ctx.db.get('SELECT COUNT(*) AS n FROM users WHERE email = ?', [email]);
  if (Number(existing.n) > 0) {
    throw AppError.conflict('An account with this email already exists. Try signing in.');
  }

  let userId;
  try {
    userId = ctx.db.tx(() => {
      const created = ctx.db.run(
        `INSERT INTO users (name, email, phone, password_hash, role, bio, languages, avatar_color, is_verified, status, created_at)
         VALUES (?, ?, ?, ?, ?, '', 'English, Amharic', ?, 0, 'active', ?)`,
        [name, email, phone, passwordHash, role, avatarColorFor(name), new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')],
      );
      if (vehicle) {
        ctx.db.run(
          `INSERT INTO drivers (user_id, vehicle_class, make_model, plate, color, license_no, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
          [
            created.lastInsertRowid,
            vehicle.vehicleClass,
            vehicle.makeModel,
            vehicle.plate,
            vehicle.color,
            vehicle.license,
            new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
          ],
        );
      }
      return created.lastInsertRowid;
    });
  } catch (error) {
    if (String(error.message || '').includes('UNIQUE')) {
      throw AppError.conflict('An account with this email already exists. Try signing in.');
    }
    throw error;
  }

  const user = getSelfUser(ctx.db, userId);
  issueSession(ctx, user.id, user.role);

  // Send branded welcome email in background
  sendWelcomeEmail(ctx.db, user).catch(() => {});

  return user;
}

export async function login(ctx) {
  const email = String(ctx.body.email ?? '').trim().toLowerCase();
  const password = String(ctx.body.password ?? '');
  if (!email || !password) throw AppError.bad('Enter your email and password.');

  const key = `login:${email}`;
  if (!ctx.limiter.allow(key, 20, LIMIT_WINDOW)) {
    throw AppError.tooMany('Too many sign-in attempts. Please wait 10 minutes and try again.');
  }

  const found = ctx.db.get('SELECT id, password_hash, role, status FROM users WHERE email = ?', [email]);
  if (!found || !verifyPassword(found.password_hash, password)) {
    throw new AppError(401, 'invalid_credentials', 'Invalid email or password.');
  }
  if (found.status !== 'active') {
    throw AppError.forbidden('This account is suspended. Please contact support.');
  }
  ctx.limiter.clear(key);

  const user = getSelfUser(ctx.db, found.id);
  issueSession(ctx, user.id, user.role);
  return user;
}

export async function logout(ctx) {
  ctx.setCookies.push(clearCookie());
  return { ok: true };
}

export async function me(ctx) {
  const user = currentUser(ctx);
  if (!user) return null;
  return getSelfUser(ctx.db, user.id);
}

export async function updateProfile(ctx) {
  const auth = requireUser(ctx);
  const user = getSelfUser(ctx.db, auth.id);
  const body = ctx.body;

  if (body.name !== undefined) user.name = cleanName(body.name);
  if (body.phone !== undefined) {
    const phone = String(body.phone).trim();
    if (!phone) throw AppError.bad('Phone number cannot be empty.');
    if (!validPhone(phone)) throw AppError.bad('Please enter a valid phone number.');
    user.phone = phone;
  }
  if (body.bio !== undefined) {
    const bio = String(body.bio).trim();
    if (charLen(bio) > 400) throw AppError.bad('Bio must be 400 characters or fewer.');
    user.bio = bio;
  }
  if (body.languages !== undefined) {
    if (!Array.isArray(body.languages)) throw AppError.bad('Choose up to 6 languages.');
    if (body.languages.length > 6) throw AppError.bad('Choose up to 6 languages.');
    user.languages = splitLanguages(joinLanguages(body.languages));
  }
  if (body.avatar_color !== undefined) {
    const color = String(body.avatar_color).trim();
    if (!validColor(color)) throw AppError.bad('Please choose a valid avatar colour.');
    user.avatar_color = color;
  }

  ctx.db.run(
    'UPDATE users SET name = ?, phone = ?, bio = ?, languages = ?, avatar_color = ? WHERE id = ?',
    [user.name, user.phone, user.bio, user.languages.join(', '), user.avatar_color, auth.id],
  );
  return getSelfUser(ctx.db, auth.id);
}

export async function changePassword(ctx) {
  const auth = requireUser(ctx);
  if (!ctx.limiter.allow(`pwd:${auth.id}`, 5, 60 * 60 * 1000)) {
    throw AppError.tooMany('Too many password changes. Please try again later.');
  }
  const newPassword = cleanPassword(ctx.body.new_password);
  const row = ctx.db.get('SELECT password_hash FROM users WHERE id = ?', [auth.id]);
  if (!row || !verifyPassword(row.password_hash, String(ctx.body.current_password ?? ''))) {
    throw new AppError(401, 'invalid_credentials', 'Your current password is incorrect.');
  }
  ctx.db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(newPassword), auth.id]);
  audit(ctx.db, auth.id, 'account.password_changed', 'Password updated by account owner');
  return { ok: true };
}

export { currentUser };
