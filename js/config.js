// Fixed values for the decay survey. See docs/superpowers/specs/2026-11-06-curbdrift-decay-map-design.md.

// Union Square — verified to have sheds on record since 2017.
export const DEFAULT_CENTER = Object.freeze({ lat: 40.7359, lon: -73.9911 });

export const RADIUS_M = 400;
export const PUDDLE_WINDOW_MONTHS = 12;
export const DEFECT_WINDOW_MONTHS = 6;

// Permits separated by less than this many days count as one continuous structure.
export const SHED_GAP_DAYS = 60;

export const NYC_BBOX = Object.freeze({ south: 40.4774, north: 40.9176, west: -74.2591, east: -73.7004 });

// Start dates of mayoral terms (de Blasio, Adams, Mamdani).
export const MAYOR_TERM_STARTS = Object.freeze(['2014-01-01', '2022-01-01', '2026-01-01']);

export const CACHE_TTL_MS = 300000;
