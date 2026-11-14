// Amatu Paparan — app shell: library, upload, document tabs (Lihat / Ringkasan / Paparan), Q&A panel.
import { DB } from './db.js';
import { ACCEPT, kindOf } from './extract.js';
import { learn, deepen, loadDoc, facts, forget, device, lockName, reread, CONTENT_V } from './learn.js';
import { ask } from './qa.js';
import { md } from './md.js';
import { Viewer } from './viewer.js';
import { DeckView } from './deckview.js';
import { AI } from './ai.js';
import { chartSVG } from './charts.js';
import { themeById } from './themes.js';
import { tableBrief, short } from './analyze.js';
import { $, h, icon, toast, confirmBox, fmtBytes, ago, debounce, download, fmtDate } from './util.js';

const S = { docs: [], cur: null, tab: 'lihat', prog: {}, scope: 'doc', busy: 0, chat: null, sending: null };
const KIND = { pdf: ['PDF', 'pdf'], docx: ['Word', 'word'], doc: ['Dokumen', 'word'], sheet: ['Excel', 'sheet'], csv: ['CSV', 'sheet'], pptx: ['PowerPoint', 'ppt'], odp: ['Presentasi', 'ppt'], odt: ['Dokumen', 'word'], image: ['Gambar', 'image'], text: ['Teks', 'text'] };
const mq = matchMedia('(max-width: 899px)');
const mobile = () => mq.matches;
const app = $('#app');
let viewer, deck;

// ---------- shell ----------
function shell() {
  const file = h('input', { type: 'file', multiple: true, accept: ACCEPT, hidden: true, onchange: e => { upload([...e.target.files]); e.target.value = ''; } });
  S.pick = () => file.click();
  const search = h('input', { type: 'search', class: 'lsearch', placeholder: 'Cari dokumen', 'aria-label': 'Cari dokumen', oninput: debounce(() => renderLib(), 150) });
  S.search = search;
  app.replaceChildren(
    h('header', { class: 'top' },
      h('button', { class: 'ib back', 'aria-label': 'Kembali ke daftar dokumen', onclick: () => go(null) }, icon('back')),
      h('a', { class: 'brand', href: '#/', onclick: e => { e.preventDefault(); go(null); } }, h('span', { class: 'logo' }, icon('logo')), h('span', { class: 'bname' }, 'Paparan')),
      h('div', { class: 'tdoc' }),
      h('div', { class: 'tsp' }),
      S.aiChip = h('button', { class: 'aichip', onclick: () => toast(aiText(), '', 6000) }),
      h('button', { class: 'btn primary', onclick: () => S.pick() }, icon('upload'), h('span', { class: 'hide-s' }, 'Unggah')),
      h('button', { class: 'ib chat-tg', 'aria-label': 'Tampilkan/sembunyikan tanya jawab', title: 'Tanya jawab', onclick: () => { document.body.classList.toggle('nochat'); savePrefs(); } }, icon('chat')),
      file),
    h('aside', { class: 'lib', 'aria-label': 'Dokumen' },
      h('div', { class: 'lib-h' }, h('div', { class: 'lib-t' }, 'Dokumen'), h('span', { class: 'lib-n' })),
      h('div', { class: 'lsw' }, icon('search'), search),
      h('div', { class: 'list', role: 'list' }),
      h('div', { class: 'lib-f' }, h('button', { class: 'drop', onclick: () => S.pick() }, icon('upload'), h('b', null, 'Unggah dokumen'), h('span', null, 'PDF, Word, Excel, PowerPoint, gambar, teks')))),
    h('main', { class: 'main' }),
    h('aside', { class: 'chat', 'aria-label': 'Tanya jawab' }),
    h('nav', { class: 'mnav', 'aria-label': 'Navigasi' }),
    h('div', { class: 'dz', 'aria-hidden': 'true' }, h('div', null, icon('upload'), h('b', null, 'Lepaskan file untuk dipelajari'))));
  try { const p = JSON.parse(localStorage.getItem('paparan.prefs')) || {}; if (p.nochat) document.body.classList.add('nochat'); } catch { }
}
const savePrefs = () => { try { localStorage.setItem('paparan.prefs', JSON.stringify({ nochat: document.body.classList.contains('nochat') })); } catch { } };
function aiText() {
  if (!AI.ok()) return AI.message();
  const t = window.AMATU?.sess?.()?.t;
  if (!t && !/[?&]edge=/.test(location.search)) return 'Masuk ke Portal AMATU untuk memakai AI. Tanpa AI, tanya jawab & paparan memakai mesin otomatis.';
  return 'AI aktif (Gemma 4 di Cloudflare Workers AI). Kuota gratis harian dipakai bersama aplikasi Amatu lain.';
}
function aiChip() {
  const ok = AI.ok() && (window.AMATU?.sess?.()?.t || /[?&]edge=/.test(location.search));
  S.aiChip.className = 'aichip ' + (ok ? 'on' : AI.why === 'kuota' ? 'warn' : 'off');
  S.aiChip.replaceChildren(h('i'), h('span', null, ok ? 'AI aktif' : AI.why === 'kuota' ? 'Kuota AI habis' : 'Tanpa AI'));
}
AI.on(() => aiChip());

