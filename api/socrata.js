// Vercel Function: GET /api/socrata?city=<id>&dataset=<id>&$select=…&$where=…&$limit=…
// Forwards the app's open-data queries to that city's Socrata portal and adds the Socrata app
// token server-side, so the token never reaches the browser. Deliberately narrow: only each
// city's allowlisted datasets and the query parameters the app uses, so this is not a
// general-purpose open proxy. (Sheds come from static snapshots built at deploy time, not here.)

const CITIES = {
  nyc: { upstream: 'https://data.cityofnewyork.us/resource/', datasets: new Set(['erm2-nwe9']) }, // 311 requests
  chicago: { upstream: 'https://data.cityofchicago.org/resource/', datasets: new Set(['v6vf-nfxy']) }, // 311 requests
};
// Before cities existed, the app sent no city: a tab left open across a deploy still means New York.
const DEFAULT_CITY = 'nyc';
const PARAMS = ['$select', '$where', '$limit'];
const MAX_LIMIT = 10000;
// Socrata can take over 80 s on a query it hasn't cached (62.5 s and 80.4 s measured); giving up
// sooner showed layers as unavailable while it finished and cached the answer anyway.
export const UPSTREAM_TIMEOUT_MS = 90000;

function json(body, status, cache = 'no-store') {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache },
  });
}

export async function handleSocrata(request, { token = process.env.SOCRATA_APP_TOKEN ?? '', fetchImpl = globalThis.fetch } = {}) {
  if (request.method !== 'GET') return json({ message: 'method not allowed' }, 405);

  const params = new URL(request.url).searchParams;
  const city = Object.hasOwn(CITIES, params.get('city') ?? DEFAULT_CITY) ? CITIES[params.get('city') ?? DEFAULT_CITY] : null;
  if (!city) return json({ message: 'unknown city' }, 400);
  const dataset = params.get('dataset');
  if (!city.datasets.has(dataset)) return json({ message: 'unknown dataset' }, 400);

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
    upstream = await fetchImpl(`${city.upstream}${dataset}.json?${forward}`, { headers, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
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
