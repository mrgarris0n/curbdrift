// Decay route: a walking loop from a start point through the most deteriorated items that fit
// a distance budget. A small orienteering problem, solved with greedy cheapest insertion:
// repeatedly insert the item with the best (score ÷ extra meters), at the position in the loop
// where it adds the least walking, until nothing else fits.
//
// Distances are straight lines × WALK_FACTOR to approximate the street grid (no routing service).
import { distanceM } from './geo.js';

export const WALK_FACTOR = 1.3;
export const WALK_M_PER_MIN = 80; // ≈ 4.8 km/h
export const DEFAULT_BUDGET_M = 2000;
// A walk, not an audit: beyond this many stops an itinerary stops being followable.
export const MAX_STOPS = 12;

const walk = (a, b) => distanceM(a, b) * WALK_FACTOR;

/**
 * @param {{lat:number, lon:number}} start
 * @param {Array<{id:string, lat:number, lon:number, score:number}>} items
 * @param {number} budgetM total walking distance allowed, including the return to start
 *   (and at most MAX_STOPS stops)
 * @returns {{stops: Array<object>, distanceM:number, minutes:number, totalScore:number}}
 *   stops are the chosen items in walking order, each with legM (from the previous point)
 *   and atM (cumulative from the start).
 */
export function planRoute(start, items, budgetM = DEFAULT_BUDGET_M) {
  const path = [start, start]; // closed loop: start → … → start
  let total = 0;
  const remaining = items.filter((it) => it.score > 0 && Number.isFinite(it.lat) && Number.isFinite(it.lon));

  while (path.length - 2 < MAX_STOPS) {
    let best = null;
    for (let k = 0; k < remaining.length; k++) {
      const it = remaining[k];
      for (let i = 0; i < path.length - 1; i++) {
        const delta = walk(path[i], it) + walk(it, path[i + 1]) - walk(path[i], path[i + 1]);
        if (total + delta > budgetM) continue;
        const ratio = it.score / Math.max(delta, 1);
        if (!best || ratio > best.ratio) best = { k, i, delta, ratio };
      }
    }
    if (!best) break;
    path.splice(best.i + 1, 0, remaining[best.k]);
    total += best.delta;
    remaining.splice(best.k, 1);
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
