// Q&A over one or more learned documents: hybrid retrieval → Gemma 4 answer with numbered sources.
// Without AI: the most relevant passages + direct answers from the table statistics.
import { loadDoc, facts, tokensOf } from './learn.js';
import { AI, chat, embed } from './ai.js';
import { fuse, vecSearch, tokens } from './search.js';
import { tableBrief, tableText, mName, short } from './analyze.js';
import { fmtVal, fmtNum } from './util.js';

const NUMQ = /\b(berapa|jumlah|total|rata|rerata|persen|%|tertinggi|terendah|terbesar|terkecil|paling|maks|min|naik|turun|tren|selisih|banding|target|realisasi|capai|pencapaian|growth|how many|how much|average|highest|lowest|most|least|percent|compare|sum)\b/i;

const SYS = `Anda adalah asisten "Amatu Paparan" yang menjawab pertanyaan berdasarkan dokumen milik pengguna.
Aturan:
1. Jawab HANYA dari SUMBER dan STATISTIK TABEL di bawah. Jangan memakai pengetahuan luar untuk fakta, angka, nama, atau tanggal.
2. Jika jawabannya tidak ada di sumber, katakan dengan jelas bahwa informasi itu tidak ditemukan di dokumen, lalu sebutkan informasi terdekat yang ada.
3. Kalimat pertama langsung menjawab pertanyaan. Setelah itu beri rincian seperlunya: poin-poin, atau tabel markdown bila membandingkan banyak angka.
4. Beri rujukan nomor sumber seperti [2] tepat setelah kalimat yang memakai sumber itu. Hanya pakai nomor sumber yang ada.
5. Tulis angka persis seperti di dokumen (format Indonesia, mis. 12.450,5). Jika menghitung (jumlah, selisih, persentase), tunjukkan perhitungan singkatnya.
6. Jawab dalam bahasa yang sama dengan pertanyaan. Ringkas dan to the point; jangan mengulang pertanyaan; jangan menutup dengan basa-basi.`;

export function unitLabel(c, u) { return c.units[u]?.label || ''; }

// sources for a question across docs
async function retrieve(q, docs, budgetTok) {
  const multi = docs.length > 1;
  let qv = null;
  if (AI.ok() && docs.some(L => L.vec)) {
    try { qv = (await embed([q]))[0]; } catch { }
  }
  const per = Math.floor(budgetTok / docs.length);
  const picks = [];
  for (const L of docs) {
    const ch = L.content.chunks;
    const total = ch.reduce((a, k) => a + tokensOf(k.x), 0);
    if (total <= Math.min(per, 6500) && !multi) { ch.forEach((k, r) => picks.push({ L, k, s: 1 - r * 1e-4 })); continue; }
    const lists = [L.bm.search(q, 40)];
    if (qv && L.vec) lists.push(vecSearch(L.vec, qv, 40));
    const ranked = fuse(lists);
    let used = 0;
    const chosen = new Set();
    for (const r of ranked) {
      const k = ch[r.i];
      const t = tokensOf(k.x);
      if (used + t > per) continue;
      chosen.add(r.i); used += t;
      picks.push({ L, k, s: r.s });
      if (used > per * 0.92) break;
    }
    // a little context around the best hits
    for (const r of ranked.slice(0, 3)) for (const j of [r.i - 1, r.i + 1]) {
      if (j < 0 || j >= ch.length || chosen.has(j)) continue;
      const t = tokensOf(ch[j].x);
      if (used + t > per * 1.15) continue;
      chosen.add(j); used += t; picks.push({ L, k: ch[j], s: r.s * 0.5 });
    }
    if (!picks.some(p => p.L === L) && ch.length) picks.push({ L, k: ch[0], s: 0.001 });
  }
  // document order within each doc reads better
  picks.sort((a, b) => (a.L === b.L ? a.k.i - b.k.i : docs.indexOf(a.L) - docs.indexOf(b.L)));
  return picks;
}

function relevantTables(q, L) {
  const fs = facts(L);
  const qt = new Set(tokens(q));
  return fs.tables.map(T => {
    let s = 0;
    for (const w of tokens(T.title + ' ' + T.head.join(' '))) if (qt.has(w)) s += 1;
    for (const lab of T.A.labels.slice(0, 400)) if (lab && lab.length > 2 && q.toLowerCase().includes(lab.toLowerCase())) s += 2;
    return { T, s };
  }).filter(x => x.s > 0 || fs.tables.length <= 2).sort((a, b) => b.s - a.s).slice(0, 4).map(x => x.T);
}

