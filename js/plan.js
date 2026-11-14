// Presentation plan: Gemma 4 writes the storyline (action titles, bullets, which facts/charts/tables to show),
// then every number on the slides is checked against the document. Without AI a rule-based plan is used.
import { loadDoc, facts, docText } from './learn.js';
import { AI, chat, parseJSON } from './ai.js';
import { knownNumber, tableBrief, stats, mName, short } from './analyze.js';
import { parseNum } from './numparse.js';
import { keySentences } from './search.js';
import { fmtNum, fmtVal, fmtFixed, uid } from './util.js';
import { fmtShort } from './charts.js';

export const STYLES = {
  laporan: { name: 'Laporan resmi', d: 'Formal report presentation for management: complete, structured and concise; performance, analysis, issues, follow-up.' },
  eksekutif: { name: 'Ringkas eksekutif', d: 'Executive briefing for directors: only the most important findings, numbers and decisions; very concise.' },
  edukasi: { name: 'Materi edukasi', d: 'Training / teaching material: explains the content clearly step by step, with key concepts, examples from the document and a recap.' },
  proposal: { name: 'Proposal / pitch', d: 'Persuasive proposal: context and problem, proposed solution, benefits backed by the numbers, plan and timeline, what is asked.' },
};
export const LENS = { ringkas: [6, 8, 'Ringkas'], standar: [10, 13, 'Standar'], lengkap: [15, 20, 'Lengkap'] };
const TYPES = new Set(['cover', 'agenda', 'kpi', 'chart', 'bullets', 'two', 'table', 'steps', 'statement', 'section', 'conclusion', 'end']);

// ---------- numbers on slides must come from the document ----------
const NUM_RX = /(?:rp\.?\s?)?[-−]?\d[\d.,]*(?:\s?(?:%|persen|jt|juta|rb|ribu|miliar|triliun|m\b|t\b))?/gi;
export function unknownNumbers(text, nums, digits) {
  const bad = [];
  for (const m of String(text || '').matchAll(NUM_RX)) {
    const raw = m[0].trim().replace(/[.,]$/, '');
    if (!/\d/.test(raw)) continue;
    const dg = raw.replace(/\D/g, '').replace(/^0+/, '');
    if (digits && dg.length >= 2 && digits.has(dg)) continue;
    const p = parseNum(raw, 'id');
    const vals = [p?.v, parseNum(raw, 'en')?.v].filter(v => v != null && Number.isFinite(v));
    if (!vals.length) continue;
    // "Rp 8,8 M" or "3,1 juta" may be a rounded, rescaled document value; a plain "72" must be written in the document
    const scaled = /rp|%|persen|jt|juta|rb|ribu|miliar|milyar|triliun|\bm\b|\bt\b|[.,]\d/i.test(raw);
    if (!scaled) {
      const v = vals[0];
      if ((Number.isInteger(v) && Math.abs(v) <= 12) || (v >= 1990 && v <= 2100)) continue;
      if (!digits || !digits.has(dg)) bad.push(raw);
      continue;
    }
    if (!vals.some(v => knownNumber(nums, v, scaled))) bad.push(raw);
  }
  return bad;
}

export function kpiValue(f) {
  const v = f.v, u = f.unit || '';
  if (v == null) return '';
  if (u === '%') return fmtFixed(v, 1) + '%';
  if (/^rp/i.test(u)) { const suf = u === 'Rp jt' ? ' jt' : u === 'Rp M' ? ' M' : u === 'Rp rb' ? ' rb' : ''; return 'Rp ' + (suf ? fmtNum(v) + suf : fmtShort(v)); }
  const s = Math.abs(v) >= 1e6 ? fmtShort(v) : fmtNum(v, Math.abs(v) >= 100 ? 0 : 1);
  return u ? s + ' ' + u : s;
}

function chartData(c) {
  return { type: c.type, title: c.title, cats: c.cats, series: c.series.map(s => ({ name: s.name, vals: s.vals, kind: s.kind, dash: s.dash, muted: s.muted })), unit: c.unit, ref: c.ref, pct: c.pct, sort: c.sort, ach: c.ach, met: c.met, n: c.n };
}
function tableData(T, L, max = 11) {
  const t = L.content.tables[T.ti];
  const A = T.A;
  const num = t.head.map((_, j) => A.cols[j]?.kind === 'num');
  let rows = t.rows.map(r => r.map(v => String(v ?? '')));
  let more = 0;
  if (rows.length > max) { more = rows.length - max; rows = rows.slice(0, max); }
  let hl = -1;
  const m = A.measures.find(x => x.role === 'actual') || A.measures[0];
  if (m && A.kind === 'category') { let best = -Infinity; rows.forEach((r, i) => { const v = A.P[A.data[i]]?.[m.i]?.v; if (v != null && v > best && i < A.data.length) { best = v; hl = i; } }); }
  return { head: t.head.map(String), rows, num, hl, more, max };
}

