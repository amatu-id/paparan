// Word, PowerPoint, Excel / ODF and legacy binary Office files → content model.
import { JSZip, XLSX } from './libs.js';
import { Doc, clean, readText, ocrImageBlob, MAX_IMG } from './extract.js';
import { idle } from './util.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const xml = s => new DOMParser().parseFromString(s, 'application/xml');
const kids = (el, ns, name) => [...el.childNodes].filter(n => n.nodeType === 1 && n.localName === name && (!ns || n.namespaceURI === ns));
const kid = (el, ns, name) => kids(el, ns, name)[0] || null;
const desc = (el, ns, name) => [...el.getElementsByTagNameNS(ns, name)];
const att = (el, ns, name) => el && (el.getAttributeNS(ns, name) || el.getAttribute('w:' + name) || el.getAttribute(name));

async function zipOf(file) {
  const Z = await JSZip();
  return Z.loadAsync(await file.arrayBuffer());
}
async function coreMeta(zip, D) {
  const f = zip.file('docProps/core.xml');
  if (!f) return;
  const d = xml(await f.async('string'));
  const g = n => d.getElementsByTagNameNS('*', n)[0]?.textContent || '';
  D.meta.title = g('title'); D.meta.author = g('creator'); D.meta.created = g('created');
}
function rels(doc) {
  const m = {};
  for (const r of doc.getElementsByTagName('Relationship')) m[r.getAttribute('Id')] = { t: r.getAttribute('Target'), type: r.getAttribute('Type') };
  return m;
}
const joinPath = (base, t) => {
  if (t.startsWith('/')) return t.slice(1);
  const parts = base.split('/'); parts.pop();
  for (const p of t.split('/')) { if (p === '..') parts.pop(); else if (p !== '.') parts.push(p); }
  return parts.join('/');
};

// pictures inside Word / PowerPoint files: screenshots of tables are read with OCR
const IMG_TYPE = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' };
async function ocrZipImage(zip, path, budget) {
  const ext = path.split('.').pop().toLowerCase();
  if (!IMG_TYPE[ext] || budget.n >= MAX_IMG || budget.done.has(path)) return null;
  const f = zip.file(path);
  if (!f) return null;
  budget.n++; budget.done.add(path);
  const buf = await f.async('arraybuffer');
  if (buf.byteLength < 6000) return null;                       // icons, bullets, logos
  const res = await ocrImageBlob(new Blob([buf], { type: IMG_TYPE[ext] }));
  if (!res) return null;
  const letters = res.blocks.reduce((a, b) => a + (b.x || '').replace(/[^a-z0-9]/gi, '').length, 0);
  return res.tables.length || letters >= 25 ? res : null;      // a photo without text adds nothing
}
function addOcr(D, res, u) {
  for (const b of res.blocks) {
    if (b.t === 'tbl') D.table({ ...res.tables[b.ti], img: 1 }, u);
    else D.add(b.t, b.x, u, b.t === 'h' ? { lv: 3 } : {});
  }
}

