const { supabaseAdmin } = require('../../config/supabase');
const { isWithinGeofence } = require('../../utils/geo.utils');
const { calculateSettlement } = require('../../utils/salary.utils');
const logger = require('../../utils/logger');
const crypto = require('crypto');

const GEOFENCE_RADIUS_M = parseInt(process.env.GEOFENCE_CHECKIN_RADIUS_METERS || '50', 10);

/**
 * Validasi QR Code yang dikirim worker saat check-in
 * QR Code adalah HMAC-SHA256 dari: qr_code_secret + tanggal hari ini
 * (sehingga QR berubah setiap hari tapi statis dalam satu hari)
 */
function validateQrCode(qrCodeSecret, submittedQr) {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const expectedQr = crypto
    .createHmac('sha256', qrCodeSecret)
    .update(today)
    .digest('hex')
    .substring(0, 16)
    .toUpperCase();

  return submittedQr?.toUpperCase() === expectedQr;
}

/**
 * Validasi PIN 4 digit supervisor
 */
function validatePin(storedPin, submittedPin) {
  return String(storedPin) === String(submittedPin);
}

/**
 * SERVICE: Check-In Presensi 3 Lapis (Modul B)
 *
 * Validasi wajib:
 * 1. Haversine GPS < 50 meter dari lokasi resto
 * 2. QR Code ATAU PIN supervisor
 * 3. Upload selfie (URL dari Supabase Storage)
 */
