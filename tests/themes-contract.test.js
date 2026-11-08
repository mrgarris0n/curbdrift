// Every theme must say everything the app needs, from the same facts, without emoji.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, DEFAULT_THEME_ID, pickTheme } from '../js/themes/index.js';

const shed = {
  kind: 'S', id: 's', lat: 0, lon: 0, address: '79 5 AVENUE', workType: 'Sidewalk Shed',
  chainStart: new Date('2018-07-25T00:00:00Z'), renewals: 11, latestExpiry: new Date('2027-06-15T00:00:00Z'),
  owner: 'OWNER LLC', contractor: '', description: 'SHED', yearsContinuous: 8.29, classKey: 'permanent',
  mayorsOutlasted: 2, score: 92.1, code: 'S-1',
};
const puddles = ['dormant', 'probable', 'peak', 'unknown'].map((statusKey, i) => ({
  kind: 'P', id: `p${i}`, lat: 0, lon: 0, complaintCount: 3, lastComplaint: new Date('2026-10-10T00:00:00Z'),
  descriptors: ['Street Flooding (SJ)'], saturation: statusKey === 'unknown' ? null : 40, statusKey, score: 40, code: `P-${i + 1}`,
}));
// Flood-map puddles: one that also has complaints, one modelled only (no 311 history at all).
const floodPuddle = { ...puddles[1], id: 'pf', floodProne: true, floodDepth: 'deep', code: 'P-5' };
const floodOnly = {
  kind: 'P', id: 'F|40.71235,-73.95432', lat: 0, lon: 0, complaintCount: 0, lastComplaint: null, descriptors: [],
  floodProne: true, floodDepth: 'nuisance', saturation: 25, statusKey: 'probable', score: 25, code: 'P-6',
};
const defects = [false, true].map((closed, i) => ({
  kind: 'D', id: `d${i}`, lat: 0, lon: 0, address: '', descriptor: 'Sidewalk Collapsed',
  created: new Date('2026-09-01T00:00:00Z'), closed, score: 70, code: `D-${i + 1}`,
}));
const sheds = ['temporary', 'prolonged', 'semiPermanent', 'permanent'].map((classKey) => ({ ...shed, classKey }));
// Chicago: a scaffold whose owner is a private person, and a sidewalk inspection request.
const chicagoShed = { ...shed, id: 'c', address: '1600 N MILWAUKEE AVE', workType: 'Scaffold', owner: '', ownerWithheld: true, contractor: 'LOOP SCAFFOLD CO', code: 'S-5' };
const chicagoDefect = { ...defects[0], id: 'cd', descriptor: 'Sidewalk Inspection Request', address: '1400 N MILWAUKEE AVE', code: 'D-3' };
const items = [...sheds, chicagoShed, ...puddles, floodPuddle, floodOnly, ...defects, chicagoDefect];
const route = { stops: [{ ...shed, legM: 130, atM: 130 }, { ...defects[0], legM: 200, atM: 330 }], distanceM: 512.6, minutes: 6, totalScore: 162.1 };

const MESSAGE_KEYS = ['loading', 'slow', 'empty', 'unavailable', 'defaultLocation', 'provisional', 'final', 'tapHint', 'resurvey',
  'routeButton', 'routeShow', 'cancelRoute', 'routeEmpty', 'close', 'summaryTitle', 'switchTo', 'switchToLabel'];

function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, out));
  return out;
}

function everything(theme) {
  return [
    ...strings(theme), theme.formTitle(400), theme.userLabel(true), theme.userLabel(false),
    ...items.flatMap((it) => [theme.itemTitle(it), theme.stamp(it), ...strings(theme.recordRows(it))]),
    ...strings(theme.summaryRows({ S: 3, P: 1, D: 0 }, 42)), ...strings(theme.routeSummaryRows(route)), ...strings(theme.routeStopRows(route)),
  ];
}

test('there are exactly the two themes, municipal by default', () => {
  assert.deepEqual(Object.keys(THEMES).sort(), ['field', 'municipal']);
  assert.equal(DEFAULT_THEME_ID, 'municipal');
});

