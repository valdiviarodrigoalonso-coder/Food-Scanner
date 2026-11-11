// Run with: npm test   (or: node tests/run-tests.mjs)
// Verifies the nutrition math, the label parsers, and that every built-in dish/pin points at a real USDA food.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import * as N from '../js/nutrition.js';
import { initDB, searchDB, getById, searchList } from '../js/fooddb.js';
import { PINS, PIN_ALIASES } from '../js/pins.js';
import { gtinForms, upcEtoA } from '../js/api.js';
import { COACHES, LINES, lineFor, getCoach } from '../js/coach.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    console.error('FAIL  ' + name + '\n      ' + e.message);
    process.exitCode = 1;
  }
};
const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

const foods = read('data/foods.json');
initDB(foods);
const dishes = read('data/dishes.json');

console.log('Units & scaling');
test('1 oz = 28.3495 g, 1 lb = 453.592 g, 1 fl oz = 29.5735 ml', () => {
  near(N.toBase(1, 'oz'), 28.3495, 0.0001);
  near(N.toBase(1, 'lb'), 453.592, 0.001);
  near(N.toBase(1, 'floz'), 29.5735, 0.0001);
});
test('round trip g -> oz -> g', () => near(N.toBase(N.fromBase(173, 'oz'), 'oz'), 173, 1e-9));
test('portion unit', () => near(N.toBase(1.5, 'portion', 50), 75, 1e-9));
test('scale keeps null as null (never 0)', () => {
  const s = N.scale({ ...N.emptyNutrients(), kcal: 200, sodium: null, protein: 10 }, 150);
  near(s.kcal, 300);
  near(s.protein, 15);
  assert.equal(s.sodium, null);
});
test('totals count missing sodium instead of treating it as zero', () => {
  const a = { food: { name: 'A', per100: { ...N.emptyNutrients(), kcal: 100, sodium: 500 } }, amount: 200 };
  const b = { food: { name: 'B', per100: { ...N.emptyNutrients(), kcal: 50, sodium: null } }, amount: 100 };
  const t = N.totals([a, b]);
  near(t.sodium.sum, 1000);
  assert.equal(t.sodium.missing, 1);
  assert.deepEqual(t.sodium.missingNames, ['B']);
  near(t.kcal.sum, 250);
});
test('fmtAmount metric / imperial', () => {
  assert.equal(N.fmtAmount(150, 'g', 'metric'), '150 g');
  assert.equal(N.fmtAmount(150, 'g', 'imperial'), '5.3 oz');
  assert.equal(N.fmtAmount(355, 'ml', 'imperial'), '12 fl oz');
});

console.log('USDA library spot checks (values published by USDA FoodData Central)');
const chk = (id, exp) => {
  const f = getById(id);
  assert.ok(f, 'missing food ' + id);
  for (const [k, v] of Object.entries(exp)) near(f.per100[k], v, 0.011);
  return f;
};
test('Chicken breast, raw (171077): 120 kcal, 22.5 P, 2.62 F, 45 mg Na', () => chk(171077, { kcal: 120, protein: 22.5, carbs: 0, fat: 2.62, sodium: 45 }));
test('Egg, whole, raw (171287): 143 kcal, 12.6 P, 142 mg Na', () => chk(171287, { kcal: 143, protein: 12.6, fat: 9.51, sodium: 142 }));
test('White rice, cooked (168878): 130 kcal, 28.2 C, 1 mg Na', () => chk(168878, { kcal: 130, carbs: 28.2, sodium: 1 }));
test('Table salt (173468): 38,758 mg sodium per 100 g', () => near(getById(173468).per100.sodium, 38758, 50));
test('Soy sauce (174277): 5,493 mg sodium per 100 g', () => near(getById(174277).per100.sodium, 5493, 10));
test('Banana (173944): 89 kcal, 358 mg potassium', () => chk(173944, { kcal: 89, potassium: 358 }));
test('no negative values anywhere in the library', () => {
  for (const row of foods.foods) for (let i = 4; i <= 13; i++) assert.ok(row[i] == null || row[i] >= 0, `${row[1]} field ${i} = ${row[i]}`);
});
test('library sodium is in mg (nothing above pure salt)', () => {
  for (const row of foods.foods) assert.ok(row[11] == null || row[11] <= 39500, `${row[1]} sodium ${row[11]}`);
});
test('library calories match macros for >97% of foods (catches unit mix-ups)', () => {
  let bad = 0;
  let n = 0;
  for (const r of foods.foods) {
    const a = 4 * r[5] + 4 * r[6] + 9 * r[7];
    if (r[4] < 40) continue;
    n++;
    if (Math.abs(a - r[4]) / Math.max(a, r[4]) > 0.3) bad++;
  }
  assert.ok(bad / n < 0.03, `${bad} of ${n} foods off by >30% (alcohol and fiber explain a few)`);
});

