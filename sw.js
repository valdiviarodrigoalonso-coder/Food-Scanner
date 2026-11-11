// Service worker: makes the app open instantly and work offline once installed.
// Bump VERSION whenever app files change so phones pick up the new copy.
const VERSION = 'sk-v4';
const CORE = [
  './', 'index.html', 'styles.css?v=4', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js?v=4', 'js/ui.js', 'js/store.js', 'js/state.js', 'js/nutrition.js', 'js/coach.js', 'js/fooddb.js', 'js/pins.js', 'js/parts.js', 'js/api.js', 'js/scanner.js',
  'js/food.js', 'js/meals.js', 'js/today.js', 'js/progress.js', 'js/settings.js', 'data/foods.json?v=1', 'data/dishes.json?v=1',
];
const CDN = ['cdn.jsdelivr.net', 'fastly.jsdelivr.net'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'sk-cdn').map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}
async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = (await cache.match(req)) || (req.mode === 'navigate' ? await cache.match('index.html') : null);
    if (hit) return hit;
    throw e;
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (CDN.includes(url.hostname)) return e.respondWith(cacheFirst(req, 'sk-cdn')); // barcode reader (versioned URLs)
  if (url.origin !== location.origin) return; // food lookups always go to the network
  if (url.pathname.endsWith('/data/foods.json')) return e.respondWith(cacheFirst(req, VERSION)); // big and versioned
  e.respondWith(networkFirst(req));
});
