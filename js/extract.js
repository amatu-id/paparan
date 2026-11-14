// File → content model {kind, units, blocks, tables, meta}. Everything runs in the browser.
//   blocks: {t: 'h'|'p'|'li'|'tbl'|'note', x: text, u: unit index, lv?, ti?: table index, r?: [[x,y,w,h] 0..1 per line]}
//   tables: {title, head: [..], rows: [[..]], nums?: [[number|null]], u, r?, sheet?, ref?}
import { pdfjs, pdfOpts, ocr } from './libs.js';
import { pageBlocks, furnitureKeys, norm } from './layout.js';
import { extractDocx, extractPptx, extractSheet, extractOdt, extractOdp, extractLegacy } from './office.js';
import { extOf, idle } from './util.js';

export class Doc {
  constructor(kind) { this.kind = kind; this.units = []; this.blocks = []; this.tables = []; this.meta = {}; }
  unit(label, extra = {}) { this.units.push({ label, ...extra }); return this.units.length - 1; }
  add(t, x, u, extra = {}) {
    x = clean(x);
    if (!x) return null;
    const b = { t, x, u, ...extra };
    this.blocks.push(b);
    return b;
  }
  table(tb, u) {
    tb.u = u;
    tb.head = (tb.head || []).map(v => clean(String(v ?? '')));
    tb.rows = (tb.rows || []).map(r => r.map(v => (typeof v === 'number' ? v : clean(String(v ?? '')))));
    if (!tb.rows.length || tb.head.length < 1) return;
    this.tables.push(tb);
    this.blocks.push({ t: 'tbl', x: tb.title || '', u, ti: this.tables.length - 1, ...(tb.r ? { r: [tb.r] } : {}) });
  }
  out() { return { kind: this.kind, units: this.units, blocks: this.blocks, tables: this.tables, meta: this.meta }; }
}
export const clean = s => String(s ?? '').replace(/­/g, '').replace(/[​-‍﻿]/g, '').replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();

export const KINDS = {
  pdf: 'pdf', docx: 'docx', docm: 'docx', dotx: 'docx', doc: 'doc', odt: 'odt', rtf: 'text',
  xlsx: 'sheet', xlsm: 'sheet', xls: 'sheet', xlsb: 'sheet', ods: 'sheet', csv: 'csv', tsv: 'csv',
  pptx: 'pptx', ppsx: 'pptx', potx: 'pptx', pptm: 'pptx', odp: 'odp', ppt: 'doc',
  txt: 'text', md: 'text', markdown: 'text', log: 'text', json: 'text', xml: 'text', html: 'text', htm: 'text',
  jpg: 'image', jpeg: 'image', png: 'image', webp: 'image', bmp: 'image', gif: 'image', tif: 'image', tiff: 'image', heic: 'image', heif: 'image',
};
export const ACCEPT = Object.keys(KINDS).map(e => '.' + e).join(',');
export function kindOf(file) {
  const e = extOf(file.name);
  if (KINDS[e]) return KINDS[e];
  const m = file.type || '';
  if (m === 'application/pdf') return 'pdf';
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('text/')) return 'text';
  return '';
}

export async function extract(file, prog = () => { }) {
  const kind = kindOf(file);
  let c;
  if (kind === 'pdf') c = await extractPdf(file, prog);
  else if (kind === 'docx') c = await extractDocx(file, prog);
  else if (kind === 'pptx') c = await extractPptx(file, prog);
  else if (kind === 'sheet') c = await extractSheet(file, prog);
  else if (kind === 'csv') c = await extractCsv(file, prog);
  else if (kind === 'odt') c = await extractOdt(file, prog);
  else if (kind === 'odp') c = await extractOdp(file, prog);
  else if (kind === 'doc') c = await extractLegacy(file, prog);
  else if (kind === 'image') c = await extractImage(file, prog);
  else if (kind === 'text') c = await extractText(file, prog);
  else throw new Error('Jenis file ini belum didukung');
  c.meta ||= {};
  c.meta.lang = detectLang(c);
  c.v = CONTENT_V;
  return c;
}
// bump when the reader learns something new, so older documents are read again
export const CONTENT_V = 3;

