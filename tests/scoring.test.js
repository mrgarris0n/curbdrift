import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyShed, mayorsOutlasted, scoreShed, areaRating } from '../js/scoring.js';

test('classifyShed thresholds', () => {
  assert.equal(classifyShed(0.5), 'temporary');
  assert.equal(classifyShed(1), 'prolonged');
  assert.equal(classifyShed(3), 'semiPermanent');
  assert.equal(classifyShed(6), 'permanent');
});

test('mayorsOutlasted counts terms begun after chain start, up to today', () => {
  assert.equal(mayorsOutlasted(new Date('2017-10-20'), new Date('2026-11-06')), 2);
  assert.equal(mayorsOutlasted(new Date('2023-01-01'), new Date('2026-11-06')), 1);
  assert.equal(mayorsOutlasted(new Date('2026-06-01'), new Date('2026-11-06')), 0);
});

test('shed score caps at 100 for 9+ years', () => {
  const s = scoreShed({ chainStart: new Date('2017-10-01') }, new Date('2026-11-06'));
  assert.equal(s.score, 100);
  assert.equal(s.classKey, 'permanent');
});

test('shed score scales with years', () => {
  const s = scoreShed({ chainStart: new Date('2023-11-06') }, new Date('2026-11-06'));
  assert.ok(Math.abs(s.yearsContinuous - 3) < 0.01);
  assert.ok(Math.abs(s.score - 33.33) < 0.1);
  assert.equal(s.mayorsOutlasted, 1);
});

test('areaRating = min(100, sum/10), one decimal', () => {
  assert.equal(areaRating([{ score: 100 }, { score: 46 }]), 14.6);
  assert.equal(areaRating(Array(20).fill({ score: 100 })), 100);
  assert.equal(areaRating([]), 0);
});
