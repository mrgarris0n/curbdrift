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
  assert.equal(saturationIndex({ complaintCount: 3, floodProne: true }, null), null);
  assert.equal(puddleStatus(null), 'unknown');
});

test('saturationIndex: dry week is dormant', async () => {
  const { saturationIndex, puddleStatus } = await import('../js/scoring.js');
  const s = saturationIndex({ complaintCount: 5, floodProne: true }, { rain72hMm: 0, dryingKWh: 0, meanTempC: 10 });
  assert.equal(s, 0);
  assert.equal(puddleStatus(s), 'dormant');
});

test('saturationIndex: heavy rain at repeat offender is peak', async () => {
  const { saturationIndex, puddleStatus } = await import('../js/scoring.js');
  const s = saturationIndex({ complaintCount: 5, floodProne: true }, { rain72hMm: 30, dryingKWh: 0, meanTempC: 10 });
  assert.equal(s, 100);
  assert.equal(puddleStatus(s), 'peak');
});

test('saturationIndex: single complaint after moderate rain is probable', async () => {
  const { saturationIndex, puddleStatus } = await import('../js/scoring.js');
  const s = saturationIndex({ complaintCount: 1, floodProne: true }, { rain72hMm: 10, dryingKWh: 0, meanTempC: 10 });
  assert.equal(s, 30);
  assert.equal(puddleStatus(s), 'probable');
});

test('saturationIndex: sun dries it out', async () => {
  const { saturationIndex } = await import('../js/scoring.js');
  assert.equal(saturationIndex({ complaintCount: 5, floodProne: true }, { rain72hMm: 10, dryingKWh: 10, meanTempC: 10 }), 0);
});

test('scorePuddle uses saturation as score, 0 when unknown', async () => {
  const { scorePuddle } = await import('../js/scoring.js');
  assert.equal(scorePuddle({ complaintCount: 5, floodProne: true }, { rain72hMm: 30, dryingKWh: 0, meanTempC: 10 }).score, 100);
  const u = scorePuddle({ complaintCount: 5, floodProne: true }, null);
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

// Rain-intensity (burst) term. A November day of sun is roughly 2–3 kWh/m².
test('saturationIndex: no rain with peak fields is 0', async () => {
  const { saturationIndex } = await import('../js/scoring.js');
  assert.equal(saturationIndex({ complaintCount: 5, floodProne: true }, { rain72hMm: 0, peakHourMm72h: 0, hoursSincePeak: null, dryingKWh: 0, meanTempC: 10 }), 0);
});

test('saturationIndex: heavy one-hour burst 2h ago is at least probable', async () => {
  const { saturationIndex, puddleStatus } = await import('../js/scoring.js');
  const s = saturationIndex({ complaintCount: 1, floodProne: true }, { rain72hMm: 10, peakHourMm72h: 10, hoursSincePeak: 2, dryingKWh: 0.3, meanTempC: 12 });
  assert.notEqual(puddleStatus(s), 'dormant');
  assert.notEqual(puddleStatus(s), 'unknown');
});

test('saturationIndex: the same burst 3 days ago, after sunny days, is dormant', async () => {
  const { saturationIndex, puddleStatus } = await import('../js/scoring.js');
  const s = saturationIndex({ complaintCount: 1, floodProne: true }, { rain72hMm: 10, peakHourMm72h: 10, hoursSincePeak: 70, dryingKWh: 7, meanTempC: 12 });
  assert.equal(puddleStatus(s), 'dormant');
});

test('saturationIndex: a drizzle with the same 72h total scores lower than a burst', async () => {
  const { saturationIndex } = await import('../js/scoring.js');
  const base = { rain72hMm: 10, hoursSincePeak: 2, dryingKWh: 0.3, meanTempC: 12 };
  const drizzle = saturationIndex({ complaintCount: 1, floodProne: true }, { ...base, peakHourMm72h: 0.5 });
  const burst = saturationIndex({ complaintCount: 1, floodProne: true }, { ...base, peakHourMm72h: 10 });
  assert.ok(burst > drizzle, `burst ${burst} should beat drizzle ${drizzle}`);
});

test('saturationIndex: a burst still counts when sun has offset the 72h total', async () => {
  const { saturationIndex, puddleStatus } = await import('../js/scoring.js');
  const s = saturationIndex({ complaintCount: 3, floodProne: true }, { rain72hMm: 6, peakHourMm72h: 6, hoursSincePeak: 5, dryingKWh: 4, meanTempC: 15 });
  assert.equal(puddleStatus(s), 'probable');
});

// Flood-map susceptibility.
const WET = { rain72hMm: 30, dryingKWh: 0, meanTempC: 10 };

test('saturationIndex: complaint-only spots weigh 0.6 of flood-prone ones', async () => {
  const { saturationIndex } = await import('../js/scoring.js');
  assert.equal(saturationIndex({ complaintCount: 5, floodProne: true }, WET), 100);
  assert.equal(saturationIndex({ complaintCount: 5, floodProne: false }, WET), 60);
});

test('saturationIndex: a flood-only spot with no complaints tops out at 50', async () => {
  const { saturationIndex, puddleStatus } = await import('../js/scoring.js');
  const s = saturationIndex({ complaintCount: 0, floodProne: true }, WET);
  assert.equal(s, 50);
  assert.equal(puddleStatus(s), 'probable');
});

test('saturationIndex: a flood-only spot is dormant on a dry day', async () => {
  const { saturationIndex, puddleStatus } = await import('../js/scoring.js');
  assert.equal(puddleStatus(saturationIndex({ complaintCount: 0, floodProne: true }, { rain72hMm: 0, dryingKWh: 0, meanTempC: 10 })), 'dormant');
});
