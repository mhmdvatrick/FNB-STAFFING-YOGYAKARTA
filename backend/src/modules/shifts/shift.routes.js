const express = require('express');
const router = express.Router();

const { authenticate, requireRole } = require('../../middleware/auth.middleware');
const { validate } = require('../../middleware/validate.middleware');
const { createShiftSchema, claimShiftSchema, confirmShiftSchema } = require('./shift.validator');
const controller = require('./shift.controller');

// GET /api/shifts — Daftar shift terbuka
// Worker melihat shift yang tersedia
router.get('/', authenticate, requireRole('WORKER', 'ADMIN'), controller.getAvailableShifts);

// GET /api/shifts/my — Shift milik resto yang login
router.get('/my', authenticate, requireRole('RESTO', 'ADMIN'), controller.getMyRestoShifts);

// GET /api/shifts/:id — Detail satu shift
router.get('/:id', authenticate, controller.getShiftById);

// POST /api/shifts — Resto membuat shift baru (Modul A)
router.post(
  '/',
  authenticate,
  requireRole('RESTO'),
  validate(createShiftSchema),
  controller.createShift
);

// POST /api/shifts/claim — Worker klaim shift
router.post(
  '/claim',
  authenticate,
  requireRole('WORKER'),
  validate(claimShiftSchema),
  controller.claimShift
);

// PATCH /api/shifts/confirm — Worker konfirmasi kehadiran H-2 jam
router.patch(
  '/confirm',
  authenticate,
  requireRole('WORKER'),
  validate(confirmShiftSchema),
  controller.confirmAttendance
);

module.exports = router;