// ---------- language ----------
const IDW = new Set('yang dan di ke dari untuk dengan pada ini itu adalah dalam tidak akan juga atau oleh sebagai bulan tahun telah sudah karena agar serta tersebut maka bahwa dapat lebih jumlah hasil setiap kami kita'.split(' '));
const ENW = new Set('the and of to in for is on with that this by are from as be was were it at an or which has have not will can their its total per'.split(' '));
export function detectLang(c) {
  let i = 0, e = 0;
  for (const b of c.blocks.slice(0, 400)) for (const w of b.x.toLowerCase().split(/[^a-z]+/)) { if (IDW.has(w)) i++; else if (ENW.has(w)) e++; }
  for (const t of c.tables.slice(0, 20)) for (const w of t.head.join(' ').toLowerCase().split(/[^a-z]+/)) { if (IDW.has(w)) i++; else if (ENW.has(w)) e++; }
  return e >= 6 && e > i * 1.3 ? 'en' : 'id';
}

// ---------- PDF ----------
async function extractPdf(file, prog) {
  const lib = await pdfjs();
  const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), ...pdfOpts }).promise;
  const D = new Doc('pdf');
  try {
    const md = await pdf.getMetadata().catch(() => null);
    if (md?.info) { D.meta.title = md.info.Title || ''; D.meta.author = md.info.Author || ''; }
    const pages = [];
    const n = pdf.numPages;
    let scanned = 0, imgs = 0;
    const imgBudget = { n: 0 };
    for (let p = 1; p <= n; p++) {
      prog((p - 1) / n * 0.9, `Membaca halaman ${p} dari ${n}`);
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      let chars = 0;
      for (const it of tc.items) chars += (it.str || '').trim().length;
      let res;
      if (chars < 25) {
        // no text layer: a scan → OCR this page
        scanned++;
        prog((p - 1) / n * 0.9, `Membaca teks hasil scan halaman ${p} dari ${n} (OCR)`);
        res = await ocrPage(page, vp);
      } else {
        const fonts = {};
        let ops = null;
        try { ops = await page.getOperatorList(); } catch { }
        if (ops && p <= 60) {
          for (const it of tc.items) if (it.fontName && !(it.fontName in fonts) && page.commonObjs.has(it.fontName)) {
            const f = page.commonObjs.get(it.fontName);
            fonts[it.fontName] = !!(f && (f.bold || f.black || /bold|black|heavy|semibold|demi/i.test(f.name || '')));
          }
        }
        const items = [];
        for (const it of tc.items) {
          if (!it.str || !it.str.trim()) continue;
          const tx = lib.Util.transform(vp.transform, it.transform);
          const fh = Math.hypot(tx[2], tx[3]) || Math.abs(it.height) || 10;
          if (Math.abs(tx[1]) > Math.abs(tx[0]) * 0.4) continue;          // rotated / vertical text
          items.push({ s: it.str, x: tx[4], y: tx[5], w: Math.abs(it.width) * vp.scale, h: fh, b: fonts[it.fontName] });
        }
        res = pageBlocks(items, vp.width, vp.height);
        // pictures on the page (screenshots of tables, scanned attachments): read them too
        const pics = ops ? imageBoxes(lib, ops, vp).filter(b => b.w * b.h >= 0.03 * vp.width * vp.height && b.w >= 90 && b.h >= 40) : [];
        for (const [k, b] of pics.entries()) {
          if (imgBudget.n >= MAX_IMG) break;
          imgBudget.n++;
          prog((p - 1) / n * 0.9, `Membaca isi gambar ${k + 1} dari ${pics.length} di halaman ${p} (tabel/angka)`);
          try {
            const cv = (b.id && b.upright && await nativeCanvas(page, b.id)) || await regionCanvas(page, b);
            const sub = await ocrCanvas(cv, { clean: true });
            cv.width = cv.height = 0;
            if (sub.blocks.length) { mergeRegion(res, sub, b, vp.width, vp.height); imgs++; }
          } catch (e) { console.warn('ocr picture', e); }
        }
      }
      pages.push({ ...res, w: vp.width, h: vp.height });
      page.cleanup();
      if (p % 4 === 0) await idle();
    }
    const furn = furnitureKeys(pages);
    // heading levels across the whole document (a page without the big title must not promote its sections)
    const hs = [...new Set(pages.flatMap(pg => pg.blocks.filter(b => b.t === 'h' && !b.img && b.rel > 1.12).map(b => b.fs)))].sort((a, b) => b - a);
    pages.forEach((pg, k) => {
      const u = D.unit('Hal. ' + (k + 1), { w: Math.round(pg.w), h: Math.round(pg.h) });
      for (const b of pg.blocks) {
        if (b.t === 'tbl') { const tb = { ...pg.tables[b.ti] }; if (tb.img) D.table(tb, u); else addPdfTable(D, tb, u); continue; }
        if (!b.img && furn.has(norm(b.x))) continue;
        if (/^(halaman|page|hal\.?)?\s*\d+(\s*(dari|of|\/)\s*\d+)?$/i.test(b.x.trim())) continue;   // page numbers
        const lv = b.t === 'h' ? (b.img ? 3 : b.rel > 1.12 ? Math.min(3, hs.indexOf(b.fs) + 1 || 3) : 3) : 0;
        D.add(b.t, b.x, u, { r: b.r, ...(lv ? { lv } : {}) });
      }
    });
    D.meta.pages = n;
    if (scanned) D.meta.ocr = scanned;
    if (imgs) D.meta.imgs = imgs;
  } finally { pdf.destroy(); }
  return D.out();
}

