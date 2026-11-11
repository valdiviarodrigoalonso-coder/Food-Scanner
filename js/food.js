// Food picker (search), food detail sheet, barcode scanner, custom-food form, quick add.
import { html, raw, on, onInput, openSheet, closeAllSheets, toast, undoToast, confetti, readNum, uid, $, setHTML } from './ui.js';
import { scale, toBase, fmt, fmtN, checkFood, compareFoods, emptyNutrients, NUTRIENT, NUTRIENTS, totals, validBarcode } from './nutrition.js';
import { searchDB, searchList, dbSize, emojiFor } from './fooddb.js';
import { searchOnline, lookupBarcode } from './api.js';
import { startScanner, scanImage } from './scanner.js';
import {
  S, SLOTS, slotLabel, slotForNow, addEntry, updateEntry, removeEntry, restoreEntry, getDay, recentFor, saveMyFood, deleteMyFood, findByBarcode, isSaved,
  mealToFood, dishToFood, dishIngredients, presetToMeal, currentStreak, today, snapshot,
} from './state.js';
import { badge, badgeInfo, foodRow, nutriPanel, basisUnit, imperial, refresh, amountLabel, say } from './parts.js';
import { openMealEditor } from './meals.js';

// =====================================================================================
// Food detail sheet
// =====================================================================================
let fs = null;

const DISH_CHIPS = [[0.5, '½ plate'], [0.75, 'Small plate'], [1, 'Regular plate'], [1.25, 'Big plate'], [1.5, 'Huge plate']];

function defaultUnit(food) {
  if (food.basis === 'ml') return imperial() ? 'floz' : 'ml';
  return imperial() ? 'oz' : 'g';
}

/**
 * opts: { mode: 'log' | 'edit' | 'pick', date, slot, entry, onPick(food, amountInfo), other, dish, meal, fromScan }
 */
export function openFoodSheet(food, opts = {}) {
  const mode = opts.mode || 'log';
  const st = { food, opts, mode, date: opts.date || S.date, slot: opts.slot || slotForNow(), qty: '', unit: defaultUnit(food) };
  const pre = opts.entry || opts.prefill || recentFor(food.id);
  if (pre && pre.qty != null) {
    st.qty = String(Math.round(pre.qty * 100) / 100);
    if (pre.unit === 'portion') {
      const idx = (food.portions || []).findIndex((p) => p.label === pre.portionLabel);
      if (idx >= 0) st.unit = 'p' + idx;
      else {
        // the portion no longer exists: fall back to the exact weight
        st.unit = food.basis === 'ml' ? 'ml' : 'g';
        st.qty = String(Math.round((pre.amount ?? pre.qty * (pre.portionGrams || 0)) * 10) / 10);
      }
    } else st.unit = pre.unit;
  } else if (food.dish || food.source === 'meal') {
    st.unit = 'p0';
    st.qty = '1';
  }
  if (opts.entry) st.slot = opts.entry.slot;
  fs = st;
  st.sheet = openSheet(renderFS(), { onClose: () => fs === st && (fs = null) });
  if (!st.qty) setTimeout(() => $('#fs-qty', st.sheet.el) && $('#fs-qty', st.sheet.el).focus({ preventScroll: true }), 320);
}

function fsAmount() {
  if (!fs) return null;
  const qty = readNum(fs.qty);
  if (!qty) return null;
  if (fs.unit[0] === 'p') {
    const p = fs.food.portions[Number(fs.unit.slice(1))];
    if (!p) return null;
    return { amount: qty * p.grams, qty, unit: 'portion', portionLabel: p.label, portionGrams: p.grams };
  }
  return { amount: toBase(qty, fs.unit), qty, unit: fs.unit };
}

function unitOptions(food) {
  const base = food.basis === 'ml' ? [['ml', 'ml'], ['floz', 'fl oz']] : [['g', 'grams (g)'], ['oz', 'ounces (oz)']];
  if (imperial()) base.reverse();
  const ports = (food.portions || []).map((p, i) => ['p' + i, `${p.label} — ${fmt(p.grams, 1)} ${basisUnit(food)}`]);
  return [...base, ...ports];
}

function fsWarnings() {
  const f = fs.food;
  const list = [];
  for (const w of checkFood(f)) list.push(html`<div class="note ${w.level}">${w.level === 'bad' ? '⚠️ ' : w.level === 'warn' ? '🧂 ' : 'ℹ️ '}${w.msg}</div>`);
  if (fs.opts.other) {
    const diffs = compareFoods(f, fs.opts.other);
    if (diffs.length) {
      const txt = diffs.map((d) => `${NUTRIENT[d.key].label}: ${fmtN(d.key, d.a)} vs ${fmtN(d.key, d.b)} ${NUTRIENT[d.key].unit}`).join(' · ');
      list.push(html`<div class="note bad">⚠️ Two databases disagree about this product (USDA vs Open Food Facts, per 100 ${basisUnit(f)}): ${txt}. Check your package and use “Fix numbers” if needed.</div>`);
    }
  }
  // only interrupt for the numbers that matter most; the rest just show "≥" in the panel
  const keyGaps = (f.partial || []).filter((k) => ['kcal', 'protein', 'carbs', 'fat', 'sodium'].includes(k));
  if (keyGaps.length) {
    list.push(html`<div class="note warn">Some ingredients have no data for ${keyGaps.map((k) => NUTRIENT[k].label.toLowerCase()).join(', ')} — the real amount is at least what is shown.</div>`);
  }
  if (f.quality === 'recipe-usda') list.push(html`<div class="note info">ℹ️ USDA “as prepared” estimate: assumes typical salt and fat were added in cooking.</div>`);
  if (f.dish) list.push(html`<div class="note warn">Home-cooking estimate for one plate. Every cook makes it differently — mostly in oil and salt — so treat sodium as a rough guide. Weigh your plate if you can, or make your own version below.</div>`);
  return list;
}

