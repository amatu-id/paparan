// Numbers, units and periods as people write them in Indonesian and English reports.
//   "12.450" (id thousands) · "12,5%" · "Rp 1,25 M" · "(1.234)" · "1,234.56" (en) · "Okt-26" · "Minggu ke-2" · "Q3 2026"

const MON = [
  ['januari', 'jan'], ['februari', 'feb', 'peb', 'pebruari', 'february'], ['maret', 'mar', 'march'], ['april', 'apr'], ['mei', 'may'],
  ['juni', 'jun', 'june'], ['juli', 'jul', 'july'], ['agustus', 'agu', 'ags', 'agt', 'aug', 'august', 'agust'], ['september', 'sep', 'sept'],
  ['oktober', 'okt', 'oct', 'october'], ['november', 'nov', 'nop', 'nopember'], ['desember', 'des', 'dec', 'december'],
];
const MONMAP = {};
MON.forEach((a, i) => a.forEach(n => (MONMAP[n] = i + 1)));
export const MONTH_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
export const MONTH_S = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const DAYS = { senin: 1, monday: 1, mon: 1, sen: 1, selasa: 2, tuesday: 2, tue: 2, sel: 2, rabu: 3, wednesday: 3, wed: 3, rab: 3, kamis: 4, thursday: 4, thu: 4, kam: 4,
  jumat: 5, "jum'at": 5, friday: 5, fri: 5, jum: 5, sabtu: 6, saturday: 6, sat: 6, sab: 6, minggu: 7, ahad: 7, sunday: 7, sun: 7, min: 7 };
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };

const SCALE = { rb: 1e3, ribu: 1e3, k: 1e3, jt: 1e6, juta: 1e6, mio: 1e6, mn: 1e6, m: 1e9, miliar: 1e9, milyar: 1e9, bn: 1e9, b: 1e9, t: 1e12, triliun: 1e12, tn: 1e12 };
const CUR = /^(rp\.?|idr|usd|us\$|\$|eur|€|sgd|s\$|myr|rm|¥|jpy|cny|rmb)\s*/i;

// Which decimal separator a single string proves (null = says nothing)
export function numEvidence(s) {
  s = String(s ?? '').replace(/[\s ]/g, '');
  const m = /(\d[\d.,]*\d|\d)/.exec(s);
  if (!m) return null;
  const n = m[1];
  const dots = (n.match(/\./g) || []).length, commas = (n.match(/,/g) || []).length;
  if (dots && commas) return n.lastIndexOf(',') > n.lastIndexOf('.') ? 'id' : 'en';
  if (dots > 1) return 'id';
  if (commas > 1) return 'en';
  if (dots === 1) { const d = n.split('.')[1]; return d.length === 3 ? null : 'en'; }
  if (commas === 1) { const d = n.split(',')[1]; return d.length === 3 ? null : 'id'; }
  return null;
}

