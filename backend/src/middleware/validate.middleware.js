const Joi = require('joi');

/**
 * Validation Middleware Factory
 * Membungkus Joi schema validation sebagai Express middleware
 * @param {Joi.Schema} schema - Joi schema untuk validasi
 * @param {'body'|'query'|'params'} target - Bagian request yang divalidasi
 */
function validate(schema, target = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[target], {
      abortEarly: false,      // Tampilkan semua error sekaligus
      stripUnknown: true,     // Buang field yang tidak ada di schema
      convert: true,          // Auto-convert tipe (string ke number, dll)
    });

    if (error) {
      const details = error.details.map((d) => ({
        field: d.path.join('.'),
        message: d.message.replace(/['"]/g, ''),
      }));

      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Input tidak valid',
        errors: details,
      });
    }

    req[target] = value; // Gunakan nilai yang sudah di-sanitize
    next();
  };
}

module.exports = { validate };
