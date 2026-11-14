// Export a generated deck: PowerPoint (native text, shapes, charts, tables — all editable), PDF, Amatu Slides.
import { PptxGen, htmlToImage, jsPDF } from './libs.js';
import { renderSlide } from './render.js';
import { W, H } from './compose.js';
import { fontFamily } from './themes.js';
import { download, safeName, uid } from './util.js';

const IN = v => +(v / 96).toFixed(4);
const PT = v => +(v * 0.75).toFixed(2);
function col(c) {
  c = String(c || '#000000').trim();
  let m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) return { color: m[1].toUpperCase(), transparency: 0 };
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\)$/i.exec(c);
  if (m) return { color: [m[1], m[2], m[3]].map(x => (+x).toString(16).padStart(2, '0')).join('').toUpperCase(), transparency: Math.round((1 - (m[4] == null ? 1 : +m[4])) * 100) };
  return { color: '000000', transparency: 0 };
}

// the decorative layer (background rects, circles, paths) as one PNG
async function decoPng(sl, th, scale = 2) {
  const deco = sl.els.filter(e => e.deco);
  // only the plain background rectangle: the slide colour does the job, no picture needed
  if (!deco.length || (deco.length === 1 && deco[0].k === 'rect' && deco[0].op == null && deco[0].w >= W && deco[0].h >= H)) return null;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * scale}" height="${H * scale}" viewBox="0 0 ${W} ${H}">`;
  for (const e of deco) {
    const op = e.op != null ? ` opacity="${e.op}"` : '';
    if (e.k === 'rect') svg += `<rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" rx="${e.r || 0}" fill="${e.fill}"${op}/>`;
    else if (e.k === 'circle') svg += `<circle cx="${e.x + e.w / 2}" cy="${e.y + e.h / 2}" r="${e.w / 2 - (e.lw || 0) / 2}" fill="${e.fill === 'none' ? 'none' : e.fill}"${e.line ? ` stroke="${e.line}" stroke-width="${e.lw || 1}"` : ''}${op}/>`;
    else if (e.k === 'path') svg += `<path d="${e.d}" fill="${e.fill}"${op}/>`;
  }
  svg += '</svg>';
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const cv = document.createElement('canvas');
  cv.width = W * scale; cv.height = H * scale;
  cv.getContext('2d').drawImage(img, 0, 0);
  return cv.toDataURL('image/png');
}