console.log('Search');
const top = (q, n = 3) => searchDB(q, n).map((f) => f.name);
test('"egg" shows a plain whole egg first', () => assert.match(top('egg')[0], /^Egg, whole, raw/));
test('"chicken breast" shows raw skinless breast first', () => assert.match(top('chicken breast')[0], /breast, skinless, boneless, meat only, raw/));
test('"pollo" (Spanish) finds chicken', () => assert.match(top('pollo')[0], /^Chicken/));
test('"camote" finds sweet potato', () => assert.match(top('camote')[0], /^Sweet potato/));
test('"arroz" finds unsalted cooked white rice first', () => assert.match(top('arroz')[0], /^Rice, white, long-grain, regular, enriched, cooked/));
test('typing "chick" already surfaces chicken', () => assert.match(top('chick')[0], /^Chicken/));
test('unpinned search still works ("mahimahi")', () => assert.match(top('mahimahi')[0], /mahimahi/i));
test('plain raw ingredients outrank processed versions ("peanuts", "mahimahi", "turkey breast")', () => {
  assert.match(top('peanuts')[0], /^Peanuts, raw/);
  assert.match(top('mahimahi')[0], /raw$/);
  assert.match(top('turkey breast')[0], /breast, meat only, raw/);
});
test('source files contain no stray control characters (they silently break search rules)', () => {
  for (const dir of ['js', 'tests', 'tools']) {
    for (const name of fs.readdirSync(path.join(root, dir))) {
      const text = fs.readFileSync(path.join(root, dir, name), 'utf8');
      // eslint-disable-next-line no-control-regex
      assert.ok(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text), `${dir}/${name} contains a control character`);
    }
  }
});
test('every pinned id exists', () => {
  for (const [k, ids] of Object.entries(PINS)) for (const id of ids) assert.ok(getById(id), `pin ${k} -> ${id}`);
});
test('every pin alias points at a pin', () => {
  for (const [a, k] of Object.entries(PIN_ALIASES)) assert.ok(PINS[k], `alias ${a} -> ${k}`);
});
test('searchList matches a dish by Spanish or English words', () => {
  assert.equal(searchList(dishes.dishes, 'lomo')[0].id, 'pe:lomo-saltado');
  assert.equal(searchList(dishes.dishes, 'rotisserie chicken')[0].id, 'pe:pollo-a-la-brasa');
});

