// Meals tab: your saved recipes + the Peruvian home-dish presets, and the recipe editor.
import { html, on, onInput, openSheet, closeAllSheets, toast, readNum, uid, $, setHTML } from './ui.js';
import { scale, fmt, fmtAmount, G_PER_OZ, NUTRIENT } from './nutrition.js';
import { searchList } from './fooddb.js';
import { S, saveMeal, deleteMeal, mealCalc, mealToFood, dishToFood, snapshot } from './state.js';
import { refresh, imperial, units, basisUnit } from './parts.js';
import { openFoodSheet, openPicker } from './food.js';

let mealsTab = 'mine';
let momQ = '';

export function renderMeals() {
  const mine = mealsTab === 'mine';
  return html`<div class="page">
    <header class="page-head"><h1>Meals</h1><p>Build it once, log it in one tap.</p></header>
    <div class="seg big"><button class="${mine ? 'on' : ''}" data-act="meals-tab" data-tab="mine">🍳 My meals</button><button class="${mine ? '' : 'on'}" data-act="meals-tab" data-tab="mom">🇵🇪 Peruvian dishes</button></div>
    ${mine ? renderMine() : renderMom()}
  </div>`;
}

function mealCard(m, i) {
  const f = mealToFood(m);
  const n = scale(f.per100, f.portions[0].grams);
  return html`<div class="meal-card">
    <button class="meal-main" data-act="meal-log" data-i="${i}">
      <span class="meal-emoji">${m.emoji || '🍽️'}</span>
      <span class="meal-text"><b>${m.name}</b><span>${fmt(n.kcal)} kcal · P ${fmt(n.protein)} · C ${fmt(n.carbs)} · F ${fmt(n.fat)}${m.servings > 1 ? ' per serving' : ''}</span>
      <span class="dim">${n.sodium == null ? 'sodium unknown' : `${f.partial.includes('sodium') ? '≥ ' : ''}${fmt(n.sodium)} mg sodium`} · ${m.ingredients.length} ingredients</span></span>
    </button>
    <button class="icon-btn" data-act="meal-edit" data-i="${i}" aria-label="Edit ${m.name}">✏️</button>
  </div>`;
}

function renderMine() {
  return html`<button class="btn primary wide" data-act="meal-new">＋ New meal</button>
    ${S.meals.length ? S.meals.map(mealCard) : html`<div class="empty"><div class="mark">🍳</div><b>No meals yet</b><p>Add the ingredients of something you make often — overnight oats, your usual lunch, a family recipe.</p></div>`}
    <p class="fine pad">Tip: weigh the finished dish once and enter it as “cooked weight”. Then you can log any portion by weight and the math stays exact.</p>`;
}

function renderMom() {
  const list = searchList(S.dishes.dishes, momQ, 100);
  return html`<div class="card soft"><b>Home-cooked Peruvian food.</b> Pick the dish, then the plate size — or weigh your plate for a tighter number. These are typical home recipes built from USDA ingredients, so treat them as good estimates, especially for sodium.</div>
    <form class="search inline"><span class="search-ico">🔍</span><input type="search" placeholder="Search dishes (lomo, ceviche, arroz…)" value="${momQ}" data-in="mom-q" autocomplete="off"></form>
    <div id="mom-list">${momList(list)}</div>`;
}
function momList(list) {
  if (!list.length) return html`<div class="empty"><b>No dish by that name yet</b><p>Build it under “My meals” — or search the main food library.</p></div>`;
  return html`${list.map((d) => {
    const f = dishToFood(d);
    const n = scale(f.per100, f.portions[0].grams);
    return html`<button class="meal-card as-btn" data-act="dish-open" data-id="${d.id}">
      <span class="meal-emoji">${d.emoji}</span>
      <span class="meal-text"><b>${d.name}</b><span>~${fmt(n.kcal)} kcal · P ${fmt(n.protein)} · C ${fmt(n.carbs)} · F ${fmt(n.fat)}</span><span class="dim">~${fmt(n.sodium)} mg sodium · ${d.plate}</span></span>
    </button>`;
  })}`;
}

