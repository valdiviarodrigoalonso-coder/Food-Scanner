// Pure nutrition math: no DOM, no storage. Everything here is covered by tests/run-tests.mjs.
// Golden rule: a missing value is `null`, never 0. We never pretend to know a number we don't have.

export const NUTRIENTS = [
  { key: 'kcal', label: 'Calories', unit: 'kcal', dec: 0 },
  { key: 'protein', label: 'Protein', unit: 'g', dec: 1 },
  { key: 'carbs', label: 'Carbs', unit: 'g', dec: 1 },
  { key: 'fat', label: 'Fat', unit: 'g', dec: 1 },
  { key: 'fiber', label: 'Fiber', unit: 'g', dec: 1 },
  { key: 'sugar', label: 'Sugar', unit: 'g', dec: 1 },
  { key: 'satFat', label: 'Saturated fat', unit: 'g', dec: 1 },
  { key: 'sodium', label: 'Sodium', unit: 'mg', dec: 0 },
  { key: 'potassium', label: 'Potassium', unit: 'mg', dec: 0 },
  { key: 'cholesterol', label: 'Cholesterol', unit: 'mg', dec: 0 },
];
export const KEYS = NUTRIENTS.map((n) => n.key);
export const NUTRIENT = Object.fromEntries(NUTRIENTS.map((n) => [n.key, n]));

// Exact conversion factors (international avoirdupois ounce / US fluid ounce).
export const G_PER_OZ = 28.349523125;
export const G_PER_LB = 453.59237;
export const ML_PER_FLOZ = 29.5735295625;
export const KJ_PER_KCAL = 4.184;

export const emptyNutrients = () => Object.fromEntries(KEYS.map((k) => [k, null]));

const num = (v) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
};
export const toNum = num;

/** Nutrients for `amount` grams (or ml) of a food whose values are per 100 g (or 100 ml). */
export function scale(per100, amount) {
  const out = {};
  for (const k of KEYS) out[k] = per100[k] == null ? null : (per100[k] * amount) / 100;
  return out;
}

/**
 * Sum a list of log entries. For every nutrient we also report how many entries had no data
 * (`missing`) or only partial data (`partial`), so the UI can say "at least X mg" instead of lying.
 */
export function totals(entries) {
  const t = {};
  for (const k of KEYS) t[k] = { sum: 0, missing: 0, estimated: 0, missingNames: [] };
  for (const e of entries) {
    const n = scale(e.food.per100, e.amount);
    const est = e.food.quality === 'estimate';
    for (const k of KEYS) {
      if (n[k] == null) {
        t[k].missing++;
        t[k].missingNames.push(e.food.name);
      } else {
        t[k].sum += n[k];
        if (e.food.partial && e.food.partial.includes(k)) {
          t[k].missing++;
          t[k].missingNames.push(e.food.name);
        }
        if (est) t[k].estimated++;
      }
    }
  }
  return t;
}

/** Convert a quantity in a unit to grams (or ml for volume-based foods). */
export function toBase(qty, unit, portionGrams) {
  switch (unit) {
    case 'g':
    case 'ml':
      return qty;
    case 'oz':
      return qty * G_PER_OZ;
    case 'lb':
      return qty * G_PER_LB;
    case 'floz':
      return qty * ML_PER_FLOZ;
    case 'portion':
      return qty * portionGrams;
    default:
      throw new Error('Unknown unit ' + unit);
  }
}
export function fromBase(base, unit, portionGrams) {
  switch (unit) {
    case 'g':
    case 'ml':
      return base;
    case 'oz':
      return base / G_PER_OZ;
    case 'lb':
      return base / G_PER_LB;
    case 'floz':
      return base / ML_PER_FLOZ;
    case 'portion':
      return base / portionGrams;
    default:
      throw new Error('Unknown unit ' + unit);
  }
}

export function fmt(v, dec = 0) {
  if (v == null) return '—';
  const p = 10 ** dec;
  const x = Math.round(v * p) / p;
  return x.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: dec });
}
export const fmtN = (key, v) => fmt(v, NUTRIENT[key].dec);

/** Human amount like "150 g" / "5.3 oz" / "250 ml" / "8.5 fl oz". */
export function fmtAmount(base, basis, system) {
  if (basis === 'ml') {
    return system === 'imperial' ? `${fmt(base / ML_PER_FLOZ, 1)} fl oz` : `${fmt(base, 0)} ml`;
  }
  return system === 'imperial' ? `${fmt(base / G_PER_OZ, 1)} oz` : `${fmt(base, 0)} g`;
}

