/** An error carrying the HTTP status the client should see. */
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }

  static badRequest(message, details) {
    return new ApiError(400, message, details);
  }

  static notFound(message = 'مورد درخواستی پیدا نشد.') {
    return new ApiError(404, message);
  }

  static conflict(message, details) {
    return new ApiError(409, message, details);
  }
}

/**
 * Express 5 forwards rejected promises to the error handler on its own, but
 * wrapping keeps the intent explicit and works the same if a handler is ever
 * mounted somewhere that does not.
 */
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** Maps PostgreSQL constraint violations onto meaningful HTTP responses. */
function translatePgError(err) {
  switch (err.code) {
    case '23505': // unique_violation
      if (err.constraint === 'dependencies_unique_edge') {
        return ApiError.conflict('این وابستگی از قبل وجود دارد.');
      }
      if (err.constraint === 'users_email_key') {
        return ApiError.conflict('کاربر دیگری با همین ایمیل ثبت شده است.');
      }
      return ApiError.conflict('رکوردی با همین مقادیر از قبل وجود دارد.');

    case '23503': // foreign_key_violation
      return ApiError.badRequest(
        'رکورد ارجاع‌شده وجود ندارد، یا متعلق به پروژهٔ دیگری است.',
        { constraint: err.constraint },
      );

    case '23514': // check_violation
      if (err.constraint?.endsWith('date_order')) {
        return ApiError.badRequest('تاریخ پایان نباید پیش از تاریخ شروع باشد.');
      }
      if (err.constraint === 'modules_milestone_is_single_day') {
        return ApiError.badRequest('نقطهٔ عطف باید در یک روز شروع و پایان یابد.');
      }
      if (err.constraint === 'dependencies_no_self_link') {
        return ApiError.badRequest('یک ماژول نمی‌تواند به خودش وابسته باشد.');
      }
      return ApiError.badRequest('مقدار واردشده با محدودیت‌های پایگاه داده سازگار نیست.', {
        constraint: err.constraint,
      });

    case '22P02': // invalid_text_representation, e.g. a malformed uuid
      return ApiError.badRequest('شناسهٔ نامعتبر.');

    case 'ECONNREFUSED':
    case '57P03': // cannot_connect_now
      return new ApiError(503, 'پایگاه داده در دسترس نیست.');

    default:
      return null;
  }
}

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
export function errorHandler(err, req, res, next) {
  const apiError = err instanceof ApiError ? err : translatePgError(err);

  if (!apiError) {
    console.error('[api] unhandled error:', err);
    res.status(500).json({ error: { message: 'خطای داخلی سرور.' } });
    return;
  }

  if (apiError.status >= 500) {
    console.error('[api]', apiError.message, err);
  }

  res.status(apiError.status).json({
    error: {
      message: apiError.message,
      ...(apiError.details ? { details: apiError.details } : {}),
    },
  });
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { message: `No route for ${req.method} ${req.originalUrl}` } });
}
