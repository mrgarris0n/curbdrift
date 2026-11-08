// Chicago scaffolds, from the City of Chicago's Building Permits. Chained exactly like New York's
// sheds (see chainStructures); only the query and the row format are Chicago's own.
import { chainStructures, snapshotOf, fetchShedSnapshot, clean } from './sheds.js';
import { parseApiDate, isoDay, DAY_MS } from '../dates.js';

export const CHICAGO_SHED_DATASET = 'ydr8-5enu';
export const SNAPSHOT_URL = '/data/sheds-chicago.json';

// "PERMIT - SCAFFOLDING" until 2023, then express permits for "TEMPORARY SCAFFOLDING… PERMIT
// EXPIRATION DATE: 365 DAYS FROM PERMIT ISSUED DATE". Older permits state a one-year range in
// their text (97.6% run 300–400 days), so both are taken as issue date + 365 days.
const PERMIT_DAYS = 365;
// Express permits also cover lights and wiring on scaffolds; only the scaffold itself counts.
const WHERE = "issue_date >= '2017-01-01' AND (permit_type='PERMIT - SCAFFOLDING' OR "
  + "(permit_type='PERMIT – EXPRESS PERMIT PROGRAM' AND upper(work_description) like '%TEMPORARY SCAFFOLD%'))";
const CONTACTS = [1, 2, 3, 4, 5];

/** The citywide permit query behind the snapshot (paged by the caller). Only fields the app uses. */
export function snapshotQuery() {
  return {
    $select: ['permit_', 'permit_type', 'issue_date', 'permit_status', 'street_number', 'street_direction', 'street_name',
      'latitude', 'longitude', ...CONTACTS.flatMap((i) => [`contact_${i}_type`, `contact_${i}_name`])].join(','),
    $where: WHERE,
    $order: ':id',
  };
}

const address = (r) => clean(`${r.street_number ?? ''} ${r.street_direction ?? ''} ${r.street_name ?? ''}`).toUpperCase();
// The first contact whose type mentions the role ("OWNER", "OWNER AS GENERAL CONTRACTOR", …).
const contact = (r, role) => clean(r[`contact_${CONTACTS.find((i) => (r[`contact_${i}_type`] ?? '').includes(role))}_name`]);

function normalize(row) {
  const lat = Number.parseFloat(row.latitude);
  const lon = Number.parseFloat(row.longitude);
  const issued = parseApiDate(row.issue_date);
  const key = address(row);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !issued || !key) return null;
  // Chicago has no building id, so the address is the structure; each permit is its own job.
  // COMPLETE inside the permit's year means the scaffold came down early (the field lags otherwise).
  return {
    key, job: row.permit_, issued, expired: new Date(+issued + PERMIT_DAYS * DAY_MS),
    ended: row.permit_status === 'COMPLETE', lat, lon, row,
  };
}

/** Chicago permit rows → structures. @returns {import('./sheds.js').ShedFacts[]} */
export function groupChicagoPermits(rows, today) {
  return chainStructures(rows.map(normalize).filter(Boolean), today, ({ key, row }) => ({
    address: key,
    workType: 'Scaffold',
    owner: contact(row, 'OWNER'),
    contractor: contact(row, 'CONTRACTOR'),
  }));
}

/** Chicago permit rows → the JSON snapshot the browser reads (same shape as New York's). */
export function toSnapshot(rows, now) {
  return snapshotOf(groupChicagoPermits(rows, parseApiDate(isoDay(now))), now);
}

export function fetchSheds(center, radiusM, opts) {
  return fetchShedSnapshot(SNAPSHOT_URL, center, radiusM, opts);
}
