import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShedSnapshot, SHED_SOURCES } from '../scripts/shed-snapshot.mjs';

const NYC = SHED_SOURCES.nyc;

const NOW = new Date('2026-11-06T12:00:00Z');
const row = (bin) => ({
  bin, job_filing_number: `J${bin}`, house_no: '1', street_name: 'MAIN STREET', work_type: 'Sidewalk Shed',
  issued_date: '2026-01-01T00:00:00.000', expired_date: '2027-01-01T00:00:00.000', permit_status: 'Permit Issued',
  latitude: '40.7', longitude: '-73.9',
});
const ok = (rows) => new Response(JSON.stringify(rows), { status: 200 });

test('pages through the dataset with the token and builds the snapshot', async () => {
  const pages = [Array.from({ length: 50000 }, (_, i) => row(String(i))), [row('last')]];
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url: new URL(url), init }); return ok(pages[calls.length - 1]); };
  const { snapshot, permits } = await buildShedSnapshot(NYC, { token: 'secret', fetchImpl, now: NOW, minStructures: 1 });
  assert.equal(permits, 50001);
  assert.equal(snapshot.sheds.length, 50001);
  assert.equal(snapshot.generatedAt, NOW.toISOString());
  assert.deepEqual(calls.map((c) => c.url.searchParams.get('$offset')), ['0', '50000']);
  assert.equal(calls[0].url.pathname, '/resource/rbx6-tga4.json');
  assert.equal(calls[0].init.headers['X-App-Token'], 'secret');
});

test('retries a failed page', async () => {
  let n = 0;
  const fetchImpl = async () => (++n === 1 ? new Response('busy', { status: 503 }) : ok([row('a')]));
  const { snapshot } = await buildShedSnapshot(NYC, { fetchImpl, now: NOW, retryDelayMs: 1, minStructures: 1 });
  assert.equal(n, 2);
  assert.equal(snapshot.sheds.length, 1);
});

test('gives up after repeated failures, so the build fails', async () => {
  const fetchImpl = async () => new Response('busy', { status: 503 });
  await assert.rejects(buildShedSnapshot(NYC, { fetchImpl, now: NOW, retryDelayMs: 1 }), /HTTP 503/);
});

test('refuses to publish a suspiciously small snapshot', async () => {
  const fetchImpl = async () => ok([row('a')]);
  await assert.rejects(buildShedSnapshot(NYC, { fetchImpl, now: NOW }), /refusing to publish/);
});

test('Chicago builds from its own portal and dataset, with its own floor', async () => {
  const chicagoRow = { permit_: 'P1', permit_type: 'PERMIT – EXPRESS PERMIT PROGRAM', issue_date: '2026-03-01T00:00:00.000', street_number: '1', street_direction: 'N', street_name: 'STATE ST', latitude: '41.88', longitude: '-87.63' };
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url: new URL(url), init }); return ok([chicagoRow]); };
  const { snapshot } = await buildShedSnapshot(SHED_SOURCES.chicago, { token: 'secret', fetchImpl, now: NOW, minStructures: 1 });
  assert.equal(calls[0].url.origin + calls[0].url.pathname, 'https://data.cityofchicago.org/resource/ydr8-5enu.json');
  assert.equal(calls[0].init.headers['X-App-Token'], 'secret');
  assert.equal(snapshot.sheds[0].address, '1 N STATE ST');
  await assert.rejects(buildShedSnapshot(SHED_SOURCES.chicago, { fetchImpl, now: NOW }), /chicago.*refusing to publish/);
});
