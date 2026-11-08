import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CITIES, DEFAULT_CITY, cityAt, resolveStart } from '../js/cities.js';

const UNION_SQ = { lat: 40.7359, lon: -73.9911 };
const BUDAPEST = { lat: 47.4979, lon: 19.0402 };

test('New York is the default city, centred on Union Square', () => {
  assert.equal(DEFAULT_CITY, CITIES.nyc);
  assert.deepEqual(CITIES.nyc.defaultCenter, UNION_SQ);
});

test('cityAt finds the city whose box contains the point, or null', () => {
  assert.equal(cityAt(UNION_SQ), CITIES.nyc);
  assert.equal(cityAt(BUDAPEST), null);
});

test('every city carries what a survey needs', () => {
  for (const city of Object.values(CITIES)) {
    assert.ok(city.id && city.name && city.bbox && city.defaultCenter, city.id);
    assert.equal(cityAt(city.defaultCenter), city, `${city.id} default centre is inside its own box`);
    assert.ok(city.mayorTermStarts.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)), `${city.id} mayors`);
    for (const k of ['fetchSheds', 'fetchComplaints', 'fetchWeather', 'fetchFlood']) assert.equal(typeof city.sources[k], 'function', `${city.id}.${k}`);
  }
});

test('resolveStart falls back for null and outside every city', () => {
  assert.deepEqual(resolveStart(null), { center: DEFAULT_CITY.defaultCenter, verified: false });
  assert.deepEqual(resolveStart(BUDAPEST), { center: DEFAULT_CITY.defaultCenter, verified: false });
  assert.deepEqual(resolveStart({ lat: 40.7, lon: -73.95 }), { center: { lat: 40.7, lon: -73.95 }, verified: true });
});
