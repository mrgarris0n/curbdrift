import { SOCRATA_APP_TOKEN, CACHE_TTL_MS } from '../config.js';

const BASE = 'https://data.cityofnewyork.us/resource/';
// The 311 radius query alone measured ~7 s; past this the records office is treated as unavailable.
const REQUEST_TIMEOUT_MS = 30000;

/** The records office (NYC Open Data) could not be reached or refused the request. */
export class RecordsUnavailableError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = 'RecordsUnavailableError';
    this.status = status;
  }
}

function defaultStorage() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null; // access itself can throw when site data is blocked
  }
}

function readCache(storage, key, now) {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const { t, rows } = JSON.parse(raw);
    return now - t < CACHE_TTL_MS && Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

function writeCache(storage, key, now, rows) {
  try {
    storage?.setItem(key, JSON.stringify({ t: now, rows }));
  } catch {
    // quota or privacy mode: run uncached
  }
}

/** Query a NYC Open Data (Socrata) dataset. Resolves to the row array. */
export async function socrataQuery(datasetId, params, { fetchImpl = globalThis.fetch, storage = defaultStorage(), now = Date.now, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const url = `${BASE}${datasetId}.json?${new URLSearchParams(params)}`;
  const t = now();
  const cached = readCache(storage, url, t);
  if (cached) return cached;

  const headers = SOCRATA_APP_TOKEN ? { 'X-App-Token': SOCRATA_APP_TOKEN } : {};
  let res;
  try {
    res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new RecordsUnavailableError(`network failure: ${err?.message ?? err}`);
  }
  if (!res.ok) throw new RecordsUnavailableError(`HTTP ${res.status}`, res.status);

  let rows;
  try {
    rows = await res.json();
  } catch {
    throw new RecordsUnavailableError('unreadable response', res.status);
  }
  if (!Array.isArray(rows)) throw new RecordsUnavailableError('unexpected response shape', res.status);

  writeCache(storage, url, t, rows);
  return rows;
}
