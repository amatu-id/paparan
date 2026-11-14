// Retrieval: Indonesian + English tokenizer with a light stemmer, BM25, int8 vectors (bge-m3), rank fusion.

const STOP = new Set(('yang dan di ke dari untuk dengan pada ini itu adalah dalam tidak akan juga atau oleh sebagai telah sudah karena agar serta tersebut maka ' +
  'bahwa dapat lebih ada apa siapa bagaimana mengapa kenapa kapan dimana mana berapa apakah adakah tolong mohon jelaskan sebutkan tunjukkan berikan ' +
  'saya aku kami kita anda kamu dia mereka nya pun lah kah jika kalau bila namun tetapi tapi hingga sampai secara para sang si ia sebuah seorang suatu ' +
  'the and of to in for is on with that this by are from as be was were it at an or which has have not will can their its what who how why when where ' +
  'does do did please tell show give me my our your about into than then there these those also any all').split(' '));

const PRE = [
  [/^meny([aiueo])/, 's$1'], [/^mem([aiueo])/, 'p$1'], [/^mem([bfpv])/, '$1'], [/^men([aiueo])/, 't$1'], [/^men([cdjsz])/, '$1'],
  [/^meng([aiueogh])/, '$1'], [/^meng(k)/, '$1'], [/^me([lmnrwy])/, '$1'],
  [/^peny([aiueo])/, 's$1'], [/^pem([aiueo])/, 'p$1'], [/^pem([bfpv])/, '$1'], [/^pen([aiueo])/, 't$1'], [/^pen([cdjsz])/, '$1'],
  [/^peng([aiueogh])/, '$1'], [/^pe([lmnrwy])/, '$1'], [/^ber([a-z])/, '$1'], [/^ter([a-z])/, '$1'], [/^per([a-z])/, '$1'],
  [/^di([a-z])/, '$1'], [/^ke([a-z])/, '$1'], [/^se([a-z])/, '$1'],
];
export function stem(w) {
  if (w.length <= 4 || /\d/.test(w)) return w;
  let s = w;
  s = s.replace(/(lah|kah|tah|pun)$/, '') || s;
  if (s.length > 5) s = s.replace(/(nya|ku|mu)$/, '');
  if (s.length > 5) {
    const t = s.replace(/(kan|an)$/, '');
    if (t.length >= 4 && t !== s) s = t;
    else if (/[^aiueo]i$/.test(s) && s.length > 5) s = s.slice(0, -1);
  }
  for (const [rx, rep] of PRE) if (rx.test(s)) { const t = s.replace(rx, rep); if (t.length >= 4) { s = t; break; } }
  // English
  if (/[a-z]{4,}(ing|ed)$/.test(s)) s = s.replace(/(ing|ed)$/, '');
  else if (/[a-z]{4,}(es|s)$/.test(s) && !/ss$/.test(s)) s = s.replace(/(es|s)$/, '');
  return s;
}

export function tokens(text, keepStop = false) {
  const out = [];
  const t = String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  for (let w of t.split(/[^a-z0-9.,%]+/)) {
    w = w.replace(/^[.,]+|[.,]+$/g, '');
    if (!w) continue;
    if (/\d/.test(w)) {
      const n = w.replace(/[.,%]/g, '');
      if (n) out.push(n);
      if (w !== n) out.push(w);
      continue;
    }
    for (const p of w.split(/[.,%]/)) {
      if (p.length < 2 || (!keepStop && STOP.has(p))) continue;
      out.push(stem(p));
    }
  }
  return out;
}

export class BM25 {
  constructor(texts) {
    this.N = texts.length;
    this.tf = []; this.len = []; this.df = new Map();
    let tot = 0;
    for (const t of texts) {
      const m = new Map();
      const tk = tokens(t);
      for (const w of tk) m.set(w, (m.get(w) || 0) + 1);
      for (const w of m.keys()) this.df.set(w, (this.df.get(w) || 0) + 1);
      this.tf.push(m); this.len.push(tk.length); tot += tk.length;
    }
    this.avg = tot / (this.N || 1) || 1;
  }
  idf(w) { const d = this.df.get(w) || 0; return Math.log(1 + (this.N - d + 0.5) / (d + 0.5)); }
  search(q, k = 20) {
    const qt = [...new Set(tokens(q))];
    if (!qt.length) return [];
    const s = new Float64Array(this.N);
    for (const w of qt) {
      const idf = this.idf(w);
      if (!this.df.has(w)) continue;
      for (let i = 0; i < this.N; i++) {
        const f = this.tf[i].get(w);
        if (!f) continue;
        s[i] += idf * (f * 2.4) / (f + 1.4 * (0.3 + 0.7 * this.len[i] / this.avg));
      }
    }
    const res = [];
    for (let i = 0; i < this.N; i++) if (s[i] > 0) res.push({ i, s: s[i] });
    return res.sort((a, b) => b.s - a.s).slice(0, k);
  }
}

// ---------- vectors ----------
export function unb64(s) { const b = atob(s), u = new Int8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = (b.charCodeAt(i) << 24) >> 24; return u; }
export function vecSearch(vec, q, k = 20) {
  // vec: {d, v: Int8Array (n·d), s: Float32Array(n)}; q: {v: Int8Array(d), s}
  if (!vec || !q) return [];
  const { d } = vec, n = vec.s.length, res = [];
  for (let i = 0; i < n; i++) {
    let dot = 0;
    const o = i * d;
    for (let j = 0; j < d; j++) dot += vec.v[o + j] * q.v[j];
    res.push({ i, s: dot * vec.s[i] * q.s });
  }
  return res.sort((a, b) => b.s - a.s).slice(0, k);
}

// reciprocal rank fusion of several ranked lists [{i}]
export function fuse(lists, k = 60) {
  const m = new Map();
  for (const L of lists) L.forEach((r, rank) => m.set(r.i, (m.get(r.i) || 0) + 1 / (k + rank + 1)));
  return [...m.entries()].map(([i, s]) => ({ i, s })).sort((a, b) => b.s - a.s);
}

// TF-IDF sentence ranking for an extractive summary (no AI)
export function keySentences(texts, n = 5) {
  const sents = [];
  texts.forEach((t, ti) => String(t).split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/).forEach(s => { s = s.trim(); if (s.length > 40 && s.length < 400) sents.push({ s, ti }); }));
  if (!sents.length) return [];
  const df = new Map();
  const toks = sents.map(x => { const t = [...new Set(tokens(x.s))]; t.forEach(w => df.set(w, (df.get(w) || 0) + 1)); return t; });
  const N = sents.length;
  const score = toks.map((t, i) => {
    let s = 0;
    for (const w of t) { const d = df.get(w); if (d > 1) s += Math.log(N / d) * Math.min(d, 6); }
    const num = /\d/.test(sents[i].s) ? 1.25 : 1;
    return s / Math.pow(t.length + 4, 0.6) * num * (1 + 0.6 / (1 + sents[i].ti * 0.05));
  });
  return sents.map((x, i) => ({ ...x, sc: score[i] })).sort((a, b) => b.sc - a.sc).slice(0, n).sort((a, b) => a.ti - b.ti).map(x => x.s);
}