/** Calories implied by the macros (Atwater general factors 4/4/9). */
export function atwater(p) {
  if (p.protein == null || p.carbs == null || p.fat == null) return null;
  return 4 * p.protein + 4 * p.carbs + 9 * p.fat;
}

/**
 * Sanity-check a food's per-100 values. Returns a list of {level, key, msg}.
 * level 'bad' = values are impossible or contradict each other; 'warn' = something to double check.
 */
export function checkFood(food) {
  const p = food.per100;
  const w = [];
  const trusted = food.source && food.source.startsWith('usda-') && food.source !== 'usda-branded';
  const core = ['kcal', 'protein', 'carbs', 'fat'].filter((k) => p[k] == null);
  if (core.length) {
    w.push({ level: 'bad', key: 'core', msg: `Missing ${core.map((k) => NUTRIENT[k].label.toLowerCase()).join(', ')} — check the label and fix before logging.` });
  }
  if (p.sodium == null) w.push({ level: 'warn', key: 'sodium', msg: 'No sodium data for this food. It will not count toward your sodium total.' });
  if (!trusted) {
    const a = atwater(p);
    if (a != null && p.kcal != null) {
      const diff = Math.abs(a - p.kcal);
      const rel = diff / Math.max(a, p.kcal, 1);
      // Fiber, sugar alcohols and alcohol legitimately shift this a little, so the tolerance is generous.
      if (diff > 30 && rel > 0.25) {
        w.push({ level: 'bad', key: 'kcal', msg: `Calories don't match the macros: entry says ${fmt(p.kcal)} kcal per 100 ${food.basis || 'g'} but the macros add up to about ${fmt(a)}. Check against the label.` });
      }
    }
    if (p.protein != null && p.carbs != null && p.fat != null && p.protein + p.carbs + p.fat > 102) {
      w.push({ level: 'bad', key: 'sum', msg: 'Protein + carbs + fat add up to more than 100 g per 100 g, which is impossible.' });
    }
    if (p.sugar != null && p.carbs != null && p.sugar > p.carbs + 0.6) w.push({ level: 'bad', key: 'sugar', msg: 'Sugar is higher than total carbs — entry looks wrong.' });
    if (p.satFat != null && p.fat != null && p.satFat > p.fat + 0.6) w.push({ level: 'bad', key: 'satFat', msg: 'Saturated fat is higher than total fat — entry looks wrong.' });
    if (p.kcal != null && p.kcal > 905) w.push({ level: 'bad', key: 'kcal', msg: 'More than 900 kcal per 100 g is impossible (pure fat is ~900).' });
    if (p.sodium != null && p.sodium > 39500) w.push({ level: 'bad', key: 'sodium', msg: 'Sodium is higher than pure salt — units are probably wrong.' });
  }
  if (p.sodium != null && p.sodium >= 1500 && p.sodium <= 39500) {
    w.push({ level: 'info', key: 'sodium', msg: `Very salty: ${fmt(p.sodium)} mg sodium per 100 ${food.basis || 'g'}. Measure this one carefully.` });
  }
  return w;
}

/**
 * Compare the same product from two databases. Returns the nutrients where they disagree enough
 * to matter: [{key, a, b}]. Small rounding differences are ignored.
 */
export function compareFoods(a, b) {
  const tol = { kcal: [0.15, 20], protein: [0.2, 2], carbs: [0.2, 3], fat: [0.2, 2], sodium: [0.25, 60] };
  const out = [];
  for (const [k, [rel, abs]] of Object.entries(tol)) {
    const x = a.per100[k];
    const y = b.per100[k];
    if (x == null || y == null) continue;
    const d = Math.abs(x - y);
    if (d > abs && d / Math.max(x, y) > rel) out.push({ key: k, a: x, b: y });
  }
  return out;
}

