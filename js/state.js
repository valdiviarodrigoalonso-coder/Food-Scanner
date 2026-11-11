// App state + everything that reads or writes saved data.
import * as kv from './store.js';
import { dayKey, combine, streak, emptyNutrients, KEYS } from './nutrition.js';
import { getById } from './fooddb.js';
import { uid } from './ui.js';

export const APP_NAME = 'Sidekick';

export const SLOTS = [
  { id: 'breakfast', label: 'Breakfast', emoji: '🌅' },
  { id: 'lunch', label: 'Lunch', emoji: '☀️' },
  { id: 'dinner', label: 'Dinner', emoji: '🌙' },
  { id: 'snacks', label: 'Snacks', emoji: '🍎' },
];
export const slotLabel = (id) => (SLOTS.find((s) => s.id === id) || SLOTS[3]).label;
export function slotForNow(d = new Date()) {
  const h = d.getHours();
  if (h < 10) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h >= 17 && h < 22) return 'dinner';
  return 'snacks';
}

// Starting points only: the US Daily Values printed on every Nutrition Facts label (2,000-calorie diet),
// plus about 8 cups of water. Everyone sets their own numbers in Settings.
export const DEFAULT_GOALS = { kcal: 2000, protein: 50, carbs: 275, fat: 78, fiber: 28, sugar: 50, satFat: 20, sodium: 2300, potassium: 4700, cholesterol: 300, water: 2000 };
// People in the US (and a few other places) think in ounces and pounds; everyone else in grams.
const localeUnits = () => (/-(US|LR|MM)\b/i.test((typeof navigator !== 'undefined' && navigator.language) || 'en-US') ? 'imperial' : 'metric');
// target = land close to it, min = reach at least, max = stay under
export const GOAL_MODE = { kcal: 'target', protein: 'min', carbs: 'target', fat: 'target', fiber: 'min', sugar: 'max', satFat: 'max', sodium: 'max', potassium: 'min', cholesterol: 'max', water: 'min' };

export const S = {
  ready: false,
  settings: { units: localeUnits(), goals: { ...DEFAULT_GOALS }, sodiumMode: 'max', coach: 'llama', showDate: '', showName: '', usdaKey: '', claudeKey: '', onboarded: false, seeded: false },
  days: {},
  myFoods: [],
  meals: [],
  weights: {},
  recents: [],
  dishes: { pantry: [], dishes: [], starters: [] },
  date: dayKey(),
  tab: 'today',
};

export const goalMode = (k) => (k === 'sodium' ? S.settings.sodiumMode || 'max' : GOAL_MODE[k]);
export const today = () => dayKey();

export async function loadAll() {
  const all = await kv.getAll();
  if (all.settings) S.settings = { ...S.settings, ...all.settings, goals: { ...DEFAULT_GOALS, ...(all.settings.goals || {}) } };
  S.myFoods = all.myFoods || [];
  S.meals = all.meals || [];
  S.weights = all.weights || {};
  S.recents = all.recents || [];
  S.days = {};
  for (const [k, v] of Object.entries(all)) if (k.startsWith('day:')) S.days[k.slice(4)] = v;
  S.ready = true;
}

export const saveSettings = () => kv.set('settings', S.settings);

export function getDay(date) {
  return S.days[date] || { entries: [], water: 0, done: false };
}
function ensureDay(date) {
  if (!S.days[date]) S.days[date] = { entries: [], water: 0, done: false };
  return S.days[date];
}
export function saveDay(date) {
  const d = S.days[date];
  if (!d) return;
  if (!d.entries.length && !d.water && !d.done) {
    delete S.days[date];
    return kv.del('day:' + date);
  }
  return kv.set('day:' + date, d);
}

/** Minimal copy of a food stored inside a log entry, so history never changes when a food is edited later. */
export function snapshot(food) {
  const per100 = emptyNutrients();
  for (const k of KEYS) per100[k] = food.per100[k] == null ? null : Number(food.per100[k]);
  const s = { id: food.id, name: food.name, brand: food.brand || '', source: food.source, quality: food.quality, basis: food.basis || 'g', per100 };
  if (food.emoji) s.emoji = food.emoji;
  if (food.category) s.category = food.category;
  if (food.partial && food.partial.length) s.partial = [...food.partial];
  if (food.verified) s.verified = true;
  if (food.barcode) s.barcode = food.barcode;
  if (food.dish) s.dish = true;
  if (food.portions && food.portions.length) s.portions = food.portions.slice(0, 8).map((p) => ({ label: p.label, grams: p.grams }));
  return s;
}

