// amatu-paparan — gateway from Amatu Paparan (amatu-id.github.io/paparan) to the Cloudflare Worker amatu-paparan
// (Workers AI: Gemma 4 for document Q&A and presentation writing, bge-m3 embeddings). The page can't call *.workers.dev
// itself: some Indonesian ISPs hijack that domain's DNS.
//   POST …/amatu-paparan/chat | …/amatu-paparan/emb   header x-amatu: <portal session token>   JSON body passed on
//   chat with {stream: true} answers text/event-stream (passed through as it arrives)
// Deploy: supabase functions deploy amatu-paparan --project-ref ieyqxmzztoxgpvwexbkj --no-verify-jwt --use-api
// Secrets: PAPARAN_AI_URL (https://amatu-paparan.liemyo.workers.dev), PAPARAN_AI_KEY (= Worker secret KEY)
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-amatu',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'x-model',
  'Access-Control-Max-Age': '86400',
};
const SB = Deno.env.get('SUPABASE_URL')!, ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const AI = (Deno.env.get('PAPARAN_AI_URL') || '').replace(/\/$/, ''), KEY = Deno.env.get('PAPARAN_AI_KEY') || '';
const LIMIT: Record<string, [number, number]> = { chat: [30, 1.6e6], emb: [40, 400e3] };   // per user per minute, max body bytes

const out = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// signed-in portal users only; a good token is remembered for 10 minutes
const seen = new Map<string, { u: string; until: number }>();
async function who(token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return '';
  const c = seen.get(token);
  if (c && c.until > Date.now()) return c.u;
  const r = await fetch(`${SB}/rest/v1/rpc/amt_status`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_token: token }),
    signal: AbortSignal.timeout(8000),
  });
  const j = await r.json().catch(() => null);
  const u = (r.ok && j && j.user) || '';
  if (u) {
    if (seen.size > 500) seen.clear();
    seen.set(token, { u, until: Date.now() + 10 * 60e3 });
  }
  return u;
}

const hits = new Map<string, number[]>();
function busy(key: string, max: number) {
  const now = Date.now(), h = (hits.get(key) || []).filter((t) => now - t < 60e3);
  if (h.length >= max) return true;
  h.push(now);
  hits.set(key, h);
  return false;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return out({ error: 'method' }, 405);
  const path = new URL(req.url).pathname.split('/').pop() || '';
  const lim = LIMIT[path];
  if (!lim) return out({ error: 'path' }, 404);
  if (!AI || !KEY) return out({ error: 'ai' });
  try {
    const u = await who(req.headers.get('x-amatu') || '');
    if (!u) return out({ error: 'auth' }, 401);
    if (busy(u + '|' + path, lim[0])) return out({ error: 'cepat' });
    const body = await req.text();
    if (body.length > lim[1]) return out({ error: 'besar' });
    const r = await fetch(`${AI}/${path}`, {
      method: 'POST',
      headers: { 'x-key': KEY, 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(148e3),
    });
    const ct = r.headers.get('content-type') || 'application/json';
    const h: Record<string, string> = { ...CORS, 'Content-Type': ct, 'Cache-Control': 'no-store' };
    const m = r.headers.get('x-model');
    if (m) h['x-model'] = m;
    return new Response(r.body, { status: r.ok ? 200 : 502, headers: h });
  } catch (e) {
    return out({ error: (e as Error).name === 'TimeoutError' ? 'lambat' : 'ai' });
  }
});
