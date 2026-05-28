// ══════════════════════════════════════════════════
//  WAFRA — Service Worker v6
//  Strategy: Stale-While-Revalidate for all app assets
//  Guarantees: offline navigation always works
// ══════════════════════════════════════════════════
const CACHE     = 'wafra-v6';
const FONT_CACHE = 'wafra-fonts-v2';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './logo.png',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './favicon-32.png',
  './sw.js',
];

// ── INSTALL ──────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(APP_SHELL))
      .catch(err => console.warn('[SW] install cache partial:', err))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE && k !== FONT_CACHE)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH ────────────────────────────────────────
self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Skip non-GET
  if (request.method !== 'GET') return;

  // Skip Firebase / auth APIs — always live
  if (isFirebaseUrl(url)) return;

  // Navigation requests (HTML pages) → SWR with guaranteed fallback
  if (request.mode === 'navigate') {
    e.respondWith(swrNavigate(request));
    return;
  }

  // Google Fonts CSS → network-first, font files → cache-first
  if (url.hostname === 'fonts.googleapis.com') {
    e.respondWith(networkFirstWithCache(request, FONT_CACHE));
    return;
  }
  if (url.hostname === 'fonts.gstatic.com') {
    e.respondWith(cacheFirstWithUpdate(request, FONT_CACHE));
    return;
  }

  // All other requests (assets, SDKs) → Stale-While-Revalidate
  e.respondWith(staleWhileRevalidate(request));
});

// ── STRATEGIES ───────────────────────────────────

/**
 * Stale-While-Revalidate:
 * Serve from cache immediately (fast!), update cache in background.
 * If not cached, fetch from network and cache it.
 */
async function staleWhileRevalidate(request) {
  const cache  = await caches.open(CACHE);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then(res => {
      if (res && res.ok && res.type !== 'opaque') {
        cache.put(request, res.clone());
      }
      return res;
    })
    .catch(() => null);

  // Return cached immediately if available; else wait for network
  return cached || fetchPromise || new Response('Offline', { status: 503 });
}

/**
 * Navigate SWR: serve cached index.html immediately,
 * revalidate in background. ALWAYS returns something.
 */
async function swrNavigate(request) {
  const cache       = await caches.open(CACHE);
  const cachedShell = await cache.match('./index.html')
                   || await cache.match('./');

  const fetchPromise = fetch(request)
    .then(res => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);

  if (cachedShell) {
    // Serve instantly from cache; update in background
    fetchPromise; // fire-and-forget
    return cachedShell.clone();
  }

  // Not cached yet — wait for network
  const res = await fetchPromise;
  return res || new Response(offlinePage(), {
    headers: { 'Content-Type': 'text/html;charset=utf-8' }
  });
}

async function networkFirstWithCache(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    return await cache.match(request) || new Response('', { status: 503 });
  }
}

async function cacheFirstWithUpdate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    // Background update
    fetch(request).then(r => { if (r.ok) cache.put(request, r); }).catch(() => {});
    return cached;
  }
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    return new Response('', { status: 503 });
  }
}

// ── HELPERS ──────────────────────────────────────
function isFirebaseUrl(url) {
  return url.hostname.includes('firestore.googleapis.com')
    || url.hostname.includes('firebase.googleapis.com')
    || url.hostname.includes('identitytoolkit.googleapis.com')
    || url.hostname.includes('securetoken.googleapis.com')
    || url.hostname.includes('firebaseapp.com')
    || url.pathname.includes('/__/firebase/');
}

function offlinePage() {
  return `<!DOCTYPE html><html lang="ar" dir="rtl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>وفرة — غير متصل</title>
<style>body{font-family:'Tajawal',sans-serif;background:#0a0a0f;color:#f0ead6;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;gap:1rem;text-align:center;padding:2rem}
.logo{font-size:3rem;color:#C9A84C}.msg{color:#9b9080;font-size:.9rem;line-height:1.6}
button{padding:.75rem 2rem;background:linear-gradient(135deg,#C9A84C,#8A6E2E);border:none;border-radius:8px;color:#0a0a0f;font-family:'Tajawal',sans-serif;font-size:1rem;font-weight:700;cursor:pointer;margin-top:.5rem}
</style></head>
<body>
<div class="logo">وفرة</div>
<div class="msg">لا يوجد اتصال بالإنترنت<br>تأكد من الاتصال ثم أعد المحاولة</div>
<button onclick="location.reload()">إعادة المحاولة</button>
</body></html>`;
}

// ── MESSAGES ─────────────────────────────────────
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
