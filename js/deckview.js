// "Paparan" tab: generate a presentation from the document, view / edit / present / export it.
import { DB } from './db.js';
import { THEMES, themeById, loadFonts } from './themes.js';
import { composeDeck, composeSlide, W, H } from './compose.js';
import { renderSlide } from './render.js';
import { planDeck, STYLES, LENS } from './plan.js';
import { toPPTX, toPDF, toAmatuSlides } from './export.js';
import { AI } from './ai.js';
import { h, icon, toast, confirmBox, fmtDateTime, debounce } from './util.js';

const PREF = 'paparan.deck';
const pref = () => { try { return JSON.parse(localStorage.getItem(PREF)) || {}; } catch { return {}; } };
const savePref = p => { try { localStorage.setItem(PREF, JSON.stringify({ ...pref(), ...p })); } catch { } };

export class DeckView {
  constructor(host, app) { this.host = host; this.app = app; this.idx = 0; }

  async open(meta, deckId) {
    this.meta = meta;
    this.abort?.abort();
    const decks = (await DB.all('decks')).filter(d => d.doc === meta.id).sort((a, b) => b.created - a.created);
    this.decks = decks;
    if (meta.status !== 'siap') { this.host.replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'spin' }), h('p', null, 'Dokumen masih dipelajari…'))); return; }
    const d = decks.find(x => x.id === deckId) || decks[0];
    if (d) await this.show(d); else this.form();
  }

  // ---------- generator form ----------
  form(prev) {
    const p = { style: 'laporan', len: 'standar', theme: 'korporat', lang: 'id', ...pref(), ...(prev || {}) };
    const dg = this.meta.digest || {};
    if (!prev && !pref().style && /proposal|penawaran/i.test(dg.type || '')) p.style = 'proposal';
    if (!prev && !pref().style && /(materi|modul|pelatihan|training|sop|panduan)/i.test(dg.type || '')) p.style = 'edukasi';
    const chips = (name, opts, cur, set) => h('div', { class: 'chips', role: 'radiogroup', 'aria-label': name }, Object.entries(opts).map(([k, v]) => h('button', { class: 'chip' + (k === cur ? ' on' : ''), role: 'radio', 'aria-checked': String(k === cur), onclick: e => { set(k); [...e.currentTarget.parentNode.children].forEach(b => { b.classList.toggle('on', b === e.currentTarget); b.setAttribute('aria-checked', String(b === e.currentTarget)); }); } }, v)));
    const sw = h('div', { class: 'swatches' }, THEMES.map(t => h('button', { class: 'sw' + (t.id === p.theme ? ' on' : ''), title: t.name, 'aria-label': 'Tema ' + t.name, onclick: e => { p.theme = t.id; sw.querySelectorAll('.sw').forEach(b => b.classList.toggle('on', b === e.currentTarget)); } },
      h('span', { class: 'swp', style: `background:${t.c.bg};border-color:${t.c.line}` }, h('i', { style: `background:${t.c.a1}` }), h('i', { style: `background:${t.chart[1]}` }), h('b', { style: `background:${t.c.title}` })), h('span', { class: 'swn' }, t.name))));
    const note = h('textarea', { class: 'inp', rows: 2, placeholder: 'Opsional, mis. "tekankan pencapaian target dan penyebab downtime", "untuk rapat direksi", "maksimal 3 grafik"' }, p.note || '');
    const go = h('button', { class: 'btn primary lg', onclick: () => { p.note = note.value.trim(); savePref({ style: p.style, len: p.len, theme: p.theme, lang: p.lang }); this.generate(p); } }, icon('spark'), 'Buat Paparan');
    const card = h('div', { class: 'gen' },
      h('div', { class: 'gen-h' }, h('div', { class: 'gen-ic' }, icon('slides')), h('div', null, h('h2', null, 'Paparan presentasi otomatis'), h('p', null, 'AI membaca seluruh isi "' + (dg.title || this.meta.name) + '" lalu menyusun slide yang profesional, to the point, dan terstruktur — lengkap dengan grafik dari data, ringkasan eksekutif, dan catatan pembicara.'))),
      h('div', { class: 'gen-r' }, h('label', null, 'Gaya'), chips('Gaya', Object.fromEntries(Object.entries(STYLES).map(([k, v]) => [k, v.name])), p.style, v => (p.style = v))),
      h('div', { class: 'gen-r' }, h('label', null, 'Panjang'), chips('Panjang', Object.fromEntries(Object.entries(LENS).map(([k, v]) => [k, `${v[2]} · ${v[0]}–${v[1]} slide`])), p.len, v => (p.len = v))),
      h('div', { class: 'gen-r' }, h('label', null, 'Bahasa'), chips('Bahasa', { id: 'Indonesia', en: 'English' }, p.lang, v => (p.lang = v))),
      h('div', { class: 'gen-r' }, h('label', null, 'Tema'), sw),
      h('div', { class: 'gen-r' }, h('label', null, 'Instruksi tambahan'), note),
      h('div', { class: 'gen-f' }, this.decks.length ? h('button', { class: 'btn', onclick: () => this.show(this.decks[0]) }, 'Batal') : null, go),
      AI.ok() ? null : h('div', { class: 'vnote' }, AI.message() + ' Paparan tetap dibuat dengan mesin tanpa AI (judul & poin otomatis dari data).'));
    this.host.replaceChildren(h('div', { class: 'gen-wrap' }, card));
  }

  async generate(p) {
    this.abort = new AbortController();
    const steps = ['Menganalisis data & tabel', 'Menyusun alur cerita', 'Menulis slide', 'Memeriksa angka & menata desain'];
    const bar = h('div', { class: 'pbar' }, h('i'));
    const label = h('div', { class: 'gen-st' }, 'Menyiapkan…');
    const list = h('ol', { class: 'gen-steps' }, steps.map(s => h('li', null, s)));
    const cancel = h('button', { class: 'btn', onclick: () => this.abort.abort() }, 'Batalkan');
    this.host.replaceChildren(h('div', { class: 'gen-wrap' }, h('div', { class: 'gen busy' }, h('div', { class: 'gen-h' }, h('div', { class: 'gen-ic pulse' }, icon('spark')), h('div', null, h('h2', null, 'Membuat paparan…'), label)), bar, list, h('div', { class: 'gen-f' }, cancel))));
    const prog = (v, t) => {
      bar.firstChild.style.width = Math.round(v * 100) + '%';
      if (t) label.textContent = t;
      const k = v < 0.12 ? 0 : v < 0.18 ? 1 : v < 0.88 ? 2 : 3;
      [...list.children].forEach((li, i) => { li.className = i < k ? 'done' : i === k ? 'on' : ''; });
    };
    prog(0.04, 'Menganalisis data & tabel');
    try {
      const th = themeById(p.theme);
      const fonts = loadFonts(th);
      const spec = await planDeck(this.meta.id, p, prog, this.abort.signal);
      await fonts;
      const deck = { id: spec.id, doc: this.meta.id, title: spec.title, created: Date.now(), theme: p.theme, opts: p, spec, source: spec.source };
      await DB.put('decks', deck);
      this.decks.unshift(deck);
      prog(1, 'Selesai');
      this.idx = 0;
      await this.show(deck);
      toast(spec.source === 'ai' ? `Paparan ${spec.slides.length} slide siap` : `Paparan ${spec.slides.length} slide disusun tanpa AI`, 'ok');
    } catch (e) {
      if (e.code === 'batal' || this.abort.signal.aborted) { toast('Dibatalkan'); this.decks.length ? this.show(this.decks[0]) : this.form(p); return; }
      console.error(e);
      toast('Gagal membuat paparan: ' + (e.message || e), 'err', 6000);
      this.form(p);
    }
  }

  // ---------- deck viewer ----------
  async show(deck) {
    this.deck = deck;
    this.th = themeById(deck.theme);
    await loadFonts(this.th);
    this.slides = composeDeck(deck.spec, this.th);
    this.idx = Math.min(this.idx, this.slides.length - 1);
    const sp = deck.spec;
    const sel = h('select', { class: 'inp sm', 'aria-label': 'Versi paparan', onchange: e => { this.idx = 0; this.show(this.decks.find(d => d.id === e.target.value)); } },
      this.decks.map(d => h('option', { value: d.id, selected: d.id === deck.id }, `${fmtDateTime(d.created)} · ${STYLES[d.opts?.style]?.name || ''} · ${d.spec.slides.length} slide`)));
    const themeBtn = h('button', { class: 'btn', onclick: e => this.themeMenu(e.currentTarget) }, icon('palette'), h('span', { class: 'hide-s' }, 'Tema'));
    const dl = h('button', { class: 'btn', onclick: e => this.exportMenu(e.currentTarget) }, icon('download'), h('span', { class: 'hide-s' }, 'Unduh'));
    const bar = h('div', { class: 'dbar' },
      h('div', { class: 'dbar-l' }, sel, h('span', { class: 'badge ' + (sp.source === 'ai' ? 'ai' : '') }, sp.source === 'ai' ? 'Disusun AI' : 'Tanpa AI')),
      h('div', { class: 'dbar-r' },
        h('button', { class: 'btn primary', onclick: () => this.present(this.idx) }, icon('play'), 'Presentasikan'),
        dl, themeBtn,
        h('button', { class: 'btn', title: 'Buka & edit penuh di Amatu Slides', onclick: () => this.toSlides() }, icon('edit'), h('span', { class: 'hide-s' }, 'Edit di Amatu Slides')),
        h('button', { class: 'ib', title: 'Buat paparan baru', 'aria-label': 'Buat paparan baru', onclick: () => this.form(deck.opts) }, icon('plus')),
        h('button', { class: 'ib', title: 'Hapus paparan ini', 'aria-label': 'Hapus paparan ini', onclick: () => this.remove() }, icon('trash'))));
    this.thumbs = h('div', { class: 'thumbs', role: 'listbox', 'aria-label': 'Slide' });
    this.stage = h('div', { class: 'stage' });
    this.notes = h('textarea', { class: 'notes', placeholder: 'Catatan pembicara', 'aria-label': 'Catatan pembicara' });
    this.notes.addEventListener('input', debounce(() => { const s = this.deck.spec.slides[this.idx]; if (s) { s.notes = this.notes.value; this.slides[this.idx].notes = s.notes; this.save(); } }, 500));
    const tools = h('div', { class: 'stools' },
      h('span', { class: 'hint' }, icon('edit'), 'Klik dua kali teks pada slide untuk mengubahnya'),
      h('div', null,
        h('button', { class: 'ib', title: 'Geser ke atas', 'aria-label': 'Geser slide ke atas', onclick: () => this.move(-1) }, icon('up')),
        h('button', { class: 'ib', title: 'Geser ke bawah', 'aria-label': 'Geser slide ke bawah', onclick: () => this.move(1) }, icon('down')),
        h('button', { class: 'ib', title: 'Hapus slide', 'aria-label': 'Hapus slide', onclick: () => this.delSlide() }, icon('trash'))));
    const info = sp.dropped?.length ? h('div', { class: 'vnote' }, `${sp.dropped.length} kalimat berisi angka yang tidak ditemukan di dokumen telah dibuang agar paparan tetap akurat.`) : null;
    const why = sp.source !== 'ai' ? h('div', { class: 'stale' }, icon('spark'), h('span', null, sp.aiErr === 'kuota' ? 'Disusun tanpa AI: kuota AI harian habis (pulih 07.00 WIB).' : sp.aiErr === 'auth' ? 'Disusun tanpa AI: masuk ke Portal AMATU untuk memakai AI.' : 'Disusun tanpa AI karena AI sedang sibuk. Coba lagi untuk judul & narasi yang lebih tajam.'), AI.ok() ? h('button', { class: 'btn sm primary', onclick: () => this.generate({ ...deck.opts }) }, 'Coba lagi dengan AI') : null) : null;
    // the document was read again after this deck was made (e.g. tables inside pictures are now read)
    const stale = this.meta.learned && deck.created < this.meta.learned ? h('div', { class: 'stale' }, icon('refresh'), h('span', null, 'Dokumen sudah dibaca ulang dengan data yang lebih lengkap. Buat ulang paparan agar angka & grafik terbaru ikut tampil.'), h('button', { class: 'btn sm primary', onclick: () => this.generate({ ...deck.opts }) }, 'Buat ulang paparan')) : null;
    this.host.replaceChildren(h('div', { class: 'deck' }, bar, stale || why, h('div', { class: 'deck-b' }, this.thumbs, h('div', { class: 'deck-m' }, this.stage, tools, this.notes, info))));
    this.renderThumbs();
    this.go(this.idx);
    this.ro?.disconnect();
    this.ro = new ResizeObserver(() => this.fitStage());
    this.ro.observe(this.stage);
    this.stage.ondblclick = e => this.edit(e);
    this.host.onkeydown = e => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); this.go(this.idx + 1); }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); this.go(this.idx - 1); }
    };
    this.host.tabIndex = -1;
    this.app.route?.({ deck: deck.id });
  }

  renderThumbs() {
    this.thumbs.replaceChildren(...this.slides.map((sl, i) => {
      const t = h('button', { class: 'th' + (i === this.idx ? ' on' : ''), role: 'option', 'aria-selected': String(i === this.idx), 'aria-label': 'Slide ' + (i + 1), onclick: () => this.go(i) }, h('span', { class: 'thn' }, String(i + 1)));
      const box = h('div', { class: 'thb' });
      const s = renderSlide(sl, this.th);
      s.style.transform = `scale(${150 / W})`; s.style.transformOrigin = '0 0';
      box.append(s);
      t.append(box);
      return t;
    }));
  }
  go(i) {
    if (!this.slides.length) return;
    this.idx = Math.max(0, Math.min(this.slides.length - 1, i));
    const sl = this.slides[this.idx];
    this.cur = renderSlide(sl, this.th, { edit: true });
    this.stage.replaceChildren(this.cur);
    this.fitStage();
    this.notes.value = sl.notes || '';
    [...this.thumbs.children].forEach((t, k) => { t.classList.toggle('on', k === this.idx); t.setAttribute('aria-selected', String(k === this.idx)); });
    this.thumbs.children[this.idx]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  fitStage() {
    if (!this.cur) return;
    const w = this.stage.clientWidth, hh = this.stage.clientHeight || w * H / W;
    const k = Math.min(w / W, hh / H);
    this.k = k;
    this.cur.style.transform = `scale(${k})`;
    this.cur.style.transformOrigin = '0 0';
    this.cur.style.left = ((w - W * k) / 2) + 'px';
    this.cur.style.top = ((hh - H * k) / 2) + 'px';
    this.cur.style.position = 'absolute';
  }
  save = debounce(() => DB.put('decks', this.deck), 400);
  refresh(i) {
    this.slides[i] = composeSlide(this.deck.spec.slides[i], i, this.slides.length, this.deck.spec, this.th);
    if (i === this.idx) this.go(i);
    const t = this.thumbs.children[i]?.querySelector('.thb');
    if (t) { const s = renderSlide(this.slides[i], this.th); s.style.transform = `scale(${150 / W})`; s.style.transformOrigin = '0 0'; t.replaceChildren(s); }
    this.save();
  }

  // ---------- inline edit ----------
  edit(e) {
    const el = e.target.closest('.ed');
    if (!el) return;
    const sl = this.slides[this.idx], s = this.deck.spec.slides[this.idx];
    const k = +el.dataset.k, item = el.dataset.i != null ? +el.dataset.i : null;
    const ce = sl.els[k];
    if (!ce?.bind) return;
    const b = ce.bind;
    const get = () => {
      if (b.f === 'points' || b.f === 'recs') return (s[b.f] || [])[b.i ?? item] ?? '';
      if (b.f === 'kpis' || b.f === 'steps') return s[b.f]?.[b.i]?.[b.p] ?? '';
      if (b.f === 'left' || b.f === 'right') return b.p === 'head' ? s[b.f]?.head ?? '' : (s[b.f]?.points || [])[item] ?? '';
      return s[b.f] ?? (b.f === 'title' ? '' : '');
    };
    const set = v => {
      v = v.trim();
      if (b.f === 'points' || b.f === 'recs') { const a = s[b.f] ||= []; const j = b.i ?? item; if (v) a[j] = v; else a.splice(j, 1); }
      else if (b.f === 'kpis' || b.f === 'steps') { if (s[b.f]?.[b.i]) s[b.f][b.i][b.p] = v; }
      else if (b.f === 'left' || b.f === 'right') { s[b.f] ||= { head: '', points: [] }; if (b.p === 'head') s[b.f].head = v; else { if (v) s[b.f].points[item] = v; else s[b.f].points.splice(item, 1); } }
      else s[b.f] = v;
    };
    const r = el.getBoundingClientRect(), sr = this.stage.getBoundingClientRect();
    const ta = h('textarea', { class: 'edbox', style: `left:${r.left - sr.left - 4}px;top:${r.top - sr.top - 4}px;width:${Math.max(160, r.width + 8)}px;min-height:${r.height + 8}px` });
    ta.value = get();
    this.stage.append(ta);
    ta.focus(); ta.select();
    let done = false;
    const commit = ok => { if (done) return; done = true; if (ok && ta.value !== get()) { set(ta.value); this.refresh(this.idx); } ta.remove(); };
    ta.addEventListener('blur', () => commit(true));
    ta.addEventListener('keydown', ev => { if (ev.key === 'Escape') commit(false); if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); commit(true); } });
  }
  move(d) {
    const i = this.idx, j = i + d, a = this.deck.spec.slides;
    if (j < 1 || j >= a.length - 1 || i === 0 || i === a.length - 1) return toast('Slide sampul dan penutup tetap di tempatnya');
    [a[i], a[j]] = [a[j], a[i]];
    this.slides = composeDeck(this.deck.spec, this.th);
    this.idx = j; this.renderThumbs(); this.go(j); this.save();
  }
  async delSlide() {
    const a = this.deck.spec.slides;
    if (a.length <= 2) return;
    a.splice(this.idx, 1);
    this.slides = composeDeck(this.deck.spec, this.th);
    this.renderThumbs(); this.go(Math.min(this.idx, a.length - 1)); this.save();
    toast('Slide dihapus');
  }
  async remove() {
    if (!(await confirmBox('Hapus paparan?', 'Paparan ini akan dihapus dari perangkat dan akun Anda.'))) return;
    await DB.del('decks', this.deck.id);
    this.decks = this.decks.filter(d => d.id !== this.deck.id);
    this.idx = 0;
    if (this.decks.length) this.show(this.decks[0]); else this.form();
  }
  themeMenu(btn) {
    const m = menu(btn, THEMES.map(t => ({ label: t.name, sw: t, on: t.id === this.deck.theme, run: async () => { this.deck.theme = t.id; this.deck.opts.theme = t.id; savePref({ theme: t.id }); await DB.put('decks', this.deck); this.show(this.deck); } })));
    return m;
  }
  exportMenu(btn) {
    const run = async (f, label) => {
      const t = toast(label + '…', '', 60000);
      try { await f(this.deck.spec, this.slides, this.th); toast('Selesai: ' + label, 'ok'); }
      catch (e) { console.error(e); toast('Gagal: ' + (e.message || e), 'err', 6000); }
      void t;
    };
    menu(btn, [
      { label: 'PowerPoint (.pptx) — bisa diedit', icon: 'slides', run: () => run(toPPTX, 'Membuat PowerPoint') },
      { label: 'PDF', icon: 'pdf', run: () => run(toPDF, 'Membuat PDF') },
    ]);
  }
  async toSlides() {
    try {
      const url = await toAmatuSlides(this.deck.spec, this.slides, this.th);
      const w = window.open(url, 'amatu-presentation');
      if (!w) location.href = url;
      toast('Dibuka di Amatu Slides', 'ok');
    } catch (e) { toast('Gagal membuka di Amatu Slides: ' + (e.message || e), 'err'); }
  }

  // ---------- present ----------
  present(start = 0) {
    let i = start, showNotes = false;
    const ov = h('div', { class: 'present', tabindex: '0', role: 'dialog', 'aria-label': 'Mode presentasi' });
    const box = h('div', { class: 'pbox' });
    const nt = h('div', { class: 'pnotes' });
    const cnt = h('div', { class: 'pcnt' });
    const prog = h('div', { class: 'pprog' }, h('i'));
    const ctl = h('div', { class: 'pctl' },
      h('button', { class: 'ib', 'aria-label': 'Sebelumnya', onclick: e => { e.stopPropagation(); show(i - 1); } }, icon('left')), cnt,
      h('button', { class: 'ib', 'aria-label': 'Berikutnya', onclick: e => { e.stopPropagation(); show(i + 1); } }, icon('right')),
      h('button', { class: 'ib', 'aria-label': 'Catatan pembicara', title: 'Catatan (N)', onclick: e => { e.stopPropagation(); showNotes = !showNotes; nt.classList.toggle('on', showNotes); } }, icon('note')),
      h('button', { class: 'ib', 'aria-label': 'Keluar', title: 'Keluar (Esc)', onclick: e => { e.stopPropagation(); close(); } }, icon('x')));
    ov.append(box, nt, prog, ctl);
    document.body.append(ov);
    const fitP = () => {
      const s = box.firstChild;
      if (!s) return;
      const k = Math.min(innerWidth / W, innerHeight / H);
      s.style.transform = `translate(${(innerWidth - W * k) / 2}px, ${(innerHeight - H * k) / 2}px) scale(${k})`;
    };
    const show = j => {
      i = Math.max(0, Math.min(this.slides.length - 1, j));
      const s = renderSlide(this.slides[i], this.th);
      s.style.transformOrigin = '0 0'; s.style.position = 'absolute'; s.classList.add('pin');
      box.replaceChildren(s);
      fitP();
      cnt.textContent = `${i + 1} / ${this.slides.length}`;
      nt.textContent = this.slides[i].notes || '(tidak ada catatan)';
      prog.firstChild.style.width = ((i + 1) / this.slides.length * 100) + '%';
    };
    const key = e => {
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); show(i + 1); }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); show(i - 1); }
      else if (e.key === 'Home') show(0); else if (e.key === 'End') show(this.slides.length - 1);
      else if (e.key === 'Escape') close();
      else if (e.key === 'n' || e.key === 'N') { showNotes = !showNotes; nt.classList.toggle('on', showNotes); }
    };
    let tx = 0;
    ov.addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
    ov.addEventListener('touchend', e => { const d = e.changedTouches[0].clientX - tx; if (Math.abs(d) > 50) show(i + (d < 0 ? 1 : -1)); }, { passive: true });
    ov.addEventListener('click', e => { if (e.target.closest('.pctl')) return; show(i + (e.clientX > innerWidth / 3 ? 1 : -1)); });
    const close = () => { removeEventListener('keydown', key, true); removeEventListener('resize', fitP); if (document.fullscreenElement) document.exitFullscreen().catch(() => { }); ov.remove(); this.go(i); };
    addEventListener('keydown', key, true);
    addEventListener('resize', fitP);
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && ov.isConnected) fitP(); });
    ov.requestFullscreen?.().catch(() => { });
    show(i);
    ov.focus();
  }
}

export function menu(anchor, items) {
  document.querySelector('.menu')?.remove();
  const r = anchor.getBoundingClientRect();
  const m = h('div', { class: 'menu', role: 'menu' }, items.map(it => h('button', { class: 'mi' + (it.on ? ' on' : ''), role: 'menuitem', onclick: () => { m.remove(); it.run(); } },
    it.sw ? h('span', { class: 'mis', style: `background:linear-gradient(135deg, ${it.sw.c.a1} 50%, ${it.sw.c.bg} 50%)` }) : it.icon ? icon(it.icon) : null, it.label)));
  document.body.append(m);
  const mw = m.offsetWidth, mh = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(innerWidth - mw - 8, r.right - mw)) + 'px';
  m.style.top = (r.bottom + 6 + mh > innerHeight ? Math.max(8, r.top - mh - 6) : r.bottom + 6) + 'px';
  setTimeout(() => addEventListener('pointerdown', function off(e) { if (!m.contains(e.target)) { m.remove(); removeEventListener('pointerdown', off, true); } }, true), 0);
  return m;
}
