import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRefresh } from '../api/refresh-sheds.js';

const req = (auth) => new Request('https://curbdrift.example/api/refresh-sheds', { headers: auth ? { authorization: auth } : {} });
const hook = (status = 201) => {
  const calls = [];
  return { calls, impl: async (url, init) => { calls.push({ url, init }); return new Response('{}', { status }); } };
};

test('the cron secret triggers the deploy hook', async () => {
  const h = hook();
  const res = await handleRefresh(req('Bearer s3'), { secret: 's3', hookUrl: 'https://hook.example/x', fetchImpl: h.impl });
  assert.equal(res.status, 202);
  assert.equal(h.calls[0].url, 'https://hook.example/x');
  assert.equal(h.calls[0].init.method, 'POST');
  assert.doesNotMatch(await res.text(), /hook\.example/);
});

for (const auth of [undefined, 'Bearer wrong', 's3']) {
  test(`rejects authorization ${auth ?? '(none)'}`, async () => {
    const h = hook();
    const res = await handleRefresh(req(auth), { secret: 's3', hookUrl: 'https://hook.example/x', fetchImpl: h.impl });
    assert.equal(res.status, 401);
    assert.equal(h.calls.length, 0);
  });
}

test('without a configured secret nobody can call it', async () => {
  const h = hook();
  const res = await handleRefresh(req('Bearer '), { secret: '', hookUrl: 'https://hook.example/x', fetchImpl: h.impl });
  assert.equal(res.status, 401);
  assert.equal(h.calls.length, 0);
});

test('a failing deploy hook is reported', async () => {
  const res = await handleRefresh(req('Bearer s3'), { secret: 's3', hookUrl: 'https://hook.example/x', fetchImpl: hook(500).impl });
  assert.equal(res.status, 502);
});
