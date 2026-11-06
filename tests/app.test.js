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

test('locate reports a fix that arrives after the timeout via onLate', async () => {
  const { locate } = await import('../js/app.js');
  let deliver;
  const slow = { getCurrentPosition(success) { deliver = success; } };
  let late = null;
  const first = await locate(slow, 20, (pos) => { late = pos; });
  assert.equal(first, null);
  deliver({ coords: { latitude: 40.75, longitude: -73.98 } });
  assert.deepEqual(late, { lat: 40.75, lon: -73.98 });
});

test('locate does not call onLate when the fix arrives in time', async () => {
  const { locate } = await import('../js/app.js');
  let lateCalls = 0;
  const ok = { getCurrentPosition(success) { success({ coords: { latitude: 40.7, longitude: -73.9 } }); } };
  await locate(ok, 50, () => { lateCalls += 1; });
  assert.equal(lateCalls, 0);
});

const facts = {
  shed: { kind: 'S', id: 's', lat: 0, lon: 0, chainStart: new Date('2020-01-01T00:00:00Z') },
  puddle: { kind: 'P', id: 'p', lat: 0, lon: 0, complaintCount: 2, lastComplaint: new Date(), descriptors: [] },
  defect: { kind: 'D', id: 'd', lat: 0, lon: 0, descriptor: 'Broken Sidewalk', closed: false },
};

test('gatherSurvey: weather that resolves but cannot be summarized still yields puddles as unknown', async () => {
  const { gatherSurvey } = await import('../js/app.js');
  const result = await gatherSurvey({ lat: 0, lon: 0 }, new Date('2026-11-06T00:00:00Z'), {
    fetchSheds: async () => [facts.shed],
    fetchComplaints: async () => ({ puddles: [facts.puddle], defects: [facts.defect] }),
    fetchWeather: async () => ({ time: ['2026-11-05T00:00'] }), // 200 but missing arrays
  });
  assert.equal(result.puddles.length, 1);
  assert.equal(result.puddles[0].statusKey, 'unknown');
  assert.equal(result.defects.length, 1);
  assert.deepEqual(result.errors, {});
});

test('gatherSurvey: a failure while processing complaints is reported, not swallowed', async () => {
  const { gatherSurvey } = await import('../js/app.js');
  const result = await gatherSurvey({ lat: 0, lon: 0 }, new Date(), {
    fetchSheds: async () => [facts.shed],
    fetchComplaints: async () => ({ puddles: null, defects: null }), // malformed → throws while scoring
    fetchWeather: async () => { throw new Error('down'); },
  });
  assert.equal(result.sheds.length, 1);
  assert.equal(result.errors.P, true);
  assert.equal(result.errors.D, true);
});

test('gatherSurvey: source rejections mark only their layers', async () => {
  const { gatherSurvey } = await import('../js/app.js');
  let shedsSeen = null;
  const result = await gatherSurvey({ lat: 0, lon: 0 }, new Date(), {
    fetchSheds: async () => { throw new Error('429'); },
    fetchComplaints: async () => ({ puddles: [facts.puddle], defects: [] }),
    fetchWeather: async () => { throw new Error('down'); },
  }, (s) => { shedsSeen = s; });
  assert.equal(shedsSeen, null);
  assert.deepEqual(result.errors, { S: true });
  assert.equal(result.puddles.length, 1);
});

test('gatherSurvey hands its cancellation signal to every source', async () => {
  const { gatherSurvey } = await import('../js/app.js');
  const signal = new AbortController().signal;
  const seen = [];
  const spy = (value) => async (at, a, b) => { seen.push((b ?? a)?.signal === signal); return value; };
  await gatherSurvey({ lat: 0, lon: 0 }, new Date(), {
    fetchSheds: spy([]),
    fetchComplaints: spy({ puddles: [], defects: [] }),
    fetchWeather: spy({ time: [], precipitation: [], shortwave_radiation: [], temperature_2m: [] }),
  }, undefined, signal);
  assert.deepEqual(seen, [true, true, true]);
});
