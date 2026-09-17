/**
 * Unit Tests: Geofencing & Haversine Formula
 * Modul yang ditest: src/utils/geo.utils.js
 */

const {
  haversineDistance,
  isWithinGeofence,
  filterWorkersInRadius,
  getBoundingBox,
} = require('../src/utils/geo.utils');

// Koordinat referensi: Kawasan Malioboro, Yogyakarta
const MALIOBORO = { lat: -7.7928, lng: 110.3659 };

// Titik ~35 meter dari Malioboro (dalam geofence 50m)
const NEAR_MALIOBORO = { lat: -7.7931, lng: 110.3659 };

// Titik ~150 meter dari Malioboro (di luar geofence 50m)
const FAR_FROM_MALIOBORO = { lat: -7.7942, lng: 110.3659 };

// Kaliurang ~15 km dari Malioboro
const KALIURANG = { lat: -7.6501, lng: 110.4208 };

describe('haversineDistance', () => {
  test('jarak ke titik yang sama adalah 0', () => {
    const dist = haversineDistance(
      MALIOBORO.lat, MALIOBORO.lng,
      MALIOBORO.lat, MALIOBORO.lng
    );
    expect(dist).toBe(0);
  });

  test('titik ~35 meter dari Malioboro', () => {
    const dist = haversineDistance(
      MALIOBORO.lat, MALIOBORO.lng,
      NEAR_MALIOBORO.lat, NEAR_MALIOBORO.lng
    );
    // Toleransi ±10 meter untuk floating point
    expect(dist).toBeGreaterThan(25);
    expect(dist).toBeLessThan(45);
  });

  test('titik ~150 meter dari Malioboro', () => {
    const dist = haversineDistance(
      MALIOBORO.lat, MALIOBORO.lng,
      FAR_FROM_MALIOBORO.lat, FAR_FROM_MALIOBORO.lng
    );
    expect(dist).toBeGreaterThan(100);
    expect(dist).toBeLessThan(200);
  });

  test('Kaliurang ke Malioboro ~15 km', () => {
    const dist = haversineDistance(
      MALIOBORO.lat, MALIOBORO.lng,
      KALIURANG.lat, KALIURANG.lng
    );
    const distKm = dist / 1000;
    expect(distKm).toBeGreaterThan(14);
    expect(distKm).toBeLessThan(18);
  });

  test('fungsi bersifat simetrik (A→B = B→A)', () => {
    const distAB = haversineDistance(
      MALIOBORO.lat, MALIOBORO.lng,
      KALIURANG.lat, KALIURANG.lng
    );
    const distBA = haversineDistance(
      KALIURANG.lat, KALIURANG.lng,
      MALIOBORO.lat, MALIOBORO.lng
    );
    expect(Math.abs(distAB - distBA)).toBeLessThan(0.001);
  });
});

describe('isWithinGeofence (50 meter radius)', () => {
  test('worker ~35m dari resto → VALID (dalam geofence)', () => {
    const result = isWithinGeofence(NEAR_MALIOBORO, MALIOBORO, 50);

    expect(result.isValid).toBe(true);
    expect(result.distanceMeters).toBeLessThan(50);
  });

  test('worker ~150m dari resto → INVALID (di luar geofence)', () => {
    const result = isWithinGeofence(FAR_FROM_MALIOBORO, MALIOBORO, 50);

    expect(result.isValid).toBe(false);
    expect(result.distanceMeters).toBeGreaterThan(50);
  });

  test('worker tepat di lokasi resto → VALID', () => {
    const result = isWithinGeofence(MALIOBORO, MALIOBORO, 50);

    expect(result.isValid).toBe(true);
    expect(result.distanceMeters).toBe(0);
  });

  test('geofence radius custom 200 meter — worker 150m tetap valid', () => {
    const result = isWithinGeofence(FAR_FROM_MALIOBORO, MALIOBORO, 200);
    expect(result.isValid).toBe(true);
  });

  test('mengembalikan distanceMeters sebagai integer', () => {
    const result = isWithinGeofence(NEAR_MALIOBORO, MALIOBORO, 50);
    expect(Number.isInteger(result.distanceMeters)).toBe(true);
  });
});

