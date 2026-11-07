// Vercel Function: POST /api/route  { points: [{lat, lon}, …] }
// Asks OpenRouteService for a walking route through the points, in order, adding the API key
// server-side (env ORS_API_KEY) so it never reaches the browser. Deliberately narrow: only short
// walks inside New York City, so this cannot be used as a general-purpose router on our quota.
import { isInNyc } from '../js/geo.js';

const UPSTREAM = 'https://api.openrouteservice.org/v2/directions/foot-walking/geojson';
export const MAX_POINTS = 14; // start + 12 stops + return to start
const TIMEOUT_MS = 20000;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function validPoints(body) {
  const points = body?.points;
  if (!Array.isArray(points) || points.length < 2 || points.length > MAX_POINTS) return null;
  const ok = points.every((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon) && isInNyc(p));
  return ok ? points.map((p) => ({ lat: p.lat, lon: p.lon })) : null;
}

/** Reduce an OpenRouteService GeoJSON answer to what the app draws and reports. */
function normalize(answer) {
  const feature = answer?.features?.[0];
  const coords = feature?.geometry?.coordinates;
  const summary = feature?.properties?.summary;
  const segments = feature?.properties?.segments;
  if (!Array.isArray(coords) || !coords.length || !Array.isArray(segments) || !Number.isFinite(summary?.distance)) return null;
  return {
    distanceM: summary.distance,
    durationS: summary.duration,
    legs: segments.map((s) => ({ distanceM: s.distance, durationS: s.duration })),
    path: coords.map(([lon, lat]) => [lat, lon]),
  };
}

export async function handleRoute(request, { key = process.env.ORS_API_KEY ?? '', fetchImpl = globalThis.fetch } = {}) {
  if (request.method !== 'POST') return json({ message: 'method not allowed' }, 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ message: 'invalid body' }, 400);
  }
  const points = validPoints(body);
  if (!points) return json({ message: 'expected 2–14 points inside New York City' }, 400);
  if (!key) return json({ message: 'routing not configured' }, 503);

  let upstream;
  try {
    upstream = await fetchImpl(UPSTREAM, {
      method: 'POST',
      headers: { Authorization: key, 'content-type': 'application/json', accept: 'application/geo+json, application/json' },
      body: JSON.stringify({ coordinates: points.map((p) => [p.lon, p.lat]), instructions: false }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return json({ message: 'routing service unreachable' }, 502);
  }
  if (!upstream.ok) return json({ message: 'routing service refused' }, upstream.status);

  let route;
  try {
    route = normalize(await upstream.json());
  } catch {
    route = null;
  }
  return route ? json(route, 200) : json({ message: 'unexpected routing answer' }, 502);
}

export function POST(request) {
  return handleRoute(request);
}

export function GET(request) {
  return handleRoute(request);
}
