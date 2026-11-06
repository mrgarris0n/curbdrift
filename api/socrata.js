// Vercel Function: GET /api/socrata?dataset=<id>&$select=…&$where=…&$limit=…
// Forwards the app's NYC Open Data queries and adds the Socrata app token server-side,
// so the token never reaches the browser. Deliberately narrow: only the two datasets and
// the query parameters the app uses, so this is not a general-purpose open proxy.

const UPSTREAM = 'https://data.cityofnewyork.us/resource/';
const DATASETS = new Set(['rbx6-tga4', 'erm2-nwe9']); // DOB NOW permits, 311 requests
const PARAMS = ['$select', '$where', '$limit'];
const MAX_LIMIT = 10000;
const TIMEOUT_MS = 25000;

function json(body, status, cache = 'no-store') {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache },
  });
}

export async function handleSocrata(request, { token = process.env.SOCRATA_APP_TOKEN ?? '', fetchImpl = globalThis.fetch } = {}) {
  if (request.method !== 'GET') return json({ message: 'method not allowed' }, 405);

  const params = new URL(request.url).searchParams;
  const dataset = params.get('dataset');
  if (!DATASETS.has(dataset)) return json({ message: 'unknown dataset' }, 400);

  const forward = new URLSearchParams();
  for (const key of PARAMS) {
    const value = params.get(key);
    if (value !== null) forward.set(key, value);
  }
  const limit = forward.get('$limit');
  if (limit !== null && !(/^\d+$/.test(limit) && Number(limit) <= MAX_LIMIT)) return json({ message: 'invalid $limit' }, 400);

  const headers = { accept: 'application/json' };
  if (token) headers['X-App-Token'] = token;

  let upstream;
  try {
    upstream = await fetchImpl(`${UPSTREAM}${dataset}.json?${forward}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return json({ message: 'records office unreachable' }, 502);
  }

  const body = await upstream.text();
  // Successful answers are shared at the edge for 5 minutes; failures are never cached.
  const cache = upstream.ok ? 'public, s-maxage=300, stale-while-revalidate=600' : 'no-store';
  return new Response(body, {
    status: upstream.status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache },
  });
}

export function GET(request) {
  return handleSocrata(request);
}
