require('dotenv').config();
const app = require('./app');
const { startAllJobs, stopAllJobs } = require('./jobs');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 3000;

// ─── Start Server ────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  logger.info(`
╔═══════════════════════════════════════════════════════╗
║   🍽️  FnB Staffing Yogyakarta — Backend API           ║
║   Berjalan di: http://localhost:${PORT}                  ║
║   Environment: ${process.env.NODE_ENV || 'development'}                      ║
╚═══════════════════════════════════════════════════════╝
  `);

  // Start background jobs
  startAllJobs();
});

// ─── Graceful Shutdown ───────────────────────────────────────────────────────
function gracefulShutdown(signal) {
  logger.info(`[Server] ${signal} diterima. Memulai graceful shutdown...`);

  stopAllJobs();

  server.close(() => {
    logger.info('[Server] Server berhasil dimatikan');
    process.exit(0);
  });

  // Force close setelah 10 detik
  setTimeout(() => {
    logger.error('[Server] Force shutdown setelah timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('[Server] Uncaught Exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('[Server] Unhandled Rejection', { reason });
});

module.exports = server;
