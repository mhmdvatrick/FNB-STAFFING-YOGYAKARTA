const { supabaseAdmin } = require('../../config/supabase');
const { getBoundingBox } = require('../../utils/geo.utils');
const { filterWorkersInRadius } = require('../../utils/geo.utils');
const fcmService = require('../../services/fcm.service');
const logger = require('../../utils/logger');

const MAX_RADIUS_KM = parseFloat(process.env.MAX_WORKER_SEARCH_RADIUS_KM || '5');
const MIN_RATING = parseFloat(process.env.MIN_WORKER_RATING || '4.5');
const EARLY_ACCESS_PLATINUM = parseInt(process.env.EARLY_ACCESS_MINUTES_PLATINUM || '15', 10);
const EARLY_ACCESS_GOLD = parseInt(process.env.EARLY_ACCESS_MINUTES_GOLD || '10', 10);

/**
 * Service: Buat shift baru dan trigger matching engine
 */
async function createShift(restoUserId, shiftData) {
  // 1. Ambil profil resto
  const { data: resto, error: restoError } = await supabaseAdmin
    .from('resto_profiles')
    .select('id, resto_name, geo_lat, geo_lng, deposit_balance')
    .eq('user_id', restoUserId)
    .single();

  if (restoError || !resto) {
    const err = new Error('Profil resto tidak ditemukan');
    err.statusCode = 404;
    err.code = 'RESTO_NOT_FOUND';
    throw err;
  }

  // 2. Validasi saldo deposit resto cukup (estimasi kasar)
  const shiftDurationHours = (new Date(shiftData.end_time) - new Date(shiftData.start_time)) / 3600000;
  const estimatedCost = shiftDurationHours * (shiftData.hourly_rate + 3000) * shiftData.headcount;

  if (resto.deposit_balance < estimatedCost) {
    const err = new Error(
      `Saldo deposit tidak cukup. Estimasi biaya: Rp ${estimatedCost.toLocaleString('id-ID')}, ` +
      `Saldo saat ini: Rp ${resto.deposit_balance.toLocaleString('id-ID')}`
    );
    err.statusCode = 402;
    err.code = 'INSUFFICIENT_DEPOSIT';
    throw err;
  }

  // 3. Insert shift ke database
  const { data: newShift, error: insertError } = await supabaseAdmin
    .from('shifts')
    .insert({
      resto_id: resto.id,
      title: shiftData.title,
      role_required: shiftData.role_required,
      headcount: shiftData.headcount,
      hourly_rate: shiftData.hourly_rate,
      start_time: shiftData.start_time,
      end_time: shiftData.end_time,
      dress_code: shiftData.dress_code,
      instructions: shiftData.instructions,
      min_rating: shiftData.min_rating ?? MIN_RATING,
      status: 'OPEN',
    })
    .select()
    .single();

  if (insertError) {
    logger.error('[ShiftService] Gagal insert shift', { error: insertError });
    const err = new Error('Gagal membuat shift');
    err.statusCode = 500;
    err.code = 'SHIFT_CREATE_FAILED';
    throw err;
  }

  logger.info('[ShiftService] Shift berhasil dibuat', { shiftId: newShift.id, restoId: resto.id });

  // 4. Trigger matching engine secara async (tidak block response)
  triggerMatchingEngine(newShift, resto).catch((e) =>
    logger.error('[ShiftService] Matching engine error', { error: e.message })
  );

  return { ...newShift, resto_name: resto.resto_name };
}

/**
 * Matching Engine: Cari worker yang cocok dan kirim notifikasi bertingkat
 * - Tier PLATINUM: notif langsung (early access 15 menit)
 * - Tier GOLD: notif setelah 5 menit
 * - Tier SILVER/BRONZE: notif setelah 15 menit
 */
