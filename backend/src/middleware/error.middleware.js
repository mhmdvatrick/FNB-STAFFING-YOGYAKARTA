const logger = require('../utils/logger');

/**
 * Global Error Handler Middleware
 * Harus didaftarkan TERAKHIR di app.js setelah semua routes
 */
function errorHandler(err, req, res, next) {
  // Log error
  const statusCode = err.statusCode || 500;
  const logData = {
    method: req.method,
    url: req.originalUrl,
    statusCode,
    errorCode: err.code,
    message: err.message,
    userId: req.user?.id,
  };

  if (statusCode >= 500) {
    logger.error('[Error Handler] Server error', { ...logData, stack: err.stack });
  } else {
    logger.warn('[Error Handler] Client error', logData);
  }

  // Jangan bocorkan stack trace di production
  const isDev = process.env.NODE_ENV === 'development';

  return res.status(statusCode).json({
    success: false,
    code: err.code || 'INTERNAL_ERROR',
    message: err.message || 'Terjadi kesalahan pada server',
    ...(isDev && { stack: err.stack }),
  });
}

/**
 * 404 Not Found Handler
 * Didaftarkan sebelum errorHandler, setelah semua routes
 */
function notFoundHandler(req, res) {
  return res.status(404).json({
    success: false,
    code: 'NOT_FOUND',
    message: `Endpoint ${req.method} ${req.originalUrl} tidak ditemukan`,
  });
}

module.exports = { errorHandler, notFoundHandler };
