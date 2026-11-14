// Document viewers: the original file (PDF pages, Word layout, Excel grid, image) or the text the app learned.
// focus({u, b:[from,to], ti, rows}) scrolls to a source and highlights it.
import { pdfjs, pdfOpts, docxPreview, XLSX } from './libs.js';
import { DB } from './db.js';
import { h, esc, icon, debounce } from './util.js';
import { tokens } from './search.js';

export class Viewer {
  constructor(host) {
    this.host = host;
    this.mode = 'asli';
  }
  destroy() { this.io?.disconnect(); this.pdf?.destroy?.(); this.pdf = null; this.host.replaceChildren(); this.url && URL.revokeObjectURL(this.url); }

  async open(meta, content, mode) {
    this.destroy();
    this.meta = meta; this.content = content;
    const rec = await DB.get('files', meta.id);
    this.blob = rec?.blob || null;
    this.mode = mode || (this.blob ? 'asli' : 'teks');
    const bar = h('div', { class: 'vbar' });
    this.body = h('div', { class: 'vbody', tabindex: '0' });
    this.host.append(bar, this.body);
    const seg = h('div', { class: 'seg' },
      h('button', { class: this.mode === 'asli' ? 'on' : '', disabled: !this.blob, title: this.blob ? '' : 'File asli tidak ada di perangkat ini (terlalu besar untuk disinkronkan)', onclick: () => this.open(meta, content, 'asli') }, 'Tampilan asli'),
      h('button', { class: this.mode === 'teks' ? 'on' : '', onclick: () => this.open(meta, content, 'teks') }, 'Teks terbaca'));
    const find = h('input', { type: 'search', class: 'vfind', placeholder: 'Cari di dokumen', 'aria-label': 'Cari di dokumen' });
    this.count = h('span', { class: 'vcount' });
    find.addEventListener('input', debounce(() => this.find(find.value), 250));
    find.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.next(); } });
    this.zoomBox = h('div', { class: 'vzoom' });
    bar.append(seg, h('div', { class: 'vfindw' }, icon('search'), find, this.count), this.zoomBox);
    try {
      if (this.mode === 'teks' || !this.blob) this.renderText();
      else if (meta.kind === 'pdf') await this.renderPdf();
      else if (meta.kind === 'docx' && /docx|docm|dotx/.test(meta.ext)) await this.renderDocx();
      else if (meta.kind === 'sheet' || meta.kind === 'csv') await this.renderSheet();
      else if (meta.kind === 'image') this.renderImage();
      else if (meta.kind === 'pptx') this.renderSlides();
      else this.renderText();
    } catch (e) {
      console.warn(e);
      this.body.replaceChildren(h('div', { class: 'vnote' }, 'Tampilan asli gagal dimuat (' + (e.message || e) + '). Menampilkan teks terbaca.'));
      this.renderText(true);
    }
  }

  // ---------- PDF ----------
  async renderPdf() {
    const lib = await pdfjs();
    this.pdf = await lib.getDocument({ data: new Uint8Array(await this.blob.arrayBuffer()), ...pdfOpts }).promise;
    const n = this.pdf.numPages;
    this.zoom = 1;
    const pages = [];
    const wrap = h('div', { class: 'pdfw' });
    this.body.append(wrap);
    for (let p = 1; p <= n; p++) {
      const u = this.content.units[p - 1] || {};
      const ratio = (u.h || 842) / (u.w || 595);
      const pg = h('div', { class: 'pg', dataset: { p } }, h('div', { class: 'pgn' }, String(p)));
      pg.style.setProperty('--r', ratio);
      wrap.append(pg);
      pages.push(pg);
    }
    this.pages = pages;
    const draw = async pg => {
      if (pg.dataset.done === String(this.zoom)) return;
      pg.dataset.done = String(this.zoom);
      const page = await this.pdf.getPage(+pg.dataset.p);
      const w = pg.clientWidth, vp0 = page.getViewport({ scale: 1 });
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const vp = page.getViewport({ scale: w / vp0.width * dpr });
      const cv = document.createElement('canvas');
      cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      pg.querySelector('canvas')?.remove();
      pg.prepend(cv);
      page.cleanup();
    };
    this.io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && draw(e.target).catch(() => { })), { root: this.body, rootMargin: '600px 0px' });
    pages.forEach(p => this.io.observe(p));
    const z = k => { this.zoom = Math.max(0.5, Math.min(3, k)); wrap.style.setProperty('--z', this.zoom); pages.forEach(p => { if (p.getBoundingClientRect().bottom > -800 && p.getBoundingClientRect().top < innerHeight + 800) draw(p).catch(() => { }); }); };
    this.zoomBox.append(h('button', { class: 'ib', 'aria-label': 'Perkecil', onclick: () => z(this.zoom - 0.2) }, icon('minus')), h('button', { class: 'ib', 'aria-label': 'Perbesar', onclick: () => z(this.zoom + 0.2) }, icon('plus')));
  }

  // ---------- Word ----------
  async renderDocx() {
    const D = await docxPreview();
    const box = h('div', { class: 'docxw' });
    this.body.append(box);
    await D.renderAsync(this.blob, box, null, { inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: false, experimental: true, renderHeaders: true, renderFooters: true, useBase64URL: true });
    this.fitDocx = () => {
      const sec = box.querySelector('section.docx');
      if (!sec) return;
      const k = Math.min(1, (this.body.clientWidth - 24) / sec.offsetWidth);
      box.style.setProperty('--k', k);
      box.querySelector('.docx-wrapper').style.zoom = k;
    };
    this.fitDocx();
    new ResizeObserver(() => this.fitDocx()).observe(this.body);
  }

  // ---------- Excel / CSV ----------
  async renderSheet() {
    const X = await XLSX();
    let wb;
    if (this.meta.kind === 'csv') {
      const { parseCsv, readText } = await import('./extract.js');
      const rows = parseCsv(await readText(this.blob));
      wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(rows), 'Data');
    } else wb = X.read(await this.blob.arrayBuffer(), { cellStyles: false, cellDates: true });
    const tabs = h('div', { class: 'stabs' });
    const grid = h('div', { class: 'sgrid' });
    this.body.append(grid, tabs);
    this.wb = wb;
    const show = (name, focusRef) => {
      [...tabs.children].forEach(b => b.classList.toggle('on', b.dataset.n === name));
      const ws = wb.Sheets[name];
      if (!ws || !ws['!ref']) { grid.replaceChildren(h('div', { class: 'vnote' }, 'Sheet kosong')); return; }
      const rg = X.utils.decode_range(ws['!ref']);
      const full = ws['!ref'];
      const lim = { s: rg.s, e: { r: Math.min(rg.e.r, rg.s.r + 1500), c: Math.min(rg.e.c, rg.s.c + 60) } };
      ws['!ref'] = X.utils.encode_range(lim);
      const html = X.utils.sheet_to_html(ws, { id: 'sjs', editable: false, header: '', footer: '' });
      ws['!ref'] = full;
      grid.innerHTML = html;
      const t = grid.querySelector('table');
      if (t) {
        // column letters + row numbers like a spreadsheet
        const cols = lim.e.c - lim.s.c + 1;
        const hr = document.createElement('tr');
        hr.className = 'hd';
        hr.innerHTML = '<th></th>' + Array.from({ length: cols }, (_, k) => `<th>${X.utils.encode_col(lim.s.c + k)}</th>`).join('');
        t.tBodies[0]?.prepend(hr);
        [...t.querySelectorAll('tr:not(.hd)')].forEach((tr, k) => { const th = document.createElement('th'); th.textContent = lim.s.r + k + 1; tr.prepend(th); });
      }
      if (rg.e.r > lim.e.r) grid.append(h('div', { class: 'vnote' }, `Menampilkan ${lim.e.r - lim.s.r + 1} baris pertama dari ${rg.e.r - rg.s.r + 1}.`));
      this.sheetName = name;
      if (focusRef) this.markRange(focusRef);
    };
    this.showSheet = show;
    for (const n of wb.SheetNames) tabs.append(h('button', { dataset: { n }, onclick: () => show(n) }, n));
    show(wb.SheetNames[0]);
  }
  markRange(ref) {
    const X = window.XLSX;
    this.body.querySelectorAll('.mark').forEach(x => x.classList.remove('mark'));
    try {
      const rg = X.utils.decode_range(ref);
      let first = null;
      for (let r = rg.s.r; r <= Math.min(rg.e.r, rg.s.r + 400); r++) for (let c = rg.s.c; c <= rg.e.c; c++) {
        const el = this.body.querySelector('#sjs-' + X.utils.encode_cell({ r, c }));
        if (el) { el.classList.add('mark'); first ||= el; }
      }
      first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch { }
  }

  // ---------- image ----------
  renderImage() {
    this.url = URL.createObjectURL(this.blob);
    const u = this.content.units[0] || {};
    const pg = h('div', { class: 'pg img', dataset: { p: 1 } }, h('img', { src: this.url, alt: this.meta.name }));
    pg.style.setProperty('--r', (u.h || 1) / (u.w || 1));
    this.pages = [pg];
    this.body.append(h('div', { class: 'pdfw' }, pg));
  }

  // ---------- slides (outline) ----------
  renderSlides() {
    const c = this.content;
    const wrap = h('div', { class: 'slides-v' });
    c.units.forEach((u, k) => {
      const card = h('div', { class: 'sv', dataset: { u: k } }, h('div', { class: 'svn' }, u.label));
      c.blocks.forEach((b, i) => { if (b.u === k) card.append(blockEl(b, i, c)); });
      wrap.append(card);
    });
    this.body.append(wrap);
  }

  // ---------- learned text ----------
  renderText(append) {
    const c = this.content;
    const wrap = h('div', { class: 'tv' });
    let lastU = -1;
    c.blocks.forEach((b, i) => {
      if (b.u !== lastU && c.units.length > 1) { wrap.append(h('div', { class: 'tvu', dataset: { u: b.u } }, c.units[b.u]?.label || '')); lastU = b.u; }
      wrap.append(blockEl(b, i, c));
    });
    if (!c.blocks.length) wrap.append(h('div', { class: 'vnote' }, 'Tidak ada teks.'));
    if (this.meta.ocr) wrap.prepend(h('div', { class: 'vnote' }, `Teks ${this.meta.kind === 'image' ? 'gambar' : this.meta.ocr + ' halaman hasil scan'} dibaca dengan OCR, mungkin ada salah baca.`));
    if (this.meta.legacy) wrap.prepend(h('div', { class: 'vnote' }, 'Format lama (.doc/.ppt) dibaca seadanya. Untuk hasil terbaik, simpan sebagai .docx/.pptx lalu unggah ulang.'));
    if (!append) this.body.replaceChildren();
    this.body.append(wrap);
    this.mode = 'teks';
  }

  // ---------- focus a source ----------
  async focus(f) {
    if (!f) return;
    this.body.querySelectorAll('.hl,.mark').forEach(x => (x.classList.contains('hl') ? x.remove() : x.classList.remove('mark')));
    const c = this.content;
    const [b0, b1] = f.b || [-1, -1];
    if (this.mode === 'asli' && this.pages && (this.meta.kind === 'pdf' || this.meta.kind === 'image')) {
      const blocks = [];
      for (let i = b0; i <= b1 && i >= 0; i++) if (c.blocks[i]) blocks.push(c.blocks[i]);
      let first = null;
      const rectsOf = b => {
        const out = (b.r || []).map(r => [b.u, r]);
        if (b.t === 'tbl') for (const m of c.tables[b.ti]?.more || []) if (m.r) out.push([m.u, m.r]);
        return out;
      };
      for (const b of blocks) {
        for (const [u, r] of rectsOf(b)) {
          const pg = this.pages[u];
          if (!pg) continue;
          const el = h('div', { class: 'hl', style: `left:${r[0] * 100}%;top:${r[1] * 100}%;width:${r[2] * 100}%;height:${r[3] * 100}%` });
          pg.append(el);
          first ||= el;
        }
      }
      const tgt = first || this.pages[f.u];
      tgt?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    if (this.mode === 'asli' && this.showSheet && f.ti != null) {
      const t = c.tables[f.ti];
      if (t?.sheet && t.ref) {
        let ref = t.ref;
        if (f.rows && window.XLSX) {
          const rg = window.XLSX.utils.decode_range(t.ref);
          const hdr = (rg.e.r - rg.s.r + 1) - t.rows.length;
          ref = window.XLSX.utils.encode_range({ s: { r: rg.s.r + hdr + f.rows[0], c: rg.s.c }, e: { r: rg.s.r + hdr + f.rows[1], c: rg.e.c } });
        }
        if (this.sheetName !== t.sheet) this.showSheet(t.sheet, ref); else this.markRange(ref);
        return;
      }
    }
    if (this.mode === 'asli' && this.meta.kind === 'docx' && this.body.querySelector('.docx-wrapper')) {
      const b = c.blocks[b0];
      const el = b && findText(this.body.querySelector('.docx-wrapper'), b.t === 'tbl' ? (c.tables[b.ti]?.rows[f.rows?.[0] || 0] || []).join(' ') : b.x);
      if (el) { el.classList.add('mark'); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    }
    if (this.mode === 'asli' && this.meta.kind === 'pptx') {
      const card = this.body.querySelector(`.sv[data-u="${f.u}"]`);
      if (card) { card.classList.add('mark'); card.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    }
    if (this.mode !== 'teks') { this.renderText(); }
    let first = null;
    for (let i = b0; i <= b1 && i >= 0; i++) { const el = this.body.querySelector(`[data-b="${i}"]`); if (el) { el.classList.add('mark'); first ||= el; } }
    first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // ---------- search ----------
  find(q) {
    this.body.querySelectorAll('.hl.f,.mark.f').forEach(x => (x.classList.contains('hl') ? x.remove() : x.classList.remove('mark', 'f')));
    this.hits = []; this.hi = -1;
    q = q.trim();
    if (q.length < 2) { this.count.textContent = ''; return; }
    const ql = q.toLowerCase();
    const qt = new Set(tokens(q));
    const c = this.content;
    const match = s => { const l = String(s).toLowerCase(); if (l.includes(ql)) return true; const t = tokens(s); return qt.size > 1 && [...qt].every(w => t.includes(w)); };
    if (this.mode === 'asli' && this.pages && (this.meta.kind === 'pdf' || this.meta.kind === 'image')) {
      c.blocks.forEach((b, i) => {
        if (b.t === 'tbl' || !b.r || !match(b.x)) return;
        const pg = this.pages[b.u];
        if (!pg) return;
        let first = null;
        for (const r of b.r) { const el = h('div', { class: 'hl f', style: `left:${r[0] * 100}%;top:${r[1] * 100}%;width:${r[2] * 100}%;height:${r[3] * 100}%` }); pg.append(el); first ||= el; }
        this.hits.push(first);
      });
      c.tables.forEach(t => { if (t.r && [t.title, ...t.head, ...t.rows.flat()].some(v => match(v ?? ''))) { const pg = this.pages[t.u]; if (pg) { const el = h('div', { class: 'hl f', style: `left:${t.r[0] * 100}%;top:${t.r[1] * 100}%;width:${t.r[2] * 100}%;height:${t.r[3] * 100}%` }); pg.append(el); this.hits.push(el); } } });
    } else {
      const root = this.body.querySelector('.docx-wrapper, .sgrid, .tv, .slides-v') || this.body;
      const els = root.querySelectorAll('p, li, td, th, h3, h4, .tvh, span');
      for (const el of els) {
        if (el.children.length > 3 || !match(el.textContent)) continue;
        if (this.hits.some(x => x.contains(el) || el.contains(x))) continue;
        el.classList.add('mark', 'f');
        this.hits.push(el);
        if (this.hits.length > 400) break;
      }
    }
    this.hits.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    this.count.textContent = this.hits.length ? `${this.hits.length} hasil` : 'tidak ada';
    this.next();
  }
  next() {
    if (!this.hits?.length) return;
    this.hi = (this.hi + 1) % this.hits.length;
    this.hits[this.hi].scrollIntoView({ block: 'center', behavior: 'smooth' });
    this.count.textContent = `${this.hi + 1}/${this.hits.length}`;
  }
}

function blockEl(b, i, c) {
  if (b.t === 'h') return h(b.lv === 1 ? 'h3' : 'h4', { class: 'tvh', dataset: { b: i } }, b.x);
  if (b.t === 'li') return h('div', { class: 'tvli', dataset: { b: i } }, b.x);
  if (b.t === 'note') return h('div', { class: 'tvnote', dataset: { b: i } }, 'Catatan: ' + b.x);
  if (b.t === 'tbl') {
    const t = c.tables[b.ti];
    const rows = t.rows.slice(0, 300);
    return h('div', { class: 'tvt', dataset: { b: i } },
      t.title ? h('div', { class: 'tvtt' }, t.title) : null,
      h('div', { class: 'tw', html: '<table><thead><tr>' + t.head.map(x => `<th>${esc(x)}</th>`).join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(v => `<td>${esc(v)}</td>`).join('') + '</tr>').join('') + '</tbody></table>' + (t.rows.length > 300 ? `<div class="vnote">… ${t.rows.length - 300} baris lagi</div>` : '') }));
  }
  return h('p', { dataset: { b: i } }, b.x);
}

function findText(root, text) {
  if (!root || !text) return null;
  const want = tokens(text).slice(0, 12);
  if (!want.length) return null;
  let best = null, bs = 0;
  for (const el of root.querySelectorAll('p, td, li, h1, h2, h3, h4, h5, h6')) {
    if (el.querySelector('p, td')) continue;
    const t = new Set(tokens(el.textContent));
    let s = 0;
    for (const w of want) if (t.has(w)) s++;
    if (s > bs) { bs = s; best = el; }
  }
  return bs >= Math.min(3, want.length) ? best : null;
}