// ---------- pictures inside pages ----------
export const MAX_IMG = 24;          // pictures read with OCR per document (time)
// where images are painted on a page, in viewport units (scale 1)
function imageBoxes(lib, ops, vp) {
  const { OPS, Util } = lib;
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [], out = [];
  const paint = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat, OPS.paintJpegXObject].filter(x => x != null));
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], a = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = Util.transform(ctm, a);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (Array.isArray(a?.[0]) && a[0].length === 6) ctm = Util.transform(ctm, a[0]); }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (paint.has(fn)) {
      const m = Util.transform(vp.transform, ctm);
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(q => Util.applyTransform(q, m));
      const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
      const x = Math.max(0, Math.min(...xs)), y = Math.max(0, Math.min(...ys));
      const w = Math.min(vp.width, Math.max(...xs)) - x, h = Math.min(vp.height, Math.max(...ys)) - y;
      // upright, unflipped placement: the stored picture can be read as it is
      const upright = m[0] > 0 && m[3] < 0 && Math.abs(m[1]) < 1e-6 && Math.abs(m[2]) < 1e-6;
      if (w > 1 && h > 1) out.push({ x, y, w, h, id: typeof a?.[0] === 'string' ? a[0] : null, upright });
    }
  }
  return out.filter((b, i) => !out.slice(0, i).some(o => Math.abs(o.x - b.x) < 2 && Math.abs(o.y - b.y) < 2 && Math.abs(o.w - b.w) < 3));
}
// the picture as stored in the PDF (sharper than re-rendering the page), scaled like a picture file
async function nativeCanvas(page, id) {
  const store = id.startsWith('g_') ? page.commonObjs : page.objs;
  const img = await new Promise(res => {
    const t = setTimeout(() => res(null), 6000);
    try { if (store.has(id)) { clearTimeout(t); res(store.get(id)); } else store.get(id, v => { clearTimeout(t); res(v); }); } catch { clearTimeout(t); res(null); }
  });
  if (!img || !img.width || !img.height || img.width < 300 || img.height < 80) return null;
  let src = img.bitmap || null;
  if (!src && img.data) {
    const n = img.width * img.height, rgba = new Uint8ClampedArray(n * 4), dd = img.data;
    if (dd.length === n * 4) rgba.set(dd);
    else if (dd.length === n * 3) for (let i = 0, j = 0; i < n; i++, j += 3) { rgba[i * 4] = dd[j]; rgba[i * 4 + 1] = dd[j + 1]; rgba[i * 4 + 2] = dd[j + 2]; rgba[i * 4 + 3] = 255; }
    else return null;
    const c0 = document.createElement('canvas');
    c0.width = img.width; c0.height = img.height;
    c0.getContext('2d').putImageData(new ImageData(rgba, img.width, img.height), 0, 0);
    src = c0;
  }
  if (!src) return null;
  const k = Math.min(3, Math.max(1, 3200 / img.width));
  const kk = img.width * img.height * k * k > 14e6 ? Math.sqrt(14e6 / (img.width * img.height)) : k;
  const cv = document.createElement('canvas');
  cv.width = Math.round(img.width * kk); cv.height = Math.round(img.height * kk);
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
  g.drawImage(src, 0, 0, cv.width, cv.height);
  return cv;
}
// one region of a page rendered sharp enough for OCR (≈3200 px wide: small table text reads far better; capped for phones)
async function regionCanvas(page, b) {
  let scale = Math.min(7.5, 3200 / b.w);
  if (b.w * b.h * scale * scale > 14e6) scale = Math.sqrt(14e6 / (b.w * b.h));
  const vp = page.getViewport({ scale, offsetX: -b.x * scale, offsetY: -b.y * scale });
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(b.w * scale)); cv.height = Math.max(1, Math.round(b.h * scale));
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
  await page.render({ canvasContext: g, viewport: vp }).promise;
  return cv;
}
// OCR result of a region → into the page's reading order, rectangles back in page units
function mergeRegion(res, sub, b, W, H) {
  const off = res.tables.length;
  const conv = r => [+((b.x + r[0] * b.w) / W).toFixed(4), +((b.y + r[1] * b.h) / H).toFixed(4), +(r[2] * b.w / W).toFixed(4), +(r[3] * b.h / H).toFixed(4)];
  for (const t of sub.tables) res.tables.push({ ...t, r: t.r ? conv(t.r) : undefined, img: 1 });
  const add = sub.blocks.map(x => ({ ...x, ti: x.t === 'tbl' ? x.ti + off : x.ti, r: x.r ? x.r.map(conv) : undefined, img: 1, fs: undefined, rel: undefined }));
  const top = b.y / H;
  let at = res.blocks.findIndex(x => x.r && x.r[0] && x.r[0][1] > top);
  if (at < 0) at = res.blocks.length;
  res.blocks.splice(at, 0, ...add);
}
// a picture file (Word / PowerPoint media) → blocks + tables
export async function ocrImageBlob(blob, o = {}) {
  let bmp;
  try { bmp = await createImageBitmap(blob); } catch { return null; }
  if (bmp.width < 300 || bmp.height < 100) return null;
  const k = Math.min(3, Math.max(1, 3200 / bmp.width));
  const kk = bmp.width * bmp.height * k * k > 14e6 ? Math.sqrt(14e6 / (bmp.width * bmp.height)) : k;
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * kk); cv.height = Math.round(bmp.height * kk);
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
  g.drawImage(bmp, 0, 0, cv.width, cv.height);
  const r = await ocrCanvas(cv, { clean: true, ...o });
  cv.width = cv.height = 0;
  return r.blocks.length ? r : null;
}

