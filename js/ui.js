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
  sw.setAttribute('aria-label', theme.messages.switchToLabel);
  sw.onclick = onSwitchTheme;
}

let loadingTimer = null;
let loadingIndex = 0;

// The summary can fold down to its title to give the map room. Remembered per browser.
const COLLAPSED_KEY = 'curbdrift.summaryCollapsed';
let summaryCollapsed = (() => {
  try {
    return globalThis.localStorage?.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false; // storage blocked: start expanded
  }
})();

function setSummaryCollapsed(collapsed) {
  summaryCollapsed = collapsed;
  try {
    globalThis.localStorage?.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // not remembered; still works for this page
  }
}

/**
 * @param {{counts:{S:number,P:number,D:number}, rating:number, pending:boolean, slow?:boolean,
 *   errors:{S?:boolean,P?:boolean,D?:boolean}}} state
 */
export function renderSummary(theme, state) {
  const summary = $('summary');
  const hadFocus = summary.contains(document.activeElement); // re-rendering must not drop it
  summary.replaceChildren();
  const box = el('div', 'summary-body');
  box.id = 'summary-body';
  box.hidden = summaryCollapsed;
  const toggle = el('button', 'summary-toggle', theme.messages.summaryTitle);
  toggle.type = 'button';
  toggle.setAttribute('aria-controls', box.id);
  toggle.setAttribute('aria-expanded', String(!summaryCollapsed));
  toggle.addEventListener('click', () => {
    setSummaryCollapsed(!summaryCollapsed);
    box.hidden = summaryCollapsed;
    toggle.setAttribute('aria-expanded', String(!summaryCollapsed));
    syncPanelHeight();
  });
  const heading = el('h2');
  heading.append(toggle);
  summary.append(heading, box);
  if (hadFocus) toggle.focus({ preventScroll: true });

  const status = el('p', 'status-line');
  status.id = 'status-line';
  box.append(status);
  clearInterval(loadingTimer);
  if (state.pending && state.slow) {
    // The city's records take a while; a steady explanation beats loading lines on a loop.
    status.textContent = theme.messages.slow;
  } else if (state.pending) {
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
    const routeButton = el('button', 'button route-button', state.routeActive ? theme.messages.routeShow : theme.messages.routeButton);
    routeButton.type = 'button';
    routeButton.addEventListener('click', state.onRoute);
    box.append(routeButton);
  }
  box.append(el('p', 'hint', theme.messages.tapHint));
  if (state.onCredits) {
    const credits = el('button', 'link-button', theme.credits.button);
    credits.type = 'button';
    credits.addEventListener('click', state.onCredits);
    box.append(credits);
  }
  syncPanelHeight();
}

// Show the bottom sheet (in place of the summary) with a title, one action button and content.
function showSheet(titleText, buttonText, onButton, content, { focus = true } = {}) {
  const sheet = $('sheet');
  const hadFocus = sheet.contains(document.activeElement); // re-rendering must not drop it
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
  if (focus || hadFocus) button.focus({ preventScroll: true });
}

export function openSheet(theme, item, onClose) {
  showSheet(theme.itemTitle(item), theme.messages.close, onClose, [rowsList(theme.recordRows(item)), el('span', 'stamp', theme.stamp(item))]);
}

function link(text, href) {
  const a = el('a', null, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

/** Credits: developer, source code, every data source, and the inspirations. */
export function openCredits(theme, credits) {
  const c = theme.credits;
  const para = (...children) => {
    const node = el('p');
    node.append(...children);
    return node;
  };
  const section = (heading, ...body) => {
    const div = el('div', 'credits-section');
    div.append(el('h3', null, heading), ...body);
    return div;
  };
  const sources = el('ul', 'credits-sources');
  for (const s of credits.sources) {
    const li = el('li');
    li.append(link(s.name, s.url), el('span', 'credits-provider', s.provider));
    sources.append(li);
  }
  showSheet(theme.credits.title, theme.messages.close, null, [
    section(c.developer, para(credits.developer)),
    section(c.code, para(link(credits.repo.replace(/^https:\/\//, ''), credits.repo))),
    section(c.sources, sources),
    section(c.builtWith, para(link(credits.builtWith.name, credits.builtWith.url))),
    el('p', 'stamp credits-inspiration', c.inspiredBy(credits.inspirations)),
    el('p', 'credits-disclaimer', credits.disclaimer)]);
}

/**
 * The walking itinerary file. Its close button only hides the file (the walk stays drawn and the
 * summary offers it again); cancelling the walk is a separate button at the end of the file.
 */
export function openRoute(theme, route, onCancel, { focus = true } = {}) {
  if (!route.stops.length) {
    showSheet(theme.routeTitle, theme.messages.close, null, [el('p', 'status-line', theme.messages.routeEmpty)], { focus });
    return;
  }
  const cancel = el('button', 'button route-cancel', theme.messages.cancelRoute);
  cancel.type = 'button';
  cancel.addEventListener('click', () => { closeSheet(); onCancel(); });
  showSheet(theme.routeTitle, theme.messages.close, null, [
    rowsList(theme.routeSummaryRows(route)), el('hr', 'rule'), rowsList(theme.routeStopRows(route)),
    el('span', 'stamp', theme.routeStamp), cancel], { focus });
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

export function focusThemeSwitch() {
  $('theme-switch').focus({ preventScroll: true });
}

export function isSheetOpen() {
  return !$('sheet').hidden;
}

export function hideResurvey() {
  $('resurvey').hidden = true;
}
