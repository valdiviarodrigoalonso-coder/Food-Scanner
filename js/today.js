// Today tab: the daily diary.
import { html, on, openSheet, toast, confetti, uid } from './ui.js';
import { totals, scale, fmt, fmtN, NUTRIENT, addDays, daysBetween, ML_PER_FLOZ } from './nutrition.js';
import { emojiFor } from './fooddb.js';
import { S, SLOTS, getDay, goalMode, today, currentStreak, setWater, setDone, saveDay, loggedDays } from './state.js';
import { refresh, amountLabel, prettyDate, fmtWater, imperial, badge, say, coach } from './parts.js';
import { openPicker, openEntry, openScanner } from './food.js';

/** How a value compares with its goal: 'hit' | 'over' | 'go' */
export function status(key, value, goal) {
  if (!goal) return 'go';
  const mode = goalMode(key);
  const r = value / goal;
  if (mode === 'min') return r >= 1 ? 'hit' : 'go';
  if (mode === 'max') return r > 1 ? 'over' : 'go';
  if (r > 1.05) return 'over';
  return r >= 0.95 ? 'hit' : 'go';
}

/** What the coach says at the top of the day. */
function nudge(day, t, isToday, st) {
  const g = S.settings.goals;
  const n = day.entries.length;
  if (!isToday) return say(n ? 'pastLogged' : 'pastEmpty');
  if (day.done) return say('done');
  const h = new Date().getHours();
  if (!n) {
    if (st.current > 0) return say('emptyStreak', { n: st.current });
    return say(h < 11 ? 'emptyMorning' : 'emptyLater');
  }
  if (status('sodium', t.sodium.sum, g.sodium) === 'over') return say('sodiumOver');
  if (t.kcal.sum > g.kcal * 1.05) return say('kcalOver');
  if (t.protein.sum >= g.protein && status('kcal', t.kcal.sum, g.kcal) === 'hit') return say('perfect');
  if (t.protein.sum >= g.protein) return say('proteinHit');
  const left = g.protein - t.protein.sum;
  if (h >= 18 && left > 0) return say('proteinEvening', { left: fmt(left) });
  return say('generic', { i: n });
}

function ring(t, g) {
  const eaten = t.kcal.sum;
  const left = g.kcal - eaten;
  const r = 54;
  const c = 2 * Math.PI * r;
  const pct = Math.min(eaten / g.kcal, 1);
  const over = eaten > g.kcal * 1.05;
  return html`<button class="ring ${over ? 'over' : ''}" data-act="breakdown" data-k="kcal" aria-label="Calories: ${fmt(eaten)} of ${fmt(g.kcal)}">
    <svg viewBox="0 0 128 128" width="150" height="150"><circle cx="64" cy="64" r="${r}" class="ring-bg"/><circle cx="64" cy="64" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}" transform="rotate(-90 64 64)"/></svg>
    <span class="ring-text"><b>${fmt(Math.abs(left))}</b><span>${left >= 0 ? 'kcal left' : 'kcal over'}</span></span>
  </button>`;
}

function macroBar(k, t, g) {
  const v = t[k].sum;
  const s = status(k, v, g[k]);
  return html`<button class="macro ${k} ${s}" data-act="breakdown" data-k="${k}">
    <span class="macro-top"><span>${NUTRIENT[k].label}</span><span><b>${fmt(v)}</b> / ${fmt(g[k])} g${s === 'hit' ? ' ✓' : ''}</span></span>
    <span class="bar"><i style="width:${Math.min((v / g[k]) * 100, 100)}%"></i></span>
  </button>`;
}

function microTile(k, t, g) {
  const v = t[k].sum;
  const s = status(k, v, g[k]);
  const mode = goalMode(k);
  const hint = mode === 'max' ? 'limit' : mode === 'min' ? 'goal' : 'target';
  return html`<button class="micro ${s} ${k}" data-act="breakdown" data-k="${k}">
    <span class="micro-label">${NUTRIENT[k].label}${t[k].missing ? html` <em class="flag" title="Some foods have no data">⚠</em>` : ''}</span>
    <span class="micro-val"><b>${t[k].missing ? '≥' : t[k].estimated ? '~' : ''}${fmtN(k, v)}</b><small>${NUTRIENT[k].unit}</small></span>
    <span class="bar"><i style="width:${Math.min((v / g[k]) * 100, 100)}%"></i></span>
    <span class="micro-goal">${hint} ${fmt(g[k])}${s === 'over' ? ' · over' : s === 'hit' ? ' ✓' : ''}</span>
  </button>`;
}