/** amountInfo = { amount (g or ml), qty, unit, portionLabel?, portionGrams? } */
export function addEntry(date, slot, food, a) {
  const day = ensureDay(date);
  const entry = { id: uid(), slot, food: snapshot(food), amount: a.amount, qty: a.qty, unit: a.unit, ts: Date.now() };
  if (a.unit === 'portion') {
    entry.portionLabel = a.portionLabel;
    entry.portionGrams = a.portionGrams;
  }
  if (a.est) entry.est = true; // weight came from a photo estimate, not a scale
  day.entries.push(entry);
  touchRecent(food, a);
  saveDay(date);
  return entry;
}
export function updateEntry(date, id, patch) {
  const day = ensureDay(date);
  const e = day.entries.find((x) => x.id === id);
  if (!e) return;
  Object.assign(e, patch);
  if (patch.unit && patch.unit !== 'portion') {
    delete e.portionLabel;
    delete e.portionGrams;
  }
  saveDay(date);
}
export function removeEntry(date, id) {
  const day = ensureDay(date);
  const i = day.entries.findIndex((x) => x.id === id);
  if (i < 0) return null;
  const [e] = day.entries.splice(i, 1);
  saveDay(date);
  return e;
}
export function restoreEntry(date, entry) {
  ensureDay(date).entries.push(entry);
  saveDay(date);
}
export function setWater(date, ml) {
  ensureDay(date).water = Math.max(0, Math.round(ml));
  saveDay(date);
}
export function setDone(date, done) {
  ensureDay(date).done = done;
  saveDay(date);
}

export const loggedDays = () => Object.keys(S.days).filter((d) => S.days[d].entries.length > 0);
export const currentStreak = () => streak(loggedDays(), today());

function touchRecent(food, a) {
  if (food.source === 'quick') return;
  const i = S.recents.findIndex((r) => r.food.id === food.id);
  const prev = i >= 0 ? S.recents.splice(i, 1)[0] : null;
  S.recents.unshift({ food: snapshot(food), amount: a.amount, qty: a.qty, unit: a.unit, portionLabel: a.portionLabel, portionGrams: a.portionGrams, count: (prev ? prev.count : 0) + 1, ts: Date.now() });
  if (S.recents.length > 200) S.recents.length = 200;
  kv.set('recents', S.recents);
}
export const recentFor = (id) => S.recents.find((r) => r.food.id === id) || null;

// ----- my foods -----
export function saveMyFood(food) {
  const f = { ...snapshot(food), portions: (food.portions || []).map((p) => ({ label: p.label, grams: p.grams })), extra: food.extra || undefined, saved: Date.now() };
  const i = S.myFoods.findIndex((x) => x.id === f.id);
  if (i >= 0) S.myFoods[i] = f;
  else S.myFoods.unshift(f);
  kv.set('myFoods', S.myFoods);
  return f;
}
export function deleteMyFood(id) {
  S.myFoods = S.myFoods.filter((f) => f.id !== id);
  kv.set('myFoods', S.myFoods);
}
const stripZeros = (c) => String(c || '').replace(/^0+/, '');
export function findByBarcode(code) {
  const want = stripZeros(code);
  return S.myFoods.find((f) => f.barcode && stripZeros(f.barcode) === want) || null;
}
export const isSaved = (id) => S.myFoods.some((f) => f.id === id);

