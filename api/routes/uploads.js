import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { AppError } from '../lib/errors.js';
import { requireUser } from '../lib/context.js';

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

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB to accommodate direct local uploads from admin computer
const MAX_VIDEO_BYTES = 8 * 1024 * 1024;   // 8MB

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
  if (!/^[a-f0-9]{32}\.(jpg|png|webp|mp4|webm)$/i.test(filename)) {
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