function waterCard(day, g) {
  const ml = day.water || 0;
  const step = imperial() ? [8 * ML_PER_FLOZ, 16 * ML_PER_FLOZ] : [250, 500];
  const labels = imperial() ? ['+8 oz', '+16 oz'] : ['+250 ml', '+500 ml'];
  const pct = Math.min((ml / g.water) * 100, 100);
  return html`<div class="card water">
    <div class="water-top"><span class="water-title">💧 Water</span><span><b>${fmtWater(ml)}</b> / ${fmtWater(g.water)}${ml >= g.water ? ' ✓' : ''}</span></div>
    <div class="bar tall"><i style="width:${pct}%"></i></div>
    <div class="water-btns"><button class="chip" data-act="water" data-ml="${-step[0]}" ${ml ? '' : 'disabled'}>−</button><button class="chip on" data-act="water" data-ml="${step[0]}">${labels[0]}</button><button class="chip on" data-act="water" data-ml="${step[1]}">${labels[1]}</button></div>
  </div>`;
}

function mealSection(slot, day, prevDay) {
  const list = day.entries.filter((e) => e.slot === slot.id);
  const t = totals(list);
  const prev = prevDay.entries.filter((e) => e.slot === slot.id);
  return html`<section class="card meal">
    <header class="meal-head">
      <div><h3>${slot.emoji} ${slot.label}</h3>${list.length ? html`<span class="meal-sum">${fmt(t.kcal.sum)} kcal · P ${fmt(t.protein.sum)} · C ${fmt(t.carbs.sum)} · F ${fmt(t.fat.sum)}</span>` : ''}</div>
      <button class="add-btn" data-act="add" data-slot="${slot.id}" aria-label="Add food to ${slot.label}">＋</button>
    </header>
    ${list.map((e) => {
      const n = scale(e.food.per100, e.amount);
      return html`<button class="entry" data-act="entry" data-id="${e.id}">
        <span class="row-emoji">${emojiFor(e.food)}</span>
        <span class="row-main"><span class="row-name">${e.food.name}</span><span class="row-sub">${e.food.brand ? e.food.brand + ' · ' : ''}${amountLabel(e)}</span></span>
        <span class="entry-right"><b>${n.kcal == null ? '?' : (e.food.quality === 'estimate' ? '~' : '') + fmt(n.kcal)}</b><small>P ${n.protein == null ? '?' : fmt(n.protein)}</small></span>
      </button>`;
    })}
    ${!list.length ? html`<div class="meal-empty"><button class="link" data-act="add" data-slot="${slot.id}">Add food</button>${prev.length ? html`<button class="link" data-act="copy-prev" data-slot="${slot.id}">↻ Same as yesterday (${prev.length})</button>` : ''}</div>` : ''}
  </section>`;
}

export function renderToday() {
  const date = S.date;
  const isToday = date === today();
  const day = getDay(date);
  const prevDay = getDay(addDays(date, -1));
  const t = totals(day.entries);
  const g = S.settings.goals;
  const st = currentStreak();
  const pd = prettyDate(date, today());
  const out = S.settings.showDate ? daysBetween(today(), S.settings.showDate) : null;
  const tip = nudge(day, t, isToday, st);
  return html`<div class="page today">
    <header class="hero">
      <div class="hero-top">
        <button class="nav-btn" data-act="day" data-d="-1" aria-label="Previous day">‹</button>
        <button class="date" data-act="day-today"><b>${pd.main}</b><span>${pd.sub}</span></button>
        <button class="nav-btn" data-act="day" data-d="1" aria-label="Next day">›</button>
      </div>
      <div class="hero-chips">
        <span class="pill streak ${st.todayLogged ? 'lit' : ''}">🔥 ${st.current} day${st.current === 1 ? '' : 's'}</span>
        ${out != null && out >= 0 ? html`<span class="pill">🎯 ${out === 0 ? (S.settings.showName || 'Goal day') + ' is today!' : `${out} day${out === 1 ? '' : 's'} to go`}</span>` : ''}
        ${day.done ? html`<span class="pill lit">✓ Day complete</span>` : ''}
      </div>
      <div class="hero-main">
        ${ring(t, g)}
        <div class="macros">${macroBar('protein', t, g)}${macroBar('carbs', t, g)}${macroBar('fat', t, g)}</div>
      </div>
      <div class="hero-sub"><span>Eaten <b>${fmt(t.kcal.sum)}</b></span><span>Goal <b>${fmt(g.kcal)}</b></span>${t.kcal.missing ? html`<span class="warn-text">⚠ ${t.kcal.missing} without calories</span>` : ''}</div>
      <button class="nudge" data-act="coach-pick" aria-label="Coach ${coach().name} says: ${tip}. Tap to change coach."><span class="nudge-ico">${coach().emoji}</span><span class="nudge-text"><b>${coach().name}</b>${tip}</span></button>
    </header>

    <div class="micro-grid">${['sodium', 'potassium', 'fiber', 'sugar', 'satFat', 'cholesterol'].map((k) => microTile(k, t, g))}</div>
    ${waterCard(day, g)}
    ${SLOTS.map((s) => mealSection(s, day, prevDay))}
    ${day.entries.length
      ? html`<button class="btn ${day.done ? 'ghost' : 'primary'} wide finish" data-act="finish">${day.done ? 'Reopen this day' : '✅ Finish day'}</button>`
      : html`<div class="quick-grid"><button class="quick" data-act="scan-now"><span>📷</span>Scan a barcode</button><button class="quick" data-act="photo-now"><span>🍽️</span>Photo of my plate</button><button class="quick" data-act="add" data-slot=""><span>🔍</span>Search foods</button></div>`}
    <p class="fine center">Numbers marked ≥ or ⚠ include foods with missing data. Tap any meter to see where it comes from.</p>
  </div>`;
}

