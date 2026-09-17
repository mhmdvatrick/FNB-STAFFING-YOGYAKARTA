const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { errorHandler, notFoundHandler } = require('./middleware/error.middleware');
const logger = require('./utils/logger');

// Import routes
const shiftRoutes = require('./modules/shifts/shift.routes');
const attendanceRoutes = require('./modules/attendance/attendance.routes');

const app = express();

// ─── Security Middleware ──────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? [process.env.DASHBOARD_URL || 'https://your-dashboard.com']
    : '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting — 100 request per 15 menit per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Terlalu banyak request. Coba lagi dalam 15 menit.',
  },
});
app.use('/api/', limiter);

// ─── Parsing Middleware ───────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Logging ─────────────────────────────────────────────────────────────────
app.use(morgan('combined', {
  stream: { write: (msg) => logger.http(msg.trim()) },
  skip: (req) => req.url === '/health', // Skip health check logs
}));

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    platform: 'FnB Staffing Yogyakarta',
    version: '1.0.0-mvp',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/shifts', shiftRoutes);
app.use('/api/attendance', attendanceRoutes);

// TODO: Tambahkan routes berikut saat dibutuhkan:
// app.use('/api/auth', authRoutes);
// app.use('/api/workers', workerRoutes);
// app.use('/api/restos', restoRoutes);
// app.use('/api/ratings', ratingRoutes);
// app.use('/api/transactions', transactionRoutes);

// ─── Error Handlers ───────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
