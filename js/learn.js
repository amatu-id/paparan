// Learning a file: extract → chunks → search index (+ AI embeddings) → digest (AI summary, key points, questions).
import { DB } from './db.js';
import { extract, kindOf } from './extract.js';
import { BM25, keySentences, unb64 } from './search.js';
import { AI, chat, embed, parseJSON } from './ai.js';
import { factSheet, tableBrief, tableText, short } from './analyze.js';
import { uid, extOf, baseName, idle } from './util.js';

export const tokensOf = s => Math.ceil(String(s || '').length / 3.6);

// ---------- chunks ----------
export function chunk(c) {
  const out = [];
  const path = [];
  let buf = [], len = 0, u0 = 0, u1 = 0, b0 = 0, b1 = 0;
  const head = () => path.map(p => p.x).join(' › ');
  const flush = () => {
    if (!buf.length) return;
    const x = buf.join('\n').trim();
    if (x) out.push({ x, u: u0, u2: u1, b: [b0, b1], h: head() });
    buf = []; len = 0;
  };
  const push = (s, b, i) => {
    if (!buf.length) { u0 = b.u; b0 = i; }
    buf.push(s); len += s.length; u1 = b.u; b1 = i;
  };
  c.blocks.forEach((b, i) => {
    if (b.t === 'h') {
      flush();
      const lv = b.lv || 2;
      while (path.length && path[path.length - 1].lv >= lv) path.pop();
      path.push({ lv, x: short(b.x, 80) });
      push('# ' + b.x, b, i);
      return;
    }
    if (b.t === 'tbl') {
      flush();
      const t = c.tables[b.ti];
      const where = c.units[t.u]?.label || '';
      const hd = `Tabel: ${t.title || '(tanpa judul)'}${where ? ' · ' + where : ''}\nKolom: ${t.head.join(' | ')}`;
      let part = [], plen = 0, r0 = 0;
      const emit = (r1) => { out.push({ x: hd + '\n' + part.join('\n'), u: t.u, u2: t.u, b: [i, i], h: head(), ti: b.ti, rows: [r0, r1] }); part = []; plen = 0; };
      t.rows.forEach((r, k) => {
        const line = r.map(v => String(v ?? '').trim()).join(' | ');
        if (plen + line.length > 1500 && part.length) { emit(k - 1); r0 = k; }
        part.push(line); plen += line.length + 1;
      });
      if (part.length) emit(t.rows.length - 1);
      if (out.length > 4000) return;
      return;
    }
    const s = (b.t === 'li' ? '• ' : b.t === 'note' ? 'Catatan pembicara: ' : '') + b.x;
    if (s.length > 1800) {
      // a very long paragraph: cut at sentence ends
      let piece = '';
      for (const sen of s.split(/(?<=[.!?])\s+/)) {
        if (piece.length + sen.length > 1200 && piece) { flush(); push(piece, b, i); flush(); piece = ''; }
        piece += (piece ? ' ' : '') + sen;
      }
      if (piece) { push(piece, b, i); }
      if (len > 1000) flush();
      return;
    }
    if (len + s.length > 1300 && len > 300) flush();
    push(s, b, i);
    if (len > 1000) flush();
  });
  flush();
  return out.map((k, i) => ({ i, ...k }));
}

// ---------- in-memory cache of loaded documents ----------
const cache = new Map();
export async function loadDoc(id) {
  if (cache.has(id)) return cache.get(id);
  const [meta, content, vec] = await Promise.all([DB.get('docs', id), DB.get('content', id), DB.get('vec', id)]);
  if (!meta || !content) return null;
  const L = { meta, content, bm: new BM25(content.chunks.map(k => (k.h ? k.h + '\n' : '') + k.x)), vec: vecOf(vec, content.chunks.length), fs: null };
  cache.set(id, L);
  if (cache.size > 8) cache.delete(cache.keys().next().value);
  return L;
}
export const facts = L => (L.fs ||= factSheet(L.content));
export function forget(id) { cache.delete(id); }
function vecOf(v, n) {
  if (!v || !v.v || !v.s || v.s.length !== n) return null;
  const vv = v.v instanceof Int8Array ? v.v : typeof v.v === 'string' ? unb64(v.v) : new Int8Array(v.v.buffer || v.v);
  return { d: v.d, v: vv, s: v.s instanceof Float32Array ? v.s : Float32Array.from(v.s) };
}

// ---------- learning pipeline ----------
// learn(file, onProg(p 0..1, text)) → doc id
// this device (a document being learned elsewhere must not be marked as failed here)
export function device() {
  try {
    if (window.AMATU && window.AMATU.DEV) return window.AMATU.DEV;
    let d = localStorage.getItem('pt.paparan.dev');
    if (!d) { d = uid(10); localStorage.setItem('pt.paparan.dev', d); }
    return d;
  } catch { return 'x'; }
}
export const lockName = id => 'paparan-learn-' + id;
const withLock = (id, f) => (navigator.locks?.request ? navigator.locks.request(lockName(id), f) : f());

