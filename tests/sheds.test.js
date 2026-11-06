import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupShedPermits, buildShedParams } from '../js/sources/sheds.js';

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

test('buildShedParams', () => {
  const p = buildShedParams({ lat: 40.7359, lon: -73.9911 }, 400);
  assert.match(p.$where, /'Sidewalk Shed','Supported Scaffold','Suspended Scaffold'/);
  assert.match(p.$where, /latitude between/);
  assert.match(p.$where, /longitude between/);
  assert.equal(p.$limit, '10000');
});

test('fetchSheds keeps only structures inside the survey circle', async () => {
  const { fetchSheds } = await import('../js/sources/sheds.js');
  const near = permit('2025-01-01', '2099-01-01', { bin: 'near', latitude: '40.7360', longitude: '-73.9911' });
  // Inside the bbox corner but ~540m from center.
  const corner = permit('2025-01-01', '2099-01-01', { bin: 'corner', latitude: '40.7393', longitude: '-73.9866' });
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => [near, corner] });
  const items = await fetchSheds({ lat: 40.7359, lon: -73.9911 }, 400, { fetchImpl, storage: null });
  assert.deepEqual(items.map((x) => x.id.split('|')[0]), ['near']);
});
