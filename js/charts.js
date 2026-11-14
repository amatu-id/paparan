// SVG charts for slides: col, bar, line, area, combo, stack, donut, pareto. Returns an SVG string.
import { fontFamily, mix } from './themes.js';
import { esc, fmtNum } from './util.js';
import { width as tw } from './fit.js';

function nice(lo, hi, n = 5) {
  if (!(hi > lo)) { hi = lo + (Math.abs(lo) || 1); }
  const raw = (hi - lo) / n, p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw) || 10 * p;
  return { lo: Math.floor(lo / step + 1e-9) * step, hi: Math.ceil(hi / step - 1e-9) * step, step };
}
export function fmtShort(v, unit) {
  if (v == null || !Number.isFinite(v)) return '';
  const a = Math.abs(v);
  let s;
  if (a >= 1e12) s = fmtNum(v / 1e12, a >= 1e13 ? 0 : 1) + ' T';
  else if (a >= 1e9) s = fmtNum(v / 1e9, a >= 1e10 ? 0 : 1) + ' M';
  else if (a >= 1e6) s = fmtNum(v / 1e6, a >= 1e7 ? 0 : 1) + ' jt';
  else if (a >= 1e5) s = fmtNum(v / 1e3, 0) + ' rb';
  else s = fmtNum(v, a >= 100 ? 0 : a >= 10 ? 1 : 2);
  return unit === '%' ? s + '%' : s;
}
function wrap2(s, maxW, size, fam) {
  const words = s.split(/\s+/);
  if (words.length < 2) return [clip(s, maxW, size, fam)];
  let a = '', k = 0;
  while (k < words.length && tw((a ? a + ' ' : '') + words[k], size, fam) <= maxW) a = (a ? a + ' ' : '') + words[k++];
  if (!a) { a = words[0]; k = 1; }
  const b = words.slice(k).join(' ');
  return b ? [a, clip(b, maxW, size, fam)] : [a];
}
const clip = (s, maxW, size, fam, wt = 400) => {
  s = String(s ?? '');
  if (tw(s, size, fam, wt) <= maxW) return s;
  while (s.length > 1 && tw(s + '…', size, fam, wt) > maxW) s = s.slice(0, -1);
  return s + '…';
};