// ---------- routing ----------
function go(id, tab, extra = {}) {
  const t = tab || (id ? (S.cur?.id === id ? S.tab : 'lihat') : '');
  const hash = id ? `#/d/${id}/${t}${extra.deck ? '/' + extra.deck : ''}` : '#/';
  if (location.hash !== hash) history.pushState(null, '', hash);
  route();
}
async function route() {
  const m = /^#\/d\/([a-z0-9]+)(?:\/(lihat|ringkasan|paparan|tanya))?(?:\/([a-z0-9]+))?/.exec(location.hash);
  const id = m?.[1], tab = m?.[2] || 'lihat', deckId = m?.[3];
  if (!id) { S.cur = null; document.body.dataset.screen = 'lib'; renderHome(); renderLib(); renderChat(); nav(); return; }
  const meta = S.docs.find(d => d.id === id) || await DB.get('docs', id);
  if (!meta) { history.replaceState(null, '', '#/'); return route(); }
  const changed = S.cur?.id !== id;
  S.cur = meta; S.tab = tab;
  document.body.dataset.screen = 'doc';
  document.body.dataset.tab = tab;
  renderLib();
  if (changed) { S.scope = 'doc'; await renderDoc(); renderChat(); }
  showTab(tab, deckId);
  nav();
  if (changed) maybeReread(meta);
}
addEventListener('popstate', route);

function nav() {
  const n = $('.mnav');
  if (!S.cur) { n.replaceChildren(); return; }
  const it = (t, ic, label) => h('button', { class: S.tab === t ? 'on' : '', onclick: () => go(S.cur.id, t) }, icon(ic), h('span', null, label));
  n.replaceChildren(it('lihat', 'doc', 'Lihat'), it('ringkasan', 'list', 'Ringkasan'), it('tanya', 'chat', 'Tanya'), it('paparan', 'slides', 'Paparan'));
}

// ---------- library ----------
function kindIcon(meta) {
  const k = KIND[meta.kind] || ['File', 'text'];
  return h('span', { class: 'fi ' + k[1] }, icon('f-' + k[1]));
}
function renderLib() {
  const list = $('.list');
  const q = S.search?.value.trim().toLowerCase() || '';
  const docs = S.docs.filter(d => !q || (d.name + ' ' + (d.digest?.title || '')).toLowerCase().includes(q));
  $('.lib-n').textContent = S.docs.length ? String(S.docs.length) : '';
  if (!S.docs.length) { list.replaceChildren(h('div', { class: 'lempty' }, 'Belum ada dokumen.')); return; }
  list.replaceChildren(...docs.map(d => {
    const p = S.prog[d.id];
    const busy = d.status !== 'siap' && d.status !== 'gagal';
    const sub = d.status === 'gagal' ? h('span', { class: 'err' }, 'Gagal dibaca') : busy ? h('span', { class: 'busy' }, p ? `${Math.round(p.v * 100)}% · ${p.t}` : 'Menunggu…') :
      h('span', null, [KIND[d.kind]?.[0], d.pages > 1 ? `${d.pages} ${d.kind === 'sheet' ? 'sheet' : d.kind === 'pptx' ? 'slide' : 'hal.'}` : '', fmtBytes(d.size)].filter(Boolean).join(' · '));
    return h('div', { class: 'li' + (S.cur?.id === d.id ? ' on' : ''), role: 'listitem' },
      h('button', { class: 'li-b', onclick: () => go(d.id) }, kindIcon(d), h('span', { class: 'li-t' }, h('b', null, d.digest?.title && d.digest.title !== d.name ? d.digest.title : d.name), sub),
        busy && p ? h('span', { class: 'li-p' }, h('i', { style: `width:${Math.round(p.v * 100)}%` })) : null),
      h('button', { class: 'ib sm li-x', 'aria-label': 'Hapus ' + d.name, title: 'Hapus', onclick: () => removeDoc(d) }, icon('trash')));
  }));
}
async function loadDocs() {
  S.docs = (await DB.all('docs')).sort((a, b) => b.added - a.added);
}
async function removeDoc(d) {
  if (!(await confirmBox('Hapus dokumen?', `"${d.name}" beserta ringkasan, riwayat tanya jawab, dan paparannya akan dihapus.`))) return;
  await DB.removeDoc(d.id);
  forget(d.id);
  await loadDocs();
  if (S.cur?.id === d.id) go(null); else renderLib();
  toast('Dokumen dihapus');
}