function fsExtras() {
  const f = fs.food;
  const parts = [];
  const x = f.extra || {};
  if (x.nutriscore || x.nova || (x.additives && x.additives.length)) {
    const nova = { 1: 'Unprocessed', 2: 'Cooking ingredient', 3: 'Processed', 4: 'Ultra-processed' }[x.nova];
    parts.push(html`<div class="quality-card">
      <div class="q-title">Product check <small>from Open Food Facts</small></div>
      <div class="q-row">
        ${x.nutriscore ? html`<div class="q-pill ns-${x.nutriscore}"><b>${x.nutriscore.toUpperCase()}</b><span>Nutri-Score</span></div>` : ''}
        ${nova ? html`<div class="q-pill nova-${x.nova}"><b>${x.nova}</b><span>${nova}</span></div>` : ''}
        <div class="q-pill add-${Math.min((x.additives || []).length, 3)}"><b>${(x.additives || []).length}</b><span>Additives</span></div>
      </div>
      ${x.additives && x.additives.length ? html`<div class="q-add">${x.additives.slice(0, 14).join(' · ')}</div>` : ''}
    </div>`);
  }
  if (x.ingredients) parts.push(html`<details class="fold"><summary>Ingredients</summary><p>${x.ingredients}</p></details>`);
  const ing = fs.opts.dish ? dishIngredients(fs.opts.dish) : fs.opts.meal ? fs.opts.meal.ingredients : null;
  if (ing) {
    parts.push(html`<details class="fold" ${fs.opts.dish ? 'open' : ''}><summary>What’s in ${fs.opts.dish ? 'one plate' : 'the recipe'}</summary>
      <div class="ing-list">${ing.map((i) => {
        const n = scale(i.food.per100, i.amount);
        return html`<div class="ing"><span>${i.label || i.food.short || i.food.name}</span><span>${fmt(i.amount, 0)} ${basisUnit(i.food)} · ${fmt(n.kcal)} kcal · ${n.sodium == null ? '? ' : fmt(n.sodium)} mg Na</span></div>`;
      })}</div>
    </details>`);
  }
  if (f.sourceNote) parts.push(html`<p class="fine">${f.sourceNote}</p>`);
  return parts;
}

function fsVerify() {
  const f = fs.food;
  if (f.verified || !['label', 'community'].includes(f.quality)) return '';
  return html`<div class="verify">
    <div><b>Check it once.</b> Compare these numbers with the package${f.portions && f.portions[0] && /^1 serving/.test(f.portions[0].label) ? ` — tap “${f.portions[0].label}” above to see one serving, like the label shows` : ' (labels show values per serving; enter the serving weight above to compare)'}.</div>
    <div class="verify-btns"><button class="btn small good" data-act="fs-verify">✓ Matches my label</button><button class="btn small ghost" data-act="fs-fix">✏️ Fix numbers</button></div>
  </div>`;
}

function fsChips() {
  const f = fs.food;
  if (f.dish) return DISH_CHIPS.map(([m, label]) => html`<button class="chip ${fs.unit === 'p0' && readNum(fs.qty) === m ? 'on' : ''}" data-act="fs-chip" data-u="p0" data-q="${m}">${label}</button>`);
  return (f.portions || []).slice(0, 6).map((p, i) => html`<button class="chip ${fs.unit === 'p' + i && readNum(fs.qty) === 1 ? 'on' : ''}" data-act="fs-chip" data-u="p${i}" data-q="1">${p.label}</button>`);
}

function fsNutri() {
  const a = fsAmount();
  const f = fs.food;
  if (!a) return nutriPanel(f.per100, `Per 100 ${basisUnit(f)} — enter an amount`, f);
  const what = a.unit === 'portion' ? `${fmt(a.qty, 2)} × ${a.portionLabel} (${fmt(a.amount, 0)} ${basisUnit(f)})` : `${fmt(a.qty, 2)} ${{ g: 'g', oz: 'oz', ml: 'ml', floz: 'fl oz' }[a.unit]}${a.unit === 'oz' || a.unit === 'floz' ? ` (${fmt(a.amount, 0)} ${basisUnit(f)})` : ''}`;
  return nutriPanel(scale(f.per100, a.amount), what, f);
}

function fsButtons() {
  const ok = !!fsAmount();
  if (fs.mode === 'edit') return html`<button class="btn danger ghost" data-act="fs-delete">Delete</button><button class="btn primary grow" data-act="fs-add" ${ok ? '' : 'disabled'}>Save changes</button>`;
  if (fs.mode === 'pick') return html`<button class="btn primary grow" data-act="fs-add" ${ok ? '' : 'disabled'}>${fs.opts.entry ? 'Update ingredient' : 'Add to recipe'}</button>`;
  return html`<button class="btn primary grow" data-act="fs-add" ${ok ? '' : 'disabled'}>Add to ${slotLabel(fs.slot)}</button>`;
}

