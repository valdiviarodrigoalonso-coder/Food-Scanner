// Shared bits of UI used by several screens.
import { html, raw } from './ui.js';
import { fmt, fmtN, fmtAmount, NUTRIENT, scale, G_PER_OZ, ML_PER_FLOZ } from './nutrition.js';
import { emojiFor } from './fooddb.js';
import { S } from './state.js';
import { lineFor, getCoach } from './coach.js';

/** The coach the person picked, and what that coach says in a given situation. */
export const coach = () => getCoach(S.settings.coach);
export const say = (key, vars) => lineFor(S.settings.coach, key, vars);

let refreshFn = () => {};
export const setRefresh = (fn) => (refreshFn = fn);
export const refresh = () => refreshFn();

export const units = () => S.settings.units;
export const imperial = () => S.settings.units === 'imperial';

const BADGES = {
  lab: ['✓ USDA lab-tested', 'good', 'Measured in USDA laboratories (Foundation Foods).'],
  reference: ['✓ USDA', 'good', 'USDA Standard Reference — the long-standing government reference values.'],
  'recipe-usda': ['USDA prepared dish', 'info', 'USDA estimate for the food as typically prepared. It assumes normal amounts of salt and fat were added in cooking — if you cook without salt, pick the plain ingredient instead.'],
  label: ['Maker label · USDA', 'info', 'Label values supplied by the manufacturer to USDA. Products get reformulated, so compare with your package once.'],
  community: ['Community label', 'warn', 'Typed in from the package by volunteers on Open Food Facts. Usually right, sometimes not — compare with your package once.'],
  mine: ['Your food', 'good', 'You entered this yourself.'],
  recipe: ['Your recipe', 'info', 'Calculated from the ingredients you listed.'],
  estimate: ['~ Estimate', 'warn', 'A typical home recipe built from USDA ingredients. Real plates vary, mostly in oil and salt.'],
  quick: ['Quick add', 'plain', 'Numbers you typed in directly.'],
};
export function badgeInfo(food) {
  if (food.verified) return ['✓ Checked by you', 'good', 'You compared this with the package and confirmed it.'];
  return BADGES[food.quality] || BADGES.quick;
}
export function badge(food) {
  const [label, cls] = badgeInfo(food);
  return html`<span class="badge ${cls}">${label}</span>`;
}

export const basisUnit = (food) => (food.basis === 'ml' ? 'ml' : 'g');

/** "150 g", "5.3 oz", "2 × 1 large (50 g)" … */
export function amountLabel(e) {
  if (e.unit === 'portion' && e.portionLabel) {
    if (e.food.source === 'quick') return 'quick add';
    const q = fmt(e.qty, 2);
    return `${q} × ${e.portionLabel.replace(/^1 /, '')} · ${fmtAmount(e.amount, e.food.basis, units())}`;
  }
  return fmtAmount(e.amount, e.food.basis, units());
}

export function foodRow(food, i, { sub, act = 'pk-open', right } = {}) {
  const p = food.per100;
  const line = sub || `${food.brand ? food.brand + ' · ' : ''}${fmt(p.kcal)} kcal · P ${fmt(p.protein, 1)} g per 100 ${basisUnit(food)}`;
  const [, cls] = badgeInfo(food);
  return html`<button class="row" data-act="${act}" data-i="${i}">
    <span class="row-emoji">${emojiFor(food)}</span>
    <span class="row-main"><span class="row-name">${food.name}</span><span class="row-sub">${line}</span></span>
    ${right || html`<span class="dot ${cls}" aria-hidden="true"></span>`}
  </button>`;
}

/** Nutrition facts block. `n` = nutrient amounts, `food` supplies partial flags. */
export function nutriPanel(n, heading, food) {
  const partial = new Set(food.partial || []);
  const est = food.quality === 'estimate' ? '~' : '';
  const val = (k) => {
    if (n[k] == null) return html`<span class="nodata">no data</span>`;
    return html`${partial.has(k) ? '≥ ' : est}${fmtN(k, n[k])} <small>${NUTRIENT[k].unit}</small>`;
  };
  const row = (k, sub) => html`<div class="nf-row ${sub ? 'sub' : ''} ${k === 'sodium' ? 'key' : ''}"><span>${NUTRIENT[k].label}</span><b>${val(k)}</b></div>`;
  return html`<div class="nf">
    <div class="nf-head"><span>${heading}</span><span class="nf-kcal"><b>${n.kcal == null ? '—' : est + fmt(n.kcal)}</b> kcal</span></div>
    <div class="nf-macros">
      <div class="m protein"><b>${n.protein == null ? '—' : fmt(n.protein, 1)}</b><span>Protein g</span></div>
      <div class="m carbs"><b>${n.carbs == null ? '—' : fmt(n.carbs, 1)}</b><span>Carbs g</span></div>
      <div class="m fat"><b>${n.fat == null ? '—' : fmt(n.fat, 1)}</b><span>Fat g</span></div>
    </div>
    <div class="nf-list">${row('sodium')}${row('potassium')}${row('fiber')}${row('sugar')}${row('satFat')}${row('cholesterol')}</div>
  </div>`;
}

export function entryNutrients(e) {
  return scale(e.food.per100, e.amount);
}

/** Body-weight helpers (stored in kg). */
export const KG_PER_LB = 0.45359237;
export const wtOut = (kg) => (imperial() ? kg / KG_PER_LB : kg);
export const wtIn = (v) => (imperial() ? v * KG_PER_LB : v);
export const wtUnit = () => (imperial() ? 'lb' : 'kg');
/** Water helpers (stored in ml). */
export const waterOut = (ml) => (imperial() ? ml / ML_PER_FLOZ : ml);
export const waterUnit = () => (imperial() ? 'fl oz' : 'ml');
export const fmtWater = (ml) => (imperial() ? `${fmt(ml / ML_PER_FLOZ)} fl oz` : ml >= 1000 ? `${fmt(ml / 1000, 2)} L` : `${fmt(ml)} ml`);
export const gOut = (g) => (imperial() ? g / G_PER_OZ : g);

export function prettyDate(key, todayKey) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12);
  const label = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const diff = Math.round((dt - new Date(...todayKey.split('-').map((x, i) => (i === 1 ? Number(x) - 1 : Number(x))), 12)) / 86400000);
  if (diff === 0) return { main: 'Today', sub: label };
  if (diff === -1) return { main: 'Yesterday', sub: label };
  if (diff === 1) return { main: 'Tomorrow', sub: label };
  return { main: label, sub: String(y) };
}

export const rawIf = (cond, tpl) => (cond ? tpl : raw(''));
