const attendanceService = require('./attendance.service');
const logger = require('../../utils/logger');

/**
 * POST /api/attendance/check-in — Check-in presensi 3 lapis
 * @access WORKER
 * Body: { claim_id, lat, lng, pin?, qr_code?, selfie_url }
 */
async function checkIn(req, res, next) {
  try {
    const { claim_id, lat, lng, pin, qr_code, selfie_url } = req.body;

    logger.info('[AttendanceController] Check-in request', {
      userId: req.user.id,
      claimId: claim_id,
    });

    const result = await attendanceService.checkIn({
      workerUserId: req.user.id,
      claimId: claim_id,
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      pin,
      qrCode: qr_code,
      selfieUrl: selfie_url,
    });

    return res.status(200).json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/attendance/check-out — Check-out & settlement gaji
 * @access WORKER
 * Body: { claim_id, lat, lng, pin?, qr_code? }
 */
async function checkOut(req, res, next) {
  try {
    const { claim_id, lat, lng, pin, qr_code } = req.body;

    logger.info('[AttendanceController] Check-out request', {
      userId: req.user.id,
      claimId: claim_id,
    });

    const result = await attendanceService.checkOut({
      workerUserId: req.user.id,
      claimId: claim_id,
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      pin,
      qrCode: qr_code,
    });

    return res.status(200).json({
      success: true,
      message: result.settlement.message,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { checkIn, checkOut };
