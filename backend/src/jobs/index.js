const shiftReminderJob = require('./shift-reminder.job');
const noShowHandlerJob = require('./no-show-handler.job');
const logger = require('../utils/logger');

/**
 * Inisialisasi dan jalankan semua background jobs
 * Dipanggil saat server start
 */
function startAllJobs() {
  logger.info('[Jobs] Memulai semua background jobs...');

  // Modul D: Shift Reminder — setiap 5 menit
  shiftReminderJob.start();
  logger.info('[Jobs] ✅ ShiftReminderJob aktif (setiap 5 menit)');

  // Modul D: No-Show Handler — setiap 2 menit
  noShowHandlerJob.start();
  logger.info('[Jobs] ✅ NoShowHandlerJob aktif (setiap 2 menit)');
}

/**
 * Hentikan semua jobs (untuk graceful shutdown)
 */
function stopAllJobs() {
  shiftReminderJob.stop();
  noShowHandlerJob.stop();
  logger.info('[Jobs] Semua background jobs dihentikan');
}

module.exports = { startAllJobs, stopAllJobs };
