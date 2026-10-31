const API_BASE = '/api';

export class ApiError extends Error {
  constructor(message, status = 0, code = 'error') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export async function api(path, options = {}) {
  const { method = 'GET', body, signal, headers = {} } = options;
  const init = {
    method,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...headers },
    signal,
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, init);
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
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
    throw new ApiError(message, response.status, data?.code || 'error');
  }
  return data;
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

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