function renderFS() {
  const f = fs.food;
  const canSave = ['usda-f', 'usda-s', 'usda-n', 'usda-branded', 'off', 'custom'].includes(f.source);
  const mine = f.source === 'custom';
  return html`<div class="fs">
    <div class="fs-top">
      <div class="fs-emoji">${emojiFor(f)}</div>
      <div class="fs-title"><h2>${f.name}</h2>${f.brand ? html`<div class="fs-brand">${f.brand}</div>` : ''}<button class="badge-btn" data-act="fs-badge">${badge(f)} <span class="q">?</span></button></div>
      <button class="icon-btn" data-act="sheet-close" aria-label="Close">✕</button>
    </div>
    <div id="fs-warn">${fsWarnings()}</div>
    <div class="amount-card">
      <label for="fs-qty">How much${fs.mode === 'pick' ? ' goes in' : ' did you eat'}?</label>
      <div class="amount-row">
        <input id="fs-qty" class="big-input" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="0" value="${fs.qty}" data-in="fs-qty" data-enter="fs-add">
        <select class="unit-select" data-in="fs-unit" aria-label="Unit">${unitOptions(f).map(([v, l]) => html`<option value="${v}" ${v === fs.unit ? 'selected' : ''}>${l}</option>`)}</select>
      </div>
      <div class="chips wrap" id="fs-chips">${fsChips()}</div>
    </div>
    ${fs.mode !== 'pick' ? html`<div class="chips slots" id="fs-slots">${SLOTS.map((s) => html`<button class="chip ${s.id === fs.slot ? 'on' : ''}" data-act="fs-slot" data-slot="${s.id}">${s.emoji} ${s.label}</button>`)}</div>` : ''}
    <div id="fs-nutri">${fsNutri()}</div>
    <div id="fs-verify">${fsVerify()}</div>
    ${fsExtras()}
    <div class="fs-links">
      ${canSave && !mine ? html`<button class="link" data-act="fs-save" id="fs-save">${isSaved(f.id) ? '★ Saved in My Foods' : '☆ Save to My Foods'}</button>` : ''}
      ${mine ? html`<button class="link" data-act="fs-fix">✏️ Edit this food</button><button class="link danger" data-act="fs-remove-mine">Remove from My Foods</button>` : ''}
      ${fs.opts.dish ? html`<button class="link" data-act="fs-own">🍳 Make my own version</button>` : ''}
      ${fs.opts.meal ? html`<button class="link" data-act="fs-edit-meal">✏️ Edit recipe</button>` : ''}
    </div>
    <div class="fs-actions" id="fs-actions">${fsButtons()}</div>
  </div>`;
}

function fsUpdate() {
  if (!fs) return;
  const el = fs.sheet.el;
  setHTML($('#fs-nutri', el), fsNutri());
  setHTML($('#fs-actions', el), fsButtons());
  setHTML($('#fs-chips', el), html`${fsChips()}`);
}

/** Celebrate when this entry pushes protein over the goal, or starts/extends the streak. */
function celebrate(date, before) {
  const after = totals(getDay(date).entries);
  const g = S.settings.goals;
  if (date === today()) {
    if (before.protein.sum < g.protein && after.protein.sum >= g.protein) {
      confetti();
      toast(say('proteinGoal'), 'good');
      return;
    }
    if (before.count === 0) {
      const st = currentStreak();
      toast(st.current > 1 ? say('firstOfDay', { n: st.current }) : say('streakStart'), 'good');
      return;
    }
  }
  toast(say('logged'), 'good');
}

on({
  'fs-chip': (d) => {
    fs.unit = d.u;
    fs.qty = d.q;
    const el = fs.sheet.el;
    $('#fs-qty', el).value = fs.qty;
    $('.unit-select', el).value = fs.unit;
    fsUpdate();
  },
  'fs-slot': (d) => {
    fs.slot = d.slot;
    setHTML($('#fs-slots', fs.sheet.el), html`${SLOTS.map((s) => html`<button class="chip ${s.id === fs.slot ? 'on' : ''}" data-act="fs-slot" data-slot="${s.id}">${s.emoji} ${s.label}</button>`)}`);
    fsUpdate();
  },
  'fs-badge': () => {
    const [label, , tip] = badgeInfo(fs.food);
    toast(`${label.replace(/^[✓~] ?/, '')}: ${tip}`, 'info');
  },
  'fs-add': () => {
    const a = fsAmount();
    if (!a) return;
    const { food, opts, mode, date, slot } = fs;
    if (checkFood(food).some((w) => w.key === 'core') && mode === 'log' && !fs.confirmedBad) {
      fs.confirmedBad = true;
      toast('This food is missing calories or macros. Tap again to log it anyway, or fix the numbers first.', 'bad');
      return;
    }
    if (mode === 'pick') {
      opts.onPick(food, a);
      fs.sheet.close();
      return;
    }
    if (mode === 'edit') {
      updateEntry(date, opts.entry.id, { ...a, slot, food: snapshot(food) });
      closeAllSheets();
      refresh();
      toast('Updated ✔', 'good');
      return;
    }
    const day = getDay(date);
    const before = totals(day.entries);
    before.count = day.entries.length;
    addEntry(date, slot, food, a);
    closeAllSheets();
    refresh();
    celebrate(date, before);
  },
  'fs-delete': () => {
    const { date, opts } = fs;
    const removed = removeEntry(date, opts.entry.id);
    closeAllSheets();
    refresh();
    undoToast('Deleted.', () => {
      restoreEntry(date, removed);
      refresh();
    });
  },
  'fs-save': () => {
    if (isSaved(fs.food.id)) {
      deleteMyFood(fs.food.id);
      toast('Removed from My Foods');
    } else {
      saveMyFood(fs.food);
      toast('Saved to My Foods ★', 'good');
    }
    $('#fs-save', fs.sheet.el).textContent = isSaved(fs.food.id) ? '★ Saved in My Foods' : '☆ Save to My Foods';
  },
  'fs-verify': () => {
    fs.food = { ...fs.food, verified: true };
    saveMyFood(fs.food);
    fs.sheet.set(renderFS());
    toast('Marked as checked ✓ — future scans will use it instantly', 'good');
  },
  'fs-fix': () => {
    const st = fs;
    openFoodForm(st.food, {
      onSave: (nf) => {
        st.food = nf;
        st.opts = { ...st.opts, other: null };
        if (st.unit[0] === 'p') st.unit = nf.portions.length ? 'p0' : defaultUnit(nf);
        fs = st;
        st.sheet.set(renderFS());
      },
    });
  },
  'fs-remove-mine': () => {
    deleteMyFood(fs.food.id);
    toast('Removed from My Foods');
    fs.sheet.close();
    pkRender();
  },
  'fs-own': () => {
    const meal = presetToMeal(fs.opts.dish, `My ${fs.opts.dish.name.toLowerCase()}`);
    closeAllSheets();
    openMealEditor(meal, { isNew: true });
  },
  'fs-edit-meal': () => {
    const meal = fs.opts.meal;
    closeAllSheets();
    openMealEditor(structuredClone(meal));
  },
});
onInput({
  'fs-qty': (v) => {
    fs.qty = v;
    fsUpdate();
  },
  'fs-unit': (v) => {
    fs.unit = v;
    if (v[0] === 'p' && !readNum(fs.qty)) {
      fs.qty = '1';
      $('#fs-qty', fs.sheet.el).value = '1';
    }
    fsUpdate();
  },
});

