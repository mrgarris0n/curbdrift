import { getRecordsJson, RecordsUnavailableError } from './socrata.js';
import { CLUSTER_M } from './complaints.js';
import { distanceM } from '../geo.js';

// DEP's NYC Stormwater Flood Map (Moderate Flood, 2.13 in/h, current sea levels), sampled into
// points by scripts/flood-points.py. The map is a static model, so the file is committed, not built.
export const FLOOD_URL = '/assets/flood.json';
const DEEP = 2; // Flooding_Category 2: ponding of 1 ft or more. 1 is 4 in to 1 ft.

// Flood-only spots closer than this (about a block) are one puddle. At the 30 m sampling
// spacing, Gowanus showed 23 modelled puddles in one survey; at 100 m the worst seen is 11.
export const FLOOD_SPACING_M = 100;

/** @typedef {{lat:number, lon:number, deep:boolean}} FloodSpot */

/** Snapshot → the modelled ponding spots inside the survey circle. @returns {FloodSpot[]} */
export function floodFromSnapshot(snapshot, center, radiusM) {
  if (!Array.isArray(snapshot?.points)) throw new RecordsUnavailableError('unexpected flood snapshot shape');
  const spots = [];
  for (const p of snapshot.points) {
    if (!Array.isArray(p)) continue;
    const [lon, lat, cat] = p;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const spot = { lat, lon, deep: cat === DEEP };
    if (distanceM(center, spot) <= radiusM) spots.push(spot);
  }
  return spots;
}

/**
 * Join modelled spots to 311 puddle clusters. A cluster with a spot within CLUSTER_M is
 * flood-prone (deep if any such spot is). Spots near no cluster become puddles of their own,
 * thinned to FLOOD_SPACING_M apart, deep ones kept first. Ids are stable across re-surveys.
 */
export function mergeFloodSpots(clusters, spots) {
  const loose = [];
  const merged = clusters.map((c) => ({ ...c, floodProne: false, floodDepth: null }));
  for (const s of spots) {
    const near = merged.filter((c) => distanceM(c, s) <= CLUSTER_M);
    if (near.length === 0) { loose.push(s); continue; }
    for (const c of near) {
      c.floodProne = true;
      if (s.deep || !c.floodDepth) c.floodDepth = s.deep ? 'deep' : 'nuisance';
    }
  }

  const kept = [];
  for (const s of [...loose.filter((s) => s.deep), ...loose.filter((s) => !s.deep)]) {
    if (kept.some((k) => distanceM(k, s) < FLOOD_SPACING_M)) continue;
    kept.push(s);
  }
  return [
    ...merged,
    ...kept.map((s) => ({
      kind: 'P', id: `F|${s.lat.toFixed(5)},${s.lon.toFixed(5)}`, lat: s.lat, lon: s.lon,
      complaintCount: 0, lastComplaint: null, descriptors: [], byDescriptor: {}, floodProne: true, floodDepth: s.deep ? 'deep' : 'nuisance',
    })),
  ];
}

/** @returns {Promise<FloodSpot[]>} */
export async function fetchFlood(center, radiusM, { fetchImpl, timeoutMs, signal } = {}) {
  const snapshot = await getRecordsJson(FLOOD_URL, { fetchImpl, timeoutMs, signal });
  return floodFromSnapshot(snapshot, center, radiusM);
}
