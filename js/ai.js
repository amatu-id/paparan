// AI through the Supabase edge function amatu-paparan (portal sign-in required) → Cloudflare Worker (Workers AI).
// The free daily allocation is shared by every Amatu app; when it is used up the app keeps working without AI.
import { unb64 } from './search.js';

const EDGE = 'https://ieyqxmzztoxgpvwexbkj.supabase.co/functions/v1/amatu-paparan';
let edge = EDGE;
try {
  const q = new URLSearchParams(location.search).get('edge');
  if (q && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) edge = q.replace(/\/$/, '');
} catch { }

const tok = () => { try { const s = window.AMATU && window.AMATU.sess && window.AMATU.sess(); return (s && s.t) || ''; } catch { return ''; } };
// not signed in to the portal: the gateway would refuse anyway, so don't wait for it
function gate() {
  if (edge === EDGE && !tok()) { AI.fail('auth'); throw Object.assign(new Error('auth'), { code: 'auth' }); }
  if (!AI.ok()) throw Object.assign(new Error(AI.why), { code: AI.why });
}
const LS = 'paparan.ai';
const jget = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };

export const AI = {
  why: '',
  until: 0,
  listeners: new Set(),
  on(f) { this.listeners.add(f); return () => this.listeners.delete(f); },
  ok() { return !(this.until > Date.now()); },
  message() {
    const w = this.why;
    if (w === 'kuota') return 'Kuota AI gratis hari ini habis (pulih pukul 07.00 WIB). Fitur tetap berjalan dengan mesin tanpa AI.';
    if (w === 'auth') return 'Masuk ke Portal AMATU untuk memakai AI. Fitur tetap berjalan dengan mesin tanpa AI.';
    if (w === 'net') return 'Tidak terhubung ke AI. Fitur tetap berjalan dengan mesin tanpa AI.';
    return 'AI sedang sibuk. Fitur tetap berjalan dengan mesin tanpa AI.';
  },
  fail(why) {
    this.why = why;
    if (why === 'kuota') { const d = new Date(); d.setUTCHours(24, 2, 0, 0); this.until = +d; }
    else if (why === 'auth') this.until = Date.now() + 60e3;
    else if (why === 'net') this.until = Date.now() + 20e3;
    else this.until = Date.now() + 8e3;
    this.listeners.forEach(f => f(this));
  },
  count(neurons) {
    if (!neurons) return;
    const day = new Date().toISOString().slice(0, 10), o = jget(LS, {});
    const v = o.day === day ? o : { day, n: 0 };
    v.n = (v.n || 0) + neurons;
    try { localStorage.setItem(LS, JSON.stringify(v)); } catch { }
  },
  used() { const o = jget(LS, {}); return o.day === new Date().toISOString().slice(0, 10) ? o.n || 0 : 0; },
};

async function post(path, body, signal, ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  signal?.addEventListener('abort', () => c.abort());
  try {
    const r = await fetch(`${edge}/${path}`, {
      method: 'POST', signal: c.signal,
      headers: { 'Content-Type': 'application/json', 'x-amatu': tok() },
      body: JSON.stringify(body),
    });
    return { r, clear: () => clearTimeout(t) };
  } catch (e) {
    clearTimeout(t);
    if (signal?.aborted) throw Object.assign(new Error('batal'), { code: 'batal' });
    throw Object.assign(new Error('net'), { code: 'net' });
  }
}