async function triggerMatchingEngine(shift, resto) {
  logger.info('[MatchingEngine] Memulai pencarian worker', { shiftId: shift.id });

  // Bounding box untuk pre-filter database
  const bbox = getBoundingBox(resto.geo_lat, resto.geo_lng, MAX_RADIUS_KM);

  // Query worker dari v_available_workers view (sudah filter is_available + active + lokasi fresh)
  const { data: candidateWorkers, error } = await supabaseAdmin
    .from('v_available_workers')
    .select('*')
    .gte('current_lat', bbox.minLat)
    .lte('current_lat', bbox.maxLat)
    .gte('current_lng', bbox.minLng)
    .lte('current_lng', bbox.maxLng)
    .gte('rating', shift.min_rating)
    .contains('verified_skills', [shift.role_required]);

  if (error) {
    logger.error('[MatchingEngine] Error query workers', { error });
    return;
  }

  if (!candidateWorkers?.length) {
    logger.warn('[MatchingEngine] Tidak ada worker yang cocok', { shiftId: shift.id });
    return;
  }

  // Filter Haversine presisi
  const matchedWorkers = filterWorkersInRadius(
    { lat: resto.geo_lat, lng: resto.geo_lng },
    candidateWorkers,
    MAX_RADIUS_KM
  );

  logger.info('[MatchingEngine] Worker cocok ditemukan', {
    shiftId: shift.id,
    candidateCount: candidateWorkers.length,
    matchedCount: matchedWorkers.length,
  });

  // Segmentasi berdasarkan tier untuk early access
  const platinum = matchedWorkers.filter((w) => w.tier === 'PLATINUM');
  const gold = matchedWorkers.filter((w) => w.tier === 'GOLD');
  const others = matchedWorkers.filter((w) => !['PLATINUM', 'GOLD'].includes(w.tier));

  const shiftPayload = { ...shift, resto_name: resto.resto_name };

  // Platinum: langsung notif
  if (platinum.length > 0) {
    await fcmService.sendShiftAlert(platinum, shiftPayload, 0);
    logger.info(`[MatchingEngine] Notif PLATINUM dikirim ke ${platinum.length} worker`);
  }

  // Gold: delay 5 menit
  if (gold.length > 0) {
    const goldDelay = EARLY_ACCESS_PLATINUM - EARLY_ACCESS_GOLD; // 5 menit
    await fcmService.sendShiftAlert(gold, shiftPayload, goldDelay);
    logger.info(`[MatchingEngine] Notif GOLD dijadwalkan (${goldDelay} menit) ke ${gold.length} worker`);
  }

  // Silver/Bronze: delay 15 menit (setelah Platinum dapat akses penuh)
  if (others.length > 0) {
    await fcmService.sendShiftAlert(others, shiftPayload, EARLY_ACCESS_PLATINUM);
    logger.info(`[MatchingEngine] Notif REGULAR dijadwalkan (${EARLY_ACCESS_PLATINUM} menit) ke ${others.length} worker`);
  }
}

/**
 * Worker klaim shift
 */
async function claimShift(workerUserId, shiftId, isStandby = false) {
  // Ambil profil worker
  const { data: worker, error: workerError } = await supabaseAdmin
    .from('worker_profiles')
    .select('id, tier, rating, is_available')
    .eq('user_id', workerUserId)
    .single();

  if (workerError || !worker) {
    const err = new Error('Profil worker tidak ditemukan');
    err.statusCode = 404;
    err.code = 'WORKER_NOT_FOUND';
    throw err;
  }

  // Ambil data shift
  const { data: shift, error: shiftError } = await supabaseAdmin
    .from('shifts')
    .select('*, resto_profiles(id, geo_lat, geo_lng)')
    .eq('id', shiftId)
    .single();

  if (shiftError || !shift) {
    const err = new Error('Shift tidak ditemukan');
    err.statusCode = 404;
    err.code = 'SHIFT_NOT_FOUND';
    throw err;
  }

  if (shift.status === 'CANCELLED') {
    const err = new Error('Shift ini sudah dibatalkan');
    err.statusCode = 400;
    err.code = 'SHIFT_CANCELLED';
    throw err;
  }

  if (shift.status === 'COMPLETED') {
    const err = new Error('Shift ini sudah selesai');
    err.statusCode = 400;
    err.code = 'SHIFT_COMPLETED';
    throw err;
  }

  // Cek apakah worker memenuhi syarat rating minimum
  if (worker.rating < shift.min_rating && worker.rating > 0) {
    const err = new Error(
      `Rating Anda (${worker.rating}) di bawah minimum yang dibutuhkan shift ini (${shift.min_rating})`
    );
    err.statusCode = 403;
    err.code = 'RATING_TOO_LOW';
    throw err;
  }

  // Cek duplikat claim
  const { data: existingClaim } = await supabaseAdmin
    .from('shift_claims')
    .select('id, status')
    .eq('shift_id', shiftId)
    .eq('worker_id', worker.id)
    .single();

  if (existingClaim) {
    const err = new Error(`Kamu sudah ${existingClaim.status === 'CANCELLED' ? 'pernah membatalkan' : 'klaim'} shift ini`);
    err.statusCode = 409;
    err.code = 'DUPLICATE_CLAIM';
    throw err;
  }

  // Tentukan status claim: CLAIMED (slot kosong) atau STANDBY
  const isShiftFull = shift.filled_count >= shift.headcount;
  const claimStatus = isStandby || isShiftFull ? 'STANDBY' : 'CLAIMED';

  const { data: newClaim, error: claimError } = await supabaseAdmin
    .from('shift_claims')
    .insert({
      shift_id: shiftId,
      worker_id: worker.id,
      status: claimStatus,
    })
    .select()
    .single();

  if (claimError) {
    logger.error('[ShiftService] Gagal insert claim', { error: claimError });
    const err = new Error('Gagal klaim shift');
    err.statusCode = 500;
    err.code = 'CLAIM_FAILED';
    throw err;
  }

  logger.info('[ShiftService] Shift diklaim', {
    claimId: newClaim.id,
    workerId: worker.id,
    shiftId,
    status: claimStatus,
  });

  return newClaim;
}

