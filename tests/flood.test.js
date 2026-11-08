import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floodFromSnapshot, mergeFloodSpots, fetchFlood } from '../js/sources/flood.js';
import { RecordsUnavailableError } from '../js/sources/socrata.js';

const CENTER = { lat: 40.7, lon: -73.9 };
// ~0.000009° latitude per metre.
const north = (m) => +(CENTER.lat + m * 0.000009).toFixed(5);

const snapshot = {
  points: [
    [-73.9, north(0), 1],
    [-73.9, north(100), 2],
    [-73.9, north(500), 2], // outside a 400 m circle
  ],
};

test('floodFromSnapshot keeps spots inside the circle, with depth', () => {
  const spots = floodFromSnapshot(snapshot, CENTER, 400);
  assert.deepEqual(spots, [
    { lat: north(0), lon: -73.9, deep: false },
    { lat: north(100), lon: -73.9, deep: true },
  ]);
});

test('floodFromSnapshot rejects a snapshot without points', () => {
  assert.throws(() => floodFromSnapshot({}, CENTER, 400), RecordsUnavailableError);
  assert.throws(() => floodFromSnapshot(null, CENTER, 400), RecordsUnavailableError);
});

test('floodFromSnapshot skips malformed points', () => {
  const spots = floodFromSnapshot({ points: [[-73.9], 'x', [-73.9, north(10), 1]] }, CENTER, 400);
  assert.equal(spots.length, 1);
});

const cluster = (m, extra = {}) => ({
  kind: 'P', id: `P|${m}`, lat: north(m), lon: -73.9, complaintCount: 2, lastComplaint: new Date('2026-10-01T00:00:00Z'), descriptors: ['Street Flooding (SJ)'], ...extra,
});

test('a complaint cluster within 30 m of a flood spot becomes flood-prone, and absorbs the spot', () => {
  const out = mergeFloodSpots([cluster(0)], [{ lat: north(20), lon: -73.9, deep: true }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'P|0');
  assert.equal(out[0].floodProne, true);
  assert.equal(out[0].floodDepth, 'deep');
  assert.equal(out[0].complaintCount, 2);
});

test('a cluster with no flood spot nearby is not flood-prone', () => {
  const out = mergeFloodSpots([cluster(0)], [{ lat: north(200), lon: -73.9, deep: false }]);
  const c = out.find((p) => p.id === 'P|0');
  assert.equal(c.floodProne, false);
  assert.equal(c.floodDepth, null);
});

test('a cluster near both depths reports deep', () => {
  const out = mergeFloodSpots([cluster(0)], [{ lat: north(10), lon: -73.9, deep: false }, { lat: north(25), lon: -73.9, deep: true }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].floodDepth, 'deep');
});

test('a flood spot with no complaints becomes its own puddle with a stable id', () => {
  const out = mergeFloodSpots([], [{ lat: 40.712346, lon: -73.954321, deep: false }]);
  assert.deepEqual(out, [{
    kind: 'P', id: 'F|40.71235,-73.95432', lat: 40.712346, lon: -73.954321,
    complaintCount: 0, lastComplaint: null, descriptors: [], floodProne: true, floodDepth: 'nuisance',
  }]);
});

test('flood-only spots closer than the spacing collapse into one, preferring deep', () => {
  const out = mergeFloodSpots([], [
    { lat: north(0), lon: -73.9, deep: false },
    { lat: north(20), lon: -73.9, deep: true },
    { lat: north(300), lon: -73.9, deep: false },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out.find((p) => p.lat === north(20))?.floodDepth, 'deep');
});

test('fetchFlood reads the snapshot and returns spots in the circle', async () => {
  let asked;
  const impl = async (url) => { asked = url; return { ok: true, status: 200, json: async () => snapshot }; };
  const spots = await fetchFlood(CENTER, 400, { fetchImpl: impl });
  assert.equal(asked, '/assets/flood.json');
  assert.equal(spots.length, 2);
});

test('the committed flood snapshot is readable and covers flood-prone streets', async () => {
  const { readFile } = await import('node:fs/promises');
  const snap = JSON.parse(await readFile(new URL('../assets/flood.json', import.meta.url), 'utf8'));
  assert.ok(snap.points.length > 20000, `${snap.points.length} points`);
  assert.ok(floodFromSnapshot(snap, { lat: 40.6736, lon: -73.99 }, 400).length > 0, 'Gowanus has flood spots');
});

test('the build ships the flood snapshot', async () => {
  const { readFile } = await import('node:fs/promises');
  const build = await readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
  assert.match(build, /'assets'/);
});

test('flood-only spots are about a block apart, so low-lying areas do not swamp the map', () => {
  const along = [0, 60, 120, 180, 240].map((m) => ({ lat: north(m), lon: -73.9, deep: false }));
  assert.equal(mergeFloodSpots([], along).length, 3); // 0, 120 and 240 m
});
