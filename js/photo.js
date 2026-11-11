// Photo estimate: take a picture of a plate, get an estimated weight for each part, fix it, log it.
import { html, on, onInput, openSheet, closeAllSheets, topSheet, toast, readNum, $, setHTML } from './ui.js';
import { totals, fmt, G_PER_OZ } from './nutrition.js';
import { getById, emojiFor } from './fooddb.js';
import { S, SLOTS, slotLabel, slotForNow, addEntry, getDay, dishToFood, saveSettings } from './state.js';
import { imperial, refresh } from './parts.js';
import { openPicker, celebrate, currentPickerOpts } from './food.js';
import { estimatePhoto, SIDES, sideRef } from './photoai.js';

let ph = null;

const unit = () => (imperial() ? 'oz' : 'g');
const toShown = (g) => (imperial() ? Math.round((g / G_PER_OZ) * 10) / 10 : Math.round(g));
const toGrams = (v) => (imperial() ? v * G_PER_OZ : v);
const shownRange = (it) => `${fmt(toShown(it.low), imperial() ? 1 : 0)}–${fmt(toShown(it.high), imperial() ? 1 : 0)} ${unit()}`;

/** Every ref the AI may use, mapped to a food the app can calculate. */
function refMap() {
  const m = new Map();
  for (const d of S.dishes.dishes) m.set(d.id, () => dishToFood(d));
  for (const [id, label] of SIDES) m.set(sideRef(id), () => {
    const f = getById(id);
    return f ? { ...f, short: label } : null;
  });
  return m;
}

/** Shared by the photo sheet and Settings. */
export function claudeKeyHelp() {
  return html`<ol class="steps">
      <li>Open <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener">platform.claude.com</a> and sign up (this is separate from a Claude chat subscription).</li>
      <li>Add a little credit — $5 is the minimum and covers a lot of photos.</li>
      <li>Create an API key and paste it here.</li>
    </ol>
    <label class="field"><span>Your Claude API key</span><input type="password" data-in="claude-key" value="${S.settings.claudeKey || ''}" placeholder="sk-ant-…" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
    <p class="fine">No subscription: you pay Anthropic only for what you use, roughly 5–10 cents per photo. The key is stored on this phone only and is left out of backup files.</p>`;
}

export function openPhoto(opts = {}) {
  if (ph) return;
  const st = { date: opts.date || S.date, slot: opts.slot || slotForNow(), stage: 'start', img: null, hint: '', items: [], note: '', scaleCue: '', error: '' };
  ph = st;
  st.sheet = openSheet(html`<div class="ph" id="ph-root"></div>`, {
    cls: 'tall',
    guard: () => st.stage === 'review' && st.items.length > 0,
    onClose: () => ph === st && (ph = null),
  });
  phRender();
}

const head = (title) => html`<div class="pk-head"><h2>${title}</h2><button class="icon-btn" data-act="sheet-close" aria-label="Close">✕</button></div>`;

function pickButtons(primaryLabel) {
  return html`<div class="ph-pick">
    <label class="btn primary">📸 ${primaryLabel}<input type="file" accept="image/*" capture="environment" data-in="ph-file" hidden></label>
    <label class="btn ghost">🖼️ Choose a photo<input type="file" accept="image/*" data-in="ph-file" hidden></label>
  </div>`;
}

function phTotals() {
  const live = ph.items.filter((i) => i.on && i.food && readNum(i.qty) > 0).map((i) => ({ food: i.food, amount: toGrams(readNum(i.qty)) }));
  const t = totals(live);
  const cell = (k, label, u) => html`<div><b>${t[k].missing && live.length ? '≥' : ''}${fmt(t[k].sum)}${u}</b><span>${label}</span></div>`;
  return html`${cell('kcal', 'kcal', '')}${cell('protein', 'protein', ' g')}${cell('carbs', 'carbs', ' g')}${cell('fat', 'fat', ' g')}${cell('sodium', 'sodium', ' mg')}`;
}
const liveCount = () => ph.items.filter((i) => i.on && i.food && readNum(i.qty) > 0).length;