export async function learn(file, onProg = () => { }, onStart = () => { }) {
  const kind = kindOf(file);
  if (!kind) throw new Error('Jenis file ini belum didukung: ' + (extOf(file.name) || file.type || 'tidak dikenal'));
  const id = uid(14);
  return withLock(id, () => learnIn(id, kind, file, onProg, onStart));
}
async function learnIn(id, kind, file, onProg, onStart) {
  const meta = { id, name: file.name, ext: extOf(file.name), mime: file.type || '', size: file.size, kind, added: Date.now(), status: 'baca', prog: 0, dev: device() };
  await DB.put('docs', meta);
  onStart(id);
  await DB.put('files', { id, blob: file });
  try {
    await absorb(id, meta, file, onProg);
    return id;
  } catch (e) {
    await DB.patch('docs', id, { status: 'gagal', err: String(e.message || e).slice(0, 300) });
    throw e;
  }
}
// read the file, store what was learned, then the AI part
async function absorb(id, meta, file, onProg) {
  const c = await extract(file, (p, t) => { onProg(p * 0.7, t); });
  if (!c.blocks.length && !c.tables.length) throw new Error('Tidak ada teks yang bisa dibaca di file ini.');
  onProg(0.72, 'Menyusun pengetahuan');
  c.id = id;
  c.chunks = chunk(c);
  c.stats = { chars: c.chunks.reduce((a, k) => a + k.x.length, 0), tables: c.tables.length, blocks: c.blocks.length };
  c.stats.tokens = tokensOf('x'.repeat(c.stats.chars));
  await DB.put('content', c);
  await DB.del('vec', id).catch(() => { });
  const title = c.meta.title && c.meta.title.length > 3 && !/^(microsoft|untitled|document|dokumen|presentation)/i.test(c.meta.title) ? c.meta.title : (c.blocks.find(b => b.t === 'h')?.x || baseName(file.name));
  Object.assign(meta, { status: 'indeks', title: short(title, 120), pages: c.units.length, unitKind: c.kind, lang: c.meta.lang, tables: c.tables.length, chunks: c.chunks.length, tokens: c.stats.tokens, ocr: c.meta.ocr || 0, imgs: c.meta.imgs || 0, legacy: c.meta.legacy || 0, cv: c.v || 1 });
  await DB.put('docs', meta);
  forget(id);
  await deepenIn(id, onProg);
}

// Read a stored document again with the current reader (keeps its id, Q&A history and presentations)
export function reread(id, onProg = () => { }) {
  return withLock(id, async () => {
    const [meta, f] = await Promise.all([DB.get('docs', id), DB.get('files', id)]);
    if (!meta) throw new Error('Dokumen tidak ditemukan');
    if (!f?.blob) throw new Error('File asli tidak ada di perangkat ini. Unggah ulang file-nya.');
    const file = f.blob instanceof File ? f.blob : new File([f.blob], meta.name, { type: meta.mime || '' });
    await DB.patch('docs', id, { status: 'baca', prog: 0, err: null });
    try { await absorb(id, await DB.get('docs', id), file, onProg); }
    catch (e) { await DB.patch('docs', id, { status: 'gagal', err: String(e.message || e).slice(0, 300) }); throw e; }
  });
}
export { CONTENT_V } from './extract.js';

// AI part (embeddings + digest). Also used by "Pelajari ulang". Without AI the offline digest is used.
export function deepen(id, onProg = () => { }) { return withLock(id, () => deepenIn(id, onProg)); }
async function deepenIn(id, onProg) {
  const L = await loadDoc(id);
  if (!L) return;
  const { content, meta } = L;
  let aiDone = 0;
  if (AI.ok() && content.chunks.length) {
    try {
      onProg(0.75, 'AI mempelajari makna isi dokumen');
      const texts = content.chunks.map(k => ((k.h ? k.h + '\n' : '') + k.x).slice(0, 2400));
      const B = 32, d = 1024;
      const v = new Int8Array(texts.length * d), s = new Float32Array(texts.length);
      for (let i = 0; i < texts.length; i += B) {
        const res = await embed(texts.slice(i, i + B));
        res.forEach((r, k) => { v.set(r.v, (i + k) * d); s[i + k] = r.s; });
        onProg(0.75 + 0.1 * Math.min(1, (i + B) / texts.length), 'AI mempelajari makna isi dokumen');
        await idle();
      }
      await DB.put('vec', { id, d, v, s });
      L.vec = { d, v, s };
      aiDone++;
    } catch (e) { console.warn('embed', e); }
  }
  onProg(0.86, 'Merangkum isi dokumen');
  let dg = null;
  if (AI.ok()) {
    try { dg = await digestAI(L); aiDone++; } catch (e) { console.warn('digest', e); }
  }
  if (!dg) dg = digestOffline(L);
  await DB.patch('docs', id, { status: 'siap', digest: dg, ai: aiDone, prog: 1, learned: Date.now(), err: null });
  L.meta = await DB.get('docs', id);
  onProg(1, 'Selesai');
}

