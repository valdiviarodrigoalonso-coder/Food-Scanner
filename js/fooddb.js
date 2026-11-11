// Built-in USDA food library + search. Works offline; no network calls here.
import { PINS, PIN_ALIASES } from './pins.js';

const SRC = {
  F: { source: 'usda-f', quality: 'lab' },
  S: { source: 'usda-s', quality: 'reference' },
  N: { source: 'usda-n', quality: 'recipe-usda' },
};

let db = null; // { cats, foods: raw arrays, norm: string[], words: string[][] }

export const normalize = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();

// Spanish / Peruvian kitchen words -> what USDA calls them.
const ALIASES = {
  pollo: ['chicken'], arroz: ['rice'], papa: ['potato'], papas: ['potato'], camote: ['sweet potato'], palta: ['avocado'],
  aguacate: ['avocado'], choclo: ['corn'], maiz: ['corn'], yuca: ['cassava'], res: ['beef'], carne: ['beef'], lomo: ['beef sirloin'],
  cerdo: ['pork'], chancho: ['pork'], pescado: ['fish'], huevo: ['egg'], huevos: ['egg'], leche: ['milk'], queso: ['cheese'],
  frijoles: ['beans'], frejoles: ['beans'], lentejas: ['lentils'], avena: ['oats'], pan: ['bread'], platano: ['plantain', 'banana'],
  cebolla: ['onion'], tomate: ['tomato'], ajo: ['garlic'], limon: ['lime'], quinua: ['quinoa'], kiwicha: ['amaranth'], pavo: ['turkey'],
  atun: ['tuna'], camaron: ['shrimp'], camarones: ['shrimp'], langostinos: ['shrimp'], aceite: ['oil'], mantequilla: ['butter'],
  azucar: ['sugar'], sal: ['salt'], fideos: ['spaghetti'], tallarines: ['spaghetti'], zapallo: ['squash'], zanahoria: ['carrot'],
  espinaca: ['spinach'], albahaca: ['basil'], culantro: ['coriander'], cilantro: ['coriander'], mani: ['peanut'], pallares: ['lima beans'],
  garbanzos: ['chickpeas'], mote: ['hominy'], higado: ['liver'], corazon: ['heart'], mondongo: ['tripe'], manzana: ['apple'],
  naranja: ['orange'], fresa: ['strawberries'], fresas: ['strawberries'], pina: ['pineapple'], maracuya: ['passion fruit'],
  chirimoya: ['cherimoya'], guanabana: ['soursop'], sillao: ['soy sauce'], pimiento: ['peppers sweet'], aji: ['peppers hot'],
  arveja: ['peas'], arvejas: ['peas'], vainita: ['beans snap'], vainitas: ['beans snap'], betarraga: ['beets'], apio: ['celery'],
  pepino: ['cucumber'], lechuga: ['lettuce'], brocoli: ['broccoli'], coliflor: ['cauliflower'], uvas: ['grapes'], sandia: ['watermelon'],
  yogur: ['yogurt'], jamon: ['ham'], tocino: ['bacon'], salchicha: ['sausage'], pulpo: ['octopus'], calamar: ['squid'], conchas: ['scallops'],
  oatmeal: ['oats'], chickpea: ['chickpeas'], garbanzo: ['chickpeas'], scallion: ['onions spring'], scallions: ['onions spring'],
  cilantros: ['coriander'], zucchini: ['squash zucchini'], steak: ['beef'], shrimp: ['shrimp', 'crustaceans shrimp'],
};

function variants(tok) {
  const v = [tok];
  if (tok.length > 3 && tok.endsWith('ies')) v.push(tok.slice(0, -3));
  else if (tok.length > 4 && tok.endsWith('es')) v.push(tok.slice(0, -2), tok.slice(0, -1));
  else if (tok.length > 3 && tok.endsWith('s')) v.push(tok.slice(0, -1));
  return v;
}

