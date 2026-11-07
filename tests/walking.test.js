import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWalkingRoute } from '../js/sources/walking.js';
import { planRoute, withStreetRoute } from '../js/route.js';

const START = { lat: 40.7359, lon: -73.9911 };
const walking = {
  distanceM: 900, durationS: 690,
  legs: [{ distanceM: 250, durationS: 190 }, { distanceM: 300, durationS: 230 }, { distanceM: 350, durationS: 270 }],
  path: [[40.7359, -73.9911], [40.737, -73.992], [40.736, -73.989], [40.7359, -73.9911]],
};

test('fetchWalkingRoute posts the loop to /api/route and returns the street route', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => walking }; };
  const points = [START, { lat: 40.737, lon: -73.992 }, START];
  assert.deepEqual(await fetchWalkingRoute(points, { fetchImpl }), walking);
  assert.equal(calls[0].url, '/api/route');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { points });
});

test('fetchWalkingRoute rejects when routing is unavailable', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(fetchWalkingRoute([START, START], { fetchImpl }));
});

test('planned routes say they are estimates', () => {
  const r = planRoute(START, [{ id: 'a', kind: 'S', score: 50, lat: 40.737, lon: -73.992 }], 2000);
  assert.equal(r.method, 'estimate');
});

test('withStreetRoute keeps the stops and order but uses real distances, time and path', () => {
  const planned = {
    method: 'estimate', distanceM: 700, minutes: 9, totalScore: 120,
    stops: [{ id: 'a', legM: 200, atM: 200 }, { id: 'b', legM: 250, atM: 450 }],
  };
  const r = withStreetRoute(planned, walking);
  assert.equal(r.method, 'streets');
  assert.deepEqual(r.stops.map((s) => s.id), ['a', 'b']);
  assert.deepEqual(r.stops.map((s) => [s.legM, s.atM]), [[250, 250], [300, 550]]);
  assert.equal(r.distanceM, 900);
  assert.equal(r.minutes, 12); // 690 s
  assert.equal(r.totalScore, 120);
  assert.deepEqual(r.path, walking.path);
  assert.equal(planned.method, 'estimate', 'does not mutate the planned route');
});

test('withStreetRoute refuses an answer whose legs do not match the stops', () => {
  const planned = { method: 'estimate', distanceM: 1, minutes: 1, totalScore: 1, stops: [{ id: 'a', legM: 1, atM: 1 }] };
  assert.throws(() => withStreetRoute(planned, walking), /legs/);
});
