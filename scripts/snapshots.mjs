// Build step: download a city's records from its Socrata portal and reduce them to the static
// snapshot the browser reads (shed structures, 311 complaints; see each source's SNAPSHOT_URL).
// Runs on each deploy; a daily cron (api/refresh-sheds.js) redeploys to keep them fresh.
// A snapshot that cannot be built is replaced by the copy production serves now, so one slow or
// failing portal doesn't hold up the others; with no such copy either, the build fails and the
// previous deployment stays live.
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

const NYC = 'https://data.cityofnewyork.us';
const CHICAGO = 'https://data.cityofchicago.org';
const sheds = (snapshot) => snapshot.sheds.length;
const complaints = (snapshot) => snapshot.complaints.length;

// file: served at /data/<file> (the source's SNAPSHOT_URL). min: far fewer items than usual means
// a broken upstream answer, and shipping it would silently empty the map.
export const SOURCES = [
  // ~15k active structures citywide.
  { id: 'nyc sheds', file: 'sheds.json', upstream: NYC, dataset: nycSheds.SHED_DATASET, query: nycSheds.snapshotQuery, toSnapshot: nycSheds.toSnapshot, count: sheds, min: 3000 },
  // ~290 active structures citywide (2026-11).
  { id: 'chicago sheds', file: 'sheds-chicago.json', upstream: CHICAGO, dataset: chicagoSheds.CHICAGO_SHED_DATASET, query: chicagoSheds.snapshotQuery, toSnapshot: chicagoSheds.toSnapshot, count: sheds, min: 100 },
  { id: 'nyc complaints', file: 'complaints.json', upstream: NYC, dataset: nycComplaints.DATASET, query: nycComplaints.snapshotQuery, toSnapshot: nycComplaints.toSnapshot, count: complaints, min: 5000 },
  // ~45k a year (2026-11).
  { id: 'chicago complaints', file: 'complaints-chicago.json', upstream: CHICAGO, dataset: chicagoComplaints.CHICAGO_311_DATASET, query: chicagoComplaints.snapshotQuery, toSnapshot: chicagoComplaints.toSnapshot, count: complaints, min: 10000 },
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
 * buildSnapshot, or else the snapshot production serves now (host: the production domain, which
 * Vercel builds see as VERCEL_PROJECT_PRODUCTION_URL). Throws when neither is available.
 * @returns {Promise<{snapshot: object, rows: number | null}>} rows is null for the production copy
 */
export async function snapshotOrLiveCopy(source, { host = process.env.VERCEL_PROJECT_PRODUCTION_URL, fetchImpl = globalThis.fetch, ...opts } = {}) {
  try {
    return await buildSnapshot(source, { fetchImpl, ...opts });
  } catch (err) {
    if (!host) throw err;
    console.warn(`build: ${source.id}: ${err.message}; keeping production's copy`);
    try {
      const res = await fetchImpl(`https://${host}/data/${source.file}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const snapshot = await res.json();
      source.count(snapshot); // throws on a malformed copy
      return { snapshot, rows: null };
    } catch (copyErr) {
      throw new Error(`${source.id}: ${err.message}; production's copy unavailable too: ${copyErr.message}`);
    }
  }
}
