import { getRecordsJson, RecordsUnavailableError } from './socrata.js';
import { distanceM } from '../geo.js';
import { SHED_GAP_DAYS } from '../config.js';
import { parseApiDate, isoDay, DAY_MS } from '../dates.js';

// DOB NOW: Build – Approved Permits. (Not 8586-3zfm, which is school construction.)
export const SHED_DATASET = 'rbx6-tga4';
const WORK_TYPES = ['Sidewalk Shed', 'Supported Scaffold', 'Suspended Scaffold'];

// The permits change once a day, so the deploy build turns them into one citywide snapshot
// (scripts/snapshots.mjs) and the browser reads that static file instead of the API.
export const SNAPSHOT_URL = '/data/sheds.json';

/** @typedef {{kind:'S', id:string, lat:number, lon:number, address:string, workType:string,
 *   chainStart:Date, renewals:number, latestExpiry:Date, owner:string, contractor:string}} ShedFacts */

/** The citywide permit query behind the snapshot (paged by the caller). Only fields the app shows. */
export function snapshotQuery() {
  const types = WORK_TYPES.map((t) => `'${t}'`).join(',');
  return {
    $select: 'bin,job_filing_number,house_no,street_name,work_type,issued_date,expired_date,permit_status,latitude,longitude,owner_business_name,applicant_business_name',
    $where: `work_type in(${types})`,
    $order: ':id',
  };
}

function normalize(row) {
  const lat = Number.parseFloat(row.latitude);
  const lon = Number.parseFloat(row.longitude);
  const issued = parseApiDate(row.issued_date);
  const expired = parseApiDate(row.expired_date);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !issued || !expired || !row.bin || !row.work_type) return null;
  return {
    key: `${row.bin}|${row.work_type}`, job: row.job_filing_number, issued, expired,
    ended: row.permit_status === 'Signed-off', lat, lon, row,
  };
}

export const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Collapse permits into structures; every city's permits are normalised to this shape first:
 * {key, job, issued, expired, ended, lat, lon, row}. A structure is one key; it is active when
 * any of its jobs' latest permit has not expired and has not ended (signed off / taken down).
 * Its age is the start of the unbroken permit chain ending at the latest permit, where permits
 * less than SHED_GAP_DAYS apart (or overlapping) count as continuous. describe(latest) adds the
 * city-specific facts: {address, workType, owner, contractor}.
 * @returns {ShedFacts[]}
 */
export function chainStructures(permits, today, describe) {
  const groups = new Map();
  for (const p of permits) {
    if (!groups.has(p.key)) groups.set(p.key, []);
    groups.get(p.key).push(p);
  }

  const items = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => a.issued - b.issued || a.expired - b.expired);
    // A building can have several jobs at once; each is up until its own latest permit
    // expires or ends, so one finished job must not hide another.
    const jobLatest = new Map();
    for (const p of list) {
      const best = jobLatest.get(p.job);
      if (!best || p.expired > best.expired || (+p.expired === +best.expired && p.issued > best.issued)) jobLatest.set(p.job, p);
    }
    const active = [...jobLatest.values()].filter((p) => p.expired >= today && !p.ended);
    if (active.length === 0) continue;
    const latest = active.reduce((best, p) => (p.expired > best.expired || (+p.expired === +best.expired && p.issued > best.issued) ? p : best));

    // coveredUntil[i] = latest expiry among permits[0..i-1], i.e. how long the structure was
    // already covered when permit i was issued. Walk backward while that gap stays small.
    const coveredUntil = [];
    let maxExp = -Infinity;
    for (const p of list) {
      coveredUntil.push(maxExp);
      maxExp = Math.max(maxExp, +p.expired);
    }
    let i = list.length - 1;
    while (i > 0 && (list[i].issued - coveredUntil[i]) / DAY_MS < SHED_GAP_DAYS) i -= 1;
    const chain = list.slice(i);
    const chainStart = chain[0].issued; // sorted by issued, so the first is earliest
    // Permits issued the same day are parallel structures, not renewals.
    const renewals = new Set(chain.map((p) => +p.issued)).size - 1;

    items.push({
      kind: 'S', id: key, lat: latest.lat, lon: latest.lon,
      chainStart, renewals, latestExpiry: latest.expired, ...describe(latest),
    });
  }
  return items;
}

/** New York DOB NOW permits → structures (one per building and work type). @returns {ShedFacts[]} */
export function groupShedPermits(rows, today) {
  return chainStructures(rows.map(normalize).filter(Boolean), today, ({ row: r }) => ({
    address: clean(`${r.house_no ?? ''} ${r.street_name ?? ''}`),
    workType: r.work_type,
    owner: clean(r.owner_business_name),
    contractor: clean(r.applicant_business_name),
  }));
}

/** Structures → the JSON snapshot the browser reads. Dates become UTC days. */
export function snapshotOf(structures, now) {
  const sheds = structures.map(({ kind, chainStart, latestExpiry, ...rest }) => ({
    ...rest,
    chainStart: isoDay(chainStart),
    latestExpiry: isoDay(latestExpiry),
  }));
  return { generatedAt: now.toISOString(), sheds };
}

/** New York permit rows → the JSON snapshot the browser reads. */
export function toSnapshot(rows, now) {
  return snapshotOf(groupShedPermits(rows, parseApiDate(isoDay(now))), now);
}

/** Snapshot → the structures inside the survey circle still permitted on `today`. @returns {ShedFacts[]} */
export function shedsFromSnapshot(snapshot, center, radiusM, today) {
  if (!Array.isArray(snapshot?.sheds)) throw new RecordsUnavailableError('unexpected snapshot shape');
  const items = [];
  for (const s of snapshot.sheds) {
    const chainStart = parseApiDate(s.chainStart);
    const latestExpiry = parseApiDate(s.latestExpiry);
    // The snapshot can be up to a day old; drop permits that ran out since it was made.
    if (!chainStart || !latestExpiry || latestExpiry < today) continue;
    if (distanceM(center, s) > radiusM) continue;
    items.push({ ...s, kind: 'S', chainStart, latestExpiry });
  }
  return items;
}

/** Read a city's static shed snapshot and keep the structures in the survey circle. @returns {Promise<ShedFacts[]>} */
export async function fetchShedSnapshot(url, center, radiusM, { fetchImpl, timeoutMs, signal } = {}) {
  const snapshot = await getRecordsJson(url, { fetchImpl, timeoutMs, signal });
  // Expiry is a calendar day: a permit expiring today still counts today.
  return shedsFromSnapshot(snapshot, center, radiusM, parseApiDate(isoDay(new Date())));
}

/** @returns {Promise<ShedFacts[]>} */
export function fetchSheds(center, radiusM, opts) {
  return fetchShedSnapshot(SNAPSHOT_URL, center, radiusM, opts);
}
