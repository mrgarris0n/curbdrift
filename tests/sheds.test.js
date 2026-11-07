import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupShedPermits, snapshotQuery, toSnapshot, shedsFromSnapshot, fetchSheds, SNAPSHOT_URL } from '../js/sources/sheds.js';
import { RecordsUnavailableError } from '../js/sources/socrata.js';

const TODAY = new Date('2026-11-06T12:00:00Z');

function permit(issued, expired, extra = {}) {
  return {
    bin: '1009129', house_no: '34 1/2', street_name: 'EAST   12 STREET', borough: 'Manhattan',
    work_type: 'Sidewalk Shed', issued_date: `${issued}T00:00:00.000`, expired_date: `${expired}T00:00:00.000`,
    permit_status: 'Permit Issued', latitude: '40.733809', longitude: '-73.991',
    owner_business_name: 'SOME OWNER LLC', applicant_business_name: 'SOME SCAFFOLD INC',
    job_description: 'INSTALLATION OF SIDEWALK SHED', ...extra,
  };
}

test('continuous chain', () => {
  const rows = [permit('2017-10-20', '2018-10-20')];
  for (let y = 2018; y <= 2025; y++) rows.push(permit(`${y}-10-15`, `${y + 1}-10-20`));
  rows.push(permit('2026-10-01', '2027-01-01'));
  const items = groupShedPermits(rows, TODAY);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'S');
  assert.equal(items[0].chainStart.toISOString().slice(0, 10), '2017-10-20');
  assert.equal(items[0].renewals, 9);
  assert.equal(items[0].address, '34 1/2 EAST 12 STREET');
  assert.equal(items[0].latestExpiry.toISOString().slice(0, 10), '2027-01-01');
});

test('gap breaks chain', () => {
  const rows = [permit('2018-01-01', '2019-01-01'), permit('2019-06-01', '2020-06-01'), permit('2020-06-10', '2027-01-01')];
  const [item] = groupShedPermits(rows, TODAY);
  assert.equal(item.chainStart.toISOString().slice(0, 10), '2019-06-01');
  assert.equal(item.renewals, 1);
});

test('parallel permits issued the same day are not renewals', () => {
  const rows = [permit('2024-01-01', '2025-01-01'), permit('2024-01-01', '2025-01-01'), permit('2024-12-20', '2027-01-01')];
  const [item] = groupShedPermits(rows, TODAY);
  assert.equal(item.renewals, 1);
});

test('gap is measured against the longest-running earlier permit', () => {
  // A long permit covers through 2025; a short one in between expires early. No real gap.
  const rows = [permit('2023-01-01', '2025-06-01'), permit('2023-02-01', '2023-03-01'), permit('2025-05-01', '2027-01-01')];
  const [item] = groupShedPermits(rows, TODAY);
  assert.equal(item.chainStart.toISOString().slice(0, 10), '2023-01-01');
});

test('expired structure excluded', () => {
  assert.deepEqual(groupShedPermits([permit('2025-01-01', '2026-01-01')], TODAY), []);
});

test('signed-off latest excluded', () => {
  const rows = [permit('2024-01-01', '2025-01-01'), permit('2025-01-01', '2027-01-01', { permit_status: 'Signed-off' })];
  assert.deepEqual(groupShedPermits(rows, TODAY), []);
});

test('a signed-off job does not hide another active job on the same building', () => {
  // Real case (BIN 1800014): the job with the latest expiry was signed off, another job is still up.
  const rows = [
    permit('2026-07-01', '2027-01-28', { job_filing_number: 'M01482899-I1', permit_status: 'Signed-off' }),
    permit('2026-10-29', '2026-12-31', { job_filing_number: 'M01482386-I1' }),
  ];
  const items = groupShedPermits(rows, TODAY);
  assert.equal(items.length, 1);
  assert.equal(items[0].latestExpiry.toISOString().slice(0, 10), '2026-12-31');
});

test('bad coordinates skipped', () => {
  const rows = [
    permit('2025-01-01', '2027-01-01', { latitude: undefined }),
    permit('2025-01-01', '2027-01-01', { bin: '2', issued_date: 'garbage' }),
    permit('2025-01-01', '2027-01-01', { bin: '3', longitude: 'x' }),
  ];
  assert.deepEqual(groupShedPermits(rows, TODAY), []);
});

test('separate work types are separate items', () => {
  const rows = [permit('2025-01-01', '2027-01-01'), permit('2025-01-01', '2027-01-01', { work_type: 'Supported Scaffold' })];
  assert.equal(groupShedPermits(rows, TODAY).length, 2);
});

test('snapshotQuery asks for every shed and scaffold citywide, without the long job description', () => {
  const q = snapshotQuery();
  assert.match(q.$where, /'Sidewalk Shed','Supported Scaffold','Suspended Scaffold'/);
  assert.doesNotMatch(q.$where, /latitude/);
  assert.match(q.$select, /job_filing_number/);
  assert.doesNotMatch(q.$select, /job_description/);
});

test('snapshot round trip keeps the facts and trims to the survey circle', () => {
  const near = permit('2025-01-01', '2099-01-01', { bin: 'near', latitude: '40.7360', longitude: '-73.9911' });
  // ~540 m from center.
  const far = permit('2025-01-01', '2099-01-01', { bin: 'far', latitude: '40.7393', longitude: '-73.9866' });
  const snapshot = JSON.parse(JSON.stringify(toSnapshot([near, far], TODAY)));
  assert.equal(snapshot.sheds.length, 2);
  const items = shedsFromSnapshot(snapshot, { lat: 40.7359, lon: -73.9911 }, 400, TODAY);
  assert.deepEqual(items.map((x) => x.id.split('|')[0]), ['near']);
  assert.equal(items[0].kind, 'S');
  assert.equal(items[0].chainStart.toISOString().slice(0, 10), '2025-01-01');
  assert.equal(items[0].latestExpiry.toISOString().slice(0, 10), '2099-01-01');
});

test('permits that expired after the snapshot was made are dropped', () => {
  const snapshot = toSnapshot([permit('2025-01-01', '2026-11-08')], TODAY);
  const center = { lat: 40.733809, lon: -73.991 };
  assert.equal(shedsFromSnapshot(snapshot, center, 400, new Date('2026-11-08T00:00:00Z')).length, 1);
  assert.equal(shedsFromSnapshot(snapshot, center, 400, new Date('2026-11-09T00:00:00Z')).length, 0);
});

test('fetchSheds reads the static snapshot, not the API', async () => {
  const snapshot = toSnapshot([permit('2025-01-01', '2099-01-01')], TODAY);
  const urls = [];
  const fetchImpl = async (url) => { urls.push(url); return { ok: true, status: 200, json: async () => snapshot }; };
  const items = await fetchSheds({ lat: 40.733809, lon: -73.991 }, 400, { fetchImpl });
  assert.deepEqual(urls, [SNAPSHOT_URL]);
  assert.equal(items.length, 1);
});

test('a malformed snapshot is a records failure', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ nope: true }) });
  await assert.rejects(fetchSheds({ lat: 40.7, lon: -73.9 }, 400, { fetchImpl }), RecordsUnavailableError);
});
