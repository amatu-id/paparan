// Small DOM + formatting helpers shared by every module.

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// h('div', {class, style, on:{click}, dataset, html, text, ...attrs}, ...children)
export function h(tag, a, ...kids) {
  const el = tag === 'svg' || tag === 'path' || tag === 'use' ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  if (a) for (const [k, v] of Object.entries(a)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'style') typeof v === 'string' ? (el.style.cssText = v) : Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'on') for (const [ev, f] of Object.entries(v)) el.addEventListener(ev, f);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const k of kids.flat(9)) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
}

export function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', 'ic ' + cls);
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  u.setAttribute('href', '#i-' + name);
  s.append(u);
  return s;
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = (n = 12) => { const a = crypto.getRandomValues(new Uint8Array(n)); let s = ''; for (const b of a) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]; return s; };
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const debounce = (f, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };
export const idle = () => new Promise(r => (window.scheduler && scheduler.yield) ? scheduler.yield().then(r) : setTimeout(r, 0));

// ---------- numbers (Indonesian formatting) ----------
const NF = {};
const nf = (min, max) => NF[min + '|' + max] ||= new Intl.NumberFormat('id-ID', { minimumFractionDigits: min, maximumFractionDigits: max });
export function decimals(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return 0;
  if (a >= 100) return 1;
  if (a >= 1) return 2;
  if (a === 0) return 0;
  return 3;
}
export const fmtFixed = (v, d) => (v == null || !Number.isFinite(+v) ? '–' : nf(d, d).format(+v));
export function fmtNum(v, dec) {
  if (v == null || !Number.isFinite(+v)) return '–';
  v = +v;
  const d = dec ?? (Number.isInteger(v) ? 0 : decimals(v));
  return nf(0, d).format(v);
}
// 12.450.000 → "12,45 jt"; keeps small numbers exact
export function fmtCompact(v, unit) {
  if (v == null || !Number.isFinite(+v)) return '–';
  v = +v;
  const a = Math.abs(v), cur = /^rp$/i.test(unit || '');
  let s;
  if (a >= 1e12) s = nf(0, 2).format(v / 1e12) + ' T';
  else if (a >= 1e9) s = nf(0, 2).format(v / 1e9) + (cur ? ' M' : ' M');
  else if (a >= 1e6) s = nf(0, 2).format(v / 1e6) + ' jt';
  else if (a >= 1e4 && cur) s = nf(0, 1).format(v / 1e3) + ' rb';
  else s = fmtNum(v);
  if (!unit) return s;
  if (cur) return 'Rp ' + s;
  if (unit === '%') return s + '%';
  return s + ' ' + unit;
}
export function fmtVal(v, unit, dec) {
  if (v == null || !Number.isFinite(+v)) return '–';
  if (unit === '%') return fmtNum(v, dec ?? (Math.abs(v) >= 100 ? 0 : 1)) + '%';
  if (unit === 'Rp jt') return 'Rp ' + fmtNum(v, dec) + ' juta';
  if (unit === 'Rp M') return 'Rp ' + fmtNum(v, dec) + ' miliar';
  if (unit === 'Rp rb') return 'Rp ' + fmtNum(v, dec) + ' ribu';
  if (/^rp$/i.test(unit || '')) return 'Rp ' + fmtNum(Math.round(v));
  return fmtNum(v, dec) + (unit ? ' ' + unit : '');
}
export const fmtPct = (v, dec = 1) => (v == null || !Number.isFinite(v) ? '–' : (v > 0 ? '+' : '') + nf(0, dec).format(v) + '%');
export function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return nf(0, 0).format(n / 1024) + ' KB';
  return nf(0, 1).format(n / 1048576) + ' MB';
}
const DF = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
const DTF = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const fmtDate = t => DF.format(new Date(t));
export const fmtDateTime = t => DTF.format(new Date(t));
export function ago(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'baru saja';
  if (s < 3600) return Math.floor(s / 60) + ' mnt lalu';
  if (s < 86400) return Math.floor(s / 3600) + ' jam lalu';
  if (s < 7 * 86400) return Math.floor(s / 86400) + ' hari lalu';
  return fmtDate(t);
}

// ---------- toast ----------
let toastBox;
export function toast(msg, kind = '', ms = 3600) {
  toastBox ||= document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const t = h('div', { class: 'toast ' + kind }, msg);
  toastBox.append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, ms);
}

// ---------- small modal ----------
export function modal(title, body, actions = []) {
  return new Promise(res => {
    const close = v => { bg.classList.remove('in'); setTimeout(() => bg.remove(), 200); res(v); };
    const bg = h('div', { class: 'modal-bg', onclick: e => e.target === bg && close(null) },
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('div', { class: 'modal-h' }, h('div', { class: 'modal-t' }, title), h('button', { class: 'ib', 'aria-label': 'Tutup', onclick: () => close(null) }, icon('x'))),
        h('div', { class: 'modal-b' }, body),
        actions.length ? h('div', { class: 'modal-f' }, actions.map(a => h('button', { class: 'btn ' + (a.cls || ''), onclick: () => close(a.v) }, a.label))) : null));
    document.body.append(bg);
    requestAnimationFrame(() => bg.classList.add('in'));
    const onKey = e => { if (e.key === 'Escape') { removeEventListener('keydown', onKey); close(null); } };
    addEventListener('keydown', onKey);
  });
}
export const confirmBox = (title, text, ok = 'Hapus') => modal(title, h('p', null, text), [{ label: 'Batal', v: false }, { label: ok, v: true, cls: 'danger' }]);

export function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
export const safeName = s => String(s || 'paparan').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) || 'paparan';
export const baseName = n => String(n || '').replace(/\.[a-z0-9]{1,5}$/i, '');
export const extOf = n => (/\.([a-z0-9]{1,5})$/i.exec(n || '') || [, ''])[1].toLowerCase();
