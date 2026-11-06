import { test } from 'node:test';
import assert from 'node:assert/strict';
import { municipal as theme } from '../js/themes/municipal.js';

const shed = {
  kind: 'S', id: 'b|Sidewalk Shed', lat: 0, lon: 0, address: '79 5 AVENUE', workType: 'Sidewalk Shed',
  chainStart: new Date('2017-10-20T00:00:00Z'), renewals: 11, latestExpiry: new Date('2027-01-01T00:00:00Z'),
  owner: 'OWNER LLC', contractor: 'SCAFFOLD INC', description: 'SHED', yearsContinuous: 9.05, classKey: 'permanent',
  mayorsOutlasted: 2, score: 100, code: 'S-1',
};
const puddle = {
  kind: 'P', id: 'P|1', lat: 0, lon: 0, complaintCount: 3, lastComplaint: new Date('2026-10-10T00:00:00Z'),
  descriptors: ['Street Flooding (SJ)'], saturation: 72.5, statusKey: 'peak', score: 72.5, code: 'P-1',
};
const unknownPuddle = { ...puddle, saturation: null, statusKey: 'unknown', score: 0 };
const openDefect = {
  kind: 'D', id: 'D|1', lat: 0, lon: 0, address: '1 UNION SQ W', descriptor: 'Broken Sidewalk',
  created: new Date('2026-09-01T00:00:00Z'), closed: false, score: 60, code: 'D-1',
};
const closedDefect = { ...openDefect, closed: true, score: 30 };
const samples = [shed, puddle, unknownPuddle, openDefect, closedDefect];

test('fixed header copy', () => {
  assert.equal(theme.id, 'municipal');
  assert.equal(theme.appTitle, 'CURBDRIFT · OFFICE OF DECAY');
  assert.equal(theme.formTitle(400), 'FORM CD-1: AREA DETERIORATION SURVEY · 400m RADIUS');
  assert.equal(theme.userLabel(false), 'YOU (UNVERIFIED)');
  assert.equal(theme.userLabel(true), 'YOU');
});

test('every classKey/statusKey has copy', () => {
  assert.equal(theme.shedClass.temporary, 'TEMPORARY (AS INTENDED)');
  assert.equal(theme.shedClass.prolonged, 'PROLONGED');
  assert.equal(theme.shedClass.semiPermanent, 'SEMI-PERMANENT');
  assert.equal(theme.shedClass.permanent, 'PERMANENT FIXTURE');
  assert.equal(theme.puddleStatus.dormant, 'DRY (DORMANT)');
  assert.equal(theme.puddleStatus.probable, 'PROBABLE');
  assert.equal(theme.puddleStatus.peak, 'AT PEAK DEPTH');
  assert.equal(theme.puddleStatus.unknown, 'UNDETERMINED (WEATHER RECORDS UNAVAILABLE)');
  for (const k of ['S', 'P', 'D']) assert.ok(theme.kindName[k] && theme.codePrefix[k]);
});

test('fixed messages', () => {
  assert.equal(theme.messages.unavailable, 'Records office temporarily unavailable. Please re-submit.');
  assert.equal(theme.messages.defaultLocation, 'Applicant location not on file. Survey conducted at default jurisdiction.');
  assert.equal(theme.messages.provisional, 'PROVISIONAL — RECORDS PENDING');
  assert.equal(theme.messages.empty, 'No deterioration on file. This is itself suspicious.');
  assert.ok(theme.messages.loading.includes('Retrieving records…'));
  assert.ok(theme.messages.loading.includes('Consulting the Department of Buildings…'));
});

test('shed recordRows include Mayors outlasted and classification', () => {
  const rows = theme.recordRows(shed);
  const mayors = rows.find((r) => /mayors outlasted/i.test(r.label));
  assert.equal(mayors.value, '2');
  assert.ok(rows.some((r) => r.value === 'PERMANENT FIXTURE'));
  assert.ok(rows.some((r) => r.value === 'OCT 2017'));
  assert.ok(rows.some((r) => r.value === '11'));
  assert.equal(theme.stamp(shed), 'NOTED. NO ACTION REQUIRED.');
});

test('unknown puddle renders dash and UNDETERMINED', () => {
  const rows = theme.recordRows(unknownPuddle);
  assert.ok(rows.some((r) => /saturation/i.test(r.label) && r.value === '—'));
  assert.ok(rows.some((r) => r.value === 'UNDETERMINED (WEATHER RECORDS UNAVAILABLE)'));
  assert.equal(theme.stamp(unknownPuddle), 'FILED FOR FUTURE PRECIPITATION.');
  assert.equal(theme.stamp(puddle), 'CONDITIONS FAVORABLE. PROCEED WITH CAUTION.');
  assert.ok(theme.recordRows(puddle).some((r) => r.value === '72.50'));
});

test('defect stamps', () => {
  assert.equal(theme.stamp(closedDefect), 'CLOSED BY CITY. CONDITION UNVERIFIED.');
  assert.equal(theme.stamp(openDefect), 'REPORTED. AWAITING RESPONSE.');
});

test('summaryRows show counts and rating to one decimal', () => {
  const rows = theme.summaryRows({ S: 3, P: 1, D: 0 }, 14);
  assert.ok(rows.some((r) => r.value === '14.0'));
  assert.ok(rows.some((r) => r.value === '3'));
});

function collectStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

test('no emoji anywhere', () => {
  const strings = collectStrings(theme);
  strings.push(theme.formTitle(400), theme.userLabel(true), theme.userLabel(false));
  for (const item of samples) {
    strings.push(theme.stamp(item), ...collectStrings(theme.recordRows(item)));
  }
  strings.push(...collectStrings(theme.summaryRows({ S: 1, P: 1, D: 1 }, 50)));
  for (const s of strings) assert.doesNotMatch(s, /\p{Extended_Pictographic}/u, s);
});
