// Settings tab + first-run welcome.
import { html, on, onInput, openSheet, toast, readNum, $, $$, setHTML } from './ui.js';
import { fmt, ML_PER_FLOZ, dayKey } from './nutrition.js';
import { dbSize } from './fooddb.js';
import { S, APP_NAME, saveSettings, exportData, importData, wipeAll, seedStarters } from './state.js';
import { refresh, imperial, coach, say } from './parts.js';
import { COACHES } from './coach.js';
import { claudeKeyHelp } from './photo.js';
import { storageMode } from './store.js';

const GOAL_FIELDS = [
  ['kcal', 'Calories', 'kcal'], ['protein', 'Protein', 'g'], ['carbs', 'Carbs', 'g'], ['fat', 'Fat', 'g'],
  ['sodium', 'Sodium', 'mg'], ['potassium', 'Potassium', 'mg'], ['fiber', 'Fiber', 'g'], ['sugar', 'Sugar (limit)', 'g'], ['satFat', 'Saturated fat (limit)', 'g'], ['cholesterol', 'Cholesterol (limit)', 'mg'],
];

function macroCheck() {
  const g = S.settings.goals;
  const fromMacros = 4 * g.protein + 4 * g.carbs + 9 * g.fat;
  const diff = Math.round(fromMacros - g.kcal);
  if (Math.abs(diff) <= 25) return html`<p class="fine good-text">✓ Your macros add up to ${fmt(fromMacros)} kcal — matches your calorie goal.</p>`;
  return html`<div class="note warn">Your macros add up to <b>${fmt(fromMacros)} kcal</b> (4 per gram of protein and carbs, 9 per gram of fat), which is ${fmt(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than your calorie goal. <button type="button" class="link" data-act="set-kcal">Set calories to ${fmt(fromMacros)}</button></div>`;
}
/** Refresh every "do the macros add up?" note on screen (Settings page and/or welcome sheet). */
function syncMacroChecks() {
  $$('.macro-check').forEach((el) => setHTML(el, macroCheck()));
}

function goalInputs(keys) {
  const g = S.settings.goals;
  return GOAL_FIELDS.filter(([k]) => keys.includes(k)).map(([k, label, unit]) => html`<label class="field inline"><span>${label}</span><div class="with-unit"><input type="text" inputmode="decimal" data-in="goal" data-k="${k}" value="${g[k]}" autocomplete="off"><em>${unit}</em></div></label>`);
}

function waterField() {
  const g = S.settings.goals;
  const v = imperial() ? Math.round(g.water / ML_PER_FLOZ) : Math.round(g.water);
  return html`<label class="field inline"><span>Water</span><div class="with-unit"><input type="text" inputmode="decimal" data-in="goal-water" value="${v}" autocomplete="off"><em>${imperial() ? 'fl oz' : 'ml'}</em></div></label>`;
}

/** The four coach cards plus a sample line from the one that is selected. */
const coachPick = () => html`<div class="coach-grid">${COACHES.map((c) => html`<button type="button" class="coach-card ${c.id === S.settings.coach ? 'on' : ''}" data-act="coach-set" data-id="${c.id}" aria-pressed="${c.id === S.settings.coach ? 'true' : 'false'}">
    <span class="coach-emoji">${c.emoji}</span><b>${c.name} <small>the ${c.animal}</small></b><em>${c.style}</em><span class="coach-blurb">${c.blurb}</span>
  </button>`)}</div>
  <div class="coach-hello"><span>${coach().emoji}</span><p>“${say('hello')}”</p></div>`;
const syncCoachPicks = () => $$('.coach-pick').forEach((el) => setHTML(el, coachPick()));

/** Change coach from anywhere (the coach's speech bubble on the Today screen opens this). */
export function openCoachPicker() {
  openSheet(html`<div class="ff">
    <div class="pk-head"><h2>Your coach</h2><button class="icon-btn" data-act="sheet-close" aria-label="Close">✕</button></div>
    <p class="fine">Same app, same numbers — only the voice changes. Switch any time.</p>
    <div class="coach-pick">${coachPick()}</div>
    <div class="fs-actions"><button class="btn primary grow" data-act="sheet-close">Done</button></div>
  </div>`);
}

const unitButtons = (act) => html`<button class="${S.settings.units === 'imperial' ? 'on' : ''}" data-act="${act}" data-u="imperial">Imperial <small>oz · lb · fl oz</small></button><button class="${S.settings.units === 'metric' ? 'on' : ''}" data-act="${act}" data-u="metric">Metric <small>g · kg · ml</small></button>`;

