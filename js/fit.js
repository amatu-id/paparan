// Text measuring with the real web fonts, so every text box on a slide is sized to fit (no overflow, no clipping).
import { fontFamily } from './themes.js';

const ctx = document.createElement('canvas').getContext('2d');
const cache = new Map();
export function width(text, size, family, weight = 400) {
  const k = weight + '|' + family + '|' + text;
  let w = cache.get(k);
  if (w == null) {
    ctx.font = `${weight} 100px ${fontFamily(family)}`;
    w = ctx.measureText(text).width / 100;
    if (cache.size > 20000) cache.clear();
    cache.set(k, w);
  }
  return w * size;
}

export function wrap(text, maxW, size, family, weight) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (let w of words) {
      const t = line ? line + ' ' + w : w;
      if (width(t, size, family, weight) <= maxW) { line = t; continue; }
      if (line) out.push(line);
      // a single word longer than the box: break it
      while (width(w, size, family, weight) > maxW && w.length > 1) {
        let k = w.length;
        while (k > 1 && width(w.slice(0, k) + '-', size, family, weight) > maxW) k--;
        out.push(w.slice(0, k) + '-');
        w = w.slice(k);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}

// biggest size in [min, max] where the text fits in w × h (maxLines optional). Falls back to min with an ellipsis.
export function fit(text, w, h, o = {}) {
  const { family = 'Plus Jakarta Sans', weight = 400, max = 24, min = 10, lh = 1.25, maxLines = 99 } = o;
  for (let s = max; s >= min; s -= s > 20 ? 1 : 0.5) {
    const lines = wrap(text, w, s, family, weight);
    if (lines.length <= maxLines && lines.length * s * lh <= h + 0.5) return { size: s, lines };
  }
  let lines = wrap(text, w, min, family, weight);
  const keep = Math.max(1, Math.min(maxLines, Math.floor(h / (min * lh))));
  if (lines.length > keep) {
    lines = lines.slice(0, keep);
    let l = lines[keep - 1];
    while (l && width(l + '…', min, family, weight) > w) l = l.slice(0, -1);
    lines[keep - 1] = l.replace(/\s+\S*$/, '') + '…';
  }
  return { size: min, lines, cut: true };
}

// several items (bullets) sharing one size; gap between items in em, indent for the marker
export function fitList(items, w, h, o = {}) {
  const { family = 'Plus Jakarta Sans', weight = 400, max = 22, min = 11, lh = 1.3, gap = 0.75, indent = 1.4 } = o;
  for (let s = max; s >= min; s -= s > 18 ? 1 : 0.5) {
    const lines = items.map(t => wrap(t, w - indent * s, s, family, weight));
    const tot = lines.reduce((a, l) => a + l.length * s * lh, 0) + (items.length - 1) * gap * s;
    if (tot <= h + 0.5) return { size: s, lines };
  }
  return { size: min, lines: items.map(t => wrap(t, w - indent * min, min, family, weight)), cut: true };
}
export const lineCount = (text, w, size, family, weight) => wrap(text, w, size, family, weight).length;
