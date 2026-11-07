import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRoute, MAX_POINTS } from '../api/route.js';

const UNION_SQ = { lat: 40.7359, lon: -73.9911 };
const NEAR = { lat: 40.7372, lon: -73.9925 };
const req = (body, method = 'POST') => new Request('https://curbdrift.example/api/route', {
  method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined,
});

// Shape of an OpenRouteService /v2/directions/foot-walking/geojson answer (trimmed).
const orsAnswer = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[-73.9911, 40.7359], [-73.9918, 40.7365], [-73.9925, 40.7372], [-73.9911, 40.7359]] },
    properties: { summary: { distance: 412.3, duration: 296.9 }, segments: [{ distance: 206.1, duration: 148.4 }, { distance: 206.2, duration: 148.5 }] },
  }],
};

function upstream(body, status = 200) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { impl, calls };
}

test('routes a walk through OpenRouteService with the key added server-side', async () => {
  const u = upstream(orsAnswer);
  const res = await handleRoute(req({ points: [UNION_SQ, NEAR, UNION_SQ] }), { key: 'secret-key', fetchImpl: u.impl });
  assert.equal(res.status, 200);
  // api.openrouteservice.org was retired in Nov 2026 in favour of api.heigit.org.
  assert.equal(u.calls[0].url, 'https://api.heigit.org/openrouteservice/v2/directions/foot-walking/geojson');
  assert.equal(u.calls[0].init.method, 'POST');
  assert.equal(u.calls[0].init.headers.Authorization, 'secret-key');
  const sent = JSON.parse(u.calls[0].init.body);
  assert.deepEqual(sent.coordinates, [[-73.9911, 40.7359], [-73.9925, 40.7372], [-73.9911, 40.7359]]); // [lon, lat]
  // Per-leg segments only come back with instructions on (the default), so never switch them off.
  assert.notEqual(sent.instructions, false);
  const body = await res.json();
  assert.deepEqual(body, {
    distanceM: 412.3,
    durationS: 296.9,
    legs: [{ distanceM: 206.1, durationS: 148.4 }, { distanceM: 206.2, durationS: 148.5 }],
    path: [[40.7359, -73.9911], [40.7365, -73.9918], [40.7372, -73.9925], [40.7359, -73.9911]], // [lat, lon]
  });
});

test('the key never appears in the response', async () => {
  const u = upstream(orsAnswer);
  const res = await handleRoute(req({ points: [UNION_SQ, NEAR] }), { key: 'secret-key', fetchImpl: u.impl });
  assert.doesNotMatch(await res.text(), /secret-key/);
  for (const [, v] of res.headers) assert.doesNotMatch(v, /secret-key/);
});

test('without a configured key it answers 503 and calls nobody', async () => {
  const u = upstream(orsAnswer);
  const res = await handleRoute(req({ points: [UNION_SQ, NEAR] }), { key: '', fetchImpl: u.impl });
  assert.equal(res.status, 503);
  assert.equal(u.calls.length, 0);
});

test('rejects anything that is not a curbdrift walk inside NYC', async () => {
  const u = upstream(orsAnswer);
  const bad = [
    { points: [UNION_SQ] }, // too few
    { points: Array(MAX_POINTS + 1).fill(UNION_SQ) }, // too many
    { points: [UNION_SQ, { lat: 47.4979, lon: 19.0402 }] }, // Budapest
    { points: [UNION_SQ, { lat: 'x', lon: -73.99 }] },
    { points: 'nope' },
    {},
  ];
  for (const body of bad) assert.equal((await handleRoute(req(body), { key: 'k', fetchImpl: u.impl })).status, 400, JSON.stringify(body).slice(0, 60));
  assert.equal(MAX_POINTS, 14); // start + 12 stops + return
  assert.equal(u.calls.length, 0);
});

test('only POST is allowed', async () => {
  const u = upstream(orsAnswer);
  assert.equal((await handleRoute(req(null, 'GET'), { key: 'k', fetchImpl: u.impl })).status, 405);
});

test('upstream errors pass their status through, uncached; a malformed answer is a 502', async () => {
  let u = upstream({ error: 'quota' }, 429);
  let res = await handleRoute(req({ points: [UNION_SQ, NEAR] }), { key: 'k', fetchImpl: u.impl });
  assert.equal(res.status, 429);
  assert.match(res.headers.get('cache-control'), /no-store/);
  u = upstream({ type: 'FeatureCollection', features: [] });
  assert.equal((await handleRoute(req({ points: [UNION_SQ, NEAR] }), { key: 'k', fetchImpl: u.impl })).status, 502);
  const down = async () => { throw new TypeError('fetch failed'); };
  assert.equal((await handleRoute(req({ points: [UNION_SQ, NEAR] }), { key: 'k', fetchImpl: down })).status, 502);
});
