import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestSignal } from '../js/net.js';

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

test('aborts after the timeout', async () => {
  const s = requestSignal(20);
  assert.equal(s.aborted, false);
  await settle(50);
  assert.equal(s.aborted, true);
});

test('works where AbortSignal.timeout does not exist (Safari before iOS 16)', async () => {
  const original = AbortSignal.timeout;
  AbortSignal.timeout = undefined;
  try {
    const s = requestSignal(20);
    await settle(50);
    assert.equal(s.aborted, true);
  } finally {
    AbortSignal.timeout = original;
  }
});

test('follows an outer signal (a superseded survey)', async () => {
  const outer = new AbortController();
  const s = requestSignal(10000, outer.signal);
  outer.abort();
  assert.equal(s.aborted, true);
});

test('an already-aborted outer signal aborts immediately', () => {
  const outer = new AbortController();
  outer.abort();
  assert.equal(requestSignal(10000, outer.signal).aborted, true);
});
