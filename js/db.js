// IndexedDB 'amatu-paparan'. /amatu.js records every write here and syncs it to the portal account
// (records over 25 MB, e.g. a very big PDF, stay on this device only).
//   docs    {id, name, ext, mime, size, added, status, ...}         light listing data
//   content {id, kind, units, blocks, tables, chunks, meta, stats}   what was learned from the file
//   files   {id, blob}                                               the original file
//   vec     {id, d, v: Int8Array, s: Float32Array}                   chunk embeddings (bge-m3)
//   decks   {id, doc, title, created, spec, theme, opts}             generated presentations
//   chats   {id, msgs: [...]}                                        Q&A history per document (id = doc id or 'all')

const DBN = 'amatu-paparan';
const STORES = ['docs', 'content', 'files', 'vec', 'decks', 'chats'];
let dbp = null;
const bc = 'BroadcastChannel' in self ? new BroadcastChannel('amatu-paparan') : null;
const subs = new Set();
bc && (bc.onmessage = e => subs.forEach(f => f(e.data)));

function open() {
  return dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DBN, 1);
    r.onupgradeneeded = () => { const d = r.result; for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }); };
    r.onsuccess = () => {
      const d = r.result;
      d.onversionchange = () => { d.close(); dbp = null; };
      res(d);
    };
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('blocked'));
  });
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = t => new Promise((res, rej) => { t.oncomplete = res; t.onerror = t.onabort = () => rej(t.error); });
async function os(name, mode = 'readonly') { return (await open()).transaction(name, mode).objectStore(name); }
const tell = msg => { bc?.postMessage(msg); subs.forEach(f => f(msg)); };

export const DB = {
  on(f) { subs.add(f); return () => subs.delete(f); },
  async get(store, id) { try { return await req((await os(store)).get(id)); } catch { return null; } },
  async all(store) { try { return await req((await os(store)).getAll()); } catch { return []; } },
  async put(store, v) { await req((await os(store, 'readwrite')).put(v)); tell({ s: store, id: v.id }); return v; },
  async patch(store, id, p) {
    const s = await os(store, 'readwrite');
    const v = await req(s.get(id));
    if (!v) return null;
    Object.assign(v, p);
    await req(s.put(v));
    tell({ s: store, id });
    return v;
  },
  async del(store, id) { await req((await os(store, 'readwrite')).delete(id)); tell({ s: store, id, del: 1 }); },
  // a document and everything made from it
  async removeDoc(id) {
    const d = await open();
    const decks = (await DB.all('decks')).filter(k => k.doc === id).map(k => k.id);
    const t = d.transaction(STORES, 'readwrite');
    for (const s of ['docs', 'content', 'files', 'vec', 'chats']) t.objectStore(s).delete(id);
    for (const k of decks) t.objectStore('decks').delete(k);
    await done(t);
    tell({ s: 'docs', id, del: 1 });
  },
  async usage() {
    try { const e = await navigator.storage.estimate(); return e; } catch { return null; }
  },
};
