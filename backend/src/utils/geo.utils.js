/**
 * Geo Utility Functions
 * Implementasi Haversine Formula untuk kalkulasi jarak GPS
 */

const EARTH_RADIUS_M = 6371000; // Radius bumi dalam meter

/**
 * Hitung jarak antara dua koordinat GPS menggunakan Haversine Formula
 * @param {number} lat1 - Latitude titik 1 (derajat)
 * @param {number} lng1 - Longitude titik 1 (derajat)
 * @param {number} lat2 - Latitude titik 2 (derajat)
 * @param {number} lng2 - Longitude titik 2 (derajat)
 * @returns {number} Jarak dalam meter
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_M * c;
}

/**
 * Cek apakah koordinat worker berada dalam radius yang diizinkan
 * @param {object} workerLocation - { lat, lng }
 * @param {object} restoLocation  - { lat, lng }
 * @param {number} maxRadiusMeters - Default 50 meter (check-in)
 * @returns {{ isValid: boolean, distanceMeters: number }}
 */
function isWithinGeofence(workerLocation, restoLocation, maxRadiusMeters = 50) {
  const distance = haversineDistance(
    workerLocation.lat,
    workerLocation.lng,
    restoLocation.lat,
    restoLocation.lng
  );

  return {
    isValid: distance <= maxRadiusMeters,
    distanceMeters: Math.round(distance),
  };
}

/**
 * Filter worker dalam radius maksimum dari lokasi resto (untuk matching engine)
 * Menggunakan bounding box dulu untuk efisiensi, lalu Haversine untuk presisi
 * @param {object} restoLocation - { lat, lng }
 * @param {Array} workers - Array of { id, current_lat, current_lng, ... }
 * @param {number} maxRadiusKm - Default 5 KM
 * @returns {Array} Worker dalam radius + distanceKm masing-masing
 */
function filterWorkersInRadius(restoLocation, workers, maxRadiusKm = 5) {
  const maxRadiusM = maxRadiusKm * 1000;

  return workers
    .map((worker) => {
      const distanceMeters = haversineDistance(
        restoLocation.lat,
        restoLocation.lng,
        worker.current_lat,
        worker.current_lng
      );
      return {
        ...worker,
        distanceMeters: Math.round(distanceMeters),
        distanceKm: parseFloat((distanceMeters / 1000).toFixed(2)),
      };
    })
    .filter((w) => w.distanceMeters <= maxRadiusM)
    .sort((a, b) => a.distanceMeters - b.distanceMeters); // Urutkan terdekat dulu
}

/**
 * Bounding box kasar untuk pre-filter sebelum Haversine (optimasi database query)
 * @param {number} lat - Pusat latitude
 * @param {number} lng - Pusat longitude
 * @param {number} radiusKm - Radius dalam KM
 * @returns {{ minLat, maxLat, minLng, maxLng }}
 */
function getBoundingBox(lat, lng, radiusKm) {
  const latDelta = radiusKm / 111.0; // ~111 km per derajat latitude
  const lngDelta = radiusKm / (111.0 * Math.cos((lat * Math.PI) / 180));

  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}

module.exports = {
  haversineDistance,
  isWithinGeofence,
  filterWorkersInRadius,
  getBoundingBox,
};
