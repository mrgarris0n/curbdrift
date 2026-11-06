/*
 * Scoring. Turns facts into numbers and classification keys. No user-facing words here;
 * themes translate keys into copy.
 *
 * Formulas (see docs/superpowers/specs/2026-11-06-curbdrift-decay-map-design.md §7.1):
 *
 *   Scaffold (S)
 *     yearsContinuous = (today − chainStart) / 365.25 days
 *     classKey        = <1 'temporary' | <3 'prolonged' | <6 'semiPermanent' | else 'permanent'
 *     mayorsOutlasted = mayoral terms that began after chainStart and on/before today
 *     score           = min(100, yearsContinuous / 9 × 100)   (9 years ≈ all of DOB NOW history)
 *
 *   Puddle (P) — "Saturation Index", 0–100, two decimals; null when weather is unknown
 *     effectiveWater = max(0, rain72hMm − 1.2 × dryingKWh × (1 + max(0, meanTempC)/25))
 *     repeat         = min(complaintCount, 5) / 5
 *     saturation     = 100 × min(effectiveWater / 20, 1) × (0.5 + 0.5 × repeat)
 *     statusKey      = null 'unknown' | <15 'dormant' | <60 'probable' | else 'peak'
 *     score          = saturation ?? 0
 *
 *   Defect (D)
 *     score = 60 open / 30 closed, +10 for 'Sidewalk Collapsed' or 'Cellar Door Open/Unprotected'
 *
 *   Area Deterioration Rating
 *     rating = min(100, Σ item scores / 10), rounded to one decimal
 */
import { MAYOR_TERM_STARTS } from './config.js';
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

export function mayorsOutlasted(chainStart, today) {
  return MAYOR_TERM_STARTS.map((d) => new Date(`${d}T00:00:00Z`)).filter((d) => d > chainStart && d <= today).length;
}

export function scoreShed(facts, today) {
  const yearsContinuous = Math.max(0, yearsBetween(facts.chainStart, today));
  return {
    ...facts,
    yearsContinuous,
    classKey: classifyShed(yearsContinuous),
    mayorsOutlasted: mayorsOutlasted(facts.chainStart, today),
    score: Math.min(100, (yearsContinuous / 9) * 100),
  };
}

export function areaRating(scoredItems) {
  const sum = scoredItems.reduce((acc, item) => acc + (item.score || 0), 0);
  return Math.min(100, round(sum / 10, 1));
}

export function saturationIndex(complaintCount, weather) {
  if (!weather) return null;
  const tempFactor = 1 + Math.max(0, weather.meanTempC) / 25;
  const effectiveWater = Math.max(0, weather.rain72hMm - 1.2 * weather.dryingKWh * tempFactor);
  const repeat = Math.min(complaintCount, 5) / 5;
  return round(100 * Math.min(effectiveWater / 20, 1) * (0.5 + 0.5 * repeat), 2);
}

export function puddleStatus(saturation) {
  if (saturation === null || saturation === undefined) return 'unknown';
  if (saturation < 15) return 'dormant';
  if (saturation < 60) return 'probable';
  return 'peak';
}

export function scorePuddle(facts, weather) {
  const saturation = saturationIndex(facts.complaintCount, weather);
  return { ...facts, saturation, statusKey: puddleStatus(saturation), score: saturation ?? 0 };
}

const SEVERE_DEFECTS = new Set(['Sidewalk Collapsed', 'Cellar Door Open/Unprotected']);

export function scoreDefect(facts) {
  return { ...facts, score: (facts.closed ? 30 : 60) + (SEVERE_DEFECTS.has(facts.descriptor) ? 10 : 0) };
}
