import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CREDITS } from '../js/credits.js';
import { THEMES } from '../js/themes/index.js';

test('credits name the developer, the repo and the inspiration', () => {
  assert.equal(CREDITS.developer, 'Gergely Karácsonyi');
  assert.equal(CREDITS.repo, 'https://github.com/mrgarris0n/curbdrift');
  assert.equal(CREDITS.inspiration, 'John Wilson');
});

test('credits list every data source the app uses, each with an https link', () => {
  const urls = CREDITS.sources.map((s) => s.url).join(' ');
  for (const needle of ['rbx6-tga4', 'erm2-nwe9', 'open-meteo.com', 'openstreetmap.org/copyright']) assert.ok(urls.includes(needle), needle);
  for (const s of CREDITS.sources) {
    assert.ok(s.name && s.provider, JSON.stringify(s));
    assert.match(s.url, /^https:\/\//);
  }
});

for (const theme of Object.values(THEMES)) {
  test(`${theme.id}: has credits copy`, () => {
    const c = theme.credits;
    for (const k of ['button', 'title', 'developer', 'code', 'sources', 'builtWith']) assert.ok(c?.[k], `${theme.id}.credits.${k}`);
    assert.match(c.inspiredBy('John Wilson'), /inspired by the works of John Wilson/i);
    const all = [...Object.values(c).filter((v) => typeof v === 'string'), c.inspiredBy('John Wilson')];
    for (const s of all) assert.doesNotMatch(s, /\p{Extended_Pictographic}/u, s);
  });
}
