import { DEFAULT_CENTER, NYC_BBOX } from './config.js';

const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in meters (haversine). */
export function distanceM(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Bounding box that encloses a circle of radiusM around center. */
export function bboxAround(center, radiusM) {
  const dLat = (radiusM / EARTH_RADIUS_M) * (180 / Math.PI);
  const dLon = dLat / Math.cos(toRad(center.lat));
  return { south: center.lat - dLat, north: center.lat + dLat, west: center.lon - dLon, east: center.lon + dLon };
}

export function isInNyc({ lat, lon }) {
  return lat >= NYC_BBOX.south && lat <= NYC_BBOX.north && lon >= NYC_BBOX.west && lon <= NYC_BBOX.east;
}

/** Where to start the survey: the user's position if known and inside NYC, else the default jurisdiction. */
export function resolveStart(position) {
  if (position && Number.isFinite(position.lat) && Number.isFinite(position.lon) && isInNyc(position)) {
    return { center: { lat: position.lat, lon: position.lon }, verified: true };
  }
  return { center: DEFAULT_CENTER, verified: false };
}