// =====================================================================================
// Picker (search)
// =====================================================================================
let pk = null;

/** opts: { mode: 'log' | 'pick', date, slot, onPick, tab } */
export function openPicker(opts = {}) {
  const st = { mode: opts.mode || 'log', date: opts.date || S.date, slot: opts.slot || slotForNow(), onPick: opts.onPick, q: '', tab: opts.tab || 'all', items: [], online: { q: '', state: 'idle', items: [], errors: [] } };
  pk = st;
  const tabs = st.mode === 'pick' ? [['all', 'All'], ['recent', 'Recent'], ['mine', 'My foods']] : [['all', 'All'], ['recent', 'Recent'], ['mine', 'My foods'], ['meals', 'Meals'], ['mom', '🇵🇪 Peruvian']];
  st.tabs = tabs;
  st.sheet = openSheet(
    html`<div class="pk">
      <div class="pk-head">
        <h2>${st.mode === 'pick' ? 'Add an ingredient' : 'Add food'}</h2>
        <button class="icon-btn" data-act="sheet-close" aria-label="Close">✕</button>
      </div>
      ${st.mode === 'log' ? html`<div class="chips slots" id="pk-slots"></div>` : ''}
      <form class="search" role="search">
        <span class="search-ico">🔍</span>
        <input id="pk-q" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Search ${dbSize().toLocaleString('en-US')}+ foods, brands, dishes" data-in="pk-q">
        <button type="button" class="scan-btn" data-act="pk-scan" aria-label="Scan barcode">${raw(BARCODE_SVG)}</button>
      </form>
      <div class="chips tabs" id="pk-tabs"></div>
      <div id="pk-results" class="results"></div>
    </div>`,
    { cls: 'tall', onClose: () => pk === st && (pk = null) },
  );
  pkChrome();
  pkRender();
}

const BARCODE_SVG = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8v8M10 8v8M13 8v8M17 8v8" stroke-width="1.8"/></svg>';

function pkChrome() {
  const el = pk.sheet.el;
  if (pk.mode === 'log') setHTML($('#pk-slots', el), html`${SLOTS.map((s) => html`<button class="chip ${s.id === pk.slot ? 'on' : ''}" data-act="pk-slot" data-slot="${s.id}">${s.emoji} ${s.label}</button>`)}`);
  setHTML($('#pk-tabs', el), html`${pk.tabs.map(([id, label]) => html`<button class="chip ${id === pk.tab ? 'on' : ''}" data-act="pk-tab" data-tab="${id}">${label}</button>`)}`);
}

function section(title, rows, extra) {
  if (!rows.length && !extra) return '';
  return html`<div class="sec"><div class="sec-title">${title}</div>${rows}${extra || ''}</div>`;
}

