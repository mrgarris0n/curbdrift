import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRoute, WALK_FACTOR, WALK_M_PER_MIN } from '../js/route.js';
import { distanceM } from '../js/geo.js';

const START = { lat: 40.7359, lon: -73.9911 };
// Offset a point by meters north/east of START.
const at = (northM, eastM) => ({
  lat: START.lat + northM / 111195,
  lon: START.lon + eastM / (111195 * Math.cos((START.lat * Math.PI) / 180)),
});
const item = (id, score, northM, eastM) => ({ id, kind: 'S', score, ...at(northM, eastM) });

test('no items → empty route', () => {
  const r = planRoute(START, [], 2000);
  assert.deepEqual(r.stops, []);
  assert.equal(r.distanceM, 0);
  assert.equal(r.minutes, 0);
});

test('a single reachable item is an out-and-back loop with the street factor', () => {
  const r = planRoute(START, [item('a', 50, 100, 0)], 2000);
  assert.deepEqual(r.stops.map((s) => s.id), ['a']);
  assert.ok(Math.abs(r.distanceM - 2 * 100 * WALK_FACTOR) < 1);
  assert.equal(r.minutes, Math.round(r.distanceM / WALK_M_PER_MIN));
  assert.equal(r.totalScore, 50);
});

test('the walk never exceeds the budget', () => {
  const items = [];
  for (let i = 0; i < 40; i++) items.push(item(`i${i}`, 10 + i, (i % 7) * 60 - 180, Math.floor(i / 7) * 70 - 200));
  const r = planRoute(START, items, 1500);
  assert.ok(r.distanceM <= 1500, r.distanceM);
  assert.ok(r.stops.length > 0);
});

test('an item too far for the budget is left out', () => {
  const r = planRoute(START, [item('near', 10, 100, 0), item('far', 100, 2000, 0)], 1000);
  assert.deepEqual(r.stops.map((s) => s.id), ['near']);
});

test('prefers more decay per meter walked', () => {
  // Same distance; the higher score goes in when only one fits.
  const r = planRoute(START, [item('low', 10, 300, 0), item('high', 90, -300, 0)], 2 * 300 * WALK_FACTOR + 1);
  assert.deepEqual(r.stops.map((s) => s.id), ['high']);
});

test('items with no score are not worth a detour', () => {
  const r = planRoute(START, [item('zero', 0, 50, 0)], 2000);
  assert.deepEqual(r.stops, []);
});

test('stops are ordered as a loop that does not cross itself, with cumulative distances', () => {
  // Corners of a 200 m square with the start at one corner. Perimeter = 800 m; crossing = ~966 m.
  const r = planRoute(START, [item('ne', 50, 200, 200), item('n', 50, 200, 0), item('e', 50, 0, 200)], 5000);
  const order = r.stops.map((s) => s.id).join(',');
  assert.ok(order === 'n,ne,e' || order === 'e,ne,n', order);
  assert.ok(Math.abs(r.distanceM - 800 * WALK_FACTOR) < 2, r.distanceM);
  // legM is the walk from the previous point; atM is cumulative.
  assert.ok(Math.abs(r.stops[0].legM - 200 * WALK_FACTOR) < 1);
  assert.ok(Math.abs(r.stops[2].atM - 600 * WALK_FACTOR) < 2);
});

test('route distances use the shared haversine', () => {
  const p = item('a', 50, 0, 250);
  const r = planRoute(START, [p], 2000);
  assert.ok(Math.abs(r.distanceM - 2 * distanceM(START, p) * WALK_FACTOR) < 0.01);
});
