/*
 * Scoring. Turns facts into numbers and classification keys. No user-facing words here;
 * themes translate keys into copy.
 *
 * Formulas (see docs/superpowers/specs/2026-11-06-curbdrift-decay-map-design.md §7.1):
 *
 *   Scaffold (S)
 *     yearsContinuous = (today − chainStart) / 365.25 days
 *     classKey        = <1 'temporary' | <3 'prolonged' | <6 'semiPermanent' | else 'permanent'
 *     mayorsOutlasted = the city's mayoral terms that began after chainStart and on/before today
 *     score           = min(100, yearsContinuous / 9 × 100)   (9 years ≈ all of DOB NOW history)
 *
 *   Puddle (P) — "Saturation Index", 0–100, two decimals; null when weather is unknown
 *     effectiveWater = max(0, rain72hMm − 1.05 × evaporationMm)
 *                      (evaporationMm = Σ FAO-56 reference evapotranspiration ET0 since the last rain;
 *                       1.05 is FAO-56 Table 12's coefficient for shallow open water)
 *     intensity      = min(peakHourMm72h / 7.6, 1)          (7.6 mm/h = 0.3 in/h, AMS "heavy rain";
 *                                                          also the best reference against FloodNet)
 *     burst          = intensity × exp(−hoursSincePeak / 24)  (0 when there was no rain hour)
 *     wetness        = max(min(effectiveWater / 20, 1), burst)
 *     susceptibility = floodProne ? 1 : 0.8   (on DEP's stormwater flood map or not. FloodNet sensors
 *                                             off the map flood 0.78× as often as those on it, at equal
 *                                             storm intensity: scripts/calibrate-puddles.py)
 *     weighted       = Σ complaints × DESCRIPTOR_WEIGHT[descriptor]
 *     repeat         = min(weighted, 5) / 5
 *     saturation     = 100 × wetness × susceptibility × (0.5 + 0.5 × repeat)
 *     The burst lets a short downpour outrun the drains even when the 72h total is modest or
 *     already offset by sun; it fades over about a day, independently of drying.
 *     statusKey      = null 'unknown' | <15 'dormant' | <60 'probable' | else 'peak'
 *     score          = saturation ?? 0
 *
 *   Defect (D)
 *     score = 60 open / 30 closed, +10 for 'Sidewalk Collapsed' or 'Cellar Door Open/Unprotected'
 *
 *   Area Deterioration Rating
 *     rating = mean of the 10 highest item scores, missing slots counting as 0, one decimal.
 *     Rewards both how bad the worst things are and having enough of them; unlike a capped sum,
 *     it does not saturate just because an area is dense (Manhattan has 150+ sheds per survey).
 */
import { DAY_MS } from './dates.js';

const round = (x, places) => Math.round(x * 10 ** places) / 10 ** places;

export function yearsBetween(a, b) {
  return (b - a) / DAY_MS / 365.25;
}

export function classifyShed(years) {
  if (years < 1) return 'temporary';
  if (years < 3) return 'prolonged';
  if (years < 6) return 'semiPermanent';
  return 'permanent';
}

/** termStarts: the surveyed city's mayoral term start dates (YYYY-MM-DD). */
export function mayorsOutlasted(chainStart, today, termStarts) {
  return termStarts.map((d) => new Date(`${d}T00:00:00Z`)).filter((d) => d > chainStart && d <= today).length;
}

export function scoreShed(facts, today, mayorTermStarts) {
  const yearsContinuous = Math.max(0, yearsBetween(facts.chainStart, today));
  return {
    ...facts,
    yearsContinuous,
    classKey: classifyShed(yearsContinuous),
    mayorsOutlasted: mayorsOutlasted(facts.chainStart, today, mayorTermStarts),
    score: Math.min(100, (yearsContinuous / 9) * 100),
  };
}

const RATING_TOP_N = 10;

export function areaRating(scoredItems) {
  const worst = scoredItems.map((item) => item.score || 0).sort((a, b) => b - a).slice(0, RATING_TOP_N);
  return round(worst.reduce((acc, s) => acc + s, 0) / RATING_TOP_N, 1);
}

const HEAVY_RAIN_MM_H = 7.6;
// FAO-56 Table 12, "Open Water, < 2 m depth": evaporation = 1.05 × ET0. Dark asphalt absorbs more
// sun than ET0's reference grass, so real puddles may dry a little faster; this is the cautious end.
const OPEN_WATER_KC = 1.05;

/**
 * How much one complaint of each kind says about pooling water: the share of that descriptor's
 * complaints that rain triggered, (share on rain days − 0.48) / 0.52 over Nov 2025–Nov 2026,
 * scaled so the most rain-driven is 1. Sunken, damaged or missing basins are reported whatever
 * the weather, so they say little. Reproduce with scripts/calibrate-puddles.py.
 */
export const DESCRIPTOR_WEIGHT = Object.freeze({
  'Flooding on Street': 1,
  'Street Flooding (SJ)': 0.8,
  'Catch Basin Clogged': 0.7,
  'Catch Basin Clogged/Flooding (Use Comments) (SC)': 0.5,
  'Catch Basin Sunken': 0.2,
  'Catch Basin Grating Missing (SA4)': 0.2,
  'Catch Basin Sunken/Damaged/Raised (SC1)': 0,
  // Chicago 311 request types (same method, Midway rain): see scripts/calibrate-puddles.py.
  'Water On Street Complaint': 1,
  'Alley Sewer Inspection Request': 0.6,
  'Sewer Cleaning Inspection Request': 0.5,
  'Sewer Cave-In Inspection Request': 0.2,
});

/** Complaints counted by how much each kind says about pooling water (DESCRIPTOR_WEIGHT). */
export function weightedComplaints(byDescriptor) {
  return Object.entries(byDescriptor).reduce((sum, [d, n]) => sum + n * DESCRIPTOR_WEIGHT[d], 0);
}

/** facts: {byDescriptor, floodProne}. */
export function saturationIndex({ byDescriptor, floodProne }, weather) {
  if (!weather) return null;
  const effectiveWater = Math.max(0, weather.rain72hMm - OPEN_WATER_KC * weather.evaporationMm);
  const intensity = Math.min((weather.peakHourMm72h ?? 0) / HEAVY_RAIN_MM_H, 1);
  const burst = weather.hoursSincePeak == null ? 0 : intensity * Math.exp(-weather.hoursSincePeak / 24);
  const wetness = Math.max(Math.min(effectiveWater / 20, 1), burst);
  const repeat = Math.min(weightedComplaints(byDescriptor), 5) / 5;
  const susceptibility = floodProne ? 1 : 0.8;
  return round(100 * wetness * susceptibility * (0.5 + 0.5 * repeat), 2);
}

export function puddleStatus(saturation) {
  if (saturation === null || saturation === undefined) return 'unknown';
  if (saturation < 15) return 'dormant';
  if (saturation < 60) return 'probable';
  return 'peak';
}

export function scorePuddle(facts, weather) {
  const saturation = saturationIndex(facts, weather);
  return { ...facts, saturation, statusKey: puddleStatus(saturation), score: saturation ?? 0 };
}

const SEVERE_DEFECTS = new Set(['Sidewalk Collapsed', 'Cellar Door Open/Unprotected']);

export function scoreDefect(facts) {
  return { ...facts, score: (facts.closed ? 30 : 60) + (SEVERE_DEFECTS.has(facts.descriptor) ? 10 : 0) };
}
