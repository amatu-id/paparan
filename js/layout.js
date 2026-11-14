// Positioned text (PDF text items, OCR words) → reading-order blocks: headings, paragraphs, list items and tables.
// Items: {s, x, y (baseline), w, h (font size), b (bold)} in page units, y growing downwards.
import { parseNum } from './numparse.js';

const med = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const isNumText = s => !!parseNum(String(s).replace(/\s+/g, ''), 'id') || /^[-–]$/.test(String(s).trim());
const BULLET = /^([•●▪■◦○‣∙·►▶➢✓✔\-–*]|\(?[a-zA-Z0-9]{1,2}[.)])\s+/;
const TOTAL = /^(\d{1,2}\s+)?(sub[\s-]?)?(total|jumlah|grand total)\b/i;
// OCR slips in report headers: "Omazet" → "Omzet", "Makion" → "Maklon", "Target{m3)" → "Target (m3)", "‘SPH" → "SPH"
const VOCAB = ['omzet', 'omset', 'target', 'realisasi', 'persentase', 'pencapaian', 'tonase', 'volume', 'tagihan', 'nominal', 'jumlah', 'total', 'bulan', 'tahun', 'periode', 'keterangan', 'maklon', 'terbayar', 'cicilan', 'piutang', 'penjualan', 'produksi', 'pembayaran', 'deposit', 'penawaran', 'profit', 'rincian', 'customer', 'tanggal', 'kubikasi', 'harga', 'satuan', 'biaya', 'pendapatan', 'saldo', 'hutang', 'pengeluaran', 'pemasukan', 'anggaran', 'selisih', 'minggu', 'order', 'surat', 'akhir', 'kuantitas', 'barang', 'pelanggan', 'proyek', 'lokasi', 'status', 'jenis', 'kategori', 'keuntungan', 'kerugian', 'penerimaan', 'pembelian', 'persediaan', 'stok'];
const near1 = (a, b) => {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, e = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++e > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return e + (a.length - i) + (b.length - j) <= 1;
};
const fixWord = w => {
  const lw = w.toLowerCase();
  if (lw.length < 5 || VOCAB.includes(lw)) return w;
  const hit = VOCAB.find(v => v.length >= 5 && near1(lw, v));
  if (!hit) return w;
  return w === w.toUpperCase() ? hit.toUpperCase() : w[0] === w[0].toUpperCase() ? hit[0].toUpperCase() + hit.slice(1) : hit;
};
const fixHead = h => String(h).replace(/^[‘’'`"]+|[‘’'`"]+$/g, '').replace(/\{/g, '(').replace(/\}/g, ')').replace(/([A-Za-z])\(/g, '$1 (').replace(/[A-Za-z][A-Za-z]{3,}/g, fixWord).replace(/\s+/g, ' ').trim();
// formulas in labels read by OCR: "(S - 6)" → "(5 - 6)", "Komulatif 4-6 - 8)" → "Komulatif (4-6 - 8)"
const fixFormula = s => s
  .replace(/\(([\dSOIl\s+\-x×/.,]+)\)/g, (m, inner) => (/\d/.test(inner) && /[+\-x×/]/.test(inner) ? '(' + inner.replace(/S/g, '5').replace(/O/g, '0').replace(/[Il]/g, '1') + ')' : m))
  .replace(/(^|\s)(\d+\s*[-+]\s*\d+(?:\s*[-+]\s*\d+)*)\)/g, '$1($2)');
// words OCR glued together ("ProduksiSCPTempuran" → "Produksi SCP Tempuran")
const unglue = s => (s.length >= 10 ? s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]{2,})([A-Z][a-z])/g, '$1 $2') : s);

export function toLines(items, vlines = [], hlines = []) {
  // a table grid line between two words always separates them
  const wall = (a, b, y, h) => { const yc = y - h * 0.35; return vlines.some(v => v.x > a - 1 && v.x < b + 1 && yc >= v.y0 && yc <= v.y1); };
  // words between the same two horizontal grid lines are one table row, whatever OCR says about their baselines
  if (hlines.length) for (const it of items) {
    const yc = it.y - it.h * 0.35, xc = it.x + it.w / 2;
    let up = null, dn = null;
    for (const l of hlines) {
      if (xc < l.x0 - 4 || xc > l.x1 + 4) continue;
      if (l.y <= yc) up = l; else { dn = l; break; }
    }
    if (up && dn && dn.y - up.y < it.h * 3.2 && dn.y - up.y > it.h * 0.8) it.y = (up.y + dn.y) / 2 + it.h * 0.35;
  }
  const its = items.filter(it => it.s && it.s.trim() && it.h > 0 && it.w >= 0).sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  if (its.length && its[0].t0 != null) {
    // OCR words: one line = word boxes that overlap vertically (baselines of single-word fragments are unreliable)
    its.sort((a, b) => (a.t0 + a.t1) - (b.t0 + b.t1) || a.x - b.x);
    for (const it of its) {
      const h = Math.max(1, it.t1 - it.t0);
      let L = null, best = 0;
      for (let k = lines.length - 1; k >= 0 && k >= lines.length - 6; k--) {
        const l = lines[k], lt = l.st / l.n, lb = l.sb / l.n;
        const o = (Math.min(lb, it.t1) - Math.max(lt, it.t0)) / Math.min(lb - lt || 1, h);
        if (o > best) { best = o; L = l; }
      }
      if (!L || best < 0.5) { L = { y: it.y, h: it.h, items: [], st: 0, sb: 0, n: 0 }; lines.push(L); }
      L.items.push(it); L.st += it.t0; L.sb += it.t1; L.n++;
      L.h = Math.max(L.h, it.h);
    }
    for (const L of lines) { const ys = L.items.map(i => i.y).sort((a, b) => a - b); L.y = ys[ys.length >> 1]; }
    lines.sort((a, b) => a.y - b.y);
  } else for (const it of its) {
    let L = null;
    for (let k = lines.length - 1; k >= 0 && k >= lines.length - 4; k--) {
      const l = lines[k];
      if (Math.abs(l.y - it.y) <= 0.45 * Math.min(l.h, it.h) + 0.5) { L = l; break; }
    }
    if (!L) { L = { y: it.y, h: it.h, items: [] }; lines.push(L); }
    L.items.push(it);
    L.h = Math.max(L.h, it.h);
  }
  for (const L of lines) {
    L.items.sort((a, b) => a.x - b.x);
    const segs = [];
    let cur = null;
    for (const it of L.items) {
      const s = it.t0 != null ? unglue(it.s.replace(/\s+/g, ' ')) : it.s.replace(/\s+/g, ' ');
      if (!cur) { cur = { x0: it.x, x1: it.x + it.w, s, h: it.h, bold: it.b ? s.length : 0, n: s.length }; continue; }
      const gap = it.x - cur.x1, hh = Math.max(4, Math.min(cur.h, it.h));
      const numNext = /[\d%)]$/.test(cur.s.trim()) && /^[(\-–]?\s*(rp\.?\s*)?\d/i.test(s.trim());
      // a new amount ("Rp…") or percentage right after a number starts the next column (OCR glued neighbouring cells)
      const newVal = it.t0 != null && /\d/.test(cur.s) && (/^rp\.?\s?\d/i.test(s.trim()) || (/^rp\.?$/i.test(s.trim()) && /\d[%)]?$/.test(cur.s.trim())) || (/^[\d.,]+%$/.test(s.trim()) && /\d$/.test(cur.s.trim()) && gap > 0.3 * hh));
      const split = gap > (numNext ? 0.55 : 0.95) * hh + 1 || (vlines.length && wall(cur.x1, it.x, it.y, hh)) || newVal;
      if (split) { segs.push(cur); cur = { x0: it.x, x1: it.x + it.w, s, h: it.h, bold: it.b ? s.length : 0, n: s.length }; continue; }
      const sp = gap > hh * 0.14 && !/\s$/.test(cur.s) && !/^\s/.test(s) ? ' ' : '';
      cur.s += sp + s; cur.x1 = Math.max(cur.x1, it.x + it.w); cur.h = Math.max(cur.h, it.h);
      cur.n += s.length; if (it.b) cur.bold += s.length;
    }
    if (cur) segs.push(cur);
    for (const g of segs) g.s = L.items[0]?.t0 != null ? fixFormula(unglue(g.s.trim())) : g.s.trim();
    // "Rp" left-aligned and the amount right-aligned in the same cell: one value, not two columns
    for (let k = 0; k < segs.length - 1; k++) {
      if (/^(rp\.?|idr|usd|us\$|\$|€|sgd)$/i.test(segs[k].s) && /^[(\-]?\s*\d/.test(segs[k + 1].s) && !(vlines.length && wall(segs[k].x1, segs[k + 1].x0, L.y, L.h))) {
        const a = segs[k], b = segs[k + 1];
        segs.splice(k, 2, { ...a, s: a.s + ' ' + b.s, x1: b.x1, h: Math.max(a.h, b.h), n: a.n + b.n, bold: a.bold + b.bold });
      }
    }
    L.segs = segs.filter(g => g.s);
    L.x0 = Math.min(...L.segs.map(g => g.x0)); L.x1 = Math.max(...L.segs.map(g => g.x1));
    L.text = L.segs.map(g => g.s).join(' ');
    const n = L.segs.reduce((a, g) => a + g.n, 0) || 1;
    L.bold = L.segs.reduce((a, g) => a + g.bold, 0) / n;
    L.h = med(L.items.map(i => i.h)) || L.h;
    L.top = L.y - L.h * 0.85; L.bot = L.y + L.h * 0.25;
  }
  return lines.filter(L => L.segs.length);
}

// ---------- tables ----------
function columnsOf(rows) {
  const counts = {};
  for (const r of rows) if (r.segs.length >= 2) counts[r.segs.length] = (counts[r.segs.length] || 0) + 1;
  let K = 0, best = 0;
  for (const [k, c] of Object.entries(counts)) if (c > best || (c === best && +k > K)) { best = c; K = +k; }
  if (K < 2) return null;
  // regular rows define the columns
  const reg = rows.filter(r => r.segs.length === K);
  let cols = [];
  for (let j = 0; j < K; j++) cols.push({ x0: Math.min(...reg.map(r => r.segs[j].x0)), x1: Math.max(...reg.map(r => r.segs[j].x1)) });
  let ok = true;
  for (let j = 1; j < K; j++) if (cols[j].x0 < cols[j - 1].x1 - 2) ok = false;
  if (!ok) {
    // greedy merge of every segment interval
    const iv = rows.flatMap(r => r.segs.length >= 2 ? r.segs.map(g => [g.x0, g.x1]) : []).sort((a, b) => a[0] - b[0]);
    cols = [];
    for (const [a, b] of iv) {
      const c = cols[cols.length - 1];
      if (c && a <= c.x1 + 1) c.x1 = Math.max(c.x1, b); else cols.push({ x0: a, x1: b });
    }
    if (cols.length < 2) return null;
  }
  // rows with more segments than K add columns in the gaps (sparse columns): a header word over empty cells
  // ("Keterangan"), or values that several rows put in the same gap
  const gaps = [];
  rows.forEach((r, ri) => {
    if (r.segs.length <= K) return;
    for (const g of r.segs) if (!cols.some(c => Math.min(c.x1, g.x1) - Math.max(c.x0, g.x0) > 0)) gaps.push({ g, head: ri < 3 && !/\d/.test(g.s) });
  });
  for (const { g, head } of gaps) {
    if (cols.some(c => Math.min(c.x1, g.x1) - Math.max(c.x0, g.x0) > 0)) continue;
    const same = gaps.filter(o => o.g !== g && Math.min(o.g.x1, g.x1) - Math.max(o.g.x0, g.x0) > 0).length;
    if (!head && !same) continue;
    cols.push({ x0: g.x0, x1: g.x1, sparse: 1 });
    cols.sort((a, b) => a.x0 - b.x0);
  }
  return cols;
}
function colIndex(cols, g) {
  let best = -1, bo = 0;
  cols.forEach((c, j) => { const o = Math.min(c.x1, g.x1) - Math.max(c.x0, g.x0); if (o > bo) { bo = o; best = j; } });
  if (best >= 0) return best;
  const cx = (g.x0 + g.x1) / 2;
  let bd = Infinity;
  cols.forEach((c, j) => { const d = Math.abs((c.x0 + c.x1) / 2 - cx); if (d < bd) { bd = d; best = j; } });
  return best;
}

// A screenshot's own grid: vertical lines crossing most rows of the run are the column borders, and its top/bottom
// border (a horizontal line across the grid just above/below) closes it. Rows outside and words beside it are not table.
function gridOf(run, opt) {
  const V = opt.vlines || [];
  if (!opt.ocr || V.length < 3) return null;
  const ys = run.map(r => r.y - r.h * 0.35);
  const need = Math.max(2, Math.ceil(ys.length * 0.5));
  const use = V.filter(v => ys.filter(y => y >= v.y0 - 3 && y <= v.y1 + 3).length >= need);
  const X = [];
  for (const x of use.map(v => v.x).sort((a, b) => a - b)) if (!X.length || x - X[X.length - 1] > 10) X.push(x);
  if (X.length < 3) return null;
  const xa = X[0], xb = X[X.length - 1], rowH = med(run.map(r => r.h));
  let top = Math.min(...use.map(v => v.y0)), bot = Math.max(...use.map(v => v.y1));
  const across = l => Math.min(l.x1, xb) - Math.max(l.x0, xa) >= (xb - xa) * 0.8;
  const H = opt.grid?.hlines || [];
  for (const l of [...H].sort((a, b) => b.y - a.y)) if (l.y < top && top - l.y <= rowH * 2.6 && across(l)) top = l.y;
  for (const l of H) if (l.y > bot && l.y - bot <= rowH * 2.6 && across(l)) bot = l.y;
  return { X, top, bot };
}

function buildTable(run, opt = {}) {
  let cols = columnsOf(run);
  if (!cols) return null;
  // the grid decides the columns when it shows at least as many as most rows have cells
  const G = gridOf(run, opt);
  const before = [], after = [];
  const cnt = {};
  for (const r of run) if (r.segs.length >= 2) cnt[r.segs.length] = (cnt[r.segs.length] || 0) + 1;
  const K = +Object.entries(cnt).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] || 0;
  if (G && G.X.length - 1 >= K) {
    const inside = [];
    for (const r of run) {
      const yc = r.y - r.h * 0.35;
      if (yc < G.top - 4) { before.push(r); continue; }
      if (yc > G.bot + 4 && !(TOTAL.test(r.text) && r.segs.length >= 2 && yc - G.bot < r.h * 4)) { after.push(r); continue; }
      const out = r.segs.filter(g => (g.x0 + g.x1) / 2 < G.X[0] - 4 || (g.x0 + g.x1) / 2 > G.X[G.X.length - 1] + 4);
      for (const g of out) after.push({ ...r, segs: [g], x0: g.x0, x1: g.x1, text: g.s });
      if (out.length === r.segs.length) continue;
      inside.push(out.length ? { ...r, segs: r.segs.filter(g => !out.includes(g)) } : r);
    }
    if (inside.length < 2) return null;
    run = inside;
    cols = G.X.slice(1).map((x, k) => ({ x0: G.X[k], x1: x, grid: 1 }));
  }
  const C = cols.length;
  const multi = run.filter(r => r.segs.length >= 2);
  const segs = multi.flatMap(r => r.segs);
  const numRatio = segs.filter(g => isNumText(g.s)).length / (segs.length || 1);
  const avgLen = segs.reduce((a, g) => a + g.s.length, 0) / (segs.length || 1);
  if (C === 2 && numRatio < 0.15 && avgLen > 34) return { prose: true, cols };
  if (C === 2 && numRatio < 0.08 && multi.length < 3) return null;
  if (multi.length < 2 || (multi.length < 3 && (C < 3 || numRatio < 0.3))) return null;
  const rows = [];
  let prev = null;
  // OCR rows that are only dotted borders or stray letters ("H . . . . H . .", "RSS", "i")
  const junk = t => {
    const x = t.replace(/\s+/g, '');
    if (!x || /\d/.test(x)) return false;
    if (x.length >= 4 && /^[mMnNrRwWEe=~:.\-—_|]+$/.test(x)) return true;
    const punct = (x.match(/[.:,;'"`~=_\-—|·•]/g) || []).length;
    return x.length <= 3 || punct >= x.length * 0.5;
  };
  // a section row ("PEMASUKKAN (CASH IN)"): one merged cell from the left edge across the column lines, no numbers
  const section = (r, gap) => {
    if (r.segs.length !== 1 || C < 2) return false;
    const g = r.segs[0];
    if (/\d/.test(g.s) || (g.s.match(/[a-z]/gi) || []).length < 3 || gap < r.h * 0.45) return false;
    return g.x0 < cols[0].x1 && g.x1 > cols[1].x0 + r.h;
  };
  for (const r of run) {
    if (opt.ocr && junk(r.text)) continue;
    const gap = prev ? r.top - prev.bot : 99;
    if (section(r, gap)) { rows.push({ c: [r.segs[0].s, ...Array(C - 1).fill('')], r: [r], group: true, sec: true }); prev = r; continue; }
    const cells = Array(C).fill('');
    for (const g of r.segs) { const j = colIndex(cols, g); cells[j] = cells[j] ? cells[j] + ' ' + g.s : g.s; }
    const filled = cells.filter(Boolean).length;
    // wrapped cell text: continues the row above (a row that fills most columns is a row of its own)
    if (prev && gap < r.h * 0.9 && !cells[0] && filled <= Math.max(1, C * 0.35) && rows.length && !rows[rows.length - 1].sec) {
      const last = rows[rows.length - 1];
      cells.forEach((c, j) => { if (c) last.c[j] = last.c[j] ? last.c[j] + ' ' + c : c; });
      last.r.push(r);
    } else rows.push({ c: cells, r: [r], group: filled === 1 && !!cells[0] && C > 2 });
    prev = r;
  }
  // header rows: leading rows without numbers (max 3); a section row after the header is data
  const numRow = row => { const n = row.c.slice(1).filter(c => c && isNumText(c)).length; return C >= 4 ? n >= 2 : n >= 1; };
  let nh = 0;
  while (nh < rows.length - 1 && nh < 3 && !numRow(rows[nh]) && !(nh && rows[nh].sec)) nh++;
  if (nh === rows.length - 1 && nh > 1) nh = 1;
  if (nh && rows[0].sec) nh = 0;
  let head;
  if (nh) {
    head = Array(C).fill('');
    for (let k = 0; k < nh; k++) rows[k].c.forEach((c, j) => { if (c) head[j] = head[j] ? head[j] + ' ' + c : c; });
    // a header cell spanning two columns leaves the next one empty: "Oktober" over "Target | Realisasi" stays in its own column
    if (opt.ocr) head = head.map(h => fixHead(h.replace(/\((?:96|9%|%6|36|26|%o)\)/g, '(%)').replace(/\b(\d{1,2})96\b/g, '$1%')));
  } else head = cols.map((_, j) => 'Kolom ' + (j + 1));
  const body = rows.slice(nh);
  if (!body.length) return null;
  // OCR reads "%" as "96": "66.6396" in a column of percentages is 66.63%
  if (opt.ocr) for (let j = 0; j < C; j++) {
    const cells = body.filter(r => !r.sec && r.c[j]).map(r => r.c[j]);
    if (cells.length < 2 || cells.filter(c => /%$/.test(c)).length < cells.length * 0.5) continue;
    for (const r of body) if (r.c[j] && /^[-+]?\d{1,3}([.,]\d{1,2})?96$/.test(r.c[j]) && !/%/.test(r.c[j])) r.c[j] = r.c[j].replace(/96$/, '%');
  }
  // columns only a header word sits over (no value in any row) are left out
  const keep = cols.map((c, j) => !(c.sparse || c.grid) || body.some(r => !r.sec && r.c[j]));
  const pick = a => a.filter((_, j) => keep[j]);
  return { cols: pick(cols), head: pick(head), rows: body.map(r => pick(r.c)), groups: body.map(r => r.group ? 1 : 0), lines: run, numRatio, before, after };
}