// ---------- AI plan ----------
export async function planDeck(id, o, onProg = () => { }, signal) {
  const L = await loadDoc(id);
  if (!L) throw new Error('Dokumen belum siap');
  const fs = facts(L);
  const dg = L.meta.digest || {};
  const base = {
    id: uid(12), doc: id, created: Date.now(), style: o.style, len: o.len, theme: o.theme, lang: o.lang || 'id', note: o.note || '',
    title: dg.title || L.meta.title || L.meta.name, subtitle: '', kicker: dg.type || '', org: dg.org || '', period: dg.period || '',
    dateText: new Intl.DateTimeFormat(o.lang === 'en' ? 'en-GB' : 'id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()),
  };
  let spec = null;
  if (AI.ok()) {
    // one more try on a passing hiccup (busy model, timeout, unreadable answer) before the rule-based plan
    for (let attempt = 0; attempt < 2 && !spec; attempt++) {
      try { spec = await aiPlan(L, fs, o, base, onProg, signal); }
      catch (e) {
        if (e.code === 'batal') throw e;
        console.warn('plan ai', e);
        base.aiErr = String((e && (e.code || e.message)) || e);
        try { window.__paparanPlanErr = base.aiErr; } catch { }
        if (/kuota|auth/.test(base.aiErr) || !AI.ok()) break;
        if (!attempt) onProg(0.15, 'AI sedang sibuk, mencoba sekali lagi…');
      }
    }
  }
  if (!spec) { onProg(0.6, 'Menyusun paparan dengan mesin tanpa AI'); spec = { ...base, ...autoPlan(L, fs, o), source: 'auto' }; }
  finalize(spec, L, fs);
  return spec;
}

async function aiPlan(L, fs, o, base, onProg, signal) {
  const [n1, n2] = LENS[o.len] || LENS.standar;
  const en = o.lang === 'en';
  const dg = L.meta.digest || {};
  const factLines = fs.facts.filter(f => f.k !== 'text').sort((a, b) => b.w - a.w).slice(0, 60).map(f => `${f.id} ${f.text}`).join('\n');
  const textFacts = fs.facts.filter(f => f.k === 'text').slice(0, 16).map(f => `${f.id} "${f.text}"`).join('\n');
  const chartLines = orderCharts(fs, true).slice(0, 26).map(c => `${c.id} [${c.type}${c.pct ? ', persentase' : ''}] ${c.title} — ${c.note} (dari ${c.t})`).join('\n');
  const nData = fs.facts.filter(f => f.v != null && f.k !== 'text').length;
  const minCharts = Math.min(orderCharts(fs).length, o.len === 'ringkas' ? 2 : o.len === 'lengkap' ? 6 : 4);
  const tableLines = fs.tables.slice(0, 16).map(T => tableBrief(T)).join('\n');
  const budget = o.len === 'lengkap' ? 26000 : o.len === 'ringkas' ? 14000 : 20000;
  const text = docText(L.content, budget, 18);
  const sys = `You are a senior management consultant and presentation designer. You turn documents into clear, professional, board-ready slide decks.
You only use information from the document you are given. You never invent facts or numbers. You answer with valid JSON only.`;
  const user = `Write the slide plan for a presentation based ONLY on the document below.

GOAL: ${STYLES[o.style]?.d || STYLES.laporan.d}
LENGTH: ${n1}-${n2} slides in total (including cover and closing).
LANGUAGE: all slide text in ${en ? 'English' : 'Bahasa Indonesia (formal, baku, natural — not a literal translation)'}.
${o.note ? 'USER INSTRUCTIONS (follow them): ' + o.note + '\n' : ''}
PRINCIPLES
- Start with the answer: right after the cover (and agenda, if any) put an executive summary "kpi" slide with the 3-4 most important numbers.
- Every content slide title is an ACTION TITLE: one complete sentence (max 14 words) that states the insight, e.g. "${en ? 'October output reached 96.3% of target despite more downtime' : 'Produksi Oktober capai 96,3% target meski downtime meningkat'}". Not a topic label like "${en ? 'Production data' : 'Data Produksi'}".
- Bullets: max 4 per slide, max 18 words each, concrete; each carries a fact, a comparison or an implication. No filler, no repetition.
- Use ONLY facts, numbers, names and dates from the DOCUMENT, FACTS, CHARTS and TABLES. Never invent or estimate numbers. Never write fact/chart/table ids (F12, C3, T1) inside slide text — ids only go in the "fact", "chart" and "table" fields. Copy numbers exactly (${en ? 'you may use English number format' : 'format Indonesia: 12.450,5 dan 96,3%'}).
- Show the data: use the available charts by id where they support the story (each chart at most once). The chart slide title states what the chart proves; its bullets explain peak/lowest/trend/gap/cause.
- Use a "table" slide only for small tables that are clearer as a table.
${nData ? `
DATA FIRST (this document contains numeric data — the deck must be data-driven):
- Numbers have priority: every content slide must show concrete values from FACTS / CHARTS / TABLES (totals, targets, achievement %, growth, highest/lowest, shares). No slide without numbers when the document has numbers for that topic.
- The executive summary "kpi" slide uses the most important figures (e.g. total revenue, target, achievement %).
- Use at least ${minCharts} "chart" slides (more if the length allows): one per main table/topic. Prefer charts that express percentages (marked "persentase": achievement vs target, share/composition) to present proportions.
- When a value relates to a target or a total, state the percentage explicitly (e.g. "Omzet 2026 Rp 5,71 miliar = 15,87% dari target Rp 36 miliar").
` : ''}
- Build a logical storyline for this kind of document. For a production/operations report for example: executive summary → performance vs target → trend → breakdown (per line/product/shift) → issues, downtime or quality → actions/plan → conclusion. For a narrative document: context → key points per section → implications → conclusion.
- Recommendations must follow from the document (stated plans/actions, or what the findings clearly require). Do not add generic advice.
- "notes" = 1-3 sentences the presenter can say.

SLIDE TYPES (use these JSON shapes):
{"type":"cover","title":"...","subtitle":"...","meta":"organisation · period"}
{"type":"agenda","title":"Agenda","points":["...","..."]}
{"type":"kpi","title":"action title","kpis":[{"fact":"F3","label":"max 4 words","note":"max 6 words"}],"points":["..."]}  (2-4 kpis; "fact" must be a fact id with a number)
{"type":"chart","title":"action title","chart":"C2","points":["...","..."]}
{"type":"bullets","title":"action title","points":["..."]}
{"type":"two","title":"action title","left":{"head":"...","points":["..."]},"right":{"head":"...","points":["..."]}}
{"type":"table","title":"action title","table":"T1","points":["..."]}
{"type":"steps","title":"action title","steps":[{"head":"...","text":"..."}]}  (3-5 steps: process, timeline or action plan)
{"type":"statement","title":"short label","text":"one key message sentence"}
{"type":"section","title":"section name","subtitle":"one line"}
{"type":"conclusion","title":"${en ? 'Conclusions & Recommendations' : 'Kesimpulan & Rekomendasi'}","points":["conclusions"],"recs":["recommendations"]}
{"type":"end","title":"${en ? 'Thank you' : 'Terima kasih'}","subtitle":"..."}
Every slide may have "notes". First slide = cover, last slide = end.

OUTPUT: JSON only: {"title":"presentation title (max 10 words)","subtitle":"one line","slides":[ ... ]}

=== DOCUMENT ===
File: ${L.meta.name}
Type: ${dg.type || '-'} | Period: ${dg.period || '-'} | Organisation: ${dg.org || '-'}
Summary: ${short(dg.summary || '', 900)}

FACTS (verified, computed from the full data):
${factLines || '-'}
${textFacts ? '\nKEY SENTENCES WITH NUMBERS:\n' + textFacts : ''}

CHARTS AVAILABLE:
${chartLines || '-'}

TABLES:
${tableLines || '-'}

DOCUMENT TEXT:
${text}`;
  onProg(0.12, 'AI membaca dokumen & menyusun alur cerita');
  let lastN = 0;
  const r = await chat({
    messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], max: 7000, temp: 0.35, stream: true, signal,
    onDelta: full => {
      const n = (full.match(/"type"\s*:/g) || []).length;
      if (n !== lastN) { lastN = n; onProg(Math.min(0.85, 0.15 + n / (n2 + 2) * 0.7), `AI menulis slide ${n}…`); }
    },
  });
  const j = parseJSON(r.text);
  try { window.__paparanPlan = { at: Date.now(), model: r.model, chars: r.text.length, head: r.text.slice(0, 400), tail: r.text.slice(-400), ok: !!(j && Array.isArray(j.slides)) }; } catch { }
  if (!j || !Array.isArray(j.slides) || j.slides.length < 3) throw new Error('rencana AI tidak terbaca');
  onProg(0.9, 'Memeriksa angka & menata desain');
  return { ...base, title: short(j.title || base.title, 110), subtitle: short(j.subtitle || '', 160), slides: j.slides, source: 'ai', model: r.model };
}

