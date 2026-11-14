// Slide plan (semantic) → positioned elements on a 960 × 540 canvas, sized so every text fits.
// Element kinds: rect, circle, path, line, text, bullets, chart, table. deco: part of the background art.
import { fit, fitList, width } from './fit.js';
import { mix, lum } from './themes.js';

export const W = 960, H = 540, M = 48;

export function composeDeck(spec, th) {
  const n = spec.slides.length;
  return spec.slides.map((s, i) => composeSlide(s, i, n, spec, th));
}

export function composeSlide(s, idx, total, spec, th) {
  const C = th.c, HF = th.f.head, BF = th.f.body;
  const E = [];
  const add = e => (E.push(e), e);
  const rect = (x, y, w, h, fill, o = {}) => add({ k: 'rect', x, y, w, h, fill, ...o });
  const circle = (x, y, d, fill, o = {}) => add({ k: 'circle', x, y, w: d, h: d, fill, ...o });
  const text = (x, y, w, h, txt, o = {}) => {
    const fam = o.font === 'head' ? HF : BF, weight = o.weight || 400, lh = o.lh || 1.25;
    const f = fit(txt, w, h, { family: fam, weight, max: o.max || 20, min: o.min || 10, lh, maxLines: o.maxLines || 99 });
    const e = add({ k: 'text', x, y, w, h, text: txt, lines: f.lines, size: f.size, font: o.font || 'body', weight, color: o.color || C.tx, align: o.align || 'l', va: o.va || 't', lh, ls: o.ls || 0, upper: !!o.upper, bind: o.bind, op: o.op });
    e.used = f.lines.length * f.size * lh;
    return e;
  };
  const bullets = (x, y, w, h, items, o = {}) => {
    const fam = BF, weight = o.weight || 400, lh = o.lh || 1.32, gap = o.gap ?? 0.7, indent = o.indent ?? 1.45;
    const f = fitList(items, w, h, { family: fam, weight, max: o.max || 20, min: o.min || 11, lh, gap, indent });
    return add({ k: 'bullets', x, y, w, h, items, lines: f.lines, size: f.size, weight, color: o.color || C.tx, mcolor: o.mcolor || C.a1, marker: o.marker || 'dot', lh, gap, indent, bind: o.bind, used: f.lines.reduce((a, l) => a + l.length * f.size * lh, 0) + (items.length - 1) * gap * f.size });
  };
  const dark = !!th.dark, EN = spec.lang === 'en';
  const t = s.type;
  const pts = (s.points || []).filter(Boolean);
  const footer = (light) => {
    const col = light ? 'rgba(255,255,255,.72)' : C.tx2;
    const left = [spec.title, spec.period].filter(Boolean).join(' · ');
    if (left) text(M, H - 34, 640, 16, left, { max: 10.5, min: 8, color: col, maxLines: 1 });
    text(W - M - 60, H - 34, 60, 16, String(idx + 1), { max: 10.5, min: 8, color: col, align: 'r', maxLines: 1 });
  };
  const titleBlock = (title, o = {}) => {
    rect(M, 36, 40, 5, C.a1, { r: 2.5 });
    const e = text(M, 52, o.w || W - 2 * M, 78, title || '', { font: 'head', weight: HF === 'DM Serif Display' || HF === 'Lora' ? 700 : 800, max: o.max || 28, min: 17, lh: 1.16, color: C.title, maxLines: 2, bind: { f: 'title' } });
    e.h = Math.max(e.used, 30);
    return 52 + e.h + 22;
  };
  // ---- background
  rect(0, 0, W, H, C.bg, { deco: 1 });

  if (t === 'cover') {
    cover(s, spec, th, { rect, circle, text, add });
  } else if (t === 'section') {
    const bg = dark ? C.deep : C.a1;
    rect(0, 0, W, H, bg, { deco: 1 });
    circle(W - 330, -120, 520, '#ffffff', { op: 0.06, deco: 1 });
    circle(W - 180, 300, 380, '#ffffff', { op: 0.05, deco: 1 });
    const num = String(s.num || '').padStart(2, '0');
    if (s.num) text(M + 16, 120, 300, 130, num, { font: 'head', weight: 800, max: 110, min: 60, color: '#ffffff', op: 0.28, maxLines: 1 });
    rect(M + 20, 262, 56, 5, dark ? C.a1 : '#ffffff', { r: 2.5 });
    const tt = text(M + 20, 284, 760, 110, s.title || '', { font: 'head', weight: 800, max: 40, min: 24, lh: 1.12, color: '#ffffff', maxLines: 2, bind: { f: 'title' } });
    if (s.subtitle) text(M + 20, 284 + tt.used + 14, 700, 60, s.subtitle, { max: 18, min: 12, color: 'rgba(255,255,255,.82)', maxLines: 2, bind: { f: 'subtitle' } });
    footer(true);
  } else if (t === 'end') {
    rect(0, 0, W, H, C.deep, { deco: 1 });
    circle(-160, 280, 480, C.a1, { op: 0.22, deco: 1 });
    circle(W - 220, -140, 420, C.a2, { op: 0.16, deco: 1 });
    rect(W / 2 - 28, 196, 56, 5, C.a1, { r: 2.5 });
    text(120, 214, 720, 80, s.title || (EN ? 'Thank you' : 'Terima kasih'), { font: 'head', weight: 800, max: 52, min: 30, color: '#ffffff', align: 'c', maxLines: 1, bind: { f: 'title' } });
    if (s.subtitle) text(160, 302, 640, 60, s.subtitle, { max: 18, min: 12, color: 'rgba(255,255,255,.78)', align: 'c', maxLines: 2, bind: { f: 'subtitle' } });
  } else if (t === 'agenda') {
    const y0 = titleBlock(s.title || 'Agenda');
    const items = pts.slice(0, 10);
    const two = items.length > 5;
    const colW = two ? (W - 2 * M - 40) / 2 : W - 2 * M;
    const per = two ? Math.ceil(items.length / 2) : items.length;
    const avail = H - 64 - y0;
    const rowH = Math.min(72, avail / Math.max(per, 1));
    const top = y0 + Math.max(0, (avail - rowH * per) / 2 - 10);
    items.forEach((it, i) => {
      const col = two && i >= per ? 1 : 0, row = col ? i - per : i;
      const x = M + col * (colW + 40), y = top + row * rowH;
      rect(x, y + (rowH - 44) / 2, 44, 44, C.a1, { r: 11 });
      text(x, y + (rowH - 44) / 2, 44, 44, String(i + 1).padStart(2, '0'), { font: 'head', weight: 800, max: 17, min: 12, color: C.on1, align: 'c', va: 'm', maxLines: 1 });
      text(x + 62, y, colW - 66, rowH, it, { max: 21, min: 12, weight: 600, va: 'm', color: C.title, maxLines: 2, bind: { f: 'points', i } });
      if (row < per - 1) rect(x + 62, y + rowH - 1, colW - 66, 1, C.line);
    });
    footer();
  } else if (t === 'kpi') {
    const y0 = titleBlock(s.title);
    const ks = (s.kpis || []).slice(0, 4);
    const n = Math.max(1, ks.length), gap = 18, cw = (W - 2 * M - gap * (n - 1)) / n;
    const avail = H - 64 - y0;
    const ptsH = pts.length ? Math.min(avail * 0.45, 24 + pts.slice(0, 4).length * 40) : 0;
    const ch = Math.min(pts.length ? 210 : 240, avail - ptsH - (pts.length ? 26 : 0));
    ks.forEach((k, i) => {
      const x = M + i * (cw + gap);
      rect(x, y0, cw, ch, C.card, { r: 14, line: C.line });
      rect(x, y0, 6, ch, i === 0 ? C.a1 : mix(C.a1, C.bg, 0.35 + 0.12 * i), { r: 3 });
      const v = text(x + 24, y0 + 22, cw - 44, ch * 0.42, k.v || '–', { font: 'head', weight: 800, max: n <= 2 ? 52 : n === 3 ? 44 : 38, min: 18, lh: 1.05, color: C.a1, maxLines: 1 });
      const lab = text(x + 24, y0 + 26 + v.used + 8, cw - 44, ch * 0.3, k.label || '', { max: 16.5, min: 10.5, weight: 700, color: C.title, maxLines: 2, bind: { f: 'kpis', i, p: 'label' } });
      if (k.note) text(x + 24, y0 + 26 + v.used + 10 + lab.used + 4, cw - 44, Math.max(14, ch - (26 + v.used + 14 + lab.used) - 14), k.note, { max: 13.5, min: 9.5, color: C.tx2, maxLines: 2, bind: { f: 'kpis', i, p: 'note' } });
    });
    if (pts.length) bullets(M, y0 + ch + 26, W - 2 * M, H - 64 - (y0 + ch + 26), pts.slice(0, 4), { max: 18, min: 11, marker: 'check', bind: { f: 'points' } });
    footer();
  } else if (t === 'chart') {
    const y0 = titleBlock(s.title);
    const side = pts.length ? 288 : 0;
    const cw = W - 2 * M - (side ? side + 24 : 0), chH = H - 62 - y0;
    if (s.chartData) add({ k: 'chart', x: M, y: y0, w: cw, h: chH, chart: s.chartData });
    if (s.chartData?.title) text(M, y0 - 18, cw, 16, s.chartData.title + (s.chartData.unit && s.chartData.unit !== '%' ? ` (${s.chartData.unit})` : ''), { max: 11.5, min: 9, color: C.tx2, weight: 600, maxLines: 1 });
    if (side) insightPanel(W - M - side, y0 - 6, side, chH + 6, pts);
    footer();
  } else if (t === 'table') {
    const y0 = titleBlock(s.title);
    const side = pts.length ? 270 : 0;
    const tw2 = W - 2 * M - (side ? side + 24 : 0), th2 = H - 62 - y0;
    if (s.tableData) tableEl(M, y0, tw2, th2, s.tableData);
    if (side) insightPanel(W - M - side, y0, side, th2, pts);
    footer();
  } else if (t === 'two') {
    const y0 = titleBlock(s.title);
    const cw = (W - 2 * M - 24) / 2, avail = H - 64 - y0;
    const sides = [s.left || {}, s.right || {}];
    // natural height of each card at a comfortable size; short content gets a shorter card, centred
    const need = sides.map(c => {
      const hf = fit(c.head || '', cw - 52, 56, { family: HF, weight: 800, max: 22, min: 13, maxLines: 2 });
      const items = (c.points || []).slice(0, 6);
      const lf = fitList(items, cw - 52, 999, { family: BF, max: 21, min: 10.5, lh: 1.32, gap: 0.9, indent: 1.45 });
      const lh = lf.lines.reduce((a2, l) => a2 + l.length * lf.size * 1.32, 0) + Math.max(0, items.length - 1) * 0.9 * lf.size;
      return 26 + hf.lines.length * hf.size * 1.25 + 32 + lh + 30;
    });
    const chh = Math.min(avail, Math.max(avail * 0.58, ...need));
    const top = y0 + (avail - chh) * 0.35;
    sides.forEach((c, i) => {
      const x = M + i * (cw + 24), col = i ? C.a2 : C.a1;
      rect(x, top, cw, chh, C.card, { r: 14, line: C.line });
      rect(x, top, cw, 6, col, { r: 3 });
      const hd = text(x + 26, top + 26, cw - 52, 56, c.head || '', { font: 'head', weight: 800, max: 22, min: 13, color: col, maxLines: 2, bind: { f: i ? 'right' : 'left', p: 'head' } });
      rect(x + 26, top + 26 + hd.used + 12, 40, 3, col, { r: 1.5, op: 0.5 });
      bullets(x + 26, top + 26 + hd.used + 32, cw - 52, chh - (26 + hd.used + 32) - 22, (c.points || []).slice(0, 6), { max: 21, min: 10.5, gap: 0.9, mcolor: col, bind: { f: i ? 'right' : 'left', p: 'points' } });
    });
    footer();
  } else if (t === 'steps') {
    const y0 = titleBlock(s.title);
    const st = (s.steps || []).slice(0, 5), n = Math.max(1, st.length);
    const cw = (W - 2 * M) / n, avail = H - 64 - y0;
    // measure the tallest step to centre the whole row vertically
    const headMax = n <= 3 ? 20 : 18, txtMax = n <= 3 ? 17 : 15;
    const tmp = st.map(p => {
      const hf = fit(p.head || '', cw - 28, 60, { family: HF, weight: 800, max: headMax, min: 11.5, lh: 1.25, maxLines: 2 });
      const tf = fit(p.text || '', cw - 28, avail - 150, { family: BF, weight: 400, max: txtMax, min: 10, lh: 1.25 });
      return hf.lines.length * hf.size * 1.25 + 10 + tf.lines.length * tf.size * 1.25;
    });
    const block = 60 + 22 + Math.max(...tmp, 40);
    const cy = y0 + 30 + Math.max(0, (avail - block) / 2 - 8);
    rect(M + cw / 2, cy - 1.5, cw * (n - 1), 3, C.line);
    st.forEach((p, i) => {
      const cx = M + cw * (i + 0.5);
      circle(cx - 30, cy - 30, 60, i === 0 ? C.a1 : C.bg, { line: C.a1, lw: 3 });
      text(cx - 30, cy - 30, 60, 60, String(i + 1), { font: 'head', weight: 800, max: 22, min: 12, color: i === 0 ? C.on1 : C.a1, align: 'c', va: 'm', maxLines: 1 });
      const hd = text(cx - cw / 2 + 14, cy + 50, cw - 28, 60, p.head || '', { font: 'head', weight: 800, max: headMax, min: 11.5, color: C.title, align: 'c', maxLines: 2, bind: { f: 'steps', i, p: 'head' } });
      text(cx - cw / 2 + 14, cy + 50 + hd.used + 10, cw - 28, H - 66 - (cy + 50 + hd.used + 10), p.text || '', { max: txtMax, min: 10, color: C.tx, align: 'c', bind: { f: 'steps', i, p: 'text' } });
    });
    footer();
  } else if (t === 'statement') {
    rect(0, 0, 14, H, C.a1, { deco: 1 });
    text(M + 40, 92, 700, 24, (s.title || '').toUpperCase(), { max: 13, min: 10, weight: 800, color: C.a1, ls: 1.5, maxLines: 1, bind: { f: 'title' } });
    text(M + 20, 120, 120, 120, '“', { font: 'head', weight: 800, max: 120, min: 80, color: C.a1, op: 0.22, maxLines: 1 });
    text(M + 40, 160, W - 2 * M - 80, 260, s.text || '', { font: 'head', weight: 700, max: 36, min: 18, lh: 1.25, color: C.title, va: 'm', bind: { f: 'text' } });
    footer();
  } else if (t === 'conclusion') {
    const y0 = titleBlock(s.title || (EN ? 'Conclusions & Recommendations' : 'Kesimpulan & Rekomendasi'));
    const recs = (s.recs || []).filter(Boolean);
    const lw = recs.length ? 520 : W - 2 * M, hh = H - 64 - y0;
    const items = pts.slice(0, 5), n = Math.max(1, items.length), gap = 12;
    const rh = Math.min(104, (hh - gap * (n - 1)) / n);
    const top = y0 + Math.max(0, (hh - (rh * n + gap * (n - 1))) / 2);
    items.forEach((p, i) => {
      const y = top + i * (rh + gap);
      rect(M, y, lw, rh, C.card, { r: 12, line: C.line });
      circle(M + 18, y + rh / 2 - 17, 34, C.a1);
      text(M + 18, y + rh / 2 - 17, 34, 34, String(i + 1), { font: 'head', weight: 800, max: 15, min: 11, color: C.on1, align: 'c', va: 'm', maxLines: 1 });
      text(M + 68, y + 8, lw - 88, rh - 16, p, { max: 18, min: 10.5, weight: 600, lh: 1.3, va: 'm', color: C.title, bind: { f: 'points', i } });
    });
    if (recs.length) {
      const x = M + lw + 24, w = W - M - x;
      rect(x, y0, w, hh, dark ? C.card : C.deep, { r: 16 });
      text(x + 24, y0 + 22, w - 48, 20, EN ? 'RECOMMENDATIONS' : 'REKOMENDASI', { max: 12, min: 10, weight: 800, color: dark ? C.a1 : mix(C.a1, '#ffffff', 0.5), ls: 1.4, maxLines: 1 });
      bullets(x + 24, y0 + 54, w - 48, hh - 74, recs.slice(0, 5), { max: 17, min: 10.5, gap: 0.95, color: '#ffffff', mcolor: dark ? C.a1 : mix(C.a1, '#ffffff', 0.5), marker: 'arrow', bind: { f: 'recs' } });
    }
    footer();
  } else {
    // bullets (default)
    const y0 = titleBlock(s.title);
    const items = pts.slice(0, 6);
    const hh = H - 64 - y0;
    const cards = items.length >= 2 && items.length <= 4 && items.every(p => p.length <= 150);
    if (cards) {
      const n = items.length, cols = n === 4 ? 2 : n, rows = n === 4 ? 2 : 1, gap = 18;
      const cw = (W - 2 * M - gap * (cols - 1)) / cols, chh = (hh - gap * (rows - 1)) / rows;
      items.forEach((p, i) => {
        const x = M + (i % cols) * (cw + gap), y = y0 + Math.floor(i / cols) * (chh + gap);
        rect(x, y, cw, chh, C.card, { r: 14, line: C.line });
        circle(x + 20, y + 20, 34, C.a1);
        text(x + 20, y + 20, 34, 34, String(i + 1), { font: 'head', weight: 800, max: 15, min: 11, color: C.on1, align: 'c', va: 'm', maxLines: 1 });
        text(x + 20, y + 68, cw - 40, chh - 86, p, { max: n <= 2 ? 21 : 18, min: 11, weight: 500, lh: 1.32, color: C.title, bind: { f: 'points', i } });
      });
    } else if (items.length === 1) {
      text(M, y0 + 10, W - 2 * M, hh - 20, items[0], { max: 26, min: 14, weight: 500, lh: 1.35, color: C.title, va: 'm', bind: { f: 'points', i: 0 } });
    } else bullets(M, y0, W - 2 * M, hh, items, { max: 20, min: 11, marker: 'sq', bind: { f: 'points' } });
    footer();
  }
  return { els: E, notes: s.notes || '', type: t };

  function insightPanel(x, y, w, h, items) {
    rect(x, y, w, h, C.bg2, { r: 16 });
    text(x + 22, y + 18, w - 44, 18, 'INSIGHT', { max: 11.5, min: 9.5, weight: 800, color: C.a1, ls: 1.4, maxLines: 1 });
    bullets(x + 22, y + 46, w - 44, h - 64, items.slice(0, 4), { max: 15.5, min: 10, lh: 1.35, gap: 0.9, marker: 'dot', bind: { f: 'points' } });
  }
  function tableEl(x, y, w, h, td) {
    const rows = td.rows.slice(0, td.max || 12);
    const nR = rows.length + 1;
    const rowH = Math.min(36, Math.max(18, h / nR));
    const size = Math.max(8.5, Math.min(14, rowH * 0.42));
    const C2 = td.head.length;
    // column widths from content
    const need = td.head.map((hd, j) => Math.max(width(String(hd), size, BF, 700), ...rows.map(r => width(String(r[j] ?? ''), size, BF, 400))) + 18);
    const tot = need.reduce((a, b) => a + b, 0);
    let cws = need.map(v => (v / tot) * w);
    const minW = Math.min(70, w / C2);
    cws = cws.map(v => Math.max(minW, v));
    const k = w / cws.reduce((a, b) => a + b, 0);
    cws = cws.map(v => v * k);
    add({ k: 'table', x, y, w, h: rowH * nR, head: td.head, rows, num: td.num || [], cws, rowH, size, hl: td.hl ?? -1, more: td.more || 0, en: EN });
  }
}

