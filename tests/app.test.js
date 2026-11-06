import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignCodes } from '../js/app.js';
import { municipal } from '../js/themes/municipal.js';

test('assignCodes numbers each kind by descending score', () => {
  const items = assignCodes([
    { kind: 'S', id: 'a', score: 10 },
    { kind: 'S', id: 'b', score: 90 },
    { kind: 'P', id: 'c', score: 5 },
  ], municipal);
  const byId = Object.fromEntries(items.map((i) => [i.id, i.code]));
  assert.deepEqual(byId, { a: 'S-2', b: 'S-1', c: 'P-1' });
});

test('locate resolves null when the permission prompt is never answered', async () => {
  const { locate } = await import('../js/app.js');
  const silent = { getCurrentPosition() {} };
  assert.equal(await locate(silent, 50), null);
});

test('locate resolves the position when granted', async () => {
  const { locate } = await import('../js/app.js');
  const ok = { getCurrentPosition(success) { success({ coords: { latitude: 40.7, longitude: -73.9 } }); } };
  assert.deepEqual(await locate(ok, 50), { lat: 40.7, lon: -73.9 });
});

test('locate resolves null without geolocation', async () => {
  const { locate } = await import('../js/app.js');
  assert.equal(await locate(undefined, 50), null);
});
