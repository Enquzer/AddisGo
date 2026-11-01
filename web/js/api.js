const API_BASE = '/api';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;

export class ApiError extends Error {
  constructor(message, status = 0, code = 'error', retryAfterMs = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Stable key for a retryable write (POST /bookings, tour joins, reports). */
export function newIdempotencyKey() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  return `key-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Equal-jitter exponential backoff, capped so a page never hangs. */
function backoffDelay(attempt, retryAfterMs) {
  if (retryAfterMs) return Math.min(retryAfterMs, 5_000);
  const base = Math.min(4_000, 300 * 2 ** attempt);
  return Math.round(base / 2 + Math.random() * (base / 2));
}

function isRetryable(error) {
  if (!error || error.name === 'AbortError') return false;
  if (error instanceof ApiError) {
    if (error.code === 'network' || error.code === 'timeout') return true;
    return [429, 502, 503, 504].includes(error.status);
  }
  return false;
}

function retryAfterFrom(response) {
  const seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

async function once(path, { method, body, headers, signal, timeout }) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = timeout > 0
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeout)
    : null;
  const forwardAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', forwardAbort, { once: true });
  }

  try {
    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method,
        credentials: 'same-origin',
        headers,
        body,
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut) {
        throw new ApiError('AddisGo took too long to respond. Check your connection and try again.', 0, 'timeout');
      }
      if (signal?.aborted) throw error;
      throw new ApiError('Cannot reach AddisGo. Check your connection and try again.', 0, 'network');
    }

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    if (!response.ok) {
      if (response.status === 401 && data?.code === 'unauthenticated') {
        window.dispatchEvent(new CustomEvent('auth:expired'));
      }
      const message = data?.error || 'Something went wrong. Please try again.';
      throw new ApiError(message, response.status, data?.code || 'error', retryAfterFrom(response));
    }
    return data;
  } finally {
    if (timer) clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', forwardAbort);
  }
}

/**
 * Fetch JSON from the API with a timeout and bounded retries.
 *
 * Reads are retried automatically. Writes are only retried when the caller
 * supplies an idempotency key, because the server must be able to replay the
 * original response instead of doing the work twice.
 */
export async function api(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const timeout = options.timeout === undefined ? DEFAULT_TIMEOUT_MS : Number(options.timeout);
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  const idempotencyKey = options.idempotencyKey || null;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  let body;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const safeMethod = method === 'GET' || method === 'HEAD';
  const retries = options.retries === undefined
    ? (safeMethod || idempotencyKey ? MAX_RETRIES : 0)
    : Math.max(0, Number(options.retries) || 0);

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await once(path, { method, body, headers, signal: options.signal, timeout });
    } catch (error) {
      if (attempt >= retries || !isRetryable(error)) throw error;
      await sleep(backoffDelay(attempt, error.retryAfterMs));
    }
  }
}

export function qrUrl(bookingId) {
  return `${API_BASE}/bookings/${bookingId}/qr`;
}

export function debounce(fn, wait = 300) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