for (const theme of Object.values(THEMES)) {
  test(`${theme.id}: has every message`, () => {
    for (const k of MESSAGE_KEYS) assert.ok(theme.messages[k]?.length, `${theme.id}.messages.${k}`);
    assert.ok(theme.messages.loading.every((s) => s.length));
  });

  test(`${theme.id}: copy for every class and status key`, () => {
    for (const k of ['temporary', 'prolonged', 'semiPermanent', 'permanent']) assert.ok(theme.shedClass[k], k);
    for (const k of ['dormant', 'probable', 'peak', 'unknown']) assert.ok(theme.puddleStatus[k], k);
    for (const k of ['S', 'P', 'D']) assert.ok(theme.kindName[k] && theme.codePrefix[k], k);
  });

  test(`${theme.id}: every item has a title, rows and a closing line`, () => {
    for (const it of items) {
      assert.ok(theme.itemTitle(it).includes(it.code), `${theme.id} title shows the code`);
      const rows = theme.recordRows(it);
      assert.ok(rows.length >= 3 && rows.every((r) => r.label && r.value), `${theme.id} rows for ${it.id}`);
      assert.ok(theme.stamp(it));
    }
  });

  test(`${theme.id}: shows the same facts (honest numbers)`, () => {
    const shedText = strings(theme.recordRows(shed)).join(' ');
    for (const fact of ['2018', '11', '2', '79 5 AVENUE']) assert.ok(shedText.includes(fact), `${theme.id} shed shows ${fact}`);
    assert.ok(strings(theme.recordRows(puddles[1])).join(' ').includes('40.00'), `${theme.id} shows the saturation index`);
    assert.ok(strings(theme.routeSummaryRows(route)).join(' ').includes('1.3'), `${theme.id} states the distance method`);
    assert.ok(strings(theme.summaryRows({ S: 3, P: 1, D: 0 }, 42)).join(' ').includes('42.0'));
  });

  test(`${theme.id}: puddle rows say what the evidence is`, () => {
    const text = (it) => strings(theme.recordRows(it)).join(' ');
    assert.match(text(floodPuddle), /flood map/i, `${theme.id} cites the flood map`);
    assert.match(text(floodPuddle), /1 (ft|foot)/i, `${theme.id} gives the modelled depth`);
    assert.ok(text(floodPuddle).includes('Street Flooding (SJ)'), `${theme.id} keeps the complaints`);
    assert.doesNotMatch(text(puddles[1]), /flood map/i, `${theme.id} complaint-only puddle does not claim the map`);
    assert.match(text(floodOnly), /flood map/i);
    assert.match(text(floodOnly), /4 in/i, `${theme.id} gives the shallow depth class`);
    assert.ok(theme.itemTitle(floodOnly).includes('P-6'));
    for (const r of theme.recordRows(floodOnly)) assert.doesNotMatch(r.value, /undefined|null|NaN|Invalid/, `${theme.id} ${r.label}`);
  });

  test(`${theme.id}: Chicago wording: scaffolds, withheld owners, inspection requests`, () => {
    const shedText = strings(theme.recordRows(chicagoShed)).join(' ');
    assert.match(shedText, /scaffold/i);
    assert.doesNotMatch(shedText, /not on file|nobody wrote it down/i, `${theme.id} does not call a withheld owner missing`);
    assert.match(shedText, /withheld|private/i, `${theme.id} says the owner is withheld`);
    const defectText = strings(theme.recordRows(chicagoDefect)).join(' ');
    assert.match(defectText, /inspect/i);
    assert.doesNotMatch(defectText, /\bSidewalk Inspection Request\b/i, `${theme.id} does not show the raw request type`);
  });

  test(`${theme.id}: route rows list stops in order, then the return`, () => {
    const rows = theme.routeStopRows(route);
    assert.equal(rows.length, 3);
    assert.ok(rows[0].label.includes('S-1') && rows[1].label.includes('D-1'));
    assert.equal(rows[2].value, '513 m');
  });

  test(`${theme.id}: no emoji anywhere`, () => {
    for (const s of everything(theme)) assert.doesNotMatch(s, /\p{Extended_Pictographic}/u, s);
  });
}

test('field guide speaks plainly, not in form-speak', () => {
  const f = THEMES.field;
  assert.equal(f.formTitle(400), 'Things within 400 metres that have been left alone for a while.');
  assert.equal(f.stamp(sheds[3]), 'Nobody seems to remember what it was protecting us from.');
  // The theme's own wording (not city data like addresses, which arrive in capitals) never shouts.
  const own = [...strings(f), f.formTitle(400), f.itemTitle(shed), f.routeTitle, f.routeStamp, ...items.map((it) => f.stamp(it))];
  for (const s of own) assert.doesNotMatch(s, /[A-Z]{5,}/, s);
});

test('each theme offers to switch to the other', () => {
  assert.match(THEMES.municipal.messages.switchTo, /field guide/i);
  assert.match(THEMES.field.messages.switchTo, /paperwork/i);
});

test('pickTheme falls back to the default for unknown or missing choices', () => {
  assert.equal(pickTheme('field').id, 'field');
  assert.equal(pickTheme('municipal').id, 'municipal');
  assert.equal(pickTheme(null).id, 'municipal');
  assert.equal(pickTheme('toString').id, 'municipal');
});

test('field guide says "never" and "once" for renewals', () => {
  const rows = (n) => THEMES.field.recordRows({ ...shed, renewals: n });
  assert.ok(rows(0).some((r) => r.value === 'never'));
  assert.ok(rows(1).some((r) => r.value === 'once'));
  assert.ok(rows(11).some((r) => r.value === '11 times'));
});

test('the theme switch has a spoken name that says what it does', () => {
  assert.match(THEMES.municipal.messages.switchToLabel, /switch to the field guide/i);
  assert.match(THEMES.field.messages.switchToLabel, /switch to the paperwork/i);
});

test('itinerary method row tells estimate from real street route, in both themes', () => {
  const streets = { ...route, method: 'streets' };
  for (const theme of Object.values(THEMES)) {
    const est = strings(theme.routeSummaryRows({ ...route, method: 'estimate' })).join(' ');
    const real = strings(theme.routeSummaryRows(streets)).join(' ');
    assert.ok(est.includes('1.3'), `${theme.id} estimate states the 1.3 allowance`);
    assert.ok(!real.includes('1.3'), `${theme.id} street route does not claim the allowance`);
    assert.match(real, /street/i, `${theme.id} street route says so`);
    assert.match(real, /openrouteservice/i, `${theme.id} credits the router`);
  }
});

test('the field guide cancel button says it drops the walk (it sits apart from the title)', () => {
  assert.equal(THEMES.field.messages.cancelRoute, 'Never mind the walk');
});
