// Orchestration: locate → survey → render; tap the map to survey somewhere else.
import { RADIUS_M, DEFAULT_CENTER } from './config.js';
import { resolveStart } from './geo.js';
import { fetchSheds } from './sources/sheds.js';
import { fetchComplaints } from './sources/complaints.js';
import { fetchWeather, summarizeWeather } from './sources/weather.js';
import { scoreShed, scorePuddle, scoreDefect, areaRating } from './scoring.js';
import { THEMES, pickTheme } from './themes/index.js';
import { createMap } from './map.js';
import { renderHeader, renderSummary, openSheet, openRoute, closeSheet, isSheetOpen, showNotice, showResurvey, hideResurvey, refreshResurvey, focusThemeSwitch } from './ui.js';
import { planRoute } from './route.js';

const THEME_KEY = 'curbdrift.theme';

// The theme choice is a per-browser convenience; storage may be unavailable, so never rely on it.
function loadThemeId() {
  try { return globalThis.localStorage?.getItem(THEME_KEY) ?? null; } catch { return null; }
}
function saveThemeId(id) {
  try { globalThis.localStorage?.setItem(THEME_KEY, id); } catch { /* not remembered; fine */ }
}

let theme = pickTheme(typeof document !== 'undefined' ? loadThemeId() : null);
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
 * The user's position, or null after timeoutMs. The browser's own timeout only starts after
 * permission is granted, so an unanswered prompt would wait forever; our timer caps the wait.
 * A fix that arrives after the cap is handed to onLate instead of being thrown away.
 */
export function locate(geolocation, timeoutMs = GEO_TIMEOUT_MS, onLate = () => {}) {
  return new Promise((resolve) => {
    if (!geolocation) return resolve(null);
    let settled = false;
    const timer = setTimeout(() => { settled = true; resolve(null); }, timeoutMs);
    const success = (p) => {
      const pos = { lat: p.coords.latitude, lon: p.coords.longitude };
      if (settled) return onLate(pos);
      settled = true;
      clearTimeout(timer);
      resolve(pos);
    };
    const failure = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(null);
    };
    try {
      // A 400 m survey does not need GPS precision; the network fix is much faster.
      geolocation.getCurrentPosition(success, failure, { timeout: 30000, maximumAge: 60000, enableHighAccuracy: false });
    } catch {
      failure();
    }
  });
}

/**
 * Fetch and score all three layers. Each layer fails on its own: any error while fetching
 * *or processing* a layer marks it in `errors` rather than silently emptying it.
 * onSheds(scored) fires as soon as scaffolding is ready (it is the fast query).
 */
export async function gatherSurvey(at, today, sources = { fetchSheds, fetchComplaints, fetchWeather }, onSheds = () => {}, signal = undefined) {
  const result = { sheds: [], puddles: [], defects: [], errors: {} };

  const shedsDone = sources.fetchSheds(at, RADIUS_M, { signal })
    .then((facts) => { result.sheds = facts.map((f) => scoreShed(f, today)); onSheds(result.sheds); })
    .catch((err) => { result.errors.S = true; console.warn('sheds', err); });

  // Weather is optional: any failure (network or malformed data) means "unknown" saturation.
  const weather = sources.fetchWeather(at, { signal })
    .then((hourly) => summarizeWeather(hourly, new Date()))
    .catch((err) => { console.warn('weather', err); return null; });

  const complaintsDone = sources.fetchComplaints(at, RADIUS_M, { signal })
    .then(async (found) => {
      const w = await weather;
      result.puddles = found.puddles.map((p) => scorePuddle(p, w));
      result.defects = found.defects.map(scoreDefect);
    })
    .catch((err) => { result.puddles = []; result.defects = []; result.errors.P = true; result.errors.D = true; console.warn('311', err); });

  await Promise.all([shedsDone, complaintsDone]);
  return result;
}

