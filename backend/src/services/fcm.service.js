const { supabaseAdmin } = require('../config/supabase');
const { firebaseApp, messaging, isMockMode } = require('../config/firebase');
const logger = require('../utils/logger');

/**
 * FCM Push Notification Service
 * Mendukung mode MOCK untuk development/presentasi tanpa Firebase credentials
 */

/**
 * Kirim notifikasi ke satu device via FCM token
 * @param {string} fcmToken - FCM device token
 * @param {object} notification - { title, body }
 * @param {object} data - Custom data payload
 * @returns {Promise<object>} Result object
 */
async function sendToDevice(fcmToken, notification, data = {}) {
  if (!fcmToken) {
    logger.warn('[FCM] Token kosong, notifikasi dilewati');
    return { success: false, reason: 'NO_FCM_TOKEN' };
  }

  if (isMockMode) {
    logger.info('[FCM MOCK] Notifikasi dikirim ke device', {
      fcmToken: fcmToken.substring(0, 20) + '...',
      notification,
      data,
    });
    return { success: true, mock: true, messageId: `mock_${Date.now()}` };
  }

  try {
    const message = {
      token: fcmToken,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      android: {
        priority: 'high',
        notification: { sound: 'default', channelId: 'fnb_staffing_main' },
      },
      apns: {
        payload: { aps: { sound: 'default', badge: 1 } },
      },
    };

    const response = await messaging.send(message);
    logger.info('[FCM] Notifikasi terkirim', { messageId: response });
    return { success: true, messageId: response };
  } catch (error) {
    logger.error('[FCM] Gagal kirim notifikasi', { error: error.message, fcmToken });
    return { success: false, error: error.message };
  }
}

/**
 * Kirim notifikasi ke banyak device sekaligus (batch)
 * @param {string[]} fcmTokens - Array FCM tokens
 * @param {object} notification - { title, body }
 * @param {object} data - Custom data payload
 * @returns {Promise<object>} Batch result summary
 */
async function sendToMultipleDevices(fcmTokens, notification, data = {}) {
  if (!fcmTokens?.length) {
    return { successCount: 0, failureCount: 0, results: [] };
  }

  if (isMockMode) {
    logger.info('[FCM MOCK] Batch notifikasi dikirim', {
      recipientCount: fcmTokens.length,
      notification,
    });
    return {
      successCount: fcmTokens.length,
      failureCount: 0,
      mock: true,
      results: fcmTokens.map((t, i) => ({ success: true, messageId: `mock_batch_${i}` })),
    };
  }

  const results = await Promise.allSettled(
    fcmTokens.map((token) => sendToDevice(token, notification, data))
  );

  const successCount = results.filter((r) => r.status === 'fulfilled' && r.value.success).length;
  const failureCount = results.length - successCount;

  logger.info('[FCM] Batch selesai', { successCount, failureCount, total: fcmTokens.length });

  return {
    successCount,
    failureCount,
    results: results.map((r) => (r.status === 'fulfilled' ? r.value : { success: false })),
  };
}

/**
 * Simpan notifikasi ke database untuk audit trail + in-app notification
 * @param {string} userId
 * @param {string} title
 * @param {string} body
 * @param {object} data
 */
async function saveNotificationLog(userId, title, body, data = {}) {
  try {
    await supabaseAdmin.from('notifications').insert({
      user_id: userId,
      title,
      body,
      data,
      sent_at: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('[FCM] Gagal simpan log notifikasi', { error: error.message });
  }
}

/**
 * Send shift alert notification ke worker terpilih
 * Fitur: Early Access untuk Platinum (15 menit) dan Gold (10 menit)
 * @param {Array} workers - Array worker objects dengan fcm_token dan tier
 * @param {object} shift - Shift object
 * @param {number} earlyAccessDelayMinutes - Delay (0 untuk normal, >0 untuk early)
 */
async function sendShiftAlert(workers, shift, earlyAccessDelayMinutes = 0) {
  const notification = {
    title: '🍽️ Ada Shift Baru Untukmu!',
    body: `${shift.title} di ${shift.resto_name} — Rp ${shift.hourly_rate.toLocaleString('id-ID')}/jam`,
  };

  const data = {
    type: 'NEW_SHIFT',
    shift_id: shift.id,
    shift_title: shift.title,
    hourly_rate: String(shift.hourly_rate),
    start_time: shift.start_time,
  };

  const tokens = workers.map((w) => w.fcm_token).filter(Boolean);

  if (earlyAccessDelayMinutes > 0) {
    // Delay pengiriman untuk worker tier lebih rendah
    setTimeout(async () => {
      await sendToMultipleDevices(tokens, notification, data);
      for (const worker of workers) {
        await saveNotificationLog(worker.user_id, notification.title, notification.body, data);
      }
    }, earlyAccessDelayMinutes * 60 * 1000);

    logger.info(`[FCM] Shift alert dijadwalkan untuk ${fcmTokens.length} worker dalam ${earlyAccessDelayMinutes} menit`);
  } else {
    await sendToMultipleDevices(tokens, notification, data);
    for (const worker of workers) {
      await saveNotificationLog(worker.user_id, notification.title, notification.body, data);
    }
  }
}

/**
 * Kirim reminder konfirmasi H-2 jam sebelum shift
 */
async function sendShiftReminder(worker, shift) {
  const notification = {
    title: '⏰ Konfirmasi Kehadiranmu!',
    body: `Shift "${shift.title}" dimulai dalam 2 jam. Tekan CONFIRM untuk tetap terdaftar.`,
  };

  const data = {
    type: 'SHIFT_REMINDER',
    shift_id: shift.id,
    claim_id: shift.claim_id,
    action_required: 'CONFIRM',
  };

  const result = await sendToDevice(worker.fcm_token, notification, data);
  await saveNotificationLog(worker.user_id, notification.title, notification.body, data);

  return result;
}

module.exports = {
  sendToDevice,
  sendToMultipleDevices,
  saveNotificationLog,
  sendShiftAlert,
  sendShiftReminder,
};