// ---------- Open Food Facts ----------
// OFF stores every nutrient per 100 g (or per 100 ml) in GRAMS, including sodium, potassium and
// cholesterol. We convert those three to mg. We only read declared label values (`nutriments`),
// never OFF's `nutriments_estimated` guesses.
export function parseOFF(prod) {
  if (!prod) return null;
  const n = prod.nutriments || {};
  const per100 = emptyNutrients();
  const servingQty = num(prod.serving_quantity);
  // Per-100 value if the entry has one; otherwise work it out from the per-serving value and serving size.
  const offVal = (nn, key, factor = 1) => {
    let v = num(nn[`${key}_100g`]);
    if (v == null && servingQty) {
      const s = num(nn[`${key}_serving`]);
      if (s != null) v = (s / servingQty) * 100;
    }
    return v == null ? null : v * factor;
  };
  let kcal = offVal(n, 'energy-kcal');
  if (kcal == null) {
    const kj = offVal(n, 'energy-kj') ?? (String(n.energy_unit || '').toLowerCase() === 'kj' ? offVal(n, 'energy') : null);
    if (kj != null) kcal = kj / KJ_PER_KCAL;
  }
  per100.kcal = kcal;
  per100.protein = offVal(n, 'proteins');
  per100.carbs = offVal(n, 'carbohydrates');
  per100.fat = offVal(n, 'fat');
  per100.fiber = offVal(n, 'fiber');
  per100.sugar = offVal(n, 'sugars');
  per100.satFat = offVal(n, 'saturated-fat');
  per100.sodium = offVal(n, 'sodium', 1000);
  if (per100.sodium == null) {
    const salt = offVal(n, 'salt', 1000);
    if (salt != null) per100.sodium = salt / 2.5; // salt (NaCl) is 40% sodium by weight
  }
  per100.potassium = offVal(n, 'potassium', 1000);
  per100.cholesterol = offVal(n, 'cholesterol', 1000);

  const sq = servingQty;
  const sUnit = String(prod.serving_quantity_unit || '').toLowerCase();
  const sizeText = String(prod.serving_size || '');
  const liquid = prod.nutrition_data_per === '100ml' || sUnit === 'ml' || sUnit === 'l' || (/\d\s*(ml|cl|l|fl\.? ?oz)\b/i.test(sizeText) && !/\d\s*g\b/i.test(sizeText));
  const portions = [];
  if (sq && sq > 0) portions.push({ label: sizeText ? `1 serving (${sizeText})` : '1 serving', grams: sq });
  const pq = num(prod.product_quantity);
  if (pq && pq > 0 && pq !== sq) portions.push({ label: `Whole package (${prod.quantity || pq})`, grams: pq });

  const brands = Array.isArray(prod.brands) ? prod.brands.join(', ') : prod.brands || '';
  const name = (prod.product_name_en || prod.product_name || prod.generic_name || '').trim();
  return {
    id: 'off:' + prod.code,
    name: name || 'Unnamed product',
    brand: brands.split(',')[0].trim(),
    source: 'off',
    quality: 'community',
    basis: liquid ? 'ml' : 'g',
    per100,
    portions,
    barcode: String(prod.code || ''),
    extra: {
      nutriscore: /^[a-e]$/.test(prod.nutriscore_grade || '') ? prod.nutriscore_grade : null,
      nova: num(prod.nova_group),
      additives: (prod.additives_tags || []).map((t) => String(t).replace(/^en:/, '').toUpperCase()),
      ingredients: prod.ingredients_text_en || prod.ingredients_text || '',
    },
  };
}

// ---------- USDA FoodData Central (branded foods, from the live search API) ----------
const FDC_IDS = {
  kcal: [1008, 2048, 2047],
  protein: [1003],
  carbs: [1005, 1050],
  fat: [1004],
  fiber: [1079, 2033],
  sugar: [2000, 1063],
  satFat: [1258],
  sodium: [1093],
  potassium: [1092],
  cholesterol: [1253],
};
const FDC_UNITS = { kcal: 'KCAL', protein: 'G', carbs: 'G', fat: 'G', fiber: 'G', sugar: 'G', satFat: 'G', sodium: 'MG', potassium: 'MG', cholesterol: 'MG' };

