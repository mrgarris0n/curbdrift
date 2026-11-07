# curbdrift

**A municipal survey of nearby deterioration.** Open it on your phone in New York City and it maps the most neglected things around you: sidewalk sheds that have stood for years, puddles that are probably there right now, and broken sidewalk, all from live public records.

**Live:** https://curbdrift.vercel.app

It is a deliberately over-engineered answer to a question nobody asked. The numbers are real; the seriousness is the joke.

---

## What it does

- **Decay map.** Surveys a 400 m radius around you (or Union Square, if location is unavailable) and plots three kinds of items:
  - **S: sheds and scaffolds.** Active DOB permits, scored by how long the structure has stood *continuously*. Yearly permit renewals are chained together, and a gap of 60+ days breaks the chain.
  - **P: probable puddles.** Locations with repeated 311 flooding or catch-basin complaints, weighted by the last 72 hours of rain minus a drying term from sunshine and temperature.
  - **D: sidewalk defects.** Recent 311 sidewalk-condition reports (collapsed sidewalk, open cellar doors, sign stumps…).
- **Item files.** Tap anything for its record: years standing, permit renewals, mayors outlasted, owner of record, saturation index.
- **Area Deterioration Rating.** The mean of the ten worst items' scores (missing slots count as zero), so it rewards both severity and density without saturating in dense blocks.
- **Walking itineraries.** "ISSUE WALKING ITINERARY" plans a loop from the survey center through the worst things within reach (at most 12 stops, about 2 km). Sheds, puddles and defects take turns, worst first within each kind; items not worth a detour (dry puddles, brand-new sheds) are skipped, and one building never takes more than one stop. The walk is then routed along real streets by [openrouteservice](https://openrouteservice.org/), with real distances and times; if the router is unavailable, the itinerary falls back to a straight-line estimate and says so.
- **Two voices.** *Municipal paperwork* (forms, case codes, rubber stamps) or *Field guide* (warm, observational narration of the same facts). Switch in the header; the choice is remembered per browser.
- **Browsing is free.** Panning and zooming never fetch data; "SURVEY THIS AREA" surveys wherever you have moved the map.

## Honesty rules

- Every number shown comes from an API or from a formula documented in [`js/scoring.js`](js/scoring.js) or [`js/route.js`](js/route.js). The precision is fake; the facts are not.
- Itinerary distances and times come from a real street route. When the router is unavailable, the fallback estimate (straight lines × 1.3, an allowance for the street grid) is labelled as such.
- Permit history only goes back to 2017 (when DOB NOW began), so "in continuous service since" never predates that.

## Data sources

All are free and public. NYC Open Data is reached through this app's own proxy; the weather is fetched directly.

| Data | Source |
| --- | --- |
| Sheds and scaffolds | NYC Open Data — [DOB NOW: Build – Approved Permits](https://data.cityofnewyork.us/d/rbx6-tga4) (`rbx6-tga4`), work types Sidewalk Shed / Supported Scaffold / Suspended Scaffold |
| Flooding, catch basins, sidewalk defects | NYC Open Data — [311 Service Requests](https://data.cityofnewyork.us/d/erm2-nwe9) (`erm2-nwe9`) |
| Rain, sunshine, temperature | [Open-Meteo](https://open-meteo.com/) forecast API (past 72 hours) |
| Map tiles | © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors |
| Walking routes | © [openrouteservice.org](https://openrouteservice.org/) by HeiGIT (foot-walking profile) |

## How it works

A static site (plain HTML, CSS and ES modules, no framework) plus two small serverless functions and a daily cron. The build copies the files and adds a citywide shed snapshot.

```
index.html, css/        page and the two themes (scoped by [data-theme])
js/app.js               orchestration: locate → survey → render
js/sources/*.js         fetching: DOB permits, 311 complaints, weather
js/scoring.js           all scoring formulas (facts in, numbers and keys out)
js/route.js             the itinerary planner
js/themes/*.js          every user-visible word, one module per theme
js/map.js, js/ui.js     Leaflet map and DOM rendering
api/socrata.js          proxy to NYC Open Data that adds the app token server-side
api/route.js            proxy to openrouteservice that adds the routing key server-side
api/refresh-sheds.js    daily cron target: redeploys so the shed snapshot is rebuilt
scripts/build.mjs       deploy build: copies the site, writes data/sheds.json
```

The browser calls `/api/socrata` and `/api/route` rather than the upstream services, so the Socrata app token and the openrouteservice key stay on the server. `/api/route` only routes short walks inside New York City. The proxy only accepts the 311 dataset and the query fields the app uses, caps the row count, and caches successful answers at the edge for 5 minutes.

Shed permits change once a day, so they don't go through the proxy. Each build downloads every shed and scaffold permit (about 185,000 rows), groups them into active structures (about 13,000) and writes them to the static file `data/sheds.json` (about 0.5 MB gzipped). The browser reads that file and keeps the structures inside the survey circle. A Vercel cron calls `/api/refresh-sheds` every morning, which triggers a redeploy through a deploy hook. If the download fails, or returns suspiciously few structures, the build fails and the previous deployment, with its snapshot, stays live.

## Running it

Requires Node 22+ (tests use the built-in runner, no dependencies) and the [Vercel CLI](https://vercel.com/docs/cli) for local serving.

```bash
npm test                 # unit tests: scoring, planner, data parsing, proxy, themes
node scripts/build.mjs   # downloads the shed snapshot into data/ (about a minute)
vercel dev               # local server with the /api proxy
```

A plain static file server will show the page but cannot run `/api/socrata`, so 311 data won't load.

### Deploying your own

1. Get a free Socrata app token from NYC Open Data (developer settings in your profile).
2. Get a free [openrouteservice](https://openrouteservice.org/) API key.
3. Set both as environment variables for your Vercel project:
   ```bash
   vercel env add SOCRATA_APP_TOKEN --environment production
   vercel env add ORS_API_KEY --environment production
   ```
4. Deploy with `vercel deploy --prod`. `vercel.json` copies the site into `dist/`, and `api/` is deployed as a function.
5. For the daily shed refresh, create a deploy hook for the production branch (Project Settings → Git → Deploy Hooks), then add its URL and a random cron secret:
   ```bash
   vercel env add DEPLOY_HOOK_URL --environment production
   vercel env add CRON_SECRET --environment production
   ```
   Without them the snapshot only updates when you deploy.

The app works without either: without the Socrata token anonymous requests are rate-limited heavily, and without the routing key itineraries use the straight-line estimate.

## Limitations

- New York City only.
- Puddle likelihood is inferred from complaints and weather, not measured.

## License

[MIT](LICENSE)
