import { test } from 'node:test';
import assert from 'node:assert/strict';
import { socrataQuery, RecordsUnavailableError } from '../js/sources/socrata.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

function fakeFetch(body, status = 200) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { impl, calls };
}

test('returns rows and caches', async () => {
  const f = fakeFetch([{ a: 1 }]);
  const opts = { fetchImpl: f.impl, storage: memoryStorage(), now: () => 1000 };
  assert.deepEqual(await socrataQuery('abcd-1234', { $limit: '1' }, opts), [{ a: 1 }]);
  assert.deepEqual(await socrataQuery('abcd-1234', { $limit: '1' }, opts), [{ a: 1 }]);
  assert.equal(f.calls.length, 1);
});

test('cache expires', async () => {
  const f = fakeFetch([{ a: 1 }]);
  const storage = memoryStorage();
  let t = 1000;
  const opts = { fetchImpl: f.impl, storage, now: () => t };
  await socrataQuery('abcd-1234', {}, opts);
  t += 300001;
  await socrataQuery('abcd-1234', {}, opts);
  assert.equal(f.calls.length, 2);
});

for (const status of [429, 503]) {
  test(`${status} throws RecordsUnavailableError`, async () => {
    const f = fakeFetch({ message: 'nope' }, status);
    await assert.rejects(
      socrataQuery('abcd-1234', {}, { fetchImpl: f.impl, storage: null }),
      (err) => err instanceof RecordsUnavailableError && err.status === status,
    );
  });
}

test('network failure throws RecordsUnavailableError', async () => {
  const impl = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(
    socrataQuery('abcd-1234', {}, { fetchImpl: impl, storage: null }),
    (err) => err instanceof RecordsUnavailableError && err.status === null,
  );
});

test('non-array JSON throws RecordsUnavailableError', async () => {
  const f = fakeFetch({ message: 'odd' });
  await assert.rejects(socrataQuery('abcd-1234', {}, { fetchImpl: f.impl, storage: null }), RecordsUnavailableError);
});

test('storage that throws is ignored', async () => {
  const f = fakeFetch([{ a: 1 }]);
  const storage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.deepEqual(await socrataQuery('abcd-1234', {}, { fetchImpl: f.impl, storage }), [{ a: 1 }]);
});

test('params are encoded', async () => {
  const f = fakeFetch([]);
  await socrataQuery('abcd-1234', { $where: "a = 'b c'" }, { fetchImpl: f.impl, storage: null });
  assert.match(f.calls[0].url, /^https:\/\/data\.cityofnewyork\.us\/resource\/abcd-1234\.json\?/);
  assert.match(f.calls[0].url, /%24where=/);
});

test('a request that never answers times out as RecordsUnavailableError', async () => {
  const impl = (url, init) => new Promise((_, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal.reason));
  });
  await assert.rejects(
    socrataQuery('abcd-1234', {}, { fetchImpl: impl, storage: null, timeoutMs: 50 }),
    (err) => err instanceof RecordsUnavailableError && err.status === null,
  );
});