// A table that runs on to the next page continues the previous one: same columns, nothing in between,
// and either the header repeats or the "header" found on the new page is really a data row.
const normHead = h => h.map(x => String(x).toLowerCase().replace(/\s+/g, ' ').trim()).join('|');
function addPdfTable(D, tb, u) {
  const prevB = D.blocks[D.blocks.length - 1];
  const prev = prevB && prevB.t === 'tbl' ? D.tables[prevB.ti] : null;
  if (prev && prev.u === u - 1 && prev.head.length === tb.head.length && !tb.title) {
    const same = normHead(prev.head) === normHead(tb.head);
    const dataHead = tb.head.filter(x => /\d/.test(x)).length >= Math.max(1, tb.head.length / 3) && !/^kolom 1$/i.test(tb.head[0]);
    if (same || dataHead || /^kolom \d+$/i.test(tb.head[0])) {
      const extra = !same && dataHead ? [tb.head.map(String)] : [];
      const before = prev.rows.length;
      prev.rows.push(...extra, ...tb.rows);
      if (prev.groups || tb.groups) prev.groups = [...(prev.groups || Array(before).fill(0)), ...extra.map(() => 0), ...(tb.groups || tb.rows.map(() => 0))];
      (prev.more ||= []).push({ u, r: tb.r });
      prevB.u2 = u;
      return;
    }
  }
  D.table(tb, u);
}

async function ocrPage(page, vp) {
  const scale = Math.min(3, 2200 / Math.max(vp.width, vp.height));
  const v2 = page.getViewport({ scale });
  const cv = document.createElement('canvas');
  cv.width = Math.round(v2.width); cv.height = Math.round(v2.height);
  const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
  await page.render({ canvasContext: g, viewport: v2 }).promise;
  const r = await ocrCanvas(cv);
  cv.width = cv.height = 0;
  return r;
}

