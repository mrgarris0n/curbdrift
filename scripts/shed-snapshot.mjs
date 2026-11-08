// Build step: download every shed and scaffold permit of a city and reduce it to the citywide
// snapshot the browser reads (see SNAPSHOT_URL in js/sources/sheds.js and sheds-chicago.js).
// Runs on each deploy; a daily cron (api/refresh-sheds.js) redeploys to keep it fresh.
// Any failure throws, which fails the build and leaves the previous deployment live.
import * as nyc from '../js/sources/sheds.js';
import * as chicago from '../js/sources/sheds-chicago.js';

const PAGE = 50000;
const TIMEOUT_MS = 120000;
const ATTEMPTS = 3;

// minStructures: far fewer active structures than usual means a broken upstream answer, and
// shipping it would silently empty the map.
export const SHED_SOURCES = {
  // ~15k active structures citywide.
  nyc: { id: 'nyc', upstream: 'https://data.cityofnewyork.us/resource/', dataset: nyc.SHED_DATASET, query: nyc.snapshotQuery, toSnapshot: nyc.toSnapshot, minStructures: 3000 },
  // ~290 active structures citywide (2026-11).
  chicago: { id: 'chicago', upstream: 'https://data.cityofchicago.org/resource/', dataset: chicago.CHICAGO_SHED_DATASET, query: chicago.snapshotQuery, toSnapshot: chicago.toSnapshot, minStructures: 100 },
};

async function fetchPage(url, headers, fetchImpl, retryDelayMs) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = await res.json();
      if (!Array.isArray(rows)) throw new Error('unexpected response shape');
      return rows;
    } catch (err) {
      if (attempt >= ATTEMPTS) throw new Error(`shed snapshot: ${url} failed: ${err.message}`);
      await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
    }
  }
}

export async function buildShedSnapshot(source, { token = process.env.SOCRATA_APP_TOKEN ?? '', fetchImpl = globalThis.fetch, now = new Date(), retryDelayMs = 5000, minStructures = source.minStructures } = {}) {
  const headers = { accept: 'application/json' };
  if (token) headers['X-App-Token'] = token;
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const params = new URLSearchParams({ ...source.query(), $limit: String(PAGE), $offset: String(offset) });
    const page = await fetchPage(`${source.upstream}${source.dataset}.json?${params}`, headers, fetchImpl, retryDelayMs);
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  const snapshot = source.toSnapshot(rows, now);
  if (snapshot.sheds.length < minStructures) {
    throw new Error(`${source.id} shed snapshot: only ${snapshot.sheds.length} active structures from ${rows.length} permits, refusing to publish`);
  }
  return { snapshot, permits: rows.length };
}
