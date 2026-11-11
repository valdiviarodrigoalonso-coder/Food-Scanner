// Progress tab: streak, body weight trend, weekly averages.
import { html, on, toast, readNum, $, confetti } from './ui.js';
import { totals, fmt, fmtN, NUTRIENT, addDays, daysBetween, parseDay } from './nutrition.js';
import { S, getDay, today, currentStreak, setWeight, loggedDays, goalMode } from './state.js';
import { refresh, wtOut, wtIn, wtUnit, fmtWater, say, coach } from './parts.js';
import { status } from './today.js';

const BADGES = [
  [1, '🌱', 'First day'], [3, '🔥', '3-day streak'], [7, '⭐', 'One week'], [14, '💎', 'Two weeks'], [30, '🏅', '30 days'], [60, '🚀', '60 days'], [100, '🏆', '100 days'],
];

function streakCard() {
  const st = currentStreak();
  const t = today();
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = addDays(t, -i);
    const day = getDay(d);
    days.push({ d, on: day.entries.length > 0, done: day.done, label: parseDay(d).toLocaleDateString('en-US', { weekday: 'narrow' }) });
  }
  const total = loggedDays().length;
  const next = BADGES.find(([n]) => n > st.best);
  return html`<div class="card streak-card">
    <div class="streak-big"><span class="flame ${st.todayLogged ? 'lit' : ''}">🔥</span><div><b>${st.current}</b><span>day streak</span></div><div class="streak-side"><span>Best <b>${st.best}</b></span><span>Total days <b>${total}</b></span></div></div>
    <div class="dots">${days.map((x) => html`<span class="dotday ${x.on ? 'on' : ''} ${x.done ? 'done' : ''} ${x.d === t ? 'now' : ''}"><i>${x.done ? '✓' : ''}</i><em>${x.label}</em></span>`)}</div>
    <p class="fine">${coach().emoji} ${say(st.todayLogged ? 'streakLogged' : st.current ? 'streakKeep' : 'streakNone')}${next ? ` Next badge at ${next[0]} day${next[0] === 1 ? '' : 's'}: ${next[1]}` : ''}</p>
    <div class="badges">${BADGES.map(([n, e, label]) => html`<span class="trophy ${st.best >= n ? 'got' : ''}" title="${label}"><b>${e}</b><em>${label}</em></span>`)}</div>
  </div>`;
}

function countdownCard() {
  const d = S.settings.showDate;
  if (!d) return html`<button class="card soft as-btn" data-act="tab" data-tab="settings">🎯 <b>Working toward a date?</b> Add a goal date in Settings (a competition, a race, a wedding, a trip) to see a countdown here.</button>`;
  const out = daysBetween(today(), d);
  if (out < 0) return html`<div class="card soft">🎯 <b>${S.settings.showName || 'Your goal date'}</b> was ${-out} day${out === -1 ? '' : 's'} ago. Set the next one in Settings whenever you’re ready.</div>`;
  const weeks = Math.floor(out / 7);
  return html`<div class="card countdown"><span class="cd-num">${out}</span><div><b>${out === 0 ? 'Today’s the day!' : `day${out === 1 ? '' : 's'} to go`}</b><span>${S.settings.showName || 'Goal date'} · ${parseDay(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}${out > 13 ? ` · ${weeks} weeks` : ''}</span></div></div>`;
}

