const shiftService = require('./shift.service');
const logger = require('../../utils/logger');

/**
 * POST /api/shifts — Resto membuat shift baru
 * @access RESTO only
 */
async function createShift(req, res, next) {
  try {
    const shift = await shiftService.createShift(req.user.id, req.body);

    return res.status(201).json({
      success: true,
      message: 'Shift berhasil dibuat. Kami sedang mencari worker yang cocok.',
      data: shift,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/shifts — Daftar shift terbuka (untuk worker)
 * @access WORKER
 */
async function getAvailableShifts(req, res, next) {
  try {
    const shifts = await shiftService.getAvailableShifts(req.query);

    return res.json({
      success: true,
      count: shifts.length,
      data: shifts,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/shifts/my — Daftar shift milik resto yang login
 * @access RESTO
 */
async function getMyRestoShifts(req, res, next) {
  try {
    const shifts = await shiftService.getRestoShifts(req.user.id, req.query.status);

    return res.json({
      success: true,
      count: shifts.length,
      data: shifts,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/shifts/:id — Detail shift
 * @access Authenticated
 */
async function getShiftById(req, res, next) {
  try {
    const shift = await shiftService.getShiftById(req.params.id);

    return res.json({
      success: true,
      data: shift,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/shifts/claim — Worker klaim shift
 * @access WORKER
 */
async function claimShift(req, res, next) {
  try {
    const claim = await shiftService.claimShift(
      req.user.id,
      req.body.shift_id,
      req.body.is_standby
    );

    const message = claim.status === 'STANDBY'
      ? 'Kamu masuk daftar standby. Kamu akan dinotifikasi jika slot tersedia.'
      : 'Shift berhasil diklaim! Jangan lupa konfirmasi H-2 jam sebelum mulai.';

    return res.status(201).json({
      success: true,
      message,
      data: claim,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/shifts/confirm — Worker tekan tombol CONFIRM (H-2 jam)
 * @access WORKER
 */
async function confirmAttendance(req, res, next) {
  try {
    const claim = await shiftService.confirmAttendance(req.user.id, req.body.claim_id);

    return res.json({
      success: true,
      message: 'Kehadiranmu sudah dikonfirmasi. Sampai ketemu di shift!',
      data: claim,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createShift,
  getAvailableShifts,
  getMyRestoShifts,
  getShiftById,
  claimShift,
  confirmAttendance,
};