export function renderSettings() {
  const s = S.settings;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  return html`<div class="page">
    <header class="page-head"><h1>Settings</h1><p>Your numbers, your way.</p></header>

    ${standalone ? '' : html`<div class="card soft">📲 <b>Install on your phone:</b> on iPhone, open this page in Safari, tap <b>Share</b> → <b>Add to Home Screen</b>. It then opens full-screen like a normal app, works offline, and keeps your data safe.</div>`}

    <div class="card">
      <div class="card-title">${coach().emoji} Your coach</div>
      <p class="fine">Pick the personality that keeps you going. Only the voice changes — the numbers stay the same.</p>
      <div class="coach-pick">${coachPick()}</div>
    </div>

    <div class="card">
      <div class="card-title">📏 Units</div>
      <div class="seg big">${unitButtons('units')}</div>
      <p class="fine">You can still switch between grams and ounces on any single food.</p>
    </div>

    <div class="card">
      <div class="card-title">🎯 Daily goals</div>
      <p class="fine">Use numbers from your own plan, your doctor, dietitian or coach. Not sure yet? The starting values are the standard Daily Values printed on US food labels (a 2,000-calorie diet).</p>
      <form class="label-grid">${goalInputs(['kcal', 'protein', 'carbs', 'fat'])}</form>
      <div class="macro-check">${macroCheck()}</div>
      <form class="label-grid">${goalInputs(['sodium', 'potassium', 'fiber', 'sugar', 'satFat', 'cholesterol'])}${waterField()}</form>
      <div class="sec-title">Sodium goal works as</div>
      <div class="seg"><button class="${s.sodiumMode !== 'target' ? 'on' : ''}" data-act="na-mode" data-m="max">A limit (stay under)</button><button class="${s.sodiumMode === 'target' ? 'on' : ''}" data-act="na-mode" data-m="target">A target (hit it daily)</button></div>
      <p class="fine">Most people use a limit. Pick “target” if your plan keeps sodium steady from day to day.</p>
    </div>

    <div class="card">
      <div class="card-title">📅 Goal date <small>optional</small></div>
      <p class="fine">Working toward something — a competition, a race, a wedding, a trip? Add it for a countdown.</p>
      <div class="field-row"><label class="field"><span>What is it?</span><input type="text" data-in="show-name" value="${s.showName}" placeholder="e.g. Half marathon" autocomplete="off"></label>
      <label class="field"><span>Date</span><input type="date" data-in="show-date" value="${s.showDate}" min="${dayKey()}"></label></div>
    </div>

    <div class="card">
      <div class="card-title">🔑 USDA key <small>free · optional but recommended</small></div>
      <p class="fine">Barcode scans and brand searches check two databases. Open Food Facts needs nothing. The USDA branded database (US products, label data from the manufacturers) only allows about 10 lookups an hour without a key. A personal key is free and raises that to 1,000 an hour.</p>
      <ol class="steps"><li>Open <a href="https://fdc.nal.usda.gov/api-key-signup" target="_blank" rel="noopener">fdc.nal.usda.gov/api-key-signup</a> and fill in the short form.</li><li>The key arrives by email right away.</li><li>Paste it here.</li></ol>
      <label class="field"><span>Your USDA API key</span><input type="text" data-in="usda-key" value="${s.usdaKey}" placeholder="using the shared demo key" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
    </div>

    <div class="card">
      <div class="card-title">🍽️ Photo estimates <small>optional · pay per photo</small></div>
      <p class="fine">Take a photo of a plate you can’t weigh and get an estimated weight for each part. Reading the photo uses Anthropic’s Claude with your own key:</p>
      ${claudeKeyHelp()}
    </div>

    <div class="card">
      <div class="card-title">💾 Backup</div>
      <p class="fine">Everything you log is stored only on this device${storageMode() === 'idb' ? '' : ' (limited storage mode — install to the Home Screen for reliable saving)'}. Save a backup file now and then — especially before changing phones.</p>
      <div class="btn-row"><button class="btn ghost" data-act="backup">⬇️ Save backup file</button><label class="btn ghost filepick">⬆️ Restore<input type="file" accept="application/json,.json" data-in="restore" hidden></label></div>
      <button class="link danger" data-act="wipe">Erase everything on this device</button>
    </div>

    <div class="card">
      <div class="card-title">🔬 Where the numbers come from</div>
      <ul class="about">
        <li><span class="badge good">✓ USDA</span> <b>${dbSize().toLocaleString('en-US')} foods built in</b>, copied directly from USDA FoodData Central (Foundation Foods, SR Legacy and the FNDDS survey foods). Works offline.</li>
        <li><span class="badge info">Maker label · USDA</span> US packaged foods, label data submitted by manufacturers.</li>
        <li><span class="badge warn">Community label</span> Open Food Facts — over 3 million barcoded products worldwide, typed in by volunteers. The app flags entries whose numbers contradict each other and asks you to compare with your package once.</li>
        <li><span class="badge warn">~ Estimate</span> Home dishes, calculated from USDA ingredients using typical recipes.</li>
      </ul>
      <p class="fine">Missing values are never counted as zero: totals show “≥” and a ⚠ when a food has no data for that nutrient. All labels are allowed some error by law (US labels may be up to 20% off), so no tracker is exact — weigh food on a scale for the best accuracy.</p>
      <p class="fine">${APP_NAME} is a tracking tool, not medical advice. If you have a health condition or a history of disordered eating, set your goals with a professional.</p>
    </div>
  </div>`;
}