// Screenshots of spreadsheets: grid lines and coloured cell fills make OCR glue cells together.
// Erase long solid / dotted lines and turn light fills white before reading (only for clean digital pictures).
export function cleanForOcr(cv, o = {}) {
  const W = cv.width, H = cv.height;
  const g = cv.getContext('2d', { willReadFrequently: true });
  const im = g.getImageData(0, 0, W, H), d = im.data;
  const lum = new Uint8Array(W * H);
  let white = 0;
  for (let i = 0, j = 0; i < d.length; i += 4, j++) { const l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0; lum[j] = l; if (l > 235) white++; }
  if (white < W * H * 0.45) return false;                  // a photo, not a screenshot: leave it alone
  const LD = o.ld || 165, isD = j => lum[j] < LD;
  const kill = new Uint8Array(W * H);
  const hMin = Math.max(48, Math.round(W * 0.03)), vMin = Math.max(70, Math.round(H * 0.04));
  const hraw = [], vraw = [];
  // solid lines
  for (let y = 0; y < H; y++) { let run = 0; for (let x = 0; x <= W; x++) { if (x < W && isD(y * W + x)) run++; else { if (run >= hMin) { for (let k = x - run; k < x; k++) kill[y * W + k] = 1; hraw.push({ y, x0: x - run, x1: x - 1 }); } run = 0; } } }
  for (let x = 0; x < W; x++) { let run = 0; for (let y = 0; y <= H; y++) { if (y < H && isD(y * W + x)) run++; else { if (run >= vMin) { for (let k = y - run; k < y; k++) kill[k * W + x] = 1; vraw.push({ x, y0: y - run, y1: y - 1 }); } run = 0; } } }
  // dotted lines: many short dashes with short gaps
  const dotted = (len, at, out, mk) => {
    let start = -1, last = -1, dashes = 0, run = 0;
    const flush = () => { if (start >= 0 && dashes >= 10 && last - start >= hMin * 1.5) { for (let k = start; k <= last; k++) if (isD(at(k))) kill[at(k)] = 1; out.push(mk(start, last)); } start = -1; dashes = 0; };
    for (let k = 0; k <= len; k++) {
      const v = k < len && isD(at(k));
      if (v) { run++; continue; }
      if (run > 0) {
        if (run <= 6) { const s0 = k - run; if (start >= 0 && s0 - last > 9) flush(); if (start < 0) start = s0; last = k - 1; dashes++; }
        else flush();
        run = 0;
      }
    }
    flush();
  };
  for (let y = 0; y < H; y++) dotted(W, x => y * W + x, hraw, (a, b) => ({ y, x0: a, x1: b }));
  for (let x = 0; x < W; x++) dotted(H, y => y * W + x, vraw, (a, b) => ({ x, y0: a, y1: b }));
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const v = kill[j] ? 255 : lum[j] > 165 ? 255 : (lum[j] * 0.55) | 0;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  // neighbouring pixel rows/columns of one line → one separator
  const merge = (raw, pos, a0, a1) => {
    raw.sort((p, q) => p[pos] - q[pos] || p[a0] - q[a0]);
    const out = [];
    for (const v of raw) {
      const m = out.find(l => v[pos] - l.p1 <= 3 && v[pos] >= l.p0 && v[a0] <= l.b + 8 && v[a1] >= l.a - 8);
      if (m) { m.p1 = v[pos]; m.a = Math.min(m.a, v[a0]); m.b = Math.max(m.b, v[a1]); }
      else out.push({ p0: v[pos], p1: v[pos], a: v[a0], b: v[a1] });
    }
    return out;
  };
  const vlines = merge(vraw, 'x', 'y0', 'y1').map(l => ({ x: (l.p0 + l.p1) / 2, y0: l.a, y1: l.b }));
  const hlines = merge(hraw, 'y', 'x0', 'x1').map(l => ({ y: (l.p0 + l.p1) / 2, x0: l.a, x1: l.b })).sort((p, q) => p.y - q.y);
  return { vlines, hlines };
}