// ---------- upload & learning ----------
async function upload(files) {
  const ok = files.filter(f => kindOf(f));
  const bad = files.filter(f => !kindOf(f));
  if (bad.length) toast(`${bad.length} file tidak didukung: ${bad.map(f => f.name).slice(0, 3).join(', ')}`, 'err', 5000);
  if (!ok.length) return;
  const big = ok.filter(f => f.size > 150e6);
  if (big.length) { toast('File lebih dari 150 MB belum didukung: ' + big[0].name, 'err', 5000); return; }
  S.busy += ok.length;
  let first = null;
  for (const f of ok) {
    try {
      let id = null;
      await learn(f, (v, t) => {
        if (!id) return;
        S.prog[id] = { v, t };
        renderLibSoon();
        if (!S.cur && mobile()) renderHomeSoon();
        if (S.cur?.id === id) progressDoc();
      }, nid => { id = nid; S.prog[id] = { v: 0, t: 'Membuka file' }; loadDocs().then(() => { renderLib(); if (!first) { first = id; go(id); } }); });
      delete S.prog[id];
      await loadDocs();
      renderLib();
      if (S.cur?.id === id) { S.cur = S.docs.find(d => d.id === id); await renderDoc(); showTab(S.tab); renderChat(); }
      toast(`"${f.name}" selesai dipelajari`, 'ok');
    } catch (e) {
      console.error(e);
      toast(`Gagal membaca "${f.name}": ${e.message || e}`, 'err', 7000);
      await loadDocs(); renderLib();
      if (S.cur) { S.cur = S.docs.find(d => d.id === S.cur.id) || S.cur; renderDoc().then(() => showTab(S.tab)); }
    } finally { S.busy--; }
  }
}
const renderLibSoon = debounce(renderLib, 120);
const renderHomeSoon = debounce(() => { if (!S.cur) renderHome(); }, 400);
addEventListener('beforeunload', e => { if (S.busy > 0) { e.preventDefault(); e.returnValue = ''; } });

// drag & drop anywhere
let dragN = 0;
addEventListener('dragenter', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { dragN++; document.body.classList.add('dragging'); } });
addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; document.body.classList.remove('dragging'); } });
addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
addEventListener('drop', e => { e.preventDefault(); dragN = 0; document.body.classList.remove('dragging'); const f = [...(e.dataTransfer?.files || [])]; if (f.length) upload(f); });
addEventListener('paste', e => { const f = [...(e.clipboardData?.files || [])]; if (f.length && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) upload(f); });

