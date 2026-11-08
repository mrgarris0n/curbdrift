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
  assert.match(f.calls[0].url, /^\/api\/socrata\?dataset=abcd-1234&/);
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

test('the browser never sends an app token (the proxy adds it)', async () => {
  const f = fakeFetch([]);
  await socrataQuery('abcd-1234', {}, { fetchImpl: f.impl, storage: null });
  assert.equal(f.calls[0].init.headers?.['X-App-Token'], undefined);
});

test('a cancelled survey cancels its request', async () => {
  const outer = new AbortController();
  const impl = (url, init) => new Promise((_, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal.reason));
  });
  const pending = socrataQuery('abcd-1234', {}, { fetchImpl: impl, storage: null, timeoutMs: 10000, signal: outer.signal });
  outer.abort();
  // Promptly — not when the 10 s timeout eventually fires.
  const tooSlow = new Promise((_, reject) => setTimeout(() => reject(new Error('not cancelled')), 500));
  await assert.rejects(Promise.race([pending, tooSlow]), RecordsUnavailableError);
});

test('the city is passed to the proxy', async () => {
  const f = fakeFetch([]);
  await socrataQuery('abcd-1234', {}, { city: 'nyc', fetchImpl: f.impl, storage: null });
  assert.match(f.calls[0].url, /^\/api\/socrata\?city=nyc&dataset=abcd-1234/);
});
