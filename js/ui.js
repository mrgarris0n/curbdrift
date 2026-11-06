// DOM rendering for header, summary panel, item sheet and notices.
// All words come from the theme; this module only arranges them.

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function rowsList(rows) {
  const frag = document.createDocumentFragment();
  for (const r of rows) {
    const row = el('div', 'row');
    row.append(el('span', 'label', r.label), el('span', 'leader'), el('span', 'value', r.value));
    frag.append(row);
  }
  return frag;
}

// Leaflet's bottom controls (attribution) must sit above whichever panel is showing.
// Panels also resize on their own (web font arriving, viewport rotation), so observe them.
let observer = null;
function syncPanelHeight() {
  const visible = $('sheet').hidden ? $('summary') : $('sheet');
  document.documentElement.style.setProperty('--panel-h', `${visible.offsetHeight}px`);
  if (!observer && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => syncPanelHeight());
    observer.observe($('summary'));
    observer.observe($('sheet'));
  }
}

export function renderHeader(theme, radiusM, onSwitchTheme) {
  document.title = theme.appTitle;
  $('app-title').textContent = theme.appTitle;
  $('form-title').textContent = theme.formTitle(radiusM);
  const sw = $('theme-switch');
  sw.textContent = theme.messages.switchTo;
  sw.onclick = onSwitchTheme;
}

let loadingTimer = null;
let loadingIndex = 0;

/**
 * @param {{counts:{S:number,P:number,D:number}, rating:number, pending:boolean,
 *   errors:{S?:boolean,P?:boolean,D?:boolean}}} state
 */
export function renderSummary(theme, state) {
  const box = $('summary');
  box.replaceChildren();
  box.append(el('h2', null, theme.messages.summaryTitle));

  const status = el('p', 'status-line');
  status.id = 'status-line';
  box.append(status);
  clearInterval(loadingTimer);
  if (state.pending) {
    const tick = () => { status.textContent = theme.messages.loading[loadingIndex++ % theme.messages.loading.length]; };
    tick();
    loadingTimer = setInterval(tick, 1600);
  } else {
    const total = state.counts.S + state.counts.P + state.counts.D;
    const anyError = Object.values(state.errors).some(Boolean);
    // The closing stamp already says the survey is complete; the status line only speaks when
    // there is something else to say.
    if (total === 0 && !anyError) status.textContent = theme.messages.empty;
    else status.hidden = true;
  }

  box.append(rowsList(theme.summaryRows(state.counts, state.rating)));

  const errs = Object.entries(state.errors).filter(([, v]) => v);
  if (errs.length) {
    const ul = el('ul', 'errors');
    for (const [kind] of errs) ul.append(el('li', null, `${theme.kindName[kind]}: ${theme.messages.unavailable}`));
    box.append(ul);
  }

  const stamp = el('span', state.pending ? 'stamp provisional' : 'stamp', state.pending ? theme.messages.provisional : theme.messages.final);
  box.append(stamp);
  if (state.onRoute && !state.pending && state.counts.S + state.counts.P + state.counts.D > 0) {
    const routeButton = el('button', 'button route-button', theme.messages.routeButton);
    routeButton.type = 'button';
    routeButton.addEventListener('click', state.onRoute);
    box.append(routeButton);
  }
  box.append(el('p', 'hint', theme.messages.tapHint));
  syncPanelHeight();
}

// Show the bottom sheet (in place of the summary) with a title, one action button and content.
function showSheet(titleText, buttonText, onButton, ...content) {
  const sheet = $('sheet');
  sheet.replaceChildren();
  const head = el('div', 'sheet-head');
  const button = el('button', 'button', buttonText);
  button.type = 'button';
  button.addEventListener('click', () => { closeSheet(); onButton?.(); });
  head.append(el('h2', null, titleText), button);
  sheet.append(head, ...content);
  sheet.hidden = false;
  $('summary').hidden = true;
  syncPanelHeight();
  button.focus({ preventScroll: true });
}

export function openSheet(theme, item, onClose) {
  showSheet(theme.itemTitle(item), theme.messages.close, onClose, rowsList(theme.recordRows(item)), el('span', 'stamp', theme.stamp(item)));
}

/** The walking itinerary file. Its button cancels the itinerary. */
export function openRoute(theme, route, onCancel) {
  const content = route.stops.length
    ? [rowsList(theme.routeSummaryRows(route)), el('hr', 'rule'), rowsList(theme.routeStopRows(route)), el('span', 'stamp', theme.routeStamp)]
    : [el('p', 'status-line', theme.messages.routeEmpty)];
  showSheet(theme.routeTitle, theme.messages.cancelRoute, onCancel, ...content);
}

export function closeSheet() {
  $('sheet').hidden = true;
  $('summary').hidden = false;
  syncPanelHeight();
}

export function showNotice(text) {
  const n = $('notice');
  n.textContent = text;
  n.hidden = !text;
}

/** Offer a re-survey after the user moves the map. Data is only fetched when it is pressed. */
export function showResurvey(theme, onPress) {
  const btn = $('resurvey');
  btn.textContent = theme.messages.resurvey;
  btn.onclick = () => { hideResurvey(); onPress(); };
  btn.hidden = false;
}

export function refreshResurvey(theme) {
  $('resurvey').textContent = theme.messages.resurvey;
}

export function isSheetOpen() {
  return !$('sheet').hidden;
}

export function hideResurvey() {
  $('resurvey').hidden = true;
}