// "12.450" → 12450 (id) · "12,5" → 12.5 (id) · returns null when it isn't a number
export function toNumber(n, loc = 'id') {
  n = String(n).replace(/[\s ']/g, '');
  if (!/^\d[\d.,]*$/.test(n)) return null;
  const dots = (n.match(/\./g) || []).length, commas = (n.match(/,/g) || []).length;
  let dec = loc === 'en' ? '.' : ',';
  if (dots && commas) dec = n.lastIndexOf(',') > n.lastIndexOf('.') ? ',' : '.';
  else if (dots > 1) dec = ',';
  else if (commas > 1) dec = '.';
  else if (dots === 1 && n.split('.')[1].length !== 3) dec = '.';
  else if (commas === 1 && n.split(',')[1].length !== 3) dec = ',';
  const th = dec === ',' ? '.' : ',';
  const v = +n.split(th).join('').replace(dec, '.');
  return Number.isFinite(v) ? v : null;
}

// Full cell parse. → {v, unit, kind: 'num'|'pct'|'cur'} | null
export function parseNum(raw, loc = 'id') {
  if (typeof raw === 'number') return Number.isFinite(raw) ? { v: raw, unit: '', kind: 'num' } : null;
  let s = String(raw ?? '').trim();
  if (!s || s.length > 40) return null;
  if (/^[-–—]+$/.test(s)) return null;
  if (/^\d{1,2}[:.]\d{2}([:.]\d{2})?$/.test(s) && /:/.test(s)) return null;               // 08:30
  if (/^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}$/.test(s)) return null;                              // dates
  if (/^(\+62|0)8\d{7,}$/.test(s.replace(/[\s-]/g, ''))) return null;                      // phone
  let neg = false, unit = '', kind = 'num';
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
  s = s.replace(/^[−–—]\s*/, '-');
  if (s[0] === '-') { neg = !neg; s = s.slice(1).trim(); }
  else if (s[0] === '+') s = s.slice(1).trim();
  const cm = CUR.exec(s);
  if (cm) { unit = /rp|idr/i.test(cm[1]) ? 'Rp' : cm[1].replace(/\.$/, '').toUpperCase(); kind = 'cur'; s = s.slice(cm[0].length); }
  if (s[0] === '-') { neg = !neg; s = s.slice(1).trim(); }
  let m = /^(\d[\d.,\s ]*\d|\d)\s*(.*)$/.exec(s);
  if (!m) return null;
  let v = toNumber(m[1].replace(/[\s ]/g, ''), loc);
  if (v == null) return null;
  let rest = m[2].trim().toLowerCase().replace(/\.$/, '');
  if (rest === '%' || rest === 'persen' || rest === 'pct') { unit = '%'; kind = 'pct'; rest = ''; }
  else if (rest && SCALE[rest] && (kind === 'cur' || /^(rb|ribu|jt|juta|miliar|milyar|triliun|mio)$/.test(rest))) { v *= SCALE[rest]; rest = ''; }
  else if (rest && /^[a-z³²°/.\s]{1,14}$/i.test(rest)) { if (!unit) unit = rest; rest = ''; }
  if (rest) return null;
  if (neg) v = -v;
  return { v, unit, kind };
}

// Period labels for the dimension column: sortable key + kind
//   → {k: 'date'|'month'|'quarter'|'semester'|'year'|'week'|'day'|'weekday'|'hour', o: order key, y?: year}
export function parsePeriod(raw) {
  if (raw instanceof Date) return { k: 'date', o: raw.getTime() / 864e5, y: raw.getFullYear() };
  let s = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s || s.length > 32) return null;
  let m;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s))) return date(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s))) return date(yr(+m[3]), +m[2], +m[1]);
  if ((m = /^(\d{1,2})[\s-]([a-z]{3,9})\.?[\s-,]*(\d{2,4})?$/.exec(s)) && MONMAP[m[2]]) return date(m[3] ? yr(+m[3]) : 2000, MONMAP[m[2]], +m[1], !m[3]);
  if ((m = /^([a-z]{3,9})\.?[\s-/']*(\d{2,4})?$/.exec(s)) && MONMAP[m[1]]) {
    const y = m[2] ? yr(+m[2]) : null;
    return { k: 'month', o: (y || 2000) * 12 + MONMAP[m[1]], y, mo: MONMAP[m[1]] };
  }
  if ((m = /^(\d{4})[-/](\d{1,2})$/.exec(s)) && +m[2] <= 12) return { k: 'month', o: +m[1] * 12 + +m[2], y: +m[1], mo: +m[2] };
  if ((m = /^(\d{1,2})[-/](\d{4})$/.exec(s)) && +m[1] <= 12) return { k: 'month', o: +m[2] * 12 + +m[1], y: +m[2], mo: +m[1] };
  if ((m = /^(?:q|kuartal|triwulan|tw|quarter)\s*-?\s*([1-4]|i{1,3}|iv)\b[\s-/]*(\d{2,4})?$/.exec(s))) { const q = ROMAN[m[1]] || +m[1]; const y = m[2] ? yr(+m[2]) : null; return { k: 'quarter', o: (y || 2000) * 4 + q, y }; }
  if ((m = /^(\d{4})[\s-]*q([1-4])$/.exec(s))) return { k: 'quarter', o: +m[1] * 4 + +m[2], y: +m[1] };
  if ((m = /^(?:semester|smt|sem|s|h)\s*-?\s*([12]|i{1,2})\b[\s-/]*(\d{2,4})?$/.exec(s))) { const q = ROMAN[m[1]] || +m[1]; const y = m[2] ? yr(+m[2]) : null; return { k: 'semester', o: (y || 2000) * 2 + q, y }; }
  if ((m = /^(?:minggu|pekan|week|wk|w|mg)\s*(?:ke)?[\s-]*(\d{1,2}|[ivx]+)$/.exec(s))) { const w = ROMAN[m[1]] || +m[1]; if (w && w <= 53) return { k: 'week', o: w }; }
  if ((m = /^(?:hari|day|tgl|tanggal|h)\s*(?:ke)?[\s-]*(\d{1,3})$/.exec(s))) return { k: 'day', o: +m[1] };
  if ((m = /^(?:tahun|th|thn|year|fy)\s*\.?\s*(\d{4})$/.exec(s))) return { k: 'year', o: +m[1], y: +m[1] };
  if (/^(19[5-9]\d|20[0-5]\d)$/.test(s)) return { k: 'year', o: +s, y: +s };
  if (DAYS[s.replace(/[.,]$/, '')]) return { k: 'weekday', o: DAYS[s.replace(/[.,]$/, '')] };
  if ((m = /^(?:jam|pukul)?\s*(\d{1,2})[:.](\d{2})(?:\s*[-–]\s*\d{1,2}[:.]\d{2})?$/.exec(s)) && +m[1] < 25) return { k: 'hour', o: +m[1] * 60 + +m[2] };
  if ((m = /^(?:shift|sif)\s*([1-4]|i{1,3}|[a-d])$/.exec(s))) return null;      // shifts are categories
  return null;
}
const yr = y => (y < 100 ? 2000 + y : y);
function date(y, mo, d, noYear) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const t = Date.UTC(y, mo - 1, d) / 864e5;
  return { k: 'date', o: t, y: noYear ? null : y, mo, d };
}

