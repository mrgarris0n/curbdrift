// Orchestration: locate → survey → render; tap the map to survey somewhere else.
import { RADIUS_M } from './config.js';
import { resolveStart } from './geo.js';
import { fetchSheds } from './sources/sheds.js';
import { fetchComplaints } from './sources/complaints.js';
import { fetchWeather, summarizeWeather } from './sources/weather.js';
import { scoreShed, scorePuddle, scoreDefect, areaRating } from './scoring.js';
import { municipal } from './themes/municipal.js';
import { createMap } from './map.js';
import { renderHeader, renderSummary, openSheet, closeSheet, showNotice } from './ui.js';

const theme = municipal;
const GEO_TIMEOUT_MS = 8000;

/** Give each item a code ("S-1", "P-2"…), numbered within its kind by descending score. */
export function assignCodes(items, th) {
  const byKind = { S: [], P: [], D: [] };
  for (const item of items) byKind[item.kind].push(item);
  return Object.entries(byKind).flatMap(([kind, list]) =>
    [...list].sort((a, b) => b.score - a.score).map((item, i) => ({ ...item, code: `${th.codePrefix[kind]}-${i + 1}` })),
  );
}

/**
 * The user's position, or null. The browser's own timeout only starts after permission is
 * granted, so an unanswered prompt would wait forever; our own timer caps the whole wait.
 */
export function locate(geolocation, timeoutMs = GEO_TIMEOUT_MS) {
  return new Promise((resolve) => {
    if (!geolocation) return resolve(null);
    const timer = setTimeout(() => resolve(null), timeoutMs);
    const done = (value) => { clearTimeout(timer); resolve(value); };
    try {
      geolocation.getCurrentPosition(
        (p) => done({ lat: p.coords.latitude, lon: p.coords.longitude }),
        () => done(null),
        { timeout: timeoutMs, maximumAge: 60000, enableHighAccuracy: true },
      );
    } catch {
      done(null);
    }
  });
}

async function main() {
  renderHeader(theme, RADIUS_M);
  renderSummary(theme, { counts: { S: 0, P: 0, D: 0 }, rating: 0, pending: true, errors: {} });

  const { center, verified } = resolveStart(await locate(navigator.geolocation));
  if (!verified) showNotice(theme.messages.defaultLocation);

  let surveyId = 0;
  const map = createMap(document.getElementById('map'), center, (pick) => survey(pick));
  map.setUser(center, theme.userLabel(verified));

  function survey(at) {
    const id = ++surveyId;
    const current = () => id === surveyId; // results from a superseded survey are discarded
    const today = new Date();
    let sheds = [];
    let puddles = [];
    let defects = [];
    const errors = {};

    closeSheet();
    map.setSurveyArea(at, RADIUS_M);
    map.fitTo(at, RADIUS_M, document.getElementById('summary').offsetHeight);

    const render = (pending) => {
      const items = assignCodes([...sheds, ...puddles, ...defects], theme);
      map.setItems(items, (item) => openSheet(theme, item, () => map.select(null)));
      const counts = { S: sheds.length, P: puddles.length, D: defects.length };
      renderSummary(theme, { counts, rating: areaRating(items), pending, errors });
    };
    render(true);

    const shedsDone = fetchSheds(at, RADIUS_M).then(
      (facts) => { if (current()) { sheds = facts.map((f) => scoreShed(f, today)); render(true); } },
      (err) => { if (current()) { errors.S = true; console.warn('sheds', err); } },
    );

    const weather = fetchWeather(at).then((h) => summarizeWeather(h, new Date()), (err) => { console.warn('weather', err); return null; });
    const complaintsDone = fetchComplaints(at, RADIUS_M).then(
      async (found) => {
        const w = await weather;
        if (!current()) return;
        puddles = found.puddles.map((p) => scorePuddle(p, w));
        defects = found.defects.map(scoreDefect);
      },
      (err) => { if (current()) { errors.P = true; errors.D = true; console.warn('311', err); } },
    );

    Promise.allSettled([shedsDone, complaintsDone]).then(() => { if (current()) render(false); });
  }

  survey(center);
}

if (typeof document !== 'undefined') main();