on({
  'meals-tab': (d) => {
    mealsTab = d.tab;
    refresh();
  },
  'meal-log': (d) => {
    const m = S.meals[Number(d.i)];
    if (m) openFoodSheet(mealToFood(m), { meal: m, date: S.date });
  },
  'meal-edit': (d) => {
    const m = S.meals[Number(d.i)];
    if (m) openMealEditor(structuredClone(m));
  },
  'meal-new': () => {
    closeAllSheets();
    openMealEditor({ id: uid(), name: '', emoji: '🍽️', servings: 1, cookedWeight: null, ingredients: [] }, { isNew: true });
  },
  'dish-open': (d) => {
    const dish = S.dishes.dishes.find((x) => x.id === d.id);
    if (dish) openFoodSheet(dishToFood(dish), { dish, date: S.date });
  },
});
onInput({
  'mom-q': (v) => {
    momQ = v;
    setHTML($('#mom-list'), momList(searchList(S.dishes.dishes, momQ, 100)));
  },
});

// =====================================================================================
// Recipe editor
// =====================================================================================
let me = null;
const EMOJIS = ['🍽️', '🥣', '🍳', '🍱', '🍗', '🥩', '🐟', '🍚', '🍝', '🥗', '🥪', '🌯', '🥞', '🍲', '🥤', '🍪', '🥔', '🌮', '🍜', '🥑'];

export function openMealEditor(meal, { isNew = false } = {}) {
  const st = { meal, isNew: isNew || !S.meals.some((m) => m.id === meal.id) };
  me = st;
  st.sheet = openSheet(renderME(), { cls: 'tall', guard: () => st.dirty, onClose: () => me === st && (me = null) });
}

function ingLabel(i) {
  if (i.unit === 'portion' && i.portionLabel) return `${fmt(i.qty, 2)} × ${i.portionLabel.replace(/^1 /, '')} (${fmtAmount(i.amount, i.food.basis, units())})`;
  return fmtAmount(i.amount, i.food.basis, units());
}

function meTotals() {
  const m = me.meal;
  if (!m.ingredients.length) return html`<div class="empty small"><p>Add ingredients to see the totals.</p></div>`;
  const c = mealCalc(m);
  const t = c.totalNutrients;
  const per = (k) => (t[k] == null ? null : t[k] / (m.servings || 1));
  const cell = (k, v) => html`<td>${v == null ? '—' : `${c.partial.includes(k) ? '≥' : ''}${fmt(v, k === 'kcal' || NUTRIENT[k].unit === 'mg' ? 0 : 1)}`}</td>`;
  const keys = ['kcal', 'protein', 'carbs', 'fat', 'sodium'];
  return html`<table class="totals">
    <thead><tr><th></th><th>kcal</th><th>P g</th><th>C g</th><th>F g</th><th>Na mg</th></tr></thead>
    <tbody>
      <tr><th>Per serving</th>${keys.map((k) => cell(k, per(k)))}</tr>
      ${m.servings > 1 ? html`<tr class="dim"><th>Whole recipe</th>${keys.map((k) => cell(k, t[k]))}</tr>` : ''}
    </tbody>
  </table>
  <p class="fine">${m.cookedWeight ? `Finished dish weighs ${fmtAmount(m.cookedWeight, 'g', units())}` : `Ingredients add up to ${fmtAmount(c.rawWeight, 'g', units())} (raw weight)`} · one serving = ${fmtAmount(c.servingGrams, 'g', units())}${c.partial.length ? ` · some ingredients have no ${c.partial.map((k) => NUTRIENT[k].label.toLowerCase()).join(', ')} data` : ''}</p>`;
}

function meIngredients() {
  const m = me.meal;
  return html`${m.ingredients.map((i, idx) => {
    const n = scale(i.food.per100, i.amount);
    return html`<div class="ing-row">
      <button class="ing-main" data-act="me-ing" data-i="${idx}"><b>${i.food.name}</b><span>${ingLabel(i)} · ${fmt(n.kcal)} kcal · P ${fmt(n.protein, 1)} g${n.sodium == null ? ' · sodium ?' : ` · ${fmt(n.sodium)} mg Na`}</span></button>
      <button class="icon-btn small" data-act="me-del-ing" data-i="${idx}" aria-label="Remove ${i.food.name}">✕</button>
    </div>`;
  })}`;
}

