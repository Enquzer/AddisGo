/* Typed API errors. Response shape is identical to the documented contract: { error, code }. */

export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }

  static bad(message) {
    return new AppError(400, 'bad_request', message);
  }

  static unauthorized(message = 'Please sign in to continue.') {
    return new AppError(401, 'unauthenticated', message);
  }

  static forbidden(message) {
    return new AppError(403, 'forbidden', message);
  }

  static notFound(message = 'Not found.') {
    return new AppError(404, 'not_found', message);
  }

  static conflict(message) {
    return new AppError(409, 'conflict', message);
  }

  static tooMany(message) {
    return new AppError(429, 'rate_limited', message);
  }

  static internal(detail) {
    if (detail) console.error('[addisgo] internal error:', detail);
    return new AppError(500, 'server_error', 'Something went wrong on our side. Please try again.');
  }
}

export function toAppError(error) {
  if (error instanceof AppError) return error;
  if (error && error.code === 'ERR_SQLITE_ERROR') return AppError.internal(error.message);
  if (error && typeof error.message === 'string' && error.message.includes('UNIQUE constraint failed')) {
    return AppError.conflict('That record already exists.');
  }
  return AppError.internal(error && (error.stack || error.message || String(error)));
}

export function statusFor(error) {
  return error instanceof AppError ? error.status : 500;
}
