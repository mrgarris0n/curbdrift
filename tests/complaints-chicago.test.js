import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitComplaints, buildComplaintParams, fetchComplaints, PUDDLE_TYPES, DEFECT_TYPES, CHICAGO_311_DATASET } from '../js/sources/complaints-chicago.js';

const TODAY = new Date('2026-11-06T12:00:00Z');
let n = 0;
// A Chicago 311 row as the query returns it.
function row(type, created, extra = {}) {
  n += 1;
  return {
    sr_number: `SR26-${n}`, sr_type: type, created_date: `${created}T10:00:00.000`, status: 'Open',
    street_address: '1400 N MILWAUKEE AVE', latitude: '41.9088', longitude: '-87.6796', ...extra,
  };
}

test('the puddle and defect types are the ones Phase 0 measured', () => {
  assert.deepEqual([...PUDDLE_TYPES].sort(), ['Alley Sewer Inspection Request', 'Sewer Cave-In Inspection Request', 'Sewer Cleaning Inspection Request', 'Water On Street Complaint']);
  assert.deepEqual([...DEFECT_TYPES], ['Sidewalk Inspection Request']);
});

test('query: a circle around the survey, 12 months back, only the app\'s types and fields', () => {
  const q = buildComplaintParams({ lat: 41.9088, lon: -87.6796 }, 400, TODAY);
  assert.match(q.$where, /within_circle\(location, 41\.9088, -87\.6796, 400\)/);
  assert.match(q.$where, /created_date > '2025-11-06'/);
  assert.match(q.$where, /'Water On Street Complaint'/);
  assert.match(q.$where, /'Sidewalk Inspection Request'/);
  assert.doesNotMatch(q.$where, /Water in Basement/);
  assert.equal(q.$select, 'sr_number,sr_type,created_date,status,street_address,latitude,longitude');
  assert.equal(q.$limit, '2000');
});

test('puddle complaints within 30 m cluster, counted per type', () => {
  const { puddles } = splitComplaints([
    row('Water On Street Complaint', '2026-10-01'),
    row('Water On Street Complaint', '2026-10-05', { latitude: '41.90889' }), // ~1 m, a duplicate report: still counts
    row('Sewer Cleaning Inspection Request', '2026-09-01', { latitude: '41.90895' }),
    row('Water On Street Complaint', '2026-10-01', { latitude: '41.9110' }), // ~245 m away
  ], TODAY);
  assert.deepEqual(puddles.map((p) => p.complaintCount).sort(), [1, 3]);
  const big = puddles.find((p) => p.complaintCount === 3);
  assert.deepEqual(big.byDescriptor, { 'Water On Street Complaint': 2, 'Sewer Cleaning Inspection Request': 1 });
  assert.equal(big.lastComplaint.toISOString().slice(0, 10), '2026-10-05');
  assert.equal(big.kind, 'P');
});

test('sidewalk inspection requests are defects; Completed means closed', () => {
  const { defects } = splitComplaints([row('Sidewalk Inspection Request', '2026-09-01', { status: 'Completed' }), row('Sidewalk Inspection Request', '2026-09-02')], TODAY);
  assert.equal(defects.length, 2);
  assert.deepEqual(defects.map((d) => d.closed), [true, false]);
  assert.equal(defects[0].descriptor, 'Sidewalk Inspection Request');
  assert.equal(defects[0].address, '1400 N MILWAUKEE AVE');
  assert.equal(defects[0].kind, 'D');
});

test('windows: puddles 12 months, defects 6 months; other types and bad rows are ignored', () => {
  const { puddles, defects } = splitComplaints([
    row('Water On Street Complaint', '2025-10-01'),
    row('Sidewalk Inspection Request', '2026-03-01'),
    row('Water in Basement Complaint', '2026-10-01'),
    row('Water On Street Complaint', '2026-10-01', { latitude: '' }),
  ], TODAY);
  assert.equal(puddles.length + defects.length, 0);
});

test('fetchComplaints asks the proxy for Chicago\'s 311 dataset', async () => {
  assert.equal(CHICAGO_311_DATASET, 'v6vf-nfxy');
  const urls = [];
  const fetchImpl = async (url) => { urls.push(url); return { ok: true, status: 200, json: async () => [row('Water On Street Complaint', new Date().toISOString().slice(0, 10))] }; };
  const { puddles } = await fetchComplaints({ lat: 41.9088, lon: -87.6796 }, 400, { fetchImpl, storage: null });
  assert.match(urls[0], /^\/api\/socrata\?city=chicago&dataset=v6vf-nfxy&/);
  assert.equal(puddles.length, 1);
});

// Chicago's 311 data is 3–5× denser than New York's (Wicker Park: 47 clusters at 30 m), so its
// puddles cluster at about a block and need at least one full weighted complaint.
test('Chicago puddles cluster within ~a block (100 m)', () => {
  const { puddles } = splitComplaints([
    row('Water On Street Complaint', '2026-10-01'),
    row('Water On Street Complaint', '2026-10-02', { latitude: '41.9095' }), // ~78 m north: same puddle
    row('Water On Street Complaint', '2026-10-03', { latitude: '41.9103' }), // ~167 m north: its own
  ], TODAY);
  assert.deepEqual(puddles.map((p) => p.complaintCount).sort(), [1, 2]);
});

test('a cluster needs at least one full weighted complaint', () => {
  const lone = (type, extra = {}) => splitComplaints([row(type, '2026-10-01', extra)], TODAY).puddles.length;
  assert.equal(lone('Sewer Cave-In Inspection Request'), 0, 'weight 0.2');
  assert.equal(lone('Sewer Cleaning Inspection Request'), 0, 'weight 0.5');
  assert.equal(lone('Water On Street Complaint'), 1, 'weight 1');
  const twoCleanings = splitComplaints([row('Sewer Cleaning Inspection Request', '2026-10-01'), row('Sewer Cleaning Inspection Request', '2026-10-02')], TODAY);
  assert.equal(twoCleanings.puddles.length, 1, '0.5 + 0.5');
});