function pkRender() {
  if (!pk) return;
  const q = pk.q.trim();
  const items = (pk.items = []);
  const add = (kind, obj, food) => items.push({ kind, obj, food }) - 1;
  const rowFood = (f) => foodRow(f, add('food', f, f));
  const rowMeal = (m) => {
    const f = mealToFood(m);
    const n = scale(f.per100, f.portions[0].grams);
    return foodRow(f, add('meal', m, f), { sub: `${fmt(n.kcal)} kcal · P ${fmt(n.protein)} g per serving · ${m.ingredients.length} ingredients` });
  };
  const rowDish = (d) => {
    const f = dishToFood(d);
    const n = scale(f.per100, f.portions[0].grams);
    return foodRow(f, add('dish', d, f), { sub: `~${fmt(n.kcal)} kcal · P ${fmt(n.protein)} g · ~${fmt(n.sodium)} mg sodium per plate` });
  };
  const rowRecent = (r) => foodRow(r.food, add('food', r.food, r.food), { sub: `${r.food.brand ? r.food.brand + ' · ' : ''}last: ${amountLabel(r)}` });
  const recents = S.recents.filter((r) => pk.mode === 'log' || (r.food.source !== 'meal' && r.food.source !== 'dish'));
  let out;

  if (pk.tab === 'recent') {
    const list = q ? searchList(recents.map((r) => ({ ...r, name: r.food.name, brand: r.food.brand })), q, 60) : recents.slice(0, 60);
    out = list.length ? section('Recently logged', list.map(rowRecent)) : empty('Nothing here yet', 'Foods you log show up here so you can re-add them in two taps.', '🕘');
  } else if (pk.tab === 'mine') {
    const list = searchList(S.myFoods, q, 80);
    out = html`<div class="quick-grid two"><button class="quick" data-act="pk-create"><span>✏️</span>Create a food</button><button class="quick" data-act="pk-scan"><span>📷</span>Scan a barcode</button></div>
      ${list.length ? section('My foods', list.map(rowFood)) : empty('No saved foods yet', 'Foods you create, fix or mark as “matches my label” are kept here and load instantly — even offline.', '⭐')}`;
  } else if (pk.tab === 'meals') {
    const list = searchList(S.meals, q, 80);
    out = html`<div class="quick-grid two"><button class="quick" data-act="meal-new"><span>🍳</span>New meal</button><button class="quick" data-act="pk-tab" data-tab="mom"><span>🇵🇪</span>Peruvian dishes</button></div>
      ${list.length ? section('My meals', list.map(rowMeal)) : empty('No meals yet', 'Build a meal once (overnight oats, your usual lunch…) and log it in one tap.', '🍳')}`;
  } else if (pk.tab === 'mom') {
    const list = searchList(S.dishes.dishes, q, 80);
    out = html`<p class="fine pad">Typical Peruvian home plates, built from USDA ingredients. Estimates — tap one to pick the plate size or weigh it.</p>${section('Peruvian dishes', list.map(rowDish))}`;
  } else if (!q) {
    out = html`<div class="quick-grid">
        <button class="quick" data-act="pk-scan"><span>📷</span>Scan barcode</button>
        <button class="quick" data-act="pk-quick"><span>⚡</span>Quick add</button>
        <button class="quick" data-act="pk-create"><span>✏️</span>Create food</button>
      </div>
      ${recents.length ? section('Recent', recents.slice(0, 15).map(rowRecent)) : empty('Search for anything', 'Try “chicken breast”, “arroz”, “greek yogurt”, a brand name — or scan a barcode.')}`;
  } else {
    const mine = searchList(S.myFoods, q, 4);
    const meals = pk.mode === 'log' ? searchList(S.meals, q, 4) : [];
    const dishes = pk.mode === 'log' ? searchList(S.dishes.dishes, q, 4) : [];
    const frequent = searchList(recents.filter((r) => !isSaved(r.food.id) && r.food.source !== 'meal' && r.food.source !== 'dish').map((r) => ({ ...r, name: r.food.name, brand: r.food.brand })), q, 3);
    const local = searchDB(q, 40);
    const o = pk.online;
    let onlineBody;
    if (q.length < 3) onlineBody = html`<p class="fine pad">Type at least 3 letters to search brands online.</p>`;
    else if (o.q !== q || o.state === 'idle') onlineBody = html`<button class="btn ghost wide" data-act="pk-online">Search brands online for “${q}”</button>`;
    else if (o.state === 'loading') onlineBody = html`<div class="loading"><span class="spin"></span> Searching Open Food Facts and USDA…</div>`;
    else {
      onlineBody = html`${o.items.map(rowFood)}${o.state === 'partial' ? html`<div class="loading"><span class="spin"></span> Still checking the other database…</div>` : ''}${o.state === 'done' && !o.items.length && !o.errors.length ? html`<p class="fine pad">No packaged foods found online for “${q}”.</p>` : ''}${o.errors.map((e) => html`<p class="fine pad warn-text">⚠️ ${e}</p>`)}`;
    }
    out = html`${section('My foods', mine.map(rowFood))}${section('My meals', meals.map(rowMeal))}${section('🇵🇪 Peruvian dishes', dishes.map(rowDish))}${section('You’ve logged', frequent.map(rowRecent))}
      ${section('USDA library', local.map(rowFood), local.length ? '' : html`<p class="fine pad">No match in the built-in library.</p>`)}
      ${section('Brands & packaged foods', [], onlineBody)}
      <div class="pk-foot"><button class="link" data-act="pk-create">Can’t find it? Create it from the label</button></div>`;
  }
  setHTML($('#pk-results', pk.sheet.el), out);
}

const empty = (title, text, icon = '🔍') => html`<div class="empty"><div class="mark">${icon}</div><b>${title}</b><p>${text}</p></div>`;

let localTimer = null;
let onlineTimer = null;
async function runOnline(q) {
  if (!pk || pk.q.trim() !== q || q.length < 3) return;
  const st = pk;
  st.online = { q, state: 'loading', items: [], errors: [] };
  pkRender();
  await searchOnline(q, { usdaKey: S.settings.usdaKey }, (res) => {
    if (pk !== st || st.q.trim() !== q) return;
    st.online = { q, state: res.pending ? 'partial' : 'done', items: res.items, errors: res.errors };
    pkRender();
  });
}

function pickerOpts() {
  return { mode: pk.mode, date: pk.date, slot: pk.slot, onPick: pk.onPick };
}

on({
  'pk-slot': (d) => {
    pk.slot = d.slot;
    pkChrome();
  },
  'pk-tab': (d) => {
    pk.tab = d.tab;
    pkChrome();
    pkRender();
    $('#pk-results', pk.sheet.el).scrollTop = 0;
  },
  'pk-open': (d) => {
    let it = pk.items[Number(d.i)];
    if (!it) return;
    if (document.activeElement) document.activeElement.blur();
    // a recently-logged dish or meal: open the live recipe so edits made since then are used
    if (it.kind === 'food' && it.food.source === 'dish') {
      const dish = S.dishes.dishes.find((x) => x.id === it.food.id);
      if (dish) it = { kind: 'dish', obj: dish, food: dishToFood(dish) };
    } else if (it.kind === 'food' && it.food.source === 'meal') {
      const meal = S.meals.find((m) => 'meal:' + m.id === it.food.id);
      if (meal) it = { kind: 'meal', obj: meal, food: mealToFood(meal) };
    }
    const extra = it.kind === 'dish' ? { dish: it.obj } : it.kind === 'meal' ? { meal: it.obj } : {};
    openFoodSheet(it.food, { ...pickerOpts(), ...extra });
  },
  'pk-online': () => runOnline(pk.q.trim()),
  'pk-scan': () => openScanner(pk ? pickerOpts() : {}),
  'pk-create': () => {
    const opts = pk ? pickerOpts() : {};
    openFoodForm(null, { name: pk ? pk.q.trim() : '', onSave: (f) => openFoodSheet(f, opts) });
  },
  'pk-quick': () => openQuickAdd(pk ? pickerOpts() : {}),
});
onInput({
  'pk-q': (v) => {
    pk.q = v;
    clearTimeout(localTimer);
    clearTimeout(onlineTimer);
    localTimer = setTimeout(pkRender, 90);
    const q = v.trim();
    if (pk.tab === 'all' && q.length >= 3) onlineTimer = setTimeout(() => runOnline(q), 1200);
  },
});