// ---------- home ----------
function renderHome() {
  const main = $('.main');
  const feat = (ic, t, d) => h('div', { class: 'feat' }, h('span', { class: 'feat-i' }, icon(ic)), h('b', null, t), h('p', null, d));
  const phone = mobile();
  const docs = phone ? S.docs : S.docs.slice(0, 6);
  const list = docs.length ? h('section', { class: 'recent' }, h('h3', null, phone ? `Dokumen (${S.docs.length})` : 'Dokumen terbaru'), h('div', { class: 'rgrid' }, docs.map(d => {
    const p = S.prog[d.id];
    const busy = d.status !== 'siap' && d.status !== 'gagal';
    return h('button', { class: 'rc', onclick: () => go(d.id) }, kindIcon(d), h('b', null, d.digest?.title || d.name),
      h('span', null, busy ? (p ? `Mempelajari ${Math.round(p.v * 100)}%` : 'Mempelajari…') : d.status === 'gagal' ? 'Gagal dibaca' : (d.digest?.type ? d.digest.type + ' · ' : '') + ago(d.added)));
  }))) : null;
  const feats = h('section', { class: 'feats' },
    feat('chat', 'Tanya jawab otomatis', 'Jawaban langsung dari isi dokumen, lengkap dengan rujukan halaman yang bisa diklik.'),
    feat('slides', 'Paparan otomatis', 'Ringkasan eksekutif, grafik dari data, insight, kesimpulan & rekomendasi — siap dipresentasikan.'),
    feat('doc', 'Viewer dokumen', 'Lihat file asli dan hasil paparan; unduh PowerPoint (bisa diedit) atau PDF.'));
  if (phone && S.docs.length) {
    main.replaceChildren(h('div', { class: 'home' },
      h('div', { class: 'qup' }, h('button', { class: 'btn primary lg', onclick: () => S.pick() }, icon('upload'), 'Unggah dokumen'), h('span', null, 'PDF, Word, Excel, PowerPoint, gambar, teks')),
      list, feats));
    return;
  }
  main.replaceChildren(h('div', { class: 'home' },
    h('section', { class: 'hero' },
      h('div', { class: 'hero-i' }, icon('logo')),
      h('h1', null, 'Unggah dokumen apa pun,', h('br'), 'langsung bisa ditanya & dipaparkan.'),
      h('p', null, 'Paparan mempelajari isi PDF, Word, Excel, PowerPoint, gambar, atau teks Anda. Tanyakan apa saja tentang isinya, lalu ubah jadi presentasi profesional yang to the point dan terstruktur secara otomatis.'),
      h('div', { class: 'hero-a' },
        h('button', { class: 'btn primary lg', onclick: () => S.pick() }, icon('upload'), 'Pilih file'),
        h('button', { class: 'btn lg', onclick: () => sample() }, icon('spark'), 'Coba contoh laporan produksi')),
      h('div', { class: 'fmts' }, ['PDF', 'DOCX', 'XLSX', 'CSV', 'PPTX', 'JPG/PNG', 'TXT/MD', 'ODT/ODS'].map(f => h('span', null, f))),
      h('div', { class: 'hint' }, phone ? 'Ketuk "Pilih file" untuk mengunggah.' : 'Atau tarik & lepaskan file ke mana saja di halaman ini.')),
    feats, list));
}
async function sample() {
  try {
    const r = await fetch('assets/contoh-laporan-produksi.pdf');
    if (!r.ok) throw new Error('contoh tidak ada');
    const b = await r.blob();
    upload([new File([b], 'Contoh Laporan Produksi Oktober 2026.pdf', { type: 'application/pdf' })]);
  } catch (e) { toast('Contoh tidak bisa dimuat: ' + e.message, 'err'); }
}

