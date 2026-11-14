// File → content model {kind, units, blocks, tables, meta}. Everything runs in the browser.
//   blocks: {t: 'h'|'p'|'li'|'tbl'|'note', x: text, u: unit index, lv?, ti?: table index, r?: [[x,y,w,h] 0..1 per line]}
//   tables: {title, head: [..], rows: [[..]], nums?: [[number|null]], u, r?, sheet?, ref?}
import { pdfjs, pdfOpts, ocr } from './libs.js';
import { pageBlocks, furnitureKeys, norm } from './layout.js';
import { extractDocx, extractPptx, extractSheet, extractOdt, extractOdp, extractLegacy } from './office.js';
import { extOf, idle } from './util.js';
import { parseNum, RX } from './numparse.js';

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
export const CONTENT_V = 4;

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
// Turn flat cell fills white (light text on a dark fill dark), erase solid / dotted lines and pattern dots, and
// return the grid lines (column walls) — only for clean digital pictures, never photos.
export function cleanForOcr(cv, o = {}) {
  const W = cv.width, H = cv.height, N = W * H;
  const g = cv.getContext('2d', { willReadFrequently: true });
  const im = g.getImageData(0, 0, W, H), d = im.data;
  const lum = new Uint8Array(N), bin = new Uint16Array(N), hist = new Uint32Array(4096);
  let white = 0, light = 0;
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
    lum[j] = l; if (l > 235) white++; if (l > 165) light++;
    const c = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
    bin[j] = c; hist[c]++;
  }
  // a screenshot is mostly white, or mostly light flat cell fills (green / pink / yellow rows): a few colours cover
  // nearly all of it. A photo has shading and noise: leave it alone.
  const top8 = [...hist].sort((a, b) => b - a).slice(0, 8).reduce((a, b) => a + b, 0);
  if (white < N * 0.45 && !(light > N * 0.8 && top8 > N * 0.85)) return false;
  // flat fills: one colour over a block at least R×R (letter strokes are thinner); a green / orange cell is
  // background whatever its brightness, and light text on a darker fill (white on blue) becomes dark text
  const R = Math.max(12, Math.round(W * 0.006));
  const flat = new Uint8Array(N);
  {
    const wide = new Uint8Array(N);
    for (let y = 0; y < H; y++) {
      const r0 = y * W;
      for (let s = 0, x = 1; x <= W; x++) {
        if (x < W && bin[r0 + x] === bin[r0 + s]) continue;
        if (x - s >= R) wide.fill(1, r0 + s, r0 + x);
        s = x;
      }
    }
    for (let x = 0; x < W; x++) {
      for (let s = 0, y = 1; y <= H; y++) {
        if (y < H && bin[y * W + x] === bin[s * W + x]) continue;
        if (y - s >= R) for (let k = s; k < y; k++) { const j = k * W + x; if (wide[j]) flat[j] = 1; }
        s = y;
      }
    }
  }
  // fill colours: colours with enough flat area somewhere (a small cell full of digits has hardly any flat pixel
  // of its own, but its colour is the same as in its margins)
  const flatN = new Uint32Array(4096), fillBin = new Uint8Array(4096);
  for (let j = 0; j < N; j++) if (flat[j]) flatN[bin[j]]++;
  const minFill = Math.max(150, N * 0.0001);
  const binLum = b => 0.299 * ((b >> 8) * 16 + 8) + 0.587 * (((b >> 4) & 15) * 16 + 8) + 0.114 * ((b & 15) * 16 + 8);
  // neighbouring colours count too: compressed pictures put noise into a flat orange
  for (let b = 0; b < 4096; b++) if (flatN[b] >= minFill && binLum(b) >= 40) {
    const r = b >> 8, gg = (b >> 4) & 15, bb = b & 15;
    for (let dr = -1; dr <= 1; dr++) for (let dg = -1; dg <= 1; dg++) for (let db = -1; db <= 1; db++) {
      const r2 = r + dr, g2 = gg + dg, b2 = bb + db;
      if (r2 < 0 || g2 < 0 || b2 < 0 || r2 > 15 || g2 > 15 || b2 > 15) continue;
      const c = (r2 << 8) | (g2 << 4) | b2;
      if (binLum(c) >= 40) fillBin[c] = 1;
    }
  }
  for (let y = 0; y < H; y++) {
    let bg = 255;
    for (let x = 0, j = y * W; x < W; x++, j++) {
      const L = lum[j];
      if (flat[j]) {
        // black blocks stay as they are (a bold letter looks the same) and are no background for what follows
        if (L >= 40) { bg = L; lum[j] = 255; } else bg = 255;
      } else if (fillBin[bin[j]] && (bg >= 190 || L <= Math.max(bg + 60, 200))) lum[j] = 255;   // fill colour between letters, inside an "a"
      else if (bg < 190 && L > Math.max(bg + 60, 200)) lum[j] = 0;                              // light (white) text on a darker fill
    }
  }
  const LD = o.ld || 165, isD = j => lum[j] < LD;
  const kill = new Uint8Array(N);
  const hMin = Math.max(48, Math.round(W * 0.03)), vMin = Math.max(70, Math.round(H * 0.04));
  const hraw = [], vraw = [];
  // solid lines
  for (let y = 0; y < H; y++) { let run = 0; for (let x = 0; x <= W; x++) { if (x < W && isD(y * W + x)) run++; else { if (run >= hMin) { for (let k = x - run; k < x; k++) kill[y * W + k] = 1; hraw.push({ y, x0: x - run, x1: x - 1 }); } run = 0; } } }
  for (let x = 0; x < W; x++) { let run = 0; for (let y = 0; y <= H; y++) { if (y < H && isD(y * W + x)) run++; else { if (run >= vMin) { for (let k = y - run; k < y; k++) kill[k * W + x] = 1; vraw.push({ x, y0: y - run, y1: y - 1 }); } run = 0; } } }
  // dotted lines and pattern fills: many short dashes with short gaps. Only marks that are thin across the line go:
  // a letter stroke crossing it is taller and stays.
  // dots and gaps grow with the picture's scale (a 4 px dot of a 1600 px screenshot is 8 px here)
  const DASH = Math.max(6, Math.round(W * 0.003)), GAP = Math.max(9, Math.round(W * 0.0042));
  // a dot is about as thick across the line as it is long; a letter stem cut by the scan is much taller
  const across = (j, step, lim) => { let n = 1; for (let k = j - step; k >= 0 && isD(k) && n <= lim; k -= step) n++; for (let k = j + step; k < N && isD(k) && n <= lim; k += step) n++; return n; };
  // A dotted line is regular: its dots and gaps keep the same length (a row of letters does not). The first dots
  // of a run set the pattern; a dot or gap off the pattern closes the run.
  const dotted = (len, at, out, mk, step) => {
    let dashes = [], refL = 0, refG = 0, run = 0;
    const flush = () => {
      const n = dashes.length;
      if (n >= 10 && dashes[n - 1][1] - dashes[0][0] >= hMin * 1.5) {
        for (const [a, b] of dashes) {
          const lim = Math.max(4, Math.ceil((b - a + 1) * 1.6));
          for (let k = a; k <= b; k++) { const j = at(k); if (across(j, step, lim) <= lim) kill[j] = 1; }
        }
        out.push(mk(dashes[0][0], dashes[n - 1][1]));
      }
      dashes = []; refL = refG = 0;
    };
    for (let k = 0; k <= len; k++) {
      const v = k < len && isD(at(k));
      if (v) { run++; continue; }
      if (run > 0) {
        // a short piece of a long crossing line (a row border met by a column scan) is no dot: it ends the run
        if (run <= DASH && across(at(k - 1 - (run >> 1)), step, Math.max(4, Math.ceil(run * 1.6))) <= Math.max(4, Math.ceil(run * 1.6))) {
          const a0 = k - run, n = dashes.length;
          if (n) {
            const gap = a0 - dashes[n - 1][1] - 1;
            if (gap > GAP || (n >= 4 && (Math.abs(run - refL) > Math.max(1, Math.round(refL * 0.3)) || Math.abs(gap - refG) > Math.max(1, Math.round(refG * 0.25))))) flush();
            else if (n === 3) {
              // pattern from the first dots: median length and gap
              const ls = [...dashes.map(d => d[1] - d[0] + 1), run].sort((x, y) => x - y);
              const gs = [dashes[1][0] - dashes[0][1] - 1, dashes[2][0] - dashes[1][1] - 1, gap].sort((x, y) => x - y);
              refL = ls[2]; refG = gs[1];
              // dots of a line sit close together; letters cut by the scan leave longer, uneven gaps
              if (ls[3] - ls[0] > 3 || gs[2] - gs[0] > 2 || refG > 2 * refL + 3) { dashes = dashes.slice(1); refL = refG = 0; }
            }
          }
          dashes.push([a0, k - 1]);
        } else flush();
        run = 0;
      }
    }
    flush();
  };
  for (let y = 0; y < H; y++) dotted(W, x => y * W + x, hraw, (a, b) => ({ y, x0: a, x1: b }), W);
  for (let x = 0; x < W; x++) dotted(H, y => y * W + x, vraw, (a, b) => ({ x, y0: a, y1: b }), 1);
  // neighbouring pixel rows/columns of one line → one separator; a band thicker than a border is a pattern fill
  const maxT = Math.max(8, Math.round(W * 0.004));
  const merge = (raw, pos, a0, a1) => {
    raw.sort((p, q) => p[pos] - q[pos] || p[a0] - q[a0]);
    const out = [];
    // pieces of one border broken where another line crosses it join up again
    const G = Math.max(8, Math.round((pos === 'x' ? H : W) * 0.01));
    for (const v of raw) {
      const m = out.find(l => v[pos] - l.p1 <= 3 && v[pos] >= l.p0 && v[a0] <= l.b + G && v[a1] >= l.a - G);
      if (m) { m.p1 = v[pos]; m.a = Math.min(m.a, v[a0]); m.b = Math.max(m.b, v[a1]); }
      else out.push({ p0: v[pos], p1: v[pos], a: v[a0], b: v[a1] });
    }
    return out.filter(l => l.p1 - l.p0 < maxT);
  };
  const vm = merge(vraw, 'x', 'y0', 'y1'), hm = merge(hraw, 'y', 'x0', 'x1');
  // A grid line continues where it was too short to be found (a narrow "No" column, one header row): follow it
  // out to the outermost crossing lines of its table and erase the thin marks lying on it.
  // Only marks no thicker than the line go (a letter stroke on the same spot is wider and stays).
  const reach = (l, other, span) => {
    const cross = other.filter(o => o.a <= l.p1 + 12 && o.b >= l.p0 - 12 && o.p1 >= l.a - span && o.p0 <= l.b + span);
    return [Math.min(l.a, ...cross.map(o => o.p0)) - 2, Math.max(l.b, ...cross.map(o => o.p1)) + 2];
  };
  for (const l of hm) {
    let [xa, xb] = reach(l, vm, W * 0.2);
    xa = Math.max(0, xa); xb = Math.min(W - 1, xb);
    const lo = Math.max(0, l.p0 - 2), hi = Math.min(H - 1, l.p1 + 2);
    for (let x = xa; x <= xb; x++) for (let y = lo; y <= hi; y++) {
      const j = y * W + x;
      if (kill[j] || !isD(j)) continue;
      let u = y, w = y;
      while (u > 0 && isD((u - 1) * W + x)) u--;
      while (w < H - 1 && isD((w + 1) * W + x)) w++;
      if (u >= lo && w <= hi) for (let k = u; k <= w; k++) kill[k * W + x] = 1;
    }
  }
  for (const l of vm) {
    let [ya, yb] = reach(l, hm, H * 0.2);
    ya = Math.max(0, ya); yb = Math.min(H - 1, yb);
    const lo = Math.max(0, l.p0 - 2), hi = Math.min(W - 1, l.p1 + 2);
    for (let y = ya; y <= yb; y++) for (let x = lo; x <= hi; x++) {
      const j = y * W + x;
      if (kill[j] || !isD(j)) continue;
      let u = x, w = x;
      while (u > 0 && isD(j - (x - u) - 1)) u--;
      while (w < W - 1 && isD(j + (w - x) + 1)) w++;
      if (u >= lo && w <= hi) for (let k = u; k <= w; k++) kill[y * W + k] = 1;
    }
  }
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const v = kill[j] ? 255 : lum[j] > 165 ? 255 : (lum[j] * 0.55) | 0;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  const vlines = vm.map(l => ({ x: (l.p0 + l.p1) / 2, y0: l.a, y1: l.b }));
  const hlines = hm.map(l => ({ y: (l.p0 + l.p1) / 2, x0: l.a, x1: l.b })).sort((p, q) => p.y - q.y);
  return { vlines, hlines };
}

