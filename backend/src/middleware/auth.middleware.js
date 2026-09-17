const { supabaseAdmin } = require('../../config/supabase');
const logger = require('../../utils/logger');

/**
 * Class AppError — Custom error class dengan HTTP status code
 */
class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Auth Middleware — Verifikasi JWT token dari Supabase
 * Token dikirim via header: Authorization: Bearer <token>
 */
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        code: 'UNAUTHORIZED',
        message: 'Token autentikasi diperlukan. Sertakan header: Authorization: Bearer <token>',
      });
    }

    const token = authHeader.split(' ')[1];

    // Verifikasi token dengan Supabase
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_TOKEN',
        message: 'Token tidak valid atau sudah kadaluarsa',
      });
    }

    // Ambil data user dari database kita (bukan hanya dari Supabase Auth)
    const { data: dbUser, error: dbError } = await supabaseAdmin
      .from('users')
      .select('id, email, phone, role, status')
      .eq('id', user.id)
      .single();

    if (dbError || !dbUser) {
      return res.status(401).json({
        success: false,
        code: 'USER_NOT_FOUND',
        message: 'User tidak ditemukan dalam sistem',
      });
    }

    if (dbUser.status === 'SUSPENDED' || dbUser.status === 'BANNED') {
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_SUSPENDED',
        message: `Akun Anda ${dbUser.status.toLowerCase()}. Hubungi support.`,
      });
    }

    // Inject user ke request object
    req.user = dbUser;
    next();
  } catch (error) {
    logger.error('[Auth] Error verifikasi token', { error: error.message });
    next(error);
  }
}

/**
 * Role Guard — Pastikan user memiliki role yang diperlukan
 * @param {...string} allowedRoles - Role yang diizinkan, misal: 'RESTO', 'ADMIN'
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        code: 'UNAUTHORIZED',
        message: 'Autentikasi diperlukan',
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: `Aksi ini hanya untuk ${allowedRoles.join(' atau ')}`,
      });
    }

    next();
  };
}

module.exports = { authenticate, requireRole, AppError };
