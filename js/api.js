// Online lookups for packaged foods:
//   - Open Food Facts (3M+ barcoded products, community-entered label data, no key needed)
//   - USDA FoodData Central "Branded" (label data supplied by manufacturers, free API key)
import { parseOFF, parseFDC } from './nutrition.js';

const OFF = 'https://world.openfoodfacts.org';
const FDC = 'https://api.nal.usda.gov/fdc/v1';
const OFF_FIELDS = [
  'code', 'product_name', 'product_name_en', 'generic_name', 'brands', 'nutriments', 'serving_size', 'serving_quantity', 'serving_quantity_unit',
  'nutrition_data_per', 'quantity', 'product_quantity', 'nutriscore_grade', 'nova_group', 'additives_tags', 'ingredients_text', 'ingredients_text_en',
].join(',');

async function getJSON(url, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, ok: res.ok, json };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('timed out');
    throw new Error(navigator.onLine === false ? 'you are offline' : 'network error');
  } finally {
    clearTimeout(timer);
  }
}

const stripZeros = (c) => String(c).replace(/^0+/, '');

/** UPC-E (8 digits) -> UPC-A (12 digits). Returns null if it is not a valid UPC-E pattern. */
export function upcEtoA(e) {
  if (!/^[01]\d{7}$/.test(e)) return null;
  const [ns, d1, d2, d3, d4, d5, d6, chk] = e.split('');
  let body;
  if ('012'.includes(d6)) body = d1 + d2 + d6 + '0000' + d3 + d4 + d5;
  else if (d6 === '3') body = d1 + d2 + d3 + '00000' + d4 + d5;
  else if (d6 === '4') body = d1 + d2 + d3 + d4 + '00000' + d5;
  else body = d1 + d2 + d3 + d4 + d5 + '0000' + d6;
  return ns + body + chk;
}

export async function offByBarcode(code) {
  const r = await getJSON(`${OFF}/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`);
  if (r.status === 404 || (r.json && r.json.status === 0)) return null;
  if (!r.json) throw new Error(r.status === 429 ? 'Open Food Facts is busy — try again in a minute' : 'Open Food Facts did not answer');
  if (!r.json.product) return null;
  return parseOFF({ ...r.json.product, code: r.json.product.code || r.json.code || code });
}

function fdcError(r) {
  const code = r.json && r.json.error && r.json.error.code;
  if (r.status === 429 || code === 'OVER_RATE_LIMIT') return new Error('USDA hourly limit reached — add your free USDA key in Settings for 1,000 lookups/hour');
  if (r.status === 403 || code === 'API_KEY_INVALID' || code === 'API_KEY_MISSING') return new Error('USDA key was rejected — check it in Settings');
  return new Error('USDA did not answer');
}

export async function fdcByBarcode(code, key) {
  const r = await getJSON(`${FDC}/foods/search?api_key=${encodeURIComponent(key || 'DEMO_KEY')}&query=${encodeURIComponent(code)}&dataType=Branded&pageSize=10`);
  if (!r.ok || !r.json) throw fdcError(r);
  const want = stripZeros(code);
  const hits = (r.json.foods || []).filter((f) => f.gtinUpc && stripZeros(f.gtinUpc) === want);
  if (!hits.length) return null;
  hits.sort((a, b) => String(b.publishedDate || '').localeCompare(String(a.publishedDate || '')));
  return parseFDC(hits[0]);
}

/**
 * The same barcode can be written with 12, 13 or 14 digits (UPC-A, EAN-13, GTIN-14 — they differ only
 * in leading zeros). Phone scanners report US products as 13 digits with a leading 0, while USDA mostly
 * stores the 12-digit form. Returns the forms to try, most likely first.
 */
export function gtinForms(code) {
  const core = stripZeros(code);
  if (!core) return [code];
  const forms = core.length <= 12 ? [core.padStart(12, '0'), core.padStart(13, '0'), core.padStart(14, '0')] : [core.padStart(13, '0'), core.padStart(14, '0')];
  return [...new Set(forms)];
}

/**
 * Look a barcode up in both databases at once.
 * Returns { food, other, errors } — `food` is the one we trust most (manufacturer data first),
 * `other` is the second opinion (used to warn when the two disagree).
 */
