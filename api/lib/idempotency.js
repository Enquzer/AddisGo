/*
 * Request de-duplication for retryable writes.
 *
 * A client that retries a POST after a network timeout must not create two
 * rides, join a tour twice, or file two reports. The client sends an
 * `Idempotency-Key` header; the first request is stored with its response and
 * every replay returns that exact response instead of running the handler.
 *
 * Storage is the local SQLite database (single-node app): one row per
 * (user, scope, key), 24-hour TTL, response capped at 64 KB.
 */

import crypto from 'node:crypto';

import { AppError } from './errors.js';
import { isoFrom, nowIso } from './util.js';

export const REQUEST_KEY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_KEY_LENGTH = 120;
const MIN_KEY_LENGTH = 8;
const MAX_RESPONSE_BYTES = 64 * 1024;

/** Read and validate the header. Returns null when the client sent none. */
export function idempotencyKey(req) {
  const raw = req.headers['idempotency-key'] ?? req.headers['x-idempotency-key'];
  if (raw === undefined) return null;
  const key = String(raw).trim();
  if (!/^[A-Za-z0-9._:-]+$/.test(key) || key.length < MIN_KEY_LENGTH || key.length > MAX_KEY_LENGTH) {
    throw AppError.bad(
      `Idempotency-Key must be ${MIN_KEY_LENGTH}-${MAX_KEY_LENGTH} letters, digits or . _ : - characters.`,
    );
  }
  return key;
}

export function bodyHash(body) {
  return crypto.createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');
}

/**
 * Claim a key before running the handler.
 *   { kind: 'new', id }            → run the handler, then complete()
 *   { kind: 'replay', status, data } → return the stored response
 *   { kind: 'pending' }            → the same key is still being processed
 */
export function beginIdempotent(db, { userId, scope, key, body }) {
  try {
    db.run('DELETE FROM request_keys WHERE created_at < ?', [isoFrom(Date.now() - REQUEST_KEY_TTL_MS)]);
  } catch {
    /* cleanup is best-effort */
  }

  const hash = bodyHash(body);
  const existing = db.get(
    'SELECT id, body_hash, status, response FROM request_keys WHERE user_id = ? AND scope = ? AND key = ?',
    [userId, scope, key],
  );

  if (existing) {
    if (existing.body_hash !== hash) {
      throw new AppError(
        422,
        'idempotency_mismatch',
        'This Idempotency-Key was already used with a different request body.',
      );
    }
    if (Number(existing.status) === 0) return { kind: 'pending' };
    let data = null;
    try {
      data = JSON.parse(existing.response);
    } catch {
      data = null;
    }
    return { kind: 'replay', status: Number(existing.status) || 200, data };
  }

  const created = db.run(
    `INSERT INTO request_keys (user_id, scope, key, body_hash, status, response, created_at)
     VALUES (?, ?, ?, ?, 0, '', ?)`,
    [userId, scope, key, hash, nowIso()],
  );
  return { kind: 'new', id: created.lastInsertRowid };
}

/** Store the successful response so a replay can return it verbatim. */
export function completeIdempotent(db, id, status, data) {
  let response;
  try {
    response = JSON.stringify(data ?? null);
  } catch {
    abortIdempotent(db, id);
    return;
  }
  if (!response || Buffer.byteLength(response) > MAX_RESPONSE_BYTES) {
    abortIdempotent(db, id);
    return;
  }
  try {
    db.run('UPDATE request_keys SET status = ?, response = ? WHERE id = ?', [Number(status) || 200, response, id]);
  } catch {
    abortIdempotent(db, id);
  }
}

/** Failed requests release the key so the client may safely retry. */
export function abortIdempotent(db, id) {
  try {
    db.run('DELETE FROM request_keys WHERE id = ?', [id]);
  } catch {
    /* ignore */
  }
}