function itemCard(it, i) {
  const conf = { low: 'Rough guess', medium: 'Fair guess', high: 'Good guess' }[it.confidence];
  return html`<div class="ph-item ${it.on ? '' : 'off'}">
    <div class="ph-top">
      <span class="ph-emoji">${it.food ? emojiFor(it.food) : '❓'}</span>
      <div class="ph-name"><b>${it.name}</b><span>${it.food ? `Counted as: ${it.food.short || it.food.name}` : 'Not in the food list yet — pick the food to count it'}</span></div>
      <button class="icon-btn small" data-act="ph-toggle" data-i="${i}" aria-label="${it.on ? 'Leave this out' : 'Put this back'}">${it.on ? '✕' : '↩'}</button>
    </div>
    <div class="ph-amt">
      <div class="with-unit"><input type="text" inputmode="decimal" value="${it.qty}" data-in="ph-qty" data-i="${i}" aria-label="Amount of ${it.name}" autocomplete="off"><em>${unit()}</em></div>
      <div class="ph-range"><span class="ph-conf ${it.confidence}">${conf}</span> · likely ${shownRange(it)}${it.note ? html`<br>${it.note}` : ''}</div>
    </div>
    <button class="link" data-act="ph-swap" data-i="${i}">${it.food ? 'Wrong food? Change it' : 'Pick the food'}</button>
  </div>`;
}

function phRender() {
  if (!ph) return;
  const root = $('#ph-root', ph.sheet.el);
  if (!root) return;
  let out;
  if (!S.settings.claudeKey) {
    out = html`${head('Photo estimate')}
      <div class="card soft">📸 <b>Estimate a plate from a photo.</b> Take a picture of a meal you can’t weigh — like a plate of ají de gallina — and get an estimated weight for each part, which you can correct before logging.</div>
      <div class="card"><div class="card-title">🔑 One-time setup</div>
        <p class="fine">Reading a photo needs an AI service. This uses Claude with your own key:</p>
        ${claudeKeyHelp()}
        <div class="btn-col"><button class="btn primary wide" data-act="ph-key-done">Continue</button></div>
      </div>`;
  } else if (ph.stage === 'start' || ph.stage === 'error') {
    out = html`${head('Photo estimate')}
      ${ph.stage === 'error' ? html`<div class="card soft warn-text">⚠️ ${ph.error}</div>` : ''}
      ${ph.img ? html`<img class="ph-shot" src="${ph.img.url}" alt="Your photo">` : html`<div class="card soft">📸 <b>Take a photo of your plate</b> from above, with the whole plate in view. For a better estimate, leave a fork or your hand next to it so the size is clear.</div>`}
      <label class="field"><span>What is it? (optional, helps accuracy)</span><input type="text" data-in="ph-hint" value="${ph.hint}" placeholder="e.g. ají de gallina, big plate, extra rice" maxlength="300" autocomplete="off"></label>
      ${ph.img ? html`<div class="btn-col"><button class="btn primary wide" data-act="ph-go">Try again with this photo</button></div>` : ''}
      ${pickButtons(ph.img ? 'Retake photo' : 'Take photo')}
      <p class="fine">The photo is sent to Anthropic’s Claude to be read and is not kept in this app. Each photo costs a few cents from your Claude credit.</p>`;
  } else if (ph.stage === 'loading') {
    out = html`${head('Photo estimate')}
      <img class="ph-shot" src="${ph.img.url}" alt="Your photo">
      <div class="ph-wait"><span class="spin"></span><b>Looking at your plate…</b><span>This usually takes 10–30 seconds.</span></div>`;
  } else {
    out = html`${head('Check the estimate')}
      <img class="ph-shot" src="${ph.img.url}" alt="Your photo">
      ${ph.items.length
        ? html`<p class="fine">These weights are estimates from one photo. Sauce, oil and food hidden underneath are hard to see, so the real weight can be off by a quarter or more. Change any number you know, and weigh the plate on days when it has to be exact.${ph.scaleCue ? html` Size judged from: ${ph.scaleCue}.` : ''}</p>
          ${ph.note ? html`<div class="card soft">💬 ${ph.note}</div>` : ''}
          ${ph.items.map(itemCard)}
          <div class="ph-total" id="ph-total">${phTotals()}</div>
          <p class="fine">Nutrition comes from the app’s own food data (USDA values and the Peruvian dish recipes), not from the AI.</p>
          <div class="chips slots" id="ph-slots">${SLOTS.map((s) => html`<button class="chip ${s.id === ph.slot ? 'on' : ''}" data-act="ph-slot" data-slot="${s.id}">${s.emoji} ${s.label}</button>`)}</div>
          <div class="btn-col"><button class="btn primary wide" id="ph-add" data-act="ph-add">Add to ${slotLabel(ph.slot)}</button></div>`
        : html`<div class="card soft">🤔 <b>No food found in that photo.</b> ${ph.note || 'Try again with the whole plate in view and good light.'}</div>`}
      ${pickButtons('Retake photo')}`;
  }
  setHTML(root, out);
}

function phSyncTotals() {
  const el = ph.sheet.el;
  if ($('#ph-total', el)) setHTML($('#ph-total', el), phTotals());
  const btn = $('#ph-add', el);
  if (btn) {
    btn.disabled = liveCount() === 0;
    btn.textContent = `Add to ${slotLabel(ph.slot)}`;
  }
}

