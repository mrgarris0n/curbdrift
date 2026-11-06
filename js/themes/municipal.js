// Theme A — "Municipal paperwork". Every user-visible word for this theme lives here.
// Data and scoring modules return facts and keys; this module turns them into a form.

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const monthYear = (d) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
const day = (d) => `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
const orNone = (s) => (s ? s : 'NOT ON FILE');

const shedClass = {
  temporary: 'TEMPORARY (AS INTENDED)',
  prolonged: 'PROLONGED',
  semiPermanent: 'SEMI-PERMANENT',
  permanent: 'PERMANENT FIXTURE',
};

const puddleStatus = {
  dormant: 'DRY (DORMANT)',
  probable: 'PROBABLE',
  peak: 'AT PEAK DEPTH',
  unknown: 'UNDETERMINED (WEATHER RECORDS UNAVAILABLE)',
};

const workTypeName = {
  'Sidewalk Shed': 'SIDEWALK SHED',
  'Supported Scaffold': 'SUPPORTED SCAFFOLD',
  'Suspended Scaffold': 'SUSPENDED SCAFFOLD',
};

function shedRows(s) {
  return [
    { label: 'Structure type', value: workTypeName[s.workType] ?? s.workType.toUpperCase() },
    { label: 'Location', value: orNone(s.address) },
    { label: 'In continuous service since', value: monthYear(s.chainStart) },
    { label: 'Years on record', value: s.yearsContinuous.toFixed(2) },
    { label: 'Permit renewals', value: String(s.renewals) },
    { label: 'Mayors outlasted', value: String(s.mayorsOutlasted) },
    { label: 'Current permit expires', value: day(s.latestExpiry) },
    { label: 'Owner of record', value: orNone(s.owner) },
    { label: 'Contractor', value: orNone(s.contractor) },
    { label: 'Classification', value: shedClass[s.classKey] },
  ];
}

function puddleRows(p) {
  return [
    { label: 'Saturation Index', value: p.saturation === null ? '—' : p.saturation.toFixed(2) },
    { label: 'Drainage complaints on file', value: String(p.complaintCount) },
    { label: 'Most recent complaint', value: day(p.lastComplaint) },
    { label: 'Nature of complaint', value: p.descriptors.join('; ') },
    { label: 'Status', value: puddleStatus[p.statusKey] },
  ];
}

function defectRows(d) {
  return [
    { label: 'Condition reported', value: d.descriptor.toUpperCase() },
    { label: 'Date reported', value: day(d.created) },
    { label: 'Location', value: orNone(d.address) },
    { label: '311 status', value: d.closed ? 'CLOSED' : 'OPEN' },
  ];
}

export const municipal = {
  id: 'municipal',
  appTitle: 'CURBDRIFT · OFFICE OF DECAY',
  formTitle: (radiusM) => `FORM CD-1: AREA DETERIORATION SURVEY · ${radiusM}m RADIUS`,
  userLabel: (verified) => (verified ? 'YOU' : 'YOU (UNVERIFIED)'),
  codePrefix: { S: 'S', P: 'P', D: 'D' },
  kindName: { S: 'SIDEWALK SHED / SCAFFOLD', P: 'PROBABLE PUDDLE', D: 'SIDEWALK DEFECT' },
  shedClass,
  puddleStatus,

  itemTitle: (item) => `ITEM ${item.code} · ${municipal.kindName[item.kind]}`,

  recordRows(item) {
    if (item.kind === 'S') return shedRows(item);
    if (item.kind === 'P') return puddleRows(item);
    return defectRows(item);
  },

  stamp(item) {
    if (item.kind === 'S') return 'NOTED. NO ACTION REQUIRED.';
    if (item.kind === 'P') return item.statusKey === 'peak' ? 'CONDITIONS FAVORABLE. PROCEED WITH CAUTION.' : 'FILED FOR FUTURE PRECIPITATION.';
    return item.closed ? 'CLOSED BY CITY. CONDITION UNVERIFIED.' : 'REPORTED. AWAITING RESPONSE.';
  },

  summaryRows(counts, rating) {
    return [
      { label: 'Sheds and scaffolds (S)', value: String(counts.S) },
      { label: 'Probable puddles (P)', value: String(counts.P) },
      { label: 'Sidewalk defects (D)', value: String(counts.D) },
      { label: 'Area Deterioration Rating', value: rating.toFixed(1) },
    ];
  },

  messages: {
    loading: ['Retrieving records…', 'Consulting the Department of Buildings…', 'Cross-referencing 311 complaints…', 'Requesting precipitation records…'],
    empty: 'No deterioration on file. This is itself suspicious.',
    unavailable: 'Records office temporarily unavailable. Please re-submit.',
    defaultLocation: 'Applicant location not on file. Survey conducted at default jurisdiction.',
    provisional: 'PROVISIONAL — RECORDS PENDING',
    final: 'SURVEY COMPLETE',
    tapHint: 'Tap the map to survey another location. Tap an item to open its file.',
    close: 'CLOSE FILE',
    summaryTitle: 'SURVEY SUMMARY',
  },
};
