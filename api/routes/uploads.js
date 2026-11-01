import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { AppError } from '../lib/errors.js';
import { requireUser } from '../lib/context.js';
import { audit } from '../lib/db.js';

const API_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const UPLOADS_DIR = path.join(path.dirname(API_DIR), 'data', 'uploads');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
};

const AVATAR_MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB to accommodate direct local uploads from admin computer
const MAX_VIDEO_BYTES = 8 * 1024 * 1024;   // 8MB
// Kept under the 2MB JSON body cap once base64-encoded. A 512px avatar is ~60KB.
const MAX_AVATAR_BYTES = 1024 * 1024;
const MIN_AVATAR_EDGE = 16;
const MAX_AVATAR_EDGE = 4096;
const UPLOAD_NAME_RE = /^[a-f0-9]{32}\.(jpg|png|webp|mp4|webm)$/i;

/**
 * Handle authenticated secure media upload with strict packet optimization.
 */
export async function uploadMedia(ctx) {
  const auth = requireUser(ctx);

  if (auth.role !== 'admin' && !ctx.limiter.allow(`upload:${auth.id}`, 30, 3600000)) {
    throw AppError.tooMany('Upload limit reached. You can share up to 30 media items per hour.');
  }

  const rawData = String(ctx.body?.data ?? '').trim();
  if (!rawData) {
    throw AppError.bad('No media data provided.');
  }

  // Parse data URI
  const match = rawData.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw AppError.bad('Invalid media format. Expected data URI.');
  }

  const mime = match[1].toLowerCase();
  const base64Data = match[2];
  const ext = MIME_TO_EXT[mime];

  if (!ext) {
    throw AppError.bad('Unsupported format. Only JPG, PNG, WebP, MP4, and WebM are permitted.');
  }

  const isVideo = mime.startsWith('video/');
  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;

  const buffer = Buffer.from(base64Data, 'base64');
  if (buffer.length === 0) {
    throw AppError.bad('The uploaded file was empty.');
  }

  if (buffer.length > maxBytes) {
    throw AppError.bad(
      isVideo
        ? 'Video exceeds 8MB limit. Please trim to a short 10–15s clip.'
        : 'Image exceeds 2.5MB. AddisGo optimizes images automatically before sending.'
    );
  }

  // Verify magic bytes
  if (mime === 'image/jpeg' && (buffer[0] !== 0xff || buffer[1] !== 0xd8)) {
    throw AppError.bad('Corrupt JPEG file.');
  }
  if (mime === 'image/png' && (buffer[0] !== 0x89 || buffer[1] !== 0x50)) {
    throw AppError.bad('Corrupt PNG file.');
  }

  const filename = `${crypto.randomBytes(16).toString('hex')}${ext}`;
  const filepath = path.join(UPLOADS_DIR, filename);

  await fs.promises.writeFile(filepath, buffer);

  return {
    ok: true,
    url: `/api/uploads/${filename}`,
    filename,
    type: isVideo ? 'video' : 'image',
    size: buffer.length,
  };
}

/**
 * Serve an uploaded media file with streaming and caching headers.
 */
export async function getUpload(ctx) {
  const filename = String(ctx.params?.filename ?? '').trim();
  if (!UPLOAD_NAME_RE.test(filename)) {
    throw AppError.notFound('Media item not found.');
  }

  const filepath = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(filepath)) {
    throw AppError.notFound('Media item not found.');
  }

  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';
  const stat = fs.statSync(filepath);

  return {
    __raw: true,
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
    body: fs.readFileSync(filepath),
  };
}

/* --- Profile pictures ---------------------------------------------------- */

function hasImageMagic(mime, buffer) {
  if (mime === 'image/jpeg') {
    return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mime === 'image/png') {
    return buffer.length > 8 && buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  }
  if (mime === 'image/webp') {
    return buffer.length > 12
      && buffer.toString('ascii', 0, 4) === 'RIFF'
      && buffer.toString('ascii', 8, 12) === 'WEBP';
  }
  return false;
}

