// Small DOM helpers: safe HTML templating, click/input delegation, bottom sheets, toasts, confetti.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
class Raw {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}
export const raw = (s) => new Raw(String(s ?? ''));
const part = (v) => (v instanceof Raw ? v.s : v === false || v == null ? '' : esc(v));
/** Tagged template: every interpolated value is HTML-escaped unless it is itself html`` / raw(). */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) out += Array.isArray(vals[i]) ? vals[i].map(part).join('') : part(vals[i]);
  });
  return new Raw(out);
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const setHTML = (el, tpl) => {
  if (el) el.innerHTML = tpl instanceof Raw ? tpl.s : esc(tpl);
};

// ----- event delegation -----
const clicks = {};
const inputs = {};
export const on = (map) => Object.assign(clicks, map);
export const onInput = (map) => Object.assign(inputs, map);

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = clicks[el.dataset.act];
  if (fn) {
    ev.preventDefault();
    fn(el.dataset, el, ev);
  }
});
for (const type of ['input', 'change']) {
  document.addEventListener(type, (ev) => {
    const el = ev.target.closest('[data-in]');
    if (!el) return;
    const fn = inputs[el.dataset.in];
    if (fn) fn(el.value, el, ev);
  });
}
document.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const btn = ev.target.querySelector('[data-submit]');
  if (btn) btn.click();
  else if (document.activeElement) document.activeElement.blur();
});
// Pressing return in a field marked data-enter="action" presses that action's button in the same sheet.
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter' || !ev.target.dataset || !ev.target.dataset.enter) return;
  const scope = ev.target.closest('.sheet') || document;
  const btn = scope.querySelector(`[data-act="${ev.target.dataset.enter}"]`);
  if (btn && !btn.disabled) {
    ev.preventDefault();
    ev.target.blur();
    btn.click();
  }
});

// ----- keep sheets and toasts above the on-screen keyboard (iOS does not resize the page for it) -----
const vv = window.visualViewport;
function syncViewport() {
  if (!vv || Math.abs(vv.scale - 1) > 0.01) return; // ignore pinch-zoom
  const st = document.documentElement.style;
  st.setProperty('--vvh', vv.height + 'px');
  st.setProperty('--vvtop', vv.offsetTop + 'px');
  st.setProperty('--kbh', Math.max(0, window.innerHeight - vv.height - vv.offsetTop) + 'px');
}
if (vv) {
  vv.addEventListener('resize', syncViewport);
  vv.addEventListener('scroll', syncViewport);
  syncViewport();
}

// ----- bottom sheets -----
const stack = [];
/**
 * opts.guard: () => true when the sheet holds unsaved work. Closing by tap/swipe then needs a second
 * tap, so a stray touch cannot throw away a half-built recipe. Calling sheet.close() skips the guard.
 */
export function openSheet(tpl, { onClose, cls = '', guard } = {}) {
  const root = $('#sheets');
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet-backdrop" data-act="sheet-close"></div><section class="sheet ${cls}" role="dialog" aria-modal="true"><div class="sheet-grab" aria-hidden="true"></div><div class="sheet-body"></div></section>`;
  const body = $('.sheet-body', wrap);
  const panel = $('.sheet', wrap);
  setHTML(body, tpl);
  root.appendChild(wrap);
  document.body.classList.add('sheet-open');
  setTimeout(() => wrap.classList.add('in'), 16); // a timer, not rAF: rAF never fires while the app is in the background
  let armed = false;
  const sheet = {
    el: wrap,
    body,
    closed: false,
    set(t) {
      setHTML(body, t);
    },
    /** A close asked for by the person (✕, backdrop, swipe). Returns false if it was held back. */
    requestClose() {
      if (guard && guard() && !armed) {
        armed = true;
        toast('You have unsaved changes. Close again to discard them.', 'info');
        setTimeout(() => (armed = false), 5000);
        return false;
      }
      sheet.close();
      return true;
    },
    close(silent) {
      if (sheet.closed) return;
      sheet.closed = true;
      const i = stack.indexOf(sheet);
      if (i >= 0) stack.splice(i, 1);
      wrap.classList.remove('in');
      panel.style.transform = '';
      setTimeout(() => wrap.remove(), 260);
      if (!stack.length) document.body.classList.remove('sheet-open');
      if (onClose) onClose(!!silent);
    },
  };

  // tap or swipe down on the handle to close
  const grab = $('.sheet-grab', wrap);
  let y0 = null;
  let dy = 0;
  grab.addEventListener('pointerdown', (e) => {
    y0 = e.clientY;
    dy = 0;
    panel.style.transition = 'none';
    try {
      grab.setPointerCapture(e.pointerId);
    } catch {}
  });
  grab.addEventListener('pointermove', (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.clientY - y0);
    panel.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    if (y0 == null) return;
    y0 = null;
    panel.style.transition = '';
    const wantsClose = dy > 80 || dy < 6;
    if (!wantsClose || !sheet.requestClose()) panel.style.transform = '';
  };
  grab.addEventListener('pointerup', end);
  grab.addEventListener('pointercancel', () => {
    y0 = null;
    panel.style.transition = '';
    panel.style.transform = '';
  });

  stack.push(sheet);
  return sheet;
}
export const topSheet = () => stack[stack.length - 1] || null;
export const closeAllSheets = () => [...stack].reverse().forEach((s) => s.close(true));
on({ 'sheet-close': () => topSheet() && topSheet().requestClose() });

// ----- toast -----
let toastTimer = null;
const TOAST_MS = { bad: 4500, info: 6000 };
export function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), TOAST_MS[kind] || 2400);
}
/** Toast with an Undo button. */
let undoFn = null;
export function undoToast(msg, fn) {
  undoFn = fn;
  const el = $('#toast');
  el.textContent = msg + ' ';
  const b = document.createElement('button');
  b.textContent = 'Undo';
  b.dataset.act = 'undo';
  el.appendChild(b);
  el.className = 'toast show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    undoFn = null;
    el.className = 'toast';
  }, 6000);
}
on({
  undo: () => {
    const fn = undoFn;
    undoFn = null;
    clearTimeout(toastTimer);
    $('#toast').className = 'toast';
    if (fn) fn();
  },
});

// ----- confetti -----
export function confetti(amount = 110) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas');
  c.className = 'confetti';
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = innerWidth * dpr;
  c.height = innerHeight * dpr;
  document.body.appendChild(c);
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const colors = ['#2563eb', '#38bdf8', '#facc15', '#fb7185', '#34d399', '#ffffff', '#818cf8'];
  const parts = Array.from({ length: amount }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 80,
    y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 13 - 4,
    s: 5 + Math.random() * 6,
    r: Math.random() * 6.28,
    vr: (Math.random() - 0.5) * 0.4,
    c: colors[(Math.random() * colors.length) | 0],
  }));
  const t0 = performance.now();
  const frame = (t) => {
    const age = t - t0;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.33;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.globalAlpha = Math.max(0, 1 - age / 2200);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * 0.66);
      ctx.restore();
    }
    if (age < 2200) requestAnimationFrame(frame);
    else c.remove();
  };
  requestAnimationFrame(frame);
}

/**
 * Parse a number someone typed. "1.5" and "1,5" are both one and a half; "1,234" and "12,500.5"
 * are read as thousands separators. Returns null when empty, negative or not a number.
 */
export function readNum(v) {
  if (v == null) return null;
  let s = String(v).trim().replace(/\s/g, '');
  if (s === '') return null;
  if (/^[1-9]\d{0,2}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else s = s.replace(',', '.');
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