// ---------- document ----------
async function renderDoc() {
  const d = S.cur, main = $('.main');
  const tabs = h('div', { class: 'tabs', role: 'tablist' }, [['lihat', 'Lihat dokumen', 'doc'], ['ringkasan', 'Ringkasan', 'list'], ['paparan', 'Paparan', 'slides']].map(([t, l, ic]) =>
    h('button', { role: 'tab', class: 'tab', dataset: { t }, onclick: () => go(d.id, t) }, icon(ic), h('span', null, l))));
  const actions = h('div', { class: 'dact' },
    d.status === 'siap' && !d.ai ? h('button', { class: 'btn sm', title: 'Pelajari ulang dengan AI', onclick: () => relearn(d) }, icon('spark'), h('span', { class: 'hide-s' }, 'Pelajari dengan AI')) : null,
    d.status === 'siap' || d.status === 'gagal' ? h('button', { class: 'ib', title: 'Baca ulang dokumen (termasuk tabel & angka di dalam gambar)', 'aria-label': 'Baca ulang dokumen', onclick: () => rereadDoc(d) }, icon('refresh')) : null,
    h('button', { class: 'ib', title: 'Unduh file asli', 'aria-label': 'Unduh file asli', onclick: async () => { const f = await DB.get('files', d.id); if (f?.blob) download(f.blob, d.name); else toast('File asli tidak ada di perangkat ini'); } }, icon('download')),
    h('button', { class: 'ib', title: 'Hapus dokumen', 'aria-label': 'Hapus dokumen', onclick: () => removeDoc(d) }, icon('trash')));
  const head = h('div', { class: 'dhead' }, kindIcon(d), h('div', { class: 'dtitle' }, h('h2', null, d.digest?.title || d.name), h('span', null, [d.name !== (d.digest?.title || d.name) ? d.name : '', KIND[d.kind]?.[0], d.pages > 1 ? `${d.pages} ${d.kind === 'sheet' ? 'sheet' : d.kind === 'pptx' ? 'slide' : 'halaman'}` : '', d.tables ? `${d.tables} tabel` : '', fmtBytes(d.size)].filter(Boolean).join(' · '))), actions);
  const body = h('div', { class: 'dbody' });
  main.replaceChildren(h('div', { class: 'doc' }, head, tabs, body));
  $('.tdoc').textContent = d.digest?.title || d.name;
  S.body = body;
  viewer?.destroy();
  viewer = null;
}
function progressDoc() {
  const d = S.cur, p = S.prog[d.id];
  if (!S.body) return;
  let box = S.body.querySelector('.learning');
  if (!box) { box = h('div', { class: 'learning' }, h('div', { class: 'lr-i pulse' }, icon('spark')), h('h3', null, 'Sedang mempelajari dokumen…'), h('p', { class: 'lr-t' }), h('div', { class: 'pbar' }, h('i'))); S.body.replaceChildren(box); }
  box.querySelector('.lr-t').textContent = p ? p.t : 'Menunggu';
  box.querySelector('.pbar i').style.width = Math.round((p?.v || 0) * 100) + '%';
}
async function showTab(tab, deckId) {
  const d = S.cur;
  if (!d || !S.body) return;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.t === tab));
  document.body.dataset.tab = tab;
  if (tab === 'tanya') { if (mobile()) return; tab = 'lihat'; }
  if (d.status === 'gagal') {
    S.body.replaceChildren(h('div', { class: 'empty' }, icon('x'), h('h3', null, 'Dokumen gagal dibaca'), h('p', null, d.err || ''), h('button', { class: 'btn', onclick: () => retry(d) }, 'Coba lagi')));
    return;
  }
  if (d.status !== 'siap') { progressDoc(); return; }
  if (tab === 'lihat') {
    if (viewer && S.body.querySelector('.vbar')) return;
    const L = await loadDoc(d.id);
    const host = h('div', { class: 'viewer' });
    S.body.replaceChildren(host);
    viewer = new Viewer(host);
    await viewer.open(d, L.content);
    if (S.pendingFocus) { viewer.focus(S.pendingFocus); S.pendingFocus = null; }
  } else if (tab === 'ringkasan') {
    viewer?.destroy(); viewer = null;
    await renderSummary();
  } else if (tab === 'paparan') {
    viewer?.destroy(); viewer = null;
    const host = h('div', { class: 'deckhost' });
    S.body.replaceChildren(host);
    deck = new DeckView(host, { route: x => { const want = `#/d/${d.id}/paparan/${x.deck}`; if (location.hash !== want) history.replaceState(null, '', want); } });
    await deck.open(d, deckId);
  }
}
async function retry(d) {
  const f = await DB.get('files', d.id);
  if (!f?.blob) return toast('File asli tidak ada di perangkat ini. Unggah ulang.', 'err');
  const file = f.blob instanceof File ? f.blob : new File([f.blob], d.name, { type: d.mime });
  await DB.removeDoc(d.id);
  await loadDocs();
  go(null);
  upload([file]);
}
// read the stored file again with the current reader; automatic once for documents learned by an older version
async function rereadDoc(d, auto) {
  if (S.busy && auto) return;
  S.prog[d.id] = { v: 0.02, t: 'Membaca ulang dokumen' };
  S.busy++;
  try {
    S.cur = { ...d, status: 'baca' };
    await renderDoc(); progressDoc();
    await reread(d.id, (v, t) => { S.prog[d.id] = { v, t }; if (S.cur?.id === d.id) progressDoc(); renderLibSoon(); });
    toast(auto ? 'Dokumen dibaca ulang: tabel & angka di dalam gambar kini ikut dipelajari' : 'Dokumen selesai dibaca ulang', 'ok', 6000);
  } catch (e) { toast('Gagal membaca ulang: ' + (e.message || e), 'err', 6000); }
  finally {
    S.busy--; delete S.prog[d.id];
    forget(d.id);
    await loadDocs(); S.cur = S.docs.find(x => x.id === d.id) || S.cur;
    renderLib(); if (S.cur?.id === d.id) { await renderDoc(); showTab(S.tab); renderChat(); }
  }
}
async function maybeReread(d) {
  if (!d || d.status !== 'siap' || (d.cv || 1) >= CONTENT_V || S.reread?.has(d.id)) return;
  if (!/^(pdf|docx|pptx|odt|odp|image)$/.test(d.kind)) return;
  (S.reread ||= new Set()).add(d.id);
  const f = await DB.get('files', d.id);
  if (!f?.blob) return;
  rereadDoc(d, true);
}
async function relearn(d) {
  if (!AI.ok()) return toast(AI.message(), 'err', 6000);
  S.prog[d.id] = { v: 0.75, t: 'AI mempelajari isi dokumen' };
  S.busy++;
  try {
    await DB.patch('docs', d.id, { status: 'indeks' });
    S.cur = await DB.get('docs', d.id);
    progressDoc();
    await deepen(d.id, (v, t) => { S.prog[d.id] = { v, t }; progressDoc(); renderLibSoon(); });
    toast(S.docs.find(x => x.id === d.id)?.ai ? 'Dipelajari ulang dengan AI' : 'Selesai', 'ok');
  } catch (e) { toast('Gagal: ' + (e.message || e), 'err'); }
  finally {
    S.busy--; delete S.prog[d.id];
    await loadDocs(); S.cur = S.docs.find(x => x.id === d.id);
    renderLib(); await renderDoc(); showTab(S.tab); renderChat();
  }
}