console.log('Sanity checker');
const mk = (per100, extra = {}) => ({ name: 'x', source: 'off', basis: 'g', per100: { ...N.emptyNutrients(), ...per100 }, ...extra });
test('flags calories that contradict macros (real OFF entry: 239 kcal, 0.87 P, 9.77 C, 0 F)', () => {
  const w = N.checkFood(mk({ kcal: 239, protein: 0.87, carbs: 9.77, fat: 0, sodium: 592 }));
  assert.ok(w.some((x) => x.level === 'bad' && x.key === 'kcal'));
});
test('accepts a consistent label (Nutella: 539 kcal, 6.3 P, 57.5 C, 30.9 F)', () => {
  const w = N.checkFood(mk({ kcal: 539, protein: 6.3, carbs: 57.5, fat: 30.9, sodium: 42.8, sugar: 56.3, satFat: 10.6 }));
  assert.equal(w.filter((x) => x.level === 'bad').length, 0);
});
test('flags impossible macro sum and missing sodium', () => {
  const w = N.checkFood(mk({ kcal: 33, protein: 40, carbs: 55, fat: 13 }));
  assert.ok(w.some((x) => x.key === 'sum'));
  assert.ok(w.some((x) => x.key === 'sodium' && x.level === 'warn'));
});
test('flags sodium entered in the wrong unit', () => {
  assert.ok(N.checkFood(mk({ kcal: 100, protein: 5, carbs: 15, fat: 2, sodium: 450000 })).some((x) => x.key === 'sodium' && x.level === 'bad'));
});

console.log('Open Food Facts parser');
const nutella = {
  code: '3017620422003', product_name: 'Nutella', brands: 'Ferrero, Nutella', nutrition_data_per: '100g', nutriscore_grade: 'e', nova_group: 4,
  additives_tags: ['en:e322'], product_quantity: 400, quantity: '400 g',
  nutriments: { 'energy-kcal_100g': 539, proteins_100g: 6.3, carbohydrates_100g: 57.5, fat_100g: 30.9, fiber_100g: 0, sugars_100g: 56.3, 'saturated-fat_100g': 10.6, sodium_100g: 0.0428, salt_100g: 0.107 },
  nutriments_estimated: { potassium_100g: 0.01032345 },
};
test('sodium converted g -> mg (0.0428 g = 42.8 mg)', () => near(N.parseOFF(nutella).per100.sodium, 42.8, 0.001));
test('ignores OFF "estimated" nutrients (potassium stays unknown)', () => assert.equal(N.parseOFF(nutella).per100.potassium, null));
test('keeps Nutri-Score, NOVA and additives', () => {
  const e = N.parseOFF(nutella).extra;
  assert.equal(e.nutriscore, 'e');
  assert.equal(e.nova, 4);
  assert.deepEqual(e.additives, ['E322']);
});
test('derives sodium from salt when only salt is listed (1.25 g salt = 500 mg sodium)', () => near(N.parseOFF({ code: '1', nutriments: { salt_100g: 1.25 } }).per100.sodium, 500, 0.001));
test('converts kJ to kcal when kcal is absent (2252 kJ = 538 kcal)', () => near(N.parseOFF({ code: '1', nutriments: { 'energy-kj_100g': 2252 } }).per100.kcal, 538.2, 0.1));
test('missing values stay null', () => {
  const p = N.parseOFF({ code: '1', nutriments: { proteins_100g: 5 } }).per100;
  assert.equal(p.kcal, null);
  assert.equal(p.sodium, null);
});
test('serving size and liquids', () => {
  const f = N.parseOFF({ code: '2', product_name: 'Drink', serving_size: '250 ml', serving_quantity: 250, serving_quantity_unit: 'ml', nutriments: {} });
  assert.equal(f.basis, 'ml');
  assert.equal(f.portions[0].grams, 250);
});
test('entry with only per-serving values is converted using the serving size', () => {
  const p = N.parseOFF({ code: '3', serving_quantity: 40, nutriments: { 'energy-kcal_serving': 150, proteins_serving: 12, sodium_serving: 0.2 } }).per100;
  near(p.kcal, 375);
  near(p.protein, 30);
  near(p.sodium, 500, 0.001);
});
test('aji paste label: 500 mg sodium per 28 g serving', () => near(N.scale(dishes.pantry[0].per100, 28).sodium, 500.9, 0.1));

