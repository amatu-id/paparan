// Third-party libraries, loaded only when a file type needs them.

const U = {
  pdfjs: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs',
  pdfWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs',
  pdfBase: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/',
  xlsx: 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
  jszip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  docx: 'https://cdn.jsdelivr.net/npm/docx-preview@0.3.5/dist/docx-preview.min.js',
  tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  pptx: 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js',
  h2i: 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js',
  jspdf: 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js',
};

const loaded = {};
export function script(url) {
  return loaded[url] ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = url; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = () => res();
    s.onerror = () => { delete loaded[url]; rej(new Error('Gagal memuat pustaka: ' + url.split('/').slice(-1)[0])); };
    document.head.append(s);
  });
}

let pdfp;
export function pdfjs() {
  return pdfp ||= import(U.pdfjs).then(m => {
    // a worker can't load cross-origin directly: wrap it in a same-origin blob module that imports the CDN file
    const src = URL.createObjectURL(new Blob([`import "${U.pdfWorker}";`], { type: 'text/javascript' }));
    m.GlobalWorkerOptions.workerPort = new Worker(src, { type: 'module' });
    return m;
  }).catch(e => { pdfp = null; throw e; });
}
export const pdfOpts = { cMapUrl: U.pdfBase + 'cmaps/', cMapPacked: true, standardFontDataUrl: U.pdfBase + 'standard_fonts/', isEvalSupported: false };

export async function XLSX() { await script(U.xlsx); return window.XLSX; }
export async function JSZip() { await script(U.jszip); return window.JSZip; }
export async function docxPreview() { await script(U.jszip); await script(U.docx); return window.docx; }
export async function Tesseract() { await script(U.tesseract); return window.Tesseract; }
export async function PptxGen() { await script(U.pptx); return window.PptxGenJS; }
export async function htmlToImage() { await script(U.h2i); return window.htmlToImage; }
export async function jsPDF() { await script(U.jspdf); return window.jspdf.jsPDF; }

// OCR worker (Indonesian + English), shared and kept while the page is open
let ocrp;
export function ocr() {
  return ocrp ||= (async () => {
    const T = await Tesseract();
    return T.createWorker(['ind', 'eng'], 1, { logger: () => { } });
  })().catch(e => { ocrp = null; throw e; });
}
