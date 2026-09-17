/**
 * Unit Tests: Salary Calculation Logic
 * Modul yang ditest: src/utils/salary.utils.js
 */

// Mock env vars sebelum import
process.env.PLATFORM_SERVICE_FEE_PER_HOUR = '3000';
process.env.SALARY_ROUNDING_MINUTES = '15';

const {
  roundDurationMinutes,
  calculateWorkDuration,
  calculateGrossSalary,
  calculateServiceFee,
  calculateSettlement,
  getStandbyCompensation,
} = require('../src/utils/salary.utils');

describe('roundDurationMinutes', () => {
  test('61 menit dibulatkan ke 60 menit (1 jam)', () => {
    expect(roundDurationMinutes(61)).toBe(60);
  });

  test('67 menit dibulatkan ke 75 menit (1.25 jam)', () => {
    expect(roundDurationMinutes(67)).toBe(75);
  });

  test('90 menit tetap 90 menit (sudah bulat)', () => {
    expect(roundDurationMinutes(90)).toBe(90);
  });

  test('8 menit dibulatkan ke 0 menit (kurang dari setengah rounding)', () => {
    expect(roundDurationMinutes(7)).toBe(0);
  });

  test('8 menit dibulatkan ke 15 menit (lebih dari setengah rounding)', () => {
    expect(roundDurationMinutes(8)).toBe(15);
  });

  test('120 menit tetap 120 menit', () => {
    expect(roundDurationMinutes(120)).toBe(120);
  });

  test('0 menit mengembalikan 0', () => {
    expect(roundDurationMinutes(0)).toBe(0);
  });

  test('durasi negatif mengembalikan 0', () => {
    expect(roundDurationMinutes(-10)).toBe(0);
  });
});

describe('calculateWorkDuration', () => {
  test('4 jam kerja dihitung dengan benar', () => {
    const checkIn = new Date('2024-01-15T08:00:00Z');
    const checkOut = new Date('2024-01-15T12:00:00Z');
    const result = calculateWorkDuration(checkIn, checkOut);

    expect(result.rawMinutes).toBe(240);
    expect(result.roundedMinutes).toBe(240);
    expect(result.hours).toBe(4);
  });

  test('4 jam 7 menit dibulatkan ke 4 jam', () => {
    const checkIn = new Date('2024-01-15T08:00:00Z');
    const checkOut = new Date('2024-01-15T12:07:00Z');
    const result = calculateWorkDuration(checkIn, checkOut);

    expect(result.rawMinutes).toBe(247);
    expect(result.roundedMinutes).toBe(240); // 247 menit → bulatkan ke 240
  });

  test('3 jam 22 menit dibulatkan ke 3 jam 15 menit', () => {
    const checkIn = new Date('2024-01-15T08:00:00Z');
    const checkOut = new Date('2024-01-15T11:22:00Z');
    const result = calculateWorkDuration(checkIn, checkOut);

    expect(result.rawMinutes).toBe(202);
    expect(result.roundedMinutes).toBe(195); // 202 menit → bulatkan ke kelipatan 15 terdekat
  });

  test('melempar error jika check-out sebelum check-in', () => {
    const checkIn = new Date('2024-01-15T12:00:00Z');
    const checkOut = new Date('2024-01-15T08:00:00Z');

    expect(() => calculateWorkDuration(checkIn, checkOut)).toThrow('CHECK_OUT_BEFORE_CHECK_IN');
  });

  test('menerima string ISO sebagai input', () => {
    const result = calculateWorkDuration(
      '2024-01-15T08:00:00.000Z',
      '2024-01-15T14:00:00.000Z'
    );
    expect(result.hours).toBe(6);
  });
});

describe('calculateGrossSalary', () => {
  test('4 jam × Rp 20.000/jam = Rp 80.000', () => {
    expect(calculateGrossSalary(240, 20000)).toBe(80000);
  });

  test('1.5 jam (90 menit) × Rp 20.000/jam = Rp 30.000', () => {
    expect(calculateGrossSalary(90, 20000)).toBe(30000);
  });

  test('0.25 jam (15 menit) × Rp 20.000/jam = Rp 5.000', () => {
    expect(calculateGrossSalary(15, 20000)).toBe(5000);
  });

  test('rate 0 melempar error', () => {
    expect(() => calculateGrossSalary(60, 0)).toThrow('INVALID_RATE');
  });

  test('durasi 0 mengembalikan 0', () => {
    expect(calculateGrossSalary(0, 20000)).toBe(0);
  });

  test('rate Rp 15.000 (minimum wage FnB Yogyakarta)', () => {
    expect(calculateGrossSalary(60, 15000)).toBe(15000);
  });
});

describe('calculateServiceFee', () => {
  test('4 jam × Rp 3.000/jam = Rp 12.000 service fee', () => {
    expect(calculateServiceFee(240, 3000)).toBe(12000);
  });

  test('30 menit × Rp 3.000/jam = Rp 1.500 service fee', () => {
    expect(calculateServiceFee(30, 3000)).toBe(1500);
  });

  test('service fee 0 menit = 0', () => {
    expect(calculateServiceFee(0)).toBe(0);
  });
});

describe('calculateSettlement (full integration)', () => {
  test('shift 8 jam rate Rp 20.000/jam — perhitungan lengkap', () => {
    const result = calculateSettlement({
      checkInTime: '2024-01-15T08:00:00.000Z',
      checkOutTime: '2024-01-15T16:00:00.000Z',
      hourlyRate: 20000,
    });

    expect(result.workHours).toBe(8);
    expect(result.roundedMinutes).toBe(480);
    expect(result.grossSalary).toBe(160000);         // 8 × 20.000
    expect(result.serviceFee).toBe(24000);            // 8 × 3.000
    expect(result.totalDeductFromResto).toBe(184000); // 160.000 + 24.000
    expect(result.netSalaryToWorker).toBe(160000);    // Worker dapat full gross
  });

  test('shift 3 jam 20 menit (dibulatkan ke 3 jam 15 menit)', () => {
    const checkIn = new Date('2024-01-15T18:00:00.000Z');
    const checkOut = new Date(checkIn.getTime() + (3 * 60 + 20) * 60 * 1000); // +200 menit

    const result = calculateSettlement({
      checkInTime: checkIn,
      checkOutTime: checkOut,
      hourlyRate: 18000,
    });

    expect(result.roundedMinutes).toBe(195); // 200 → 195 (13 jam * 15 menit)
    expect(result.workHours).toBe(3.25);
    expect(result.grossSalary).toBe(58500);  // 3.25 × 18.000
  });

  test('melempar error jika check-out sebelum check-in', () => {
    expect(() => calculateSettlement({
      checkInTime: '2024-01-15T16:00:00.000Z',
      checkOutTime: '2024-01-15T08:00:00.000Z',
      hourlyRate: 20000,
    })).toThrow();
  });
});

describe('getStandbyCompensation', () => {
  test('kompensasi standby adalah Rp 5.000', () => {
    expect(getStandbyCompensation()).toBe(5000);
  });
});