async function main() {
  // What is on screen, kept so a theme switch can re-render it in the new voice.
  let rerender = () => renderSummary(theme, { counts: { S: 0, P: 0, D: 0 }, rating: 0, pending: true, errors: {} });
  let reopenSheet = null;
  let user = null;
  let activeRoute = null; // the itinerary drawn on the map, if any
  let defaultNotice = false; // "surveyed the default location because yours is unknown"
  let inFlight = null; // AbortController of the survey whose requests are still running

  const renderNotice = () => showNotice(defaultNotice ? theme.messages.defaultLocation : '');

  function applyTheme() {
    document.documentElement.dataset.theme = theme.id;
    renderHeader(theme, RADIUS_M, switchTheme);
  }

  function switchTheme() {
    const sheetWasOpen = isSheetOpen();
    theme = Object.values(THEMES).find((t) => t.id !== theme.id);
    saveThemeId(theme.id);
    applyTheme();
    if (user) map.setUser(user.center, theme.userLabel(user.verified));
    renderNotice();
    refreshResurvey(theme);
    rerender();
    if (sheetWasOpen && reopenSheet) reopenSheet();
    focusThemeSwitch(); // keep focus on the control the user just used
  }

  applyTheme();
  rerender();

  let surveyId = 0;
  const panelHeight = () => document.getElementById('summary').offsetHeight;
  // The map shows immediately; the survey waits for a location (or the fallback).
  // Browsing the map never fetches: moving it only offers a re-survey button.
  const map = createMap(document.getElementById('map'), DEFAULT_CENTER, {
    onMapTap: () => { closeSheet(); map.select(null); },
    // The user chose this view: survey its center and leave zoom/position alone.
    onUserMove: () => showResurvey(theme, () => {
      defaultNotice = false; // the survey is now where the user put it, not a fallback
      renderNotice();
      survey(map.visibleCenter(panelHeight()), { fit: false });
    }),
  });

  function survey(at, { fit = true } = {}) {
    const id = ++surveyId;
    const current = () => id === surveyId; // results from a superseded survey are discarded
    inFlight?.abort(); // and its requests are cancelled, sparing the city API quota
    const controller = new AbortController();
    inFlight = controller;
    const today = new Date();

    closeSheet();
    hideResurvey();
    map.setRoute(null); // an itinerary belongs to the survey it was issued for
    activeRoute = null;
    map.setSurveyArea(at, RADIUS_M);
    if (fit) map.fitTo(at, RADIUS_M, panelHeight());

    const render = ({ sheds = [], puddles = [], defects = [], errors = {} }, pending) => {
      const items = assignCodes([...sheds, ...puddles, ...defects], theme);
      map.setItems(items, (item) => {
        reopenSheet = () => openSheet(theme, item, () => map.select(null));
        reopenSheet();
      });
      const counts = { S: sheds.length, P: puddles.length, D: defects.length };
      // The itinerary loops from the survey center through the items of this survey.
      // While a walk is drawn, the summary button brings its itinerary back (with the cancel
      // button) instead of planning a new one, so a dismissed itinerary is never stranded.
      const cancelRoute = () => { map.setRoute(null); activeRoute = null; rerender(); };
      const onRoute = () => {
        const fresh = !activeRoute;
        if (fresh) activeRoute = planRoute(at, items);
        const route = activeRoute;
        reopenSheet = () => openRoute(theme, route, cancelRoute);
        reopenSheet();
        if (!fresh) return;
        // After the sheet is open, so the view fits the loop above it.
        map.setRoute(route.stops.length ? [at, ...route.stops, at] : null, document.getElementById('sheet').offsetHeight);
        if (!route.stops.length) activeRoute = null;
        rerender();
      };
      renderSummary(theme, { counts, rating: areaRating(items), pending, errors, onRoute, routeActive: Boolean(activeRoute) });
    };
    const show = (result, pending) => {
      rerender = () => render(result, pending);
      rerender();
    };
    show({}, true);

    gatherSurvey(at, today, undefined, (sheds) => { if (current()) show({ sheds }, true); }, controller.signal)
      .then((result) => { if (current()) show(result, false); })
      .finally(() => { if (inFlight === controller) inFlight = null; });
  }

  function placeUser(center, verified) {
    user = { center, verified };
    map.setUser(center, theme.userLabel(verified));
    defaultNotice = !verified;
    renderNotice();
  }

  const position = await locate(navigator.geolocation, GEO_TIMEOUT_MS, (late) => {
    // Permission or the fix came after we gave up: move the survey to the real position.
    const { center, verified } = resolveStart(late);
    if (!verified) return;
    placeUser(center, true);
    survey(center);
  });
  const { center, verified } = resolveStart(position);
  placeUser(center, verified);
  survey(center);
}

if (typeof document !== 'undefined') main();