// ---------- check + resolve ----------
function finalize(spec, L, fs) {
  const nums = fs.nums;
  const en = spec.lang === 'en';
  const factBy = Object.fromEntries(fs.facts.map(f => [f.id, f]));
  const chartBy = Object.fromEntries(fs.charts.map(c => [c.id, c]));
  const tabBy = Object.fromEntries(fs.tables.map(T => [T.id, T]));
  const dropped = [];
  // the writer sometimes cites its sources ("(F52)", "[C3]", "F12, F13"): not slide text, and not numbers to check
  const cleanTxt = s => String(s ?? '').replace(/\*\*|__/g, '')
    .replace(/\s*[\[(]\s*(?:(?:F|C|T)\d+\s*[,;/&]?\s*)+[\])]/g, '')
    .replace(/\b(?:F|C|T)\d{1,3}\b(?=\s*(?:[,;.)]|$))/g, '')
    .replace(/\s+([,.;:])/g, '$1').replace(/\s+/g, ' ').trim();
  const okText = (s, where) => { const bad = unknownNumbers(s, nums, fs.digits); if (bad.length) { dropped.push({ where, text: s, bad }); return false; } return true; };
  const okList = (a, where, max = 5) => (Array.isArray(a) ? a : []).map(cleanTxt).filter(Boolean).filter(s => okText(s, where)).map(s => short(s, 220)).slice(0, max);
  const usedCharts = new Set();
  const out = [];
  for (const raw of spec.slides) {
    if (!raw || typeof raw !== 'object') continue;
    let s = { ...raw, type: TYPES.has(raw.type) ? raw.type : 'bullets' };
    s.title = cleanTxt(s.title);
    s.notes = cleanTxt(s.notes);
    if (s.title && !okText(s.title, 'judul')) s.title = '';
    s.points = okList(s.points, s.title);
    if (s.type === 'cover' || s.type === 'end' || s.type === 'section' || s.type === 'statement') {
      s.subtitle = cleanTxt(s.subtitle); s.text = cleanTxt(s.text); s.meta = cleanTxt(s.meta);
      if (s.text && !okText(s.text, 'pernyataan')) s.type = s.points.length ? 'bullets' : 'skip';
    }
    if (s.type === 'kpi') {
      s.kpis = (Array.isArray(s.kpis) ? s.kpis : []).map(k => {
        const f = factBy[String(k?.fact || '').trim()];
        if (!f || f.v == null) return null;
        const v = kpiValue(f);
        let note = cleanTxt(k.note);
        const digits = x => String(x).replace(/[^\d]/g, '');
        // a note that only repeats the big number ("44,2 jam" under "44,2 jam") says nothing
        if (note && (note.includes(v) || (digits(note).length >= 2 && digits(note) === digits(v)))) note = note.replace(/(rp\s?)?[-\d.,]+\s*(%|jam|ton|kg|unit|jt|juta|m|miliar)?/gi, '').replace(/\s+/g, ' ').trim();
        if (note && note.replace(/[^a-z]/gi, '').length < 4) note = '';
        return { fact: f.id, v, label: short(cleanTxt(k.label) || f.label || '', 40), note: short(note || f.sub || '', 50), pct: pctOf(f), _f: f };
      }).filter(Boolean);
      // one figure, one card: when two cards show the same fact keep the one whose label fits it ("Pencapaian
      // target 15,9%", not "Omzet 2026 15,9%"); a currency word on a percentage is the wrong label
      const words = x => new Set(String(x || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3));
      const fit = k => { const a = words(k.label), b = words(k._f.label + ' ' + k._f.text); let n = 0; for (const w of a) if (b.has(w)) n++; if (k._f.unit === '%' && /\b(omzet|omset|nilai|total|rp|rupiah|jumlah)\b/i.test(k.label) && !/(pencapaian|persen|%|realisasi)/i.test(k.label)) n -= 5; return n; };
      const best = new Map();
      for (const k of s.kpis) { const o = best.get(k.fact); if (!o || fit(k) > fit(o)) best.set(k.fact, k); }
      s.kpis = s.kpis.filter(k => best.get(k.fact) === k).slice(0, 4).map(({ _f, ...k }) => k);
      if (s.kpis.length < 2) {
        const extra = topKpis(fs).filter(f => !s.kpis.some(k => k.fact === f.id)).slice(0, 4 - s.kpis.length);
        s.kpis.push(...extra.map(f => ({ fact: f.id, v: kpiValue(f), label: short(f.label || '', 40), note: short(f.sub || '', 50), pct: pctOf(f) })));
      }
      if (s.kpis.length < 2) s.type = s.points.length ? 'bullets' : 'skip';
    }
    if (s.type === 'chart') {
      const c = chartBy[String(s.chart || '').trim()];
      if (!c || usedCharts.has(c.id)) s.type = s.points.length ? 'bullets' : 'skip';
      else { usedCharts.add(c.id); s.chartId = c.id; s.chartData = chartData(c); if (!s.title) s.title = c.title; if (!s.points.length) s.points = chartPoints(c, en); }
    }
    if (s.type === 'table') {
      const T = tabBy[String(s.table || '').trim()];
      if (!T) s.type = s.points.length ? 'bullets' : 'skip';
      else { s.tableData = tableData(T, L); if (!s.title) s.title = T.title; }
    }
    if (s.type === 'two') {
      for (const side of ['left', 'right']) { const c = s[side] || {}; s[side] = { head: short(cleanTxt(c.head), 60), points: okList(c.points, s.title, 6) }; }
      if (!s.left.points.length && !s.right.points.length) s.type = 'skip';
    }
    if (s.type === 'steps') {
      s.steps = (Array.isArray(s.steps) ? s.steps : []).map(p => ({ head: short(cleanTxt(p?.head), 60), text: short(cleanTxt(p?.text), 180) })).filter(p => p.head && okText(p.head + ' ' + p.text, s.title)).slice(0, 5);
      if (s.steps.length < 2) s.type = s.points.length ? 'bullets' : 'skip';
    }
    if (s.type === 'conclusion') s.recs = okList(s.recs, 'rekomendasi', 5);
    if (s.type === 'agenda' && !s.points.length) s.points = [];
    if ((s.type === 'bullets' || s.type === 'conclusion') && !s.points.length && !(s.recs || []).length) s.type = 'skip';
    if (s.type !== 'skip') out.push(s);
  }
  // cover first, end last
  if (out[0]?.type !== 'cover') out.unshift({ type: 'cover' });
  if (out[out.length - 1]?.type !== 'end') out.push({ type: 'end', title: en ? 'Thank you' : 'Terima kasih' });
  ensureData(out, fs, en);
  const cov = out[0];
  cov.title ||= spec.title; cov.subtitle ||= spec.subtitle || ''; cov.meta ||= [spec.org, spec.period].filter(Boolean).join(' · ');
  cov.kicker ||= spec.kicker;
  const end = out[out.length - 1];
  end.title ||= en ? 'Thank you' : 'Terima kasih';
  end.subtitle ||= spec.title;
  // agenda from the sections or content titles
  const ag = out.find(s => s.type === 'agenda');
  if (ag && ag.points.length < 2) {
    const secs = out.filter(s => s.type === 'section').map(s => s.title);
    ag.points = (secs.length >= 2 ? secs : out.filter(s => !/^(cover|agenda|end|section)$/.test(s.type)).map(s => short(s.title.split(/[:,–-]/)[0], 60))).slice(0, 8);
  }
  let sec = 0;
  for (const s of out) if (s.type === 'section') s.num = ++sec;
  spec.slides = out;
  spec.dropped = dropped;
}

