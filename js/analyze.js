// Table analytics (no AI): column types, dimension vs measures, totals, target vs actual, trends, shares,
// numbered facts (F1…) and chart candidates (C1…) that the presentation writer may use, and the set of numbers
// that are allowed to appear on a slide (anything else is treated as invented).
import { parseNum, numEvidence, parsePeriod, headerUnit, RX, MONTH_S } from './numparse.js';
import { fmtVal, fmtNum } from './util.js';

const topKey = o => Object.entries(o).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
const short = (s, n = 60) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trim() + '…' : s; };
const AVG_LIKE = /\b(rata|rerata|average|avg|mean|harga|price|tarif|rate|kadar|indeks|index|suhu|temperatur|skor|score|rating|nilai rata|persentase|ratio|rasio|margin|yield|efisiensi|produktivitas|kecepatan|speed|umur|usia|lama|durasi rata)\b/i;
const DAYHDR = /\b(tanggal|tgl|date|hari ke|day)\b/i, MONHDR = /\b(bulan|month|bln)\b/i, YEARHDR = /\b(tahun|year|thn|th|periode|period|fy)\b/i;
const roleRx = s => (RX.ach.test(s) ? 'ach' : RX.target.test(s) ? 'target' : RX.actual.test(s) ? 'actual' : '');
const baseName = s => String(s).toLowerCase().replace(RX.target, '').replace(RX.actual, '').replace(/[()[\]%]|\b(ton|kg|rp|unit|pcs)\b/g, '').replace(/\s+/g, ' ').trim();