function cover(s, spec, th, { rect, circle, text, add }) {
  const C = th.c, HF = th.f.head;
  const style = th.cover;
  const kicker = (s.kicker || spec.kicker || '').toUpperCase();
  const title = s.title || spec.title || '';
  const sub = s.subtitle || spec.subtitle || '';
  const meta = s.meta || [spec.org, spec.period].filter(Boolean).join(' · ');
  const tw = HF === 'DM Serif Display' || HF === 'Lora' ? 700 : 800;
  let x = 64, w = 540, onDark = false;
  if (style === 'split') {
    rect(612, 0, 348, 540, C.a1, { deco: 1 });
    rect(612, 0, 348, 540, C.deep, { op: 0.22, deco: 1 });
    [[660, 300, 34, 160], [712, 230, 34, 230], [764, 330, 34, 130], [816, 170, 34, 290], [868, 260, 34, 200]].forEach(([bx, by, bw, bh], i) => rect(bx, by, bw, bh, '#ffffff', { r: 8, op: 0.12 + i * 0.03, deco: 1 }));
    circle(820, 70, 64, '#ffffff', { op: 0.18, deco: 1 });
  } else if (style === 'dark') {
    rect(0, 0, 960, 540, C.deep, { deco: 1 });
    [460, 360, 260].forEach((d, i) => circle(960 - d * 0.62, 270 - d / 2, d, 'none', { line: C.a1, lw: 1.5, op: 0.18 + i * 0.12, deco: 1 }));
    onDark = true;
  } else if (style === 'stripe') {
    add({ k: 'path', d: 'M640 0H960V540H470Z', fill: C.a2, deco: 1 });
    add({ k: 'path', d: 'M760 0H960V540H600Z', fill: C.a1, deco: 1 });
    add({ k: 'path', d: 'M890 0H960V540H800Z', fill: '#ffffff', op: 0.18, deco: 1 });
    w = 500;
  } else if (style === 'minimal') {
    rect(64, 120, 4, 300, C.a1, { deco: 1 });
    x = 92; w = 700;
  } else if (style === 'wave') {
    add({ k: 'path', d: 'M0 410C180 360 300 470 520 430S820 330 960 380V540H0Z', fill: C.a1, op: 0.9, deco: 1 });
    add({ k: 'path', d: 'M0 460C220 420 380 520 600 480S860 420 960 450V540H0Z', fill: C.a2, deco: 1 });
    circle(760, 60, 180, C.a1, { op: 0.1, deco: 1 });
    w = 720;
  } else if (style === 'blob') {
    circle(640, -120, 420, C.a1, { op: 0.16, deco: 1 });
    circle(760, 220, 340, C.a2, { op: 0.13, deco: 1 });
    circle(560, 330, 220, C.a1, { op: 0.1, deco: 1 });
    w = 560;
  }
  const tc = onDark ? '#ffffff' : C.title, sc = onDark ? 'rgba(255,255,255,.78)' : C.tx2;
  const top = style === 'wave' ? 96 : 128;
  if (kicker) text(x, top - 34, w, 20, kicker, { max: 13, min: 10, weight: 800, color: C.a1, ls: 1.6, maxLines: 1 });
  const t1 = text(x, top, w, 190, title, { font: 'head', weight: tw, max: 46, min: 26, lh: 1.1, color: tc, maxLines: 3, bind: { f: 'title' } });
  let y = top + t1.used + 18;
  rect(x, y, 64, 5, C.a1, { r: 2.5 });
  y += 22;
  if (sub) { const s1 = text(x, y, w, 64, sub, { max: 19, min: 12, color: sc, lh: 1.3, maxLines: 2, bind: { f: 'subtitle' } }); y += s1.used + 10; }
  if (meta) text(x, style === 'wave' ? 350 : 448, w, 40, meta, { max: 14, min: 10, weight: 700, color: onDark ? C.a1 : C.title, maxLines: 2, bind: { f: 'meta' } });
  text(x, style === 'wave' ? 376 : 474, w, 18, spec.dateText || '', { max: 11.5, min: 9, color: sc, maxLines: 1 });
}
export { lum };