// ---------- page ----------
export function pageBlocks(items, W, H, opt = {}) {
  const lines = toLines(items, opt.vlines || [], opt.hlines || []);
  // two lines of a screenshot crossed by the same two (or more) vertical grid lines belong to one table
  // (pieces of one border at the same x, broken where row lines cross it, count as one)
  const V = [];
  if (opt.ocr && (opt.vlines || []).length >= 2) {
    const tol = Math.max(30, 0.8 * med(lines.map(L => L.h)));
    for (const v of [...opt.vlines].filter(v => v.y1 - v.y0 > 40).sort((a, b) => a.x - b.x || a.y0 - b.y0)) {
      const c = V.find(c => Math.abs(c.x - v.x) <= 6 && v.y0 <= c.y1 + tol);
      if (c) c.y1 = Math.max(c.y1, v.y1); else V.push({ x: v.x, y0: v.y0, y1: v.y1 });
    }
  }
  const inGrid = (A, B) => {
    if (V.length < 2) return false;
    const ya = A.y - A.h * 0.35, yb = B.y - B.h * 0.35, lo = Math.min(ya, yb), hi = Math.max(ya, yb);
    return V.filter(v => v.y0 - 4 <= lo && v.y1 + 4 >= hi).length >= 2;
  };
  if (!lines.length) return { blocks: [], tables: [] };
  let bodyH = med(lines.flatMap(L => Array(Math.min(20, Math.ceil(L.text.length / 20))).fill(Math.round(L.h * 2) / 2))) || 10;
  const out = [];   // {kind: 'line'|'table', ...} in reading order
  let i = 0;
  while (i < lines.length) {
    const L = lines[i];
    if (L.segs.length >= 2) {
      let j = i + 1, singles = 0;
      while (j < lines.length) {
        const N = lines[j], gap = N.top - lines[j - 1].bot;
        // rows inside one ruled grid stay together whatever OCR says about their height, and so does the
        // total row right under it (often a merged, filled row without inner lines)
        const grid = inGrid(lines[j - 1], N) || (opt.ocr && N.segs.length >= 2 && TOTAL.test(N.text));
        if (gap > 2.4 * Math.max(N.h, lines[j - 1].h) && !grid) break;
        // a title set bigger than the rows ("History Tagihan … 797.048.908") starts the next table
        if (opt.ocr && j - i >= 2 && N.h > med(lines.slice(i, j).map(l => l.h)) * 1.35 && !grid) break;
        if (N.segs.length >= 2) singles = 0;
        else if ((++singles > 1 || N.h > bodyH * 1.35) && !grid) break;
        j++;
      }
      while (j > i && lines[j - 1].segs.length < 2) j--;
      const run = lines.slice(i, j);
      const t = run.length >= 2 ? buildTable(run, opt) : null;
      if (t && t.prose) {
        // two text columns side by side: left column first, then right
        const left = [], right = [];
        for (const r of run) for (const g of r.segs) {
          const nl = { ...r, segs: [g], x0: g.x0, x1: g.x1, text: g.s };
          (colIndex(t.cols, g) === 0 ? left : right).push(nl);
        }
        for (const nl of [...left, ...right]) out.push({ kind: 'line', L: nl });
        i = j; continue;
      }
      if (t) {
        for (const L2 of t.before || []) out.push({ kind: 'line', L: L2 });
        out.push({ kind: 'table', t });
        for (const L2 of t.after || []) out.push({ kind: 'line', L: L2 });
        i = j; continue;
      }
    }
    out.push({ kind: 'line', L });
    i++;
  }
  // body text size from the lines outside tables (table cells are often set smaller) — but in a screenshot of a
  // table the cells are the body and the free lines only its titles
  const free = out.filter(o => o.kind === 'line').map(o => o.L);
  const freeLen = free.reduce((a, L) => a + L.text.length, 0), allLen = lines.reduce((a, L) => a + L.text.length, 0);
  if (free.length && !(opt.grid && freeLen < allLen * 0.3)) bodyH = med(free.flatMap(L => Array(Math.min(20, Math.ceil(L.text.length / 20))).fill(Math.round(L.h * 2) / 2))) || bodyH;
  // paragraphs
  const sizes = [...new Set(free.filter(L => L.h > bodyH * 1.15).map(L => Math.round(L.h)))].sort((a, b) => b - a);
  const rect = L => [+(L.x0 / W).toFixed(4), +(L.top / H).toFixed(4), +((L.x1 - L.x0) / W).toFixed(4), +((L.bot - L.top) / H).toFixed(4)];
  const blocks = [], tables = [];
  let P = null;
  const isHead = L => {
    const s = L.text;
    if (s.length > 140 || /^\d+([.,]\d+)?%?$/.test(s)) return false;
    if (L.h > bodyH * 1.15 && s.length < 140) return true;
    if (/^(bab|chapter|bagian|lampiran)\s+[ivxlc\d]+\b/i.test(s) && s.length < 90) return true;
    if (L.bold > 0.7 && s.length < 110 && !/[.,;]$/.test(s) && /[a-z]/i.test(s)) return true;
    return false;
  };
  for (const o of out) {
    if (o.kind === 'table') {
      P = null;
      const t = o.t, ls = t.lines;
      const x0 = Math.min(...ls.map(l => l.x0)), x1 = Math.max(...ls.map(l => l.x1)), top = Math.min(...ls.map(l => l.top)), bot = Math.max(...ls.map(l => l.bot));
      // caption: a short line just above ("Tabel 3. Produksi per lini", "PERIODE 2026"), looking past a date line
      let title = '';
      for (let k = blocks.length - 1, seen = 0; k >= 0 && seen < 3; k--, seen++) {
        const pb = blocks[k];
        if (pb.t === 'tbl' || top - pb._bot > 5 * bodyH) break;
        const ok = (pb.t === 'h' || /^(tabel|table|tab\.)\s*[\d.]*/i.test(pb.x) || (opt.ocr && pb.x.length <= 70 && !/[.:]$/.test(pb.x) && !/^(senin|selasa|rabu|kamis|jumat|sabtu|minggu|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(pb.x))) && pb.x.length < 140;
        if (ok) { title = pb.x; break; }
      }
      tables.push({ title, head: t.head, rows: t.rows, groups: t.groups, r: [+(x0 / W).toFixed(4), +(top / H).toFixed(4), +((x1 - x0) / W).toFixed(4), +((bot - top) / H).toFixed(4)] });
      blocks.push({ t: 'tbl', ti: tables.length - 1, x: title, r: [tables[tables.length - 1].r], _bot: bot });
      continue;
    }
    const L = o.L, s = L.text;
    if (isHead(L)) {
      const lv = Math.min(3, Math.max(1, sizes.indexOf(Math.round(L.h)) + 1 || (L.h > bodyH * 1.15 ? 2 : 3)));
      if (P && P.t === 'h' && L.top - P._bot < L.h * 0.7 && Math.abs(P._h - L.h) < 1.5) { P.x += ' ' + s; P.r.push(rect(L)); P._bot = L.bot; continue; }
      P = { t: 'h', lv, x: s, r: [rect(L)], _bot: L.bot, _h: L.h, _x0: L.x0, fs: Math.round(L.h * 2) / 2, rel: +(L.h / bodyH).toFixed(2) };
      blocks.push(P); continue;
    }
    const bullet = BULLET.test(s);
    const cont = P && P.t !== 'h' && !bullet && Math.abs(P._h - L.h) <= Math.max(1.2, L.h * 0.3) &&
      L.top - P._bot < L.h * 0.95 && L.x0 > P._x0 - 3 * L.h && !/:\s*$/.test(P.x);
    if (cont) {
      if (/[a-z]-$/.test(P.x) && /^[a-z]/.test(s)) P.x = P.x.slice(0, -1) + s;
      else P.x += ' ' + s;
      P.r.push(rect(L)); P._bot = L.bot;
      continue;
    }
    P = { t: bullet ? 'li' : 'p', x: bullet ? s.replace(BULLET, '') : s, r: [rect(L)], _bot: L.bot, _h: L.h, _x0: L.x0 };
    blocks.push(P);
  }
  for (const b of blocks) { delete b._bot; delete b._h; delete b._x0; }
  return { blocks, tables, bodyH };
}

// Lines that repeat on most pages near the top/bottom (running headers, "Halaman 3 dari 10")
export function furnitureKeys(pages) {
  if (pages.length < 3) return new Set();
  const cnt = new Map();
  for (const p of pages) {
    const seen = new Set();
    for (const b of p.blocks) {
      if (b.t === 'tbl' || !b.r?.[0]) continue;
      const y = b.r[0][1];
      if (y > 0.09 && y < 0.91) continue;
      const k = norm(b.x);
      if (!k || seen.has(k)) continue;
      seen.add(k); cnt.set(k, (cnt.get(k) || 0) + 1);
    }
  }
  const out = new Set();
  for (const [k, c] of cnt) if (c >= Math.max(3, pages.length * 0.5)) out.add(k);
  return out;
}
export const norm = s => String(s || '').toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 80);
