// Who made this and whose data it stands on. Facts only; each theme supplies the headings.
export const CREDITS = Object.freeze({
  developer: 'Gergely Karácsonyi',
  repo: 'https://github.com/mrgarris0n/curbdrift',
  inspiration: 'John Wilson',
  sources: Object.freeze([
    { name: 'DOB NOW: Build – Approved Permits', provider: 'NYC Department of Buildings, via NYC Open Data', url: 'https://data.cityofnewyork.us/d/rbx6-tga4' },
    { name: '311 Service Requests', provider: 'NYC 311, via NYC Open Data', url: 'https://data.cityofnewyork.us/d/erm2-nwe9' },
    { name: 'Weather forecast and history', provider: 'Open-Meteo', url: 'https://open-meteo.com/' },
    { name: 'Map data and tiles', provider: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' },
  ]),
  builtWith: Object.freeze({ name: 'Leaflet', url: 'https://leafletjs.com/' }),
});
