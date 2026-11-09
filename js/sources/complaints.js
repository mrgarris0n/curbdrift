import { getRecordsJson, RecordsUnavailableError } from './socrata.js';
import { distanceM } from '../geo.js';
import { PUDDLE_WINDOW_MONTHS, DEFECT_WINDOW_MONTHS } from '../config.js';
import { parseApiDate, isoDay, monthsBefore } from '../dates.js';

// NYC 311 Service Requests.
export const DATASET = 'erm2-nwe9';
// A live 311 query per survey took Socrata 10–80 s, or failed outright with 503/429, so the deploy
// build turns a year of complaints into one citywide snapshot (scripts/snapshots.mjs), refreshed
// daily, and the browser keeps the ones in the survey circle. A day's lag is nothing next to the
// 12-month window.
export const SNAPSHOT_URL = '/data/complaints.json';
// Bump when toSnapshot's output changes for the same rows (tests/snapshot-format.test.js notices):
// builds reuse production's snapshot only if it was made with the same format (scripts/snapshots.mjs).
export const SNAPSHOT_FORMAT = 1;
// Complaints this close together are one puddle; flood-map spots this close to one belong to it.
export const CLUSTER_M = 30;

export const PUDDLE_DESCRIPTORS = Object.freeze([
  'Catch Basin Clogged/Flooding (Use Comments) (SC)',
  'Street Flooding (SJ)',
  'Flooding on Street',
  'Catch Basin Clogged',
  'Catch Basin Sunken/Damaged/Raised (SC1)',
  'Catch Basin Sunken',
  'Catch Basin Grating Missing (SA4)',
]);

export const DEFECT_DESCRIPTORS = Object.freeze([
  'Broken Sidewalk',
  'Sidewalk Collapsed',
  'Defective Hardware',
  'Cellar Door Open/Unprotected',
  'Metal Protruding - Sign Stump',
  'Sidewalk Grating - Defective',
  'Pedestrian Ramp Defective',
]);

const PUDDLE_TYPES = new Set(['Sewer', 'Sewer Maintenance']);
const PUDDLE_SET = new Set(PUDDLE_DESCRIPTORS);
const DEFECT_SET = new Set(DEFECT_DESCRIPTORS);

/** @typedef {{kind:'P', id:string, lat:number, lon:number, complaintCount:number,
 *   lastComplaint:Date, descriptors:string[], byDescriptor:Object<string, number>}} PuddleFacts */
/** @typedef {{kind:'D', id:string, lat:number, lon:number, address:string, descriptor:string,
 *   created:Date, closed:boolean}} DefectFacts */

const quote = (s) => `'${s.replace(/'/g, "''")}'`;

/** The citywide query behind the snapshot (paged by the caller): both kinds over the longer (puddle) window. */
export function snapshotQuery(now) {
  const since = isoDay(monthsBefore(now, PUDDLE_WINDOW_MONTHS));
  const descriptors = [...PUDDLE_DESCRIPTORS, ...DEFECT_DESCRIPTORS].map(quote).join(',');
  return {
    $select: 'unique_key,complaint_type,descriptor,created_date,status,incident_address,latitude,longitude',
    $where: `created_date > '${since}' AND complaint_type in('Sewer','Sewer Maintenance','Sidewalk Condition') AND descriptor in(${descriptors})`,
    $order: ':id',
  };
}

/**
 * Sort complaints, already in the shared shape {id, kind: 'P'|'D', lat, lon, created, descriptor,
 * address, closed}, into puddle clusters and defects: puddles within PUDDLE_WINDOW_MONTHS,
 * clustered greedily within clusterM (New York: CLUSTER_M); defects within DEFECT_WINDOW_MONTHS.
 * @returns {{puddles: PuddleFacts[], defects: DefectFacts[]}}
 */