// ---------- summary tab ----------
async function renderSummary() {
  const d = S.cur, dg = d.digest || {};
  const L = await loadDoc(d.id);
  const fs = facts(L);
  const th = themeById(document.documentElement.dataset.dark === '1' ? 'eksekutif' : 'korporat');
  const chips = [dg.type, dg.period, dg.org].filter(Boolean).map(x => h('span', { class: 'tag' }, x));
  const heads = L.content.blocks.map((b, i) => [b, i]).filter(([b]) => b.t === 'h').slice(0, 60);
  const wrap = h('div', { class: 'sum' },
    h('section', { class: 'card' },
      h('div', { class: 'card-h' }, h('h3', null, 'Ringkasan'), h('span', { class: 'badge ' + (dg.ai ? 'ai' : '') }, dg.ai ? 'Dirangkum AI' : 'Ringkasan otomatis')),
      chips.length ? h('div', { class: 'tags' }, chips) : null,
      h('p', { class: 'lead' }, dg.summary || '—'),
      dg.points?.length ? h('ul', { class: 'pts' }, dg.points.map(p => h('li', null, p))) : null,
      !dg.ai && AI.ok() ? h('button', { class: 'btn sm', onclick: () => relearn(d) }, icon('spark'), 'Rangkum ulang dengan AI') : null),
    dg.questions?.length ? h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, 'Coba tanyakan')), h('div', { class: 'qs' }, dg.questions.map(q => h('button', { class: 'q', onclick: () => { if (mobile()) go(d.id, 'tanya'); else document.body.classList.remove('nochat'); sendQ(q); } }, icon('chat'), q)))) : null,
    fs.tables.length ? h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, `Data terdeteksi (${fs.tables.length} tabel)`)),
      h('div', { class: 'tgrid' }, fs.tables.slice(0, 24).map(T => {
        const ch = fs.charts.find(c => c.t === T.id);
        const brief = tableBrief(T).split('\n');
        return h('div', { class: 'tcard' },
          h('div', { class: 'tc-h' }, h('b', null, T.title), h('span', null, `${T.A.n} baris · ${T.head.length} kolom${T.where ? ' · ' + T.where : ''}`)),
          ch ? h('div', { class: 'tc-c', html: chartSVG(ch, 420, 170, th, { scale: 0.9 }) }) : null,
          h('ul', { class: 'tc-s' }, brief.slice(1, 5).map(x => h('li', null, x.replace(/^\s*•\s*/, '')))),
          h('button', { class: 'btn sm', onclick: () => { S.pendingFocus = { u: L.content.tables[T.ti].u, b: blockOfTable(L.content, T.ti), ti: T.ti }; go(d.id, 'lihat'); } }, icon('doc'), 'Lihat di dokumen'));
      }))) : null,
    heads.length ? h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, 'Struktur dokumen')),
      h('div', { class: 'outline' }, heads.map(([b, i]) => h('button', { class: 'ol l' + (b.lv || 2), onclick: () => { S.pendingFocus = { u: b.u, b: [i, i] }; go(d.id, 'lihat'); } }, b.x, h('span', null, L.content.units[b.u]?.label || ''))))) : null,
    h('section', { class: 'card meta' }, h('div', { class: 'card-h' }, h('h3', null, 'Info')),
      h('dl', null,
        h('dt', null, 'File'), h('dd', null, d.name),
        h('dt', null, 'Ukuran'), h('dd', null, fmtBytes(d.size)),
        h('dt', null, 'Isi'), h('dd', null, `${d.pages || 1} ${d.kind === 'sheet' ? 'sheet' : d.kind === 'pptx' ? 'slide' : 'halaman'} · ${d.tables || 0} tabel · ${d.chunks || 0} potongan pengetahuan`),
        h('dt', null, 'Bahasa'), h('dd', null, d.lang === 'en' ? 'Inggris' : 'Indonesia'),
        h('dt', null, 'Dipelajari'), h('dd', null, (d.learned ? fmtDate(d.learned) : '–') + (d.ai ? ' · dengan AI' : ' · tanpa AI') + (d.ocr ? ' · OCR' : '')))));
  S.body.replaceChildren(wrap);
}
const blockOfTable = (c, ti) => { const i = c.blocks.findIndex(b => b.t === 'tbl' && b.ti === ti); return [i, i]; };

