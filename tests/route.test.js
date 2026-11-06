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
  const r = planRoute(START, [item('near', 20, 100, 0), item('far', 100, 2000, 0)], 1000);
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

test('at most MAX_STOPS stops, keeping the best decay per meter', async () => {
  const { MAX_STOPS } = await import('../js/route.js');
  assert.equal(MAX_STOPS, 12);
  const items = [];
  for (let i = 0; i < 40; i++) items.push(item(`i${i}`, i === 7 ? 1000 : 20, 50 + i * 5, 0));
  const r = planRoute(START, items, 5000);
  assert.equal(r.stops.length, 12);
  assert.ok(r.stops.some((s) => s.id === 'i7'), 'the standout item is kept');
});

test('when the stop cap binds, the worst reachable items win over nearer lesser ones', () => {
  const items = [];
  for (let i = 0; i < 30; i++) items.push(item(`low${i}`, 10, 30 + i * 3, 20)); // trivial, right next to start
  for (let i = 0; i < 12; i++) items.push(item(`bad${i}`, 80, 250 + i * 10, -150)); // worse, a short walk away
  const r = planRoute(START, items, 2000);
  assert.equal(r.stops.length, 12);
  assert.ok(r.stops.every((s) => s.id.startsWith('bad')), r.stops.map((s) => s.id).join(','));
});

const ofKind = (kind, id, score, northM, eastM) => ({ ...item(id, score, northM, eastM), kind });
const countKinds = (stops) => stops.reduce((c, s) => ({ ...c, [s.kind]: (c[s.kind] ?? 0) + 1 }), {});

test('kinds take turns, so a few worse sheds cannot crowd out every defect and puddle', () => {
  const items = [];
  for (let i = 0; i < 20; i++) items.push(ofKind('S', `s${i}`, 90, 100 + i * 8, 0));
  for (let i = 0; i < 5; i++) items.push(ofKind('D', `d${i}`, 60, 0, 100 + i * 8));
  for (let i = 0; i < 3; i++) items.push(ofKind('P', `p${i}`, 50, -100 - i * 8, 0));
  const r = planRoute(START, items, 5000);
  assert.equal(r.stops.length, 12);
  // Rounds of S,D,P until puddles run out (3), then S,D, then S: 5 sheds, 4 defects, 3 puddles.
  assert.deepEqual(countKinds(r.stops), { S: 5, D: 4, P: 3 });
});

test('within a kind, the worst still go first', () => {
  const items = [ofKind('D', 'mild', 30, 0, 100), ofKind('D', 'severe', 70, 0, 120), ofKind('S', 's', 90, 100, 0)];
  const r = planRoute(START, items, 5000);
  assert.ok(r.stops.some((s) => s.id === 'severe'));
  assert.equal(r.stops.length, 3);
});

test('a single kind still fills the walk', () => {
  const items = [];
  for (let i = 0; i < 20; i++) items.push(ofKind('S', `s${i}`, 90 - i, 100 + i * 8, 0));
  assert.equal(planRoute(START, items, 5000).stops.length, 12);
});

test('items at the same spot (one building) take one stop, the worst one', () => {
  const items = [ofKind('S', 'shed-a', 50, 200, 0), ofKind('D', 'defect-same-spot', 70, 200, 0.5), ofKind('S', 'shed-b', 40, 200, 1)];
  const r = planRoute(START, items, 5000);
  assert.deepEqual(r.stops.map((s) => s.id), ['defect-same-spot']);
});

test('items below MIN_DETOUR_SCORE are never stops, even when their kind has nothing better', async () => {
  const { MIN_DETOUR_SCORE } = await import('../js/route.js');
  assert.equal(MIN_DETOUR_SCORE, 15);
  const items = [ofKind('S', 'old-shed', 80, 100, 0), ofKind('P', 'dry-puddle', 8, 0, 100), ofKind('P', 'wet-puddle', 40, 0, 150), ofKind('S', 'new-shed', 10, 50, 50)];
  const ids = planRoute(START, items, 5000).stops.map((s) => s.id).sort();
  assert.deepEqual(ids, ['old-shed', 'wet-puddle']);
});