// =====================================================================================
// Barcode scanner
// =====================================================================================
let sc = null;

export function openScanner(opts = {}) {
  if (sc) return;
  const st = { opts, ctl: null, busy: false };
  sc = st;
  st.sheet = openSheet(
    html`<div class="scan">
      <div class="pk-head"><h2>Scan a barcode</h2><button class="icon-btn" data-act="sheet-close" aria-label="Close">✕</button></div>
      <div class="cam">
        <video id="sc-video" playsinline muted autoplay></video>
        <div class="cam-frame"><i></i></div>
        <div class="cam-status" id="sc-status">Starting camera…</div>
        <button class="cam-torch" id="sc-torch" data-act="sc-torch" hidden>🔦</button>
      </div>
      <div id="sc-panel"></div>
      <form class="manual">
        <input id="sc-code" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="…or type the barcode number" maxlength="14">
        <button type="button" class="btn small primary" data-act="sc-manual" data-submit>Look up</button>
      </form>
      <label class="link filepick">📸 Camera not working? Take a photo of the barcode instead<input type="file" accept="image/*" capture="environment" data-in="sc-photo" hidden></label>
    </div>`,
    {
      cls: 'tall',
      onClose: () => {
        if (st.ctl) st.ctl.stop();
        if (sc === st) sc = null;
      },
    },
  );
  scStart();
}

async function scStart() {
  const st = sc;
  if (!st) return;
  const el = st.sheet.el;
  const status = (t) => $('#sc-status', el) && ($('#sc-status', el).textContent = t);
  setHTML($('#sc-panel', el), '');
  st.busy = false;
  const fail = (msg) => {
    status('');
    setHTML($('#sc-panel', el), html`<div class="note bad">📷 ${msg}</div><p class="fine pad">You can still type the number printed under the barcode, or use a photo, below.</p>`);
  };
  if (st.ctl) st.ctl.stop();
  st.ctl = null;
  st.starting = true;
  status('Starting camera…');
  try {
    const ctl = await startScanner(
      $('#sc-video', el),
      (code) => scFound(code),
      (s, msg) => (s === 'error' ? fail(msg) : status(s === 'loading' ? 'Loading barcode reader…' : 'Point at the barcode — hold it about 6 in (15 cm) away')),
    );
    if (sc !== st || st.sheet.closed) return ctl.stop();
    st.ctl = ctl;
    if (ctl.hasTorch) $('#sc-torch', el).hidden = false;
  } catch (e) {
    if (sc === st) fail(e.message);
  } finally {
    st.starting = false;
  }
}

// iOS pauses the camera when the app goes to the background; start it again on return.
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !sc || sc.busy || sc.starting) return;
  if (!sc.ctl || !sc.ctl.alive()) scStart();
});

async function scFound(code) {
  const st = sc;
  if (!st || st.busy) return;
  st.busy = true;
  const el = st.sheet.el;
  const status = (t) => $('#sc-status', el) && ($('#sc-status', el).textContent = t);
  status(`Found ${code} — looking it up…`);
  $('.cam', el).classList.add('hit');
  const mine = findByBarcode(code);
  if (mine) return scOpen(st, mine, null);
  setHTML($('#sc-panel', el), html`<div class="loading"><span class="spin"></span> Looking up ${code} in Open Food Facts and USDA…</div>`);
  const res = await lookupBarcode(code, { usdaKey: S.settings.usdaKey });
  if (sc !== st) return;
  if (res.food) return scOpen(st, res.food, res.other);
  status('');
  setHTML(
    $('#sc-panel', el),
    html`<div class="note warn">🤷 <b>${code}</b> isn’t in either database${res.errors.length ? ' (or a lookup failed)' : ''}.</div>
      ${res.errors.map((e) => html`<p class="fine pad warn-text">⚠️ ${e}</p>`)}
      <div class="btn-col">
        <button class="btn primary" data-act="sc-create" data-code="${code}">✏️ Enter it from the label (saved for next time)</button>
        <button class="btn ghost" data-act="sc-again">📷 Scan again</button>
      </div>`,
  );
}

function scOpen(st, food, other) {
  const opts = st.opts;
  st.sheet.close();
  openFoodSheet(food, { ...opts, other, fromScan: true });
}

on({
  'sc-torch': (d, el) => {
    el.classList.toggle('on');
    sc.ctl && sc.ctl.torch(el.classList.contains('on'));
  },
  'sc-manual': () => {
    const code = $('#sc-code', sc.sheet.el).value.replace(/\D/g, '');
    if (!validBarcode(code) && code.length !== 8) return toast('That doesn’t look like a complete barcode number — check the digits.', 'bad');
    if (sc.ctl) sc.ctl.stop();
    sc.busy = false;
    scFound(code);
  },
  'sc-again': () => {
    $('.cam', sc.sheet.el).classList.remove('hit');
    scStart();
  },
  'sc-create': (d) => {
    const opts = sc.opts;
    sc.sheet.close();
    openFoodForm(null, { barcode: d.code, onSave: (f) => openFoodSheet(f, opts) });
  },
});
onInput({
  'sc-photo': async (v, el) => {
    const file = el.files && el.files[0];
    if (!file || !sc) return;
    toast('Reading photo…');
    try {
      const code = await scanImage(file);
      if (!code) return toast('No barcode found in that photo — try closer, with good light.', 'bad');
      if (sc.ctl) sc.ctl.stop();
      sc.busy = false;
      scFound(code);
    } catch {
      toast('Could not read that photo.', 'bad');
    }
    el.value = '';
  },
});

// =====================================================================================
// Create / fix a food from the label
// =====================================================================================
let ff = null;
const LABEL_ORDER = ['kcal', 'fat', 'satFat', 'cholesterol', 'sodium', 'carbs', 'fiber', 'sugar', 'protein', 'potassium'];

