import { test } from 'node:test';
import assert from 'node:assert/strict';
import { injectToken } from '../scripts/build.mjs';

const SOURCE = "// comment\nexport const SOCRATA_APP_TOKEN = '';\nexport const RADIUS_M = 400;\n";

test('injectToken fills the placeholder', () => {
  const out = injectToken(SOURCE, 'abc123');
  assert.match(out, /export const SOCRATA_APP_TOKEN = "abc123";/);
  assert.match(out, /export const RADIUS_M = 400;/);
});

test('injectToken leaves the source unchanged when no token is set', () => {
  assert.equal(injectToken(SOURCE, ''), SOURCE);
  assert.equal(injectToken(SOURCE, undefined), SOURCE);
});

test('injectToken escapes quotes so the token cannot break out of the string', () => {
  const out = injectToken(SOURCE, 'a"b\'c');
  assert.match(out, /SOCRATA_APP_TOKEN = "a\\"b'c";/);
});

test('injectToken fails loudly if the placeholder line is missing', () => {
  assert.throws(() => injectToken('export const OTHER = 1;', 'abc'), /placeholder/);
});
