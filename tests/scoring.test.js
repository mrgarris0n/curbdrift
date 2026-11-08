import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyShed, mayorsOutlasted, scoreShed, areaRating } from '../js/scoring.js';
import { CITIES } from '../js/cities.js';

const NYC_MAYORS = CITIES.nyc.mayorTermStarts;

// n complaints of one descriptor; 'Flooding on Street' carries full weight.
const filed = (n, descriptor = 'Flooding on Street') => ({ complaintCount: n, byDescriptor: n ? { [descriptor]: n } : {} });

test('classifyShed thresholds', () => {
  assert.equal(classifyShed(0.5), 'temporary');
  assert.equal(classifyShed(1), 'prolonged');
  assert.equal(classifyShed(3), 'semiPermanent');
  assert.equal(classifyShed(6), 'permanent');
});

test('mayorsOutlasted counts terms begun after chain start, up to today', () => {
  assert.equal(mayorsOutlasted(new Date('2017-10-20'), new Date('2026-11-06'), NYC_MAYORS), 2);
  assert.equal(mayorsOutlasted(new Date('2023-01-01'), new Date('2026-11-06'), NYC_MAYORS), 1);
  assert.equal(mayorsOutlasted(new Date('2026-06-01'), new Date('2026-11-06'), NYC_MAYORS), 0);
});

test('shed score caps at 100 for 9+ years', () => {
  const s = scoreShed({ chainStart: new Date('2017-10-01') }, new Date('2026-11-06'), NYC_MAYORS);
  assert.equal(s.score, 100);
  assert.equal(s.classKey, 'permanent');
});

test('shed score scales with years', () => {
  const s = scoreShed({ chainStart: new Date('2023-11-06') }, new Date('2026-11-06'), NYC_MAYORS);
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
  assert.equal(saturationIndex({ ...filed(3), floodProne: true }, null), null);
  assert.equal(puddleStatus(null), 'unknown');
});

test('saturationIndex: dry week is dormant', async () => {
  const { saturationIndex, puddleStatus } = await import('../js/scoring.js');
  const s = saturationIndex({ ...filed(5), floodProne: true }, { rain72hMm: 0, evaporationMm: 0 });
  assert.equal(s, 0);
  assert.equal(puddleStatus(s), 'dormant');
});

test('saturationIndex: heavy rain at repeat offender is peak', async () => {
  const { saturationIndex, puddleStatus } = await import('../js/scoring.js');
  const s = saturationIndex({ ...filed(5), floodProne: true }, { rain72hMm: 30, evaporationMm: 0 });
  assert.equal(s, 100);
  assert.equal(puddleStatus(s), 'peak');
});

test('saturationIndex: single complaint after moderate rain is probable', async () => {
  const { saturationIndex, puddleStatus } = await import('../js/scoring.js');
  const s = saturationIndex({ ...filed(1), floodProne: true }, { rain72hMm: 10, evaporationMm: 0 });
  assert.equal(s, 30);
  assert.equal(puddleStatus(s), 'probable');
});

test('saturationIndex: evaporation dries it out', async () => {
  const { saturationIndex } = await import('../js/scoring.js');
  assert.equal(saturationIndex({ ...filed(5), floodProne: true }, { rain72hMm: 10, evaporationMm: 10 }), 0);
});