// a progress bar only for "how far toward the target / share of the whole", not for a growth rate
const pctOf = f => (f && f.v != null && (f.k === 'ach' || f.k === 'share' || f.k === 'worst' || (f.unit === '%' && /pencapaian|capaian|achievement|target|realisasi|porsi|share|persentase/i.test(f.label || f.text || '') && !/perubahan|tren|naik|turun|growth/i.test(f.label || ''))) && f.v >= 0 && f.v <= 400 ? +f.v : undefined);

// charts worth showing: the best one of each table first, percentage charts favoured, generic "Kolom 3" charts last/out
export function orderCharts(fs, all = false) {
  const ok = fs.charts.filter(c => (all || !c.weak) && c.cats.length >= 2 && c.series.some(x => x.vals.filter(v => v != null).length >= 2));
  const byT = new Map();
  for (const c of ok) { if (!byT.has(c.t)) byT.set(c.t, []); byT.get(c.t).push(c); }
  const rank = c => (c.weak ? 10 : 0) + (c.type === 'combo' ? -2 : 0) + (c.pct ? -1 : 0);
  const lists = [...byT.values()].map(l => l.slice().sort((a, b) => rank(a) - rank(b)));
  const out = [];
  for (let round = 0; out.length < ok.length && round < 20; round++) for (const l of lists) if (l[round]) out.push(l[round]);
  return out.sort((a, b) => (a.weak ? 1 : 0) - (b.weak ? 1 : 0));
}

