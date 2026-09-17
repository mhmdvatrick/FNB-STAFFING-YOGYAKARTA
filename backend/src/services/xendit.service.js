const xenditConfig = require('../config/xendit');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

/**
 * Xendit Payment Service — MOCK MODE aktif untuk MVP
 *
 * Semua function mengembalikan response yang identik dengan Xendit production
 * sehingga mudah di-swap saat API key tersedia
 */

/**
 * Buat invoice untuk deposit saldo resto
 * @param {object} params
 * @param {string} params.restoUserId
 * @param {string} params.restoName
 * @param {string} params.email
 * @param {number} params.amount - Nominal dalam Rupiah
 * @param {string} params.description
 * @returns {Promise<object>} Invoice object
 */
async function createDepositInvoice({ restoUserId, restoName, email, amount, description }) {
  logger.info('[Xendit] Membuat deposit invoice', { restoUserId, amount });

  if (xenditConfig.isMock) {
    const mockInvoice = {
      id: `mock_inv_${uuidv4()}`,
      external_id: `deposit_${restoUserId}_${Date.now()}`,
      status: 'PENDING',
      amount,
      description: description || `Deposit saldo ${restoName}`,
      invoice_url: `https://mock-xendit.local/invoice/mock_${Date.now()}`,
      expiry_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      payment_method: 'QRIS',
      created: new Date().toISOString(),
      mock: true,
    };

    logger.info('[Xendit MOCK] Invoice dibuat', { invoiceId: mockInvoice.id, amount });
    return { success: true, data: mockInvoice };
  }

  // TODO (Production): Implementasi Xendit real
  // const { Invoice } = xenditClient;
  // const invoice = await Invoice.createInvoice({ ... });
  throw new Error('Xendit production mode belum diimplementasi');
}

/**
 * Proses payout (disbursement) ke rekening/dompet worker
 * @param {object} params
 * @param {string} params.workerUserId
 * @param {string} params.workerName
 * @param {number} params.amount - Nominal dalam Rupiah
 * @param {string} params.bankCode - Kode bank atau e-wallet (OVO, GOPAY, dll)
 * @param {string} params.accountNumber - Nomor rekening/nomor HP
 * @param {string} params.description
 * @returns {Promise<object>} Disbursement result
 */
async function createPayout({ workerUserId, workerName, amount, bankCode, accountNumber, description }) {
  logger.info('[Xendit] Memproses payout', { workerUserId, amount, bankCode });

  if (xenditConfig.isMock) {
    const mockDisbursement = {
      id: `mock_disb_${uuidv4()}`,
      external_id: `payout_${workerUserId}_${Date.now()}`,
      bank_code: bankCode || 'OVO',
      account_holder_name: workerName,
      disbursement_description: description || 'Payout gaji shift',
      amount,
      status: 'COMPLETED', // Mock langsung completed
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      mock: true,
    };

    logger.info('[Xendit MOCK] Payout berhasil', { disbursementId: mockDisbursement.id, amount });
    return { success: true, data: mockDisbursement };
  }

  // TODO (Production): Implementasi Xendit Disbursement real
  throw new Error('Xendit production mode belum diimplementasi');
}

/**
 * Cek status payment/invoice
 * @param {string} invoiceId - Xendit invoice ID
 */
async function checkPaymentStatus(invoiceId) {
  if (xenditConfig.isMock) {
    return {
      success: true,
      data: {
        id: invoiceId,
        status: 'PAID', // Mock selalu PAID
        mock: true,
      },
    };
  }

  // TODO (Production): Check status dari Xendit
  throw new Error('Xendit production mode belum diimplementasi');
}

module.exports = {
  createDepositInvoice,
  createPayout,
  checkPaymentStatus,
};
