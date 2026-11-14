// amatu-paparan — Workers AI for Amatu Paparan (amatu-id.github.io/paparan).
// Only the Supabase edge function amatu-paparan calls this Worker (it checks the portal sign-in and adds x-key):
// the page can't reach *.workers.dev itself because some Indonesian ISPs hijack that domain's DNS.
//   POST /chat {messages, max?, temp?, stream?, think?}  → stream: text/event-stream straight from Workers AI (header x-model)
//                                                        → else {text, m, usage} | {error}
//   POST /emb  {texts: [..]}  → {d, v: base64 int8 (n × d), s: [scale per vector]} | {error}
// Errors: kuota (free daily allocation used up), sibuk (no capacity), lambat (timeout), ai, data, auth.

const GEMMA = '@cf/google/gemma-4-26b-a4b-it';            // 256k context, $0.10 / M input: the workhorse
const MISTRAL = '@cf/mistralai/mistral-small-3.1-24b-instruct';
const SCOUT = '@cf/meta/llama-4-scout-17b-16e-instruct';
const BGE = '@cf/baai/bge-m3';                             // multilingual embeddings (Indonesian ok), 1024 dims
const ORDER = [GEMMA, MISTRAL, SCOUT];

const json = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', ...h } });
const race = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);

function why(e) {
  const m = String((e && (e.message || e)) || '').toLowerCase();
  if (/4006|neuron|daily free allocation|used up/.test(m)) return 'kuota';
  if (/3040|capacity|overload|too many/.test(m)) return 'sibuk';
  if (/timeout|timed out/.test(m)) return 'lambat';
  if (/context|too long|maximum.*token|5021/.test(m)) return 'panjang';
  return 'ai';
}

function input(model, b, stream) {
  const msgs = (Array.isArray(b.messages) ? b.messages : [])
    .filter((m) => m && /^(system|user|assistant)$/.test(m.role) && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 600000) }));
  const inp = {
    messages: msgs,
    max_tokens: Math.max(64, Math.min(8000, +b.max || 1200)),
    temperature: Math.max(0, Math.min(1, b.temp == null ? 0.3 : +b.temp)),
  };
  if (stream) inp.stream = true;
  if (model === GEMMA) inp.chat_template_kwargs = { enable_thinking: !!b.think };
  return inp;
}

async function chat(env, b) {
  if (!Array.isArray(b.messages) || !b.messages.length) return json({ error: 'data' }, 400);
  const stream = !!b.stream;
  let last = 'ai';
  for (const [i, model] of ORDER.entries()) {
    try {
      if (stream) {
        // a model that cannot start (no capacity) hands over before any byte is sent
        const s = await race(env.AI.run(model, input(model, b, true)), i ? 20000 : 25000);
        if (s && typeof s.getReader === 'function') {
          return new Response(s, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'x-model': model.split('/').pop() } });
        }
        last = 'ai';
        continue;
      }
      const r = await race(env.AI.run(model, input(model, b, false)), 140000);
      const c = r && r.choices && r.choices[0] && r.choices[0].message;
      let text = (c && c.content) || (r && r.response) || '';
      if (typeof text !== 'string') text = JSON.stringify(text);
      text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      if (text) return json({ text, m: model.split('/').pop(), usage: (r && r.usage) || null });
      last = 'ai';
    } catch (e) {
      last = why(e);
      if (last === 'kuota') break;      // one daily allocation for every model
    }
  }
  return json({ error: last });
}

function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

async function emb(env, b) {
  const texts = (Array.isArray(b.texts) ? b.texts : []).slice(0, 48).map((t) => String(t || ' ').slice(0, 6000) || ' ');
  if (!texts.length) return json({ error: 'data' }, 400);
  let r;
  try { r = await race(env.AI.run(BGE, { text: texts }), 60000); } catch (e) { return json({ error: why(e) }); }
  const data = (r && r.data) || [];
  if (!data.length) return json({ error: 'ai' });
  const d = data[0].length, out = new Int8Array(data.length * d), s = [];
  data.forEach((v, k) => {
    let n = 0, mx = 0;
    for (let i = 0; i < d; i++) n += v[i] * v[i];
    n = Math.sqrt(n) || 1;
    for (let i = 0; i < d; i++) mx = Math.max(mx, Math.abs(v[i] / n));
    const sc = mx / 127 || 1;
    for (let i = 0; i < d; i++) out[k * d + i] = Math.round(v[i] / n / sc);
    s.push(+sc.toPrecision(6));
  });
  return json({ d, v: b64(new Uint8Array(out.buffer)), s });
}

export default {
  async fetch(req, env) {
    if (req.method !== 'POST') return json({ ok: true });
    if (!env.KEY || req.headers.get('x-key') !== env.KEY) return json({ error: 'auth' }, 401);
    const path = new URL(req.url).pathname;
    let b;
    try { b = await req.json(); } catch { return json({ error: 'data' }, 400); }
    try {
      if (path === '/chat') return await chat(env, b || {});
      if (path === '/emb') return await emb(env, b || {});
      return json({ error: 'path' }, 404);
    } catch (e) {
      return json({ error: why(e) });
    }
  },
};
