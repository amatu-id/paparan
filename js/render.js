// Composed slide → DOM (960 × 540 box, scaled by the caller with CSS transform).
import { chartSVG } from './charts.js';
import { fontFamily } from './themes.js';
import { esc } from './util.js';
import { W, H } from './compose.js';

export function renderSlide(sl, th, o = {}) {
  const root = document.createElement('div');
  root.className = 'sl';
  root.style.cssText = `width:${W}px;height:${H}px;position:relative;overflow:hidden;background:${th.c.bg};font-family:${fontFamily(th.f.body)};`;
  let html = '';
  for (const [k, e] of sl.els.entries()) html += elHtml(e, th, k, o);
  root.innerHTML = html;
  return root;
}

const px = v => (Math.round(v * 10) / 10) + 'px';
function box(e, extra = '') {
  return `position:absolute;left:${px(e.x)};top:${px(e.y)};width:${px(e.w)};height:${px(e.h)};${e.op != null ? `opacity:${e.op};` : ''}${extra}`;
}
function elHtml(e, th, k, o) {
  const bind = e.bind && o.edit ? ` data-k="${k}" class="ed"` : '';
  switch (e.k) {
    case 'rect':
      return `<div style="${box(e, `background:${e.fill};border-radius:${e.r || 0}px;${e.line ? `box-shadow:inset 0 0 0 1px ${e.line};` : ''}`)}"></div>`;
    case 'circle':
      return `<div style="${box(e, `background:${e.fill === 'none' ? 'transparent' : e.fill};border-radius:50%;${e.line ? `box-shadow:inset 0 0 0 ${e.lw || 1}px ${e.line};` : ''}`)}"></div>`;
    case 'path':
      return `<svg style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;${e.op != null ? `opacity:${e.op};` : ''}" viewBox="0 0 ${W} ${H}"><path d="${e.d}" fill="${e.fill}"/></svg>`;
    case 'line':
      return `<svg style="position:absolute;left:0;top:0;width:${W}px;height:${H}px" viewBox="0 0 ${W} ${H}"><line x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}" stroke="${e.c}" stroke-width="${e.w || 1}"/></svg>`;
    case 'text': {
      const fam = fontFamily(e.font === 'head' ? th.f.head : th.f.body).replace(/"/g, "'");
      const jc = e.va === 'm' ? 'center' : e.va === 'b' ? 'flex-end' : 'flex-start';
      const ta = e.align === 'c' ? 'center' : e.align === 'r' ? 'right' : 'left';
      const lines = e.lines.map(l => `<div style="white-space:pre;height:${px(e.size * e.lh)}">${esc(e.upper ? l.toUpperCase() : l) || ' '}</div>`).join('');
      return `<div${bind} style="${box(e, `display:flex;flex-direction:column;justify-content:${jc};text-align:${ta};font-family:${fam};font-size:${px(e.size)};font-weight:${e.weight};line-height:${e.lh};color:${e.color};letter-spacing:${e.ls || 0}px;`)}">${lines}</div>`;
    }
    case 'bullets': {
      const s = e.size, mk = e.marker;
      let h = '';
      e.lines.forEach((ls, i) => {
        let m = '';
        const ms = s * e.lh;
        if (mk === 'num') m = `<span style="position:absolute;left:0;top:${px((ms - s * 1.25) / 2)};width:${px(s * 1.25)};height:${px(s * 1.25)};border-radius:50%;background:${e.mcolor};color:#fff;font-size:${px(s * 0.72)};font-weight:800;display:flex;align-items:center;justify-content:center">${i + 1}</span>`;
        else if (mk === 'check') m = `<svg style="position:absolute;left:0;top:${px((ms - s) / 2)}" width="${s}" height="${s}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="${e.mcolor}"/><path d="M7 12.5l3.2 3.2L17 9" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        else if (mk === 'arrow') m = `<svg style="position:absolute;left:0;top:${px((ms - s * 0.8) / 2)}" width="${s * 0.8}" height="${s * 0.8}" viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6" stroke="${e.mcolor}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        else if (mk === 'sq') m = `<span style="position:absolute;left:${px(s * 0.1)};top:${px(ms / 2 - s * 0.24)};width:${px(s * 0.48)};height:${px(s * 0.48)};border-radius:${px(s * 0.12)};background:${e.mcolor}"></span>`;
        else m = `<span style="position:absolute;left:${px(s * 0.18)};top:${px(ms / 2 - s * 0.19)};width:${px(s * 0.38)};height:${px(s * 0.38)};border-radius:50%;background:${e.mcolor}"></span>`;
        h += `<div${e.bind && o.edit ? ` class="ed" data-k="${k}" data-i="${i}"` : ''} style="position:relative;padding-left:${px(s * e.indent)};margin-bottom:${i < e.lines.length - 1 ? px(e.gap * s) : 0}">${m}${ls.map(l => `<div style="white-space:pre;height:${px(ms)}">${esc(l) || ' '}</div>`).join('')}</div>`;
      });
      return `<div style="${box(e, `font-size:${px(s)};font-weight:${e.weight};line-height:${e.lh};color:${e.color};`)}">${h}</div>`;
    }
    case 'chart':
      return `<div style="${box(e)}">${chartSVG(e.chart, e.w, e.h, th)}</div>`;
    case 'table': {
      const C = th.c;
      let h = `<table style="border-collapse:separate;border-spacing:0;width:${px(e.w)};table-layout:fixed;font-size:${px(e.size)};color:${C.tx}">`;
      h += '<colgroup>' + e.cws.map(w => `<col style="width:${px(w)}">`).join('') + '</colgroup>';
      const cell = (v, j, head, ri) => {
        const al = e.num[j] ? 'right' : 'left';
        const st = head ? `background:${C.a1};color:${C.on1};font-weight:700;` : `background:${ri % 2 ? C.bg2 : C.bg};${ri === e.hl ? `font-weight:700;color:${C.title};` : ''}`;
        const rad = head ? (j === 0 ? 'border-top-left-radius:8px;' : j === e.cws.length - 1 ? 'border-top-right-radius:8px;' : '') : '';
        return `<td style="${st}${rad}height:${px(e.rowH)};padding:0 8px;text-align:${al};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-bottom:1px solid ${C.line}">${esc(v ?? '')}</td>`;
      };
      h += '<tr>' + e.head.map((v, j) => cell(v, j, true, -1)).join('') + '</tr>';
      e.rows.forEach((r, ri) => { h += '<tr>' + r.map((v, j) => cell(v, j, false, ri)).join('') + '</tr>'; });
      h += '</table>';
      if (e.more) h += `<div style="font-size:${px(e.size * 0.85)};color:${C.tx2};margin-top:6px">… ${e.more} ${e.en ? 'more rows' : 'baris lainnya'}</div>`;
      return `<div style="${box(e, 'height:auto;')}">${h}</div>`;
    }
  }
  return '';
}

// slide scaled into a box of width w (thumbnails, viewer)
export function scaled(sl, th, w, o = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'slw';
  const k = w / W;
  wrap.style.cssText = `width:${w}px;height:${H * k}px;position:relative;overflow:hidden;`;
  const s = renderSlide(sl, th, o);
  s.style.transform = `scale(${k})`;
  s.style.transformOrigin = '0 0';
  wrap.append(s);
  return wrap;
}