const CT = { col: 'bar', bar: 'bar', stack: 'bar', line: 'line', area: 'area', donut: 'doughnut' };
export async function toPPTX(spec, slides, th, onProg = () => { }) {
  const P = await PptxGen();
  const pptx = new P();
  pptx.layout = 'LAYOUT_16x9';
  pptx.title = spec.title;
  pptx.company = spec.org || 'Amatu Paparan';
  const font = th.f.ppt || 'Calibri';
  const C = th.c;
  for (const [i, sl] of slides.entries()) {
    onProg(i / slides.length);
    const s = pptx.addSlide();
    const bg = await decoPng(sl, th, 1.6);
    if (bg) s.background = { data: bg.replace(/^data:/, '') }; else s.background = { color: col(sl.els.find(e => e.deco && e.k === 'rect')?.fill || C.bg).color };
    for (const e of sl.els) {
      if (e.deco) continue;
      const box = { x: IN(e.x), y: IN(e.y), w: IN(e.w), h: IN(e.h) };
      if (e.k === 'rect' || e.k === 'circle') {
        const f = col(e.fill === 'none' ? '#ffffff' : e.fill);
        s.addShape(e.k === 'circle' ? pptx.ShapeType.ellipse : e.r ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, {
          ...box, fill: e.fill === 'none' ? { type: 'none' } : { color: f.color, transparency: Math.max(f.transparency, e.op != null ? Math.round((1 - e.op) * 100) : 0) },
          line: e.line ? { color: col(e.line).color, width: e.lw ? e.lw * 0.75 : 0.75 } : { type: 'none' },
          ...(e.r && e.k === 'rect' ? { rectRadius: IN(Math.min(e.r, Math.min(e.w, e.h) / 2)) } : {}),
        });
      } else if (e.k === 'text') {
        const c2 = col(e.color);
        s.addText(e.upper ? e.text.toUpperCase() : e.text, {
          ...box, margin: 0, fontFace: font, fontSize: PT(e.size), bold: e.weight >= 600, color: c2.color,
          transparency: Math.max(c2.transparency, e.op != null ? Math.round((1 - e.op) * 100) : 0),
          align: e.align === 'c' ? 'center' : e.align === 'r' ? 'right' : 'left', valign: e.va === 'm' ? 'middle' : e.va === 'b' ? 'bottom' : 'top',
          lineSpacingMultiple: +(e.lh / 1.2).toFixed(2), charSpacing: e.ls ? PT(e.ls) : undefined, fit: 'shrink', wrap: true,
        });
      } else if (e.k === 'bullets') {
        const c2 = col(e.color);
        const runs = e.items.map((t, k) => ({
          text: t, options: {
            bullet: e.marker === 'num' ? { type: 'number' } : { code: e.marker === 'check' ? '2714' : e.marker === 'arrow' ? '2192' : e.marker === 'sq' ? '25A0' : '25CF', indent: PT(e.size * e.indent) },
            breakLine: k < e.items.length - 1, paraSpaceAfter: PT(e.gap * e.size),
          },
        }));
        s.addText(runs, { ...box, margin: 0, fontFace: font, fontSize: PT(e.size), color: c2.color, bold: e.weight >= 600, valign: 'top', lineSpacingMultiple: +(e.lh / 1.2).toFixed(2), fit: 'shrink' });
      } else if (e.k === 'chart') {
        addChart(pptx, s, e, th, font, box);
      } else if (e.k === 'table') {
        const rows = [e.head.map((v, j) => ({ text: String(v ?? ''), options: { bold: true, color: col(C.on1).color, fill: { color: col(C.a1).color }, align: e.num[j] ? 'right' : 'left' } }))];
        e.rows.forEach((r, ri) => rows.push(r.map((v, j) => ({ text: String(v ?? ''), options: { color: col(ri === e.hl ? C.title : C.tx).color, bold: ri === e.hl, fill: { color: col(ri % 2 ? C.bg2 : C.bg).color }, align: e.num[j] ? 'right' : 'left' } }))));
        s.addTable(rows, { x: box.x, y: box.y, w: box.w, colW: e.cws.map(IN), rowH: IN(e.rowH), fontFace: font, fontSize: PT(e.size), valign: 'middle', margin: [0, 0.06, 0, 0.06], border: { type: 'solid', pt: 0.5, color: col(C.line).color } });
      }
    }
    if (sl.notes) s.addNotes(sl.notes);
  }
  onProg(1);
  const blob = await pptx.write({ outputType: 'blob' });
  download(blob, safeName(spec.title) + '.pptx');
}

