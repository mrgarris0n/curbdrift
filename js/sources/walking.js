import { requestSignal } from '../net.js';

/**
 * Real walking route through the points, in order, via our /api/route proxy (OpenRouteService).
 * @returns {Promise<{distanceM:number, durationS:number, legs:Array<{distanceM:number, durationS:number}>, path:Array<[number, number]>}>}
 */
export async function fetchWalkingRoute(points, { fetchImpl = globalThis.fetch, timeoutMs = 25000, signal } = {}) {
  const res = await fetchImpl('/api/route', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ points }),
    signal: requestSignal(timeoutMs, signal),
  });
  if (!res.ok) throw new Error(`walking route HTTP ${res.status}`);
  return res.json();
}
