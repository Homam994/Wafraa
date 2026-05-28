// ══════════════════════════════════════════════════
//  WAFRA  —  Service Worker  (Offline-First)
//  Strategy: Cache-First for assets, Network-First for APIs
// ══════════════════════════════════════════════════

const CACHE_NAME    = 'wafra-v5';
const FONT_CACHE    = 'wafra-fonts-v1';

// App shell — cached on install
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './favicon-32.png',
];

// ── INSTALL ─────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .catch(err => console.warn('[SW] Install cache failed:', err))
  );
  // Activate immediately without waiting for old SW to die
  self.skipWaiting();
});

// ── ACTIVATE ────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== FONT_CACHE)
          .map(k => {
            console.log('[SW] Deleting old cache:', k);
            return caches.delete(k);
          })
      )
    )
  );
  // Take control of all pages immediately
  self.clients.claim();
});

// ── FETCH ────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Skip non-GET requests entirely (POST, DELETE, etc.)
  if (request.method !== 'GET') return;

  // 2. Skip Firebase / Firestore — always go to network
  //    Firestore handles its own offline cache via IndexedDB
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebase.googleapis.com') ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.hostname.includes('securetoken.googleapis.com') ||
    url.hostname.includes('firebaseapp.com') ||
    url.pathname.includes('/__/firebase/')
  ) return;

  // 3. Google Fonts CSS — Network-First with Font cache fallback
  if (url.hostname === 'fonts.googleapis.com') {
    event.respondWith(networkFirstFont(request));
    return;
  }

  // 4. Google Fonts files — Cache-First (fonts don't change)
  if (url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirstFont(request));
    return;
  }

  // 5. Firebase JS SDKs (gstatic CDN) — Cache-First
  if (url.hostname === 'www.gstatic.com') {
    event.respondWith(cacheFirst(request, CACHE_NAME));
    return;
  }

  // 6. App shell & same-origin assets — Cache-First
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, CACHE_NAME));
    return;
  }

  // 7. Everything else — Network with cache fallback
  event.respondWith(networkWithFallback(request));
});

// ── STRATEGIES ──────────────────────────────────────

/**
 * Cache-First: serve from cache, update in background
 */
async function cacheFirst(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    // Background refresh for next visit
    refreshInBackground(request, cache);
    return cached;
  }
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    // Offline and not cached — return app shell for navigation
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

/**
 * Network-First for fonts CSS (needs latest version)
 */
async function networkFirstFont(request) {
  const cache = await caches.open(FONT_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || new Response('', { status: 503 });
  }
}

/**
 * Cache-First for font files (binary, immutable)
 */
async function cacheFirstFont(request) {
  const cache  = await caches.open(FONT_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('', { status: 503 });
  }
}

/**
 * Network with cache fallback
 */
async function networkWithFallback(request) {
  try {
    return await fetch(request);
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}

/**
 * Silently refresh a cached resource in the background
 */
function refreshInBackground(request, cache) {
  fetch(request)
    .then(res => { if (res.ok) cache.put(request, res); })
    .catch(() => {}); // silent — offline is fine
}

// ── MESSAGES from app ────────────────────────────────
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CACHE_URLS' && event.data.urls) {
    caches.open(CACHE_NAME).then(c => c.addAll(event.data.urls));
  }
});
