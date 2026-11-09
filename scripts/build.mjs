// Deploy build: copy the static site (including the committed flood snapshot in assets/) into
// dist/ and add each city's shed and 311 complaint snapshots.
// (The Socrata app token is never part of the site: the snapshot step reads it from the
// SOCRATA_APP_TOKEN env var.)
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { snapshotFor, SOURCES } from './snapshots.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

// Fetch everything first, so a snapshot with no fallback fails the build before anything is touched.
const built = await Promise.all(SOURCES.map(async (source) => ({ source, ...await snapshotFor(source) })));
// Also written to the repo root so `vercel dev`, which serves the root, finds them.
await mkdir(path.join(root, 'data'), { recursive: true });
for (const { source, snapshot } of built) await writeFile(path.join(root, 'data', source.file), JSON.stringify(snapshot));

await rm(dist, { recursive: true, force: true });
await mkdir(dist);
for (const entry of ['index.html', 'css', 'js', 'assets', 'data']) {
  await cp(path.join(root, entry), path.join(dist, entry), { recursive: true });
}
for (const { source, snapshot, from, rows } of built) {
  const origin = from === 'downloaded' ? `${rows} rows` : `production's copy of ${snapshot.generatedAt} (${from})`;
  console.log(`build: ${source.id} snapshot ${source.count(snapshot)} items from ${origin}, ${(JSON.stringify(snapshot).length / 1e6).toFixed(2)} MB`);
}
console.log('build: dist/ written');