describe('filterWorkersInRadius', () => {
  const mockWorkers = [
    { id: 'w1', current_lat: NEAR_MALIOBORO.lat, current_lng: NEAR_MALIOBORO.lng, name: 'Worker Dekat (~35m)' },
    { id: 'w2', current_lat: FAR_FROM_MALIOBORO.lat, current_lng: FAR_FROM_MALIOBORO.lng, name: 'Worker Sedang (~150m)' },
    { id: 'w3', current_lat: KALIURANG.lat, current_lng: KALIURANG.lng, name: 'Worker Jauh (Kaliurang ~15km)' },
    { id: 'w4', current_lat: -7.7935, current_lng: 110.3660, name: 'Worker Dekat 2 (~80m)' },
  ];

  test('filter workers dalam radius 5 KM dari Malioboro', () => {
    const result = filterWorkersInRadius(MALIOBORO, mockWorkers, 5);

    // Worker Kaliurang (~15km) harus terfilter keluar
    const workerIds = result.map((w) => w.id);
    expect(workerIds).toContain('w1');
    expect(workerIds).toContain('w2');
    expect(workerIds).toContain('w4');
    expect(workerIds).not.toContain('w3'); // Kaliurang keluar
  });

  test('hasil diurutkan dari yang terdekat', () => {
    const result = filterWorkersInRadius(MALIOBORO, mockWorkers, 5);

    // Worker pertama harus yang terdekat
    expect(result[0].id).toBe('w1');
  });

  test('setiap worker dalam hasil memiliki distanceMeters dan distanceKm', () => {
    const result = filterWorkersInRadius(MALIOBORO, mockWorkers, 5);

    result.forEach((w) => {
      expect(w).toHaveProperty('distanceMeters');
      expect(w).toHaveProperty('distanceKm');
      expect(typeof w.distanceMeters).toBe('number');
      expect(typeof w.distanceKm).toBe('number');
    });
  });

  test('radius 0.05 km (50 meter) hanya mengembalikan worker sangat dekat', () => {
    const result = filterWorkersInRadius(MALIOBORO, mockWorkers, 0.05);
    // Hanya worker ~35m yang masuk
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('w1');
  });

  test('list worker kosong mengembalikan array kosong', () => {
    const result = filterWorkersInRadius(MALIOBORO, [], 5);
    expect(result).toEqual([]);
  });
});

describe('getBoundingBox', () => {
  test('bounding box radius 5 KM dari Malioboro', () => {
    const bbox = getBoundingBox(MALIOBORO.lat, MALIOBORO.lng, 5);

    expect(bbox.minLat).toBeLessThan(MALIOBORO.lat);
    expect(bbox.maxLat).toBeGreaterThan(MALIOBORO.lat);
    expect(bbox.minLng).toBeLessThan(MALIOBORO.lng);
    expect(bbox.maxLng).toBeGreaterThan(MALIOBORO.lng);
  });

  test('Kaliurang TIDAK masuk bounding box 5 KM Malioboro', () => {
    const bbox = getBoundingBox(MALIOBORO.lat, MALIOBORO.lng, 5);

    const kaliurangInBox =
      KALIURANG.lat >= bbox.minLat &&
      KALIURANG.lat <= bbox.maxLat &&
      KALIURANG.lng >= bbox.minLng &&
      KALIURANG.lng <= bbox.maxLng;

    expect(kaliurangInBox).toBe(false);
  });

  test('titik dekat Malioboro masuk bounding box', () => {
    const bbox = getBoundingBox(MALIOBORO.lat, MALIOBORO.lng, 5);

    const nearInBox =
      NEAR_MALIOBORO.lat >= bbox.minLat &&
      NEAR_MALIOBORO.lat <= bbox.maxLat &&
      NEAR_MALIOBORO.lng >= bbox.minLng &&
      NEAR_MALIOBORO.lng <= bbox.maxLng;

    expect(nearInBox).toBe(true);
  });
});