function addChart(pptx, s, e, th, font, box) {
  const ch = e.chart, C = th.c;
  const pal = th.chart.map(c => col(c).color);
  const ser = ch.series.map(x => ({ name: x.name, labels: ch.cats.map(String), values: x.vals.map(v => (v == null ? 0 : +v)) }));
  const many = ch.cats.length > 12;
  const fmt = ch.unit === '%' ? '#,##0.0"%"' : ch.series.some(x => x.vals.some(v => v != null && Math.abs(v % 1) > 0 && Math.abs(v) < 1000)) ? '#,##0.0' : '#,##0';
  const base = {
    ...box, fontFace: font, chartColors: pal,
    catAxisLabelColor: col(C.tx2).color, valAxisLabelColor: col(C.tx2).color, catAxisLabelFontSize: 9, valAxisLabelFontSize: 9, catAxisLabelFontFace: font, valAxisLabelFontFace: font,
    valGridLine: { color: col(C.line).color, size: 0.5 }, catGridLine: { style: 'none' }, valAxisLabelFormatCode: fmt,
    showLegend: ch.series.length > 1 || ch.type === 'combo', legendPos: 't', legendFontSize: 9, legendFontFace: font, legendColor: col(C.tx).color,
    dataLabelFontSize: 8, dataLabelColor: col(C.tx).color, dataLabelFormatCode: fmt, catAxisLineShow: false, valAxisLineShow: false,
  };
  if (ch.type === 'combo' || ch.type === 'pareto') {
    let parts;
    if (ch.type === 'pareto') {
      const v = ser[0].values, tot = v.reduce((a, b) => a + b, 0) || 1;
      let c = 0;
      const cum = v.map(x => +((c += x) / tot * 100).toFixed(1));
      parts = [
        { type: pptx.ChartType.bar, data: [ser[0]], options: { chartColors: [pal[0]], barGapWidthPct: 50, showValue: !many } },
        { type: pptx.ChartType.line, data: [{ name: 'Kumulatif %', labels: ser[0].labels, values: cum }], options: { chartColors: [col(C.a2).color], secondaryValAxis: true, secondaryCatAxis: true, lineDataSymbol: 'circle', lineSize: 2 } },
      ];
      s.addChart(parts, { ...base, valAxes: [{ showValAxisTitle: false }, { showValAxisTitle: false, valAxisMaxVal: 100, valAxisMinVal: 0, valGridLine: { style: 'none' } }], catAxes: [{ catAxisTitle: '' }, { catAxisHidden: true }] });
      return;
    }
    const bars = ch.series.map((x, i) => ({ x, d: ser[i] })).filter(o => o.x.kind !== 'line');
    const lines = ch.series.map((x, i) => ({ x, d: ser[i] })).filter(o => o.x.kind === 'line');
    parts = [];
    if (bars.length) parts.push({ type: pptx.ChartType.bar, data: bars.map(o => o.d), options: { chartColors: bars.map((_, i) => pal[i % pal.length]), barGapWidthPct: 60, showValue: !many && bars.length === 1 } });
    if (lines.length) parts.push({ type: pptx.ChartType.line, data: lines.map(o => o.d), options: { chartColors: lines.map((_, i) => pal[(bars.length + i) % pal.length]), lineDash: 'dash', lineSize: 2, lineDataSymbol: 'none' } });
    s.addChart(parts, base);
    return;
  }
  const type = pptx.ChartType[CT[ch.type] || 'bar'];
  const o = { ...base };
  if (ch.type === 'col' || ch.type === 'stack') { o.barDir = 'col'; o.showValue = !many && ch.series.length <= 2; o.dataLabelPosition = ch.type === 'stack' ? 'ctr' : 'outEnd'; o.barGapWidthPct = 60; }
  if (ch.type === 'bar') { o.barDir = 'bar'; o.showValue = true; o.dataLabelPosition = 'outEnd'; o.barGapWidthPct = 50; o.catAxisOrientation = 'maxMin'; }
  if (ch.type === 'stack') o.barGrouping = 'stacked';
  if (ch.type === 'line' || ch.type === 'area') { o.lineSize = 2.5; o.lineDataSymbol = many ? 'none' : 'circle'; o.lineDataSymbolSize = 6; o.showValue = !many && ch.series.length === 1; o.dataLabelPosition = 't'; }
  if (ch.type === 'donut') { o.holeSize = 58; o.showPercent = true; o.showValue = false; o.showLegend = true; o.legendPos = 'r'; o.dataLabelColor = 'FFFFFF'; o.dataLabelFormatCode = '0%'; }
  s.addChart(type, ser, o);
}