function pngSize(buffer) {
  if (buffer.length < 24 || buffer.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegSize(buffer) {
  let i = 2;
  while (i + 3 < buffer.length) {
    if (buffer[i] !== 0xff) { i += 1; continue; }
    let marker = buffer[i + 1];
    while (marker === 0xff) {
      i += 1;
      marker = buffer[i + 1];
    }
    i += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0xda) break; // start of scan before any frame header
    if (i + 1 >= buffer.length) break;
    const length = buffer.readUInt16BE(i);
    if (length < 2) break;
    const isFrameHeader = (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf);
    if (isFrameHeader) {
      if (i + 7 >= buffer.length) return null;
      return { height: buffer.readUInt16BE(i + 3), width: buffer.readUInt16BE(i + 5) };
    }
    i += length;
  }
  return null;
}

function webpSize(buffer) {
  if (buffer.length < 30) return null;
  const fourcc = buffer.toString('ascii', 12, 16);
  if (fourcc === 'VP8X') {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  if (fourcc === 'VP8 ') {
    if (buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) return null;
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  if (fourcc === 'VP8L') {
    if (buffer.length < 25 || buffer[20] !== 0x2f) return null;
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  return null;
}

function imageSize(mime, buffer) {
  if (mime === 'image/png') return pngSize(buffer);
  if (mime === 'image/jpeg') return jpegSize(buffer);
  if (mime === 'image/webp') return webpSize(buffer);
  return null;
}

/** Resolve a stored avatar URL to a file only when it points at our uploads. */
function avatarFileForUrl(url) {
  const match = String(url || '').match(/^\/api\/uploads\/([a-f0-9]{32}\.(?:jpg|png|webp))$/i);
  return match ? path.join(UPLOADS_DIR, match[1]) : null;
}

function deleteAvatarFile(db, url, ownerId) {
  const filepath = avatarFileForUrl(url);
  if (!filepath) return;
  const other = db.get('SELECT COUNT(*) AS n FROM users WHERE avatar_url = ? AND id != ?', [url, ownerId]);
  if (Number(other.n) > 0) return;
  try { fs.unlinkSync(filepath); } catch { /* already gone */ }
}

/**
 * Upload a profile picture. The browser downscales first; the server still
 * enforces type, magic bytes, real dimensions and a hard byte cap so a crafted
 * request cannot store an SVG, a polyglot or an enormous decompression bomb.
 */
export async function uploadAvatar(ctx) {
  const auth = requireUser(ctx);

  if (!ctx.limiter.allow(`avatar:${auth.id}`, 10, 60 * 60 * 1000)) {
    throw AppError.tooMany('Too many photo uploads. Please try again in an hour.');
  }

  const rawData = String(ctx.body?.data ?? '').trim();
  if (!rawData) throw AppError.bad('Choose a photo to upload.');

  const match = rawData.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) throw AppError.bad('Invalid image. Please choose a JPG, PNG or WebP photo.');

  const mime = match[1].toLowerCase();
  const ext = AVATAR_MIME_TO_EXT[mime];
  if (!ext) throw AppError.bad('Profile photos must be JPG, PNG or WebP. SVG files are not accepted.');

  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (buffer.length === 0) throw AppError.bad('That image file was empty.');
  if (buffer.length > MAX_AVATAR_BYTES) {
    throw AppError.bad('Profile photos must be 1 MB or smaller.');
  }
  if (!hasImageMagic(mime, buffer)) throw AppError.bad('That image looks corrupt. Please try another photo.');

  const size = imageSize(mime, buffer);
  if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height)
      || size.width < MIN_AVATAR_EDGE || size.height < MIN_AVATAR_EDGE) {
    throw AppError.bad('That image could not be read. Please try a different photo.');
  }
  if (size.width > MAX_AVATAR_EDGE || size.height > MAX_AVATAR_EDGE) {
    throw AppError.bad('Profile photos must be 4096 pixels or smaller on each side.');
  }

  const filename = `${crypto.randomBytes(16).toString('hex')}${ext}`;
  const filepath = path.join(UPLOADS_DIR, filename);
  await fs.promises.writeFile(filepath, buffer);

  const avatarUrl = `/api/uploads/${filename}`;
  let previous = '';
  try {
    previous = ctx.db.get('SELECT avatar_url FROM users WHERE id = ?', [auth.id])?.avatar_url || '';
    ctx.db.run('UPDATE users SET avatar_url = ? WHERE id = ?', [avatarUrl, auth.id]);
  } catch (error) {
    try { await fs.promises.unlink(filepath); } catch { /* nothing to clean up */ }
    throw error;
  }

  if (previous && previous !== avatarUrl) deleteAvatarFile(ctx.db, previous, auth.id);
  audit(ctx.db, auth.id, 'account.avatar_updated', 'Profile photo updated');
  return { ok: true, avatar_url: avatarUrl, width: size.width, height: size.height, size: buffer.length };
}

/** Remove the current profile picture and delete the file when unused. */
export async function removeAvatar(ctx) {
  const auth = requireUser(ctx);
  const previous = ctx.db.get('SELECT avatar_url FROM users WHERE id = ?', [auth.id])?.avatar_url || '';
  ctx.db.run("UPDATE users SET avatar_url = '' WHERE id = ?", [auth.id]);
  if (previous) {
    deleteAvatarFile(ctx.db, previous, auth.id);
    audit(ctx.db, auth.id, 'account.avatar_removed', 'Profile photo removed');
  }
  return { ok: true, avatar_url: '' };
}