// ask({q, ids, history:[{role, text}], onDelta, signal}) → {text, cites, mode}
export async function ask({ q, ids, history = [], onDelta, signal }) {
  const docs = (await Promise.all(ids.map(loadDoc))).filter(Boolean);
  if (!docs.length) throw new Error('Dokumen belum siap');
  const prevQ = [...history].reverse().find(m => m.role === 'user')?.text || '';
  const rq = q.length < 60 && prevQ ? q + ' ' + prevQ : q;
  const picks = await retrieve(rq, docs, docs.length > 1 ? 7000 : 6500);
  const sources = picks.map((p, n) => ({ n: n + 1, doc: p.L.meta.id, name: p.L.meta.name, i: p.k.i, u: p.k.u, label: unitLabel(p.L.content, p.k.u), h: p.k.h, x: p.k.x, ti: p.k.ti, rows: p.k.rows }));
  const numeric = NUMQ.test(q);
  const tabs = [];
  for (const L of docs) for (const T of relevantTables(rq, L)) tabs.push({ L, T });
  if (AI.ok()) {
    try {
      const head = docs.map(L => `- ${L.meta.name}${L.meta.digest?.type ? ' (' + L.meta.digest.type + ')' : ''}: ${short(L.meta.digest?.summary || '', 500)}`).join('\n');
      let stat = '';
      for (const { L, T } of tabs.slice(0, numeric ? 4 : 2)) {
        stat += tableBrief(T) + '\n';
        if (numeric && T.A.n <= 80 && !sources.some(s => s.doc === L.meta.id && s.ti === T.ti && s.rows && s.rows[0] === 0 && s.rows[1] >= T.A.rows.length - 1)) {
          const n = sources.length + 1;
          const t = L.content.tables[T.ti];
          sources.push({ n, doc: L.meta.id, name: L.meta.name, i: -1, u: t.u, label: unitLabel(L.content, t.u), h: '', x: `Tabel lengkap: ${t.title || T.title}\n${tableText(t, 80, 9000)}`, ti: T.ti, rows: [0, t.rows.length - 1] });
        }
      }
      const src = sources.map(s => `[${s.n}] ${docs.length > 1 ? short(s.name, 40) + ' · ' : ''}${s.label}${s.h ? ' · ' + short(s.h, 80) : ''}\n${s.x}`).join('\n\n');
      const user = `DOKUMEN:\n${head}\n\n${stat ? 'STATISTIK TABEL (dihitung otomatis dari semua baris data):\n' + stat + '\n' : ''}SUMBER:\n${src}\n\nPERTANYAAN: ${q}`;
      const msgs = [{ role: 'system', content: SYS }];
      for (const m of history.slice(-6)) msgs.push({ role: m.role === 'user' ? 'user' : 'assistant', content: short(m.text, 1500) });
      msgs.push({ role: 'user', content: user });
      const r = await chat({ messages: msgs, max: 1400, temp: 0.2, stream: true, onDelta, signal });
      return { text: r.text.trim(), cites: citesOf(r.text, sources), sources, mode: 'ai', model: r.model };
    } catch (e) {
      if (e.code === 'batal') throw e;
      console.warn('qa ai', e);
    }
  }
  return offline(q, docs, sources, tabs);
}

export function citesOf(text, sources) {
  const seen = new Set();
  for (const m of String(text).matchAll(/\[(\d+(?:\s*[,;–-]\s*\d+)*)\]/g)) for (const n of m[1].split(/[,;–-]/)) seen.add(+n.trim());
  return sources.filter(s => seen.has(s.n));
}

// ---------- without AI ----------
const AGG = [
  [/\b(total|jumlah|keseluruhan|sum)\b/i, 'sum'], [/\b(rata|rerata|average|mean)\b/i, 'mean'],
  [/\b(tertinggi|terbesar|terbanyak|maks|maksimum|paling (besar|banyak|tinggi)|highest|max|most)\b/i, 'max'],
  [/\b(terendah|terkecil|tersedikit|minimum|min|paling (kecil|sedikit|rendah)|lowest|least)\b/i, 'min'],
  [/\b(pencapaian|capaian|persen|achievement|target)\b/i, 'ach'], [/\b(tren|naik|turun|perubahan|trend|growth)\b/i, 'trend'],
];
function offline(q, docs, sources, tabs) {
  const lines = [];
  const qq = q.toLowerCase();
  const agg = AGG.filter(([rx]) => rx.test(q)).map(x => x[1]);
  for (const { T } of tabs.slice(0, 2)) {
    const A = T.A;
    const qt = new Set(tokens(q));
    let m = A.measures.map(m => ({ m, s: tokens(m.name).filter(w => qt.has(w)).length })).sort((a, b) => b.s - a.s)[0]?.m || A.measures[0];
    if (!m || !m.st.n) continue;
    const row = A.labels.findIndex(l => l && l.length > 1 && qq.includes(l.toLowerCase()));
    const nm = mName(m);
    if (row >= 0 && m.vals[row] != null) lines.push(`**${nm}** untuk **${A.labels[row]}**: ${fmtVal(m.vals[row], m.unit)} (tabel ${T.title}).`);
    for (const a of agg) {
      if (a === 'sum' && m.additive) lines.push(`Total **${nm}**: ${fmtVal(m.docTotal ?? m.st.sum, m.unit)}.`);
      if (a === 'mean') lines.push(`Rata-rata **${nm}**: ${fmtVal(m.st.mean, m.unit)}.`);
      if (a === 'max') lines.push(`Tertinggi: **${m.st.maxL}** (${fmtVal(m.st.max, m.unit)}).`);
      if (a === 'min') lines.push(`Terendah: **${m.st.minL}** (${fmtVal(m.st.min, m.unit)}).`);
      if (a === 'trend' && m.st.changePct != null) lines.push(`Dari ${m.st.firstL} ke ${m.st.lastL}: ${fmtVal(m.st.first, m.unit)} → ${fmtVal(m.st.last, m.unit)} (${m.st.changePct > 0 ? '+' : ''}${fmtNum(m.st.changePct, 1)}%).`);
      if (a === 'ach') for (const p of A.pairs) lines.push(`Pencapaian **${mName(p.a)}**: ${fmtNum(p.ach, 1)}% dari target (${p.met} dari ${p.n} memenuhi target).`);
    }
    if (lines.length) break;
  }
  const top = sources.slice(0, 3);
  let text = '';
  if (lines.length) text += [...new Set(lines)].join('\n\n') + '\n\n';
  text += top.length ? (lines.length ? 'Bagian dokumen yang terkait:' : 'Bagian dokumen yang paling relevan dengan pertanyaan Anda:') + '\n\n' + top.map(s => `> ${short(s.x.replace(/\n+/g, ' '), 420)} [${s.n}]`).join('\n\n') : 'Belum menemukan bagian dokumen yang cocok. Coba gunakan kata kunci yang ada di dokumen.';
  return { text, cites: top, sources, mode: 'offline' };
}
