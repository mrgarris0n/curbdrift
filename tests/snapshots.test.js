import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, snapshotFor, snapshotVersion, SOURCES, REUSE_MAX_AGE_MS } from '../scripts/snapshots.mjs';

const source = (id) => SOURCES.find((s) => s.id === id);
const NYC = source('nyc sheds');

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
  const { snapshot, rows } = await buildSnapshot(NYC, { token: 'secret', fetchImpl, now: NOW, min: 1 });
  assert.equal(rows, 50001);
  assert.equal(snapshot.sheds.length, 50001);
  assert.equal(snapshot.generatedAt, NOW.toISOString());
  const bodies = calls.map((c) => JSON.parse(c.init.body));
  assert.deepEqual(bodies.map((b) => b.page), [{ pageNumber: 1, pageSize: 50000 }, { pageNumber: 2, pageSize: 50000 }]);
  assert.match(bodies[0].query, /^SELECT bin,.* WHERE work_type in\(.*\) ORDER BY :id$/);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].url.href, 'https://data.cityofnewyork.us/api/v3/views/rbx6-tga4/query.json');
  assert.equal(calls[0].init.headers['X-App-Token'], 'secret');
});

test('retries a failed page', async () => {
  let n = 0;
  const fetchImpl = async () => (++n === 1 ? new Response('busy', { status: 503 }) : ok([row('a')]));
  const { snapshot } = await buildSnapshot(NYC, { token: 'secret', fetchImpl, now: NOW, retryDelayMs: 1, min: 1 });
  assert.equal(n, 2);
  assert.equal(snapshot.sheds.length, 1);
});

test('gives up after repeated failures, so the build fails', async () => {
  const fetchImpl = async () => new Response('busy', { status: 503 });
  await assert.rejects(buildSnapshot(NYC, { token: 'secret', fetchImpl, now: NOW, retryDelayMs: 1 }), /HTTP 503/);
});

test('refuses to publish a suspiciously small snapshot', async () => {
  const fetchImpl = async () => ok([row('a')]);
  await assert.rejects(buildSnapshot(NYC, { token: 'secret', fetchImpl, now: NOW }), /refusing to publish/);
});

test('Chicago builds from its own portal and dataset, with its own floor', async () => {
  const chicagoRow = { permit_: 'P1', permit_type: 'PERMIT – EXPRESS PERMIT PROGRAM', issue_date: '2026-03-01T00:00:00.000', street_number: '1', street_direction: 'N', street_name: 'STATE ST', latitude: '41.88', longitude: '-87.63' };
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url: new URL(url), init }); return ok([chicagoRow]); };
  const { snapshot } = await buildSnapshot(source('chicago sheds'), { token: 'secret', fetchImpl, now: NOW, min: 1 });
  assert.equal(calls[0].url.href, 'https://data.cityofchicago.org/api/v3/views/ydr8-5enu/query.json');
  assert.equal(calls[0].init.headers['X-App-Token'], 'secret');
  assert.equal(snapshot.sheds[0].address, '1 N STATE ST');
  await assert.rejects(buildSnapshot(source('chicago sheds'), { token: 'secret', fetchImpl, now: NOW }), /chicago.*refusing to publish/);
});

test('every source has its own file', () => {
  assert.deepEqual(SOURCES.map((s) => s.file).sort(), ['complaints-chicago.json', 'complaints.json', 'sheds-chicago.json', 'sheds.json']);
});

test('New York complaints: a year of the app\'s 311 types, citywide, into the compact snapshot', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: new URL(url), query: JSON.parse(init.body).query });
    return ok([{ unique_key: '1', complaint_type: 'Sewer', descriptor: 'Street Flooding (SJ)', created_date: '2026-10-01T10:00:00.000', status: 'Open', incident_address: 'X', latitude: '40.7', longitude: '-73.9' }]);
  };
  const { snapshot } = await buildSnapshot(source('nyc complaints'), { token: 'secret', fetchImpl, now: NOW, min: 1 });
  assert.equal(calls[0].url.pathname, '/api/v3/views/erm2-nwe9/query.json');
  assert.match(calls[0].query, / WHERE created_date > '2025-11-06' AND /);
  assert.doesNotMatch(calls[0].query, /within_circle/);
  assert.deepEqual(snapshot.types, [['P', 'Street Flooding (SJ)']]);
  assert.deepEqual(snapshot.complaints, [['1', 0, 40.7, -73.9, '2026-10-01', 0, '']]);
  await assert.rejects(buildSnapshot(source('nyc complaints'), { token: 'secret', fetchImpl, now: NOW }), /nyc complaints.*refusing to publish/);
});

test('Chicago complaints come from Chicago\'s 311 dataset', async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(new URL(url)); return ok([]); };
  await buildSnapshot(source('chicago complaints'), { token: 'secret', fetchImpl, now: NOW, min: 0 });
  assert.equal(calls[0].href, 'https://data.cityofchicago.org/api/v3/views/v6vf-nfxy/query.json');
});