export async function ocrCanvas(cv, o = {}) {
  const w = await ocr();
  const digital = o.clean ? cleanForOcr(cv, o) : false;
  try { await w.setParameters({ tessedit_pageseg_mode: String(o.psm || (digital ? 11 : 3)), preserve_interword_spaces: '1' }); } catch { }
  const vlines = digital ? digital.vlines : [], hlines = digital ? digital.hlines : [];
  const { data } = await w.recognize(cv, {}, { blocks: true, text: true });
  const items = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
    const lh = Math.max(6, l.bbox.y1 - l.bbox.y0);
    const base = l.baseline && Number.isFinite(l.baseline.y0) ? (l.baseline.y0 + l.baseline.y1) / 2 : l.bbox.y1 - lh * 0.2;
    for (const wd of l.words || []) {
      if (!wd.text || wd.confidence < 35) continue;
      if (/^[|\[\]{}_—=~¦!]+$/.test(wd.text.trim())) continue;          // table grid lines read as characters
      if (/^[mMnNrRwWEe=~:.\-—_]{2,}$/.test(wd.text.trim()) && !/^(mm|Mei|ME)$/.test(wd.text.trim())) continue;   // dotted borders read as "mm", "EE"
      items.push({ s: wd.text, x: wd.bbox.x0, y: base, w: wd.bbox.x1 - wd.bbox.x0, h: lh, b: false, t0: wd.bbox.y0, t1: wd.bbox.y1 });
    }
  }
  // measured on spreadsheet screenshots: column walls help, snapping rows to grid lines does not
  return pageBlocks(items, cv.width, cv.height, { vlines: o.noWalls ? [] : vlines, hlines: o.snap ? hlines : [], ocr: true });
}

// ---------- images (OCR) ----------
async function extractImage(file, prog) {
  prog(0.05, 'Membuka gambar');
  let bmp;
  try { bmp = await createImageBitmap(file); }
  catch { throw new Error('Gambar ini tidak bisa dibuka di browser ini (format ' + (extOf(file.name) || file.type) + ')'); }
  const k = Math.min(2.5, 2600 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
  g.drawImage(bmp, 0, 0, cv.width, cv.height);
  prog(0.2, 'Membaca teks di gambar (OCR)');
  const res = await ocrCanvas(cv);
  const D = new Doc('image');
  const u = D.unit('Gambar', { w: bmp.width, h: bmp.height });
  for (const b of res.blocks) {
    if (b.t === 'tbl') D.table({ ...res.tables[b.ti] }, u);
    else D.add(b.t, b.x, u, { r: b.r, ...(b.lv ? { lv: b.lv } : {}) });
  }
  D.meta.ocr = 1;
  cv.width = cv.height = 0;
  return D.out();
}

// ---------- CSV ----------
export function parseCsv(text) {
  const head = text.slice(0, 5000).split(/\r?\n/).slice(0, 8);
  const cand = [',', ';', '\t', '|'];
  let sep = ',', best = -1;
  for (const c of cand) {
    const counts = head.map(l => l.split(c).length - 1).filter(n => n > 0);
    if (!counts.length) continue;
    const same = counts.filter(n => n === counts[0]).length;
    const score = same * 10 + counts[0];
    if (score > best) { best = score; sep = c; }
  }
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"' && !cell) q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(v => v.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some(v => v.trim())) rows.push(row);
  return rows.map(r => r.map(v => v.trim()));
}
async function extractCsv(file, prog) {
  prog(0.2, 'Membaca tabel');
  const text = await readText(file);
  const rows = parseCsv(text);
  const D = new Doc('csv');
  const u = D.unit('Tabel');
  if (rows.length) {
    const W = Math.max(...rows.map(r => r.length));
    const pad = r => { const a = [...r]; while (a.length < W) a.push(''); return a; };
    D.table({ title: file.name.replace(/\.[^.]+$/, ''), head: pad(rows[0]), rows: rows.slice(1, 20001).map(pad) }, u);
  }
  return D.out();
}

// ---------- text, markdown, html, json, xml, rtf ----------
export async function readText(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  const t = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if ((t.match(/�/g) || []).length > t.length * 0.01) return new TextDecoder('windows-1252').decode(buf);
  return t;
}
async function extractText(file, prog) {
  prog(0.2, 'Membaca teks');
  const e = extOf(file.name);
  let text = await readText(file);
  const D = new Doc('text');
  const u = D.unit('Dokumen');
  if (e === 'html' || e === 'htm' || /^\s*<!doctype html|^\s*<html/i.test(text)) { htmlInto(D, new DOMParser().parseFromString(text, 'text/html').body, u); return D.out(); }
  if (e === 'json') {
    try {
      const j = JSON.parse(text);
      const arr = Array.isArray(j) ? j : Object.values(j).find(v => Array.isArray(v) && v.length && typeof v[0] === 'object');
      if (Array.isArray(arr) && arr.length && arr[0] && typeof arr[0] === 'object') {
        const keys = [...new Set(arr.slice(0, 200).flatMap(o => Object.keys(o || {})))].slice(0, 40);
        D.table({ title: 'Data JSON', head: keys, rows: arr.slice(0, 20000).map(o => keys.map(k => { const v = o?.[k]; return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v; })) }, u);
        return D.out();
      }
      text = JSON.stringify(j, null, 2);
    } catch { }
  }
  if (e === 'xml') text = text.replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n');
  if (e === 'rtf' || /^\{\\rtf/.test(text)) text = rtfText(text);
  mdInto(D, text, u);
  return D.out();
}

function rtfText(s) {
  return s.replace(/\\par[d]?/g, '\n').replace(/\{\\\*[^{}]*\}/g, '').replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCharCode(n < 0 ? 65536 + +n : +n)).replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '');
}

