import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CITIES, DEFAULT_CITY, cityAt, resolveStart } from '../js/cities.js';

const UNION_SQ = { lat: 40.7359, lon: -73.9911 };
const BUDAPEST = { lat: 47.4979, lon: 19.0402 };
const LOOP = { lat: 41.8819, lon: -87.6278 };

test('New York is the default city, centred on Union Square', () => {
  assert.equal(DEFAULT_CITY, CITIES.nyc);
  assert.deepEqual(CITIES.nyc.defaultCenter, UNION_SQ);
});

test('cityAt finds the city whose box contains the point, or null', () => {
  assert.equal(cityAt(UNION_SQ), CITIES.nyc);
  assert.equal(cityAt(LOOP), CITIES.chicago);
  assert.equal(cityAt(BUDAPEST), null);
});

test('every city carries what a survey needs', () => {
  for (const city of Object.values(CITIES)) {
    assert.ok(city.id && city.name && city.bbox, city.id);
    assert.ok(city.mayorTermStarts.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)), `${city.id} mayors`);
    for (const k of ['fetchSheds', 'fetchComplaints', 'fetchWeather', 'fetchFlood']) assert.equal(typeof city.sources[k], 'function', `${city.id}.${k}`);
  }
});

test("the default city's centre is inside its own box", () => {
  assert.equal(cityAt(DEFAULT_CITY.defaultCenter), DEFAULT_CITY);
});

test('Chicago: its mayors, and no flood map (its puddles count as off the map)', async () => {
  assert.deepEqual(CITIES.chicago.mayorTermStarts, ['2019-05-20', '2023-05-15']);
  assert.deepEqual(await CITIES.chicago.sources.fetchFlood(LOOP, 400), []);
});

test('resolveStart falls back for null and outside every city', () => {
  assert.deepEqual(resolveStart(null), { center: DEFAULT_CITY.defaultCenter, verified: false });
  assert.deepEqual(resolveStart(BUDAPEST), { center: DEFAULT_CITY.defaultCenter, verified: false });
  assert.deepEqual(resolveStart({ lat: 40.7, lon: -73.95 }), { center: { lat: 40.7, lon: -73.95 }, verified: true });
  assert.deepEqual(resolveStart(LOOP), { center: LOOP, verified: true });
});
