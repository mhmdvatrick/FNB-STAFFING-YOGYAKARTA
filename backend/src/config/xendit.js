require('dotenv').config();
const logger = require('../utils/logger');

/**
 * Xendit Payment Gateway Config
 * MVP: Semua operasi di-mock untuk presentasi tanpa API key sungguhan
 *
 * TODO: Saat production, uncomment kode Xendit yang sebenarnya
 * dan install: npm install xendit-node
 */

const isMock = process.env.XENDIT_MOCK === 'true' || !process.env.XENDIT_SECRET_KEY ||
  process.env.XENDIT_SECRET_KEY.includes('your_key');

if (isMock) {
  logger.warn('[Xendit] Running in MOCK mode — transaksi tidak nyata');
} else {
  logger.info('[Xendit] Production mode — transaksi nyata aktif');
}

// TODO (Production): const { Xendit } = require('xendit-node');
// TODO (Production): const xenditClient = new Xendit({ secretKey: process.env.XENDIT_SECRET_KEY });

module.exports = {
  isMock,
  secretKey: process.env.XENDIT_SECRET_KEY,
};
