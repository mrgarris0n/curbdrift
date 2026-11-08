import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceM, bboxAround } from '../js/geo.js';

test('distanceM ~ 111km per degree latitude', () => {
  const d = distanceM({ lat: 40, lon: -74 }, { lat: 41, lon: -74 });
  assert.ok(Math.abs(d - 111195) < 200);
});

test('bboxAround contains center and is ~2*radius tall', () => {
  const b = bboxAround({ lat: 40.7359, lon: -73.9911 }, 400);
  assert.ok(b.south < 40.7359 && b.north > 40.7359 && b.west < -73.9911 && b.east > -73.9911);
  assert.ok(Math.abs(distanceM({ lat: b.south, lon: -73.9911 }, { lat: b.north, lon: -73.9911 }) - 800) < 5);
});