// The deck must show the numbers: a KPI summary and enough charts, added from the data when the writer left them out.
function ensureData(slides, fs, en) {
  const numFacts = fs.facts.filter(f => f.v != null && f.k !== 'text');
  const charts = orderCharts(fs);
  if (!numFacts.length && !charts.length) return;
  // before the conclusion, and before a closing section divider that introduces it
  const endAt = () => { let i = slides.findIndex(s => s.type === 'conclusion' || s.type === 'end'); if (i < 0) i = slides.length; while (i > 1 && slides[i - 1].type === 'section') i--; return i; };
  if (!slides.some(s => s.type === 'kpi')) {
    const kp = topKpis(fs);
    if (kp.length >= 2) {
      const ag = slides.findIndex(s => s.type === 'agenda');
      slides.splice(ag >= 0 ? ag + 1 : 1, 0, { type: 'kpi', title: en ? 'Key figures at a glance' : 'Ringkasan angka utama', kpis: kp.map(f => ({ fact: f.id, v: kpiValue(f), label: short(f.label || '', 40), note: short(f.sub || '', 50), pct: pctOf(f) })), points: [], auto: 1 });
    }
  }
  const used = new Set(slides.filter(s => s.chartId).map(s => s.chartId));
  const content = slides.filter(s => !/^(cover|agenda|end|section)$/.test(s.type)).length;
  const want = Math.min(charts.length, Math.max(2, Math.round(content * 0.5)));
  let have = used.size;
  for (const c of charts) {
    if (have >= want) break;
    if (used.has(c.id)) continue;
    slides.splice(endAt(), 0, { type: 'chart', chartId: c.id, chartData: chartData(c), title: chartTitle(c, en), points: chartPoints(c, en), auto: 1 });
    used.add(c.id); have++;
  }
  // a statement table (cash in / cash out summary) is the document's own bottom line: it always gets a slide with
  // every line and its totals / balances spelled out
  for (const T of fs.tables.filter(T => T.kind === 'statement')) {
    const tc = fs.charts.filter(c => c.t === T.id);
    if (slides.some(s => s.table === T.id || (s.chartId && tc.some(c => c.id === s.chartId)))) continue;
    const c = tc.find(c => c.type === 'bar') || tc[0];
    if (!c) continue;
    const key = fs.facts.filter(f => f.ti === T.ti && (f.k === 'stot' || (f.k === 'row' && f.w >= 8))).slice(0, 4).map(f => f.text.replace(/^\[[^\]]+\]\s*/, ''));
    const title = short(String(T.title || '').replace(/\s*diperbaharui.*$/i, '').trim(), 60) || (en ? 'Summary' : 'Ringkasan');
    slides.splice(endAt(), 0, { type: 'chart', chartId: c.id, chartData: chartData(c), title, points: key.length ? key : chartPoints(c, en), auto: 1 });
  }
  for (const s of slides) if (s.type === 'chart' && s.chartData && !(s.points || []).length) s.points = chartPoints(s.chartData, en);
}