// Unit from a header: "Produksi (ton)" → 'ton', "Biaya [Rp]" → 'Rp', "Pencapaian %" → '%'
export function headerUnit(hd) {
  const s = String(hd || '');
  let m = /[([]\s*([^)\]]{1,16}?)\s*[)\]]/.exec(s);
  if (m) {
    const u = m[1].trim();
    if (/^(rp|idr|rupiah)(\s*(juta|jt|rb|ribu|miliar|m))?$/i.test(u) || /^(juta|jt|ribu|rb|miliar|milyar)\s*(rp|rupiah|idr)$/i.test(u)) return /juta|jt/i.test(u) ? 'Rp jt' : /miliar|milyar|\bm\b/i.test(u) ? 'Rp M' : /rb|ribu/i.test(u) ? 'Rp rb' : 'Rp';
    if (/^%$/.test(u)) return '%';
    if (/^[a-z³²°/.\s-]{1,12}$/i.test(u) && !/^(opsional|optional|catatan|note)$/i.test(u)) return u;
  }
  if (/%\s*$|\b(persen|persentase|pencapaian|capaian|achievement|rasio|ratio|yield|efisiensi|utilisasi|utilization|availability|oee)\b/i.test(s)) return '%';
  if (/\b(rp|rupiah|idr)\b/i.test(s)) return 'Rp';
  m = /\b(ton|tons|kg|gram|liter|ltr|m3|m³|bcm|mt|pcs|unit|jam|menit|hari|orang|km|kwh|mwh|bbl|lembar|box|karung|sak|batang|rim)\b/i.exec(s);
  return m ? m[1].toLowerCase() : '';
}

// Header roles that matter for reports
export const RX = {
  target: /\b(target|rencana|plan|planned|rkap|rkab|budget|anggaran|sasaran|forecast|proyeksi|kuota|quota|estimasi)\b/i,
  actual: /\b(realisasi|aktual|actual|capaian|hasil|output|terealisasi|real|riil)\b/i,
  ach: /\b(pencapaian|capaian\s*%|achievement|ach\.?|% ?(?:of )?target|persentase capaian|kinerja)\b/i,
  total: /^(sub[\s-]?)?(total|jumlah|grand total|jml|sum|keseluruhan|total keseluruhan|rata[\s-]?rata|average|rerata)\b/i,
  index: /^(no\.?|nomor|#|urut|nr\.?|no urut|kode|id|sn)$/i,
  bad: /\b(downtime|kerusakan|cacat|defect|reject|scrap|gangguan|masalah|keluhan|complaint|kecelakaan|insiden|incident|loss|rugi|kerugian|waste|limbah|breakdown|delay|keterlambatan|penyebab|stop|idle|rework|retur|komplain|susut)\b/i,
  share: /\b(porsi|share|kontribusi|komposisi|proporsi|distribusi|bauran|mix)\b/i,
};