// ---------- PDF (slides as images) ----------
export async function toPDF(spec, slides, th, onProg = () => { }) {
  const [H2I, PDF] = await Promise.all([htmlToImage(), jsPDF()]);
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${W}px;height:${H}px;overflow:hidden;pointer-events:none`;
  document.body.append(host);
  const doc = new PDF({ orientation: 'landscape', unit: 'pt', format: [720, 405], compress: true });
  let fontCSS;
  try {
    for (const [i, sl] of slides.entries()) {
      onProg(i / slides.length);
      host.replaceChildren(renderSlide(sl, th));
      const node = host.firstChild;
      if (fontCSS == null) { try { fontCSS = await H2I.getFontEmbedCSS(node); } catch { fontCSS = ''; } }
      const url = await H2I.toJpeg(node, { pixelRatio: 2, quality: 0.92, width: W, height: H, backgroundColor: th.c.bg, fontEmbedCSS: fontCSS || undefined, cacheBust: false });
      if (i) doc.addPage([720, 405], 'landscape');
      doc.addImage(url, 'JPEG', 0, 0, 720, 405, undefined, 'FAST');
    }
  } finally { host.remove(); }
  onProg(1);
  download(doc.output('blob'), safeName(spec.title) + '.pdf');
}

// ---------- Amatu Slides (same origin: write straight into its IndexedDB, then open it) ----------
const FONT_MAP = { 'Plus Jakarta Sans': 'Inter', Manrope: 'Inter', Barlow: 'Roboto', 'Nunito Sans': 'Nunito', 'DM Serif Display': 'Playfair Display', Lora: 'Lora', 'Source Sans 3': 'Source Sans 3', Poppins: 'Poppins', Inter: 'Inter' };
const escH = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export async function toAmatuSlides(spec, slides, th) {
  const id = uid(12);
  const now = Date.now();
  const theme = {
    id: 'paparan-' + th.id, name: 'Paparan ' + th.name,
    c: { bg: th.c.bg, bg2: th.c.bg2, tx: th.c.tx, tx2: th.c.tx2, title: th.c.title, a1: th.c.a1, a2: th.c.a2, a3: th.chart[2], a4: th.chart[3], a5: th.chart[4], a6: th.chart[5] },
    f: { head: FONT_MAP[th.f.head] || 'Montserrat', body: FONT_MAP[th.f.body] || 'Inter' }, deco: null, bgImg: null,
  };
  const assets = {};
  const out = [];
  // a substitute font can run a little wider: leave some room
  const kz = { head: FONT_MAP[th.f.head] === th.f.head ? 1 : 0.93, body: FONT_MAP[th.f.body] === th.f.body ? 1 : 0.95 };
  for (const sl of slides) {
    const els = [];
    const bg = await decoPng(sl, th, 1.5);
    if (bg) { const k = uid(10); assets[k] = bg; els.push({ id: uid(8), type: 'image', src: 'a:' + k, x: 0, y: 0, w: W, h: H, rot: 0, fit: 'cover', locked: true }); }
    for (const e of sl.els) {
      if (e.deco) continue;
      const b = { id: uid(8), x: e.x, y: e.y, w: e.w, h: e.h, rot: 0 };
      if (e.k === 'rect' || e.k === 'circle') {
        els.push({ ...b, type: 'shape', shape: e.k === 'circle' ? 'ellipse' : e.r ? 'round' : 'rect', adj: e.r ? { r: Math.min(0.5, e.r / Math.min(e.w, e.h)) } : undefined,
          fill: e.fill === 'none' ? null : e.fill, stroke: e.line ? { c: e.line, w: e.lw || 1, dash: 'solid' } : null, html: '', box: { va: 'middle', pad: [0, 0, 0, 0], fit: 'none', cols: 1 }, tcol: '#ffffff', ...(e.op != null ? { opacity: e.op } : {}) });
      } else if (e.k === 'text') {
        const al = e.align === 'c' ? 'center' : e.align === 'r' ? 'right' : null;
        els.push({ ...b, type: 'text', html: String(e.upper ? e.text.toUpperCase() : e.text).split('\n').map(l => `<p>${escH(l) || '<br>'}</p>`).join(''),
          box: { va: e.va === 'm' ? 'middle' : e.va === 'b' ? 'bottom' : 'top', pad: [0, 0, 0, 0], fit: 'shrink', cols: 1 },
          def: { size: +(PT(e.size) * kz[e.font === 'head' ? 'head' : 'body']).toFixed(1), font: e.font === 'head' ? 'head' : 'body', color: e.color, bold: e.weight >= 600, align: al, lh: e.lh }, ...(e.op != null ? { opacity: e.op } : {}) });
      } else if (e.k === 'bullets') {
        const tag = e.marker === 'num' ? 'ol' : 'ul';
        els.push({ ...b, type: 'text', html: `<${tag}>${e.items.map(t => `<li>${escH(t)}</li>`).join('')}</${tag}>`, box: { va: 'top', pad: [0, 0, 0, 0], fit: 'shrink', cols: 1 },
          def: { size: +(PT(e.size) * kz.body).toFixed(1), font: 'body', color: e.color, bold: e.weight >= 600, list: true, lh: e.lh } });
      } else if (e.k === 'chart') {
        const ch = e.chart;
        const type = { col: 'col', bar: 'bar', line: 'line', area: 'area', donut: 'donut', stack: 'stack', combo: 'col', pareto: 'col' }[ch.type] || 'col';
        const data = [['', ...ch.series.map(s => s.name)], ...ch.cats.map((c, k) => [String(c), ...ch.series.map(s => s.vals[k] ?? 0)])];
        els.push({ ...b, type: 'chart', chart: { type, data, colors: th.chart.slice(0, ch.series.length || 1).concat(type === 'donut' ? th.chart.slice(1) : []), title: '', legend: ch.series.length > 1, labels: ch.cats.length <= 12 } });
      } else if (e.k === 'table') {
        const tot = e.cws.reduce((a, x) => a + x, 0);
        els.push({ ...b, type: 'table', rows: [e.head, ...e.rows].map(r => r.map(v => ({ html: escH(v) }))), colW: e.cws.map(x => x / tot), tstyle: { c: th.c.a1, line: th.c.line, head: true, band: true }, def: { size: PT(e.size), font: 'body', color: th.c.tx } });
      }
    }
    out.push({ id: uid(8), layout: 'blank', els, notes: sl.notes || '', bg: null, trans: null, anims: [] });
  }
  const doc = {
    id, title: spec.title, created: now, modified: now, opened: now, starred: false, trashed: 0,
    page: { size: '16:9', w: W, h: H, margin: { t: 1.27, r: 1.27, b: 1.27, l: 1.27 } },
    theme, master: [], slides: out, assets, comments: [],
    hf: { num: false, date: false, dateText: '', footer: '', skipTitle: true }, show: { loop: false, auto: false, laser: '#ff1744', pen: '#ff1744' },
  };
  // same split as Amatu Slides' own store: light listing row (with a cover) + content row
  const s0 = out[0];
  const used = JSON.stringify([s0]);
  const cAssets = {};
  for (const [k, v] of Object.entries(assets)) if (used.includes('a:' + k)) cAssets[k] = v;
  const meta = { id, title: doc.title, created: now, modified: now, opened: now, starred: false, trashed: 0, page: doc.page, count: out.length, locked: false, cover: { slide: s0, theme, page: doc.page, master: [], hf: doc.hf, assets: cAssets } };
  const body = { id, page: doc.page, theme, master: [], slides: out, assets, comments: [], hf: doc.hf, show: doc.show };
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('amatu-slides', 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('meta', { keyPath: 'id' }); d.createObjectStore('docs', { keyPath: 'id' }); d.createObjectStore('versions', { keyPath: 'vid' }).createIndex('doc', 'doc'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  await new Promise((res, rej) => {
    const t = db.transaction(['meta', 'docs'], 'readwrite');
    t.objectStore('meta').put(meta); t.objectStore('docs').put(body);
    t.oncomplete = res; t.onerror = t.onabort = () => rej(t.error);
  });
  db.close();
  try { new BroadcastChannel('aslides').postMessage({ t: 'put', id }); } catch { }
  return '/presentation/#/d/' + id;
}
export { fontFamily };
