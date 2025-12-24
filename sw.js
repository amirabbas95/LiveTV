/* =========================================================
   IPTV SERVICE WORKER v2
   Clean • Safe • Spec-Compliant
   ========================================================= */

const VERSION = '2.0.0';

/* Cache names */
const CACHE_STATIC = `iptv-static-${VERSION}`;
const CACHE_MEDIA  = `iptv-media-${VERSION}`;
const CACHE_API    = `iptv-api-${VERSION}`;

/* App shell */
const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/final.js',
  '/placeholder.png',
  '/logo.svg',
  '/favicon.svg'
];

/* Domains that must NEVER be cached */
const BYPASS_DOMAINS = [
  'googlevideo.com',
  'youtube.com',
  'youtube.googleapis.com'
];

/* ---------------------------------------------------------
   INSTALL
--------------------------------------------------------- */
self.addEventListener('install', event => {
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_STATIC).then(cache => cache.addAll(APP_SHELL))
  );
});

/* ---------------------------------------------------------
   ACTIVATE
--------------------------------------------------------- */
self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map(key => {
          if (![CACHE_STATIC, CACHE_MEDIA, CACHE_API].includes(key)) {
            return caches.delete(key);
          }
        })
      );
      await self.clients.claim();
      broadcast('SW_READY', { version: VERSION });
    })()
  );
});

/* ---------------------------------------------------------
   FETCH (SINGLE, AUTHORITATIVE)
--------------------------------------------------------- */
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;

  /* Bypass YouTube & streaming segments completely */
  if (
    BYPASS_DOMAINS.some(d => url.hostname.includes(d)) ||
    url.pathname.endsWith('.ts')
  ) {
    return;
  }

  /* LIVE STREAM PLAYLISTS → Network only */
  if (url.pathname.endsWith('.m3u8')) {
    event.respondWith(fetch(req));
    return;
  }

  /* API & DATA → Network First */
  if (
    req.headers.get('accept')?.includes('application/json') ||
    /\.(json|xml|m3u)$/i.test(url.pathname)
  ) {
    event.respondWith(networkFirst(req, CACHE_API));
    return;
  }

  /* IMAGES → Stale While Revalidate */
  if (req.destination === 'image') {
    event.respondWith(staleWhileRevalidate(req, CACHE_MEDIA));
    return;
  }

  /* APP SHELL → Cache First */
  event.respondWith(cacheFirst(req, CACHE_STATIC));
});

/* ---------------------------------------------------------
   STRATEGIES
--------------------------------------------------------- */
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;

  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return cache.match(req) || offlineJSON();
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);

  const fetchPromise = fetch(req)
    .then(res => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => cached);

  return cached || fetchPromise;
}

/* ---------------------------------------------------------
   OFFLINE HELPERS
--------------------------------------------------------- */
function offlineJSON() {
  return new Response(
    JSON.stringify({ error: 'offline' }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}

/* ---------------------------------------------------------
   CLIENT MESSAGING
--------------------------------------------------------- */
function broadcast(type, payload = {}) {
  self.clients.matchAll().then(clients => {
    clients.forEach(c =>
      c.postMessage({ type, payload, ts: Date.now() })
    );
  });
}

self.addEventListener('message', event => {
  const msg = event.data;

  if (!msg || !msg.type) return;

  switch (msg.type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    case 'CLEAR_CACHES':
      event.waitUntil(
        Promise.all([
          caches.delete(CACHE_MEDIA),
          caches.delete(CACHE_API)
        ]).then(() => broadcast('CACHE_CLEARED'))
      );
      break;

    case 'PING':
      event.source?.postMessage({
        type: 'PONG',
        version: VERSION
      });
      break;
  }
});
