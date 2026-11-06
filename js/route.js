// Decay route: a walking loop from a start point through the most deteriorated items that fit
// a distance budget and a stop cap. Kinds (sheds, puddles, defects) take turns, and within each
// kind the worst go first; each item is inserted where it adds the least walking, if the loop
// still fits the budget. Taking turns keeps a dense block of old sheds from crowding out every
// puddle and broken sidewalk. Several items at one spot (one building) take a single stop.
//
// Distances are straight lines × WALK_FACTOR to approximate the street grid (no routing service).
import { distanceM } from './geo.js';

export const WALK_FACTOR = 1.3;
export const WALK_M_PER_MIN = 80; // ≈ 4.8 km/h
export const DEFAULT_BUDGET_M = 2000;
// A walk, not an audit: beyond this many stops an itinerary stops being followable.
export const MAX_STOPS = 12;
// Not worth a detour below this score: a dry puddle (saturation < 15 is 'dormant') or a shed up
// for less than ~16 months. Without a floor, taking turns would pull in weak items just for variety.
export const MIN_DETOUR_SCORE = 15;
// Items closer than this to an existing stop are the same spot (same building or address).
const SAME_SPOT_M = 3;

const walk = (a, b) => distanceM(a, b) * WALK_FACTOR;

/**
 * @param {{lat:number, lon:number}} start
 * @param {Array<{id:string, kind:string, lat:number, lon:number, score:number}>} items
 * @param {number} budgetM total walking distance allowed, including the return to start
 *   (and at most MAX_STOPS stops)
 * @returns {{stops: Array<object>, distanceM:number, minutes:number, totalScore:number}}
 *   stops are the chosen items in walking order, each with legM (from the previous point)
 *   and atM (cumulative from the start).
 */
export function planRoute(start, items, budgetM = DEFAULT_BUDGET_M) {
  const path = [start, start]; // closed loop: start → … → start
  let total = 0;
  // One worst-first queue per kind.
  const queues = new Map();
  items
    .filter((it) => it.score >= MIN_DETOUR_SCORE && Number.isFinite(it.lat) && Number.isFinite(it.lon))
    .map((it) => ({ it, fromStart: walk(start, it) }))
    .sort((a, b) => b.it.score - a.it.score || a.fromStart - b.fromStart) // worst first; ties: nearer
    .forEach(({ it }) => {
      if (!queues.has(it.kind)) queues.set(it.kind, []);
      queues.get(it.kind).push(it);
    });

  // Insert `it` at its cheapest position if it fits and is not at an existing stop's spot.
  const tryInsert = (it) => {
    if (path.slice(1, -1).some((stop) => distanceM(stop, it) < SAME_SPOT_M)) return false;
    let best = null;
    for (let i = 0; i < path.length - 1; i++) {
      const delta = walk(path[i], it) + walk(it, path[i + 1]) - walk(path[i], path[i + 1]);
      if (!best || delta < best.delta) best = { i, delta };
    }
    if (total + best.delta > budgetM) return false; // out of reach; a lesser item may still fit
    path.splice(best.i + 1, 0, it);
    total += best.delta;
    return true;
  };

  // Rounds: each kind with candidates left places its worst item that fits. Kinds go in order
  // of their worst remaining item, so the single worst thing nearby is always considered first.
  const full = () => path.length - 2 >= MAX_STOPS;
  while (!full()) {
    const kinds = [...queues.values()].filter((q) => q.length).sort((a, b) => b[0].score - a[0].score);
    if (!kinds.length) break;
    for (const queue of kinds) {
      if (full()) break;
      while (queue.length && !tryInsert(queue.shift()));
    }
  }

  const stops = [];
  let atM = 0;
  for (let i = 1; i < path.length - 1; i++) {
    const legM = walk(path[i - 1], path[i]);
    atM += legM;
    stops.push({ ...path[i], legM, atM });
  }
  return {
    stops,
    distanceM: total,
    minutes: Math.round(total / WALK_M_PER_MIN),
    totalScore: stops.reduce((sum, s) => sum + s.score, 0),
  };
}
