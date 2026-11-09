# curbdrift

**A municipal survey of nearby deterioration.** Open it on your phone in New York City or Chicago and it maps the most neglected things around you: sidewalk sheds that have stood for years, puddles that are probably there right now, and broken sidewalk, all from live public records.

**Live:** https://curbdrift.vercel.app

It is a deliberately over-engineered answer to a question nobody asked. The numbers are real; the seriousness is the joke.

---

## What it does

- **Decay map.** Surveys a 400 m radius around you (or Union Square, if your location is unavailable or outside both cities) and plots three kinds of items. The city follows the survey: anywhere in New York uses New York's records, anywhere in Chicago uses Chicago's.
  - **S: sheds and scaffolds.** Active building permits (New York's DOB sheds and scaffolds; Chicago's scaffolding permits, which run a year from issue), scored by how long the structure has stood *continuously*. Yearly permit renewals are chained together, and a gap of 60+ days breaks the chain. Chicago's scaffolds mostly come down within a year; New York's sheds often don't.
  - **P: probable puddles.** Locations with repeated 311 flooding or catch-basin complaints (Chicago: water on street and sewer requests), plus, in New York, spots where DEP's stormwater flood map says water collects. Chicago has no such map, so its puddles count as off the map. Chicago's 311 is 3–5× denser, so its complaints cluster at about a block and a cluster needs at least one full weighted complaint. They are weighted by the last 72 hours of rain (and the heaviest single hour, which fades over about a day) minus evaporation since the rain stopped (Open-Meteo's FAO-56 reference evapotranspiration, which folds in sun, temperature, wind and humidity, × 1.05 for shallow open water). Spots that are only on the flood map, with no complaints, appear only once it has rained enough to matter.
  - **D: sidewalk defects.** Recent 311 sidewalk-condition reports (collapsed sidewalk, open cellar doors, sign stumps…; Chicago: sidewalk inspection requests).
- **Item files.** Tap anything for its record: years standing, permit renewals, mayors outlasted, owner of record, saturation index.
- **Area Deterioration Rating.** The mean of the ten worst items' scores (missing slots count as zero), so it rewards both severity and density without saturating in dense blocks.
- **Walking itineraries.** "ISSUE WALKING ITINERARY" plans a loop from the survey center through the worst things within reach (at most 12 stops, about 2 km). Sheds, puddles and defects take turns, worst first within each kind; items not worth a detour (dry puddles, brand-new sheds) are skipped, and one building never takes more than one stop. The walk is then routed along real streets by [openrouteservice](https://openrouteservice.org/), with real distances and times; if the router is unavailable, the itinerary falls back to a straight-line estimate and says so.
- **Two voices.** *Municipal paperwork* (forms, case codes, rubber stamps) or *Field guide* (warm, observational narration of the same facts). Switch in the header; the choice is remembered per browser.
- **Browsing is free.** Panning and zooming never fetch data; "SURVEY THIS AREA" surveys wherever you have moved the map.

## Honesty rules

- Every number shown comes from an API or from a formula documented in [`js/scoring.js`](js/scoring.js) or [`js/route.js`](js/route.js). The precision is fake; the facts are not.
- Itinerary distances and times come from a real street route. When the router is unavailable, the fallback estimate (straight lines × 1.3, an allowance for the street grid) is labelled as such.
- Permit history only goes back to 2017 (when DOB NOW began; Chicago's data is read from 2017 too), so "in continuous service since" never predates that.
- New York permits name owners by business. Chicago's can name a private person, so a Chicago owner is shown only when the name is clearly an organisation; otherwise the file says it is withheld.

## Data sources

All are free and public. NYC Open Data and the Chicago Data Portal are read at build time into snapshots (as is the flood map, by hand); the weather is fetched directly.

| Data | Source |
| --- | --- |
| Sheds and scaffolds | NYC Open Data — [DOB NOW: Build – Approved Permits](https://data.cityofnewyork.us/d/rbx6-tga4) (`rbx6-tga4`), work types Sidewalk Shed / Supported Scaffold / Suspended Scaffold |
| Flooding, catch basins, sidewalk defects | NYC Open Data — [311 Service Requests](https://data.cityofnewyork.us/d/erm2-nwe9) (`erm2-nwe9`) |
| Chicago scaffolds | Chicago Data Portal — [Building Permits](https://data.cityofchicago.org/d/ydr8-5enu) (`ydr8-5enu`), "PERMIT - SCAFFOLDING" and express permits for temporary scaffolding |
| Chicago puddles, sidewalk defects | Chicago Data Portal — [311 Service Requests](https://data.cityofchicago.org/d/v6vf-nfxy) (`v6vf-nfxy`) |
| Where water collects (New York) | NYC Open Data — [NYC Stormwater Flood Maps](https://data.cityofnewyork.us/d/9i7c-xyvv) (`9i7c-xyvv`), DEP, Moderate Flood (2.13 in/hr) with current sea levels |
| Rain, sunshine, temperature | [Open-Meteo](https://open-meteo.com/) forecast API (past 72 hours) |
| Map tiles | © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors |
| Walking routes | © [openrouteservice.org](https://openrouteservice.org/) by HeiGIT (foot-walking profile) |

## How it works

A static site (plain HTML, CSS and ES modules, no framework) plus two small serverless functions and a daily cron. The build copies the files and adds citywide snapshots of shed permits and 311 complaints.

```
index.html, css/        page and the two themes (scoped by [data-theme])
js/app.js               orchestration: locate → survey → render
js/cities.js            the cities: bounding box, mayors, and which sources each one uses
js/sources/*.js         fetching: permits and 311 per city (*-chicago.js for Chicago), flood map, weather
js/scoring.js           all scoring formulas (facts in, numbers and keys out)
js/route.js             the itinerary planner
js/themes/*.js          every user-visible word, one module per theme
js/map.js, js/ui.js     Leaflet map and DOM rendering
api/route.js            proxy to openrouteservice that adds the routing key server-side
api/refresh-sheds.js    daily cron target: redeploys so the snapshots are rebuilt
scripts/build.mjs       deploy build: copies the site, writes the snapshots in data/ (scripts/snapshots.mjs)
scripts/flood-points.py manual, offline: flood map → assets/flood.json (committed)
```

The browser calls `/api/route` rather than openrouteservice, so the routing key stays on the server. It only routes short walks that stay inside one of the cities. The browser never queries the cities' open-data portals; it only reads the snapshots below, so the Socrata app token is used by the build alone.

Each build downloads every shed and scaffold permit (New York: about 185,000 rows into about 13,000 active structures, `data/sheds.json`, about 0.5 MB gzipped; Chicago: about 3,600 permits into about 290 structures, `data/sheds-chicago.json`, 80 KB) and the last 12 months of the 311 complaint types the app uses (New York: about 30,000 rows into about 24,000 complaints, `data/complaints.json`, about 330 KB gzipped; Chicago: about 45,000 rows into about 42,000 complaints, `data/complaints-chicago.json`, about 520 KB gzipped; defects are kept for 6 months). The downloads use Socrata's SODA 3 query endpoint (`POST /api/v3/views/<id>/query.json`): on the day this was built, the older SODA 2 endpoint (`/resource/<id>.json`) answered with 429, 500 and 503 errors or hung for minutes, while SODA 3 got through. The browser reads those files and keeps what is inside the survey circle. Complaints used to be a live 311 query per survey, which Socrata took 10 to 80 seconds to answer or refused outright with 503 and 429 errors. A Vercel cron calls `/api/refresh-sheds` every morning, which triggers a redeploy through a deploy hook. If a download fails, or returns suspiciously few items, the build keeps the copy production serves now. If that copy is missing too, the build fails and the previous deployment stays live.

The flood map is different: it is a static model (last published 2024) that DEP distributes only as Esri File Geodatabases, which plain Node can't read. So `scripts/flood-points.py` converts it by hand, not in the build. It samples the Moderate Flood scenario's ponding areas (4 inches to 1 foot, and 1 foot or more) into about 32,000 points at least 30 m apart, and writes them to `assets/flood.json` (about 150 KB gzipped), which is committed. Re-run it when DEP republishes the dataset; the script's header says how. The browser joins those points to the 311 puddle clusters within 30 m. A cluster on the map counts fully, a cluster off it counts at 0.8, and map spots nobody has complained about become puddles of their own, about a block (100 m) apart, once the Saturation Index reaches 15.

The puddle constants are checked against [FloodNet](https://www.floodnet.nyc/), the city's street-flood sensors (NYC Open Data [`kb2e-tjy3`](https://data.cityofnewyork.us/d/kb2e-tjy3) and [`aq7i-eu5q`](https://data.cityofnewyork.us/d/aq7i-eu5q)). `scripts/calibrate-puddles.py` replays five years of the same Open-Meteo weather the app reads against the flood events recorded at about 425 non-tidal sensors. The 0.8 and the 7.6 mm/h intensity reference come from that check. The same script weighs each kind of 311 complaint by how much it concentrates on rain days: "Flooding on Street" counts fully, while a sunken or damaged catch basin, reported whatever the weather, adds nothing. The puddle file still shows the real number of complaints. FloodNet only records floods of 10 mm or more that usually drain within an hour, so it says nothing about how long a puddle lingers. Drying is therefore taken from physics instead: the earlier sunshine-and-temperature guess dried water about 2.7× faster than evaporation allows, and on most days faster than all the day's sunshine could. 311 complaints around storms (same script) back the 20 mm "fully wet" scale: they jump between 15 and 20 mm of rain and then plateau. How fast a burst fades (24 h) remains an estimate; 311 reporting delays blur it. FloodNet data: Mydlarz, C., et al. (2024), *FloodNet: Low-Cost Ultrasonic Sensors for Real-Time Measurement of Hyperlocal, Street-Level Floods in New York City*, Water Resources Research, 60, [doi:10.1029/2023WR036806](https://doi.org/10.1029/2023WR036806).

Chicago's complaint weights come from the same rain-day method against Midway's rain (section 5 of the script): "Water On Street" counts fully, alley-sewer and sewer-cleaning requests 0.6 and 0.5, sewer cave-ins 0.2. FloodNet is New York only, so Chicago's other constants are New York's.

## Running it

Requires Node 22+ (tests use the built-in runner, no dependencies) and the [Vercel CLI](https://vercel.com/docs/cli) for local serving.

```bash
npm test                 # unit tests: scoring, planner, data parsing, snapshots, proxy, themes
node scripts/build.mjs   # downloads the snapshots into data/ (a few minutes; needs SOCRATA_APP_TOKEN: SODA 3 requires one)
vercel dev               # local server with the /api functions
```

After a build, a plain static file server shows sheds, puddles and defects; only the walking route needs `/api/route`.

### Deploying your own

1. Get a free Socrata app token from NYC Open Data (developer settings in your profile).
2. Get a free [openrouteservice](https://openrouteservice.org/) API key.
3. Set both as environment variables for your Vercel project. The build needs the Socrata token in every environment it builds, previews included, because it downloads through SODA 3, which requires one:
   ```bash
   vercel env add SOCRATA_APP_TOKEN --environment production
   vercel env add SOCRATA_APP_TOKEN --environment preview
   vercel env add ORS_API_KEY --environment production
   ```
4. Deploy with `vercel deploy --prod`. `vercel.json` copies the site into `dist/`, and `api/` is deployed as a function.
5. For the daily snapshot refresh, create a deploy hook for the production branch (Project Settings → Git → Deploy Hooks), then add its URL and a random cron secret:
   ```bash
   vercel env add DEPLOY_HOOK_URL --environment production
   vercel env add CRON_SECRET --environment production
   ```
   Without them the snapshots only update when you deploy.

Without the Socrata token the build stops, since it can't download the snapshots. Without the routing key the app still works, and itineraries use the straight-line estimate.

## Limitations

- New York City and Chicago only.
- Puddle likelihood is inferred from complaints and weather, not measured.

## Disclaimer

curbdrift is an independent project. It is not affiliated with, endorsed by, or sponsored by the City of New York, the City of Chicago, or any of their agencies. City data is shown as published and may be incomplete or out of date.

## License

[MIT](LICENSE)
