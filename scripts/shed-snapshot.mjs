// Build step: download every shed and scaffold permit from NYC Open Data and reduce it to
// the citywide snapshot the browser reads (see SNAPSHOT_URL in js/sources/sheds.js).
// Runs on each deploy; a daily cron (api/refresh-sheds.js) redeploys to keep it fresh.
// Any failure throws, which fails the build and leaves the previous deployment live.
import { SHED_DATASET, snapshotQuery, toSnapshot } from '../js/sources/sheds.js';

const UPSTREAM = 'https://data.cityofnewyork.us/resource/';
const PAGE = 50000;
const TIMEOUT_MS = 120000;
const ATTEMPTS = 3;
// Citywide there are ~15k active structures. Far fewer means a broken upstream answer,
// and shipping it would silently empty the map.
const MIN_STRUCTURES = 3000;

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

export async function buildShedSnapshot({ token = process.env.SOCRATA_APP_TOKEN ?? '', fetchImpl = globalThis.fetch, now = new Date(), retryDelayMs = 5000, minStructures = MIN_STRUCTURES } = {}) {
  const headers = { accept: 'application/json' };
  if (token) headers['X-App-Token'] = token;
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const params = new URLSearchParams({ ...snapshotQuery(), $limit: String(PAGE), $offset: String(offset) });
    const page = await fetchPage(`${UPSTREAM}${SHED_DATASET}.json?${params}`, headers, fetchImpl, retryDelayMs);
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  const snapshot = toSnapshot(rows, now);
  if (snapshot.sheds.length < minStructures) {
    throw new Error(`shed snapshot: only ${snapshot.sheds.length} active structures from ${rows.length} permits, refusing to publish`);
  }
  return { snapshot, permits: rows.length };
}