// ---------- DOCX ----------
export async function extractDocx(file, prog) {
  prog(0.1, 'Membuka dokumen Word');
  const zip = await zipOf(file);
  const D = new Doc('docx');
  await coreMeta(zip, D);
  const docF = zip.file('word/document.xml');
  if (!docF) throw new Error('File Word ini rusak (document.xml tidak ada)');
  const styles = {};
  const sf = zip.file('word/styles.xml');
  if (sf) {
    const sd = xml(await sf.async('string'));
    for (const s of desc(sd, W, 'style')) {
      const id = att(s, W, 'styleId'), name = (att(kid(s, W, 'name'), W, 'val') || '').toLowerCase();
      const ol = kid(kid(s, W, 'pPr') || s, W, 'outlineLvl');
      let lv = 0;
      const m = /(?:heading|judul)\s*(\d)/.exec(name);
      if (m) lv = +m[1];
      else if (name === 'title' || name === 'judul') lv = 1;
      else if (ol) lv = +att(ol, W, 'val') + 1;
      styles[id] = { lv: lv && lv <= 9 ? lv : 0, list: /list|daftar|bullet/.test(name), name };
    }
  }
  prog(0.3, 'Membaca isi dokumen');
  const relF = zip.file('word/_rels/document.xml.rels');
  const drel = relF ? rels(xml(await relF.async('string'))) : {};
  const budget = { n: 0, done: new Set() };
  const doc = xml(await docF.async('string'));
  const body = desc(doc, W, 'body')[0];
  let page = 0;
  const units = [D.unit('Hal. 1')];
  const unitAt = () => { while (units.length <= page) units.push(D.unit('Hal. ' + (units.length + 1))); return units[page]; };
  const runText = p => {
    let s = '', boldChars = 0, chars = 0;
    for (const n of p.getElementsByTagNameNS(W, '*')) {
      const ln = n.localName;
      if (ln === 't') {
        s += n.textContent;
        const rPr = kid(n.parentNode, W, 'rPr');
        const b = rPr && kid(rPr, W, 'b');
        chars += n.textContent.length;
        if (b && att(b, W, 'val') !== '0' && att(b, W, 'val') !== 'false') boldChars += n.textContent.length;
      } else if (ln === 'tab') s += '\t';
      else if (ln === 'br' || ln === 'cr') { if (att(n, W, 'type') === 'page') page++; else s += '\n'; }
      else if (ln === 'lastRenderedPageBreak') page++;
    }
    return { s, bold: chars ? boldChars / chars : 0 };
  };
  const cellText = tc => kids(tc, W, 'p').map(p => runText(p).s).join('\n').trim();
  const table = tbl => {
    const grid = [];
    const vm = [];
    for (const tr of kids(tbl, W, 'tr')) {
      const row = [];
      let col = 0;
      for (const tc of kids(tr, W, 'tc')) {
        const pr = kid(tc, W, 'tcPr');
        const span = +(att(kid(pr || tc, W, 'gridSpan'), W, 'val') || 1);
        const vmEl = pr && kid(pr, W, 'vMerge');
        let t = cellText(tc);
        if (vmEl && att(vmEl, W, 'val') !== 'restart' && !t) t = vm[col] ?? '';
        if (vmEl) vm[col] = t; else vm[col] = undefined;
        for (let k = 0; k < Math.min(span, 30); k++) row.push(k ? '' : t);
        col += span;
      }
      if (row.some(v => v)) grid.push(row);
    }
    if (!grid.length) return null;
    const Wd = Math.max(...grid.map(r => r.length));
    for (const r of grid) while (r.length < Wd) r.push('');
    // header: the rows marked as repeating headers, else the first row
    return { head: grid[0], rows: grid.slice(1) };
  };
  const pictures = async (n, u) => {
    const ids = [...desc(n, A, 'blip').map(b => b.getAttributeNS(R, 'embed')), ...[...n.getElementsByTagNameNS('urn:schemas-microsoft-com:vml', 'imagedata')].map(v => v.getAttributeNS(R, 'id'))].filter(Boolean);
    for (const id of ids) {
      const t = drel[id]?.t;
      if (!t) continue;
      prog(0.4, 'Membaca isi gambar di dokumen (tabel/angka)');
      const res = await ocrZipImage(zip, joinPath('word/document.xml', t), budget).catch(() => null);
      if (res) { addOcr(D, res, u); D.meta.imgs = (D.meta.imgs || 0) + 1; }
    }
  };
  const walk = async el => {
    for (const n of el.childNodes) {
      if (n.nodeType !== 1) continue;
      const ln = n.localName;
      if (ln === 'p') {
        const { s, bold } = runText(n);
        const u = unitAt();
        await pictures(n, u);
        const pPr = kid(n, W, 'pPr');
        const sid = pPr && att(kid(pPr, W, 'pStyle'), W, 'val');
        const st = styles[sid] || {};
        const ol = pPr && kid(pPr, W, 'outlineLvl');
        const lv = st.lv || (ol ? +att(ol, W, 'val') + 1 : 0);
        const text = s.replace(/\t+/g, ' ').trim();
        if (!text) continue;
        if (lv && lv <= 6 && text.length < 200) D.add('h', text, u, { lv: Math.min(3, lv) });
        else if ((pPr && kid(pPr, W, 'numPr')) || st.list) D.add('li', text, u);
        else if (bold > 0.85 && text.length < 100 && !/[.:;,]$/.test(text)) D.add('h', text, u, { lv: 3 });
        else D.add('p', text, u);
      } else if (ln === 'tbl') {
        const t = table(n);
        if (!t) continue;
        const prev = D.blocks[D.blocks.length - 1];
        const title = prev && (/^(tabel|table)\b/i.test(prev.x) || prev.t === 'h') && prev.x.length < 150 ? prev.x : '';
        if (t.rows.length === 0 || (t.head.length === 1 && t.rows.every(r => r.length === 1))) {
          for (const r of [t.head, ...t.rows]) D.add('p', r.join(' '), unitAt());     // a one-cell layout table is just text
        } else D.table({ title, head: t.head, rows: t.rows }, unitAt());
      } else if (ln === 'sdt' || ln === 'sdtContent' || ln === 'customXml' || ln === 'smartTag' || ln === 'ins') await walk(n);
    }
  };
  await walk(body);
  D.meta.pages = units.length;
  if (units.length === 1) D.units[0].label = 'Dokumen';
  return D.out();
}

