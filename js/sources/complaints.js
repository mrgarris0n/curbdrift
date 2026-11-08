import { socrataQuery } from './socrata.js';
import { distanceM } from '../geo.js';
import { PUDDLE_WINDOW_MONTHS, DEFECT_WINDOW_MONTHS } from '../config.js';
import { parseApiDate, isoDay, monthsBefore } from '../dates.js';

// NYC 311 Service Requests.
const DATASET = 'erm2-nwe9';
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

/** One query for both kinds over the longer (puddle) window. */
export function buildComplaintParams(center, radiusM, today) {
  const since = isoDay(monthsBefore(today, PUDDLE_WINDOW_MONTHS));
  const descriptors = [...PUDDLE_DESCRIPTORS, ...DEFECT_DESCRIPTORS].map(quote).join(',');
  return {
    $select: 'unique_key,complaint_type,descriptor,created_date,status,incident_address,latitude,longitude',
    $where: `within_circle(location, ${center.lat}, ${center.lon}, ${radiusM}) AND created_date > '${since}' AND complaint_type in('Sewer','Sewer Maintenance','Sidewalk Condition') AND descriptor in(${descriptors})`,
    $limit: '2000',
  };
}

/** @returns {{puddles: PuddleFacts[], defects: DefectFacts[]}} */
export function splitComplaints(rows, today) {
  const puddleSince = monthsBefore(today, PUDDLE_WINDOW_MONTHS);
  const defectSince = monthsBefore(today, DEFECT_WINDOW_MONTHS);
  const clusters = [];
  const defects = [];

  for (const r of rows) {
    const lat = Number.parseFloat(r.latitude);
    const lon = Number.parseFloat(r.longitude);
    const created = parseApiDate(r.created_date);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !created) continue;

    if (PUDDLE_TYPES.has(r.complaint_type) && PUDDLE_SET.has(r.descriptor)) {
      if (created < puddleSince) continue;
      // Greedy clustering: join the first cluster whose anchor point is within CLUSTER_M.
      const here = { lat, lon };
      const c = clusters.find((k) => distanceM(k, here) <= CLUSTER_M);
      if (c) {
        c.complaintCount += 1;
        if (created > c.lastComplaint) c.lastComplaint = created;
        if (!c.descriptors.includes(r.descriptor)) c.descriptors.push(r.descriptor);
        c.byDescriptor[r.descriptor] = (c.byDescriptor[r.descriptor] ?? 0) + 1;
      } else {
        clusters.push({ kind: 'P', id: `P|${r.unique_key}`, lat, lon, complaintCount: 1, lastComplaint: created, descriptors: [r.descriptor], byDescriptor: { [r.descriptor]: 1 } });
      }
    } else if (r.complaint_type === 'Sidewalk Condition' && DEFECT_SET.has(r.descriptor)) {
      if (created < defectSince) continue;
      defects.push({
        kind: 'D',
        id: `D|${r.unique_key}`,
        lat,
        lon,
        address: String(r.incident_address ?? '').replace(/\s+/g, ' ').trim(),
        descriptor: r.descriptor,
        created,
        closed: r.status === 'Closed',
      });
    }
  }
  return { puddles: clusters, defects };
}

export async function fetchComplaints(center, radiusM, opts) {
  const today = new Date();
  const rows = await socrataQuery(DATASET, buildComplaintParams(center, radiusM, today), opts);
  return splitComplaints(rows, today);
}
