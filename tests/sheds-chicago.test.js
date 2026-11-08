import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupChicagoPermits, snapshotQuery, toSnapshot, fetchSheds, SNAPSHOT_URL, CHICAGO_SHED_DATASET } from '../js/sources/sheds-chicago.js';
import { shedsFromSnapshot } from '../js/sources/sheds.js';

const TODAY = new Date('2026-11-06T12:00:00Z');

// A Chicago building-permit row as the snapshot query returns it.
function permit(issued, extra = {}) {
  return {
    permit_: `P${issued}`, permit_type: 'PERMIT – EXPRESS PERMIT PROGRAM', issue_date: `${issued}T00:00:00.000`,
    street_number: '111', street_direction: 'E', street_name: 'CHESTNUT ST',
    latitude: '41.8983', longitude: '-87.6255',
    contact_1_type: 'OWNER', contact_1_name: 'CHESTNUT TOWER LLC',
    contact_2_type: 'CONTRACTOR-GENERAL CONTRACTOR', contact_2_name: 'LOOP SCAFFOLD CO',
    ...extra,
  };
}

test('a permit runs 365 days from its issue date', () => {
  const [s] = groupChicagoPermits([permit('2026-03-01')], TODAY);
  assert.equal(s.kind, 'S');
  assert.equal(s.latestExpiry.toISOString().slice(0, 10), '2027-03-01');
  assert.equal(s.chainStart.toISOString().slice(0, 10), '2026-03-01');
  assert.equal(groupChicagoPermits([permit('2025-11-01')], TODAY).length, 0, 'expired after its 365 days');
});

test('renewals within 60 days chain into one structure; a longer gap starts a new chain', () => {
  const chained = groupChicagoPermits([permit('2023-01-10'), permit('2024-02-01'), permit('2025-01-15'), permit('2026-01-20')], TODAY);
  assert.equal(chained.length, 1);
  assert.equal(chained[0].chainStart.toISOString().slice(0, 10), '2023-01-10');
  assert.equal(chained[0].renewals, 3);
  // 2023-01-10 expires 2024-01-10; the next permit 300 days later breaks the chain, and the
  // last one (26 days after 2024-11-05's expiry) continues the new one.
  const broken = groupChicagoPermits([permit('2023-01-10'), permit('2024-11-05'), permit('2025-12-01')], TODAY);
  assert.equal(broken[0].chainStart.toISOString().slice(0, 10), '2024-11-05');
});

test('a permit marked COMPLETE inside its year means the scaffold came down', () => {
  assert.equal(groupChicagoPermits([permit('2026-03-01', { permit_status: 'COMPLETE' })], TODAY).length, 0);
  assert.equal(groupChicagoPermits([permit('2026-03-01', { permit_status: 'ACTIVE' })], TODAY).length, 1);
});

test('structures are grouped by address', () => {
  const items = groupChicagoPermits([permit('2026-03-01'), permit('2026-04-01', { street_number: '125', street_direction: 'S', street_name: 'CLARK ST' })], TODAY);
  assert.deepEqual(items.map((s) => s.address).sort(), ['111 E CHESTNUT ST', '125 S CLARK ST']);
  assert.ok(items.every((s) => s.workType === 'Scaffold'));
});

test('owner and contractor come from the contact types', () => {
  const [s] = groupChicagoPermits([permit('2026-03-01')], TODAY);
  assert.equal(s.owner, 'CHESTNUT TOWER LLC');
  assert.equal(s.contractor, 'LOOP SCAFFOLD CO');
  const [t] = groupChicagoPermits([permit('2026-03-01', { contact_1_type: 'EXPEDITER', contact_2_type: 'WEB APPLICANT' })], TODAY);
  assert.equal(t.owner, '');
  assert.equal(t.contractor, '');
});

test('rows without coordinates or an issue date are skipped', () => {
  assert.equal(groupChicagoPermits([permit('2026-03-01', { latitude: undefined }), permit('2026-03-01', { issue_date: null })], TODAY).length, 0);
});

test('snapshotQuery asks for scaffold permits of both types since 2017, without the long description', () => {
  const q = snapshotQuery();
  assert.equal(CHICAGO_SHED_DATASET, 'ydr8-5enu');
  assert.match(q.$where, /permit_type='PERMIT - SCAFFOLDING'/);
  assert.match(q.$where, /PERMIT – EXPRESS PERMIT PROGRAM/);
  assert.match(q.$where, /TEMPORARY SCAFFOLD/);
  assert.match(q.$where, /issue_date >= '2017-01-01'/);
  assert.doesNotMatch(q.$select, /work_description/);
});

test('the snapshot has the same shape as New York\'s and trims to the survey circle', () => {
  const snapshot = JSON.parse(JSON.stringify(toSnapshot([permit('2026-03-01')], TODAY)));
  assert.equal(snapshot.generatedAt, TODAY.toISOString());
  const items = shedsFromSnapshot(snapshot, { lat: 41.8983, lon: -87.6255 }, 400, TODAY);
  assert.equal(items.length, 1);
  assert.equal(items[0].address, '111 E CHESTNUT ST');
  assert.equal(shedsFromSnapshot(snapshot, { lat: 41.8819, lon: -87.6278 }, 400, TODAY).length, 0, 'the Loop is ~1.8 km away');
});

test('fetchSheds reads the Chicago snapshot', async () => {
  const snapshot = toSnapshot([permit('2026-03-01')], TODAY);
  const urls = [];
  const fetchImpl = async (url) => { urls.push(url); return { ok: true, status: 200, json: async () => snapshot }; };
  const items = await fetchSheds({ lat: 41.8983, lon: -87.6255 }, 400, { fetchImpl });
  assert.deepEqual(urls, [SNAPSHOT_URL]);
  assert.equal(SNAPSHOT_URL, '/data/sheds-chicago.json');
  assert.equal(items.length, 1);
});

// New York only shows owners' business names. Chicago's owner contact can be a private person, so
// a name is shown only when it is clearly an organisation; otherwise it is withheld (not "missing").
test('organisations are named; private owners are withheld', () => {
  const owner = (name) => groupChicagoPermits([permit('2026-03-01', { contact_1_name: name })], TODAY)[0];
  for (const org of ['CHESTNUT TOWER LLC', 'THE IMPERIAL TOWERS CONDOMINIUM ASSOCIATION', 'DE PAUL UNIVERSITY', 'THE CHICAGO CLUB']) {
    assert.equal(owner(org).owner, org);
    assert.equal(owner(org).ownerWithheld, false);
  }
  const person = owner('JANE Q PUBLIC');
  assert.equal(person.owner, '');
  assert.equal(person.ownerWithheld, true);
});

test('contract annotations are stripped from owner names', () => {
  const [s] = groupChicagoPermits([permit('2026-03-01', { contact_1_name: 'JBC FUNDS 33 NORTH LASALLE LLC (“OWNER”)' })], TODAY);
  assert.equal(s.owner, 'JBC FUNDS 33 NORTH LASALLE LLC');
});
