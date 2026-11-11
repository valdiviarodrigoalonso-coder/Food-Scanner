// Tiny key-value store on IndexedDB (falls back to localStorage, then memory).
// Everything stays on this device; nothing is uploaded anywhere.

const DB_NAME = 'sidekick';
const STORE = 'kv';
let dbp = null;
let mode = 'idb';
const mem = new Map();

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Storage blocked'));
  }).catch((e) => {
    console.warn('IndexedDB unavailable, using fallback storage', e);
    mode = 'ls';
    try {
      localStorage.setItem('__t', '1');
      localStorage.removeItem('__t');
    } catch {
      mode = 'mem';
    }
    return null;
  });
  return dbp;
}

function tx(db, type, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, type);
    const res = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(res && 'result' in res ? res.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function getAll() {
  const db = await open();
  const out = {};
  if (db) {
    await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, 'readonly');
      const req = t.objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (c) {
          out[c.key] = c.value;
          c.continue();
        } else resolve();
      };
      req.onerror = () => reject(req.error);
    });
  } else if (mode === 'ls') {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith('ml:')) {
        try {
          out[k.slice(3)] = JSON.parse(localStorage.getItem(k));
        } catch {}
      }
    }
  } else {
    for (const [k, v] of mem) out[k] = v;
  }
  return out;
}

export async function set(key, value) {
  const db = await open();
  if (db) return tx(db, 'readwrite', (s) => s.put(value, key));
  if (mode === 'ls') localStorage.setItem('ml:' + key, JSON.stringify(value));
  else mem.set(key, value);
}

export async function del(key) {
  const db = await open();
  if (db) return tx(db, 'readwrite', (s) => s.delete(key));
  if (mode === 'ls') localStorage.removeItem('ml:' + key);
  else mem.delete(key);
}

export async function clearAll() {
  const db = await open();
  if (db) return tx(db, 'readwrite', (s) => s.clear());
  if (mode === 'ls') Object.keys(localStorage).filter((k) => k.startsWith('ml:')).forEach((k) => localStorage.removeItem(k));
  else mem.clear();
}

export const storageMode = () => mode;

/** Ask the browser not to evict our data. Returns true if granted. */
export async function persist() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch {}
  return false;
}
