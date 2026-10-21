function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
const validCoords = (lat, lon) => lat !== null && lon !== null && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;

module.exports = { haversineKm, HttpError, str, num, validCoords };
