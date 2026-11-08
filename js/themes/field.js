// Theme C — "Field guide". Warm, observational narration of the same facts the paperwork
// theme files away. Sincere, never winking; every number is still the real one.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// ['A', 'B', 'C'] → 'A, B and C'.
const andList = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
const monthYear = (d) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
const day = (d) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
const orUnknown = (s) => (s ? s : 'Nobody wrote it down');
const times = (n) => (n === 0 ? 'never' : n === 1 ? 'once' : `${n} times`);

const shedClass = {
  temporary: 'Recently arrived',
  prolonged: 'Settling in',
  semiPermanent: 'Part of the street now',
  permanent: 'Here for good, apparently',
};

const puddleStatus = {
  dormant: 'Dry, for now',
  probable: 'Probably there',
  peak: 'Almost certainly there, and at its best',
  unknown: 'Unknown (we could not reach the weather)',
};

const workTypeName = {
  'Sidewalk Shed': 'A sidewalk shed',
  'Supported Scaffold': 'A scaffold, standing on the ground',
  'Suspended Scaffold': 'A scaffold, hanging from the roof',
  Scaffold: 'A scaffold',
};

// Chicago's 311 names the request, not the condition.
const defectName = {
  'Sidewalk Inspection Request': 'Something wrong with the sidewalk; they asked for an inspection',
};

const shedNotes = {
  temporary: 'Still new. It may yet come down.',
  prolonged: 'It was meant to be temporary. It still might be.',
  semiPermanent: 'People have started giving directions by it.',
  permanent: 'Nobody seems to remember what it was protecting us from.',
};

const puddleNotes = {
  dormant: 'Dry today. It will be back.',
  probable: 'If you are passing, it is worth a look.',
  peak: 'It rained recently. It is probably there right now, reflecting something.',
  unknown: 'We could not reach the weather, so this one is a mystery.',
};

function shedRows(s) {
  return [
    { label: 'What it is', value: workTypeName[s.workType] ?? s.workType },
    { label: 'Where', value: orUnknown(s.address) },
    { label: 'Standing since', value: monthYear(s.chainStart) },
    { label: 'Years so far', value: s.yearsContinuous.toFixed(2) },
    { label: 'Permit renewed', value: times(s.renewals) },
    { label: 'Mayors it has outlived', value: String(s.mayorsOutlasted) },
    { label: 'Allowed to stay until', value: day(s.latestExpiry) },
    { label: 'Belongs to', value: s.ownerWithheld ? 'A private person (we leave their name out)' : orUnknown(s.owner) },
    { label: 'Put up by', value: orUnknown(s.contractor) },
    { label: 'How it seems', value: shedClass[s.classKey] },
  ];
}

const floodDepthName = {
  nuisance: 'Water collects here in a big storm, 4 inches to 1 foot deep',
  deep: 'Water collects here in a big storm, 1 foot deep or more',
};

function puddleRows(p) {
  return [
    { label: 'How wet (Saturation Index)', value: p.saturation === null ? '—' : p.saturation.toFixed(2) },
    ...(p.floodProne ? [{ label: "The city's stormwater flood map", value: floodDepthName[p.floodDepth] }] : []),
    { label: 'Times someone complained', value: p.complaintCount ? String(p.complaintCount) : 'Nobody has, yet' },
    ...(p.complaintCount ? [
      { label: 'Last complaint', value: day(p.lastComplaint) },
      { label: 'What they said', value: p.descriptors.join('; ') },
    ] : []),
    { label: 'Chances it is there', value: puddleStatus[p.statusKey] },
  ];
}

function defectRows(d) {
  return [
    { label: 'What someone noticed', value: defectName[d.descriptor] ?? d.descriptor },
    { label: 'When', value: day(d.created) },
    { label: 'Where', value: orUnknown(d.address) },
    { label: 'What the city says', value: d.closed ? 'Fixed' : 'Nothing yet' },
  ];
}

export const field = {
  id: 'field',
  appTitle: 'curbdrift · a field guide',
  formTitle: (radiusM) => `Things within ${radiusM} metres that have been left alone for a while.`,
  userLabel: (verified) => (verified ? 'you' : 'you (roughly)'),
  codePrefix: { S: 'S', P: 'P', D: 'D' },
  kindName: { S: 'a shed or scaffold', P: 'a puddle, probably', D: 'a broken bit of sidewalk' },
  shedClass,
  puddleStatus,

  itemTitle: (item) => `${item.code}: ${field.kindName[item.kind]}`,

  recordRows(item) {
    if (item.kind === 'S') return shedRows(item);
    if (item.kind === 'P') return puddleRows(item);
    return defectRows(item);
  },

  stamp(item) {
    if (item.kind === 'S') return shedNotes[item.classKey];
    if (item.kind === 'P') return puddleNotes[item.statusKey];
    return item.closed ? 'The city says this is fixed. You could go and check.' : 'Someone reported this. Nobody has answered yet.';
  },

  routeTitle: 'A walk past the worst of it',
  routeStamp: 'Take your time. None of it is going anywhere.',

  routeSummaryRows(route) {
    return [
      { label: 'Stops', value: String(route.stops.length) },
      { label: 'Roughly how far', value: `${Math.round(route.distanceM)} m` },
      { label: 'Roughly how long', value: `${route.minutes} min` },
      { label: 'Decay along the way', value: route.totalScore.toFixed(1) },
      { label: 'How we measured', value: route.method === 'streets' ? 'Along the actual streets (thanks, openrouteservice)' : 'As the crow flies, times 1.3 for the corners' },
    ];
  },

  routeStopRows(route) {
    return [
      ...route.stops.map((s, i) => ({ label: `${i + 1}. ${s.code}, ${field.kindName[s.kind]}`, value: `${Math.round(s.atM)} m` })),
      { label: 'Back where you started', value: `${Math.round(route.distanceM)} m` },
    ];
  },

  summaryRows(counts, rating) {
    return [
      { label: 'Sheds and scaffolds', value: String(counts.S) },
      { label: 'Puddles, probably', value: String(counts.P) },
      { label: 'Broken bits of sidewalk', value: String(counts.D) },
      { label: 'How neglected it all is (out of 100)', value: rating.toFixed(1) },
    ];
  },

  credits: {
    button: 'Credits',
    title: 'Who made this',
    developer: 'Made by',
    code: 'The code',
    sources: 'Where the facts come from',
    builtWith: 'The map is drawn with',
    inspiredBy: (names) => `Inspired by the works of ${andList(names)}, who taught us to look at this stuff.`,
  },

  messages: {
    loading: ['Looking around…', 'Asking the Department of Buildings…', 'Reading old complaints…', 'Checking whether it rained…'],
    slow: 'The city is slow to answer today. We are still waiting; it usually comes.',
    empty: 'Nothing nearby has been left alone long enough. That is unusual.',
    unavailable: 'The city is not answering right now. Try again in a moment.',
    defaultLocation: 'We do not know where you are, so we started at Union Square.',
    provisional: 'Still looking…',
    final: 'That is everything we found.',
    tapHint: 'Tap anything to hear its story. Move the map to look somewhere else.',
    resurvey: 'Look around here',
    routeButton: 'Suggest a walk',
    cancelRoute: 'Never mind the walk',
    routeEmpty: 'There is not enough worth seeing within walking distance. Try somewhere else.',
    close: 'Close',
    summaryTitle: 'Around here',
    switchTo: 'Back to the paperwork',
    switchToLabel: 'Switch to the paperwork style',
    routeShow: 'Back to the walk',
  },
};
