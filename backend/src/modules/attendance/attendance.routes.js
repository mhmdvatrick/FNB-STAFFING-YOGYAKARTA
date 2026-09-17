const express = require('express');
const router = express.Router();
const Joi = require('joi');

const { authenticate, requireRole } = require('../../middleware/auth.middleware');
const { validate } = require('../../middleware/validate.middleware');
const controller = require('./attendance.controller');

// Schema validasi check-in
const checkInSchema = Joi.object({
  claim_id: Joi.string().uuid().required().messages({
    'any.required': 'claim_id wajib diisi',
  }),
  lat: Joi.number().min(-90).max(90).required().messages({
    'any.required': 'Koordinat latitude wajib diisi',
  }),
  lng: Joi.number().min(-180).max(180).required().messages({
    'any.required': 'Koordinat longitude wajib diisi',
  }),
  // Wajib salah satu: pin ATAU qr_code
  pin: Joi.string().length(4).pattern(/^\d{4}$/).optional().messages({
    'string.pattern.base': 'PIN harus 4 angka',
    'string.length': 'PIN harus tepat 4 karakter',
  }),
  qr_code: Joi.string().optional(),
  selfie_url: Joi.string().uri().required().messages({
    'any.required': 'URL selfie wajib diisi',
    'string.uri': 'selfie_url harus berupa URL yang valid',
  }),
}).or('pin', 'qr_code').messages({
  'object.missing': 'Salah satu dari pin atau qr_code wajib diisi',
});

// Schema validasi check-out
const checkOutSchema = Joi.object({
  claim_id: Joi.string().uuid().required(),
  lat: Joi.number().min(-90).max(90).required(),
  lng: Joi.number().min(-180).max(180).required(),
  pin: Joi.string().length(4).pattern(/^\d{4}$/).optional(),
  qr_code: Joi.string().optional(),
}).or('pin', 'qr_code').messages({
  'object.missing': 'Salah satu dari pin atau qr_code wajib diisi untuk check-out',
});

// POST /api/attendance/check-in (Modul B)
router.post(
  '/check-in',
  authenticate,
  requireRole('WORKER'),
  validate(checkInSchema),
  controller.checkIn
);

// POST /api/attendance/check-out (Modul C)
router.post(
  '/check-out',
  authenticate,
  requireRole('WORKER'),
  validate(checkOutSchema),
  controller.checkOut
);

module.exports = router;