// Markdown / plain text: #-headings, lists, |tables|, tab-separated tables, paragraphs
export function mdInto(D, text, u) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let para = [];
  const flush = () => { if (para.length) { D.add('p', para.join(' '), u); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], s = l.trim();
    if (!s) { flush(); continue; }
    let m;
    if ((m = /^(#{1,6})\s+(.+)$/.exec(s))) { flush(); D.add('h', m[2].replace(/#+$/, ''), u, { lv: Math.min(3, m[1].length) }); continue; }
    if (/^\|.*\|$/.test(s) && lines[i + 1] && /^\|?\s*:?-{2,}/.test(lines[i + 1].trim())) {
      flush();
      const row = x => x.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = row(s), rows = [];
      i += 2;
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) rows.push(row(lines[i++]));
      i--;
      D.table({ title: '', head, rows }, u);
      continue;
    }
    if (l.includes('\t') && lines[i + 1]?.includes('\t') && lines[i + 2]?.includes('\t')) {
      flush();
      const rows = [];
      while (i < lines.length && lines[i].includes('\t')) rows.push(lines[i++].split('\t').map(c => c.trim()));
      i--;
      const W = Math.max(...rows.map(r => r.length));
      const pad = r => { while (r.length < W) r.push(''); return r; };
      D.table({ title: '', head: pad(rows[0]), rows: rows.slice(1).map(pad) }, u);
      continue;
    }
    if ((m = /^([-*+•]|\d{1,3}[.)])\s+(.+)$/.exec(s))) { flush(); D.add('li', m[2], u); continue; }
    if (s.length < 90 && s === s.toUpperCase() && /[A-Z]{3}/.test(s) && !/[.,;]$/.test(s)) { flush(); D.add('h', s, u, { lv: 2 }); continue; }
    para.push(s);
  }
  flush();
}

export function htmlInto(D, root, u) {
  const walk = el => {
    for (const n of el.children) {
      const tag = n.tagName.toLowerCase();
      if (/^(script|style|noscript|svg|nav|footer|header|form|button|iframe)$/.test(tag)) continue;
      if (/^h[1-6]$/.test(tag)) D.add('h', n.textContent, u, { lv: Math.min(3, +tag[1]) });
      else if (tag === 'p' || tag === 'blockquote' || tag === 'pre') D.add('p', n.textContent, u);
      else if (tag === 'li') D.add('li', n.textContent, u);
      else if (tag === 'table') {
        const rows = [...n.querySelectorAll('tr')].map(tr => [...tr.children].flatMap(td => Array(Math.min(20, +td.getAttribute('colspan') || 1)).fill(td.textContent.trim())));
        if (rows.length) {
          const W = Math.max(...rows.map(r => r.length));
          const pad = r => { while (r.length < W) r.push(''); return r; };
          D.table({ title: n.querySelector('caption')?.textContent || '', head: pad(rows[0]), rows: rows.slice(1).map(pad) }, u);
        }
      } else if (n.children.length) walk(n);
      else if (n.textContent.trim()) D.add('p', n.textContent, u);
    }
  };
  walk(root);
}