// document text for prompts, in reading order, with unit labels; tables as compact markdown
export function docText(c, maxTok = 20000, tableRows = 40) {
  let out = '', lastU = -1;
  const lim = maxTok * 3.6;
  for (const b of c.blocks) {
    if (out.length > lim) { out += '\n[… dokumen dipotong …]'; break; }
    if (b.u !== lastU && c.units.length > 1) { out += `\n[${c.units[b.u]?.label || ''}]\n`; lastU = b.u; }
    if (b.t === 'h') out += `\n## ${b.x}\n`;
    else if (b.t === 'li') out += `• ${b.x}\n`;
    else if (b.t === 'tbl') { const t = c.tables[b.ti]; out += `\nTabel${t.title ? ': ' + t.title : ''}\n${tableText(t, tableRows, 5000)}\n`; }
    else if (b.t === 'note') out += `(Catatan: ${b.x})\n`;
    else out += b.x + '\n';
  }
  return out.trim();
}

async function digestAI(L) {
  const { content, meta } = L;
  const fs = facts(L);
  const tb = fs.tables.slice(0, 12).map(T => tableBrief(T)).join('\n');
  const text = docText(content, 22000, 25);
  const sys = `Anda analis dokumen yang teliti. Baca dokumen lalu tulis ringkasan dalam bahasa Indonesia yang baku, padat, dan akurat.
Gunakan HANYA isi dokumen. Jangan mengarang angka. Balas hanya JSON valid tanpa teks lain.`;
  const user = `Nama file: ${meta.name}
${tb ? 'Statistik tabel (dihitung otomatis dari data):\n' + tb + '\n\n' : ''}ISI DOKUMEN:
${text}

Balas JSON dengan bentuk:
{"judul": "judul dokumen yang jelas (maks 12 kata)",
 "jenis": "jenis dokumen, mis. laporan produksi bulanan / proposal / SOP / data penjualan",
 "periode": "periode atau tanggal yang dibahas, atau kosong",
 "organisasi": "nama organisasi/perusahaan/unit bila disebut, atau kosong",
 "ringkasan": "3-5 kalimat: apa dokumen ini, isi utamanya, dan angka/temuan terpenting",
 "poin": ["5-7 poin kunci paling penting, masing-masing satu kalimat pendek, sertakan angka penting persis seperti di dokumen"],
 "pertanyaan": ["6 pertanyaan berguna yang bisa dijawab dari dokumen ini, singkat"]}`;
  const r = await chat({ messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], max: 1400, temp: 0.2, timeout: 90e3 });
  const j = parseJSON(r.text);
  if (!j || !j.ringkasan) return null;
  return {
    ai: 1, title: short(j.judul || meta.title, 120), type: short(j.jenis || '', 80), period: short(j.periode || '', 60), org: short(j.organisasi || '', 80),
    summary: String(j.ringkasan || '').slice(0, 1600),
    points: (Array.isArray(j.poin) ? j.poin : []).map(p => short(p, 260)).filter(Boolean).slice(0, 8),
    questions: (Array.isArray(j.pertanyaan) ? j.pertanyaan : []).map(p => short(p, 160)).filter(Boolean).slice(0, 8),
  };
}

export function digestOffline(L) {
  const { content, meta } = L;
  const fs = facts(L);
  const paras = content.blocks.filter(b => b.t === 'p' || b.t === 'li').map(b => b.x);
  const sents = keySentences(paras, 5);
  const heads = content.blocks.filter(b => b.t === 'h').map(b => b.x).slice(0, 30);
  const points = [];
  for (const f of fs.facts.filter(f => f.k !== 'text').sort((a, b) => b.w - a.w).slice(0, 5)) points.push(f.text);
  for (const s of sents) if (points.length < 7) points.push(short(s, 220));
  const qs = [];
  for (const T of fs.tables.slice(0, 3)) {
    const m = T.A.measures[0];
    if (m && T.A.dim) { qs.push(`Berapa total ${m.name.replace(/\s*\(.*?\)/g, '')} di tabel ${T.title}?`); qs.push(`${T.A.dim.name} mana dengan ${m.name.replace(/\s*\(.*?\)/g, '')} tertinggi?`); }
    if (T.A.pairs.length) qs.push(`Berapa persen pencapaian target?`);
  }
  for (const h of heads.slice(0, 6)) if (qs.length < 6 && h.length < 70) qs.push(`Apa isi bagian "${h}"?`);
  if (qs.length < 3) qs.push('Apa inti dokumen ini?', 'Apa saja poin penting di dokumen ini?');
  const summary = sents.slice(0, 3).join(' ') || (heads.length ? 'Dokumen ini membahas: ' + heads.slice(0, 6).join('; ') + '.' : `Dokumen berisi ${content.tables.length} tabel data.`);
  return { ai: 0, title: meta.title, type: content.tables.length && paras.length < 10 ? 'Data/tabel' : '', period: '', org: '', summary: short(summary, 900), points: points.slice(0, 7), questions: [...new Set(qs)].slice(0, 6) };
}

export { idle };
