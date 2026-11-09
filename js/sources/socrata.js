import { requestSignal } from '../net.js';

// The 311 and permit records come from each city's Socrata portal, but the browser never queries
// it: the deploy build turns them into static snapshots (scripts/snapshots.mjs) that the browser
// reads from this site. Past this wait the records office is treated as unavailable.
export const REQUEST_TIMEOUT_MS = 30000;

/** The records office (a city's open-data snapshot) could not be reached or read. */
export class RecordsUnavailableError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = 'RecordsUnavailableError';
    this.status = status;
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