export function chartSVG(ch, W, H, th, o = {}) {
  const fam = th.f.body, F = fontFamily(fam);
  const fs = Math.max(9.5, Math.min(13, H / 28)) * (o.scale || 1);
  const C = th.c, pal = th.chart;
  const out = [];
  const T = (x, y, s, a = {}) => out.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${a.size || fs}" fill="${a.fill || C.tx2}"${a.anchor ? ` text-anchor="${a.anchor}"` : ''}${a.weight ? ` font-weight="${a.weight}"` : ''}${a.base ? ` dominant-baseline="${a.base}"` : ''}>${esc(s)}</text>`);
  const series = (ch.series || []).filter(s => s && Array.isArray(s.vals));
  const cats = ch.cats || [];
  const unit = ch.unit || '';
  const colorOf = (s, i) => (s.muted ? mix(C.tx2, C.bg, 0.45) : s.color || pal[i % pal.length]);
  let top = 6;
  // legend
  const showLegend = series.length > 1 || ch.type === 'combo' || ch.type === 'pareto' || ch.ref != null;
  if (showLegend && ch.type !== 'donut') {
    let x = 0;
    const items = ch.type === 'pareto' ? [{ name: series[0]?.name || 'Nilai', c: pal[0] }, { name: 'Kumulatif %', c: C.a2 || pal[1], line: 1 }] : series.map((s, i) => ({ name: s.name, c: colorOf(s, i), line: s.kind === 'line' || ch.type === 'line' || ch.type === 'area', dash: s.dash }));
    if (ch.ref != null && ch.type !== 'pareto') items.push({ name: 'Target ' + fmtShort(ch.ref, unit), c: C.a2, line: 1, dash: 1 });
    for (const it of items) {
      const name = clip(it.name, W / Math.max(2, items.length) - 30, fs * 0.95, fam);
      if (it.line) out.push(`<line x1="${x}" y1="${top + fs * 0.55}" x2="${x + 16}" y2="${top + fs * 0.55}" stroke="${it.c}" stroke-width="2.6"${it.dash ? ' stroke-dasharray="4 3"' : ''} stroke-linecap="round"/>`);
      else out.push(`<rect x="${x}" y="${top + fs * 0.1}" width="11" height="11" rx="2.5" fill="${it.c}"/>`);
      T(x + (it.line ? 21 : 16), top + fs * 0.92, name, { size: fs * 0.95, fill: C.tx });
      x += (it.line ? 21 : 16) + tw(name, fs * 0.95, fam) + 18;
    }
    top += fs * 1.9;
  }
  if (ch.type === 'donut') return wrapSvg(donut(ch, W, H, th, fs, fam, T, out, series, cats, unit), W, H, F);
  const horiz = ch.type === 'bar';
  const vals = series.flatMap(s => s.vals).filter(v => v != null && Number.isFinite(v));
  if (!vals.length) { T(W / 2, H / 2, 'Tidak ada data angka', { anchor: 'middle' }); return wrapSvg(out.join(''), W, H, F); }
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const stacked = ch.type === 'stack';
  if (stacked) { const sums = cats.map((_, k) => series.reduce((a, s) => a + Math.max(0, s.vals[k] || 0), 0)); hi = Math.max(...sums); lo = Math.min(0, lo); }
  const barLike = ch.type === 'col' || ch.type === 'bar' || stacked || ch.type === 'pareto' || (ch.type === 'combo' && series.some(s => s.kind !== 'line'));
  if (ch.ref != null) { lo = Math.min(lo, ch.ref); hi = Math.max(hi, ch.ref); }
  if (barLike || lo >= 0 && lo < hi * 0.35) lo = Math.min(0, lo);
  else { const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.1 || 1; lo -= pad; hi += pad * 0.5; if (vals.every(v => v >= 0)) lo = Math.max(0, lo); }
  const sc = nice(lo, hi + (hi - lo) * (horiz ? 0 : barLike ? 0.1 : 0.04), Math.max(3, Math.min(6, Math.round((horiz ? W : H) / 60))));
  const n = Math.max(1, cats.length);
  const fam2 = fam;
  // plot box
  const tickW = Math.max(...[sc.lo, sc.hi, sc.lo + sc.step].map(v => tw(fmtShort(v, unit), fs * 0.9, fam2))) + 8;
  const right = ch.type === 'pareto' ? tw('100%', fs * 0.9, fam2) + 10 : 6;
  if (horiz) {
    const labW = Math.min(W * 0.36, Math.max(...cats.map(c => tw(String(c), fs, fam2))) + 16);
    const x0 = labW, x1 = W - 8 - tw(fmtShort(hi, unit), fs * 0.95, fam2) - 6, y0 = top + 2, y1 = H - fs * 1.6;
    const band = (y1 - y0) / n, ns = series.length, bh = Math.min(band * 0.68 / ns, 34);
    const X = v => x0 + (v - sc.lo) / (sc.hi - sc.lo) * (x1 - x0);
    for (let v = sc.lo; v <= sc.hi + sc.step / 2; v += sc.step) {
      out.push(`<line x1="${X(v)}" y1="${y0}" x2="${X(v)}" y2="${y1}" stroke="${C.line}" stroke-width="1"/>`);
      T(X(v), y1 + fs * 1.25, fmtShort(v, unit), { anchor: 'middle', size: fs * 0.9 });
    }
    cats.forEach((c, k) => {
      const yc = y0 + band * (k + 0.5);
      T(x0 - 8, yc, clip(c, labW - 10, fs, fam2), { anchor: 'end', base: 'middle', fill: C.tx });
      series.forEach((s, i) => {
        const v = s.vals[k];
        if (v == null) return;
        const y = yc - (ns * bh) / 2 + i * bh, xa = X(Math.min(0, v)), xb = X(Math.max(0, v));
        out.push(`<rect x="${xa}" y="${y + 1}" width="${Math.max(1, xb - xa)}" height="${bh - 2}" rx="${Math.min(4, bh / 4)}" fill="${colorOf(s, i)}"/>`);
        if (n <= 16) T(xb + 5, y + bh / 2, fmtShort(v, unit), { base: 'middle', size: fs * 0.92, fill: C.tx, weight: 600 });
      });
    });
    return wrapSvg(out.join(''), W, H, F);
  }
  const x0 = tickW, x1 = W - right, y0 = top + fs * 0.8;
  const band = (x1 - x0) / n;
  const lfs = fs * 0.92;
  // category labels: up to two lines each; crowded axes show every k-th label
  const maxLab = Math.max(...cats.map(c => tw(String(c), lfs, fam2)));
  let every = 1;
  let labs = cats.map(c => [String(c ?? '')]);
  if (maxLab + 6 > band) {
    const two = cats.map(c => wrap2(String(c ?? ''), band - 6, lfs, fam2));
    if (n <= 12 || two.every(l => l.every(x => tw(x, lfs, fam2) <= band - 4))) labs = two.map(l => l.map(x => clip(x, band - 4, lfs, fam2)));
    else { every = Math.max(1, Math.ceil((maxLab + 10) / band)); labs = cats.map(c => [clip(c, band * every - 6, lfs, fam2)]); }
  }
  const labRows = Math.max(...labs.map(l => l.length));
  const y1 = H - fs * (1.7 + (labRows - 1) * 1.15) - 2;
  const Y = v => y1 - (v - sc.lo) / (sc.hi - sc.lo) * (y1 - y0);
  for (let v = sc.lo; v <= sc.hi + sc.step / 2; v += sc.step) {
    out.push(`<line x1="${x0}" y1="${Y(v).toFixed(1)}" x2="${x1}" y2="${Y(v).toFixed(1)}" stroke="${C.line}" stroke-width="1"${Math.abs(v) < 1e-9 ? '' : ''}/>`);
    T(x0 - 6, Y(v), fmtShort(v, unit), { anchor: 'end', base: 'middle', size: fs * 0.9 });
  }
  labs.forEach((l, k) => { if (k % every === 0 || (k === n - 1 && (n - 1) % every > every / 2)) l.forEach((x, r) => T(x0 + band * (k + 0.5), y1 + fs * 1.25 + r * lfs * 1.15, x, { anchor: 'middle', size: lfs })); });
  const bars = ch.type === 'pareto' ? [series[0]] : ch.type === 'combo' ? series.filter(s => s.kind !== 'line') : (ch.type === 'col' || stacked) ? series : [];
  const lines = ch.type === 'combo' ? series.filter(s => s.kind === 'line') : (ch.type === 'line' || ch.type === 'area') ? series : [];
  // bars
  const nb = stacked ? 1 : bars.length || 1;
  const bw = Math.min(band * (nb > 1 ? 0.78 : 0.62) / nb, 56);
  const labels = n * nb <= 18 && !stacked;
  const acc = cats.map(() => 0);
  bars.forEach((s) => {
    const i = series.indexOf(s);
    s.vals.forEach((v, k) => {
      if (v == null) return;
      const bi = stacked ? 0 : bars.indexOf(s);
      const x = x0 + band * (k + 0.5) - (nb * bw) / 2 + bi * bw;
      const base = stacked ? acc[k] : 0, top2 = base + v;
      const ya = Y(Math.max(base, top2)), yb = Y(Math.min(base, top2));
      if (stacked) acc[k] += v;
      out.push(`<rect x="${(x + 1).toFixed(1)}" y="${ya.toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${Math.max(0.5, yb - ya).toFixed(1)}" rx="${Math.min(4, bw / 5).toFixed(1)}" fill="${ch.type === 'pareto' ? pal[0] : colorOf(s, i)}"/>`);
      if (labels && (bw > tw(fmtShort(v, unit), fs * 0.82, fam2) * 0.72 || nb === 1)) T(x + bw / 2, ya - 5, fmtShort(v, unit), { anchor: 'middle', size: fs * 0.82, fill: C.tx, weight: 600 });
    });
  });
  if (stacked && n <= 14) acc.forEach((v, k) => T(x0 + band * (k + 0.5), Y(v) - 5, fmtShort(v, unit), { anchor: 'middle', size: fs * 0.82, fill: C.tx, weight: 700 }));
  // reference line (target = 100%)
  if (ch.ref != null && ch.ref >= sc.lo && ch.ref <= sc.hi) {
    out.push(`<line x1="${x0}" y1="${Y(ch.ref)}" x2="${x1}" y2="${Y(ch.ref)}" stroke="${C.a2}" stroke-width="1.6" stroke-dasharray="5 4"/>`);
  }
  // lines
  lines.forEach(s => {
    const i = series.indexOf(s), col = colorOf(s, i);
    const pts = s.vals.map((v, k) => (v == null ? null : [x0 + band * (k + 0.5), Y(v)]));
    const segs = [];
    let cur = [];
    for (const p of pts) { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } }
    if (cur.length) segs.push(cur);
    for (const sg of segs) {
      const d = 'M' + sg.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L');
      if (ch.type === 'area') out.push(`<path d="${d}L${sg[sg.length - 1][0].toFixed(1)},${y1}L${sg[0][0].toFixed(1)},${y1}Z" fill="${col}" fill-opacity=".14"/>`);
      out.push(`<path d="${d}" fill="none" stroke="${col}" stroke-width="${s.dash ? 2.2 : 2.8}" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ' stroke-dasharray="6 4"' : ''}/>`);
    }
    if (n <= 36 && !s.dash) pts.forEach(p => p && out.push(`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${n <= 14 ? 3.6 : 2.6}" fill="${th.c.bg}" stroke="${col}" stroke-width="2"/>`));
    // label the highest and the last point
    const vs = s.vals.map(v => (v == null ? -Infinity : v));
    const kMax = vs.indexOf(Math.max(...vs));
    let kLast = s.vals.length - 1; while (kLast > 0 && s.vals[kLast] == null) kLast--;
    const mark = n <= 12 && lines.length === 1 && !s.dash ? s.vals.map((_, k) => k) : [...new Set([kMax, kLast])];
    if (!s.dash || lines.length === 1) for (const k of mark) if (pts[k]) T(pts[k][0], pts[k][1] - 8, fmtShort(s.vals[k], unit), { anchor: 'middle', size: fs * 0.82, fill: col, weight: 700 });
  });
  // pareto: cumulative share on a 0–100% right axis
  if (ch.type === 'pareto') {
    const v = series[0].vals.map(x => Math.max(0, x || 0)), tot = v.reduce((a, b) => a + b, 0) || 1;
    let c = 0;
    const cum = v.map(x => (c += x) / tot * 100);
    const Y2 = p => y1 - p / 100 * (y1 - y0);
    for (const p of [0, 50, 100]) T(x1 + 4, Y2(p), p + '%', { base: 'middle', size: fs * 0.85 });
    out.push(`<line x1="${x0}" y1="${Y2(80)}" x2="${x1}" y2="${Y2(80)}" stroke="${C.tx2}" stroke-width="1" stroke-dasharray="3 4"/>`);
    const d = 'M' + cum.map((p, k) => (x0 + band * (k + 0.5)).toFixed(1) + ',' + Y2(p).toFixed(1)).join('L');
    out.push(`<path d="${d}" fill="none" stroke="${C.a2}" stroke-width="2.4" stroke-linejoin="round"/>`);
    cum.forEach((p, k) => { out.push(`<circle cx="${(x0 + band * (k + 0.5)).toFixed(1)}" cy="${Y2(p).toFixed(1)}" r="3" fill="${C.a2}"/>`); if (n <= 10) T(x0 + band * (k + 0.5) - 5, Y2(p) - 7, fmtNum(p, 0) + '%', { anchor: 'end', size: fs * 0.78, fill: C.a2, weight: 700 }); });
  }
  out.push(`<line x1="${x0}" y1="${Y(Math.max(sc.lo, Math.min(0, sc.hi)))}" x2="${x1}" y2="${Y(Math.max(sc.lo, Math.min(0, sc.hi)))}" stroke="${mix(C.tx2, C.bg, 0.35)}" stroke-width="1.2"/>`);
  return wrapSvg(out.join(''), W, H, F);
}