async function checkIn({ workerUserId, claimId, lat, lng, pin, qrCode, selfieUrl }) {
  // ─── 1. Ambil data claim & shift ───────────────────────────────────────────
  const { data: claim, error: claimError } = await supabaseAdmin
    .from('shift_claims')
    .select(`
      id, status, shift_id,
      worker_profiles!inner(id, user_id),
      shifts!inner(
        id, start_time, end_time, status,
        resto_profiles!inner(id, geo_lat, geo_lng, pin_code, qr_code_secret)
      )
    `)
    .eq('id', claimId)
    .single();

  if (claimError || !claim) {
    const err = new Error('Claim shift tidak ditemukan');
    err.statusCode = 404;
    err.code = 'CLAIM_NOT_FOUND';
    throw err;
  }

  // Pastikan worker yang check-in adalah pemilik claim
  if (claim.worker_profiles.user_id !== workerUserId) {
    const err = new Error('Kamu bukan pemilik claim ini');
    err.statusCode = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }

  if (!['CLAIMED', 'CONFIRMED'].includes(claim.status)) {
    const err = new Error(
      `Check-in tidak bisa dilakukan. Status claim saat ini: ${claim.status}`
    );
    err.statusCode = 400;
    err.code = 'INVALID_CLAIM_STATUS';
    throw err;
  }

  const shift = claim.shifts;
  const resto = shift.resto_profiles;

  // Cek shift belum di-cancel
  if (['CANCELLED', 'COMPLETED'].includes(shift.status)) {
    const err = new Error(`Shift sudah ${shift.status.toLowerCase()}`);
    err.statusCode = 400;
    err.code = 'SHIFT_ENDED';
    throw err;
  }

  // Cek waktu check-in (max 30 menit sebelum shift mulai, dan sebelum shift selesai)
  const now = new Date();
  const shiftStart = new Date(shift.start_time);
  const shiftEnd = new Date(shift.end_time);
  const thirtyMinBefore = new Date(shiftStart.getTime() - 30 * 60 * 1000);

  if (now < thirtyMinBefore) {
    const minsLeft = Math.ceil((thirtyMinBefore - now) / 60000);
    const err = new Error(`Terlalu awal untuk check-in. Coba lagi dalam ${minsLeft} menit.`);
    err.statusCode = 400;
    err.code = 'TOO_EARLY_CHECKIN';
    throw err;
  }

  if (now > shiftEnd) {
    const err = new Error('Waktu shift sudah habis, check-in tidak dapat dilakukan');
    err.statusCode = 400;
    err.code = 'SHIFT_ALREADY_ENDED';
    throw err;
  }

  // ─── 2. LAYER 1: Validasi GPS Haversine ────────────────────────────────────
  const geoCheck = isWithinGeofence(
    { lat, lng },
    { lat: resto.geo_lat, lng: resto.geo_lng },
    GEOFENCE_RADIUS_M
  );

  if (!geoCheck.isValid) {
    const err = new Error(
      `Lokasi kamu terlalu jauh dari resto. Jarak: ${geoCheck.distanceMeters}m, ` +
      `Batas: ${GEOFENCE_RADIUS_M}m. Pastikan GPS aktif dan kamu sudah berada di lokasi.`
    );
    err.statusCode = 400;
    err.code = 'GEOFENCE_VIOLATION';
    err.distanceMeters = geoCheck.distanceMeters;
    throw err;
  }

  logger.info('[Attendance] Layer 1 GPS OK', {
    claimId,
    distanceMeters: geoCheck.distanceMeters,
  });

  // ─── 3. LAYER 2: Validasi QR Code atau PIN ─────────────────────────────────
  let validationMethod;
  let isAuthValid = false;

  if (qrCode) {
    isAuthValid = validateQrCode(resto.qr_code_secret, qrCode);
    validationMethod = 'GPS_QR';
  } else if (pin) {
    isAuthValid = validatePin(resto.pin_code, pin);
    validationMethod = 'GPS_PIN';
  }

  if (!isAuthValid) {
    const err = new Error(
      qrCode
        ? 'QR Code tidak valid atau sudah kedaluwarsa. Minta supervisor untuk memperbarui QR.'
        : 'PIN supervisor salah. Pastikan kamu memasukkan PIN 4 digit yang benar.'
    );
    err.statusCode = 400;
    err.code = qrCode ? 'INVALID_QR_CODE' : 'INVALID_PIN';
    throw err;
  }

  logger.info('[Attendance] Layer 2 Auth OK', { claimId, validationMethod });

  // ─── 4. LAYER 3: Validasi Selfie ───────────────────────────────────────────
  if (!selfieUrl) {
    const err = new Error('Foto selfie wajib diunggah untuk check-in');
    err.statusCode = 400;
    err.code = 'SELFIE_REQUIRED';
    throw err;
  }

  // Validasi URL selfie dari Supabase Storage (pastikan dari domain yang benar)
  const supabaseStorageDomain = process.env.SUPABASE_URL?.replace('https://', '');
  if (supabaseStorageDomain && !selfieUrl.includes(supabaseStorageDomain)) {
    const err = new Error('URL selfie tidak valid. Upload selfie melalui aplikasi.');
    err.statusCode = 400;
    err.code = 'INVALID_SELFIE_URL';
    throw err;
  }

  logger.info('[Attendance] Layer 3 Selfie OK', { claimId });

  // ─── 5. Simpan attendance log & update claim status ────────────────────────
  const { error: logError } = await supabaseAdmin
    .from('attendance_logs')
    .insert({
      shift_claim_id: claimId,
      check_in_time: now.toISOString(),
      check_in_lat: lat,
      check_in_lng: lng,
      selfie_url: selfieUrl,
      validation_method: validationMethod,
    });

  if (logError) {
    logger.error('[Attendance] Gagal simpan log check-in', { error: logError });
    const err = new Error('Gagal menyimpan data presensi');
    err.statusCode = 500;
    err.code = 'ATTENDANCE_SAVE_FAILED';
    throw err;
  }

  // Update status claim
  await supabaseAdmin
    .from('shift_claims')
    .update({ status: 'CHECKED_IN' })
    .eq('id', claimId);

  // Update status shift menjadi IN_PROGRESS jika belum
  await supabaseAdmin
    .from('shifts')
    .update({ status: 'IN_PROGRESS' })
    .eq('id', claim.shift_id)
    .eq('status', 'FILLED'); // Hanya update jika statusnya FILLED

  logger.info('[Attendance] Check-in berhasil', {
    claimId,
    workerId: claim.worker_profiles.id,
    distanceMeters: geoCheck.distanceMeters,
    validationMethod,
  });

  return {
    claimId,
    checkInTime: now.toISOString(),
    distanceMeters: geoCheck.distanceMeters,
    validationMethod,
    message: '✅ Check-in berhasil! Selamat bekerja.',
  };
}

/**
 * SERVICE: Check-Out & Settlement Gaji Otomatis (Modul C)
 *
 * Validasi: PIN atau QR supervisor
 * Settlement: Hitung durasi → potong deposit resto → kredit wallet worker
 */