// ----- meals (recipes) -----
export function saveMeal(meal) {
  meal.updated = Date.now();
  const i = S.meals.findIndex((m) => m.id === meal.id);
  if (i >= 0) S.meals[i] = meal;
  else S.meals.unshift(meal);
  kv.set('meals', S.meals);
  return meal;
}
export function deleteMeal(id) {
  S.meals = S.meals.filter((m) => m.id !== id);
  kv.set('meals', S.meals);
}
export function mealCalc(meal) {
  return combine(meal.ingredients, { servings: meal.servings || 1, cookedWeight: meal.cookedWeight || null });
}
export function mealToFood(meal) {
  const c = mealCalc(meal);
  const n = meal.servings || 1;
  const portions = [{ label: n > 1 ? '1 serving' : '1 serving (whole recipe)', grams: c.servingGrams }];
  if (n > 1) portions.push({ label: 'Whole recipe', grams: c.totalWeight });
  const estimate = meal.ingredients.some((i) => i.food.quality === 'estimate');
  return { id: 'meal:' + meal.id, name: meal.name, brand: '', emoji: meal.emoji || '🍽️', source: 'meal', quality: estimate ? 'estimate' : 'recipe', basis: 'g', per100: c.per100, partial: c.partial, portions, mealId: meal.id };
}

// ----- Peruvian kitchen presets -----
export function resolveIngredient(id) {
  if (typeof id === 'number') return getById(id);
  return S.dishes.pantry.find((p) => p.id === id) || null;
}
export function dishIngredients(dish) {
  return dish.ing
    .map(([id, grams, label]) => {
      const food = resolveIngredient(id);
      return food ? { food: { ...food, short: label }, amount: grams, qty: grams, unit: 'g', label } : null;
    })
    .filter(Boolean);
}
export function dishToFood(dish) {
  const ing = dishIngredients(dish);
  const c = combine(ing, { cookedWeight: dish.cookedWeight || null });
  return {
    id: dish.id, name: dish.name, brand: '', emoji: dish.emoji, source: 'dish', quality: 'estimate', basis: 'g', per100: c.per100, partial: c.partial,
    portions: [{ label: '1 regular plate', grams: c.totalWeight }], dish: true,
  };
}
/** Turn a preset (Peruvian dish or starter recipe) into an editable meal of the user's own. */
export function presetToMeal(preset, name) {
  return {
    id: uid(), name: name || preset.name, emoji: preset.emoji || '🍽️', servings: 1, cookedWeight: preset.cookedWeight || null, note: preset.note || preset.plate || '',
    ingredients: dishIngredients(preset).map((i) => ({ food: snapshot({ ...i.food, name: i.label || i.food.name }), amount: i.amount, qty: i.amount, unit: 'g' })),
  };
}
export function seedStarters() {
  if (S.settings.seeded) return;
  for (const st of [...S.dishes.starters].reverse()) saveMeal(presetToMeal(st));
  S.settings.seeded = true;
  saveSettings();
}

// ----- body weight (stored in kg) -----
export function setWeight(date, kg) {
  if (kg == null) delete S.weights[date];
  else S.weights[date] = kg;
  kv.set('weights', S.weights);
}

// ----- backup -----
export function exportData() {
  return { app: APP_NAME, version: 1, exported: new Date().toISOString(), settings: { ...S.settings, claudeKey: '' }, days: S.days, myFoods: S.myFoods, meals: S.meals, weights: S.weights, recents: S.recents };
}
export async function importData(data) {
  if (!data || !data.app || !data.settings || !data.days || typeof data.days !== 'object') throw new Error('That file is not a ' + APP_NAME + ' backup.');
  await kv.clearAll();
  const claudeKey = S.settings.claudeKey || ''; // a paid key never travels in a backup file; keep the one on this device
  S.settings = { ...S.settings, ...data.settings, claudeKey, goals: { ...DEFAULT_GOALS, ...((data.settings && data.settings.goals) || {}) } };
  S.days = data.days || {};
  S.myFoods = data.myFoods || [];
  S.meals = data.meals || [];
  S.weights = data.weights || {};
  S.recents = data.recents || [];
  await Promise.all([
    kv.set('settings', S.settings), kv.set('myFoods', S.myFoods), kv.set('meals', S.meals), kv.set('weights', S.weights), kv.set('recents', S.recents),
    ...Object.entries(S.days).map(([d, v]) => kv.set('day:' + d, v)),
  ]);
}
export async function wipeAll() {
  await kv.clearAll();
}
