// Deploy build: copy the static site into dist/. (The Socrata app token is not part of the
// site; api/socrata.js reads it from the SOCRATA_APP_TOKEN env var on the server.)
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist);
for (const entry of ['index.html', 'css', 'js']) {
  await cp(path.join(root, entry), path.join(dist, entry), { recursive: true });
}
console.log('build: dist/ written');
