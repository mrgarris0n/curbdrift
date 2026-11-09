// Vercel Cron target (see "crons" in vercel.json): triggers a production redeploy through a
// deploy hook, and the build regenerates the citywide shed and 311 snapshots. Only Vercel Cron may call
// it: Vercel sends CRON_SECRET as a bearer token, and the hook URL itself stays server-side.

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function handleRefresh(request, { secret = process.env.CRON_SECRET, hookUrl = process.env.DEPLOY_HOOK_URL, fetchImpl = globalThis.fetch } = {}) {
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return json({ message: 'unauthorized' }, 401);
  if (!hookUrl) return json({ message: 'deploy hook not configured' }, 500);

  let res;
  try {
    res = await fetchImpl(hookUrl, { method: 'POST', signal: AbortSignal.timeout(15000) });
  } catch {
    return json({ message: 'deploy hook unreachable' }, 502);
  }
  return res.ok ? json({ message: 'redeploy triggered' }, 202) : json({ message: `deploy hook answered ${res.status}` }, 502);
}

export function GET(request) {
  return handleRefresh(request);
}
