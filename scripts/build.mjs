// Deploy build: copy the static site into dist/ and fill in the Socrata app token from the
// SOCRATA_APP_TOKEN environment variable (set in Vercel), so the token never lives in git.
// Note: the token still ends up in the public JS — Socrata app tokens are designed to be public.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PLACEHOLDER = "export const SOCRATA_APP_TOKEN = '';";

export function injectToken(source, token) {
  if (!source.includes(PLACEHOLDER)) throw new Error(`build: token placeholder not found (${PLACEHOLDER})`);
  if (!token) return source;
  return source.replace(PLACEHOLDER, `export const SOCRATA_APP_TOKEN = ${JSON.stringify(token)};`);
}

async function build() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dist = path.join(root, 'dist');
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist);
  for (const entry of ['index.html', 'css', 'js']) {
    await cp(path.join(root, entry), path.join(dist, entry), { recursive: true });
  }
  const configPath = path.join(dist, 'js', 'config.js');
  const token = process.env.SOCRATA_APP_TOKEN?.trim();
  await writeFile(configPath, injectToken(await readFile(configPath, 'utf8'), token));
  console.log(`build: dist/ written; Socrata app token ${token ? 'injected' : 'NOT set (running unauthenticated)'}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await build();
