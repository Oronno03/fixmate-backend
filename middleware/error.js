/**
 * Wraps async Express handlers so rejected promises reach the error handler.
 *
 * @template {import("express").RequestHandler} T
 * @param {T} handler
 * @returns {import("express").RequestHandler}
 */
export function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
export function notFound(req, res) {
  res.status(404).json({
    message: `Route ${req.method} ${req.originalUrl} was not found.`,
  });
}

/**
 * @param {any} error
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  console.error(error);

  if (Array.isArray(error?.issues)) {
    return res.status(400).json({
      message: "Invalid data.",
      issues: error.issues,
    });
  }

  if (error?.code === 11000) {
    return res.status(409).json({
      message: "A record with that value already exists.",
    });
  }

  if (error?.type?.startsWith?.("Stripe")) {
    return res.status(error.statusCode || 502).json({
      message: error.message || "Stripe request failed.",
    });
  }

  const status = error?.status || error?.statusCode || 500;
  return res.status(status).json({
    message: error?.message || "Internal server error.",
  });
}