/** Position of the first word that starts with any variant of `tok`, or -1. Exact word hits rank higher. */
function matchWord(words, tok) {
  const vs = variants(tok);
  let best = -1;
  let exact = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    for (const v of vs) {
      if (w.startsWith(v)) {
        const ex = w === v || w === v + 's' || w === v + 'es';
        if (best < 0 || (ex && !exact)) {
          best = i;
          exact = ex;
        }
        break;
      }
    }
    if (exact) break;
  }
  return best < 0 ? null : { pos: best, exact };
}

/** Score a candidate name against query tokens. Returns null if any token fails to match. */
export function scoreName(words, tokens) {
  let score = 0;
  for (let ti = 0; ti < tokens.length; ti++) {
    const tok = tokens[ti];
    let m = matchWord(words, tok);
    if (!m && ALIASES[tok]) {
      for (const alt of ALIASES[tok]) {
        const parts = alt.split(' ');
        const ms = parts.map((p) => matchWord(words, p));
        if (ms.every(Boolean)) {
          m = { pos: Math.min(...ms.map((x) => x.pos)), exact: ms.every((x) => x.exact) };
          break;
        }
      }
    }
    if (!m) return null;
    score += m.exact ? 12 : 6;
    score -= Math.min(m.pos, 4) * 1.5; // earlier in the name = more relevant
    if (ti === 0 && m.pos === 0) score += 10;
  }
  score -= Math.min(words.length, 12); // shorter, simpler names first
  return score;
}

export async function loadDB(url = 'data/foods.json?v=1') {
  if (db) return db;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not load the food library');
  return initDB(await res.json());
}

export function initDB(json) {
  const norm = new Array(json.foods.length);
  const words = new Array(json.foods.length);
  const byId = new Map();
  const seg = new Array(json.foods.length);
  for (let i = 0; i < json.foods.length; i++) {
    norm[i] = normalize(json.foods[i][1]);
    words[i] = norm[i].split(' ');
    seg[i] = normalize(json.foods[i][1].split(',')[0]).split(' ');
    byId.set(json.foods[i][0], i);
  }
  db = { cats: json.cats, foods: json.foods, norm, words, seg, byId, built: json.built };
  return db;
}

export function toFood(row) {
  const s = SRC[row[2]];
  return {
    id: 'usda:' + row[0],
    name: row[1],
    brand: '',
    source: s.source,
    quality: s.quality,
    basis: 'g',
    category: db ? db.cats[row[3]] : '',
    per100: {
      kcal: row[4], protein: row[5], carbs: row[6], fat: row[7], fiber: row[8], sugar: row[9],
      satFat: row[10], sodium: row[11], potassium: row[12], cholesterol: row[13],
    },
    portions: (row[14] || []).map(([label, grams]) => ({ label, grams })),
  };
}

export function getById(fdcId) {
  if (!db) return null;
  const i = db.byId.get(Number(fdcId));
  return i == null ? null : toFood(db.foods[i]);
}

// Plain ingredients (lab / reference data) outrank prepared dishes, which assume salt and fat were added.
const SRC_BONUS = { F: 8, S: 6, N: 0 };

export function searchDB(query, limit = 40) {
  if (!db) return [];
  const tokens = normalize(query).split(' ').filter(Boolean);
  if (!tokens.length) return [];
  const hits = [];
  for (let i = 0; i < db.foods.length; i++) {
    const s = scoreName(db.words[i], tokens);
    if (s == null) continue;
    const row = db.foods[i];
    let score = s + SRC_BONUS[row[2]];
    const cat = db.cats[row[3]] || '';
    if (/baby|infant/i.test(cat) || /^babyfood/i.test(row[1])) score -= 25;
    if (/restaurant|fast food/i.test(cat)) score -= 4;
    const n = db.norm[i];
    if (/\braw\b/.test(n)) score += 4;
    else if (/\b(cooked|roasted|grilled|boiled|baked)\b/.test(n)) score += 2;
    if (/\b(dried|powder|dehydrated|canned|frozen|infant|formula|imitation|substitute)\b/.test(n)) score -= 4;
    // "Egg, whole, raw" style: the query is exactly the first comma-segment of the USDA name
    const seg = db.seg[i];
    if (seg.length === tokens.length && tokens.every((t) => matchWord(seg, t))) score += 10;
    hits.push([score, i]);
  }
  hits.sort((a, b) => b[0] - a[0] || db.foods[a[1]][1].length - db.foods[b[1]][1].length);
  const pinned = pinsFor(tokens.join(' ')).map((id) => db.byId.get(id)).filter((i) => i != null);
  const seen = new Set(pinned);
  const order = [...pinned, ...hits.map(([, i]) => i).filter((i) => !seen.has(i))];
  return order.slice(0, limit).map((i) => toFood(db.foods[i]));
}