console.log('USDA branded parser');
const cp = {
  fdcId: 1935189, description: 'CORE POWER, HIGH PROTEIN MILK SHAKE, BANANA', brandName: 'CORE POWER', gtinUpc: '856312002696', servingSize: 340, servingSizeUnit: 'ml', householdServingFullText: '11.5 OZA',
  foodNutrients: [
    { nutrientId: 1003, unitName: 'G', value: 7.65 }, { nutrientId: 1004, unitName: 'G', value: 1.03 }, { nutrientId: 1005, unitName: 'G', value: 7.65 },
    { nutrientId: 1008, unitName: 'KCAL', value: 71 }, { nutrientId: 1093, unitName: 'MG', value: 44 }, { nutrientId: 1092, unitName: 'MG', value: 118 }, { nutrientId: 1258, unitName: 'G', value: 0.59 },
  ],
};
test('per-serving math reproduces the label (340 ml bottle = 26 g protein, 150 mg sodium)', () => {
  const f = N.parseFDC(cp);
  assert.equal(f.basis, 'ml');
  assert.equal(f.portions[0].label, '1 serving (11.5 fl oz)');
  const s = N.scale(f.per100, f.portions[0].grams);
  near(s.protein, 26.01, 0.01);
  near(s.sodium, 149.6, 0.1);
  near(s.kcal, 241.4, 0.1);
});
test('ignores a nutrient reported in an unexpected unit', () => {
  assert.equal(N.parseFDC({ fdcId: 1, description: 'x', foodNutrients: [{ nutrientId: 1093, unitName: 'G', value: 2 }] }).per100.sodium, null);
});

console.log('Recipes');
const pantry = new Map(dishes.pantry.map((p) => [p.id, p]));
const resolve = (id) => (typeof id === 'number' ? getById(id) : pantry.get(id));
test('combine: 200 g chicken + 100 g rice', () => {
  const c = N.combine([{ food: getById(171077), amount: 200 }, { food: getById(168878), amount: 100 }], { servings: 2 });
  near(c.totalNutrients.kcal, 370, 0.5);
  near(c.servingGrams, 150);
  near(c.per100.protein, (45 + 2.69) / 3, 0.01);
  assert.deepEqual(c.partial, []);
});
test('combine: unknown sodium in one ingredient is flagged partial, not hidden', () => {
  const c = N.combine([{ food: getById(171077), amount: 100 }, { food: mk({ kcal: 100, protein: 1, carbs: 1, fat: 1 }), amount: 100 }]);
  assert.ok(c.partial.includes('sodium'));
  near(c.totalNutrients.sodium, 45, 0.5);
});
test('combine: cooked weight changes density, not totals', () => {
  const ing = [{ food: getById(171077), amount: 200 }];
  const a = N.combine(ing);
  const b = N.combine(ing, { cookedWeight: 150 });
  near(a.totalNutrients.kcal, b.totalNutrients.kcal);
  near(b.per100.kcal, 160, 0.01);
});
const table = [];
test('every Peruvian dish and starter ingredient exists; plates are plausible', () => {
  for (const d of [...dishes.dishes, ...dishes.starters]) {
    const ing = d.ing.map(([id, g]) => {
      const food = resolve(id);
      assert.ok(food, `${d.id}: unknown ingredient ${id}`);
      assert.ok(g > 0);
      return { food, amount: g };
    });
    const c = N.combine(ing, { cookedWeight: d.cookedWeight || null });
    const t = c.totalNutrients;
    const pad = (v, n) => String(Math.round(v)).padStart(n);
    table.push(`${d.name.padEnd(34)} ${pad(c.totalWeight, 4)} g | ${pad(t.kcal, 4)} kcal  P ${pad(t.protein, 3)}  C ${pad(t.carbs, 3)}  F ${pad(t.fat, 3)}  Na ${pad(t.sodium, 4)} mg  K ${pad(t.potassium, 4)}`);
    assert.ok(t.kcal > 80 && t.kcal < 1300, `${d.id} kcal ${t.kcal}`);
    assert.ok(t.sodium < 2600, `${d.id} sodium ${t.sodium}`);
  }
});