function donut(ch, W, H, th, fs, fam, T, out, series, cats, unit) {
  const C = th.c, pal = th.chart;
  const v = (series[0]?.vals || []).map(x => Math.max(0, x || 0));
  const tot = v.reduce((a, b) => a + b, 0) || 1;
  const R = Math.min(H / 2 - 6, W * 0.24), cx = R + 8, cy = H / 2, r2 = R * 0.62;
  let a0 = -Math.PI / 2;
  v.forEach((x, i) => {
    const a1 = a0 + x / tot * Math.PI * 2;
    if (x > 0) {
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a, r) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
      const [xa, ya] = p(a0, R), [xb, yb] = p(a1, R), [xc, yc] = p(a1, r2), [xd, yd] = p(a0, r2);
      const full = x >= tot * 0.9999;
      out.push(full ? `<circle cx="${cx}" cy="${cy}" r="${(R + r2) / 2}" fill="none" stroke="${pal[i % pal.length]}" stroke-width="${R - r2}"/>` :
        `<path d="M${xa},${ya}A${R},${R} 0 ${large} 1 ${xb},${yb}L${xc},${yc}A${r2},${r2} 0 ${large} 0 ${xd},${yd}Z" fill="${pal[i % pal.length]}" stroke="${C.bg}" stroke-width="2"/>`);
    }
    a0 = a1;
  });
  T(cx, cy - fs * 0.35, fmtShort(tot, unit), { anchor: 'middle', size: fs * 1.55, fill: C.title, weight: 800 });
  T(cx, cy + fs * 1.15, 'Total', { anchor: 'middle', size: fs * 0.9 });
  // legend with shares
  const lx = cx + R + 26, n = cats.length, rowH = Math.min(fs * 2.3, (H - 10) / Math.max(1, n));
  const ly = cy - (rowH * n) / 2 + rowH / 2;
  cats.forEach((c, i) => {
    const y = ly + i * rowH;
    out.push(`<rect x="${lx}" y="${y - 6}" width="12" height="12" rx="3" fill="${pal[i % pal.length]}"/>`);
    const pct = fmtNum(v[i] / tot * 100, 1) + '%';
    T(lx + 20, y, clip(c, W - lx - 20 - tw(pct + ' ' + fmtShort(v[i], unit), fs, fam) - 22, fs, fam), { base: 'middle', fill: C.tx });
    T(W - 4, y, pct, { anchor: 'end', base: 'middle', fill: C.title, weight: 700 });
  });
  return out.join('');
}

const wrapSvg = (inner, W, H, F) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family='${F.replace(/'/g, '')}' style="overflow:visible">${inner}</svg>`;
