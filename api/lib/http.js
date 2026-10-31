import { AppError } from './errors.js';

const MAX_BODY = 2 * 1024 * 1024;
const NO_STORE = 'no-store, max-age=0';

export function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        done = true;
        req.destroy();
        reject(new AppError(413, 'payload_too_large', 'That request is too large.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!done) {
        done = true;
        resolve(Buffer.concat(chunks));
      }
    });
    req.on('error', (error) => {
      if (done) return;
      done = true;
      reject(AppError.internal(error.message));
    });
  });
}

export async function readJson(req) {
  const raw = await readBody(req);
  if (!raw.length) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw AppError.bad('We could not read that request. Please try again.');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw AppError.bad('We could not read that request. Please try again.');
  }
  return parsed;
}

export function sendJson(res, status, data, extraHeaders = null) {
  const body = Buffer.from(JSON.stringify(data));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': NO_STORE,
    ...extraHeaders,
  });
  res.end(body);
}

export function sendText(res, status, body, headers = {}) {
  const buffer = Buffer.from(body);
  res.writeHead(status, {
    'Content-Length': buffer.length,
    'Cache-Control': NO_STORE,
    ...headers,
  });
  res.end(buffer);
}

export function sendEmpty(res, status, headers = {}) {
  res.writeHead(status, headers);
  res.end();
}

export function isJsonRequest(req) {
  const type = String(req.headers['content-type'] || '').toLowerCase();
  return type.startsWith('application/json');
}