/** Pinned ids for a normalized query: exact key, Spanish/plural alias, or a key the user is still typing. */
export function pinsFor(q) {
  if (q.length < 3) return [];
  const key = PIN_ALIASES[q] || q;
  if (PINS[key]) return PINS[key];
  const singular = key.replace(/(es|s)$/, '');
  if (PINS[singular]) return PINS[singular];
  const typing = Object.keys(PINS)
    .filter((k) => k.startsWith(q))
    .sort((a, b) => a.length - b.length)[0];
  return typing ? PINS[typing] : [];
}

/** Search any list of objects with a `name` (and optional `aka`) using the same matcher. */
export function searchList(list, query, limit = 30) {
  const tokens = normalize(query).split(' ').filter(Boolean);
  if (!tokens.length) return list.slice(0, limit);
  const hits = [];
  for (const item of list) {
    const words = normalize([item.name, item.brand, item.aka].filter(Boolean).join(' ')).split(' ');
    const s = scoreName(words, tokens);
    if (s != null) hits.push([s, item]);
  }
  hits.sort((a, b) => b[0] - a[0]);
  return hits.slice(0, limit).map(([, item]) => item);
}

export const dbSize = () => (db ? db.foods.length : 0);

const CAT_EMOJI = [
  [/poultry|chicken|turkey/i, '🍗'], [/beef|lamb|veal|game|meat/i, '🥩'], [/pork|sausage|bacon|frankfurter|cold cut|cured/i, '🥓'],
  [/fish|shellfish|seafood/i, '🐟'], [/egg|omelet/i, '🥚'], [/cheese/i, '🧀'], [/milk|dairy|yogurt/i, '🥛'],
  [/fruit|berries|apple|banana|citrus|melon|grape|peach/i, '🍎'], [/vegetable|lettuce|tomato|carrot|broccoli|spinach|onion|bean.*green/i, '🥦'],
  [/potato|fries/i, '🥔'], [/legume|bean|pea|lentil/i, '🫘'], [/nut|seed/i, '🥜'], [/rice/i, '🍚'], [/pasta|noodle|macaroni/i, '🍝'],
  [/bread|roll|bagel|tortilla|biscuit|muffin|baked/i, '🍞'], [/cereal|oat|grits|grain/i, '🥣'], [/soup|stew|broth/i, '🍲'],
  [/pizza/i, '🍕'], [/burger|sandwich/i, '🍔'], [/taco|burrito|mexican|nachos/i, '🌮'], [/asian|stir|sushi|soy|fried rice|lo mein|egg roll|dumpling/i, '🥡'],
  [/cake|pie|cookie|brownie|doughnut|pastr|sweet|candy|dessert|ice cream|pudding|sugar/i, '🍪'], [/snack|chip|cracker|popcorn|pretzel/i, '🍿'],
  [/juice|soft drink|soda|tea|coffee|beverage|drink|water|smoothie/i, '🥤'], [/beer|wine|liquor|alcohol|cocktail/i, '🍷'],
  [/fat|oil|butter|margarine|dressing|mayonnaise/i, '🧈'], [/sauce|gravy|spice|herb|condiment|dip|salsa/i, '🧂'], [/protein|nutrition bar|powder/i, '💪'],
];
export function emojiFor(food) {
  if (food.emoji) return food.emoji;
  const hay = `${food.category || ''}`;
  for (const [re, e] of CAT_EMOJI) if (re.test(hay)) return e;
  const hay2 = food.name || '';
  for (const [re, e] of CAT_EMOJI) if (re.test(hay2)) return e;
  return '🍽️';
}