function openBreakdown(k) {
  const day = getDay(S.date);
  const t = totals(day.entries);
  const g = S.settings.goals;
  const rows = day.entries
    .map((e) => ({ e, v: scale(e.food.per100, e.amount)[k] }))
    .sort((a, b) => (b.v ?? -1) - (a.v ?? -1));
  const u = NUTRIENT[k].unit;
  const mode = goalMode(k);
  openSheet(html`<div class="fs">
    <div class="pk-head"><h2>${NUTRIENT[k].label} today</h2><button class="icon-btn" data-act="sheet-close" aria-label="Close">✕</button></div>
    <div class="big-stat"><b>${t[k].missing ? '≥ ' : ''}${fmtN(k, t[k].sum)}</b> ${u} <span>of ${fmt(g[k])} ${u} ${mode === 'max' ? 'limit' : mode === 'min' ? 'minimum' : 'target'}</span></div>
    ${t[k].missing ? html`<div class="note warn">⚠️ ${t[k].missing} food${t[k].missing > 1 ? 's have' : ' has'} no (or incomplete) ${NUTRIENT[k].label.toLowerCase()} data, so your real total is higher than shown: ${[...new Set(t[k].missingNames)].join(', ')}. Open the food and use “Fix numbers” to add it from the label.</div>` : ''}
    ${t[k].estimated ? html`<div class="note info">ℹ️ ${t[k].estimated} entr${t[k].estimated > 1 ? 'ies are' : 'y is'} a home-cooking estimate (~).</div>` : ''}
    ${rows.length ? html`<div class="sec-title">Where it comes from</div>` : html`<div class="empty small"><p>Nothing logged yet.</p></div>`}
    ${rows.map(({ e, v }) => html`<div class="bd-row"><span class="bd-name">${e.food.name}<small>${amountLabel(e)} ${badge(e.food)}</small></span><span class="bd-val">${v == null ? html`<span class="nodata">no data</span>` : html`<span><b>${fmtN(k, v)}</b> ${u}</span>`}<i style="width:${v && t[k].sum ? Math.round((v / t[k].sum) * 100) : 0}%"></i></span></div>`)}
  </div>`);
}

on({
  day: (d) => {
    S.date = addDays(S.date, Number(d.d));
    refresh();
    window.scrollTo(0, 0);
  },
  'day-today': () => {
    S.date = today();
    refresh();
  },
  add: (d) => openPicker({ slot: d.slot || undefined, date: S.date }),
  'scan-now': () => openScanner({ date: S.date }),
  entry: (d) => {
    const e = getDay(S.date).entries.find((x) => x.id === d.id);
    if (e) openEntry(S.date, e);
  },
  breakdown: (d) => openBreakdown(d.k),
  water: (d) => {
    const before = getDay(S.date).water || 0;
    const after = Math.max(0, before + Number(d.ml));
    setWater(S.date, after);
    refresh();
    const goal = S.settings.goals.water;
    if (before < goal && after >= goal) {
      confetti(60);
      toast(say('waterGoal'), 'good');
    }
  },
  'copy-prev': (d) => {
    const prev = getDay(addDays(S.date, -1)).entries.filter((e) => e.slot === d.slot);
    if (!prev.length) return;
    if (!S.days[S.date]) S.days[S.date] = { entries: [], water: 0, done: false };
    for (const e of prev) S.days[S.date].entries.push({ ...structuredClone(e), id: uid(), ts: Date.now() });
    saveDay(S.date);
    refresh();
    toast(`Copied ${prev.length} item${prev.length > 1 ? 's' : ''} from yesterday ✔`, 'good');
  },
  finish: () => {
    const day = getDay(S.date);
    if (day.done) {
      setDone(S.date, false);
      return refresh();
    }
    setDone(S.date, true);
    refresh();
    confetti(150);
    const n = loggedDays().length;
    const st = currentStreak();
    toast(say('dayDone', { streak: st.current, total: n }), 'good');
  },
});