async function checkOut({ workerUserId, claimId, lat, lng, pin, qrCode }) {
  // ─── 1. Ambil data attendance log & shift ──────────────────────────────────
  const { data: attendanceLog, error: logError } = await supabaseAdmin
    .from('attendance_logs')
    .select(`
      id, check_in_time, check_out_time,
      shift_claims!inner(
        id, status,
        worker_profiles!inner(id, user_id),
        shifts!inner(
          id, hourly_rate,
          resto_profiles!inner(id, geo_lat, geo_lng, pin_code, qr_code_secret, deposit_balance)
        )
      )
    `)
    .eq('shift_claim_id', claimId)
    .single();

  if (logError || !attendanceLog) {
    const err = new Error('Data presensi tidak ditemukan. Pastikan kamu sudah check-in terlebih dahulu.');
    err.statusCode = 404;
    err.code = 'ATTENDANCE_LOG_NOT_FOUND';
    throw err;
  }

  const claim = attendanceLog.shift_claims;
  const shift = claim.shifts;
  const resto = shift.resto_profiles;

  // Pastikan worker adalah pemilik claim
  if (claim.worker_profiles.user_id !== workerUserId) {
    const err = new Error('Kamu bukan pemilik claim ini');
    err.statusCode = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }

  if (claim.status !== 'CHECKED_IN') {
    const err = new Error(`Check-out tidak bisa dilakukan. Status saat ini: ${claim.status}`);
    err.statusCode = 400;
    err.code = 'NOT_CHECKED_IN';
    throw err;
  }

  if (attendanceLog.check_out_time) {
    const err = new Error('Kamu sudah check-out sebelumnya');
    err.statusCode = 409;
    err.code = 'ALREADY_CHECKED_OUT';
    throw err;
  }

  // ─── 2. Validasi QR atau PIN Supervisor ────────────────────────────────────
  let isAuthValid = false;
  let validationMethod;

  if (qrCode) {
    isAuthValid = validateQrCode(resto.qr_code_secret, qrCode);
    validationMethod = 'GPS_QR';
  } else if (pin) {
    isAuthValid = validatePin(resto.pin_code, pin);
    validationMethod = 'GPS_PIN';
  }

  if (!isAuthValid) {
    const err = new Error(qrCode ? 'QR Code tidak valid' : 'PIN supervisor salah');
    err.statusCode = 400;
    err.code = qrCode ? 'INVALID_QR_CODE' : 'INVALID_PIN';
    throw err;
  }

  const checkOutTime = new Date();

  // ─── 3. Hitung Settlement Gaji ─────────────────────────────────────────────
  const settlement = calculateSettlement({
    checkInTime: attendanceLog.check_in_time,
    checkOutTime,
    hourlyRate: shift.hourly_rate,
  });

  logger.info('[Attendance] Settlement dihitung', {
    claimId,
    ...settlement,
  });

  // ─── 4. Proses settlement via PostgreSQL function (atomic) ─────────────────
  const { data: settlementResult, error: settlementError } = await supabaseAdmin.rpc(
    'process_salary_settlement',
    {
      p_claim_id: claimId,
      p_gross_salary: settlement.grossSalary,
      p_service_fee: settlement.serviceFee,
      p_work_duration_min: settlement.roundedMinutes,
      p_validation_method: validationMethod,
    }
  );

  if (settlementError) {
    logger.error('[Attendance] Settlement gagal', { error: settlementError, claimId });
    const err = new Error(
      settlementError.message.includes('INSUFFICIENT_BALANCE')
        ? 'Saldo deposit resto tidak cukup untuk membayar gaji. Hubungi supervisor.'
        : 'Gagal memproses pembayaran gaji'
    );
    err.statusCode = settlementError.message.includes('INSUFFICIENT_BALANCE') ? 402 : 500;
    err.code = settlementError.message.includes('INSUFFICIENT_BALANCE')
      ? 'INSUFFICIENT_BALANCE'
      : 'SETTLEMENT_FAILED';
    throw err;
  }

  // Update check_out_time di attendance_logs
  await supabaseAdmin
    .from('attendance_logs')
    .update({ check_out_time: checkOutTime.toISOString(), check_out_lat: lat, check_out_lng: lng })
    .eq('shift_claim_id', claimId);

  logger.info('[Attendance] Check-out & settlement berhasil', {
    claimId,
    grossSalary: settlement.grossSalary,
    workHours: settlement.workHours,
  });

  return {
    claimId,
    checkOutTime: checkOutTime.toISOString(),
    settlement: {
      workDuration: `${settlement.workHours} jam (${settlement.roundedMinutes} menit)`,
      hourlyRate: `Rp ${settlement.hourlyRate.toLocaleString('id-ID')}/jam`,
      grossSalary: settlement.grossSalary,
      serviceFee: settlement.serviceFee,
      netSalaryToWorker: settlement.netSalaryToWorker,
      message: `✅ Gaji Rp ${settlement.netSalaryToWorker.toLocaleString('id-ID')} sudah masuk ke dompetmu!`,
    },
  };
}

module.exports = { checkIn, checkOut };
