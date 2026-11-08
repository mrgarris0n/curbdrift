import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitComplaints, buildComplaintParams, PUDDLE_DESCRIPTORS, DEFECT_DESCRIPTORS } from '../js/sources/complaints.js';

const TODAY = new Date('2026-11-06T12:00:00Z');
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

test('params include within_circle and both descriptor lists', () => {
  const p = buildComplaintParams({ lat: 40.7359, lon: -73.9911 }, 400, TODAY);
  assert.match(p.$where, /within_circle\(location, 40\.7359, -73\.9911, 400\)/);
  assert.match(p.$where, /created_date > '2025-11-06'/);
  for (const d of [...PUDDLE_DESCRIPTORS, ...DEFECT_DESCRIPTORS]) assert.ok(p.$where.includes(`'${d}'`), d);
  assert.equal(PUDDLE_DESCRIPTORS.length, 7);
  assert.equal(DEFECT_DESCRIPTORS.length, 7);
});