test('scorePuddle uses saturation as score, 0 when unknown', async () => {
  const { scorePuddle } = await import('../js/scoring.js');
  assert.equal(scorePuddle({ ...filed(5), floodProne: true }, { rain72hMm: 30, evaporationMm: 0 }).score, 100);
  const u = scorePuddle({ ...filed(5), floodProne: true }, null);
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

// Rain-intensity (burst) term. ET0 in NYC is about 1 mm/day in November and 5–6 mm/day in July.
test('saturationIndex: no rain with peak fields is 0', async () => {
  const { saturationIndex } = await import('../js/scoring.js');
  assert.equal(saturationIndex({ ...filed(5), floodProne: true }, { rain72hMm: 0, peakHourMm72h: 0, hoursSincePeak: null, evaporationMm: 0 }), 0);
});

test('saturationIndex: heavy one-hour burst 2h ago is at least probable', async () => {
  const { saturationIndex, puddleStatus } = await import('../js/scoring.js');
  const s = saturationIndex({ ...filed(1), floodProne: true }, { rain72hMm: 10, peakHourMm72h: 10, hoursSincePeak: 2, evaporationMm: 0.1 });
  assert.notEqual(puddleStatus(s), 'dormant');
  assert.notEqual(puddleStatus(s), 'unknown');
});

test('saturationIndex: the same burst 3 days ago, after three summer days, is dormant', async () => {
  const { saturationIndex, puddleStatus } = await import('../js/scoring.js');
  const s = saturationIndex({ ...filed(1), floodProne: true }, { rain72hMm: 10, peakHourMm72h: 10, hoursSincePeak: 70, evaporationMm: 16 });
  assert.equal(puddleStatus(s), 'dormant');
});

test('saturationIndex: a drizzle with the same 72h total scores lower than a burst', async () => {
  const { saturationIndex } = await import('../js/scoring.js');
  const base = { rain72hMm: 10, hoursSincePeak: 2, evaporationMm: 0.1 };
  const drizzle = saturationIndex({ ...filed(1), floodProne: true }, { ...base, peakHourMm72h: 0.5 });
  const burst = saturationIndex({ ...filed(1), floodProne: true }, { ...base, peakHourMm72h: 10 });
  assert.ok(burst > drizzle, `burst ${burst} should beat drizzle ${drizzle}`);
});

test('saturationIndex: a burst still counts when evaporation has offset the 72h total', async () => {
  const { saturationIndex, puddleStatus } = await import('../js/scoring.js');
  const s = saturationIndex({ ...filed(3), floodProne: true }, { rain72hMm: 6, peakHourMm72h: 6, hoursSincePeak: 5, evaporationMm: 7 });
  assert.equal(puddleStatus(s), 'probable');
});

// Flood-map susceptibility.
const WET = { rain72hMm: 30, evaporationMm: 0 };

test('saturationIndex: complaint-only spots weigh 0.8 of flood-prone ones (FloodNet calibration)', async () => {
  const { saturationIndex, puddleStatus } = await import('../js/scoring.js');
  assert.equal(saturationIndex({ ...filed(5), floodProne: true }, WET), 100);
  assert.equal(saturationIndex({ ...filed(5), floodProne: false }, WET), 80);
  assert.equal(puddleStatus(saturationIndex({ ...filed(5), floodProne: false }, WET)), 'peak');
});

test('saturationIndex: a flood-only spot with no complaints tops out at 50', async () => {
  const { saturationIndex, puddleStatus } = await import('../js/scoring.js');
  const s = saturationIndex({ ...filed(0), floodProne: true }, WET);
  assert.equal(s, 50);
  assert.equal(puddleStatus(s), 'probable');
});

test('saturationIndex: a flood-only spot is dormant on a dry day', async () => {
  const { saturationIndex, puddleStatus } = await import('../js/scoring.js');
  assert.equal(puddleStatus(saturationIndex({ ...filed(0), floodProne: true }, { rain72hMm: 0, evaporationMm: 0 })), 'dormant');
});

// Complaint weights (rain-triggered share per descriptor, scripts/calibrate-puddles.py).
test('every puddle descriptor has a weight between 0 and 1, weather-driven ones highest', async () => {
  const { DESCRIPTOR_WEIGHT } = await import('../js/scoring.js');
  const { PUDDLE_DESCRIPTORS } = await import('../js/sources/complaints.js');
  for (const d of PUDDLE_DESCRIPTORS) assert.ok(DESCRIPTOR_WEIGHT[d] >= 0 && DESCRIPTOR_WEIGHT[d] <= 1, d);
  assert.equal(DESCRIPTOR_WEIGHT['Flooding on Street'], 1);
  assert.ok(DESCRIPTOR_WEIGHT['Street Flooding (SJ)'] > DESCRIPTOR_WEIGHT['Catch Basin Sunken']);
  assert.equal(DESCRIPTOR_WEIGHT['Catch Basin Sunken/Damaged/Raised (SC1)'], 0);
});

test('saturationIndex: structural basin complaints add no repeat evidence', async () => {
  const { saturationIndex } = await import('../js/scoring.js');
  const structural = saturationIndex({ ...filed(5, 'Catch Basin Sunken/Damaged/Raised (SC1)'), floodProne: true }, WET);
  assert.equal(structural, saturationIndex({ ...filed(0), floodProne: true }, WET));
});

test('saturationIndex: complaints count by their weight', async () => {
  const { saturationIndex } = await import('../js/scoring.js');
  // 5 × 0.5 = 2.5 weighted complaints → repeat 0.5 → 100 × 1 × 1 × 0.75
  assert.equal(saturationIndex({ ...filed(5, 'Catch Basin Clogged/Flooding (Use Comments) (SC)'), floodProne: true }, WET), 75);
});

// Drying is evaporation: 1.05 × ET0 (FAO-56 Table 12, shallow open water).
test('saturationIndex: evaporation removes 1.05 mm of water per mm of ET0', async () => {
  const { saturationIndex } = await import('../js/scoring.js');
  // 20 − 1.05 × 10 = 9.5 mm → wetness 0.475; five full-weight complaints on the flood map → × 1
  assert.equal(saturationIndex({ ...filed(5), floodProne: true }, { rain72hMm: 20, evaporationMm: 10 }), 47.5);
});

test('saturationIndex: the same rain a day ago stays wetter in November than in July', async () => {
  const { saturationIndex } = await import('../js/scoring.js');
  const day = (evaporationMm) => saturationIndex({ ...filed(2), floodProne: true }, { rain72hMm: 10, evaporationMm });
  assert.ok(day(1.1) > day(5.5), `November ${day(1.1)} vs July ${day(5.5)}`);
});

test('every Chicago puddle type has its rain-day weight', async () => {
  const { DESCRIPTOR_WEIGHT } = await import('../js/scoring.js');
  const { PUDDLE_TYPES } = await import('../js/sources/complaints-chicago.js');
  for (const t of PUDDLE_TYPES) assert.ok(DESCRIPTOR_WEIGHT[t] >= 0 && DESCRIPTOR_WEIGHT[t] <= 1, t);
  assert.equal(DESCRIPTOR_WEIGHT['Water On Street Complaint'], 1);
  assert.equal(DESCRIPTOR_WEIGHT['Alley Sewer Inspection Request'], 0.6);
  assert.equal(DESCRIPTOR_WEIGHT['Sewer Cleaning Inspection Request'], 0.5);
  assert.equal(DESCRIPTOR_WEIGHT['Sewer Cave-In Inspection Request'], 0.2);
});

test('weightedComplaints sums complaints by their weights', async () => {
  const { weightedComplaints } = await import('../js/scoring.js');
  assert.equal(weightedComplaints({ 'Flooding on Street': 2, 'Catch Basin Clogged/Flooding (Use Comments) (SC)': 1 }), 2.5);
  assert.equal(weightedComplaints({}), 0);
});
