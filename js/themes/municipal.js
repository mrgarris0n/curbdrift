// Theme A — "Municipal paperwork". Every user-visible word for this theme lives here.
// Data and scoring modules return facts and keys; this module turns them into a form.

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
// ['A', 'B', 'C'] → 'A, B and C'.
const andList = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
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
  Scaffold: 'SCAFFOLD',
};

// Chicago's 311 names the request, not the condition.
const defectName = {
  'Sidewalk Inspection Request': 'SIDEWALK INSPECTION REQUESTED',
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
    { label: 'Owner of record', value: s.ownerWithheld ? 'WITHHELD (PRIVATE INDIVIDUAL)' : orNone(s.owner) },
    { label: 'Contractor', value: orNone(s.contractor) },
    { label: 'Classification', value: shedClass[s.classKey] },
  ];
}

const floodDepthName = {
  nuisance: 'NUISANCE PONDING, 4 IN TO 1 FT',
  deep: 'DEEP PONDING, 1 FT OR MORE',
};

function puddleRows(p) {
  return [
    { label: 'Saturation Index', value: p.saturation === null ? '—' : p.saturation.toFixed(2) },
    ...(p.floodProne ? [{ label: 'DEP stormwater flood map (modelled)', value: floodDepthName[p.floodDepth] }] : []),
    { label: 'Drainage complaints on file', value: p.complaintCount ? String(p.complaintCount) : 'NONE ON FILE' },
    ...(p.complaintCount ? [
      { label: 'Most recent complaint', value: day(p.lastComplaint) },
      { label: 'Nature of complaint', value: p.descriptors.join('; ') },
    ] : []),
    { label: 'Status', value: puddleStatus[p.statusKey] },
  ];
}

function defectRows(d) {
  return [
    { label: 'Condition reported', value: defectName[d.descriptor] ?? d.descriptor.toUpperCase() },
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

  routeTitle: 'ITINERARY CD-2: DESIGNATED DETERIORATION WALK',
  routeStamp: 'APPROVED FOR PEDESTRIAN INSPECTION.',

  routeSummaryRows(route) {
    return [
      { label: 'Stops designated', value: String(route.stops.length) },
      { label: route.method === 'streets' ? 'Total distance (street route)' : 'Total distance (estimated)', value: `${Math.round(route.distanceM)} m` },
      { label: 'Estimated duration', value: `${route.minutes} min` },
      { label: 'Cumulative deterioration', value: route.totalScore.toFixed(1) },
      { label: 'Method', value: route.method === 'streets' ? 'PEDESTRIAN STREET ROUTE (OPENROUTESERVICE)' : 'STRAIGHT LINE × 1.3 (STREET GRID ALLOWANCE)' },
    ];
  },

  routeStopRows(route) {
    return [
      ...route.stops.map((s, i) => ({ label: `${i + 1}. ${s.code} ${municipal.kindName[s.kind]}`, value: `${Math.round(s.atM)} m` })),
      { label: 'Return to point of origin', value: `${Math.round(route.distanceM)} m` },
    ];
  },

  summaryRows(counts, rating) {
    return [
      { label: 'Sheds and scaffolds (S)', value: String(counts.S) },
      { label: 'Probable puddles (P)', value: String(counts.P) },
      { label: 'Sidewalk defects (D)', value: String(counts.D) },
      { label: 'Area Deterioration Rating', value: rating.toFixed(1) },
    ];
  },

  credits: {
    button: 'CREDITS',
    title: 'FORM CD-0: ACKNOWLEDGEMENTS',
    developer: 'Developer of record',
    code: 'Source code (public record)',
    sources: 'Records consulted',
    builtWith: 'Cartographic apparatus',
    inspiredBy: (names) => `Inspired by the works of ${andList(names)}.`,
  },

  messages: {
    loading: ['Retrieving records…', 'Consulting the Department of Buildings…', 'Cross-referencing 311 complaints…', 'Requesting precipitation records…'],
    empty: 'No deterioration on file. This is itself suspicious.',
    unavailable: 'Records office temporarily unavailable. Please re-submit.',
    defaultLocation: 'Applicant location not on file. Survey conducted at default jurisdiction.',
    provisional: 'PROVISIONAL — RECORDS PENDING',
    final: 'SURVEY COMPLETE',
    tapHint: 'Tap an item to open its file. Move the map to request a survey of another area.',
    resurvey: 'SURVEY THIS AREA',
    routeButton: 'ISSUE WALKING ITINERARY',
    cancelRoute: 'CANCEL ITINERARY',
    routeEmpty: 'No itinerary can be issued. Insufficient deterioration within walking distance.',
    close: 'CLOSE FILE',
    summaryTitle: 'SURVEY SUMMARY',
    switchTo: 'FIELD GUIDE',
    switchToLabel: 'Switch to the field guide style',
    routeShow: 'SHOW ITINERARY',
  },
};