export function parseFDC(f) {
  const per100 = emptyNutrients();
  const byId = new Map();
  for (const n of f.foodNutrients || []) {
    const id = n.nutrientId ?? (n.nutrient && n.nutrient.id);
    const unit = String(n.unitName ?? (n.nutrient && n.nutrient.unitName) ?? '').toUpperCase();
    const value = num(n.value ?? n.amount);
    if (id != null && value != null) byId.set(id, { unit, value });
  }
  for (const k of KEYS) {
    for (const id of FDC_IDS[k]) {
      const n = byId.get(id);
      if (n && n.unit === FDC_UNITS[k]) {
        per100[k] = n.value;
        break;
      }
    }
  }
  const unit = String(f.servingSizeUnit || '').toLowerCase();
  const liquid = unit === 'ml' || unit === 'mlt';
  const portions = [];
  const ss = num(f.servingSize);
  if (ss && ss > 0 && (liquid || unit === 'g' || unit === 'grm')) {
    // USDA writes household measures with trade codes (OZA = fluid ounce, ONZ = ounce, GRM = gram, MLT = millilitre)
    const house = (f.householdServingFullText || '').trim().toLowerCase().replace(/\boza\b/g, 'fl oz').replace(/\bonz\b/g, 'oz').replace(/\bgrm\b/g, 'g').replace(/\bmlt\b/g, 'ml');
    portions.push({ label: house ? `1 serving (${house})` : '1 serving', grams: ss });
  }
  const title = (s) => String(s || '').toLowerCase().replace(/(^|[\s(\-/&])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  return {
    id: 'fdc:' + f.fdcId,
    name: title(f.description),
    brand: title(f.brandName || f.brandOwner || ''),
    source: 'usda-branded',
    quality: 'label',
    basis: liquid ? 'ml' : 'g',
    per100,
    portions,
    barcode: f.gtinUpc ? String(f.gtinUpc) : '',
    extra: { ingredients: f.ingredients || '' },
  };
}

// ---------- Recipes / meals ----------
/**
 * Combine ingredients [{food, amount}] into one food.
 * `cookedWeight` (g) is the weight of the finished dish; if not given we use the sum of ingredient weights.
 * Any nutrient that is unknown for at least one ingredient is summed from the rest and flagged in `partial`.
 */
export function combine(ingredients, { servings = 1, cookedWeight = null } = {}) {
  const sum = Object.fromEntries(KEYS.map((k) => [k, 0]));
  const known = Object.fromEntries(KEYS.map((k) => [k, 0]));
  const partial = new Set();
  let weight = 0;
  for (const ing of ingredients) {
    const n = scale(ing.food.per100, ing.amount);
    weight += ing.amount;
    for (const k of KEYS) {
      if (n[k] == null) partial.add(k);
      else {
        sum[k] += n[k];
        known[k]++;
        if (ing.food.partial && ing.food.partial.includes(k)) partial.add(k);
      }
    }
  }
  const total = cookedWeight && cookedWeight > 0 ? cookedWeight : weight;
  const per100 = emptyNutrients();
  if (total > 0) for (const k of KEYS) per100[k] = known[k] === 0 && ingredients.length ? null : (sum[k] / total) * 100;
  for (const k of KEYS) if (per100[k] == null) partial.delete(k);
  const s = servings > 0 ? servings : 1;
  return {
    per100,
    totalWeight: total,
    rawWeight: weight,
    servingGrams: total / s,
    totalNutrients: Object.fromEntries(KEYS.map((k) => [k, per100[k] == null ? null : sum[k]])),
    partial: [...partial],
  };
}

// ---------- Barcodes ----------
/** Validates the check digit of UPC-A / EAN-13 / EAN-8 codes. */
export function validBarcode(code) {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const d = code.split('').map(Number);
  const check = d.pop();
  let s = 0;
  d.reverse().forEach((x, i) => (s += x * (i % 2 === 0 ? 3 : 1)));
  return (10 - (s % 10)) % 10 === check;
}

// ---------- Dates ----------
export function dayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
export function parseDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}
export function addDays(key, n) {
  const d = parseDay(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}
export function daysBetween(a, b) {
  return Math.round((parseDay(b) - parseDay(a)) / 86400000);
}

/** Current streak = consecutive logged days ending today (or yesterday, if today isn't logged yet). */
export function streak(loggedDays, today) {
  const set = loggedDays instanceof Set ? loggedDays : new Set(loggedDays);
  let cur = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(cur)) {
    n++;
    cur = addDays(cur, -1);
  }
  let best = 0;
  let run = 0;
  let prev = null;
  for (const d of [...set].sort()) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return { current: n, best: Math.max(best, n), todayLogged: set.has(today) };
}