export function analyzeTable(t, lang = 'id') {
  const C = t.head.length, rows = t.rows;
  const tUnit = headerUnit(t.title || '');
  const cols = t.head.map((h, i) => {
    let id = 0, en = 0;
    for (const r of rows) { const e = typeof r[i] === 'string' ? numEvidence(r[i]) : null; if (e === 'id') id++; else if (e === 'en') en++; }
    // no evidence either way ('12.500'): a three-digit group is a thousands group in both conventions in practice
    return { i, name: short(h || 'Kolom ' + (i + 1), 80), loc: en > id ? 'en' : 'id', unitH: headerUnit(h) || tUnit };
  });
  const P = rows.map((r, ri) => r.map((cell, c) => {
    const raw = t.nums?.[ri]?.[c];
    if (typeof raw === 'number') return { v: raw, unit: '', kind: 'num' };
    if (typeof cell === 'number') return { v: cell, unit: '', kind: 'num' };
    return parseNum(cell, cols[c].loc);
  }));
  const txt = (ri, c) => String(rows[ri][c] ?? '').trim();
  const isTotal = rows.map((r, ri) => [0, 1].some(c => c < C && RX.total.test(txt(ri, c))));
  const data = rows.map((_, i) => i).filter(i => !isTotal[i] && !t.groups?.[i] && rows[i].some(x => x !== '' && x != null));
  for (const col of cols) {
    let ne = 0, nn = 0, np = 0, ints = 0;
    const units = {}, periods = [], seen = new Set();
    for (const i of data) {
      const s = txt(i, col.i);
      if (!s) continue;
      ne++; seen.add(s.toLowerCase());
      const n = P[i][col.i];
      if (n) { nn++; if (n.unit) units[n.unit] = (units[n.unit] || 0) + 1; if (Number.isInteger(n.v)) ints++; }
      const p = parsePeriod(s);
      if (p) { np++; periods.push(p); }
    }
    Object.assign(col, { ne, nn, np, uniq: seen.size / (ne || 1) });
    col.unit = col.unitH || topKey(units) || '';
    const allInt = nn && ints === nn;
    const vals = data.map(i => P[i][col.i]?.v).filter(v => v != null);
    let kind = 'text';
    if (ne && np >= 0.7 * ne && (nn < 0.7 * ne || periods.every(p => p.k === 'year') && (YEARHDR.test(col.name) || col.i === 0))) kind = 'period';
    else if (ne >= 1 && nn >= 0.7 * ne) {
      kind = 'num';
      if (allInt && DAYHDR.test(col.name) && vals.every(v => v >= 1 && v <= 31)) { kind = 'period'; col.dayNum = 1; }
      else if (allInt && MONHDR.test(col.name) && vals.every(v => v >= 1 && v <= 12)) { kind = 'period'; col.monNum = 1; }
      else if (allInt && YEARHDR.test(col.name) && vals.every(v => v >= 1950 && v <= 2100)) kind = 'period';
      else if (RX.index.test(col.name.trim()) || (col.i === 0 && allInt && vals.length > 2 && vals.every((v, k) => v === vals[0] + k))) kind = 'index';
    }
    if (kind === 'text' && RX.index.test(col.name.trim())) kind = 'index';
    col.kind = kind;
    if (kind === 'period') col.pk = topKey(periods.reduce((o, p) => (o[p.k] = (o[p.k] || 0) + 1, o), {})) || 'num';
  }
  // percentages typed as fractions (0,963 under a "%" header)
  for (const col of cols) if (col.kind === 'num' && col.unit === '%') {
    const vals = data.map(i => P[i][col.i]?.v).filter(v => v != null);
    if (vals.length && vals.every(v => Math.abs(v) <= 1.5) && !rows.some(r => /%/.test(String(r[col.i])))) for (const i of rows.keys()) if (P[i][col.i]) P[i][col.i].v *= 100;
  }
  const dim = cols.find(c => c.kind === 'period') || cols.find(c => c.kind === 'text' && c.uniq >= 0.6 && c.ne >= data.length * 0.6) || cols.find(c => c.kind === 'text') || null;
  const measures = cols.filter(c => c.kind === 'num' && c !== dim);
  const plabel = s => {
    const p = parsePeriod(s);
    if (!p) return s;
    if (p.k === 'date' && p.mo) return `${p.d} ${MONTH_S[p.mo - 1]}${p.y ? ' ' + p.y : ''}`;
    if (p.k === 'month' && p.mo) return `${MONTH_S[p.mo - 1]}${p.y ? ' ' + p.y : ''}`;
    return s;
  };
  const labels = data.map((i, k) => (dim ? short(dim.kind === 'period' ? plabel(txt(i, dim.i)) : txt(i, dim.i), 40) : 'Baris ' + (k + 1)) || '–');
  for (const m of measures) {
    m.role = roleRx(m.name);
    m.avgLike = AVG_LIKE.test(m.name) || m.unit === '%' || m.role === 'ach';
    m.additive = !m.avgLike;
    m.bad = RX.bad.test(m.name) || RX.bad.test(String(t.title || '')) || (dim ? RX.bad.test(dim.name) : false);
    m.vals = data.map(i => P[i][m.i]?.v ?? null);
    m.st = stats(m.vals, labels);
    const tr = rows.findIndex((_, i) => isTotal[i] && P[i][m.i]);
    m.docTotal = tr >= 0 ? P[tr][m.i].v : null;
    m.docTotalLabel = tr >= 0 ? txt(tr, 0) || txt(tr, 1) : '';
  }
  // wide table: period names in the column headers (Jan | Feb | Mar …)
  const pcols = measures.filter(m => parsePeriod(m.name));
  const wide = pcols.length >= 3 && pcols.length >= measures.length * 0.6 ? pcols : null;
  // target vs actual pairs
  const pairs = [];
  const tg = measures.filter(m => m.role === 'target'), ac = measures.filter(m => m.role === 'actual');
  for (const a of ac) {
    const t2 = tg.find(x => baseName(x.name) === baseName(a.name)) || (tg.length === 1 ? tg[0] : null);
    if (t2 && !pairs.some(p => p.t === t2)) {
      const both = data.map((_, k) => [a.vals[k], t2.vals[k]]).filter(([x, y]) => x != null && y != null && y !== 0);
      if (!both.length) continue;
      const sa = both.reduce((s, x) => s + x[0], 0), st2 = both.reduce((s, x) => s + x[1], 0);
      const ach = a.additive ? sa / st2 * 100 : both.reduce((s, x) => s + x[0] / x[1], 0) / both.length * 100;
      const per = data.map((_, k) => (a.vals[k] != null && t2.vals[k] ? a.vals[k] / t2.vals[k] * 100 : null));
      const met = per.filter(v => v != null && v >= 100).length;
      let worst = -1;
      per.forEach((v, k) => { if (v != null && (worst < 0 || v < per[worst])) worst = k; });
      pairs.push({ a, t: t2, ach, sa, st: st2, per, met, n: per.filter(v => v != null).length, worst, gap: sa - st2 });
    }
  }
  const achCol = measures.find(m => m.role === 'ach');
  let kind = 'list';
  if (dim && dim.kind === 'period' && measures.length && data.length >= 2) kind = 'series';
  else if (wide && data.length >= 1) kind = 'wide';
  else if (dim && measures.length && data.length >= 2) kind = 'category';
  else if (C === 2 && data.length <= 40) kind = 'kv';
  if (dim && dim.kind === 'period') {
    const ord = data.map(i => parsePeriod(txt(i, dim.i))?.o ?? (P[i][dim.i]?.v ?? null));
    const sorted = ord.every((o, k) => k === 0 || o == null || ord[k - 1] == null || o >= ord[k - 1]);
    if (!sorted) {
      const idx = data.map((_, k) => k).sort((x, y) => (ord[x] ?? 0) - (ord[y] ?? 0));
      const re = a => idx.map(k => a[k]);
      labels.splice(0, labels.length, ...re(labels));
      for (const m of measures) { m.vals = re(m.vals); m.st = stats(m.vals, labels); }
      for (const p of pairs) p.per = re(p.per);
    }
  }
  return { title: t.title, kind, cols, dim, measures, labels, data, pairs, achCol, wide, P, rows, n: data.length };
}

