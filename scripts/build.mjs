// Deploy build: copy the static site (including the committed flood snapshot in assets/) into
// dist/ and add each city's shed snapshot.
// (The Socrata app token is never part of the site: the snapshot step and api/socrata.js
// read it from the SOCRATA_APP_TOKEN env var.)
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildShedSnapshot, SHED_SOURCES } from './shed-snapshot.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

// Where each snapshot is served (js/sources/sheds.js and sheds-chicago.js read these paths).
const FILES = { nyc: 'sheds.json', chicago: 'sheds-chicago.json' };

// Fetch everything first, so any failed download fails the build before anything is touched.
const built = await Promise.all(Object.values(SHED_SOURCES).map(async (source) => ({ source, ...await buildShedSnapshot(source) })));
// Also written to the repo root so `vercel dev`, which serves the root, finds them.
await mkdir(path.join(root, 'data'), { recursive: true });
for (const { source, snapshot } of built) await writeFile(path.join(root, 'data', FILES[source.id]), JSON.stringify(snapshot));

await rm(dist, { recursive: true, force: true });
await mkdir(dist);
for (const entry of ['index.html', 'css', 'js', 'assets', 'data']) {
  await cp(path.join(root, entry), path.join(dist, entry), { recursive: true });
}
for (const { source, snapshot, permits } of built) {
  console.log(`build: ${source.id} shed snapshot ${snapshot.sheds.length} structures from ${permits} permits, ${(JSON.stringify(snapshot).length / 1e6).toFixed(2)} MB`);
}
console.log('build: dist/ written');