function renderME() {
  const m = me.meal;
  const cw = m.cookedWeight ? String(Math.round((imperial() ? m.cookedWeight / G_PER_OZ : m.cookedWeight) * 10) / 10) : '';
  return html`<form class="ff me">
    <div class="pk-head"><h2>${me.isNew ? 'New meal' : 'Edit meal'}</h2><button type="button" class="icon-btn" data-act="sheet-close" aria-label="Close">✕</button></div>
    <label class="field"><span>Name</span><input type="text" id="me-name" data-in="me-name" value="${m.name}" placeholder="e.g. Overnight oats" autocomplete="off"></label>
    <div class="emoji-pick" id="me-emojis">${EMOJIS.map((e) => html`<button type="button" class="${e === m.emoji ? 'on' : ''}" data-act="me-emoji" data-e="${e}">${e}</button>`)}</div>
    <div class="sec-title">Ingredients</div>
    <div id="me-ings">${meIngredients()}</div>
    <button type="button" class="btn ghost wide" data-act="me-add">＋ Add ingredient (search or scan)</button>
    <div class="field-row">
      <label class="field"><span>Makes how many servings?</span><input type="text" inputmode="decimal" data-in="me-servings" value="${m.servings || 1}" autocomplete="off"></label>
      <label class="field"><span>Cooked weight (optional)</span><div class="with-unit"><input type="text" inputmode="decimal" data-in="me-cooked" value="${cw}" placeholder="weigh it" autocomplete="off"><em>${imperial() ? 'oz' : 'g'}</em></div></label>
    </div>
    <div id="me-totals">${meTotals()}</div>
    <div class="fs-actions">
      ${me.isNew ? '' : html`<button type="button" class="btn danger ghost" data-act="me-delete">Delete</button>`}
      <button type="button" class="btn primary grow" data-act="me-save">Save meal</button>
    </div>
  </form>`;
}

function meRefresh() {
  if (!me) return;
  me.dirty = true;
  setHTML($('#me-ings', me.sheet.el), meIngredients());
  setHTML($('#me-totals', me.sheet.el), meTotals());
}

on({
  'me-emoji': (d) => {
    me.meal.emoji = d.e;
    me.dirty = true;
    setHTML($('#me-emojis', me.sheet.el), html`${EMOJIS.map((e) => html`<button type="button" class="${e === me.meal.emoji ? 'on' : ''}" data-act="me-emoji" data-e="${e}">${e}</button>`)}`);
  },
  'me-add': () => {
    const st = me;
    openPicker({
      mode: 'pick',
      onPick: (food, a) => {
        st.meal.ingredients.push({ food: snapshot(food), ...a });
        me = st;
        meRefresh();
        toast(`Added ${food.name}`, 'good');
      },
    });
  },
  'me-ing': (d) => {
    const st = me;
    const idx = Number(d.i);
    const ing = st.meal.ingredients[idx];
    const food = { ...ing.food, portions: ing.food.portions || [] };
    if (ing.unit === 'portion' && !food.portions.some((p) => p.label === ing.portionLabel)) food.portions = [{ label: ing.portionLabel, grams: ing.portionGrams }, ...food.portions];
    openFoodSheet(food, {
      mode: 'pick',
      entry: ing,
      onPick: (f, a) => {
        st.meal.ingredients[idx] = { food: ing.food, ...a };
        me = st;
        meRefresh();
      },
    });
  },
  'me-del-ing': (d) => {
    me.meal.ingredients.splice(Number(d.i), 1);
    meRefresh();
  },
  'me-save': () => {
    const m = me.meal;
    m.name = m.name.trim();
    if (!m.name) {
      toast('Give your meal a name.', 'bad');
      $('#me-name', me.sheet.el).focus();
      return;
    }
    if (!m.ingredients.length) return toast('Add at least one ingredient.', 'bad');
    if (!m.servings || m.servings <= 0) m.servings = 1;
    saveMeal(m);
    me.sheet.close();
    refresh();
    toast('Meal saved 🍳', 'good');
  },
  'me-delete': () => {
    const m = me.meal;
    if (!me.confirmDel) {
      me.confirmDel = true;
      return toast(`Tap Delete again to remove “${m.name}”. Days you already logged keep their numbers.`, 'bad');
    }
    deleteMeal(m.id);
    me.sheet.close();
    refresh();
    toast('Meal deleted');
  },
});
onInput({
  'me-name': (v) => {
    me.meal.name = v;
    me.dirty = true;
  },
  'me-servings': (v) => {
    me.dirty = true;
    const n = readNum(v);
    me.meal.servings = n && n > 0 ? n : 1;
    setHTML($('#me-totals', me.sheet.el), meTotals());
  },
  'me-cooked': (v) => {
    me.dirty = true;
    const n = readNum(v);
    me.meal.cookedWeight = n && n > 0 ? (imperial() ? n * G_PER_OZ : n) : null;
    setHTML($('#me-totals', me.sheet.el), meTotals());
  },
});

export { basisUnit };