export async function lookupBarcode(code, { usdaKey } = {}) {
  const codes = [code];
  if (code.length === 8) {
    const a = upcEtoA(code);
    if (a) codes.push(a);
  }
  // USDA only matches the exact digits a manufacturer filed, so try each common way of writing the code.
  const fdcCodes = gtinForms(codes[codes.length - 1]).slice(0, usdaKey ? 3 : 2);
  const errors = [];
  const tryOFF = async () => {
    for (const c of codes) {
      const f = await offByBarcode(c);
      if (f) return f;
    }
    return null;
  };
  const tryFDC = async () => {
    for (const c of fdcCodes) {
      const f = await fdcByBarcode(c, usdaKey);
      if (f) return f;
    }
    return null;
  };
  const [off, fdc] = await Promise.all([
    tryOFF().catch((e) => (errors.push('Open Food Facts: ' + e.message), null)),
    tryFDC().catch((e) => (errors.push(e.message.startsWith('USDA') ? e.message : 'USDA: ' + e.message), null)),
  ]);
  if (fdc && off) {
    fdc.extra = { ...off.extra, ...fdc.extra, ingredients: fdc.extra.ingredients || off.extra.ingredients };
    if (!fdc.portions.length) fdc.portions = off.portions;
    return { food: { ...fdc, barcode: code }, other: off, errors };
  }
  const food = fdc || off;
  return { food: food ? { ...food, barcode: code } : null, other: null, errors };
}

// Open Food Facts allows roughly 10 text searches a minute and blocks clients that go faster,
// so searches are spaced out and anything already searched is remembered for this session.
const OFF_GAP_MS = 6500;
let offNextAt = 0;
const offCache = new Map();
async function offGate() {
  const now = Date.now();
  const wait = Math.max(0, offNextAt - now);
  offNextAt = Math.max(now, offNextAt) + OFF_GAP_MS;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

export async function offSearch(q) {
  const key = q.toLowerCase();
  if (offCache.has(key)) return offCache.get(key);
  // Products sold in the US first (most relevant); the whole world only if that finds nothing.
  const url = (host) => `${host}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=24&sort_by=unique_scans_n&fields=${OFF_FIELDS}`;
  const attempt = async (host) => {
    await offGate();
    return getJSON(url(host), 15000).catch(() => null);
  };
  let r = await attempt('https://us.openfoodfacts.org');
  if (r && r.json && !(r.json.products || []).length) r = (await attempt(OFF)) || r;
  if (!r || !r.json) throw new Error('Open Food Facts search is busy right now (it only allows about 10 searches a minute). Barcode scans still work — or try the search again in a minute');
  const items = (r.json.products || [])
    .filter((p) => p && p.code && (p.product_name || p.product_name_en))
    .map(parseOFF)
    .filter((f) => f.per100.kcal != null || f.per100.protein != null);
  offCache.set(key, items);
  return items;
}

export async function fdcSearch(q, key) {
  const r = await getJSON(`${FDC}/foods/search?api_key=${encodeURIComponent(key || 'DEMO_KEY')}&query=${encodeURIComponent(q)}&dataType=Branded&pageSize=25&requireAllWords=true`);
  if (!r.ok || !r.json) throw fdcError(r);
  // The branded database keeps old versions of the same product; keep only the newest per barcode.
  const newest = new Map();
  for (const f of r.json.foods || []) {
    const k = f.gtinUpc ? stripZeros(f.gtinUpc) : 'id' + f.fdcId;
    const prev = newest.get(k);
    if (!prev || String(f.publishedDate || '') > String(prev.publishedDate || '')) newest.set(k, f);
  }
  return [...newest.values()].map(parseFDC);
}

function mergeOnline(fdc, off) {
  const seen = new Set();
  const items = [];
  // interleave so both sources are visible; drop Open Food Facts duplicates of a USDA barcode
  for (const f of fdc) if (f.barcode) seen.add(stripZeros(f.barcode));
  const offUnique = off.filter((f) => !seen.has(stripZeros(f.barcode)));
  const n = Math.max(fdc.length, offUnique.length);
  for (let i = 0; i < n; i++) {
    if (fdc[i]) items.push(fdc[i]);
    if (offUnique[i]) items.push(offUnique[i]);
  }
  return items;
}

/**
 * Search both online databases. Never throws; problems come back in `errors`.
 * onUpdate({ items, errors, pending }) fires as each database answers, so fast results show first.
 */
export async function searchOnline(q, { usdaKey } = {}, onUpdate = () => {}) {
  const errors = [];
  let fdc = [];
  let off = [];
  let pending = 2;
  const done = () => {
    pending--;
    onUpdate({ items: mergeOnline(fdc, off), errors: [...errors], pending });
  };
  await Promise.all([
    fdcSearch(q, usdaKey).then((r) => (fdc = r), (e) => errors.push(e.message)).then(done),
    offSearch(q).then((r) => (off = r), (e) => errors.push(e.message)).then(done),
  ]);
  return { items: mergeOnline(fdc, off), errors };
}
