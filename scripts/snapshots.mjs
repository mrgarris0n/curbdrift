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
const TIMEOUT_MS = 120000;
const ATTEMPTS = 3;

const NYC = 'https://data.cityofnewyork.us/resource/';
const CHICAGO = 'https://data.cityofchicago.org/resource/';
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

async function fetchPage(url, headers, fetchImpl, retryDelayMs) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = await res.json();
      if (!Array.isArray(rows)) throw new Error('unexpected response shape');
      return rows;
    } catch (err) {
      if (attempt >= ATTEMPTS) throw new Error(`${url} failed: ${err.message}`);
      await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
    }
  }
}

export async function buildSnapshot(source, { token = process.env.SOCRATA_APP_TOKEN ?? '', fetchImpl = globalThis.fetch, now = new Date(), retryDelayMs = 5000, min = source.min } = {}) {
  const headers = { accept: 'application/json' };
  if (token) headers['X-App-Token'] = token;
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const params = new URLSearchParams({ ...source.query(now), $limit: String(PAGE), $offset: String(offset) });
    const page = await fetchPage(`${source.upstream}${source.dataset}.json?${params}`, headers, fetchImpl, retryDelayMs);
    rows.push(...page);
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