// snapshotFor: production (curbdrift.example) serves `copy`; Socrata answers with `socrata`.
function world({ copy = null, socrata = () => ok([row('a')]) } = {}) {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    if (String(url).startsWith('https://curbdrift.example/')) return copy ? ok(copy) : new Response('not found', { status: 404 });
    return socrata();
  };
  const socrataCalls = () => urls.filter((u) => !u.startsWith('https://curbdrift.example/')).length;
  return { fetchImpl, urls, socrataCalls };
}
const hoursAgo = (h) => new Date(NOW - h * 3600 * 1000).toISOString();
const copyOf = (source, { version = snapshotVersion(source), generatedAt = hoursAgo(2) } = {}) => ({ generatedAt, version, sheds: [], types: [], complaints: [] });
const opts = (w) => ({ host: 'curbdrift.example', token: 'secret', fetchImpl: w.fetchImpl, now: NOW, retryDelayMs: 1, min: 1 });
const quietly = async (fn) => {
  const warn = console.warn;
  console.warn = () => {};
  try { return await fn(); } finally { console.warn = warn; }
};

test('a recent production copy of the same version is reused, without asking Socrata', async () => {
  const copy = copyOf(NYC);
  const w = world({ copy });
  const got = await snapshotFor(NYC, opts(w));
  assert.deepEqual(got, { snapshot: copy, from: 'reused' });
  assert.deepEqual(w.urls, ['https://curbdrift.example/data/sheds.json']);
});

test('a copy older than the reuse age is downloaded again (the daily cron\'s case)', async () => {
  assert.equal(REUSE_MAX_AGE_MS, 12 * 3600 * 1000);
  const w = world({ copy: copyOf(NYC, { generatedAt: hoursAgo(24) }) });
  const got = await snapshotFor(NYC, opts(w));
  assert.equal(got.from, 'downloaded');
  assert.equal(got.rows, 1);
  assert.equal(got.snapshot.version, snapshotVersion(NYC));
  assert.equal(got.snapshot.generatedAt, NOW.toISOString());
});

test('a copy of another version, or none, is never reused, however recent', async () => {
  const unversioned = copyOf(NYC);
  delete unversioned.version; // as the snapshots made before versions existed
  for (const copy of [copyOf(NYC, { version: '0-000000000000' }), unversioned]) {
    const w = world({ copy });
    const got = await snapshotFor(NYC, opts(w));
    assert.equal(got.from, 'downloaded', String(copy.version));
    assert.equal(w.socrataCalls(), 1);
  }
});

test('a failed download falls back to production\'s copy of the same version, whatever its age', async () => {
  const copy = copyOf(NYC, { generatedAt: hoursAgo(72) });
  const w = world({ copy, socrata: () => new Response('busy', { status: 503 }) });
  const got = await quietly(() => snapshotFor(NYC, opts(w)));
  assert.deepEqual(got, { snapshot: copy, from: 'fallback' });
});

test('a failed download with no usable copy fails the build, saying why', async () => {
  const failing = { socrata: () => new Response('busy', { status: 503 }) };
  await assert.rejects(snapshotFor(NYC, opts(world(failing))), /HTTP 503.*production's copy unavailable: HTTP 404/);
  await assert.rejects(snapshotFor(NYC, opts(world({ ...failing, copy: copyOf(NYC, { version: '0-old', generatedAt: hoursAgo(1) }) }))), /HTTP 503.*copy is version 0-old, this build needs 1-/);
  await assert.rejects(snapshotFor(NYC, { ...opts(world(failing)), host: undefined }), /HTTP 503.*no production domain/);
});

test('the version follows the format number and the query, not the date', () => {
  const v = snapshotVersion(NYC);
  assert.match(v, /^1-[0-9a-f]{12}$/);
  assert.equal(snapshotVersion({ ...NYC }), v);
  assert.notEqual(snapshotVersion({ ...NYC, format: 2 }), v);
  assert.notEqual(snapshotVersion({ ...NYC, query: () => ({ ...NYC.query(), $where: 'x' }) }), v);
  const complaintsSource = source('nyc complaints');
  assert.notEqual(complaintsSource.query(NOW).$where, complaintsSource.query(new Date(0)).$where, 'the query itself moves with the date');
  assert.equal(snapshotVersion(complaintsSource), snapshotVersion(complaintsSource), 'the version does not');
});

test('without an app token the build stops before asking (SODA 3 requires one)', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return ok([]); };
  await assert.rejects(buildSnapshot(NYC, { token: '', fetchImpl, now: NOW, min: 0 }), /SOCRATA_APP_TOKEN is not set/);
  assert.equal(called, false);
});

test('a response that is not a row array is reported with what came back', async () => {
  const fetchImpl = async () => ok({ rows: [] });
  await assert.rejects(buildSnapshot(NYC, { token: 'secret', fetchImpl, now: NOW, retryDelayMs: 1, min: 0 }), /unexpected response shape: \{"rows":\[\]\}/);
});
