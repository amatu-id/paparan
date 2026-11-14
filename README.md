# Amatu Paparan

Unggah dokumen apa pun → AI mempelajari isinya → tanya jawab & paparan presentasi otomatis —
https://amatu-id.github.io/paparan/ (aplikasi Portal AMATU).

- **Belajar dokumen**: PDF (termasuk hasil scan, lewat OCR), Word (DOCX/ODT, DOC lama seadanya), Excel (XLSX/XLS/ODS/CSV),
  PowerPoint (PPTX/ODP, termasuk data grafik & catatan pembicara), gambar (OCR), teks/Markdown/HTML/JSON.
  Tabel direkonstruksi dari posisi teks PDF (tabel yang terpotong antarhalaman disambung), angka format Indonesia dibaca benar.
- **Tanya jawab**: pencarian hibrida (BM25 + embedding bge-m3) → Gemma 4 menjawab hanya dari isi dokumen, dengan rujukan [n]
  yang bisa diklik (halaman PDF disorot, sel Excel ditandai). Bisa per dokumen atau semua dokumen.
- **Paparan otomatis**: statistik tabel dihitung tanpa AI (total, rata-rata, target vs realisasi, tren, porsi, pareto),
  lalu AI menyusun alur cerita gaya konsultan (judul berupa insight, ringkasan eksekutif, grafik, kesimpulan & rekomendasi,
  catatan pembicara). Setiap angka di slide dicek ke dokumen; kalimat dengan angka yang tidak ditemukan dibuang.
- **Viewer**: file asli (PDF, Word, Excel, gambar) + "teks terbaca"; paparan: thumbnail, edit teks (klik dua kali),
  mode presentasi layar penuh, ekspor PowerPoint (teks, tabel & grafik native — bisa diedit), PDF, dan "Edit di Amatu Slides".
- **Tanpa AI** (belum masuk portal / kuota habis): semua tetap jalan dengan mesin otomatis (ringkasan ekstraktif,
  jawaban dari bagian dokumen + statistik tabel, paparan berbasis aturan).

## Susunan

| Berkas | Isi |
| --- | --- |
| `index.html`, `css/app.css`, `js/app.js` | halaman (ES modules, tanpa build) |
| `js/extract.js`, `js/office.js`, `js/layout.js` | pembaca file → blok, tabel, posisi per halaman |
| `js/numparse.js`, `js/analyze.js` | angka/periode/satuan, analisis tabel, fakta (F1…) & kandidat grafik (C1…) |
| `js/learn.js`, `js/search.js` | potongan pengetahuan, BM25, vektor int8, ringkasan |
| `js/qa.js`, `js/md.js` | tanya jawab + markdown aman |
| `js/plan.js`, `js/compose.js`, `js/charts.js`, `js/render.js`, `js/themes.js`, `js/fit.js` | rencana slide, tata letak 960×540, grafik SVG, tema |
| `js/deckview.js`, `js/export.js`, `js/viewer.js` | UI paparan, ekspor PPTX/PDF/Amatu Slides, viewer dokumen |
| `cloud/supabase/functions/amatu-paparan` | gerbang: cek login portal, teruskan ke Worker |
| `cloud/worker` | Worker `amatu-paparan`: Gemma 4 (chat, streaming) + bge-m3 (embedding) |
| `assets/contoh-laporan-produksi.pdf` | contoh laporan produksi (data fiktif) untuk tombol "Coba contoh" |

Halaman → edge function Supabase (project amatu-id) → Worker `amatu-paparan.liemyo.workers.dev`. Halaman tidak memanggil
`*.workers.dev` langsung karena DNS domain itu dibelokkan sebagian ISP Indonesia. Data (file, hasil belajar, paparan,
riwayat tanya jawab) ada di IndexedDB `amatu-paparan`, disinkronkan ke akun portal oleh `/amatu.js`.

## Deploy

```bash
git push                                   # halaman (GitHub Pages, branch main)
cd cloud/worker && npx wrangler@4 deploy   # Worker (rahasia KEY)
cd cloud && supabase functions deploy amatu-paparan --project-ref ieyqxmzztoxgpvwexbkj --no-verify-jwt --use-api
```

Rahasia: Worker `KEY` = Supabase `PAPARAN_AI_KEY` (+ `PAPARAN_AI_URL`). Kalau hilang, buat yang baru dan pasang di keduanya.
Kuota Workers AI gratis (10.000 neuron/hari) dipakai bersama Translator; satu pertanyaan ≈ 50–100 neuron, satu paparan ≈ 250–400.
