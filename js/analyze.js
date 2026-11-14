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
  // a unit in the table title counts only when written as one: "(juta Rp)", "(ton)"
  const tUnit = /[([]/.test(t.title || '') ? headerUnit(String(t.title).replace(/^[^([]*/, '')) : '';
  // number format per column; a column without evidence ("5,000") follows the rest of its table ("2,798.41" → English)
  let tid = 0, ten = 0;
  const ev = t.head.map((_, i) => {
    let id = 0, en = 0;
    for (const r of rows) { const e = typeof r[i] === 'string' ? numEvidence(r[i]) : null; if (e === 'id') id++; else if (e === 'en') en++; }
    tid += id; ten += en;
    return [id, en];
  });
  const tloc = ten > tid ? 'en' : 'id';
  const cols = t.head.map((h, i) => {
    const [id, en] = ev[i];
    return { i, name: short(h || 'Kolom ' + (i + 1), 80), loc: en > id ? 'en' : id > en ? 'id' : tloc, unitH: headerUnit(h) };
  });
  for (const c of cols) c.dup = cols.some(o => o !== c && bare(o.name).toLowerCase() === bare(c.name).toLowerCase());
  const P = rows.map((r, ri) => r.map((cell, c) => {
    const raw = t.nums?.[ri]?.[c];
    if (typeof raw === 'number') return { v: raw, unit: '', kind: 'num' };
    if (typeof cell === 'number') return { v: cell, unit: '', kind: 'num' };
    return parseNum(cell, cols[c].loc);
  }));
  const txt = (ri, c) => String(rows[ri][c] ?? '').trim();
  const isTotal = rows.map((r, ri) => [0, 1].some(c => c < C && RX.total.test(txt(ri, c))));
  const data = rows.map((_, i) => i).filter(i => !isTotal[i] && !t.groups?.[i] && rows[i].some(x => x !== '' && x != null));
  // sections: a group row ("PEMASUKKAN (CASH IN)") heads the rows below it
  const sections = [];
  rows.forEach((r, i) => {
    if (t.groups?.[i]) { sections.push({ name: short(r.filter(x => x !== '' && x != null).join(' '), 60), rows: [] }); return; }
    if (!sections.length) sections.push({ name: '', rows: [] });
    sections[sections.length - 1].rows.push(i);
  });
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
    col.unit = col.unitH || topKey(units) || tUnit || '';
    const allInt = nn && ints === nn;
    const vals = data.map(i => P[i][col.i]?.v).filter(v => v != null);
    let kind = 'text';
    if (ne && np >= 0.7 * ne && (nn < 0.7 * ne || periods.every(p => p.k === 'year') && (YEARHDR.test(col.name) || col.i === 0))) kind = 'period';
    else if (ne >= 1 && nn >= 0.7 * ne) {
      kind = 'num';
      if (allInt && DAYHDR.test(col.name) && vals.every(v => v >= 1 && v <= 31)) { kind = 'period'; col.dayNum = 1; }
      else if (allInt && MONHDR.test(col.name) && vals.every(v => v >= 1 && v <= 12)) { kind = 'period'; col.monNum = 1; }
      else if (allInt && YEARHDR.test(col.name) && vals.every(v => v >= 1950 && v <= 2100)) kind = 'period';
      else if (RX.index.test(col.name.trim()) || /^n\.?$/i.test(col.name.trim()) || (allInt && vals.length > 2 && vals[0] <= 1 && vals.every((v, k) => v === vals[0] + k))) kind = 'index';
    }
    if (kind === 'text' && RX.index.test(col.name.trim())) kind = 'index';
    col.kind = kind;
    if (kind === 'period') col.pk = topKey(periods.reduce((o, p) => (o[p.k] = (o[p.k] || 0) + 1, o), {})) || 'num';
  }
  // a value far outside its column (OCR glued two numbers, dropped a separator) is not data
  for (const col of cols) if (col.kind === 'num') {
    const vals = data.map(i => P[i][col.i]?.v).filter(v => v != null && v !== 0).map(Math.abs).sort((a, b) => a - b);
    if (vals.length < 4) continue;
    const md = vals[vals.length >> 1];
    for (const i of rows.keys()) { const x = P[i][col.i]; if (x && (Math.abs(x.v) > md * 60 || Math.abs(x.v) >= 1e15) && !isTotal[i]) P[i][col.i] = null; }
  }
  // a target column read by OCR: misread tiny values out; a constant monthly target fills its own gaps
  for (const col of cols) if (col.kind === 'num' && RX.target.test(col.name) && !RX.ach.test(col.name)) {
    const vals = data.map(i => P[i][col.i]?.v).filter(v => v != null && v !== 0).map(Math.abs).sort((a, b) => a - b);
    if (vals.length < 3) continue;
    const md = vals[vals.length >> 1];
    for (const i of data) { const x = P[i][col.i]; if (x && Math.abs(x.v) < md / 50) P[i][col.i] = null; }
    const have = data.filter(i => P[i][col.i]);
    const same = have.length >= Math.max(2, data.length * 0.5) && have.every(i => Math.abs(P[i][col.i].v - P[have[0]][col.i].v) < 1e-9);
    if (same) for (const i of data) if (!P[i][col.i] && rows[i].some((v, c) => c !== col.i && P[i][c])) P[i][col.i] = { ...P[have[0]][col.i], filled: 1 };
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
  // target vs actual pairs: same unit and size, the name decides between candidates (Omzet ↔ Target, not Jumlah SPH ↔ Target)
  const pairs = [];
  const medAbs = m => { const v = m.vals.filter(x => x != null).map(Math.abs).sort((a, b) => a - b); return v.length ? v[v.length >> 1] : 0; };
  const sameUnit = (a, b) => a.unit === b.unit || (/^rp/i.test(a.unit) && /^rp/i.test(b.unit)) || (!a.unit && /^rp/i.test(b.unit) && medAbs(a) > 1e5) || (!b.unit && /^rp/i.test(a.unit) && medAbs(b) > 1e5);
  const ACTUALISH = /\b(omzet|omset|penjualan|pendapatan|revenue|sales|produksi|output|realisasi|aktual|actual|capaian|hasil|volume|tonase)\b/i;
  // the document's own percentage column tells which measure it compares with the target (Tonase ÷ Target = "Persentase")
  const pctCols = measures.filter(m => m.unit === '%' || m.role === 'ach');
  const agrees = (a, t2) => {
    let best = 0, col = null;
    for (const pc of pctCols) {
      let ok = 0, n = 0;
      a.vals.forEach((v, k) => { const tv = t2.vals[k], pv = pc.vals[k]; if (v == null || !tv || pv == null) return; n++; if (Math.abs(v / tv * 100 - pv) <= Math.max(0.6, Math.abs(pv) * 0.01)) ok++; });
      if (n >= 2 && ok / n > best) { best = ok / n; col = pc; }
    }
    return best >= 0.6 ? col : null;
  };
  for (const t2 of measures.filter(m => m.role === 'target')) {
    const mt = medAbs(t2);
    let best = null, bs = -1, own = null;
    for (const a of measures) {
      if (a === t2 || a.role === 'target' || a.role === 'ach' || a.unit === '%' || pairs.some(p => p.a === a)) continue;
      const ma = medAbs(a);
      const pc = pctCols.length ? agrees(a, t2) : null;
      if (!pc && (!sameUnit(a, t2) || !mt || !ma || ma / mt < 1e-3 || ma / mt > 1e3)) continue;
      let sc = pc ? 20 : 0;
      if (baseName(a.name) && baseName(a.name) === baseName(t2.name)) sc += 5;
      if (a.role === 'actual') sc += 2;
      if (ACTUALISH.test(a.name)) sc += 2;
      if (/omzet|omset|penjualan|pendapatan|revenue|sales/i.test(a.name) && /^rp/i.test(t2.unit)) sc += 2;
      if (sc > bs) { bs = sc; best = a; own = pc; }
    }
    if (!best) continue;
    const a = best;
    if (own) { own.role = 'ach'; own.avgLike = true; own.additive = false; }
    // the document's own overall percentage: its total row, else the average of its own monthly percentages
    const ownVals = own ? own.vals.filter(v => v != null) : [];
    const ownTotal = own ? (own.docTotal != null ? own.docTotal : ownVals.length >= 2 ? ownVals.reduce((x, y) => x + y, 0) / ownVals.length : null) : null;
    const both = data.map((_, k) => [a.vals[k], t2.vals[k]]).filter(([x, y]) => x != null && y != null && y !== 0);
    if (!both.length) continue;
    let sa = both.reduce((s2, x) => s2 + x[0], 0), st2 = both.reduce((s2, x) => s2 + x[1], 0);
    // the document's own total row is more reliable than the sum of (OCR-read) rows
    if (a.additive && t2.docTotal) { sa = a.docTotal ?? a.st.sum; st2 = t2.docTotal; }
    // the document's own overall percentage (its total row) is the authority
    const ach = ownTotal != null ? ownTotal : a.additive ? sa / st2 * 100 : both.reduce((s2, x) => s2 + x[0] / x[1], 0) / both.length * 100;
    const per = data.map((_, k) => (a.vals[k] != null && t2.vals[k] ? a.vals[k] / t2.vals[k] * 100 : null));
    const perOk = per.filter(v => v != null).sort((p, q) => p - q);
    if (!(ach > 0.3 && ach < 400) || (perOk.length && perOk[perOk.length >> 1] > 400)) continue;   // a misread column, not a real target
    const met = per.filter(v => v != null && v >= 100).length;
    let worst = -1;
    per.forEach((v, k) => { if (v != null && (worst < 0 || v < per[worst])) worst = k; });
    pairs.push({ a, t: t2, ach, sa, st: st2, per: own ? own.vals : per, met: own ? own.vals.filter(v => v != null && v >= 100).length : met, n: per.filter(v => v != null).length, worst, gap: sa - st2, own: !!ownTotal, sums: !ownTotal || (a.docTotal != null && t2.docTotal != null) });
  }
  const achCol = measures.find(m => m.role === 'ach' && pairs.length && pctCols.includes(m)) || measures.find(m => m.role === 'ach');
  // a statement (cash in / cash out, income / costs, subtotals): sections or several total rows — its rows are
  // not one population, so no sums, averages or rankings across them
  const nGroups = sections.filter(x => x.name).length, nTot = isTotal.filter(Boolean).length;
  const statement = measures.length > 0 && !(dim && dim.kind === 'period') && (nGroups >= 2 || (nGroups >= 1 && nTot >= 1) || nTot >= 2);
  const rowLab = rows.map((r, i) => (dim && txt(i, dim.i)) || String(r.find((x, c) => x && !P[i][c] && /[a-z]{3}/i.test(String(x))) ?? '').trim());
  let kind = 'list';
  if (statement) kind = 'statement';
  else if (dim && dim.kind === 'period' && measures.length && data.length >= 2) kind = 'series';
  else if (wide && data.length >= 1) kind = 'wide';
  else if (dim && measures.length && data.length >= 2) kind = 'category';
  else if (C === 2 && data.length <= 40) kind = 'kv';
  if (dim && dim.kind === 'period') {
    const ps = data.map(i => parsePeriod(txt(i, dim.i)));
    const ord = data.map((i, k) => (dim.dayNum || dim.monNum ? P[i][dim.i]?.v ?? null : ps[k] && ps[k].k === dim.pk ? ps[k].o : null));
    const sorted = ord.some(o => o == null) || ord.every((o, k) => k === 0 || o >= ord[k - 1]);
    if (!sorted) {
      const idx = data.map((_, k) => k).sort((x, y) => (ord[x] ?? 0) - (ord[y] ?? 0));
      const re = a => idx.map(k => a[k]);
      labels.splice(0, labels.length, ...re(labels));
      for (const m of measures) { m.vals = re(m.vals); m.st = stats(m.vals, labels); }
      for (const p of pairs) p.per = re(p.per);
    }
  }
  return { title: t.title, kind, cols, dim, measures, labels, data, pairs, achCol, wide, P, rows, n: data.length, sections, isTotal, rowLab };
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
// "Realisasi SPH (%)" keeps its bracket only when the table also has a plain "Realisasi SPH"
const bare = name => String(name).replace(/\s*[([][^)\]]*[)\]]\s*/g, ' ').replace(/\s+/g, ' ').trim();
const mName = m => (m.dup ? String(m.name).replace(/\s+/g, ' ').trim() : bare(m.name)) || m.name;

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
    // a table whose header could not be read (garbled OCR) is only trusted row by row: no sums, no averages, no charts
    const goodHead = h => { const x = String(h || '').trim(); return x && !/^kolom \d+$/i.test(x) && !/^\d/.test(x) && x.length <= 48 && (x.match(/[a-z]/gi) || []).length >= 2; };
    const weak = t.head.filter(goodHead).length < Math.max(2, t.head.length * 0.5) || A.n < 2;
    T.weak = weak;
    if (A.kind === 'statement') { statementFacts(A, T, ti, fact, addNum, charts); return; }
    // row facts ("Piutang Internal HO/Project: Rp 10.017.894.042") for short tables: exact values the writer can quote
    if (A.n <= 15 && (weak || A.kind === 'category' || A.kind === 'kv')) {
      let k = 0;
      for (const i of A.data) {
        if (k >= 12) break;
        const r = A.rows[i];
        const lab = (A.dim && !weak ? String(r[A.dim.i] ?? '') : r.map(String).find(x => x && !A.P[i][r.indexOf(x)] && /[a-z]{3}/i.test(x)) || '').trim();
        const mi = weak ? r.findIndex((_, c) => A.P[i][c] && c !== 0) : (A.measures.slice().sort((a, b) => imp(b) - imp(a))[0]?.i ?? -1);
        const x = mi >= 0 ? A.P[i][mi] : null;
        if (!lab || !x || lab.length > 90) continue;
        const u = x.unit || A.cols[mi]?.unit || '';
        fact(`${short(lab, 80)}${weak ? '' : ' — ' + short(A.cols[mi].name, 30)}: ${V(x.v, u)}`, x.v, u, ti, weak ? 3.5 : 2.5, { k: 'row', label: short(lab, 40) });
        k++;
      }
    }
    // measures by importance
    // a column whose header could not be read ("Kolom 7") gives no named fact
    const ms = weak ? [] : [...A.measures].filter(m => !/^kolom \d+$/i.test(mName(m))).sort((a, b) => imp(b) - imp(a)).slice(0, 5);
    for (const m of ms) {
      const s = m.st;
      if (!s.n) continue;
      const nm = mName(m), u = m.unit;
      const base = imp(m);
      // a "total" of two rows is rarely one the document means (OCR may split a table): only from 3 rows, or the document's own total
      if (m.additive && (s.n >= 3 || m.docTotal != null)) {
        const tot = m.docTotal ?? s.sum;
        const tl = /^(total|jumlah)$/i.test(nm) ? nm + ' ' + short(scope, 40) : /^(total|jumlah)\b/i.test(nm) ? nm : 'Total ' + nm;
        fact(`${tl}${/^(total|jumlah)$/i.test(nm) ? '' : ` (${scope})`}: ${V(tot, u)}`, tot, u, ti, base + 3, { m: m.i, k: 'total', label: tl });
        if (m.docTotal != null && Math.abs(m.docTotal - s.sum) > Math.abs(m.docTotal) * 0.01) addNum(s.sum);
      }
      const flat = s.n >= 2 && s.max === s.min;
      if (flat) fact(`${nm} sama setiap ${dimN}: ${V(s.max, u)}`, s.max, u, ti, base, { m: m.i, k: 'value', label: nm });
      else if (s.n >= 2) {
        if (s.n >= 3) fact(`Rata-rata ${nm} per ${dimN}: ${V(s.mean, u)}`, s.mean, u, ti, base, { m: m.i, k: 'mean', label: 'Rata-rata ' + nm });
        fact(`${nm} tertinggi: ${s.maxL} (${V(s.max, u)})`, s.max, u, ti, base + 1, { m: m.i, k: 'max', label: nm + ' tertinggi', sub: s.maxL });
        fact(`${nm} terendah: ${s.minL} (${V(s.min, u)})`, s.min, u, ti, base + 0.5, { m: m.i, k: 'min', label: nm + ' terendah', sub: s.minL });
      } else fact(`${nm}: ${V(s.first, u)}`, s.first, u, ti, base + 1, { m: m.i, k: 'value', label: nm });
      if (A.kind === 'series' && s.n >= 3 && s.changePct != null && !flat) {
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
      addNum(s.max - s.min); addNum(s.max / (s.min || NaN));
      if (s.n >= 3 || m.docTotal != null) { addNum(s.sum); addNum(s.mean); }
    }
    for (const p of weak ? [] : A.pairs) {
      const nm = mName(p.a);
      fact(`Pencapaian ${nm} terhadap ${mName(p.t)}: ${fmtNum(p.ach, 2)}%${p.sums ? ` (${V(p.sa, p.a.unit)} dari ${V(p.st, p.t.unit)})` : ' (menurut dokumen)'}`, p.ach, '%', ti, 9, { k: 'ach', label: 'Pencapaian target', sub: nm });
      if (p.sums) fact(`Selisih ${nm} terhadap target: ${p.gap >= 0 ? '+' : ''}${V(p.gap, p.a.unit)}`, p.gap, p.a.unit, ti, 6, { k: 'gap', label: 'Selisih dari target' });
      if (p.n >= 2) fact(`${p.met} dari ${p.n} ${dimN} mencapai/melampaui target`, p.met, '', ti, 6, { k: 'met', label: dimN + ' capai target', sub: `dari ${p.n}` });
      if (p.worst >= 0) fact(`Pencapaian terendah: ${A.labels[p.worst]} (${fmtNum(p.per[p.worst], 1)}%)`, p.per[p.worst], '%', ti, 5, { k: 'worst', label: 'Pencapaian terendah', sub: A.labels[p.worst] });
      p.per.forEach(v => addNum(v)); addNum(p.n - p.met); addNum(Math.abs(p.gap)); addNum(100 - p.ach); addNum(p.ach - 100);
      p.a.vals.forEach((v, k) => { const tv = p.t.vals[k]; if (v != null && tv != null) { addNum(v - tv); addNum(Math.abs(v - tv)); } });
    }
    if (A.achCol && A.achCol.st.n) addNum(A.achCol.st.mean);
    if (A.wide) {
      const per = A.wide;
      const rowsTot = A.data.map((_, k) => per.reduce((a, m) => a + (m.vals[k] || 0), 0));
      const colTot = per.map(m => m.st.sum);
      colTot.forEach(addNum); rowsTot.forEach(addNum);
      const kMax = rowsTot.indexOf(Math.max(...rowsTot));
      if (A.n > 1) fact(`${A.labels[kMax]} memiliki total tertinggi (${V(rowsTot[kMax], per[0].unit)}) selama ${per[0].name}–${per[per.length - 1].name}`, rowsTot[kMax], per[0].unit, ti, 5, { k: 'wideMax', label: 'Total tertinggi', sub: A.labels[kMax] });
      fact(`Total seluruh ${title} ${per[0].name}–${per[per.length - 1].name}: ${V(colTot.reduce((a, b) => a + b, 0), per[0].unit)}`, colTot.reduce((a, b) => a + b, 0), per[0].unit, ti, 6, { k: 'wideTot', label: 'Total ' + title });
    }
    if (!weak) chartsFor(A, T, charts);
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
  // every digit string written in the document ("1,087,175,000" and "1.087.175.000" are the same "1087175000")
  const digits = new Set();
  const addD = x => { for (const m of String(x ?? '').matchAll(/\d[\d.,]*\d|\d/g)) { const d = m[0].replace(/\D/g, '').replace(/^0+/, ''); if (d.length >= 2) digits.add(d); } };
  for (const b of content.blocks) addD(b.x);
  for (const t of content.tables) { t.head.forEach(addD); for (const r of t.rows) r.forEach(addD); }
  return { facts, charts, tables, nums: sorted, digits };
}
// A statement table: every line as a fact (totals and balances first), shares only inside a section whose own
// total row equals the sum of its lines, a donut for that composition and a bar chart of all lines.
function statementFacts(A, T, ti, fact, addNum, charts) {
  const m = [...A.measures].sort((a, b) => imp(b) - imp(a))[0];
  const u = m.unit || '';
  const val = i => A.P[i][m.i]?.v ?? null;
  const lab = i => A.rowLab[i] || '';
  const balance = s => /\(\s*\d+\s*[-+x×/]\s*\d+/.test(s) || /\b(sisa|saldo|selisih|laba|rugi|net|neto|bersih|surplus|defisit|perlu bayar|kurang bayar|lebih bayar)\b/i.test(s);
  const cats = [], vals = [];
  let k = 0;
  for (const s of A.sections) {
    for (const i of s.rows) {
      const v = val(i), l = lab(i);
      if (v == null || !l || l.length > 120) continue;
      const tot = A.isTotal[i];
      if (k++ < 24) fact(`${s.name ? '[' + s.name + '] ' : ''}${short(l, 90)}: ${V(v, u)}`, v, u, ti, tot ? 8.5 : balance(l) ? 8 : 5, { k: tot ? 'stot' : 'row', label: short(l, 40), sub: s.name || '' });
      cats.push(short(l, 40)); vals.push(v);
    }
    const parts = s.rows.filter(i => !A.isTotal[i] && val(i) != null);
    for (const tr of s.rows.filter(i => A.isTotal[i] && val(i) != null)) {
      const above = parts.filter(i => i < tr), tot = val(tr);
      const sum = above.reduce((a, i) => a + val(i), 0);
      if (above.length < 2 || !tot || Math.abs(sum - tot) > Math.abs(tot) * 0.005 || above.some(i => val(i) < 0)) continue;
      const tl = short(lab(tr) || 'total', 40);
      for (const i of above) {
        const p = val(i) / tot * 100;
        fact(`${short(lab(i), 70)} = ${fmtNum(p, 1)}% dari ${tl} (${V(val(i), u)} dari ${V(tot, u)})`, p, '%', ti, 6.5, { k: 'share', label: 'Porsi ' + short(lab(i), 30), sub: tl });
        addNum(p);
      }
      charts.push({ id: 'C' + (charts.length + 1), t: T.id, ti: T.ti, type: 'donut', title: `Komposisi ${tl}`, cats: above.map(i => short(lab(i), 40)), unit: u, series: [{ name: mName(m), vals: above.map(val) }], pct: 1, note: `porsi tiap rincian terhadap ${tl} (jumlah rinciannya sama dengan total di dokumen)` });
      break;
    }
  }
  if (cats.length >= 3) charts.push({ id: 'C' + (charts.length + 1), t: T.id, ti: T.ti, type: 'bar', title: `Rincian ${short(T.title, 50)}`, cats: cats.slice(0, 14), unit: u, series: [{ name: mName(m), vals: vals.slice(0, 14) }], note: `nilai tiap baris sesuai dokumen, urutan dokumen (baris jumlah ikut ditampilkan)` });
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
  const add = c => { const weak = /\bkolom \d+\b/i.test(c.title + ' ' + c.series.map(x => x.name).join(' ')) || c.cats.length < 2; charts.push({ id: 'C' + (charts.length + 1), t: T.id, ti: T.ti, ...c, ...(weak ? { weak: 1 } : {}) }); };
  let cats = A.labels;
  const yr = /\s(\d{4})$/.exec(cats[0] || '');
  if (yr && cats.every(c => c.endsWith(' ' + yr[1]))) cats = cats.map(c => c.slice(0, -5));
  const nm = m => mName(m);
  if (A.kind === 'series') {
    for (const p of A.pairs.slice(0, 2)) {
      add({ type: 'combo', title: `${nm(p.a)} vs ${nm(p.t)}`, cats, unit: p.a.unit, series: [{ name: nm(p.a), vals: p.a.vals, kind: 'bar' }, { name: nm(p.t), vals: p.t.vals, kind: 'line', dash: 1 }], ach: p.ach, met: p.met, n: p.n, note: `realisasi vs target per ${nm(A.dim).toLowerCase()}, ${cats.length} titik, pencapaian ${fmtNum(p.ach, 2)}%` });
      // the document's own achievement column wins over a computed one
      if (cats.length >= 2) {
        const own = A.achCol && A.achCol.st.n >= 2;
        add({ type: cats.length > 12 ? 'line' : 'col', title: own ? `${nm(A.achCol)} per ${nm(A.dim).toLowerCase()}` : `Pencapaian ${nm(p.a)} terhadap ${nm(p.t)} (%)`, cats, unit: '%', series: [{ name: own ? nm(A.achCol) : 'Pencapaian', vals: own ? A.achCol.vals : p.per }], ref: 100, pct: 1, note: `persentase pencapaian target per ${nm(A.dim).toLowerCase()} (garis 100% = target)` });
      }
    }
    const used = new Set(A.pairs.flatMap(p => [p.a, p.t]));
    const rest = A.measures.filter(m => !used.has(m) && m.role !== 'ach' && !(A.pairs.length && m === A.achCol));
    const byUnit = {};
    for (const m of rest) (byUnit[m.unit || '-'] ||= []).push(m);
    for (const [u, ms] of Object.entries(byUnit).slice(0, 3)) {
      const pick = ms.sort((a, b) => imp(b) - imp(a)).slice(0, 3);
      add({ type: cats.length > 14 || pick.length > 1 ? 'line' : 'col', title: pick.length === 1 ? `Tren ${nm(pick[0])}` : `Tren ${pick.map(nm).join(', ')}`, cats, unit: u === '-' ? '' : u, series: pick.map(m => ({ name: nm(m), vals: m.vals })), note: `${pick.map(nm).join(', ')} per ${nm(A.dim).toLowerCase()}, ${cats.length} titik` });
    }
    if (A.achCol && !A.pairs.length && A.achCol.st.n >= 2) add({ type: cats.length > 12 ? 'line' : 'col', title: nm(A.achCol), cats, unit: '%', series: [{ name: nm(A.achCol), vals: A.achCol.vals }], ref: 100, pct: 1, note: 'persentase pencapaian per periode (garis 100% = target)' });
    // share of each period in the year's total (presentase)
    const main = A.measures.filter(m => m.additive && m.st.allPos && m.st.n >= 3 && /^rp/i.test(m.unit || '')).sort((a, b) => imp(b) - imp(a))[0];
    if (main && cats.length <= 14) add({ type: 'bar', title: `Porsi ${nm(main)} per ${nm(A.dim).toLowerCase()} (%)`, cats, unit: '%', series: [{ name: 'Porsi', vals: main.vals.map(v => (v == null ? null : v / main.st.sum * 100)) }], sort: 1, pct: 1, note: `persentase tiap ${nm(A.dim).toLowerCase()} terhadap total ${nm(main)}` });
  } else if (A.kind === 'category') {
    for (const p of A.pairs.slice(0, 1)) add({ type: 'col', title: `${nm(p.a)} vs ${nm(p.t)} per ${nm(A.dim).toLowerCase()}`, cats, unit: p.a.unit, series: [{ name: nm(p.t), vals: p.t.vals, muted: 1 }, { name: nm(p.a), vals: p.a.vals }], note: `target vs realisasi untuk ${cats.length} ${nm(A.dim).toLowerCase()}` });
    const ms = [...A.measures].filter(m => m.role !== 'target' || !A.pairs.length).sort((a, b) => imp(b) - imp(a));
    const m = ms[0];
    if (m && m.st.n >= 2) {
      const long = cats.some(c => c.length > 12) || cats.length > 7;
      const pareto = m.bad && m.additive && m.st.allPos && cats.length >= 4;
      const { c2, v2 } = topN(cats, m.vals, m.additive ? 11 : 12, m.additive);
      add({ type: pareto ? 'pareto' : long ? 'bar' : 'col', title: `${nm(m)} per ${nm(A.dim).toLowerCase()}`, cats: c2, unit: m.unit, series: [{ name: nm(m), vals: v2 }], sort: 1, note: `${nm(m)} untuk ${cats.length} ${nm(A.dim).toLowerCase()}${pareto ? ' (pareto penyebab)' : ''}` });
      if (m.additive && m.st.allPos && cats.length >= 2 && cats.length <= 7) add({ type: 'donut', title: `Komposisi ${nm(m)}`, cats, unit: m.unit, series: [{ name: nm(m), vals: m.vals }], pct: 1, note: `porsi (%) tiap ${nm(A.dim).toLowerCase()} terhadap total` });
      else if (m.additive && m.st.allPos && cats.length > 7) { const sh = topN(cats, m.vals.map(v => (v == null ? null : v / m.st.sum * 100)), 11, true); add({ type: 'bar', title: `Porsi ${nm(m)} per ${nm(A.dim).toLowerCase()} (%)`, cats: sh.c2, unit: '%', series: [{ name: 'Porsi', vals: sh.v2 }], sort: 1, pct: 1, note: `persentase tiap ${nm(A.dim).toLowerCase()} terhadap total ${nm(m)}` }); }
      if (A.achCol && A.achCol.st.n >= 2) add({ type: 'bar', title: `${nm(A.achCol)} per ${nm(A.dim).toLowerCase()}`, cats, unit: '%', series: [{ name: nm(A.achCol), vals: A.achCol.vals }], sort: 1, ref: 100, pct: 1, note: 'persentase pencapaian (garis 100% = target)' });
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
export function knownNumber(nums, v, scaled = true) {
  if (!Number.isFinite(v)) return true;
  const a = Math.abs(v);
  if (a <= 12 && Number.isInteger(v)) return true;                 // counts, list sizes
  if (Number.isInteger(v) && v >= 1990 && v <= 2100) return true;   // years
  for (const k of scaled ? [1, 1e3, 1e6, 1e9, 1e-3, 1e-6, 1e-9] : [1]) {
    const x = a / k, tol = scaled ? Math.max(0.0051 * x, x < 10 ? 0.051 : 0.51) : Math.max(0.0005 * x, 0.0051);
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
  if (A.kind === 'statement') {
    const m = [...A.measures].sort((a, b) => imp(b) - imp(a))[0];
    lines.push(`  • laporan bertingkat (bagian & baris jumlah): jangan menjumlahkan semua baris`);
    for (const s of A.sections) {
      const items = s.rows.filter(i => A.P[i][m.i]).slice(0, 14).map(i => `${short(A.rowLab[i] || '-', 50)} = ${fmtNum(A.P[i][m.i].v)}`);
      if (items.length) lines.push(`  • ${s.name || mName(m)}: ${items.join('; ')}`);
    }
    return lines.join('\n');
  }
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