// ---------- PPTX ----------
export async function extractPptx(file, prog) {
  prog(0.1, 'Membuka presentasi');
  const zip = await zipOf(file);
  const D = new Doc('pptx');
  await coreMeta(zip, D);
  const presF = zip.file('ppt/presentation.xml');
  if (!presF) throw new Error('File PowerPoint ini rusak');
  const pres = xml(await presF.async('string'));
  const prel = rels(xml(await zip.file('ppt/_rels/presentation.xml.rels').async('string')));
  const ids = desc(pres, P, 'sldId').map(s => s.getAttributeNS(R, 'id'));
  const budget = { n: 0, done: new Set() };
  const paths = ids.map(id => prel[id] && joinPath('ppt/presentation.xml', prel[id].t)).filter(Boolean);
  for (const [k, path] of paths.entries()) {
    prog(0.1 + 0.85 * k / paths.length, `Membaca slide ${k + 1} dari ${paths.length}`);
    const f = zip.file(path);
    if (!f) continue;
    const u = D.unit('Slide ' + (k + 1));
    const sd = xml(await f.async('string'));
    const relF = zip.file(path.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels'));
    const srel = relF ? rels(xml(await relF.async('string'))) : {};
    const tree = desc(sd, P, 'spTree')[0];
    if (!tree) continue;
    const shapes = [];
    const visit = el => {
      for (const n of el.childNodes) {
        if (n.nodeType !== 1) continue;
        if (n.localName === 'grpSp') { visit(n); continue; }
        if (n.localName === 'sp') shapes.push({ el: n, kind: 'sp' });
        else if (n.localName === 'graphicFrame') shapes.push({ el: n, kind: 'gf' });
        else if (n.localName === 'pic') shapes.push({ el: n, kind: 'pic' });
      }
    };
    visit(tree);
    const off = s => { const o = s.el.getElementsByTagNameNS(A, 'off')[0]; return o ? [+o.getAttribute('y'), +o.getAttribute('x')] : [0, 0]; };
    shapes.sort((a, b) => { const [ay, ax] = off(a), [by, bx] = off(b); return ay - by || ax - bx; });
    const ph = s => { const p = s.el.getElementsByTagNameNS(P, 'ph')[0]; return p ? p.getAttribute('type') || 'body' : ''; };
    shapes.sort((a, b) => (/title/i.test(ph(b)) ? 1 : 0) - (/title/i.test(ph(a)) ? 1 : 0));
    for (const s of shapes) {
      if (s.kind === 'pic') {
        const id = desc(s.el, A, 'blip')[0]?.getAttributeNS(R, 'embed');
        const t = id && srel[id]?.t;
        if (t) {
          prog(0.1 + 0.85 * k / paths.length, `Membaca isi gambar di slide ${k + 1} (tabel/angka)`);
          const res = await ocrZipImage(zip, joinPath(path, t), budget).catch(() => null);
          if (res) { addOcr(D, res, u); D.meta.imgs = (D.meta.imgs || 0) + 1; }
        }
        continue;
      }
      if (s.kind === 'sp') {
        const type = ph(s);
        const paras = desc(s.el, A, 'p').map(p => ({ t: desc(p, A, 't').map(t => t.textContent).join(''), lvl: +(kid(p, A, 'pPr')?.getAttribute('lvl') || 0) })).filter(p => p.t.trim());
        if (!paras.length) continue;
        if (type === 'subTitle') D.add('p', paras.map(p => p.t).join(' '), u);
        else if (/title/i.test(type)) D.add('h', paras.map(p => p.t).join(' '), u, { lv: type === 'ctrTitle' ? 1 : 2 });
        else for (const p of paras) D.add(paras.length > 1 || type === 'body' ? 'li' : 'p', p.t, u, p.lvl ? { lvl: p.lvl } : {});
      } else {
        const tbl = s.el.getElementsByTagNameNS(A, 'tbl')[0];
        if (tbl) {
          const grid = kids(tbl, A, 'tr').map(tr => kids(tr, A, 'tc').flatMap(tc => {
            const t = desc(tc, A, 't').map(x => x.textContent).join(' ').trim();
            const span = +(tc.getAttribute('gridSpan') || 1);
            return Array(Math.min(span, 20)).fill('').map((_, i) => (i ? '' : t));
          }));
          if (grid.length >= 2) { const Wd = Math.max(...grid.map(r => r.length)); grid.forEach(r => { while (r.length < Wd) r.push(''); }); D.table({ title: '', head: grid[0], rows: grid.slice(1) }, u); }
          continue;
        }
        const ch = s.el.getElementsByTagNameNS(C, 'chart')[0];
        if (ch) {
          const rid = ch.getAttributeNS(R, 'id');
          const cp = srel[rid] && joinPath(path, srel[rid].t);
          const cf = cp && zip.file(cp);
          if (cf) { const t = chartTable(xml(await cf.async('string'))); if (t) D.table(t, u); }
        }
      }
    }
    // speaker notes
    const nrel = Object.values(srel).find(r => /notesSlide/.test(r.type));
    if (nrel) {
      const nf = zip.file(joinPath(path, nrel.t));
      if (nf) {
        const nd = xml(await nf.async('string'));
        const sps = desc(nd, P, 'sp').filter(sp => (sp.getElementsByTagNameNS(P, 'ph')[0]?.getAttribute('type') || 'body') === 'body');
        const txt = sps.flatMap(sp => desc(sp, A, 'p').map(p => desc(p, A, 't').map(t => t.textContent).join(''))).filter(t => t.trim()).join('\n');
        if (txt.trim()) D.add('note', txt, u);
      }
    }
    if (k % 5 === 4) await idle();
  }
  D.meta.pages = paths.length;
  return D.out();
}

// chart XML cache → table (categories × series)
function chartTable(cd) {
  const title = desc(cd, C, 'title')[0];
  const tt = title ? desc(title, A, 't').map(t => t.textContent).join('') : '';
  const sers = desc(cd, C, 'ser');
  if (!sers.length) return null;
  const pts = el => { const o = []; if (!el) return o; for (const p of desc(el, C, 'pt')) o[+p.getAttribute('idx')] = desc(p, C, 'v')[0]?.textContent ?? ''; return o; };
  const cats = pts(kid(sers[0], C, 'cat'));
  const series = sers.map((s, i) => ({ name: desc(kid(s, C, 'tx') || s, C, 'v')[0]?.textContent || desc(kid(s, C, 'tx') || s, A, 't')[0]?.textContent || 'Seri ' + (i + 1), v: pts(kid(s, C, 'val')) }));
  const n = Math.max(cats.length, ...series.map(s => s.v.length));
  if (!n) return null;
  const rows = [];
  for (let i = 0; i < n; i++) rows.push([cats[i] ?? String(i + 1), ...series.map(s => s.v[i] ?? '')]);
  return { title: tt || 'Data grafik', head: ['Kategori', ...series.map(s => s.name)], rows, nums: rows.map(r => r.map((v, j) => (j && v !== '' && Number.isFinite(+v) ? +v : null))) };
}

// ---------- Excel / ODS (SheetJS) ----------
export async function extractSheet(file, prog) {
  prog(0.1, 'Membuka spreadsheet');
  const X = await XLSX();
  const wb = X.read(await file.arrayBuffer(), { cellDates: true, cellNF: true, cellText: true, dense: true });
  const D = new Doc('sheet');
  D.meta.title = wb.Props?.Title || ''; D.meta.author = wb.Props?.Author || '';
  const names = wb.SheetNames;
  for (const [k, name] of names.entries()) {
    prog(0.1 + 0.85 * k / names.length, `Membaca sheet ${name}`);
    const ws = wb.Sheets[name];
    const hidden = wb.Workbook?.Sheets?.[k]?.Hidden;
    const u = D.unit('Sheet ' + name, { sheet: name, hidden: !!hidden });
    if (!ws['!ref']) continue;
    const rg = X.utils.decode_range(ws['!ref']);
    const R0 = rg.s.r, R1 = Math.min(rg.e.r, R0 + 20000), C0 = rg.s.c, C1 = Math.min(rg.e.c, C0 + 80);
    const data = ws['!data'] || [];
    const cell = (r, c) => data[r]?.[c];
    // grid of {w: display text, v: raw}
    const grid = [];
    for (let r = R0; r <= R1; r++) {
      const row = [];
      for (let c = C0; c <= C1; c++) {
        const x = cell(r, c);
        if (!x || x.v == null || x.v === '') { row.push(null); continue; }
        let w = x.w != null ? String(x.w) : x.v instanceof Date ? x.v.toISOString().slice(0, 10) : String(x.v);
        let v = x.t === 'n' ? x.v : x.t === 'd' ? x.v : x.t === 'b' ? (x.v ? 'Ya' : 'Tidak') : String(x.v);
        if (x.t === 'n' && /%/.test(x.z || '')) v = x.v * 100;     // 0.963 shown as 96,3% → 96.3
        if (x.t === 'e') { w = ''; v = null; }
        row.push({ w: w.trim(), v });
      }
      grid.push(row);
    }
    // merged cells: header spans fill to the right, label spans fill down
    for (const m of ws['!merges'] || []) {
      const r0 = m.s.r - R0, c0 = m.s.c - C0;
      if (r0 < 0 || c0 < 0 || r0 >= grid.length) continue;
      const src = grid[r0][c0];
      if (!src) continue;
      for (let r = m.s.r - R0; r <= Math.min(m.e.r - R0, grid.length - 1); r++) for (let c = m.s.c - C0; c <= Math.min(m.e.c - C0, C1 - C0); c++) {
        if (r === r0 && c === c0) continue;
        if (!grid[r][c]) grid[r][c] = { ...src, merged: 1 };
      }
    }
    sheetRegions(D, grid, u, name, X, R0, C0);
    if (k % 2) await idle();
  }
  D.meta.pages = names.length;
  return D.out();
}

function sheetRegions(D, grid, u, sheet, X, R0, C0) {
  const filled = r => (r || []).filter(Boolean).length;
  let r = 0, carry = '', carryEnd = -9;
  const H = grid.length;
  while (r < H) {
    while (r < H && !filled(grid[r])) r++;
    if (r >= H) break;
    let e = r;
    while (e < H && filled(grid[e])) e++;
    const rows = grid.slice(r, e);
    const r0 = r;
    r = e;
    // leading one-cell rows are titles / notes
    let k = 0;
    const titles = [];
    while (k < rows.length && filled(rows[k]) === 1) { titles.push(rows[k].find(Boolean).w); k++; }
    const body = rows.slice(k);
    if (body.length < 2) {
      for (const t of titles) D.add(titles.length === 1 && t.length < 90 ? 'h' : 'p', t, u, { lv: 2 });
      for (const row of body) D.add('p', row.filter(Boolean).map(c => c.w).join(' · '), u);
      if (!body.length && titles.length) { carry = titles[titles.length - 1]; carryEnd = e; }   // a title row above the next table
      continue;
    }
    let carried = false;
    if (!titles.length && carry && r0 - carryEnd <= 2) { titles.push(carry); carried = true; }
    carry = '';
    if (!carried) for (const t of titles) D.add(t.length < 100 ? 'h' : 'p', t, u, { lv: 2 });
    // columns actually used
    const used = [];
    const Wd = Math.max(...body.map(rr => rr.length));
    for (let c = 0; c < Wd; c++) if (body.some(rr => rr[c])) used.push(c);
    const isText = c => c && typeof c.v === 'string' && !/^[-–]$/.test(c.v);
    // header rows: text-only rows at the top (max 3), followed by rows with numbers
    let nh = 1;
    while (nh < Math.min(3, body.length - 1) && used.every(c => !body[nh][c] || isText(body[nh][c])) && body.slice(nh + 1).some(rr => used.some(c => rr[c] && typeof rr[c].v === 'number'))) nh++;
    if (!used.some(c => body.slice(nh).some(rr => rr[c] && typeof rr[c].v === 'number'))) nh = 1;
    const head = used.map(c => {
      const parts = [];
      for (let h = 0; h < nh; h++) { const x = body[h][c]; if (x && x.w && parts[parts.length - 1] !== x.w) parts.push(x.w); }
      return parts.join(' ') || X.utils.encode_col(C0 + c);
    });
    const data = body.slice(nh).filter(rr => used.some(c => rr[c] && !rr[c].merged) || used.some(c => rr[c]));
    if (!data.length) continue;
    const title = titles.length ? titles[titles.length - 1] : sheet;
    const ref = X.utils.encode_range({ s: { r: R0 + r0, c: C0 + used[0] }, e: { r: R0 + e - 1, c: C0 + used[used.length - 1] } });
    D.table({
      title, sheet, ref, head,
      rows: data.map(rr => used.map(c => (rr[c] ? rr[c].w : ''))),
      nums: data.map(rr => used.map(c => (rr[c] && typeof rr[c].v === 'number' ? rr[c].v : null))),
    }, u);
  }
}

// ---------- ODT / ODP ----------
const TX = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
const TB = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const DR = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0';
export async function extractOdt(file, prog) {
  prog(0.2, 'Membuka dokumen ODT');
  const zip = await zipOf(file);
  const cf = zip.file('content.xml');
  if (!cf) throw new Error('File ODT ini rusak');
  const d = xml(await cf.async('string'));
  const D = new Doc('docx');
  const u = D.unit('Dokumen');
  const walk = el => {
    for (const n of el.childNodes) {
      if (n.nodeType !== 1) continue;
      if (n.namespaceURI === TX && n.localName === 'h') D.add('h', n.textContent, u, { lv: Math.min(3, +(n.getAttributeNS(TX, 'outline-level') || 1)) });
      else if (n.namespaceURI === TX && n.localName === 'p') D.add('p', n.textContent, u);
      else if (n.namespaceURI === TX && n.localName === 'list-item') D.add('li', n.textContent, u);
      else if (n.namespaceURI === TB && n.localName === 'table') {
        const rows = [...n.getElementsByTagNameNS(TB, 'table-row')].map(tr => [...tr.getElementsByTagNameNS(TB, 'table-cell')].map(tc => tc.textContent.trim()));
        if (rows.length > 1) { const Wd = Math.max(...rows.map(x => x.length)); rows.forEach(x => { while (x.length < Wd) x.push(''); }); D.table({ title: '', head: rows[0], rows: rows.slice(1) }, u); }
      } else walk(n);
    }
  };
  walk(d.documentElement);
  return D.out();
}
export async function extractOdp(file, prog) {
  prog(0.2, 'Membuka presentasi ODP');
  const zip = await zipOf(file);
  const d = xml(await zip.file('content.xml').async('string'));
  const D = new Doc('pptx');
  [...d.getElementsByTagNameNS(DR, 'page')].forEach((pg, k) => {
    const u = D.unit('Slide ' + (k + 1));
    const frames = [...pg.getElementsByTagNameNS(DR, 'frame')];
    frames.forEach((f, i) => {
      const ps = [...f.getElementsByTagNameNS(TX, 'p')].map(p => p.textContent).filter(t => t.trim());
      if (!ps.length) return;
      if (i === 0 || /title/i.test(f.getAttributeNS('urn:oasis:names:tc:opendocument:xmlns:presentation:1.0', 'class') || '')) D.add('h', ps.join(' '), u, { lv: 2 });
      else ps.forEach(p => D.add('li', p, u));
    });
  });
  return D.out();
}

// ---------- legacy .doc / .ppt: best effort text from the binary ----------
export async function extractLegacy(file, prog) {
  prog(0.2, 'Membaca file lama (best effort)');
  const buf = new Uint8Array(await file.arrayBuffer());
  const runs16 = [], runs8 = [];
  let cur = '';
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const c = buf[i] | (buf[i + 1] << 8);
    if ((c >= 32 && c < 0x2000) || c === 13 || c === 10 || c === 9) cur += String.fromCharCode(c);
    else { if (cur.length >= 8) runs16.push(cur); cur = ''; }
  }
  if (cur.length >= 8) runs16.push(cur);
  cur = '';
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if ((c >= 32 && c < 127) || c === 13 || c === 10 || c === 9 || (c >= 160)) cur += String.fromCharCode(c);
    else { if (cur.length >= 8) runs8.push(cur); cur = ''; }
  }
  const score = runs => runs.join('').replace(/[^a-zA-Z ]/g, '').length;
  let runs = score(runs16) > score(runs8) * 0.8 ? runs16 : runs8;
  runs = runs.filter(s => (s.match(/[a-zA-Z]/g) || []).length > s.length * 0.55 && !/^[\w.$-]+$/.test(s.trim()));
  const D = new Doc('docx');
  const u = D.unit('Dokumen');
  for (const r of runs) for (const p of r.split(/\r|\n/)) if (p.trim().length > 2) D.add('p', p, u);
  D.meta.legacy = 1;
  if (!D.blocks.length) throw new Error('Isi file lama ini tidak terbaca. Simpan ulang sebagai .docx/.pptx lalu unggah lagi.');
  return D.out();
}
