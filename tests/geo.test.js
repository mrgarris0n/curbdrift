import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceM, bboxAround, isInNyc, resolveStart } from '../js/geo.js';
import { DEFAULT_CENTER } from '../js/config.js';

test('distanceM ~ 111km per degree latitude', () => {
  const d = distanceM({ lat: 40, lon: -74 }, { lat: 41, lon: -74 });
  assert.ok(Math.abs(d - 111195) < 200);
});

test('bboxAround contains center and is ~2*radius tall', () => {
  const b = bboxAround({ lat: 40.7359, lon: -73.9911 }, 400);
  assert.ok(b.south < 40.7359 && b.north > 40.7359 && b.west < -73.9911 && b.east > -73.9911);
  assert.ok(Math.abs(distanceM({ lat: b.south, lon: -73.9911 }, { lat: b.north, lon: -73.9911 }) - 800) < 5);
});

test('isInNyc', () => {
  assert.equal(isInNyc({ lat: 40.7359, lon: -73.9911 }), true);
  assert.equal(isInNyc({ lat: 47.4979, lon: 19.0402 }), false); // Budapest
});

test('resolveStart falls back for null and outside NYC', () => {
  assert.deepEqual(resolveStart(null), { center: DEFAULT_CENTER, verified: false });
  assert.deepEqual(resolveStart({ lat: 47.4979, lon: 19.0402 }), { center: DEFAULT_CENTER, verified: false });
  assert.deepEqual(resolveStart({ lat: 40.7, lon: -73.95 }), { center: { lat: 40.7, lon: -73.95 }, verified: true });
});
