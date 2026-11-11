// Boot, tab routing, and the bottom bar.
import { html, on, setHTML, $, $$, toast } from './ui.js';
import { loadDB } from './fooddb.js';
import { S, loadAll, today, seedStarters } from './state.js';
import { setRefresh } from './parts.js';
import { persist } from './store.js';
import { renderToday } from './today.js';
import { renderMeals } from './meals.js';
import { renderProgress } from './progress.js';
import { renderSettings, openWelcome } from './settings.js';
import { openPicker } from './food.js';
import './photo.js';

const VIEWS = { today: renderToday, meals: renderMeals, progress: renderProgress, settings: renderSettings };

/** soft = a background refresh (app came back to the front): never rebuild under someone who is typing. */
function render(soft = false) {
  if (!S.ready) return;
  const view = $('#view');
  const active = document.activeElement;
  const typing = active && view.contains(active) && /INPUT|SELECT|TEXTAREA/.test(active.tagName);
  if (typing && soft === true) return;
  setHTML(view, (VIEWS[S.tab] || renderToday)());
  $$('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
}
setRefresh(() => render());

on({
  tab: (d) => {
    if (document.activeElement) document.activeElement.blur();
    S.tab = d.tab;
    render();
    window.scrollTo(0, 0);
  },
  fab: () => {
    if (S.tab !== 'today') {
      S.tab = 'today';
      render();
    }
    openPicker({ date: S.date });
  },
});

// If the app is left open overnight, move to the new day when it comes back.
let lastToday = today();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  const t = today();
  if (t !== lastToday) {
    if (S.date === lastToday) S.date = t;
    lastToday = t;
  }
  render(true);
});

async function boot() {
  try {
    const [, , dishes] = await Promise.all([loadAll(), loadDB(), fetch('data/dishes.json?v=1').then((r) => r.json())]);
    S.dishes = dishes;
  } catch (e) {
    console.error(e);
    setHTML($('#view'), html`<div class="page"><div class="empty"><div class="mark">📡</div><b>Couldn’t load the food library</b><p>Check your connection and reopen the app. (${e.message})</p><button class="btn primary" onclick="location.reload()">Try again</button></div></div>`);
    return;
  }
  document.body.classList.remove('booting');
  render();
  if (!S.settings.onboarded) openWelcome();
  else seedStarters();
  persist();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
boot();

// Never fail silently: if a tap hits a bug, say so instead of looking frozen.
window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  toast('Something went wrong — nothing was lost. Try that again.', 'bad');
});
window.addEventListener('error', (e) => {
  if (!e.error) return; // ignore failed image/script loads; those are handled where they happen
  console.error(e.error);
  toast('Something went wrong — nothing was lost. Try that again.', 'bad');
});