export function stats(vals, labels) {
  const pts = vals.map((v, k) => [k, v]).filter(x => x[1] != null && Number.isFinite(x[1]));
  const n = pts.length;
  if (!n) return { n: 0 };
  let sum = 0, mn = Infinity, mx = -Infinity, iMn = 0, iMx = 0;
  for (const [k, v] of pts) { sum += v; if (v < mn) { mn = v; iMn = k; } if (v > mx) { mx = v; iMx = k; } }
  const mean = sum / n;
  const sd = Math.sqrt(pts.reduce((a, [, v]) => a + (v - mean) ** 2, 0) / n);
  // linear trend over the order of the rows
  const mk = pts.reduce((a, [k]) => a + k, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [k, v] of pts) { sxy += (k - mk) * (v - mean); sxx += (k - mk) ** 2; syy += (v - mean) ** 2; }
  const slope = sxx ? sxy / sxx : 0, r2 = sxx && syy ? (sxy * sxy) / (sxx * syy) : 0;
  const first = pts[0], last = pts[n - 1];
  const allPos = pts.every(([, v]) => v >= 0);
  return {
    n, sum, mean, sd, min: mn, max: mx, iMin: iMn, iMax: iMx, minL: labels[iMn], maxL: labels[iMx],
    first: first[1], last: last[1], firstL: labels[first[0]], lastL: labels[last[0]],
    change: last[1] - first[1], changePct: first[1] ? (last[1] - first[1]) / Math.abs(first[1]) * 100 : null,
    slope, r2, trend: n >= 4 && r2 >= 0.45 ? (slope > 0 ? 'naik' : 'turun') : n >= 4 ? 'fluktuatif' : '',
    share: allPos && sum > 0 ? mx / sum * 100 : null, allPos,
  };
}