// OCR words of a canvas (+ the grid lines of a cleaned screenshot)
async function readWords(w, cv) {
  const { data } = await w.recognize(cv, {}, { blocks: true, text: true });
  const items = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
    const keep = (l.words || []).filter(wd => {
      const s = (wd.text || '').trim();
      if (!s || wd.confidence < 35) return false;
      if (/^[|\[\]{}_—=~¦!]+$/.test(s)) return false;                                   // table grid lines read as characters
      if (/^[mMnNrRwWEe=~:.\-—_]{2,}$/.test(s) && !/^(mm|Mei|ME)$/.test(s)) return false;   // dotted borders read as "mm", "EE"
      return true;
    });
    if (!keep.length) continue;
    // the line's height from the words kept (a stray grid mark in the same OCR line would make it a whole row tall)
    const t0 = Math.min(...keep.map(wd => wd.bbox.y0)), t1 = Math.max(...keep.map(wd => wd.bbox.y1));
    const lh = Math.max(6, Math.min(l.bbox.y1 - l.bbox.y0, t1 - t0));
    const base = l.baseline && Number.isFinite(l.baseline.y0) && l.baseline.y0 >= t0 && l.baseline.y0 <= t1 + lh * 0.3 ? (l.baseline.y0 + l.baseline.y1) / 2 : t1 - lh * 0.2;
    for (const wd of keep) items.push({ s: wd.text, x: wd.bbox.x0, y: base, w: wd.bbox.x1 - wd.bbox.x0, h: lh, b: false, t0: wd.bbox.y0, t1: wd.bbox.y1 });
  }
  return items;
}
export async function ocrItems(cv, o = {}) {
  const digital = o.clean ? cleanForOcr(cv, o) : false;
  const w = await ocr(o.lang || (digital ? 'eng' : 'ind+eng'));
  try { await w.setParameters({ tessedit_pageseg_mode: String(o.psm || (digital ? 11 : 3)), preserve_interword_spaces: '1' }); } catch { }
  const items = await readWords(w, cv);
  let alt = null;
  // very large figures (a big-font screenshot after upscaling) read worse — "7" becomes "1": read the cleaned
  // picture once more at a size Tesseract likes, mapped back to the same coordinates
  if (digital && !o.noRescale) {
    const hs = items.filter(it => /\d/.test(it.s)).map(it => it.t1 - it.t0).sort((a, b) => a - b);
    const mh = hs.length >= 5 ? hs[hs.length >> 1] : 0;
    if (mh > 60) {
      const f = (o.target || 38) / mh;
      const c2 = document.createElement('canvas');
      c2.width = Math.max(1, Math.round(cv.width * f)); c2.height = Math.max(1, Math.round(cv.height * f));
      const g2 = c2.getContext('2d');
      g2.fillStyle = '#fff'; g2.fillRect(0, 0, c2.width, c2.height);
      g2.drawImage(cv, 0, 0, c2.width, c2.height);
      // as one uniform block (on a big-font table sparse-text mode read "725" as "125")
      try { await w.setParameters({ tessedit_pageseg_mode: '6' }); } catch { }
      const it2 = await readWords(w, c2);
      c2.width = c2.height = 0;
      if (it2.length >= items.length * 0.7) alt = it2.map(it => ({ ...it, x: it.x / f, y: it.y / f, w: it.w / f, h: it.h / f, t0: it.t0 / f, t1: it.t1 / f }));
    }
  }
  return { items, alt, grid: digital || null };
}