function weightSeries() {
  return Object.entries(S.weights)
    .map(([d, kg]) => ({ d, kg }))
    .sort((a, b) => a.d.localeCompare(b.d));
}
function avgOver(series, from, to) {
  const xs = series.filter((p) => p.d >= from && p.d <= to).map((p) => p.kg);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function weightChart(series) {
  const pts = series.slice(-60);
  if (pts.length < 2) return html`<div class="empty small"><p>Log your weight a few mornings in a row and a trend line appears here.</p></div>`;
  const W = 340;
  const H = 130;
  const P = 12;
  const ys = pts.map((p) => wtOut(p.kg));
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const span = hi - lo || 1;
  const t0 = parseDay(pts[0].d).getTime();
  const t1 = parseDay(pts[pts.length - 1].d).getTime();
  const x = (p) => P + ((parseDay(p.d).getTime() - t0) / (t1 - t0 || 1)) * (W - 2 * P);
  const y = (v) => P + (1 - (v - lo) / span) * (H - 2 * P);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(1)},${y(wtOut(p.kg)).toFixed(1)}`).join(' ');
  // 7-day trailing average: the line that matters during prep
  const avg = pts.map((p) => ({ p, v: wtOut(avgOver(series, addDays(p.d, -6), p.d)) }));
  const avgLine = avg.map((a, i) => `${i ? 'L' : 'M'}${x(a.p).toFixed(1)},${y(Math.min(Math.max(a.v, lo), hi)).toFixed(1)}`).join(' ');
  return html`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Body weight chart">
    <path d="${line}" class="ch-raw"/><path d="${avgLine}" class="ch-avg"/>
    ${pts.map((p) => html`<circle cx="${x(p).toFixed(1)}" cy="${y(wtOut(p.kg)).toFixed(1)}" r="2.6" class="ch-dot"/>`)}
    <text x="${P}" y="11" class="ch-t">${fmt(hi, 1)}</text><text x="${P}" y="${H - 2}" class="ch-t">${fmt(lo, 1)}</text>
  </svg><div class="legend"><span><i class="lg-avg"></i>7-day average</span><span><i class="lg-raw"></i>daily weigh-ins</span></div>`;
}

function weightCard() {
  const series = weightSeries();
  const t = today();
  const todayKg = S.weights[t];
  const a1 = avgOver(series, addDays(t, -6), t);
  const a0 = avgOver(series, addDays(t, -13), addDays(t, -7));
  const delta = a1 != null && a0 != null ? wtOut(a1) - wtOut(a0) : null;
  return html`<div class="card">
    <div class="card-title">⚖️ Body weight</div>
    <form class="weigh"><div class="with-unit grow"><input id="wt-in" type="text" inputmode="decimal" placeholder="${todayKg ? '' : 'This morning’s weight'}" value="${todayKg ? fmt(wtOut(todayKg), 1) : ''}" autocomplete="off"><em>${wtUnit()}</em></div><button type="button" class="btn primary small" data-act="wt-save" data-submit>${todayKg ? 'Update' : 'Log'}</button></form>
    <div class="stat-row">
      <div><span>7-day average</span><b>${a1 == null ? '—' : fmt(wtOut(a1), 1)}</b></div>
      <div><span>vs. week before</span><b class="${delta == null ? '' : delta < 0 ? 'down' : 'up'}">${delta == null ? '—' : (delta > 0 ? '+' : '') + fmt(delta, 1).replace('-', '−')}</b></div>
      <div><span>Weigh-ins</span><b>${series.length}</b></div>
    </div>
    ${weightChart(series)}
    <p class="fine">Weigh in at the same time each morning. Go by the 7-day average, not single days — water and salt swing the scale. Logging weight is optional.</p>
  </div>`;
}

function weekCard() {
  const t = today();
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(addDays(t, -i));
  const logged = days.filter((d) => getDay(d).entries.length);
  const g = S.settings.goals;
  const per = logged.map((d) => totals(getDay(d).entries));
  const avg = (k) => (per.length ? per.reduce((a, x) => a + x[k].sum, 0) / per.length : null);
  const maxK = Math.max(g.kcal, ...days.map((d) => totals(getDay(d).entries).kcal.sum)) * 1.08;
  const water = logged.length ? logged.reduce((a, d) => a + (getDay(d).water || 0), 0) / logged.length : null;
  const row = (k) => {
    const v = avg(k);
    const s = v == null ? '' : status(k, v, g[k]);
    const mode = goalMode(k);
    return html`<div class="wk-row ${s}"><span>${NUTRIENT[k].label}</span><b>${v == null ? '—' : fmtN(k, v)} <small>${NUTRIENT[k].unit}</small></b><em>${mode === 'max' ? '≤' : mode === 'min' ? '≥' : '≈'} ${fmt(g[k])}</em></div>`;
  };
  return html`<div class="card">
    <div class="card-title">📊 Last 7 days <small>${logged.length}/7 logged</small></div>
    <div class="bars">${days.map((d) => {
      const k = totals(getDay(d).entries).kcal.sum;
      const s = k ? status('kcal', k, g.kcal) : 'none';
      return html`<button class="barcol ${s}" data-act="goto-day" data-d="${d}"><span class="barval">${k ? fmt(k) : ''}</span><span class="barbox"><i style="height:${(k / maxK) * 100}%"></i><u style="bottom:${(g.kcal / maxK) * 100}%"></u></span><em>${parseDay(d).toLocaleDateString('en-US', { weekday: 'narrow' })}</em></button>`;
    })}</div>
    <div class="legend"><span><i class="lg-goal"></i>calorie goal</span><span>tap a day to open it</span></div>
    <div class="sec-title">Daily averages (logged days)</div>
    ${['kcal', 'protein', 'carbs', 'fat', 'sodium', 'potassium', 'fiber'].map(row)}
    <div class="wk-row"><span>Water</span><b>${water == null ? '—' : fmtWater(water)}</b><em>≥ ${fmtWater(g.water)}</em></div>
  </div>`;
}

export function renderProgress() {
  return html`<div class="page">
    <header class="page-head"><h1>Progress</h1><p>Show up, log it, repeat.</p></header>
    ${countdownCard()}${streakCard()}${weightCard()}${weekCard()}
  </div>`;
}

on({
  'wt-save': () => {
    const v = readNum($('#wt-in').value);
    if (!v) return toast('Enter your weight first.', 'bad');
    const kg = wtIn(v);
    if (kg < 30 || kg > 250) return toast(`That doesn’t look right for ${wtUnit()} — check the number.`, 'bad');
    const first = !Object.keys(S.weights).length;
    setWeight(today(), kg);
    refresh();
    toast(say('weightLogged'), 'good');
    if (first) confetti(50);
  },
  'goto-day': (d) => {
    S.date = d.d;
    S.tab = 'today';
    refresh();
    window.scrollTo(0, 0);
  },
});