const unitTxt = u => (u && u !== '%' && !/^rp/i.test(u) ? ' ' + u : '');
const V = (v, u) => fmtVal(v, u);
const mName = m => m.name.replace(/\s*[([][^)\]]*[)\]]\s*/g, ' ').replace(/\s+/g, ' ').trim() || m.name;

// ---------- the fact sheet for one document ----------
export function factSheet(content) {
  const lang = content.meta?.lang || 'id';
  const facts = [], charts = [], tables = [], nums = [];
  const addNum = v => { if (Number.isFinite(v)) nums.push(v); };
  const fact = (text, v, unit, ti, w, extra = {}) => { const f = { id: 'F' + (facts.length + 1), text, v, unit, ti, w, ...extra }; facts.push(f); addNum(v); return f; };
  content.tables.forEach((t, ti) => {
    if (!t.rows.length) return;
    const A = analyzeTable(t, lang);
    const unitLabel = content.units[t.u]?.label || '';
    const title = short(t.title || (t.sheet ? 'Sheet ' + t.sheet : '') || (A.measures[0] ? mName(A.measures[0]) + (A.dim ? ' per ' + mName(A.dim).toLowerCase() : '') : 'Tabel ' + (tables.length + 1)), 70);
    const T = { id: 'T' + (tables.length + 1), ti, title, n: A.n, cols: t.head.length, head: t.head, kind: A.kind, A, where: unitLabel };
    tables.push(T);
    for (const r of A.P) for (const x of r) if (x) addNum(x.v);
    const scope = title;
    const dimN = A.dim ? mName(A.dim).toLowerCase() : 'baris';
    // measures by importance
    const ms = [...A.measures].sort((a, b) => imp(b) - imp(a)).slice(0, 5);
    for (const m of ms) {
      const s = m.st;
      if (!s.n) continue;
      const nm = mName(m), u = m.unit;
      const base = imp(m);
      if (m.additive && s.n >= 2) {
        const tot = m.docTotal ?? s.sum;
        const tl = /^(total|jumlah)$/i.test(nm) ? nm + ' ' + short(scope, 40) : /^(total|jumlah)\b/i.test(nm) ? nm : 'Total ' + nm;
        fact(`${tl} (${scope}): ${V(tot, u)}`, tot, u, ti, base + 3, { m: m.i, k: 'total', label: tl });
        if (m.docTotal != null && Math.abs(m.docTotal - s.sum) > Math.abs(m.docTotal) * 0.01) addNum(s.sum);
      }
      if (s.n >= 2) {
        fact(`Rata-rata ${nm} per ${dimN}: ${V(s.mean, u)}`, s.mean, u, ti, base, { m: m.i, k: 'mean', label: 'Rata-rata ' + nm });
        fact(`${nm} tertinggi: ${s.maxL} (${V(s.max, u)})`, s.max, u, ti, base + 1, { m: m.i, k: 'max', label: nm + ' tertinggi', sub: s.maxL });
        fact(`${nm} terendah: ${s.minL} (${V(s.min, u)})`, s.min, u, ti, base + 0.5, { m: m.i, k: 'min', label: nm + ' terendah', sub: s.minL });
      } else fact(`${nm}: ${V(s.first, u)}`, s.first, u, ti, base + 1, { m: m.i, k: 'value', label: nm });
      if (A.kind === 'series' && s.n >= 3 && s.changePct != null) {
        fact(`Perubahan ${nm} dari ${s.firstL} (${V(s.first, u)}) ke ${s.lastL} (${V(s.last, u)}): ${s.changePct > 0 ? '+' : ''}${fmtNum(s.changePct, 1)}%${s.trend ? ', tren ' + s.trend : ''}`, s.changePct, '%', ti, base + 1.5, { m: m.i, k: 'change', label: 'Perubahan ' + nm });
        addNum(s.change); addNum(Math.abs(s.changePct)); addNum(Math.abs(s.change));
      }
      if (A.kind === 'category' && m.additive && s.share != null && s.n >= 3 && s.n <= 40) {
        fact(`${s.maxL} menyumbang ${fmtNum(s.share, 1)}% dari total ${nm}`, s.share, '%', ti, base + 1, { m: m.i, k: 'share', label: 'Porsi ' + s.maxL });
      }
      // every derived number a writer might quote
      m.vals.forEach((v, k) => {
        if (v == null) return;
        if (s.sum && s.allPos) addNum(v / s.sum * 100);
        const pv = m.vals[k - 1];
        if (pv != null && pv !== 0) { addNum((v - pv) / Math.abs(pv) * 100); addNum(Math.abs((v - pv) / pv * 100)); addNum(v - pv); addNum(Math.abs(v - pv)); }
        addNum(v - s.mean); addNum(s.mean ? (v - s.mean) / s.mean * 100 : NaN);
      });
      addNum(s.max - s.min); addNum(s.sum); addNum(s.mean); addNum(s.max / (s.min || NaN));
    }
    for (const p of A.pairs) {
      const nm = mName(p.a);
      fact(`Pencapaian ${nm} terhadap ${mName(p.t)}: ${fmtNum(p.ach, 1)}% (${V(p.sa, p.a.unit)} dari ${V(p.st, p.t.unit)})`, p.ach, '%', ti, 9, { k: 'ach', label: 'Pencapaian target', sub: nm });
      fact(`Selisih ${nm} terhadap target: ${p.gap >= 0 ? '+' : ''}${V(p.gap, p.a.unit)}`, p.gap, p.a.unit, ti, 6, { k: 'gap', label: 'Selisih dari target' });
      if (p.n >= 2) fact(`${p.met} dari ${p.n} ${dimN} mencapai/melampaui target`, p.met, '', ti, 6, { k: 'met', label: dimN + ' capai target', sub: `dari ${p.n}` });
      if (p.worst >= 0) fact(`Pencapaian terendah: ${A.labels[p.worst]} (${fmtNum(p.per[p.worst], 1)}%)`, p.per[p.worst], '%', ti, 5, { k: 'worst', label: 'Pencapaian terendah', sub: A.labels[p.worst] });
      p.per.forEach(v => addNum(v)); addNum(p.n - p.met); addNum(Math.abs(p.gap)); addNum(100 - p.ach); addNum(p.ach - 100);
      p.a.vals.forEach((v, k) => { const tv = p.t.vals[k]; if (v != null && tv != null) { addNum(v - tv); addNum(Math.abs(v - tv)); } });
    }
    if (A.achCol && A.achCol.st.n) addNum(A.achCol.st.mean);
    if (A.kind === 'kv') {
      for (const [k, r] of t.rows.entries()) {
        if (k >= 25) break;
        const p = A.P[k]?.[1];
        const label = String(r[0] ?? '').trim();
        if (label && p) fact(`${label}: ${String(r[1]).trim()}`, p.v, p.unit || headerUnit(label), ti, 4, { k: 'kv', label });
      }
    }
    if (A.wide) {
      const per = A.wide;
      const rowsTot = A.data.map((_, k) => per.reduce((a, m) => a + (m.vals[k] || 0), 0));
      const colTot = per.map(m => m.st.sum);
      colTot.forEach(addNum); rowsTot.forEach(addNum);
      const kMax = rowsTot.indexOf(Math.max(...rowsTot));
      if (A.n > 1) fact(`${A.labels[kMax]} memiliki total tertinggi (${V(rowsTot[kMax], per[0].unit)}) selama ${per[0].name}–${per[per.length - 1].name}`, rowsTot[kMax], per[0].unit, ti, 5, { k: 'wideMax', label: 'Total tertinggi', sub: A.labels[kMax] });
      fact(`Total seluruh ${title} ${per[0].name}–${per[per.length - 1].name}: ${V(colTot.reduce((a, b) => a + b, 0), per[0].unit)}`, colTot.reduce((a, b) => a + b, 0), per[0].unit, ti, 6, { k: 'wideTot', label: 'Total ' + title });
    }
    chartsFor(A, T, charts);
  });
  // numbers written in the text, with their sentence as a fact
  const sent = [];
  for (const b of content.blocks) {
    if (b.t === 'tbl') continue;
    for (const m of String(b.x).matchAll(/-?\(?\d[\d.,]*\)?\s*(%|persen)?/g)) {
      const p = parseNum(m[0].trim(), lang) || parseNum(m[0].trim(), lang === 'id' ? 'en' : 'id');
      if (p) { addNum(p.v); if (p.unit === '%' || /persen/.test(m[0])) addNum(p.v); }
    }
    if (b.t === 'p' || b.t === 'li') for (const s of String(b.x).split(/(?<=[.!?;])\s+/)) {
      if (s.length < 25 || s.length > 260 || !/\d/.test(s)) continue;
      if (/^(\d+[.)]?\s*)?(halaman|page|tel|telp|fax|email|alamat|npwp|no\.)/i.test(s)) continue;
      let w = 1;
      if (/%|persen|rp\s?\d|\bton\b|\bunit\b|\bkg\b/i.test(s)) w += 2;
      if (/(total|jumlah|target|realisasi|capai|naik|turun|meningkat|menurun|tumbuh|pertumbuhan|produksi|penjualan|pendapatan|laba|biaya|efisiensi|rata-rata)/i.test(s)) w += 2;
      sent.push({ s: s.trim(), w, u: b.u });
    }
  }
  sent.sort((a, b) => b.w - a.w).slice(0, 24).forEach(x => fact(short(x.s, 220), null, '', -1, x.w * 0.8, { k: 'text', u: x.u }));
  const sorted = Float64Array.from(nums.filter(Number.isFinite).map(Math.abs)).sort();
  return { facts, charts, tables, nums: sorted };
}
function imp(m) {
  let s = 1;
  if (/^rp/i.test(m.unit || '')) s += 2;
  const v = (m.vals || []).filter(x => x != null);
  if (v.length && v.length <= 30 && v.every(x => Number.isInteger(x) && x >= 0 && x <= 50) && !m.unit) s -= 2;   // small counts (qty)
  if (m.role === 'actual') s += 4;
  if (m.role === 'target') s += 2;
  if (m.role === 'ach') s += 3;
  if (m.additive) s += 1;
  if (/produksi|production|penjualan|sales|pendapatan|revenue|output|volume|jumlah|total|laba|profit|biaya|cost/i.test(m.name)) s += 2;
  if (m.bad) s += 1;
  return s;
}

