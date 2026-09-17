const Joi = require('joi');

const VALID_ROLES = ['WAITSTAFF', 'BARISTA', 'KITCHEN', 'CASHIER'];

const createShiftSchema = Joi.object({
  title: Joi.string().min(5).max(200).required().messages({
    'string.min': 'Judul shift minimal 5 karakter',
    'any.required': 'Judul shift wajib diisi',
  }),
  role_required: Joi.string()
    .valid(...VALID_ROLES)
    .required()
    .messages({
      'any.only': `Role harus salah satu dari: ${VALID_ROLES.join(', ')}`,
      'any.required': 'Role yang dibutuhkan wajib diisi',
    }),
  headcount: Joi.number().integer().min(1).max(20).default(1),
  hourly_rate: Joi.number().integer().min(15000).max(200000).required().messages({
    'number.min': 'Rate per jam minimal Rp 15.000',
    'number.max': 'Rate per jam maksimal Rp 200.000',
    'any.required': 'Rate per jam wajib diisi',
  }),
  start_time: Joi.date().iso().greater('now').required().messages({
    'date.greater': 'Waktu mulai shift harus di masa depan',
    'any.required': 'Waktu mulai shift wajib diisi',
  }),
  end_time: Joi.date().iso().greater(Joi.ref('start_time')).required().messages({
    'date.greater': 'Waktu selesai harus setelah waktu mulai',
    'any.required': 'Waktu selesai shift wajib diisi',
  }),
  dress_code: Joi.string().max(200).optional(),
  instructions: Joi.string().max(1000).optional(),
  min_rating: Joi.number().min(1).max(5).default(4.5),
});

const claimShiftSchema = Joi.object({
  shift_id: Joi.string().uuid().required().messages({
    'string.uuid': 'shift_id harus berupa UUID yang valid',
    'any.required': 'shift_id wajib diisi',
  }),
  is_standby: Joi.boolean().default(false),
});

const confirmShiftSchema = Joi.object({
  claim_id: Joi.string().uuid().required(),
});

module.exports = { createShiftSchema, claimShiftSchema, confirmShiftSchema };
