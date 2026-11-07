import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleSocrata } from '../api/socrata.js';

function upstream(body, status = 200) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { impl, calls };
}

const req = (qs, method = 'GET') => new Request(`https://curbdrift.example/api/socrata?${qs}`, { method });

test('forwards an allowed query with the token added server-side', async () => {
  const u = upstream([{ a: 1 }]);
  const res = await handleSocrata(req('dataset=erm2-nwe9&%24select=bin&%24where=x%3D1&%24limit=10'), { token: 'secret', fetchImpl: u.impl });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), [{ a: 1 }]);
  const url = new URL(u.calls[0].url);
  assert.equal(url.origin + url.pathname, 'https://data.cityofnewyork.us/resource/erm2-nwe9.json');
  assert.equal(url.searchParams.get('$where'), 'x=1');
  assert.equal(u.calls[0].init.headers['X-App-Token'], 'secret');
  assert.match(res.headers.get('cache-control'), /s-maxage=300/);
});

test('the token never appears in the response', async () => {
  const u = upstream([]);
  const res = await handleSocrata(req('dataset=erm2-nwe9'), { token: 'secret', fetchImpl: u.impl });
  assert.doesNotMatch(await res.text(), /secret/);
  for (const [, v] of res.headers) assert.doesNotMatch(v, /secret/);
});

test('rejects datasets outside the allowlist', async () => {
  const u = upstream([]);
  const res = await handleSocrata(req('dataset=abcd-1234'), { token: 't', fetchImpl: u.impl });
  assert.equal(res.status, 400);
  assert.equal(u.calls.length, 0);
});

test('drops parameters the app never sends', async () => {
  const u = upstream([]);
  await handleSocrata(req('dataset=erm2-nwe9&%24query=SELECT%20*&%24%24app_token=x&%24where=a'), { token: 't', fetchImpl: u.impl });
  const url = new URL(u.calls[0].url);
  assert.deepEqual([...url.searchParams.keys()].sort(), ['$where']);
});

test('rejects a $limit above 10000 or not a number', async () => {
  const u = upstream([]);
  assert.equal((await handleSocrata(req('dataset=erm2-nwe9&%24limit=50000'), { token: 't', fetchImpl: u.impl })).status, 400);
  assert.equal((await handleSocrata(req('dataset=erm2-nwe9&%24limit=abc'), { token: 't', fetchImpl: u.impl })).status, 400);
  assert.equal(u.calls.length, 0);
});

test('only GET is allowed', async () => {
  const u = upstream([]);
  const res = await handleSocrata(req('dataset=erm2-nwe9', 'POST'), { token: 't', fetchImpl: u.impl });
  assert.equal(res.status, 405);
});

test('upstream errors pass through their status and are not cached', async () => {
  const u = upstream({ message: 'Too many requests' }, 429);
  const res = await handleSocrata(req('dataset=erm2-nwe9'), { token: 't', fetchImpl: u.impl });
  assert.equal(res.status, 429);
  assert.match(res.headers.get('cache-control'), /no-store/);
});

test('upstream network failure becomes 502', async () => {
  const impl = async () => { throw new TypeError('fetch failed'); };
  const res = await handleSocrata(req('dataset=erm2-nwe9'), { token: 't', fetchImpl: impl });
  assert.equal(res.status, 502);
});

test('works without a token (no header sent)', async () => {
  const u = upstream([]);
  await handleSocrata(req('dataset=erm2-nwe9'), { token: '', fetchImpl: u.impl });
  assert.equal(u.calls[0].init.headers['X-App-Token'], undefined);
});