// ---------- chart candidates ----------
function chartsFor(A, T, charts) {
  const add = c => { charts.push({ id: 'C' + (charts.length + 1), t: T.id, ti: T.ti, ...c }); };
  let cats = A.labels;
  const yr = /\s(\d{4})$/.exec(cats[0] || '');
  if (yr && cats.every(c => c.endsWith(' ' + yr[1]))) cats = cats.map(c => c.slice(0, -5));
  const nm = m => mName(m);
  if (A.kind === 'series') {
    for (const p of A.pairs.slice(0, 2)) {
      add({ type: 'combo', title: `${nm(p.a)} vs ${nm(p.t)}`, cats, unit: p.a.unit, series: [{ name: nm(p.a), vals: p.a.vals, kind: 'bar' }, { name: nm(p.t), vals: p.t.vals, kind: 'line', dash: 1 }], note: `realisasi vs target per ${nm(A.dim).toLowerCase()}, ${cats.length} titik` });
      if (cats.length >= 3) add({ type: 'line', title: `Pencapaian ${nm(p.a)} (%)`, cats, unit: '%', series: [{ name: 'Pencapaian', vals: p.per }], ref: 100, note: `persentase pencapaian target per ${nm(A.dim).toLowerCase()}` });
    }
    const used = new Set(A.pairs.flatMap(p => [p.a, p.t]));
    const rest = A.measures.filter(m => !used.has(m) && m.role !== 'ach');
    const byUnit = {};
    for (const m of rest) (byUnit[m.unit || '-'] ||= []).push(m);
    for (const [u, ms] of Object.entries(byUnit).slice(0, 3)) {
      const pick = ms.sort((a, b) => imp(b) - imp(a)).slice(0, 3);
      add({ type: cats.length > 14 || pick.length > 1 ? 'line' : 'col', title: pick.length === 1 ? `Tren ${nm(pick[0])}` : `Tren ${pick.map(nm).join(', ')}`, cats, unit: u === '-' ? '' : u, series: pick.map(m => ({ name: nm(m), vals: m.vals })), note: `${pick.map(nm).join(', ')} per ${nm(A.dim).toLowerCase()}, ${cats.length} titik` });
    }
    if (A.achCol && !A.pairs.length) add({ type: 'line', title: nm(A.achCol), cats, unit: '%', series: [{ name: nm(A.achCol), vals: A.achCol.vals }], ref: 100, note: 'persentase per periode' });
  } else if (A.kind === 'category') {
    for (const p of A.pairs.slice(0, 1)) add({ type: 'col', title: `${nm(p.a)} vs ${nm(p.t)} per ${nm(A.dim).toLowerCase()}`, cats, unit: p.a.unit, series: [{ name: nm(p.t), vals: p.t.vals, muted: 1 }, { name: nm(p.a), vals: p.a.vals }], note: `target vs realisasi untuk ${cats.length} ${nm(A.dim).toLowerCase()}` });
    const ms = [...A.measures].filter(m => m.role !== 'target' || !A.pairs.length).sort((a, b) => imp(b) - imp(a));
    const m = ms[0];
    if (m && m.st.n >= 2) {
      const long = cats.some(c => c.length > 12) || cats.length > 7;
      const pareto = m.bad && m.additive && m.st.allPos && cats.length >= 4;
      const { c2, v2 } = topN(cats, m.vals, m.additive ? 11 : 12, m.additive);
      add({ type: pareto ? 'pareto' : long ? 'bar' : 'col', title: `${nm(m)} per ${nm(A.dim).toLowerCase()}`, cats: c2, unit: m.unit, series: [{ name: nm(m), vals: v2 }], sort: 1, note: `${nm(m)} untuk ${cats.length} ${nm(A.dim).toLowerCase()}${pareto ? ' (pareto penyebab)' : ''}` });
      if (m.additive && m.st.allPos && cats.length >= 2 && cats.length <= 7) add({ type: 'donut', title: `Komposisi ${nm(m)}`, cats, unit: m.unit, series: [{ name: nm(m), vals: m.vals }], note: `porsi tiap ${nm(A.dim).toLowerCase()} terhadap total` });
    }
    const same = A.measures.filter(x => x !== m && x.unit === m?.unit && x.role !== 'ach').slice(0, 3);
    if (m && same.length && cats.length <= 10 && !A.pairs.length) add({ type: 'col', title: `${[m, ...same].map(nm).join(' vs ')}`, cats, unit: m.unit, series: [m, ...same].map(x => ({ name: nm(x), vals: x.vals })), note: 'perbandingan beberapa ukuran per kategori' });
  } else if (A.kind === 'wide') {
    const per = A.wide;
    const cats2 = per.map(m => m.name);
    const rowsTot = A.data.map((_, k) => per.reduce((a, m) => a + (m.vals[k] || 0), 0));
    const order = rowsTot.map((v, k) => [v, k]).sort((a, b) => b[0] - a[0]).slice(0, 5).map(x => x[1]);
    add({ type: cats2.length > 12 ? 'line' : order.length > 1 ? 'line' : 'col', title: `${T.title} per periode`, cats: cats2, unit: per[0].unit, series: order.map(k => ({ name: A.labels[k], vals: per.map(m => m.vals[k]) })), note: `${order.length} baris teratas sepanjang ${cats2.length} periode` });
    if (A.n > 1) { const { c2, v2 } = topN(A.labels, rowsTot, 11, true); add({ type: 'bar', title: `Total per ${A.dim ? mName(A.dim).toLowerCase() : 'baris'}`, cats: c2, unit: per[0].unit, series: [{ name: 'Total', vals: v2 }], sort: 1, note: 'total seluruh periode per baris' }); }
    add({ type: 'col', title: `Total per periode`, cats: cats2, unit: per[0].unit, series: [{ name: 'Total', vals: per.map(m => m.st.sum) }], note: 'jumlah semua baris per periode' });
  }
}
function topN(cats, vals, n, additive) {
  const idx = vals.map((v, k) => [v ?? -Infinity, k]).sort((a, b) => b[0] - a[0]);
  if (idx.length <= n + 1) return { c2: idx.map(x => cats[x[1]]), v2: idx.map(x => (x[0] === -Infinity ? null : x[0])) };
  const top = idx.slice(0, n), rest = idx.slice(n);
  const c2 = top.map(x => cats[x[1]]), v2 = top.map(x => x[0]);
  if (additive) { c2.push(`Lainnya (${rest.length})`); v2.push(rest.reduce((a, x) => a + (Number.isFinite(x[0]) ? x[0] : 0), 0)); }
  return { c2, v2 };
}

