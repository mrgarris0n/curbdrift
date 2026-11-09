// Chicago puddles and sidewalk defects, from the City of Chicago's 311 Service Requests.
// Sorted by the same code as New York's (see sortComplaints), with Chicago's own query, row format
// and a wider cluster radius plus an evidence floor (see CLUSTER_M below). Duplicate reports (duplicate=true) are kept: they are repeat reports
// at a location, which is what New York's repeat-complaint count measures too.
import { getRecordsJson } from './socrata.js';
import { sortComplaints, complaintSnapshotOf, complaintsFromSnapshot } from './complaints.js';
import { weightedComplaints } from '../scoring.js';
import { parseApiDate, isoDay, monthsBefore } from '../dates.js';
import { PUDDLE_WINDOW_MONTHS } from '../config.js';

export const CHICAGO_311_DATASET = 'v6vf-nfxy';
// Built daily like New York's (see SNAPSHOT_URL in complaints.js).
export const SNAPSHOT_URL = '/data/complaints-chicago.json';
// Bump when toSnapshot's output changes for the same rows (tests/snapshot-format.test.js notices):
// builds reuse production's snapshot only if it was made with the same format (scripts/snapshots.mjs).
export const SNAPSHOT_FORMAT = 1;

// Request types that concentrate on rain days (weights in js/scoring.js, from
// scripts/calibrate-puddles.py). "Water in Basement Complaint" is rain-driven too, but indoors.
export const PUDDLE_TYPES = Object.freeze(new Set([
  'Water On Street Complaint',
  'Alley Sewer Inspection Request',
  'Sewer Cleaning Inspection Request',
  'Sewer Cave-In Inspection Request',
]));
export const DEFECT_TYPES = Object.freeze(new Set(['Sidewalk Inspection Request']));

// Chicago's 311 data is 3–5× denser than New York's (Wicker Park: 47 clusters in one survey at
// 30 m, labels piled up), so its puddles cluster at about a block, like the flood-only spacing,
// and a cluster needs at least one full weighted complaint (a lone Sewer Cave-In report, 0.2,
// is not a puddle). Wicker Park 47 → 19, the Loop 28 → 15.
const CLUSTER_M = 100;
const MIN_WEIGHTED = 1;

const quote = (s) => `'${s.replace(/'/g, "''")}'`;

/** The citywide query behind the snapshot (paged by the caller): both kinds over the longer (puddle) window. */
export function snapshotQuery(now) {
  const since = isoDay(monthsBefore(now, PUDDLE_WINDOW_MONTHS));
  const types = [...PUDDLE_TYPES, ...DEFECT_TYPES].map(quote).join(',');
  return {
    $select: 'sr_number,sr_type,created_date,status,street_address,latitude,longitude',
    $where: `created_date > '${since}' AND sr_type in(${types})`,
    $order: ':id',
  };
}

/** A Chicago 311 row in the shared complaint shape, or null if it is not one the app uses. */
function normalize(r) {
  const lat = Number.parseFloat(r.latitude);
  const lon = Number.parseFloat(r.longitude);
  const created = parseApiDate(r.created_date);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !created) return null;
  const kind = PUDDLE_TYPES.has(r.sr_type) ? 'P' : DEFECT_TYPES.has(r.sr_type) ? 'D' : null;
  if (!kind) return null;
  return {
    id: r.sr_number, kind, lat, lon, created, descriptor: r.sr_type,
    address: String(r.street_address ?? '').replace(/\s+/g, ' ').trim(), closed: r.status === 'Completed',
  };
}

/** Chicago 311 rows → the JSON snapshot the browser reads. */
export function toSnapshot(rows, now) {
  return complaintSnapshotOf(rows.map(normalize).filter(Boolean), now);
}

/** Snapshot → Chicago's puddles and defects in the survey circle. */
export function complaintsAround(snapshot, center, radiusM, today) {
  const { puddles, defects } = sortComplaints(complaintsFromSnapshot(snapshot, center, radiusM), today, { clusterM: CLUSTER_M });
  return { puddles: puddles.filter((p) => weightedComplaints(p.byDescriptor) >= MIN_WEIGHTED), defects };
}

export async function fetchComplaints(center, radiusM, { fetchImpl, timeoutMs, signal } = {}) {
  const snapshot = await getRecordsJson(SNAPSHOT_URL, { fetchImpl, timeoutMs, signal });
  return complaintsAround(snapshot, center, radiusM, new Date());
}
