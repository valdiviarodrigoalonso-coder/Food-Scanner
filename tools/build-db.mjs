// Builds data/foods.json from the official USDA FoodData Central JSON downloads.
// Usage: node tools/build-db.mjs <sr_legacy.json> <foundation.json> <survey.json>
// Every number in the output is copied straight from USDA (per 100 g). Nothing is typed by hand.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , srPath, foPath, suPath] = process.argv;
if (!srPath || !foPath || !suPath) {
  console.error('Usage: node tools/build-db.mjs <sr_legacy.json> <foundation.json> <survey.json>');
  process.exit(1);
}
const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'foods.json');

const r = (v, d) => (v == null || Number.isNaN(v) ? null : Math.max(0, Math.round(v * 10 ** d) / 10 ** d));

function nutrientMap(food) {
  const m = new Map();
  for (const n of food.foodNutrients || []) {
    if (n.amount == null || !n.nutrient) continue;
    m.set(n.nutrient.id, { amount: n.amount, unit: n.nutrient.unitName });
  }
  return m;
}
function pick(m, ids, unit) {
  for (const id of ids) {
    const n = m.get(id);
    if (n) {
      if (n.unit.toLowerCase() !== unit.toLowerCase()) throw new Error(`Unit mismatch for nutrient ${id}: ${n.unit} vs ${unit}`);
      return n.amount;
    }
  }
  return null;
}

const cats = [];
const catIndex = (name) => {
  if (!name) name = 'Other';
  let i = cats.indexOf(name);
  if (i < 0) { cats.push(name); i = cats.length - 1; }
  return i;
};

function fmtAmount(a) {
  if (a == null) return '';
  const x = Math.round(a * 100) / 100;
  return String(x);
}

function portionsOf(food, src) {
  const out = [];
  const seen = new Set();
  const list = [...(food.foodPortions || [])].sort((a, b) => (a.sequenceNumber || 0) - (b.sequenceNumber || 0));
  for (const p of list) {
    const g = p.gramWeight;
    if (!g || g <= 0) continue;
    let label;
    if (src === 'N') {
      label = (p.portionDescription || '').trim();
      if (!label || /not specified/i.test(label)) continue;
    } else {
      const amt = p.amount ?? p.value ?? 1;
      const unit = p.measureUnit && p.measureUnit.name && p.measureUnit.name !== 'undetermined' ? p.measureUnit.name : '';
      const mod = (p.modifier || '').trim();
      label = [fmtAmount(amt), unit, mod].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      if (!label) continue;
    }
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([label, r(g, 1)]);
    if (out.length >= 8) break;
  }
  return out;
}

const foods = [];
let skipped = 0;
function add(list, src) {
  for (const f of list) {
    const m = nutrientMap(f);
    const protein = pick(m, [1003], 'g');
    const fat = pick(m, [1004], 'g');
    const carbs = pick(m, [1005, 1050], 'g');
    let kcal = pick(m, [1008, 2048, 2047], 'kcal');
    if (protein == null || fat == null || carbs == null) { skipped++; continue; }
    if (kcal == null) { skipped++; continue; } // never invent a calorie value
    const cat = src === 'N'
      ? f.wweiaFoodCategory && f.wweiaFoodCategory.wweiaFoodCategoryDescription
      : f.foodCategory && f.foodCategory.description;
    foods.push([
      f.fdcId,
      f.description.trim(),
      src,
      catIndex(cat),
      r(kcal, 0),
      r(protein, 2),
      r(carbs, 2),
      r(fat, 2),
      r(pick(m, [1079, 2033], 'g'), 1),
      r(pick(m, [2000, 1063], 'g'), 2),
      r(pick(m, [1258], 'g'), 2),
      r(pick(m, [1093], 'mg'), 0),
      r(pick(m, [1092], 'mg'), 0),
      r(pick(m, [1253], 'mg'), 0),
      portionsOf(f, src),
    ]);
  }
}

const load = (p) => { const j = JSON.parse(fs.readFileSync(p, 'utf8')); return j[Object.keys(j)[0]]; };
add(load(foPath), 'F');
add(load(srPath), 'S');
add(load(suPath), 'N');

const out = {
  version: 1,
  built: new Date().toISOString().slice(0, 10),
  note: 'Values per 100 g, copied from USDA FoodData Central (public domain). F=Foundation Foods, S=SR Legacy, N=Survey/FNDDS.',
  fields: ['id', 'name', 'src', 'cat', 'kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'satFat', 'sodium', 'potassium', 'cholesterol', 'portions'],
  cats,
  foods,
};
fs.writeFileSync(outPath, JSON.stringify(out));
const bytes = fs.statSync(outPath).size;
console.log(`Wrote ${foods.length} foods (${skipped} skipped for missing core macros) -> ${outPath} (${(bytes / 1e6).toFixed(2)} MB)`);
const miss = (i) => foods.filter((f) => f[i] == null).length;
console.log('missing: fiber', miss(8), 'sugar', miss(9), 'satFat', miss(10), 'sodium', miss(11), 'potassium', miss(12), 'chol', miss(13));
