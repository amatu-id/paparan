// Presentation themes. c: colours, chart: series palette, f: fonts (web) + ppt (font used in PowerPoint export).
export const THEMES = [
  { id: 'korporat', name: 'Korporat', c: { bg: '#ffffff', bg2: '#f2f5fb', card: '#f7f9fd', line: '#e2e8f0', tx: '#334155', tx2: '#64748b', title: '#0b1f44', a1: '#1d4ed8', a2: '#0ea5e9', on1: '#ffffff', deep: '#0b1f44' },
    chart: ['#1d4ed8', '#0ea5e9', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444'], f: { head: 'Plus Jakarta Sans', body: 'Plus Jakarta Sans', ppt: 'Calibri' }, cover: 'split' },
  { id: 'eksekutif', name: 'Eksekutif', dark: true, c: { bg: '#0b1324', bg2: '#111c33', card: '#14203a', line: '#24324f', tx: '#d5dceb', tx2: '#93a3bf', title: '#ffffff', a1: '#d4af37', a2: '#60a5fa', on1: '#1a1405', deep: '#060b16' },
    chart: ['#d4af37', '#60a5fa', '#34d399', '#f472b6', '#a78bfa', '#fb923c'], f: { head: 'DM Serif Display', body: 'Inter', ppt: 'Georgia' }, cover: 'dark' },
  { id: 'industri', name: 'Industri', c: { bg: '#ffffff', bg2: '#f5f5f4', card: '#fafaf9', line: '#e7e5e4', tx: '#3f3f46', tx2: '#71717a', title: '#1c1917', a1: '#ea580c', a2: '#334155', on1: '#ffffff', deep: '#1c1917' },
    chart: ['#ea580c', '#334155', '#f59e0b', '#0d9488', '#6366f1', '#dc2626'], f: { head: 'Barlow', body: 'Barlow', ppt: 'Arial' }, cover: 'stripe' },
  { id: 'hijau', name: 'Hijau Segar', c: { bg: '#ffffff', bg2: '#effbf4', card: '#f6fbf8', line: '#d8eee0', tx: '#1f3b2d', tx2: '#557566', title: '#064e3b', a1: '#059669', a2: '#65a30d', on1: '#ffffff', deep: '#064e3b' },
    chart: ['#059669', '#0ea5e9', '#84cc16', '#f59e0b', '#6366f1', '#e11d48'], f: { head: 'Manrope', body: 'Manrope', ppt: 'Calibri' }, cover: 'split' },
  { id: 'minimal', name: 'Minimal', c: { bg: '#ffffff', bg2: '#f4f4f5', card: '#fafafa', line: '#e4e4e7', tx: '#27272a', tx2: '#71717a', title: '#09090b', a1: '#e11d48', a2: '#18181b', on1: '#ffffff', deep: '#09090b' },
    chart: ['#18181b', '#e11d48', '#a1a1aa', '#2563eb', '#f59e0b', '#10b981'], f: { head: 'Inter', body: 'Inter', ppt: 'Arial' }, cover: 'minimal' },
  { id: 'samudra', name: 'Samudra', c: { bg: '#f7fbfd', bg2: '#e5f3f8', card: '#ffffff', line: '#d2e6ee', tx: '#23404d', tx2: '#5b7a87', title: '#0c3b4f', a1: '#0891b2', a2: '#0e7490', on1: '#ffffff', deep: '#0c3b4f' },
    chart: ['#0891b2', '#f97316', '#22c55e', '#6366f1', '#eab308', '#ec4899'], f: { head: 'Nunito Sans', body: 'Nunito Sans', ppt: 'Calibri' }, cover: 'wave' },
  { id: 'marun', name: 'Marun Elegan', c: { bg: '#fffdfb', bg2: '#faf0ec', card: '#fff8f5', line: '#efdcd5', tx: '#3b2a27', tx2: '#7c615b', title: '#4a0d1a', a1: '#9f1239', a2: '#b45309', on1: '#ffffff', deep: '#3b0a15' },
    chart: ['#9f1239', '#b45309', '#0f766e', '#475569', '#be185d', '#ca8a04'], f: { head: 'Lora', body: 'Source Sans 3', ppt: 'Georgia' }, cover: 'split' },
  { id: 'ungu', name: 'Ungu Modern', c: { bg: '#ffffff', bg2: '#f4f2ff', card: '#faf9ff', line: '#e7e3fb', tx: '#2e2a47', tx2: '#6b6890', title: '#1e1b4b', a1: '#7c3aed', a2: '#db2777', on1: '#ffffff', deep: '#1e1b4b' },
    chart: ['#7c3aed', '#db2777', '#06b6d4', '#f59e0b', '#10b981', '#3b82f6'], f: { head: 'Poppins', body: 'Poppins', ppt: 'Calibri' }, cover: 'blob' },
];
export const themeById = id => THEMES.find(t => t.id === id) || THEMES[0];

const GF = {
  'Plus Jakarta Sans': 'Plus+Jakarta+Sans:wght@400;500;600;700;800',
  'Inter': 'Inter:wght@400;500;600;700;800',
  'DM Serif Display': 'DM+Serif+Display',
  'Barlow': 'Barlow:wght@400;500;600;700;800',
  'Manrope': 'Manrope:wght@400;500;600;700;800',
  'Nunito Sans': 'Nunito+Sans:wght@400;600;700;800',
  'Lora': 'Lora:wght@500;600;700',
  'Source Sans 3': 'Source+Sans+3:wght@400;600;700',
  'Poppins': 'Poppins:wght@400;500;600;700',
};
const asked = new Set();
export function fontFamily(name) { return `"${name}", "Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Arial, sans-serif`; }
// load the theme's web fonts (and wait for them, so text measuring is right)
export async function loadFonts(th) {
  const need = [...new Set([th.f.head, th.f.body])];
  const miss = need.filter(f => GF[f] && !asked.has(f));
  if (miss.length) {
    miss.forEach(f => asked.add(f));
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?' + miss.map(f => 'family=' + GF[f]).join('&') + '&display=swap';
    document.head.append(l);
    await new Promise(r => { l.onload = r; l.onerror = r; setTimeout(r, 4000); });
  }
  const loads = [];
  for (const f of need) for (const w of [400, 600, 700, 800]) loads.push(document.fonts.load(`${w} 20px "${f}"`).catch(() => { }));
  await Promise.race([Promise.all(loads), new Promise(r => setTimeout(r, 3500))]);
}

// hex helpers
export function mix(a, b, t) {
  const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [r1, g1, b1] = p(a), [r2, g2, b2] = p(b);
  const c = (x, y) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  return '#' + c(r1, r2) + c(g1, g2) + c(b1, b2);
}
export const lum = h => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
