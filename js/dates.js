const DAY_MS = 86400000;
export { DAY_MS };

/**
 * Parse an API timestamp. Socrata returns "floating" times without a zone
 * ("2017-10-20T00:00:00.000"); treat them as UTC so day math is the same in every
 * browser time zone. Returns null for anything unparseable.
 */
export function parseApiDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  let s = value;
  if (s.length === 10) s += 'T00:00:00Z';
  else if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) s += 'Z';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** YYYY-MM-DD in UTC, for SoQL date comparisons. */
export function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

/** The same calendar instant `months` months earlier (UTC). */
export function monthsBefore(date, months) {
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}
