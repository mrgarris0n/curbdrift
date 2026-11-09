import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getRecordsJson, RecordsUnavailableError } from '../js/sources/socrata.js';

function fakeFetch(body, status = 200) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { impl, calls };
}

test('returns the parsed document', async () => {
  const f = fakeFetch({ a: 1 });
  assert.deepEqual(await getRecordsJson('/data/x.json', { fetchImpl: f.impl }), { a: 1 });
  assert.equal(f.calls[0].url, '/data/x.json');
});

for (const status of [404, 503]) {
  test(`${status} throws RecordsUnavailableError`, async () => {
    const f = fakeFetch({ message: 'nope' }, status);
    await assert.rejects(
      getRecordsJson('/data/x.json', { fetchImpl: f.impl }),
      (err) => err instanceof RecordsUnavailableError && err.status === status,
    );
  });
}

test('network failure throws RecordsUnavailableError', async () => {
  const impl = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(
    getRecordsJson('/data/x.json', { fetchImpl: impl }),
    (err) => err instanceof RecordsUnavailableError && err.status === null,
  );
});

test('unreadable JSON throws RecordsUnavailableError', async () => {
  const impl = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } });
  await assert.rejects(getRecordsJson('/data/x.json', { fetchImpl: impl }), RecordsUnavailableError);
});

test('a request that never answers times out as RecordsUnavailableError', async () => {
  const impl = (url, init) => new Promise((_, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal.reason));
  });
  await assert.rejects(
    getRecordsJson('/data/x.json', { fetchImpl: impl, timeoutMs: 50 }),
    (err) => err instanceof RecordsUnavailableError && err.status === null,
  );
});

test('a cancelled survey cancels its request', async () => {
  const outer = new AbortController();
  const impl = (url, init) => new Promise((_, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal.reason));
  });
  const pending = getRecordsJson('/data/x.json', { fetchImpl: impl, timeoutMs: 10000, signal: outer.signal });
  outer.abort();
  // Promptly — not when the 10 s timeout eventually fires.
  const tooSlow = new Promise((_, reject) => setTimeout(() => reject(new Error('not cancelled')), 500));
  await assert.rejects(Promise.race([pending, tooSlow]), RecordsUnavailableError);
});
