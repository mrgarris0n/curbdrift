// The cities curbdrift can survey. Each is a plain record of fixed facts and the functions that
// fetch its data; everything downstream (scoring, themes, map, itinerary) works on the facts those
// functions return and does not care which city they came from.
import { fetchSheds } from './sources/sheds.js';
import { fetchComplaints } from './sources/complaints.js';
import { fetchFlood } from './sources/flood.js';
import { fetchWeather } from './sources/weather.js';

export const CITIES = Object.freeze({
  nyc: Object.freeze({
    id: 'nyc',
    name: 'New York City',
    bbox: Object.freeze({ south: 40.4774, north: 40.9176, west: -74.2591, east: -73.7004 }),
    // Union Square: verified to have sheds on record since 2017.
    defaultCenter: Object.freeze({ lat: 40.7359, lon: -73.9911 }),
    // Start dates of mayoral terms (de Blasio, Adams, Mamdani).
    mayorTermStarts: Object.freeze(['2014-01-01', '2022-01-01', '2026-01-01']),
    sources: Object.freeze({ fetchSheds, fetchComplaints, fetchWeather, fetchFlood }),
  }),
});

/** Where a survey lands when the user's position is unknown or outside every city. */
export const DEFAULT_CITY = CITIES.nyc;

/** The city whose bounding box contains the point, or null. */
export function cityAt({ lat, lon }) {
  return Object.values(CITIES).find(({ bbox: b }) => lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east) ?? null;
}

/** Where to start the survey: the user's position if known and inside a city, else the default city's centre. */
export function resolveStart(position) {
  if (position && Number.isFinite(position.lat) && Number.isFinite(position.lon) && cityAt(position)) {
    return { center: { lat: position.lat, lon: position.lon }, verified: true };
  }
  return { center: DEFAULT_CITY.defaultCenter, verified: false };
}
