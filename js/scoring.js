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