function topKpis(fs) {
  const seen = new Set(), out = [];
  for (const f of [...fs.facts].filter(f => f.v != null && f.k !== 'text' && f.k !== 'kv' || f.k === 'kv' && f.v != null).sort((a, b) => b.w - a.w)) {
    const key = f.k + '|' + f.ti;
    if (seen.has(key)) continue;
    seen.add(key); out.push(f);
    if (out.length >= 4) break;
  }
  return out;
}

// ---------- rule-based plan (no AI) ----------
export function autoPlan(L, fs, o) {
  const [n1, n2] = LENS[o.len] || LENS.standar;
  const en = o.lang === 'en';
  const dg = L.meta.digest || {};
  const c = L.content;
  const cands = [];
  const kp = topKpis(fs);
  if (kp.length >= 2) cands.push({ pr: 100, s: { type: 'kpi', title: en ? 'Key figures at a glance' : 'Ringkasan angka utama', kpis: kp.map(f => ({ fact: f.id, label: f.label, note: f.sub || '', pct: pctOf(f) })), points: (dg.points || []).filter(p => !/\d/.test(p) || unknownNumbers(p, fs.nums, fs.digits).length === 0).slice(0, 3) } });
  // charts: best per table first, then the rest
  const byT = {};
  for (const ch of orderCharts(fs)) (byT[ch.t] ||= []).push(ch);
  orderCharts(fs).forEach((ch, k) => cands.push({ pr: 85 - k * 3, s: { type: 'chart', chart: ch.id, title: chartTitle(ch, en), points: chartPoints(ch, en) } }));
  // narrative sections → bullet slides
  const secs = [];
  let cur = null;
  for (const b of c.blocks) {
    if (b.t === 'h' && (b.lv || 2) <= 2) { cur = { title: b.x, paras: [] }; secs.push(cur); continue; }
    if ((b.t === 'p' || b.t === 'li') && cur) cur.paras.push(b.x);
  }
  if (!secs.length) secs.push({ title: dg.title || L.meta.title, paras: c.blocks.filter(b => b.t === 'p' || b.t === 'li').map(b => b.x) });
  secs.filter(s => s.paras.join(' ').length > 120).forEach((s, k) => {
    const pts = keySentences(s.paras, 4).map(x => short(x, 200));
    const pts2 = pts.length >= 2 ? pts : s.paras.slice(0, 4).map(x => short(x, 200));
    if (pts2.length) cands.push({ pr: 60 - k * 3, order: k, s: { type: 'bullets', title: short(s.title, 90), points: pts2 } });
  });
  // small tables that are clearer as a table
  for (const T of fs.tables) if (T.A.n >= 2 && T.A.n <= 12 && T.head.length >= 3 && !byT[T.id]) cands.push({ pr: 45, s: { type: 'table', table: T.id, title: T.title, points: [] } });
  const room = Math.max(2, n2 - 3);
  const body = cands.sort((a, b) => b.pr - a.pr).slice(0, room).map(x => x.s);
  // keep KPI first, then charts, then text in document order
  body.sort((a, b) => (a.type === 'kpi' ? -1 : b.type === 'kpi' ? 1 : 0));
  const slides = [{ type: 'cover' }];
  if (body.length + 3 >= 8) slides.push({ type: 'agenda', title: 'Agenda', points: [] });
  slides.push(...body);
  const recs = c.blocks.filter(b => (b.t === 'p' || b.t === 'li') && /(rekomendasi|saran|tindak lanjut|rencana|perlu|harus|sebaiknya|recommend|action plan|next step)/i.test(b.x)).map(b => short(b.x, 200)).slice(0, 4);
  const concl = (dg.points || []).slice(0, 4);
  if (concl.length || recs.length) slides.push({ type: 'conclusion', title: en ? 'Conclusions & Recommendations' : (recs.length ? 'Kesimpulan & Rekomendasi' : 'Kesimpulan'), points: concl, recs });
  slides.push({ type: 'end', title: en ? 'Thank you' : 'Terima kasih' });
  while (slides.length < n1 && cands.length > body.length) { const extra = cands.sort((a, b) => b.pr - a.pr)[body.length]?.s; if (!extra) break; body.push(extra); slides.splice(slides.length - 2, 0, extra); }
  return { title: dg.title || L.meta.title, subtitle: dg.type || '', slides };
}