// How well a reading agrees with itself: columns whose rows add up to the table's own total row, then the count
// of numbers read. Decides between two readings of the same picture.
function selfCheck(res) {
  let ok = 0, nums = 0;
  const num = s => { const t = String(s || '').trim(); if (!/\d/.test(t)) return null; const p = parseNum(t, 'id') || parseNum(t, 'en'); return p ? p.v : null; };
  for (const t of res.tables) {
    for (let j = 0; j < t.head.length; j++) {
      let sum = 0, n = 0;
      t.rows.forEach((r, i) => {
        if (t.groups?.[i]) { sum = 0; n = 0; return; }
        const v = num(r[j]);
        if (v == null) return;
        nums++;
        if (RX.total.test(String(r[0] || '').trim()) || RX.total.test(String(r[1] || '').trim())) {
          if (n >= 2 && Math.abs(sum - v) <= Math.max(1, Math.abs(v) * 0.005)) ok++;
          sum = 0; n = 0;
        } else { sum += v; n++; }
      });
    }
  }
  return ok * 1000 + nums;
}

export async function ocrCanvas(cv, o = {}) {
  const { items, alt, grid } = await ocrItems(cv, o);
  // measured on spreadsheet screenshots: column walls help, snapping rows to grid lines does not
  const opt = { vlines: o.noWalls || !grid ? [] : grid.vlines, hlines: grid && o.snap ? grid.hlines : [], grid: grid || null, ocr: true };
  const res = pageBlocks(items, cv.width, cv.height, opt);
  if (!alt) return res;
  // two readings: the one whose figures add up to the document's own totals wins
  const res2 = pageBlocks(alt, cv.width, cv.height, opt);
  return selfCheck(res2) > selfCheck(res) ? res2 : res;
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
