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

test('city=nyc forwards to NYC Open Data; a missing city still means New York', async () => {
  for (const qs of ['city=nyc&dataset=erm2-nwe9', 'dataset=erm2-nwe9']) {
    const u = upstream([]);
    assert.equal((await handleSocrata(req(qs), { token: 't', fetchImpl: u.impl })).status, 200, qs);
    assert.match(u.calls[0].url, /^https:\/\/data\.cityofnewyork\.us\/resource\/erm2-nwe9\.json/, qs);
    assert.doesNotMatch(u.calls[0].url, /city=/, `${qs}: city is ours, not Socrata's`);
  }
});

test('rejects unknown cities', async () => {
  const u = upstream([]);
  for (const city of ['atlantis', '__proto__', 'toString', '']) {
    const res = await handleSocrata(req(`city=${city}&dataset=erm2-nwe9`), { token: 't', fetchImpl: u.impl });
    assert.equal(res.status, 400, city);
  }
  assert.equal(u.calls.length, 0);
});

test('city=chicago forwards to the Chicago portal; datasets do not cross cities', async () => {
  const u = upstream([]);
  assert.equal((await handleSocrata(req('city=chicago&dataset=v6vf-nfxy&%24limit=5'), { token: 't', fetchImpl: u.impl })).status, 200);
  assert.match(u.calls[0].url, /^https:\/\/data\.cityofchicago\.org\/resource\/v6vf-nfxy\.json\?%24limit=5$/);
  assert.equal(u.calls[0].init.headers['X-App-Token'], 't');
  assert.equal((await handleSocrata(req('city=chicago&dataset=erm2-nwe9'), { token: 't', fetchImpl: u.impl })).status, 400);
  assert.equal((await handleSocrata(req('city=nyc&dataset=v6vf-nfxy'), { token: 't', fetchImpl: u.impl })).status, 400);
  assert.equal(u.calls.length, 1);
});