// Is this number supported by the document? (rounding and thousands scaling tolerated). nums: sorted absolute values.
export function knownNumber(nums, v) {
  if (!Number.isFinite(v)) return true;
  const a = Math.abs(v);
  if (a <= 12 && Number.isInteger(v)) return true;                 // counts, list sizes
  if (Number.isInteger(v) && v >= 1990 && v <= 2100) return true;   // years
  for (const k of [1, 1e3, 1e6, 1e9, 1e-3, 1e-6, 1e-9]) {
    const x = a / k, tol = Math.max(0.0051 * x, x < 10 ? 0.051 : 0.51);
    // first index with nums[i] >= x - tol
    let lo = 0, hi = nums.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (nums[mid] < x - tol) lo = mid + 1; else hi = mid; }
    if (lo < nums.length && nums[lo] <= x + tol) return true;
  }
  return false;
}

// Short text summary of a table for prompts (Q&A and the writer)
export function tableBrief(T, maxRows = 40) {
  const A = T.A, t = { head: T.head };
  const lines = [`${T.id} "${T.title}"${T.where ? ' (' + T.where + ')' : ''}: ${A.n} baris × ${T.head.length} kolom; kolom: ${T.head.map(h => short(h, 30)).join(' | ')}`];
  for (const m of A.measures.slice(0, 6)) {
    const s = m.st;
    if (!s.n) continue;
    lines.push(`  • ${mName(m)}${m.unit ? ' [' + m.unit + ']' : ''}: ${m.additive ? 'total ' + fmtNum(m.docTotal ?? s.sum) + ', ' : ''}rata-rata ${fmtNum(s.mean)}, maks ${fmtNum(s.max)} (${s.maxL}), min ${fmtNum(s.min)} (${s.minL})${s.trend ? ', tren ' + s.trend : ''}`);
  }
  for (const p of A.pairs) lines.push(`  • Pencapaian ${mName(p.a)} vs ${mName(p.t)}: ${fmtNum(p.ach, 1)}% (${p.met}/${p.n} mencapai target)`);
  void t; void maxRows;
  return lines.join('\n');
}
export function tableText(t, maxRows = 60, maxChars = 6000) {
  const esc = v => String(v ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
  let s = '| ' + t.head.map(esc).join(' | ') + ' |\n';
  let k = 0;
  for (const r of t.rows) {
    if (k++ >= maxRows || s.length > maxChars) { s += `| … ${t.rows.length - k + 1} baris lagi |\n`; break; }
    s += '| ' + r.map(esc).join(' | ') + ' |\n';
  }
  return s;
}
export { mName, short };