/**
 * Worker konfirmasi kehadiran (H-2 jam) melalui tombol CONFIRM
 */
async function confirmAttendance(workerUserId, claimId) {
  const { data: claim, error } = await supabaseAdmin
    .from('shift_claims')
    .select('*, worker_profiles!inner(user_id), shifts(start_time)')
    .eq('id', claimId)
    .single();

  if (error || !claim) {
    const err = new Error('Claim tidak ditemukan');
    err.statusCode = 404;
    err.code = 'CLAIM_NOT_FOUND';
    throw err;
  }

  if (claim.worker_profiles.user_id !== workerUserId) {
    const err = new Error('Kamu bukan pemilik claim ini');
    err.statusCode = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }

  if (!['CLAIMED', 'STANDBY'].includes(claim.status)) {
    const err = new Error(`Claim tidak bisa dikonfirmasi. Status saat ini: ${claim.status}`);
    err.statusCode = 400;
    err.code = 'INVALID_CLAIM_STATUS';
    throw err;
  }

  const { data: updated } = await supabaseAdmin
    .from('shift_claims')
    .update({ status: 'CONFIRMED', confirmed_at: new Date().toISOString() })
    .eq('id', claimId)
    .select()
    .single();

  return updated;
}

/**
 * Ambil daftar shift yang tersedia untuk worker (dengan filter)
 */
async function getAvailableShifts(filters = {}) {
  let query = supabaseAdmin
    .from('shifts')
    .select(`
      id, title, role_required, headcount, filled_count, hourly_rate,
      start_time, end_time, status, dress_code, min_rating,
      resto_profiles(resto_name, address, geo_lat, geo_lng)
    `)
    .eq('status', 'OPEN')
    .gt('start_time', new Date().toISOString())
    .order('start_time', { ascending: true });

  if (filters.role) query = query.eq('role_required', filters.role);
  if (filters.minRate) query = query.gte('hourly_rate', filters.minRate);

  const { data, error } = await query.limit(50);

  if (error) {
    logger.error('[ShiftService] Gagal ambil daftar shift', { error });
    throw new Error('Gagal memuat daftar shift');
  }

  return data;
}

/**
 * Ambil detail shift by ID
 */
async function getShiftById(shiftId) {
  const { data, error } = await supabaseAdmin
    .from('shifts')
    .select(`
      *,
      resto_profiles(resto_name, address, geo_lat, geo_lng, pic_name, pic_phone)
    `)
    .eq('id', shiftId)
    .single();

  if (error || !data) {
    const err = new Error('Shift tidak ditemukan');
    err.statusCode = 404;
    err.code = 'SHIFT_NOT_FOUND';
    throw err;
  }

  return data;
}

/**
 * Ambil daftar shift yang dibuat oleh resto
 */
async function getRestoShifts(restoUserId, status) {
  const { data: resto } = await supabaseAdmin
    .from('resto_profiles')
    .select('id')
    .eq('user_id', restoUserId)
    .single();

  if (!resto) {
    const err = new Error('Profil resto tidak ditemukan');
    err.statusCode = 404;
    err.code = 'RESTO_NOT_FOUND';
    throw err;
  }

  let query = supabaseAdmin
    .from('shifts')
    .select(`
      *,
      shift_claims(
        id, status, confirmed_at,
        worker_profiles(full_name, rating, tier, avatar_url)
      )
    `)
    .eq('resto_id', resto.id)
    .order('start_time', { ascending: false });

  if (status) query = query.eq('status', status);

  const { data, error } = await query.limit(100);

  if (error) throw new Error('Gagal memuat shift resto');
  return data;
}

module.exports = {
  createShift,
  claimShift,
  confirmAttendance,
  getAvailableShifts,
  getShiftById,
  getRestoShifts,
  triggerMatchingEngine,
};
