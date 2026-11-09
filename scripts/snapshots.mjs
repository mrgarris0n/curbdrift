// Build step: download a city's records from its Socrata portal and reduce them to the static
// snapshot the browser reads (shed structures, 311 complaints; see each source's SNAPSHOT_URL).
// A daily cron (api/refresh-sheds.js) redeploys to keep them fresh. Other builds (code deploys,
// previews) reuse what production serves when it is recent and of the same version, so they don't
// wait on Socrata; see snapshotFor. A snapshot that cannot be built falls back to production's copy
// of the same version, so one slow or failing portal doesn't hold up the others; with no such copy
// either, the build fails and the previous deployment stays live.
import { createHash } from 'node:crypto';
import * as nycSheds from '../js/sources/sheds.js';
import * as chicagoSheds from '../js/sources/sheds-chicago.js';
import * as nycComplaints from '../js/sources/complaints.js';
import * as chicagoComplaints from '../js/sources/complaints-chicago.js';

const PAGE = 50000;
// A slow citywide query can take Socrata minutes (Chicago 311 on 2026-11-09: over 120 s, 4 times
// in a row); SODA 3 itself allows 600 s. Attempts × this stays well inside a 45-minute build.
const TIMEOUT_MS = 300000;
// Socrata refuses (503/429) in bursts of a minute or more; wait them out before giving up.
const ATTEMPTS = 4;

// Production's copy is reused when younger than this. The cron rebuilds every 24 h, so its build
// always finds the copy older and downloads; a code deploy within 12 h of a download reuses it.
// Worst case (a download late in the day, then the next cron reuses it) the data is 36 h old.
export const REUSE_MAX_AGE_MS = 12 * 3600 * 1000;

const NYC = 'https://data.cityofnewyork.us';
const CHICAGO = 'https://data.cityofchicago.org';
const sheds = (snapshot) => snapshot.sheds.length;
const complaints = (snapshot) => snapshot.complaints.length;

// file: served at /data/<file> (the source's SNAPSHOT_URL). min: far fewer items than usual means
// a broken upstream answer, and shipping it would silently empty the map.
export const SOURCES = [
  // ~15k active structures citywide.
  { id: 'nyc sheds', file: 'sheds.json', upstream: NYC, dataset: nycSheds.SHED_DATASET, query: nycSheds.snapshotQuery, toSnapshot: nycSheds.toSnapshot, format: nycSheds.SNAPSHOT_FORMAT, count: sheds, min: 3000 },
  // ~290 active structures citywide (2026-11).
  { id: 'chicago sheds', file: 'sheds-chicago.json', upstream: CHICAGO, dataset: chicagoSheds.CHICAGO_SHED_DATASET, query: chicagoSheds.snapshotQuery, toSnapshot: chicagoSheds.toSnapshot, format: chicagoSheds.SNAPSHOT_FORMAT, count: sheds, min: 100 },
  { id: 'nyc complaints', file: 'complaints.json', upstream: NYC, dataset: nycComplaints.DATASET, query: nycComplaints.snapshotQuery, toSnapshot: nycComplaints.toSnapshot, format: nycComplaints.SNAPSHOT_FORMAT, count: complaints, min: 5000 },
  // ~45k a year (2026-11).
  { id: 'chicago complaints', file: 'complaints-chicago.json', upstream: CHICAGO, dataset: chicagoComplaints.CHICAGO_311_DATASET, query: chicagoComplaints.snapshotQuery, toSnapshot: chicagoComplaints.toSnapshot, format: chicagoComplaints.SNAPSHOT_FORMAT, count: complaints, min: 10000 },
];

/** A source's query ({$select, $where, $order}) as one page of a SODA 3 query request body. */
export function queryBody({ $select, $where, $order }, pageNumber) {
  return {
    query: `SELECT ${$select} WHERE ${$where} ORDER BY ${$order}`,
    page: { pageNumber, pageSize: PAGE },
    includeSynthetic: false,
    includeSystem: false,
  };
}

async function fetchPage(label, url, init, fetchImpl, retryDelayMs) {
  for (let attempt = 1; ; attempt += 1) {
    const started = Date.now();
    try {
      const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      const body = await res.text();
      const rows = JSON.parse(body);
      if (!Array.isArray(rows)) throw new Error(`unexpected response shape: ${body.slice(0, 200)}`);
      return rows;
    } catch (err) {
      if (attempt >= ATTEMPTS) throw new Error(`${label} failed: ${err.message}`);
      // A download can wait out several minutes of refusals; say so, or the build log looks hung.
      console.warn(`build: ${label}: attempt ${attempt}/${ATTEMPTS} failed after ${((Date.now() - started) / 1000).toFixed(1)} s: ${err.message}`);
      await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
    }
  }
}