// chat({messages, max, temp, think, stream, onDelta(full, delta), signal}) → {text, model}
export async function chat(o) {
  gate();
  const body = { messages: o.messages, max: o.max || 1200, temp: o.temp ?? 0.3, think: !!o.think, stream: !!o.stream };
  let tries = 0;
  for (; ;) {
    let r, clear;
    try { ({ r, clear } = await post('chat', body, o.signal, o.timeout || 150e3)); }
    catch (e) { if (e.code === 'net') AI.fail('net'); throw e; }
    try {
      const ct = r.headers.get('content-type') || '';
      if (o.stream && /event-stream/.test(ct) && r.body) {
        const model = r.headers.get('x-model') || '';
        const rd = r.body.getReader(), dec = new TextDecoder();
        let buf = '', full = '', neurons = 0;
        for (; ;) {
          const { done, value } = await rd.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let k;
          while ((k = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, k).trim();
            buf = buf.slice(k + 1);
            if (!line.startsWith('data:')) continue;
            const d = line.slice(5).trim();
            if (d === '[DONE]') continue;
            try {
              const j = JSON.parse(d);
              const delta = j.choices?.[0]?.delta?.content ?? j.response ?? '';
              if (j.usage?.neurons) neurons += j.usage.neurons;
              if (delta) { full += delta; o.onDelta?.(full, delta); }
            } catch { }
          }
        }
        AI.count(neurons);
        full = full.replace(/<think>[\s\S]*?<\/think>/gi, '');
        if (!full.trim()) throw Object.assign(new Error('ai'), { code: 'ai' });
        return { text: full, model };
      }
      const j = await r.json().catch(() => ({ error: 'ai' }));
      if (j.error) {
        if (j.error === 'cepat' && tries++ < 3) { await new Promise(res => setTimeout(res, 4000 * tries)); continue; }
        if (/^(kuota|auth|sibuk|lambat|ai|net)$/.test(j.error)) AI.fail(j.error === 'lambat' ? 'sibuk' : j.error);
        throw Object.assign(new Error(j.error), { code: j.error });
      }
      AI.count(j.usage?.neurons);
      o.onDelta?.(j.text, j.text);
      return { text: j.text, model: j.m };
    } finally { clear(); }
  }
}

// embed(texts) → [{v: Int8Array, s}] (L2-normalised, int8 quantised)
export async function embed(texts, signal) {
  gate();
  let r, clear;
  try { ({ r, clear } = await post('emb', { texts }, signal, 30e3)); }
  catch (e) { if (e.code === 'net') AI.fail('net'); throw e; }
  try {
    const j = await r.json().catch(() => ({ error: 'ai' }));
    if (j.error) { if (/^(kuota|auth)$/.test(j.error)) AI.fail(j.error); throw Object.assign(new Error(j.error), { code: j.error }); }
    const all = unb64(j.v), d = j.d;
    AI.count(texts.reduce((a, t) => a + t.length, 0) / 3.6 * 1073 / 1e6);
    return j.s.map((s, i) => ({ v: all.slice(i * d, (i + 1) * d), s, d }));
  } finally { clear(); }
}

// JSON out of a model answer: code fences, chatter around it, trailing commas
export function parseJSON(text) {
  let s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0) return null;
  s = b > a ? s.slice(a, b + 1) : s.slice(a);
  const tryParse = x => { try { return JSON.parse(x); } catch { return undefined; } };
  let j = tryParse(s);
  if (j !== undefined) return j;
  s = s.replace(/,\s*([}\]])/g, '$1').replace(/[“”]/g, '"');
  j = tryParse(s);
  if (j !== undefined) return j;
  // cut off mid-way (token limit): close what is open
  return tryParse(closeJSON(s));
}
function closeJSON(s) {
  const st = [];
  let q = false, esc = false, last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') q = false; continue; }
    if (c === '"') q = true;
    else if (c === '{' || c === '[') st.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') { st.pop(); if (st.length <= 2) last = i + 1; }
  }
  // drop the unfinished element after the last complete one
  let t = s.slice(0, last).replace(/,\s*$/, '');
  const st2 = [];
  q = false; esc = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') q = false; continue; }
    if (c === '"') q = true; else if (c === '{' || c === '[') st2.push(c === '{' ? '}' : ']'); else if (c === '}' || c === ']') st2.pop();
  }
  return t + st2.reverse().join('');
}