// ---------- chat ----------
async function renderChat() {
  const box = $('.chat');
  const ready = S.docs.filter(d => d.status === 'siap');
  const scopeAll = S.scope === 'all' || !S.cur;
  const cid = scopeAll ? 'all' : S.cur.id;
  const rec = await DB.get('chats', cid);
  S.chat = { id: cid, msgs: rec?.msgs || [] };
  const seg = S.cur ? h('div', { class: 'seg sm' },
    h('button', { class: !scopeAll ? 'on' : '', onclick: () => { S.scope = 'doc'; renderChat(); } }, 'Dokumen ini'),
    h('button', { class: scopeAll ? 'on' : '', onclick: () => { S.scope = 'all'; renderChat(); } }, `Semua (${ready.length})`)) : h('span', { class: 'muted' }, `${ready.length} dokumen`);
  const log = h('div', { class: 'log', 'aria-live': 'polite' });
  const ta = h('textarea', { class: 'qin', rows: 1, placeholder: ready.length ? (scopeAll ? 'Tanya apa saja dari semua dokumen…' : 'Tanya apa saja tentang dokumen ini…') : 'Unggah dokumen dulu', disabled: !ready.length || (S.cur && S.cur.status !== 'siap' && !scopeAll), 'aria-label': 'Pertanyaan' });
  const send = h('button', { class: 'send', 'aria-label': 'Kirim', disabled: true }, icon('send'));
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px'; send.disabled = !ta.value.trim() && !S.sending; });
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (ta.value.trim()) sendQ(ta.value); } });
  send.onclick = () => { if (S.sending) S.sending.abort(); else if (ta.value.trim()) sendQ(ta.value); };
  S.ta = ta; S.sendBtn = send; S.log = log;
  box.replaceChildren(
    h('div', { class: 'chat-h' }, h('div', { class: 'chat-t' }, icon('chat'), h('b', null, 'Tanya dokumen')), seg,
      S.chat.msgs.length ? h('button', { class: 'ib sm', title: 'Hapus riwayat', 'aria-label': 'Hapus riwayat tanya jawab', onclick: async () => { await DB.del('chats', cid); renderChat(); } }, icon('trash')) : null),
    log,
    h('div', { class: 'qbar' }, ta, send),
    h('div', { class: 'qnote' }, 'Jawaban disusun dari isi dokumen. Klik nomor rujukan untuk melihat sumbernya.'));
  if (!S.chat.msgs.length) log.append(welcome(scopeAll, ready));
  for (const m of S.chat.msgs) log.append(msgEl(m));
  log.scrollTop = log.scrollHeight;
}
function welcome(all, ready) {
  const d = S.cur;
  if (!ready.length) return h('div', { class: 'welcome' }, h('p', null, 'Unggah dokumen, lalu tanyakan apa saja tentang isinya di sini.'));
  if (!all && d.status !== 'siap') return h('div', { class: 'welcome' }, h('p', null, 'Dokumen sedang dipelajari. Tanya jawab aktif setelah selesai.'));
  const qs = all ? ['Apa saja dokumen yang ada dan isinya?', 'Bandingkan angka utama di semua dokumen', 'Apa temuan terpenting?'] : (d.digest?.questions || []).slice(0, 4);
  return h('div', { class: 'welcome' },
    h('div', { class: 'wl-i' }, icon('spark')),
    h('p', null, all ? `Saya sudah mempelajari ${ready.length} dokumen. Tanyakan apa saja.` : h('span', null, 'Saya sudah mempelajari ', h('b', null, d.digest?.title || d.name), '. ', short(d.digest?.summary || '', 260))),
    h('div', { class: 'qs' }, qs.map(q => h('button', { class: 'q', onclick: () => sendQ(q) }, q))));
}
function msgEl(m) {
  if (m.role === 'user') return h('div', { class: 'msg u' }, h('div', { class: 'bub' }, m.text));
  const body = h('div', { class: 'bub md', html: md(m.text) });
  body.addEventListener('click', e => { const c = e.target.closest('.cite'); if (c) openSource(m, +c.dataset.cite); });
  const cites = (m.cites || []);
  return h('div', { class: 'msg a' + (m.err ? ' err' : '') }, body,
    cites.length ? h('div', { class: 'srcs' }, cites.map(s => h('button', { class: 'src', title: short(s.x, 300), onclick: () => openSource(m, s.n) }, h('b', null, s.n), (S.scope === 'all' || !S.cur ? short(s.name, 22) + ' · ' : '') + (s.label || 'Sumber')))) : null,
    h('div', { class: 'mfoot' }, h('span', { class: 'badge ' + (m.mode === 'ai' ? 'ai' : '') }, m.mode === 'ai' ? 'AI' : 'Tanpa AI'),
      h('button', { class: 'ib xs', title: 'Salin', 'aria-label': 'Salin jawaban', onclick: () => { navigator.clipboard?.writeText(m.text.replace(/\s*\[\d+(?:[,\s–-]+\d+)*\]/g, '')); toast('Jawaban disalin'); } }, icon('copy'))));
}
async function openSource(m, n) {
  const s = (m.sources || m.cites || []).find(x => x.n === n);
  if (!s) return;
  const f = { u: s.u, b: s.i >= 0 ? (await loadDoc(s.doc))?.content.chunks[s.i]?.b : blockOfTable((await loadDoc(s.doc)).content, s.ti), ti: s.ti, rows: s.rows };
  if (S.cur?.id === s.doc && S.tab === 'lihat' && viewer) { viewer.focus(f); if (mobile()) go(s.doc, 'lihat'); return; }
  S.pendingFocus = f;
  go(s.doc, 'lihat');
}
async function sendQ(q) {
  q = q.trim();
  if (!q || S.sending) return;
  const ready = S.docs.filter(d => d.status === 'siap');
  const all = S.scope === 'all' || !S.cur;
  const ids = all ? ready.map(d => d.id) : [S.cur.id];
  if (!ids.length) return;
  const chat = S.chat;
  const history = chat.msgs.map(m => ({ role: m.role, text: m.text }));
  const um = { role: 'user', text: q, t: Date.now() };
  chat.msgs.push(um);
  S.log.querySelector('.welcome')?.remove();
  S.log.append(msgEl(um));
  S.ta.value = ''; S.ta.style.height = 'auto';
  const live = h('div', { class: 'msg a live' }, h('div', { class: 'bub md' }, h('span', { class: 'dots' }, h('i'), h('i'), h('i'))));
  S.log.append(live);
  S.log.scrollTop = S.log.scrollHeight;
  S.sending = new AbortController();
  S.sendBtn.disabled = false; S.sendBtn.classList.add('stop'); S.sendBtn.replaceChildren(icon('stop'));
  let am;
  try {
    const r = await ask({
      q, ids, history, signal: S.sending.signal,
      onDelta: full => {
        const b = live.querySelector('.bub');
        b.innerHTML = md(full) + '<span class="caret"></span>';
        const near = S.log.scrollHeight - S.log.scrollTop - S.log.clientHeight < 120;
        if (near) S.log.scrollTop = S.log.scrollHeight;
      },
    });
    am = { role: 'assistant', text: r.text, cites: r.cites.map(slim), sources: r.sources.map(slim), mode: r.mode, t: Date.now() };
  } catch (e) {
    am = { role: 'assistant', text: e.code === 'batal' ? '_(dihentikan)_' : 'Maaf, terjadi kesalahan: ' + (e.message || e), err: 1, mode: 'offline', t: Date.now() };
  } finally {
    S.sending = null;
    S.sendBtn.classList.remove('stop'); S.sendBtn.replaceChildren(icon('send')); S.sendBtn.disabled = true;
  }
  chat.msgs.push(am);
  live.replaceWith(msgEl(am));
  S.log.scrollTop = S.log.scrollHeight;
  if (chat.msgs.length > 120) chat.msgs.splice(0, chat.msgs.length - 120);
  await DB.put('chats', { id: chat.id, msgs: chat.msgs });
  aiChip();
}
const slim = s => ({ n: s.n, doc: s.doc, name: s.name, i: s.i, u: s.u, label: s.label, x: short(s.x, 600), ti: s.ti, rows: s.rows });

