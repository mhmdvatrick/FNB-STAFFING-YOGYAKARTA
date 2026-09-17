const cron = require('node-cron');
const { supabaseAdmin } = require('../../config/supabase');
const fcmService = require('../../services/fcm.service');
const logger = require('../../utils/logger');

const NO_SHOW_GRACE_MINUTES = parseInt(process.env.NO_SHOW_GRACE_PERIOD_MINUTES || '20', 10);
const STANDBY_COMPENSATION = 5000; // Rp 5.000

/**
 * MODUL D — Part 2: No-Show Handler & Standby Activation Job
 *
 * Cron: Setiap 2 menit
 * Tugas:
 * 1. Deteksi worker yang tidak CONFIRM dalam 20 menit setelah reminder dikirim
 * 2. Tandai sebagai NO_SHOW, cari worker STANDBY sebagai pengganti
 * 3. Berikan kompensasi standby ke worker yang diaktifkan
 */
const noShowHandlerJob = cron.schedule('*/2 * * * *', async () => {
  logger.info('[NoShowHandler] Menjalankan job...');

  try {
    const gracePeriodCutoff = new Date(Date.now() - NO_SHOW_GRACE_MINUTES * 60 * 1000);

    // ─── 1. Cari worker yang No-Show ──────────────────────────────────────────
    // Worker yang:
    // - Sudah dapat reminder (reminder_sent_at tidak null)
    // - Masih CLAIMED (belum CONFIRM)
    // - Grace period 20 menit sudah habis
    const { data: noShowClaims, error: noShowError } = await supabaseAdmin
      .from('shift_claims')
      .select(`
        id, shift_id, worker_id,
        worker_profiles!inner(user_id, full_name),
        shifts!inner(id, title, start_time,
          resto_profiles!inner(resto_name)
        )
      `)
      .eq('status', 'CLAIMED')
      .not('reminder_sent_at', 'is', null)
      .lte('reminder_sent_at', gracePeriodCutoff.toISOString());

    if (noShowError) {
      logger.error('[NoShowHandler] Error query no-show', { error: noShowError });
      return;
    }

    if (!noShowClaims?.length) {
      logger.debug('[NoShowHandler] Tidak ada no-show terdeteksi');
      return;
    }

    logger.warn(`[NoShowHandler] ${noShowClaims.length} worker no-show terdeteksi`);

    for (const claim of noShowClaims) {
      try {
        await processNoShow(claim);
      } catch (err) {
        logger.error('[NoShowHandler] Error proses no-show', {
          claimId: claim.id,
          error: err.message,
        });
      }
    }
  } catch (error) {
    logger.error('[NoShowHandler] Unhandled error', { error: error.message });
  }
}, {
  scheduled: false,
  timezone: 'Asia/Jakarta',
});

/**
 * Proses satu no-show worker dan aktifkan worker standby
 */
async function processNoShow(claim) {
  const { id: claimId, shift_id: shiftId, worker_id: workerId } = claim;

  logger.info('[NoShowHandler] Memproses no-show', {
    claimId,
    workerName: claim.worker_profiles.full_name,
    shiftTitle: claim.shifts.title,
  });

  // 1. Tandai claim sebagai NO_SHOW
  await supabaseAdmin
    .from('shift_claims')
    .update({ status: 'NO_SHOW' })
    .eq('id', claimId);

  // 2. Kurangi reliability score worker (-10 poin per no-show)
  await supabaseAdmin.rpc('update_reliability_score', {
    p_worker_id: workerId,
    p_delta: -10,
  }).catch(() => {
    // RPC mungkin belum ada, update manual
    return supabaseAdmin
      .from('worker_profiles')
      .update({
        reliability_score: supabaseAdmin.raw('GREATEST(0, reliability_score - 10)'),
      })
      .eq('id', workerId);
  });

  // 3. Notifikasi ke worker no-show
  const { data: noShowWorkerUser } = await supabaseAdmin
    .from('users')
    .select('fcm_token, id')
    .eq('id', claim.worker_profiles.user_id)
    .single();

  if (noShowWorkerUser?.fcm_token) {
    await fcmService.sendToDevice(
      noShowWorkerUser.fcm_token,
      {
        title: '⚠️ Kamu Dianggap No-Show',
        body: `Shift "${claim.shifts.title}" di ${claim.shifts.resto_profiles.resto_name} dibatalkan karena kamu tidak mengkonfirmasi.`,
      },
      { type: 'NO_SHOW', claim_id: claimId }
    );
  }

  // 4. Cari worker STANDBY untuk shift ini
  const { data: standbyWorker } = await supabaseAdmin
    .from('shift_claims')
    .select(`
      id, worker_id,
      worker_profiles!inner(user_id, full_name, wallet_balance),
      users:worker_profiles!inner(users!inner(id, fcm_token))
    `)
    .eq('shift_id', shiftId)
    .eq('status', 'STANDBY')
    .order('created_at', { ascending: true }) // FIFO — yang paling dulu standby
    .limit(1)
    .single();

  if (!standbyWorker) {
    logger.warn('[NoShowHandler] Tidak ada worker standby tersedia', { shiftId });

    // TODO: Notifikasi ke resto bahwa tidak ada pengganti
    return;
  }

  // 5. Aktifkan worker standby → status CLAIMED
  await supabaseAdmin
    .from('shift_claims')
    .update({ status: 'CLAIMED', reminder_sent_at: null }) // Reset reminder agar dapat reminder ulang
    .eq('id', standbyWorker.id);

  // 6. Berikan kompensasi standby ke wallet worker
  await supabaseAdmin
    .from('worker_profiles')
    .update({
      wallet_balance: supabaseAdmin.raw(`wallet_balance + ${STANDBY_COMPENSATION}`),
    })
    .eq('id', standbyWorker.worker_id);

  // Catat transaksi kompensasi standby
  await supabaseAdmin.from('transactions').insert({
    user_id: standbyWorker.users.id,
    amount: STANDBY_COMPENSATION,
    type: 'STANDBY_COMPENSATION',
    status: 'SUCCESS',
    description: `Kompensasi standby shift ${shiftId}`,
    related_shift_id: shiftId,
    related_claim_id: standbyWorker.id,
  });

  await supabaseAdmin
    .from('shift_claims')
    .update({ standby_comp_paid: true })
    .eq('id', standbyWorker.id);

  // 7. Notifikasi ke worker standby yang diaktifkan
  const standbyFcmToken = standbyWorker.users?.fcm_token;
  if (standbyFcmToken) {
    await fcmService.sendToDevice(
      standbyFcmToken,
      {
        title: '🎉 Kamu Diaktifkan dari Standby!',
        body: `Slot di shift "${claim.shifts.title}" kini untukmu. Kompensasi Rp ${STANDBY_COMPENSATION.toLocaleString('id-ID')} sudah masuk dompet!`,
      },
      {
        type: 'STANDBY_ACTIVATED',
        shift_id: shiftId,
        claim_id: standbyWorker.id,
        compensation: String(STANDBY_COMPENSATION),
      }
    );
  }

  logger.info('[NoShowHandler] Worker standby diaktifkan', {
    standbyClaimId: standbyWorker.id,
    workerName: standbyWorker.worker_profiles.full_name,
    compensation: STANDBY_COMPENSATION,
  });
}

module.exports = noShowHandlerJob;
