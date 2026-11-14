// Positioned text (PDF text items, OCR words) → reading-order blocks: headings, paragraphs, list items and tables.
// Items: {s, x, y (baseline), w, h (font size), b (bold)} in page units, y growing downwards.
import { parseNum } from './numparse.js';

const med = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const isNumText = s => !!parseNum(String(s).replace(/\s+/g, ''), 'id') || /^[-–]$/.test(String(s).trim());
const BULLET = /^([•●▪■◦○‣∙·►▶➢✓✔\-–*]|\(?[a-zA-Z0-9]{1,2}[.)])\s+/;

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
      const s = it.s.replace(/\s+/g, ' ');
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
    for (const g of segs) g.s = g.s.trim();
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
  // rows with more segments than K can add columns in the gaps (sparse columns)
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

function buildTable(run, opt = {}) {
  const cols = columnsOf(run);
  if (!cols) return null;
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
  for (const r of run) {
    if (opt.ocr && junk(r.text)) continue;
    const cells = Array(C).fill('');
    for (const g of r.segs) { const j = colIndex(cols, g); cells[j] = cells[j] ? cells[j] + ' ' + g.s : g.s; }
    const filled = cells.filter(Boolean).length;
    const gap = prev ? r.top - prev.bot : 99;
    // wrapped cell text: continues the row above (a row that fills most columns is a row of its own)
    if (prev && gap < r.h * 0.9 && !cells[0] && filled <= Math.max(1, C * 0.35) && rows.length) {
      const last = rows[rows.length - 1];
      cells.forEach((c, j) => { if (c) last.c[j] = last.c[j] ? last.c[j] + ' ' + c : c; });
      last.r.push(r);
    } else rows.push({ c: cells, r: [r], group: filled === 1 && !!cells[0] && C > 2 });
    prev = r;
  }
  // header rows: leading rows without numbers (max 3)
  const numRow = row => { const n = row.c.slice(1).filter(c => c && isNumText(c)).length; return C >= 4 ? n >= 2 : n >= 1; };
  let nh = 0;
  while (nh < rows.length - 1 && nh < 3 && !numRow(rows[nh])) nh++;
  if (nh === rows.length - 1 && nh > 1) nh = 1;
  let head;
  if (nh) {
    head = Array(C).fill('');
    for (let k = 0; k < nh; k++) rows[k].c.forEach((c, j) => { if (c) head[j] = head[j] ? head[j] + ' ' + c : c; });
    // a header cell spanning two columns leaves the next one empty: "Oktober" over "Target | Realisasi" stays in its own column
    if (opt.ocr) head = head.map(h => h.replace(/\((?:96|9%|%6|36|26|%o)\)/g, '(%)').replace(/\b(\d{1,2})96\b/g, '$1%').replace(/\s+/g, ' ').trim());
  } else head = cols.map((_, j) => 'Kolom ' + (j + 1));
  const body = rows.slice(nh);
  if (!body.length) return null;
  return { cols, head, rows: body.map(r => r.c), groups: body.map(r => r.group ? 1 : 0), lines: run, numRatio };
}

// ---------- page ----------
export function pageBlocks(items, W, H, opt = {}) {
  const lines = toLines(items, opt.vlines || [], opt.hlines || []);
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
        if (gap > 2.4 * Math.max(N.h, lines[j - 1].h)) break;
        if (N.segs.length >= 2) singles = 0;
        else if (++singles > 1 || N.h > bodyH * 1.35) break;
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
      if (t) { out.push({ kind: 'table', t }); i = j; continue; }
    }
    out.push({ kind: 'line', L });
    i++;
  }
  // body text size from the lines outside tables (table cells are often set smaller)
  const free = out.filter(o => o.kind === 'line').map(o => o.L);
  if (free.length) bodyH = med(free.flatMap(L => Array(Math.min(20, Math.ceil(L.text.length / 20))).fill(Math.round(L.h * 2) / 2))) || bodyH;
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