/** base: food to edit/fix (or null). opts: { name, barcode, onSave(food) } */
export function openFoodForm(base, opts = {}) {
  const serving = base && base.portions && base.portions[0] ? base.portions[0] : null;
  const st = {
    base, opts,
    per: base && !serving ? '100' : 'serving',
    basis: base ? base.basis || 'g' : 'g',
    servingSize: serving ? String(Math.round(serving.grams * 10) / 10) : '',
    servingLabel: serving ? serving.label.replace(/^1 serving \((.*)\)$/, '$1').replace(/^1 serving$/, '') : '',
    name: base ? base.name : opts.name || '',
    brand: base ? base.brand || '' : '',
    barcode: base ? base.barcode || '' : opts.barcode || '',
    vals: {},
    tried: false,
  };
  const factor = st.per === 'serving' && serving ? serving.grams / 100 : 1;
  for (const k of LABEL_ORDER) {
    const v = base ? base.per100[k] : null;
    st.vals[k] = v == null ? '' : String(Math.round(v * factor * (NUTRIENT[k].unit === 'mg' || k === 'kcal' ? 1 : 10)) / (NUTRIENT[k].unit === 'mg' || k === 'kcal' ? 1 : 10));
  }
  ff = st;
  st.sheet = openSheet(renderFF(), { cls: 'tall', guard: () => st.dirty, onClose: () => ff === st && (ff = null) });
}

function renderFF() {
  const u = ff.basis;
  const lbl = { kcal: 'Calories', fat: 'Total fat', satFat: 'Saturated fat', cholesterol: 'Cholesterol', sodium: 'Sodium', carbs: 'Total carbohydrate', fiber: 'Dietary fiber', sugar: 'Total sugars', protein: 'Protein', potassium: 'Potassium' };
  return html`<form class="ff">
    <div class="pk-head"><h2>${ff.base ? 'Fix the numbers' : 'Create a food'}</h2><button type="button" class="icon-btn" data-act="sheet-close" aria-label="Close">✕</button></div>
    <p class="fine">Copy the Nutrition Facts panel exactly. Leave a box <b>empty</b> if the label doesn’t list it — empty means “unknown”, not zero.</p>
    <label class="field"><span>Name</span><input type="text" data-in="ff" data-k="name" value="${ff.name}" placeholder="e.g. Vanilla whey protein" autocomplete="off"></label>
    <div class="field-row">
      <label class="field"><span>Brand (optional)</span><input type="text" data-in="ff" data-k="brand" value="${ff.brand}" autocomplete="off"></label>
      <label class="field"><span>Barcode (optional)</span><input type="text" inputmode="numeric" data-in="ff" data-k="barcode" value="${ff.barcode}" autocomplete="off"></label>
    </div>
    <div class="seg" role="tablist">
      <button type="button" class="${ff.per === 'serving' ? 'on' : ''}" data-act="ff-per" data-per="serving">Label is per serving</button>
      <button type="button" class="${ff.per === '100' ? 'on' : ''}" data-act="ff-per" data-per="100">Per 100 ${u}</button>
    </div>
    <div class="field-row">
      <label class="field"><span>Serving size ${ff.per === 'serving' ? '(required)' : '(optional)'}</span>
        <div class="with-unit"><input type="text" inputmode="decimal" data-in="ff" data-k="servingSize" value="${ff.servingSize}" placeholder="e.g. 32" autocomplete="off">
        <select data-in="ff" data-k="basis"><option value="g" ${u === 'g' ? 'selected' : ''}>g</option><option value="ml" ${u === 'ml' ? 'selected' : ''}>ml</option></select></div>
      </label>
      <label class="field"><span>Serving name (optional)</span><input type="text" data-in="ff" data-k="servingLabel" value="${ff.servingLabel}" placeholder="e.g. 1 scoop" autocomplete="off"></label>
    </div>
    <div class="label-grid">
      ${LABEL_ORDER.map((k) => html`<label class="field inline ${k === 'satFat' || k === 'fiber' || k === 'sugar' ? 'sub' : ''}"><span>${lbl[k]}</span><div class="with-unit"><input type="text" inputmode="decimal" data-in="ff-val" data-k="${k}" value="${ff.vals[k]}" placeholder="—" autocomplete="off"><em>${NUTRIENT[k].unit}</em></div></label>`)}
    </div>
    <div id="ff-warn"></div>
    <div class="fs-actions"><button type="button" class="btn primary grow" data-act="ff-save" data-submit>Save food</button></div>
  </form>`;
}

function ffBuild() {
  const size = readNum(ff.servingSize);
  const per100 = emptyNutrients();
  const factor = ff.per === 'serving' ? (size ? 100 / size : null) : 1;
  for (const k of LABEL_ORDER) {
    const v = readNum(ff.vals[k]);
    per100[k] = v == null || factor == null ? null : v * factor;
  }
  const base = ff.base;
  const keepId = base && base.source === 'custom';
  const portions = size ? [{ label: ff.servingLabel.trim() ? `1 serving (${ff.servingLabel.trim()})` : '1 serving', grams: size }] : [];
  return {
    id: keepId ? base.id : 'my:' + uid(), name: ff.name.trim(), brand: ff.brand.trim(), source: 'custom', quality: 'mine', verified: true, basis: ff.basis, per100, portions,
    barcode: ff.barcode.replace(/\D/g, ''), extra: base && base.extra ? base.extra : undefined,
  };
}

