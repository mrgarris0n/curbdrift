// Who made this and whose data it stands on. Facts only; each theme supplies the headings.
export const CREDITS = Object.freeze({
  developer: 'Gergely Karácsonyi',
  repo: 'https://github.com/mrgarris0n/curbdrift',
  inspirations: Object.freeze(['John Wilson', 'Nathan Fielder']),
  sources: Object.freeze([
    { name: 'DOB NOW: Build – Approved Permits', provider: 'NYC Department of Buildings, via NYC Open Data', url: 'https://data.cityofnewyork.us/d/rbx6-tga4' },
    { name: '311 Service Requests', provider: 'NYC 311, via NYC Open Data', url: 'https://data.cityofnewyork.us/d/erm2-nwe9' },
    { name: 'Weather forecast and history', provider: 'Open-Meteo', url: 'https://open-meteo.com/' },
    { name: 'Map data and tiles', provider: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' },
    { name: 'Walking routes', provider: '© openrouteservice.org by HeiGIT', url: 'https://openrouteservice.org/' },
  ]),
  builtWith: Object.freeze({ name: 'Leaflet', url: 'https://leafletjs.com/' }),
  // A legal statement, so it is the same plain text in every theme.
  disclaimer: 'curbdrift is an independent project. It is not affiliated with, endorsed by, or sponsored by the City of New York or any of its agencies. City data is shown as published and may be incomplete or out of date.',
});