on({
  units: (d) => {
    S.settings.units = d.u;
    saveSettings();
    refresh();
  },
  'na-mode': (d) => {
    S.settings.sodiumMode = d.m;
    saveSettings();
    refresh();
  },
  'set-kcal': () => {
    const g = S.settings.goals;
    g.kcal = Math.round(4 * g.protein + 4 * g.carbs + 9 * g.fat);
    saveSettings();
    $$('[data-in="goal"][data-k="kcal"]').forEach((el) => (el.value = g.kcal));
    syncMacroChecks();
    if (!welcome) refresh();
  },
  backup: async () => {
    const data = JSON.stringify(exportData());
    const name = `${APP_NAME.toLowerCase()}-backup-${dayKey()}.json`;
    const file = new File([data], name, { type: 'application/json' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: `${APP_NAME} backup` });
        return;
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Backup saved to your downloads ✔', 'good');
  },
  wipe: (d, el) => {
    if (el.dataset.armed !== '1') {
      el.dataset.armed = '1';
      el.textContent = 'Tap again to permanently erase all logs, foods and meals';
      setTimeout(() => {
        el.dataset.armed = '';
        el.textContent = 'Erase everything on this device';
      }, 6000);
      return;
    }
    wipeAll().then(() => location.reload());
  },
  'welcome-go': () => {
    S.settings.onboarded = true;
    saveSettings();
    seedStarters();
    if (welcome) welcome.close();
    refresh();
    toast(say('setupDone'), 'good');
  },
  'coach-set': (d) => {
    if (!COACHES.some((c) => c.id === d.id)) return;
    S.settings.coach = d.id;
    saveSettings();
    refresh();
    syncCoachPicks();
  },
  'coach-pick': () => openCoachPicker(),
  'w-units': (d) => {
    S.settings.units = d.u;
    saveSettings();
    if (welcome) setHTML($('#w-units', welcome.el), unitButtons('w-units'));
  },
});

onInput({
  goal: (v, el) => {
    const n = readNum(v);
    if (n == null || n <= 0) return;
    S.settings.goals[el.dataset.k] = n;
    saveSettings();
    syncMacroChecks();
  },
  'goal-water': (v) => {
    const n = readNum(v);
    if (n == null || n <= 0) return;
    S.settings.goals.water = imperial() ? n * ML_PER_FLOZ : n;
    saveSettings();
  },
  'show-name': (v) => {
    S.settings.showName = v.trim();
    saveSettings();
  },
  'show-date': (v) => {
    S.settings.showDate = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
    saveSettings();
  },
  'usda-key': (v) => {
    S.settings.usdaKey = v.trim();
    saveSettings();
  },
  restore: async (v, el) => {
    const file = el.files && el.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const days = Object.keys((data && data.days) || {}).length;
      if (!confirm(`Replace everything on this device with the backup from ${String(data.exported || '').slice(0, 10)} (${days} logged days)?`)) return;
      await importData(data);
      toast('Backup restored ✔', 'good');
      refresh();
    } catch (e) {
      toast(e instanceof SyntaxError ? 'That file is not a backup.' : e.message || 'Could not read that file.', 'bad');
    } finally {
      el.value = '';
    }
  },
});

let welcome = null;
export function openWelcome() {
  welcome = openSheet(
    html`<div class="welcome">
      <img class="welcome-logo" src="icons/icon-192.png" alt="" width="84" height="84">
      <h2>Welcome to ${APP_NAME}</h2>
      <p>Scan it, log it, know what you’re eating. Calories, protein, carbs, fat, sodium and more — with no subscription, no ads, and your data never leaves this device.</p>
      <div class="sec-title">Pick your coach</div>
      <p class="fine">Your sidekick cheers you on in their own style. You can switch any time.</p>
      <div class="coach-pick">${coachPick()}</div>
      <div class="sec-title">Units</div>
      <div class="seg big" id="w-units">${unitButtons('w-units')}</div>
      <div class="sec-title">Your daily goals</div>
      <p class="fine">Have numbers from a plan, dietitian or coach? Enter them. Not sure? Keep these — they are the standard Daily Values from US food labels — and change them any time in Settings.</p>
      <form class="label-grid">${goalInputs(['kcal', 'protein', 'carbs', 'fat', 'sodium'])}</form>
      <div class="macro-check">${macroCheck()}</div>
      <button class="btn primary wide" data-act="welcome-go">Get started</button>
    </div>`,
    {
      cls: 'tall welcome-sheet',
      onClose: () => {
        welcome = null;
        if (!S.settings.onboarded) {
          S.settings.onboarded = true;
          saveSettings();
          seedStarters();
          refresh();
        }
      },
    },
  );
}