function chartTitle(ch, en) {
  const s0 = ch.series[0];
  const st = stats(s0.vals, ch.cats);
  const u = ch.unit;
  const V = v => fmtVal(v, u);
  if (ch.type === 'combo' && ch.series[1]) {
    const a = s0.vals, t = ch.series[1].vals;
    let sa = 0, stt = 0, met = 0, n = 0;
    a.forEach((v, k) => { if (v != null && t[k]) { sa += v; stt += t[k]; n++; if (v >= t[k]) met++; } });
    const ach = ch.ach != null ? ch.ach : stt ? sa / stt * 100 : 0;
    if (ch.met != null) { met = ch.met; n = ch.n || n; }
    return en ? `${s0.name} reached ${fmtNum(ach, 1)}% of target; ${met} of ${n} periods on target` : `${s0.name} mencapai ${fmtNum(ach, 1)}% dari target; ${met} dari ${n} periode memenuhi target`;
  }
  if (ch.type === 'pareto') {
    const tot = st.sum || 1;
    let c = 0, k = 0;
    while (k < s0.vals.length && c / tot < 0.8) c += s0.vals[k++] || 0;
    return en ? `${k} main causes account for ${fmtNum(c / tot * 100, 0)}% of ${s0.name}` : `${k} penyebab utama mencakup ${fmtNum(c / tot * 100, 0)}% dari total ${s0.name}`;
  }
  if (ch.type === 'donut') return en ? `${st.maxL} is the largest share of ${s0.name} (${fmtNum(st.share, 1)}%)` : `${st.maxL} mendominasi ${s0.name} dengan porsi ${fmtNum(st.share, 1)}%`;
  if (ch.type === 'line' && ch.ref === 100) return en ? `Achievement peaked in ${st.maxL} and was lowest in ${st.minL}` : `Pencapaian tertinggi pada ${st.maxL} (${V(st.max)}), terendah pada ${st.minL} (${V(st.min)})`;
  if ((ch.type === 'line' || ch.type === 'col') && st.n >= 3 && ch.series.length === 1 && !ch.sort) {
    if (st.trend === 'naik' || st.trend === 'turun') return en ? `${s0.name} ${st.trend === 'naik' ? 'rose' : 'fell'} from ${V(st.first)} to ${V(st.last)}` : `${s0.name} ${st.trend === 'naik' ? 'naik' : 'turun'} dari ${V(st.first)} (${st.firstL}) menjadi ${V(st.last)} (${st.lastL})`;
    return en ? `${s0.name} peaked in ${st.maxL} at ${V(st.max)}` : `${s0.name} berfluktuasi, puncak pada ${st.maxL} sebesar ${V(st.max)}`;
  }
  if (st.share != null && ch.series.length === 1 && st.n >= 3) return en ? `${st.maxL} leads ${s0.name} with ${fmtNum(st.share, 1)}% of the total` : `${st.maxL} tertinggi untuk ${s0.name}, ${fmtNum(st.share, 1)}% dari total`;
  return ch.title;
}
function chartPoints(ch, en) {
  const s0 = ch.series[0];
  const st = stats(s0.vals, ch.cats);
  const u = ch.unit;
  const V = v => fmtVal(v, u);
  const p = [];
  if (!st.n) return p;
  if (ch.type === 'combo' && ch.series[1]) {
    const t = ch.series[1].vals;
    const gap = s0.vals.map((v, k) => (v != null && t[k] != null ? v - t[k] : null));
    const sg = stats(gap, ch.cats);
    p.push(en ? `Total ${s0.name}: ${V(st.sum)} vs target ${V(stats(t, ch.cats).sum)}` : `Total ${s0.name} ${V(st.sum)} dibanding target ${V(stats(t, ch.cats).sum)}`);
    if (sg.n) p.push(en ? `Largest shortfall: ${sg.minL} (${V(sg.min)})` : `Selisih terbesar di bawah target: ${sg.minL} (${V(sg.min)})`);
    p.push(en ? `Highest: ${st.maxL} (${V(st.max)})` : `Tertinggi: ${st.maxL} (${V(st.max)})`);
    return p;
  }
  p.push(en ? `Highest: ${st.maxL} (${V(st.max)})` : `Tertinggi: ${st.maxL} (${V(st.max)})`);
  p.push(en ? `Lowest: ${st.minL} (${V(st.min)})` : `Terendah: ${st.minL} (${V(st.min)})`);
  if (u !== '%' && ch.type !== 'line') p.push(en ? `Total: ${V(st.sum)} · average ${V(st.mean)}` : `Total ${V(st.sum)}, rata-rata ${V(st.mean)}`);
  else p.push(en ? `Average: ${V(st.mean)}` : `Rata-rata: ${V(st.mean)}`);
  return p;
}
export { mName };