on({
  'ff-per': (d) => {
    ff.per = d.per;
    ff.sheet.set(renderFF());
  },
  'ff-save': () => {
    const problems = [];
    if (!ff.name.trim()) problems.push('Give the food a name.');
    if (ff.per === 'serving' && !readNum(ff.servingSize)) problems.push(`Enter the serving size in ${ff.basis} (it’s printed next to “Serving size” on the label).`);
    for (const k of LABEL_ORDER) if (ff.vals[k].trim() !== '' && readNum(ff.vals[k]) == null) problems.push(`“${ff.vals[k]}” is not a number.`);
    const warnEl = $('#ff-warn', ff.sheet.el);
    if (problems.length) return setHTML(warnEl, html`${problems.map((p) => html`<div class="note bad">⚠️ ${p}</div>`)}`);
    const food = ffBuild();
    const bad = checkFood(food).filter((w) => w.level === 'bad' || w.key === 'sodium');
    if (bad.length && !ff.tried) {
      ff.tried = true;
      setHTML(warnEl, html`${bad.map((w) => html`<div class="note ${w.level}">⚠️ ${w.msg}</div>`)}<p class="fine">Double-check the label. If it really says this, tap “Save food” again.</p>`);
      return;
    }
    // one saved food per barcode: the corrected version replaces any earlier copy
    if (food.barcode) S.myFoods.filter((f) => f.id !== food.id && f.barcode && f.barcode.replace(/^0+/, '') === food.barcode.replace(/^0+/, '')).forEach((f) => deleteMyFood(f.id));
    const saved = saveMyFood(food);
    const cb = ff.opts.onSave;
    ff.sheet.close();
    toast('Saved to My Foods ★', 'good');
    if (cb) cb(saved);
  },
});
onInput({
  ff: (v, el) => {
    ff[el.dataset.k] = v;
    ff.dirty = true;
    ff.tried = false;
    if (el.dataset.k === 'basis') ff.sheet.set(renderFF());
  },
  'ff-val': (v, el) => {
    ff.vals[el.dataset.k] = v;
    ff.dirty = true;
    ff.tried = false;
  },
});

// =====================================================================================
// Quick add
// =====================================================================================
let qa = null;
export function openQuickAdd(opts = {}) {
  const st = { opts, slot: opts.slot || slotForNow(), date: opts.date || S.date };
  qa = st;
  const f = (k, label, unit) => html`<label class="field inline"><span>${label}</span><div class="with-unit"><input type="text" inputmode="decimal" id="qa-${k}" placeholder="—" autocomplete="off"><em>${unit}</em></div></label>`;
  st.sheet = openSheet(
    html`<form class="ff">
      <div class="pk-head"><h2>⚡ Quick add</h2><button type="button" class="icon-btn" data-act="sheet-close" aria-label="Close">✕</button></div>
      <p class="fine">For when you already know the numbers (a restaurant menu, a label you don’t want to save). Anything left empty is counted as “unknown”.</p>
      <label class="field"><span>What was it? (optional)</span><input type="text" id="qa-name" placeholder="e.g. Protein bar at the gym" autocomplete="off"></label>
      <div class="label-grid">${f('kcal', 'Calories', 'kcal')}${f('protein', 'Protein', 'g')}${f('carbs', 'Carbs', 'g')}${f('fat', 'Fat', 'g')}${f('sodium', 'Sodium', 'mg')}${f('potassium', 'Potassium', 'mg')}${f('fiber', 'Fiber', 'g')}${f('sugar', 'Sugar', 'g')}</div>
      <div class="chips slots" id="qa-slots">${SLOTS.map((s) => html`<button type="button" class="chip ${s.id === st.slot ? 'on' : ''}" data-act="qa-slot" data-slot="${s.id}">${s.emoji} ${s.label}</button>`)}</div>
      <div class="fs-actions"><button type="button" class="btn primary grow" data-act="qa-save" data-submit>Add to log</button></div>
    </form>`,
    { onClose: () => qa === st && (qa = null) },
  );
}
on({
  'qa-slot': (d) => {
    qa.slot = d.slot;
    setHTML($('#qa-slots', qa.sheet.el), html`${SLOTS.map((s) => html`<button type="button" class="chip ${s.id === qa.slot ? 'on' : ''}" data-act="qa-slot" data-slot="${s.id}">${s.emoji} ${s.label}</button>`)}`);
  },
  'qa-save': () => {
    const el = qa.sheet.el;
    const per100 = emptyNutrients();
    for (const k of ['kcal', 'protein', 'carbs', 'fat', 'sodium', 'potassium', 'fiber', 'sugar']) per100[k] = readNum($('#qa-' + k, el).value);
    if (per100.kcal == null && per100.protein == null && per100.carbs == null && per100.fat == null) return toast('Enter at least calories or one macro.', 'bad');
    if (per100.kcal == null && per100.protein != null && per100.carbs != null && per100.fat != null) per100.kcal = 4 * per100.protein + 4 * per100.carbs + 9 * per100.fat;
    const food = { id: 'quick:' + uid(), name: $('#qa-name', el).value.trim() || 'Quick add', brand: '', source: 'quick', quality: 'quick', basis: 'g', per100, emoji: '⚡' };
    const day = getDay(qa.date);
    const before = totals(day.entries);
    before.count = day.entries.length;
    addEntry(qa.date, qa.slot, food, { amount: 100, qty: 1, unit: 'portion', portionLabel: 'quick add', portionGrams: 100 });
    const date = qa.date;
    closeAllSheets();
    refresh();
    celebrate(date, before);
  },
});

/** Open an existing log entry for editing. */
export function openEntry(date, entry) {
  const food = { ...entry.food, portions: entry.food.portions || (entry.unit === 'portion' ? [{ label: entry.portionLabel, grams: entry.portionGrams }] : []) };
  if (entry.unit === 'portion' && !food.portions.some((p) => p.label === entry.portionLabel)) food.portions = [{ label: entry.portionLabel, grams: entry.portionGrams }, ...food.portions];
  if (food.source === 'dish') food.dish = true;
  openFoodSheet(food, { mode: 'edit', date, entry });
}

export { NUTRIENTS };
