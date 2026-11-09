import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toSnapshot, complaintsAround, snapshotQuery, fetchComplaints, SNAPSHOT_URL, PUDDLE_DESCRIPTORS, DEFECT_DESCRIPTORS } from '../js/sources/complaints.js';
import { RecordsUnavailableError } from '../js/sources/socrata.js';

const TODAY = new Date('2026-11-06T12:00:00Z');
const CENTER = { lat: 40.7359, lon: -73.9911 };
// Rows → the build's snapshot → what the browser finds within 5 km of Union Square.
const splitComplaints = (rows, today) => complaintsAround(toSnapshot(rows, today), CENTER, 5000, today);
let key = 0;
function row(type, descriptor, created, extra = {}) {
  key += 1;
  return {
    unique_key: String(key), complaint_type: type, descriptor, created_date: `${created}T10:00:00.000`,
    status: 'Open', incident_address: '1 UNION SQUARE WEST', latitude: '40.7359', longitude: '-73.9911', ...extra,
  };
}

test('split by type and window', () => {
  const rows = [
    row('Sidewalk Condition', 'Broken Sidewalk', '2026-03-01'), // 8 months ago: excluded
    row('Sidewalk Condition', 'Broken Sidewalk', '2026-09-01', { longitude: '-73.9800' }),
    row('Sewer', 'Street Flooding (SJ)', '2026-01-06'), // 10 months: included
  ];
  const { puddles, defects } = splitComplaints(rows, TODAY);
  assert.equal(defects.length, 1);
  assert.equal(defects[0].kind, 'D');
  assert.equal(defects[0].descriptor, 'Broken Sidewalk');
  assert.equal(puddles.length, 1);
  assert.equal(puddles[0].kind, 'P');
});

test('puddle complaints older than 12 months excluded', () => {
  const { puddles } = splitComplaints([row('Sewer', 'Street Flooding (SJ)', '2025-10-01')], TODAY);
  assert.equal(puddles.length, 0);
});

test('clusters within 30m', () => {
  const rows = [
    row('Sewer', 'Street Flooding (SJ)', '2026-10-01', { latitude: '40.73590' }),
    row('Sewer Maintenance', 'Catch Basin Clogged', '2026-10-10', { latitude: '40.73599' }), // ~10m
    row('Sewer', 'Street Flooding (SJ)', '2026-10-01', { latitude: '40.73770' }), // ~200m
  ];
  const { puddles } = splitComplaints(rows, TODAY);
  assert.deepEqual(puddles.map((p) => p.complaintCount).sort(), [1, 2]);
  const pair = puddles.find((p) => p.complaintCount === 2);
  assert.equal(pair.lastComplaint.toISOString().slice(0, 10), '2026-10-10');
  assert.deepEqual(pair.descriptors.sort(), ['Catch Basin Clogged', 'Street Flooding (SJ)']);
  assert.deepEqual(pair.byDescriptor, { 'Street Flooding (SJ)': 1, 'Catch Basin Clogged': 1 });
});

test('clusters count repeat complaints per descriptor', () => {
  const rows = ['2026-10-01', '2026-10-05'].map((d) => row('Sewer', 'Street Flooding (SJ)', d));
  const { puddles } = splitComplaints(rows, TODAY);
  assert.deepEqual(puddles[0].byDescriptor, { 'Street Flooding (SJ)': 2 });
});

test('rows without coordinates skipped', () => {
  const rows = [
    row('Sewer', 'Street Flooding (SJ)', '2026-10-01', { latitude: undefined }),
    row('Sidewalk Condition', 'Broken Sidewalk', '2026-10-01', { longitude: '' }),
    row('Sidewalk Condition', 'Broken Sidewalk', 'not-a-date'),
  ];
  const { puddles, defects } = splitComplaints(rows, TODAY);
  assert.equal(puddles.length + defects.length, 0);
});

test('closed flag', () => {
  const { defects } = splitComplaints([row('Sidewalk Condition', 'Broken Sidewalk', '2026-10-01', { status: 'Closed' })], TODAY);
  assert.equal(defects[0].closed, true);
});

test('the snapshot query covers both descriptor lists, citywide, 12 months back', () => {
  const p = snapshotQuery(TODAY);
  assert.doesNotMatch(p.$where, /within_circle/);
  assert.match(p.$where, /created_date > '2025-11-06'/);
  for (const d of [...PUDDLE_DESCRIPTORS, ...DEFECT_DESCRIPTORS]) assert.ok(p.$where.includes(`'${d}'`), d);
  assert.equal(PUDDLE_DESCRIPTORS.length, 7);
  assert.equal(DEFECT_DESCRIPTORS.length, 7);
});

test('the snapshot keeps defects within 6 months and only their address', () => {
  const snap = toSnapshot([
    row('Sidewalk Condition', 'Broken Sidewalk', '2026-03-01'),
    row('Sidewalk Condition', 'Broken Sidewalk', '2026-09-01'),
    row('Sewer', 'Street Flooding (SJ)', '2026-09-01'),
  ], TODAY);
  assert.equal(snap.complaints.length, 2);
  assert.deepEqual(snap.complaints.map((c) => c[6]), ['1 UNION SQUARE WEST', '']);
});

test('the browser keeps only complaints inside the survey circle', () => {
  const snap = toSnapshot([
    row('Sidewalk Condition', 'Broken Sidewalk', '2026-10-01'),
    row('Sidewalk Condition', 'Broken Sidewalk', '2026-10-01', { latitude: '40.7400' }), // ~455 m north
  ], TODAY);
  assert.equal(complaintsAround(snap, CENTER, 400, TODAY).defects.length, 1);
});

test('fetchComplaints reads the static snapshot; a malformed one is unavailable', async () => {
  const urls = [];
  const today = new Date();
  const snap = toSnapshot([row('Sewer', 'Street Flooding (SJ)', today.toISOString().slice(0, 10))], today);
  const fetchImpl = async (url) => { urls.push(url); return { ok: true, status: 200, json: async () => snap }; };
  const { puddles } = await fetchComplaints(CENTER, 400, { fetchImpl });
  assert.deepEqual(urls, [SNAPSHOT_URL]);
  assert.equal(SNAPSHOT_URL, '/data/complaints.json');
  assert.equal(puddles.length, 1);
  const broken = async () => ({ ok: true, status: 200, json: async () => ({ sheds: [] }) });
  await assert.rejects(fetchComplaints(CENTER, 400, { fetchImpl: broken }), RecordsUnavailableError);
});

test('New York keeps its 30 m clusters and keeps single low-weight complaints', () => {
  const { puddles } = splitComplaints([
    row('Sewer', 'Catch Basin Sunken/Damaged/Raised (SC1)', '2026-10-01'), // weight 0, still a puddle in NYC
    row('Sewer', 'Street Flooding (SJ)', '2026-10-01', { latitude: '40.73650' }), // ~67 m north: separate
  ], TODAY);
  assert.equal(puddles.length, 2);
});
