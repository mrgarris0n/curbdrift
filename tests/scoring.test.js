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

test('areaRating = mean of the 10 worst item scores (missing slots count as 0), one decimal', () => {
  assert.equal(areaRating([{ score: 100 }, { score: 46 }]), 14.6);
  assert.equal(areaRating([]), 0);
  // Only the worst ten count, so piling on more mediocre items cannot push it to 100.
  const dense = [...Array(10).fill({ score: 60 }), ...Array(150).fill({ score: 40 })];
  assert.equal(areaRating(dense), 60);
  // Ten items at the maximum is the only way to reach 100.
  assert.equal(areaRating(Array(10).fill({ score: 100 })), 100);
  assert.equal(areaRating([{ score: 33.33 }, { score: 33.33 }, { score: 33.34 }]), 10);
});

test('saturationIndex without weather is unknown', async () => {
  const { saturationIndex, puddleStatus } = await import('../js/scoring.js');
  assert.equal(saturationIndex(3, null), null);
  assert.equal(puddleStatus(null), 'unknown');
});

test('saturationIndex: dry week is dormant', async () => {
  const { saturationIndex, puddleStatus } = await import('../js/scoring.js');
  const s = saturationIndex(5, { rain72hMm: 0, dryingKWh: 0, meanTempC: 10 });
  assert.equal(s, 0);
  assert.equal(puddleStatus(s), 'dormant');
});

test('saturationIndex: heavy rain at repeat offender is peak', async () => {
  const { saturationIndex, puddleStatus } = await import('../js/scoring.js');
  const s = saturationIndex(5, { rain72hMm: 30, dryingKWh: 0, meanTempC: 10 });
  assert.equal(s, 100);
  assert.equal(puddleStatus(s), 'peak');
});

test('saturationIndex: single complaint after moderate rain is probable', async () => {
  const { saturationIndex, puddleStatus } = await import('../js/scoring.js');
  const s = saturationIndex(1, { rain72hMm: 10, dryingKWh: 0, meanTempC: 10 });
  assert.equal(s, 30);
  assert.equal(puddleStatus(s), 'probable');
});

test('saturationIndex: sun dries it out', async () => {
  const { saturationIndex } = await import('../js/scoring.js');
  assert.equal(saturationIndex(5, { rain72hMm: 10, dryingKWh: 10, meanTempC: 10 }), 0);
});

test('scorePuddle uses saturation as score, 0 when unknown', async () => {
  const { scorePuddle } = await import('../js/scoring.js');
  assert.equal(scorePuddle({ complaintCount: 5 }, { rain72hMm: 30, dryingKWh: 0, meanTempC: 10 }).score, 100);
  const u = scorePuddle({ complaintCount: 5 }, null);
  assert.equal(u.score, 0);
  assert.equal(u.statusKey, 'unknown');
  assert.equal(u.saturation, null);
});

test('scoreDefect', async () => {
  const { scoreDefect } = await import('../js/scoring.js');
  assert.equal(scoreDefect({ descriptor: 'Broken Sidewalk', closed: false }).score, 60);
  assert.equal(scoreDefect({ descriptor: 'Broken Sidewalk', closed: true }).score, 30);
  assert.equal(scoreDefect({ descriptor: 'Sidewalk Collapsed', closed: false }).score, 70);
  assert.equal(scoreDefect({ descriptor: 'Cellar Door Open/Unprotected', closed: true }).score, 40);
});
