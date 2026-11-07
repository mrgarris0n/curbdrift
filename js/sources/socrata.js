import { CACHE_TTL_MS } from '../config.js';
import { requestSignal } from '../net.js';

// Our own proxy (api/socrata.js) forwards to NYC Open Data and adds the app token server-side.
const PROXY = '/api/socrata';
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

/** GET a JSON document from the records office; every failure becomes RecordsUnavailableError. */
export async function getRecordsJson(url, { fetchImpl = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS, signal } = {}) {
  let res;
  try {
    res = await fetchImpl(url, { signal: requestSignal(timeoutMs, signal) });
  } catch (err) {
    throw new RecordsUnavailableError(`network failure: ${err?.message ?? err}`);
  }
  if (!res.ok) throw new RecordsUnavailableError(`HTTP ${res.status}`, res.status);

  try {
    return await res.json();
  } catch {
    throw new RecordsUnavailableError('unreadable response', res.status);
  }
}

/** Query a NYC Open Data (Socrata) dataset. Resolves to the row array. */
export async function socrataQuery(datasetId, params, { storage = defaultStorage(), now = Date.now, ...opts } = {}) {
  const url = `${PROXY}?${new URLSearchParams({ dataset: datasetId, ...params })}`;
  const t = now();
  const cached = readCache(storage, url, t);
  if (cached) return cached;

  const rows = await getRecordsJson(url, opts);
  if (!Array.isArray(rows)) throw new RecordsUnavailableError('unexpected response shape');

  writeCache(storage, url, t, rows);
  return rows;
}