export function sortComplaints(complaints, today, { clusterM = CLUSTER_M } = {}) {
  const puddleSince = monthsBefore(today, PUDDLE_WINDOW_MONTHS);
  const defectSince = monthsBefore(today, DEFECT_WINDOW_MONTHS);
  const clusters = [];
  const defects = [];

  for (const { id, kind, lat, lon, created, descriptor, address, closed } of complaints) {
    if (kind === 'P') {
      if (created < puddleSince) continue;
      // Greedy clustering: join the first cluster whose anchor point is within clusterM.
      const here = { lat, lon };
      const c = clusters.find((k) => distanceM(k, here) <= clusterM);
      if (c) {
        c.complaintCount += 1;
        if (created > c.lastComplaint) c.lastComplaint = created;
        if (!c.descriptors.includes(descriptor)) c.descriptors.push(descriptor);
        c.byDescriptor[descriptor] = (c.byDescriptor[descriptor] ?? 0) + 1;
      } else {
        clusters.push({ kind: 'P', id: `P|${id}`, lat, lon, complaintCount: 1, lastComplaint: created, descriptors: [descriptor], byDescriptor: { [descriptor]: 1 } });
      }
    } else if (kind === 'D') {
      if (created < defectSince) continue;
      defects.push({ kind: 'D', id: `D|${id}`, lat, lon, address, descriptor, created, closed });
    }
  }
  return { puddles: clusters, defects };
}

/** A New York 311 row in the shared complaint shape, or null if it is not one the app uses. */
function normalize(r) {
  const lat = Number.parseFloat(r.latitude);
  const lon = Number.parseFloat(r.longitude);
  const created = parseApiDate(r.created_date);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !created) return null;
  const kind = PUDDLE_TYPES.has(r.complaint_type) && PUDDLE_SET.has(r.descriptor) ? 'P'
    : r.complaint_type === 'Sidewalk Condition' && DEFECT_SET.has(r.descriptor) ? 'D' : null;
  if (!kind) return null;
  return {
    id: r.unique_key, kind, lat, lon, created, descriptor: r.descriptor,
    address: String(r.incident_address ?? '').replace(/\s+/g, ' ').trim(), closed: r.status === 'Closed',
  };
}

const round5 = (x) => Math.round(x * 1e5) / 1e5; // about 1 m

/**
 * Complaints in the shared shape → the JSON snapshot the browser reads, kept compact because it
 * holds a whole city's year: {generatedAt, types: [[kind, descriptor]], complaints: [[id,
 * typeIndex, lat, lon, 'YYYY-MM-DD', closed 0|1, address]]}. Only defects keep their address (the
 * puddle sheet never shows one), and each kind only within its window.
 */
export function complaintSnapshotOf(complaints, now) {
  const since = { P: monthsBefore(now, PUDDLE_WINDOW_MONTHS), D: monthsBefore(now, DEFECT_WINDOW_MONTHS) };
  const types = [];
  const typeIndex = new Map();
  const rows = [];
  for (const c of complaints) {
    if (c.created < since[c.kind]) continue;
    const type = `${c.kind}|${c.descriptor}`;
    if (!typeIndex.has(type)) {
      typeIndex.set(type, types.length);
      types.push([c.kind, c.descriptor]);
    }
    rows.push([c.id, typeIndex.get(type), round5(c.lat), round5(c.lon), isoDay(c.created), c.closed ? 1 : 0, c.kind === 'D' ? c.address : '']);
  }
  return { generatedAt: now.toISOString(), types, complaints: rows };
}

/** Snapshot → the complaints inside the survey circle, in the shared shape. */
export function complaintsFromSnapshot(snapshot, center, radiusM) {
  if (!Array.isArray(snapshot?.types) || !Array.isArray(snapshot?.complaints)) throw new RecordsUnavailableError('unexpected snapshot shape');
  const found = [];
  for (const [id, typeIndex, lat, lon, day, closed, address] of snapshot.complaints) {
    const type = snapshot.types[typeIndex];
    const created = parseApiDate(day);
    if (!type || !created || distanceM(center, { lat, lon }) > radiusM) continue;
    found.push({ id, kind: type[0], descriptor: type[1], lat, lon, created, closed: closed === 1, address });
  }
  return found;
}

/** New York 311 rows → the JSON snapshot the browser reads. */
export function toSnapshot(rows, now) {
  return complaintSnapshotOf(rows.map(normalize).filter(Boolean), now);
}

/** Snapshot → New York's puddles and defects in the survey circle. @returns {{puddles: PuddleFacts[], defects: DefectFacts[]}} */
export function complaintsAround(snapshot, center, radiusM, today) {
  return sortComplaints(complaintsFromSnapshot(snapshot, center, radiusM), today);
}

export async function fetchComplaints(center, radiusM, { fetchImpl, timeoutMs, signal } = {}) {
  const snapshot = await getRecordsJson(SNAPSHOT_URL, { fetchImpl, timeoutMs, signal });
  return complaintsAround(snapshot, center, radiusM, new Date());
}
