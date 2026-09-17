const cron = require('node-cron');
const { supabaseAdmin } = require('../../config/supabase');
const fcmService = require('../../services/fcm.service');
const logger = require('../../utils/logger');

const REMINDER_HOURS = parseInt(process.env.REMINDER_HOURS_BEFORE_SHIFT || '2', 10);

/**
 * MODUL D — Part 1: Shift Reminder Job
 *
 * Cron: Setiap 5 menit
 * Tugas: Kirim reminder ke worker yang shift-nya dimulai dalam 2 jam
 *        Worker harus menekan tombol CONFIRM di aplikasi
 */
const shiftReminderJob = cron.schedule('*/5 * * * *', async () => {
  logger.info('[ShiftReminderJob] Menjalankan job...');

  try {
    const now = new Date();
    const reminderWindowStart = new Date(now.getTime() + REMINDER_HOURS * 60 * 60 * 1000);
    const reminderWindowEnd = new Date(reminderWindowStart.getTime() + 5 * 60 * 1000); // +5 menit buffer

    // Cari shift_claims yang:
    // - Status CLAIMED (belum CONFIRMED)
    // - Shift mulai dalam REMINDER_HOURS jam
    // - Reminder belum pernah dikirim
    const { data: pendingClaims, error } = await supabaseAdmin
      .from('shift_claims')
      .select(`
        id, status, reminder_sent_at,
        worker_profiles!inner(id, user_id, full_name),
        shifts!inner(id, title, start_time, hourly_rate,
          resto_profiles!inner(resto_name)
        ),
        users:worker_profiles!inner(users!inner(fcm_token, phone))
      `)
      .eq('status', 'CLAIMED')
      .is('reminder_sent_at', null)
      .gte('shifts.start_time', reminderWindowStart.toISOString())
      .lte('shifts.start_time', reminderWindowEnd.toISOString());

    if (error) {
      logger.error('[ShiftReminderJob] Error query claims', { error });
      return;
    }

    if (!pendingClaims?.length) {
      logger.debug('[ShiftReminderJob] Tidak ada reminder yang perlu dikirim saat ini');
      return;
    }

    logger.info(`[ShiftReminderJob] Mengirim ${pendingClaims.length} reminder...`);

    for (const claim of pendingClaims) {
      try {
        const worker = claim.worker_profiles;
        const shift = claim.shifts;
        const fcmToken = claim.users?.fcm_token;

        // Kirim notifikasi FCM
        await fcmService.sendShiftReminder(
          { user_id: worker.user_id, fcm_token: fcmToken },
          { id: shift.id, title: shift.title, claim_id: claim.id }
        );

        // Tandai reminder sudah dikirim
        await supabaseAdmin
          .from('shift_claims')
          .update({ reminder_sent_at: now.toISOString() })
          .eq('id', claim.id);

        logger.info('[ShiftReminderJob] Reminder terkirim', {
          claimId: claim.id,
          workerName: worker.full_name,
          shiftTitle: shift.title,
        });
      } catch (claimError) {
        logger.error('[ShiftReminderJob] Error proses claim', {
          claimId: claim.id,
          error: claimError.message,
        });
      }
    }
  } catch (error) {
    logger.error('[ShiftReminderJob] Unhandled error', { error: error.message });
  }
}, {
  scheduled: false, // Dijalankan manual via start()
  timezone: 'Asia/Jakarta',
});

module.exports = shiftReminderJob;
