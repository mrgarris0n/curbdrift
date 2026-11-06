import { socrataQuery } from './socrata.js';
import { bboxAround, distanceM } from '../geo.js';
import { SHED_GAP_DAYS } from '../config.js';
import { parseApiDate, DAY_MS } from '../dates.js';

// DOB NOW: Build – Approved Permits. (Not 8586-3zfm, which is school construction.)
const DATASET = 'rbx6-tga4';
const WORK_TYPES = ['Sidewalk Shed', 'Supported Scaffold', 'Suspended Scaffold'];

/** @typedef {{kind:'S', id:string, lat:number, lon:number, address:string, workType:string,
 *   chainStart:Date, renewals:number, latestExpiry:Date, owner:string, contractor:string,
 *   description:string}} ShedFacts */

export function buildShedParams(center, radiusM) {
  const b = bboxAround(center, radiusM);
  const types = WORK_TYPES.map((t) => `'${t}'`).join(',');
  return {
    $select: 'bin,house_no,street_name,borough,work_type,issued_date,expired_date,permit_status,latitude,longitude,owner_business_name,applicant_business_name,job_description',
    $where: `work_type in(${types}) AND latitude between ${b.south.toFixed(6)} and ${b.north.toFixed(6)} AND longitude between ${b.west.toFixed(6)} and ${b.east.toFixed(6)}`,
    $limit: '10000',
  };
}

function normalize(row) {
  const lat = Number.parseFloat(row.latitude);
  const lon = Number.parseFloat(row.longitude);
  const issued = parseApiDate(row.issued_date);
  const expired = parseApiDate(row.expired_date);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !issued || !expired || !row.bin || !row.work_type) return null;
  return { row, lat, lon, issued, expired };
}

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Collapse yearly permits into structures. A structure is one bin + work type; it is
 * active when its latest permit has not expired and was not signed off (signed-off = removed).
 * Its age is the start of the unbroken permit chain ending at the latest permit, where
 * permits less than SHED_GAP_DAYS apart (or overlapping) count as continuous.
 * @returns {ShedFacts[]}
 */
export function groupShedPermits(rows, today) {
  const groups = new Map();
  for (const r of rows) {
    const p = normalize(r);
    if (!p) continue;
    const key = `${r.bin}|${r.work_type}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  const items = [];
  for (const [key, permits] of groups) {
    permits.sort((a, b) => a.issued - b.issued || a.expired - b.expired);
    const latest = permits.reduce((best, p) => (p.expired > best.expired || (+p.expired === +best.expired && p.issued > best.issued) ? p : best));
    if (latest.expired < today || latest.row.permit_status === 'Signed-off') continue;

    // coveredUntil[i] = latest expiry among permits[0..i-1], i.e. how long the structure was
    // already covered when permit i was issued. Walk backward while that gap stays small.
    const coveredUntil = [];
    let maxExp = -Infinity;
    for (const p of permits) {
      coveredUntil.push(maxExp);
      maxExp = Math.max(maxExp, +p.expired);
    }
    let i = permits.length - 1;
    while (i > 0 && (permits[i].issued - coveredUntil[i]) / DAY_MS < SHED_GAP_DAYS) i -= 1;
    const chain = permits.slice(i);
    const chainStart = chain[0].issued; // sorted by issued, so the first is earliest
    // Permits issued the same day are parallel structures, not renewals.
    const renewals = new Set(chain.map((p) => +p.issued)).size - 1;

    const r = latest.row;
    items.push({
      kind: 'S',
      id: key,
      lat: latest.lat,
      lon: latest.lon,
      address: clean(`${r.house_no ?? ''} ${r.street_name ?? ''}`),
      workType: r.work_type,
      chainStart,
      renewals,
      latestExpiry: latest.expired,
      owner: clean(r.owner_business_name),
      contractor: clean(r.applicant_business_name),
      description: clean(r.job_description),
    });
  }
  return items;
}

/** @returns {Promise<ShedFacts[]>} */
export async function fetchSheds(center, radiusM, opts) {
  const rows = await socrataQuery(DATASET, buildShedParams(center, radiusM), opts);
  // The query is a bounding box; trim its corners to the survey circle.
  return groupShedPermits(rows, new Date()).filter((s) => distanceM(center, s) <= radiusM);
}
