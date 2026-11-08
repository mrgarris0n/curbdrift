// Deploy build: copy the static site (including the committed flood snapshot in assets/) into
// dist/ and add the citywide shed snapshot.
// (The Socrata app token is never part of the site: the snapshot step and api/socrata.js
// read it from the SOCRATA_APP_TOKEN env var.)
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildShedSnapshot } from './shed-snapshot.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

// Fetch first, so a failed download fails the build before anything is touched.
const { snapshot, permits } = await buildShedSnapshot();
const json = JSON.stringify(snapshot);
// Also written to the repo root so `vercel dev`, which serves the root, finds it.
await mkdir(path.join(root, 'data'), { recursive: true });
await writeFile(path.join(root, 'data', 'sheds.json'), json);

await rm(dist, { recursive: true, force: true });
await mkdir(dist);
for (const entry of ['index.html', 'css', 'js', 'assets', 'data']) {
  await cp(path.join(root, entry), path.join(dist, entry), { recursive: true });
}
console.log(`build: dist/ written; shed snapshot ${snapshot.sheds.length} structures from ${permits} permits, ${(json.length / 1e6).toFixed(1)} MB`);
