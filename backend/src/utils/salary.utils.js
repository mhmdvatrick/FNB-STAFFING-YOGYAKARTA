/**
 * Salary Calculation Utilities
 * Semua kalkulasi finansial dikumpulkan di sini untuk konsistensi dan testability
 */

const SERVICE_FEE_PER_HOUR = parseInt(process.env.PLATFORM_SERVICE_FEE_PER_HOUR || '3000', 10);
const ROUNDING_MINUTES = parseInt(process.env.SALARY_ROUNDING_MINUTES || '15', 10);
const STANDBY_COMPENSATION = 5000; // Rp 5.000 flat per sesi standby

/**
 * Bulatkan durasi menit ke kelipatan ROUNDING_MINUTES (default 15 menit)
 * Contoh: 67 menit → 75 menit (1.25 jam), 61 menit → 60 menit (1 jam)
 * @param {number} rawMinutes - Durasi kerja mentah dalam menit
 * @param {number} roundingMinutes - Kelipatan pembulatan (default 15)
 * @returns {number} Durasi menit setelah dibulatkan
 */
function roundDurationMinutes(rawMinutes, roundingMinutes = ROUNDING_MINUTES) {
  if (rawMinutes <= 0) return 0;
  return Math.round(rawMinutes / roundingMinutes) * roundingMinutes;
}

/**
 * Hitung durasi kerja dari check-in dan check-out time
 * @param {Date|string} checkInTime
 * @param {Date|string} checkOutTime
 * @returns {{ rawMinutes: number, roundedMinutes: number, hours: number }}
 */
function calculateWorkDuration(checkInTime, checkOutTime) {
  const checkIn = new Date(checkInTime);
  const checkOut = new Date(checkOutTime);

  if (checkOut <= checkIn) {
    throw new Error('CHECK_OUT_BEFORE_CHECK_IN: Waktu check-out harus setelah check-in');
  }

  const rawMinutes = Math.floor((checkOut - checkIn) / (1000 * 60));
  const roundedMinutes = roundDurationMinutes(rawMinutes);
  const hours = roundedMinutes / 60;

  return { rawMinutes, roundedMinutes, hours };
}

/**
 * Hitung gaji kotor worker
 * @param {number} roundedMinutes - Durasi kerja dalam menit (sudah dibulatkan)
 * @param {number} hourlyRate - Rate per jam dalam Rupiah
 * @returns {number} Gaji kotor dalam Rupiah
 */
function calculateGrossSalary(roundedMinutes, hourlyRate) {
  if (roundedMinutes <= 0) return 0;
  if (hourlyRate <= 0) throw new Error('INVALID_RATE: Hourly rate harus lebih dari 0');

  const hours = roundedMinutes / 60;
  return Math.round(hours * hourlyRate);
}

/**
 * Hitung total service fee platform
 * @param {number} roundedMinutes - Durasi kerja dalam menit
 * @param {number} feePerHour - Fee per jam (default dari env)
 * @returns {number} Total service fee dalam Rupiah
 */
function calculateServiceFee(roundedMinutes, feePerHour = SERVICE_FEE_PER_HOUR) {
  if (roundedMinutes <= 0) return 0;
  const hours = roundedMinutes / 60;
  return Math.round(hours * feePerHour);
}

/**
 * Full settlement calculation — single source of truth
 * @param {object} params
 * @param {Date|string} params.checkInTime
 * @param {Date|string} params.checkOutTime
 * @param {number} params.hourlyRate - Rate per jam dari shift
 * @param {number} [params.feePerHour] - Override service fee per jam
 * @returns {object} Breakdown perhitungan lengkap
 */
function calculateSettlement({ checkInTime, checkOutTime, hourlyRate, feePerHour }) {
  const duration = calculateWorkDuration(checkInTime, checkOutTime);
  const grossSalary = calculateGrossSalary(duration.roundedMinutes, hourlyRate);
  const serviceFee = calculateServiceFee(duration.roundedMinutes, feePerHour);
  const totalDeductFromResto = grossSalary + serviceFee;
  const netSalaryToWorker = grossSalary; // Worker menerima full gross (service fee dari sisi platform/resto)

  return {
    rawMinutes: duration.rawMinutes,
    roundedMinutes: duration.roundedMinutes,
    workHours: parseFloat(duration.hours.toFixed(2)),
    hourlyRate,
    grossSalary,
    serviceFee,
    totalDeductFromResto,
    netSalaryToWorker,
  };
}

/**
 * Kompensasi standby untuk worker yang diaktifkan dari list standby
 * @returns {number} Nominal kompensasi dalam Rupiah
 */
function getStandbyCompensation() {
  return STANDBY_COMPENSATION;
}

module.exports = {
  roundDurationMinutes,
  calculateWorkDuration,
  calculateGrossSalary,
  calculateServiceFee,
  calculateSettlement,
  getStandbyCompensation,
  ROUNDING_MINUTES,
  SERVICE_FEE_PER_HOUR,
};