console.log('Coaches');
test('four coaches, each with a name, animal and personality', () => {
  assert.equal(COACHES.length, 4);
  assert.equal(new Set(COACHES.map((c) => c.id)).size, 4);
  for (const c of COACHES) for (const k of ['emoji', 'name', 'animal', 'style', 'blurb']) assert.ok(c[k], c.id + ' is missing ' + k);
});
test('every coach has a line for every situation, with numbers filled in', () => {
  const vars = { n: 5, left: '42', streak: 3, total: 9 };
  for (const key of Object.keys(LINES)) {
    for (const c of COACHES) {
      for (let i = 0; i < 4; i++) {
        const line = lineFor(c.id, key, { ...vars, i });
        assert.ok(typeof line === 'string' && line.length > 3, c.id + ' has no line for ' + key);
        assert.ok(!/undefined|NaN|\[object/.test(line), c.id + '/' + key + ' has a hole: ' + line);
      }
    }
  }
});
test('coaches really do sound different from each other', () => {
  for (const key of Object.keys(LINES)) {
    const said = COACHES.map((c) => lineFor(c.id, key, { n: 5, left: '42', streak: 3, total: 9, i: 0 }));
    assert.equal(new Set(said).size, 4, 'two coaches say the same thing for ' + key);
  }
});
test('singular and plural days read correctly', () => {
  assert.match(lineFor('lion', 'emptyStreak', { n: 1 }), /^1 day straight/);
  assert.match(lineFor('owl', 'dayDone', { streak: 1, total: 1 }), /1 day tracked/);
});
test('an unknown coach falls back to the default instead of going silent', () => {
  assert.equal(getCoach('dragon').id, 'llama');
  assert.equal(lineFor('dragon', 'hello'), lineFor('llama', 'hello'));
});

console.log('Barcodes, dates, streaks');
test('a US barcode scanned as 13 digits is also looked up in its 12-digit form (the form USDA stores)', () => {
  assert.deepEqual(gtinForms('0856312002696'), ['856312002696', '0856312002696', '00856312002696']);
  assert.deepEqual(gtinForms('856312002696'), ['856312002696', '0856312002696', '00856312002696']);
  assert.deepEqual(gtinForms('3017620422003'), ['3017620422003', '03017620422003']);
  assert.equal(gtinForms('012000001291')[0], '012000001291');
});
test('UPC-E expands to UPC-A', () => {
  assert.equal(upcEtoA('04252614'), '042100005264');
  assert.equal(upcEtoA('01234565'), '012345000065');
});
test('check digits', () => {
  assert.ok(N.validBarcode('3017620422003'));
  assert.ok(N.validBarcode('856312002696'));
  assert.ok(!N.validBarcode('856312002697'));
  assert.ok(!N.validBarcode('12345'));
});
test('addDays across month/year and DST', () => {
  assert.equal(N.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(N.addDays('2026-03-08', 1), '2026-03-09');
  assert.equal(N.addDays('2026-11-01', 1), '2026-11-02');
  assert.equal(N.daysBetween('2026-11-11', '2027-02-20'), 101);
});
test('streak counts back from today, survives an unlogged today', () => {
  assert.deepEqual(N.streak(['2026-11-09', '2026-11-10', '2026-11-11'], '2026-11-11'), { current: 3, best: 3, todayLogged: true });
  assert.equal(N.streak(['2026-11-09', '2026-11-10'], '2026-11-11').current, 2);
  assert.equal(N.streak(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-08'], '2026-11-11').current, 0);
  assert.equal(N.streak(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-08'], '2026-11-11').best, 3);
});

console.log('\nPeruvian plates (estimates, one regular plate):\n' + table.join('\n'));
console.log(`\n${passed} checks passed${process.exitCode ? ' — SOME FAILED' : ''}`);