/** Shrink the photo before upload: faster on mobile data, cheaper, and plenty for judging a plate. */
async function shrink(file, max = 1568) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => {
      const im = new Image();
      im.onload = () => ok(im);
      im.onerror = () => bad(new Error('That file could not be opened as a photo.'));
      im.src = url;
    });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const dataUrl = c.toDataURL('image/jpeg', 0.85);
    return { url: dataUrl, data: dataUrl.slice(dataUrl.indexOf(',') + 1), mediaType: 'image/jpeg' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function run() {
  const st = ph;
  if (!st || !st.img) return;
  if (!navigator.onLine) {
    st.stage = 'error';
    st.error = 'You are offline. A photo estimate needs an internet connection.';
    return phRender();
  }
  st.stage = 'loading';
  phRender();
  try {
    const refs = refMap();
    const est = await estimatePhoto({
      apiKey: S.settings.claudeKey, image: st.img, hint: st.hint,
      dishes: S.dishes.dishes.map((d) => ({ id: d.id, name: d.name, plate: d.plate })), knownRefs: new Set(refs.keys()),
    });
    if (ph !== st) return; // sheet was closed while waiting
    st.items = est.items.map((it) => ({ ...it, food: it.ref ? refs.get(it.ref)() : null, qty: String(toShown(it.grams)), on: true }));
    st.note = est.note;
    st.scaleCue = est.scaleCue;
    st.stage = 'review';
  } catch (e) {
    if (ph !== st) return;
    st.stage = 'error';
    st.error = e.message || 'Something went wrong. Try again.';
  }
  phRender();
  if (st.stage === 'review') phSyncTotals();
}

on({
  'pk-photo': () => {
    const o = currentPickerOpts();
    openPhoto({ date: o.date, slot: o.slot });
  },
  'photo-now': () => openPhoto({ date: S.date }),
  'ph-key-done': () => {
    if (!S.settings.claudeKey) return toast('Paste your Claude API key first.', 'bad');
    phRender();
  },
  'ph-go': run,
  'ph-slot': (d) => {
    ph.slot = d.slot;
    setHTML($('#ph-slots', ph.sheet.el), html`${SLOTS.map((s) => html`<button class="chip ${s.id === ph.slot ? 'on' : ''}" data-act="ph-slot" data-slot="${s.id}">${s.emoji} ${s.label}</button>`)}`);
    phSyncTotals();
  },
  'ph-toggle': (d) => {
    const it = ph.items[Number(d.i)];
    it.on = !it.on;
    phRender();
    phSyncTotals();
  },
  'ph-swap': (d) => {
    const st = ph;
    const it = st.items[Number(d.i)];
    openPicker({
      mode: 'pick',
      onPick: (food, a) => {
        it.food = food;
        it.ref = '';
        it.qty = String(toShown(a.amount));
        it.on = true;
        // close the picker (and the food sheet above it) and come back to the estimate
        while (topSheet() && topSheet() !== st.sheet) topSheet().close(true);
        ph = st;
        phRender();
        phSyncTotals();
      },
    });
  },
  'ph-add': () => {
    const st = ph;
    const live = st.items.filter((i) => i.on && i.food && readNum(i.qty) > 0);
    if (!live.length) return toast('Nothing to add yet — pick a food or enter an amount.', 'bad');
    const day = getDay(st.date);
    const before = totals(day.entries);
    before.count = day.entries.length;
    for (const it of live) {
      const qty = readNum(it.qty);
      const amount = toGrams(qty);
      // a drink measured by volume is stored in ml (close enough to grams for an estimate)
      const a = it.food.basis === 'ml' ? { amount, qty: Math.round(amount), unit: 'ml' } : { amount, qty, unit: unit() };
      addEntry(st.date, st.slot, it.food, { ...a, est: true });
    }
    closeAllSheets();
    refresh();
    celebrate(st.date, before);
  },
});

onInput({
  'ph-file': async (v, el) => {
    const file = el.files && el.files[0];
    el.value = '';
    if (!file || !ph) return;
    const st = ph;
    try {
      st.img = await shrink(file);
    } catch (e) {
      st.stage = 'error';
      st.error = e.message;
      return phRender();
    }
    if (ph === st) run();
  },
  'ph-hint': (v) => {
    if (ph) ph.hint = v;
  },
  'ph-qty': (v, el) => {
    const it = ph && ph.items[Number(el.dataset.i)];
    if (!it) return;
    it.qty = v;
    phSyncTotals();
  },
  'claude-key': (v) => {
    S.settings.claudeKey = v.trim();
    saveSettings();
  },
});
