import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CREDITS } from '../js/credits.js';
import { THEMES } from '../js/themes/index.js';

test('credits name the developer, the repo and the inspirations', () => {
  assert.equal(CREDITS.developer, 'Gergely Karácsonyi');
  assert.equal(CREDITS.repo, 'https://github.com/mrgarris0n/curbdrift');
  assert.deepEqual(CREDITS.inspirations, ['John Wilson', 'Nathan Fielder']);
});

test('credits list every data source the app uses, each with an https link', () => {
  const urls = CREDITS.sources.map((s) => s.url).join(' ');
  for (const needle of ['rbx6-tga4', 'erm2-nwe9', '9i7c-xyvv', 'open-meteo.com', 'openstreetmap.org/copyright']) assert.ok(urls.includes(needle), needle);
  for (const s of CREDITS.sources) {
    assert.ok(s.name && s.provider, JSON.stringify(s));
    assert.match(s.url, /^https:\/\//);
  }
});

for (const theme of Object.values(THEMES)) {
  test(`${theme.id}: has credits copy`, () => {
    const c = theme.credits;
    for (const k of ['button', 'title', 'developer', 'code', 'sources', 'builtWith']) assert.ok(c?.[k], `${theme.id}.credits.${k}`);
    assert.match(c.inspiredBy(['John Wilson']), /inspired by the works of John Wilson\b/i);
    assert.match(c.inspiredBy(['John Wilson', 'Nathan Fielder']), /inspired by the works of John Wilson and Nathan Fielder\b/i);
    assert.match(c.inspiredBy(['A', 'B', 'C']), /works of A, B and C\b/);
    const all = [...Object.values(c).filter((v) => typeof v === 'string'), c.inspiredBy(CREDITS.inspirations)];
    for (const s of all) assert.doesNotMatch(s, /\p{Extended_Pictographic}/u, s);
  });
}

test('credits disclaim any affiliation with or endorsement by the City of New York', () => {
  assert.match(CREDITS.disclaimer, /not affiliated with, endorsed by, or sponsored by the City of New York/);
});

test('credits include the walking router', () => {
  // Compare the parsed host: a substring match would also accept https://elsewhere.example/openrouteservice.org.
  assert.ok(CREDITS.sources.some((s) => new URL(s.url).hostname === 'openrouteservice.org'));
});