// ---------- other devices / tabs ----------
const refresh = debounce(async () => {
  await loadDocs();
  renderLib();
  if (S.cur) { const m = S.docs.find(d => d.id === S.cur.id); if (!m) go(null); else if (m.status !== S.cur.status || m.digest !== S.cur.digest && !S.busy) { S.cur = m; } }
  else renderHome();
}, 300);
DB.on(msg => { if (msg.s === 'docs') refresh(); });
addEventListener('amatu:change', e => { if ((e.detail?.keys || []).some(k => /amatu-paparan/.test(k))) { forget(S.cur?.id); refresh(); } });
mq.addEventListener('change', () => { nav(); if (S.cur) showTab(S.tab); });

// ---------- start ----------
(async function start() {
  shell();
  aiChip();
  await loadDocs();
  // documents left half-learned by a closed tab on this device (another tab still learning holds a Web Lock)
  let held = new Set();
  try { held = new Set(((await navigator.locks?.query?.())?.held || []).map(l => l.name)); } catch { }
  for (const d of S.docs) if (d.status !== 'siap' && d.status !== 'gagal' && d.dev === device() && !held.has(lockName(d.id))) await DB.patch('docs', d.id, { status: 'gagal', err: 'Proses belajar terhenti (tab ditutup). Klik "Coba lagi".' });
  await loadDocs();
  route();
  setInterval(aiChip, 30000);
})();
