// Safe markdown → HTML for answers: everything is escaped first, then a small subset is formatted.
// [n] citations become buttons (data-cite=n).
import { esc } from './util.js';

function inline(s) {
  s = esc(s);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/__([^_]+)__/g, '<b>$1</b>');
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>');
  s = s.replace(/\[(\d+(?:\s*[,;–-]\s*\d+)*)\]/g, (_, g) => g.split(/[,;–-]/).map(n => `<button class="cite" data-cite="${+n.trim()}" type="button">${+n.trim()}</button>`).join(''));
  return s;
}

export function md(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  let out = '', list = null, para = [];
  const flushP = () => { if (para.length) { out += '<p>' + para.map(inline).join('<br>') + '</p>'; para = []; } };
  const closeL = () => { if (list) { out += `</${list}>`; list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], s = l.trim();
    if (!s) { flushP(); closeL(); continue; }
    let m;
    if ((m = /^(#{1,4})\s+(.*)$/.exec(s))) { flushP(); closeL(); out += `<h4>${inline(m[2])}</h4>`; continue; }
    if (/^\|.*\|$/.test(s) && /^\|?\s*:?-{2,}/.test((lines[i + 1] || '').trim())) {
      flushP(); closeL();
      const cells = x => x.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = cells(s);
      const al = cells(lines[i + 1]).map(c => (/:$/.test(c) ? 'right' : ''));
      out += '<div class="tw"><table><thead><tr>' + head.map((c, k) => `<th${al[k] ? ' class="r"' : ''}>${inline(c)}</th>`).join('') + '</tr></thead><tbody>';
      i += 2;
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
        out += '<tr>' + cells(lines[i]).map((c, k) => `<td${al[k] || /^[-+]?[\d.,]+\s?%?$/.test(c) ? ' class="r"' : ''}>${inline(c)}</td>`).join('') + '</tr>';
        i++;
      }
      i--;
      out += '</tbody></table></div>';
      continue;
    }
    if ((m = /^>\s?(.*)$/.exec(s))) { flushP(); closeL(); out += `<blockquote>${inline(m[1])}</blockquote>`; continue; }
    if ((m = /^([-*•])\s+(.*)$/.exec(s))) { flushP(); if (list !== 'ul') { closeL(); out += '<ul>'; list = 'ul'; } out += `<li>${inline(m[2])}</li>`; continue; }
    if ((m = /^(\d{1,2})[.)]\s+(.*)$/.exec(s))) { flushP(); if (list !== 'ol') { closeL(); out += `<ol start="${+m[1]}">`; list = 'ol'; } out += `<li>${inline(m[2])}</li>`; continue; }
    if (list && /^\s{2,}/.test(l)) { out = out.replace(/<\/li>$/, ' ' + inline(s) + '</li>'); continue; }
    closeL();
    para.push(s);
  }
  flushP(); closeL();
  return out;
}