// SODA 3 (POST /api/v3/views/<id>/query.json) rather than the SODA 2 GET /resource/<id>.json: on
// 2026-11-09 the old endpoint answered 429/503 or hung for minutes while the new one responded at
// once. SODA 3 requires an app token.
export async function buildSnapshot(source, { token = process.env.SOCRATA_APP_TOKEN ?? '', fetchImpl = globalThis.fetch, now = new Date(), retryDelayMs = 15000, min = source.min } = {}) {
  if (!token) throw new Error(`${source.id}: SOCRATA_APP_TOKEN is not set (SODA 3 requires an app token)`);
  const url = `${source.upstream}/api/v3/views/${source.dataset}/query.json`;
  const headers = { accept: 'application/json', 'content-type': 'application/json', 'X-App-Token': token };
  const rows = [];
  for (let pageNumber = 1; ; pageNumber += 1) {
    const init = { method: 'POST', headers, body: JSON.stringify(queryBody(source.query(now), pageNumber)) };
    const page = await fetchPage(`${source.id} page ${pageNumber}`, url, init, fetchImpl, retryDelayMs);
    rows.push(...page);
    console.log(`build: ${source.id}: ${rows.length} rows so far`);
    if (page.length < PAGE) break;
  }
  const snapshot = source.toSnapshot(rows, now);
  if (source.count(snapshot) < min) {
    throw new Error(`${source.id} snapshot: only ${source.count(snapshot)} items from ${rows.length} rows, refusing to publish`);
  }
  return { snapshot, rows: rows.length };
}

/**
 * What a snapshot was built from: the source's SNAPSHOT_FORMAT and its query (taken at a fixed
 * date, so it doesn't change daily). A copy of another version may not match this code, so it is
 * never reused.
 */
export function snapshotVersion(source) {
  const query = JSON.stringify(source.query(new Date(0)));
  return `${source.format}-${createHash('sha256').update(query).digest('hex').slice(0, 12)}`;
}

async function productionCopy(source, host, fetchImpl) {
  const res = await fetchImpl(`https://${host}/data/${source.file}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const snapshot = await res.json();
  source.count(snapshot); // throws on a malformed copy
  return snapshot;
}

/**
 * The snapshot this build ships, and where it came from:
 * - 'reused': production's copy (host: the production domain, which Vercel builds see as
 *   VERCEL_PROJECT_PRODUCTION_URL) is this version and younger than REUSE_MAX_AGE_MS;
 * - 'downloaded': otherwise, built from Socrata;
 * - 'fallback': the download failed, so production's copy of this version, whatever its age.
 * Throws when none of these is available.
 * @returns {Promise<{snapshot: object, from: 'reused'|'downloaded'|'fallback', rows?: number}>}
 */
export async function snapshotFor(source, { host = process.env.VERCEL_PROJECT_PRODUCTION_URL, fetchImpl = globalThis.fetch, now = new Date(), ...opts } = {}) {
  const version = snapshotVersion(source);
  let copy = null;
  let copyProblem = 'no production domain';
  if (host) {
    try {
      copy = await productionCopy(source, host, fetchImpl);
      if (copy.version !== version) {
        copyProblem = `production's copy is version ${copy.version ?? 'none'}, this build needs ${version}`;
        copy = null;
      }
    } catch (err) {
      copyProblem = `production's copy unavailable: ${err.message}`;
    }
  }
  if (copy && now - new Date(copy.generatedAt) < REUSE_MAX_AGE_MS) return { snapshot: copy, from: 'reused' };

  try {
    const { snapshot, rows } = await buildSnapshot(source, { fetchImpl, now, ...opts });
    return { snapshot: { ...snapshot, version }, from: 'downloaded', rows };
  } catch (err) {
    if (!copy) throw new Error(`${source.id}: ${err.message}; ${copyProblem}`);
    console.warn(`build: ${source.id}: ${err.message}; keeping production's copy of ${copy.generatedAt}`);
    return { snapshot: copy, from: 'fallback' };
  }
}
