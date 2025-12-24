/* =========================================================
   IPTV SERVICE WORKER v2.0.0
   ========================================================= */

const VERSION = '2.0.0';
const CACHE_STATIC = `iptv-static-${VERSION}`;
const CACHE_MEDIA  = `iptv-media-${VERSION}`;
const CACHE_API    = `iptv-api-${VERSION}`;

/* FIXED: Removed leading slashes. 
   'index.html' instead of '/index.html' 
*/
const APP_SHELL = [
  './',
  'index.html',
  'styles.css',
  'final.js',
  'placeholder.png',
  'logo.svg',
  'favicon.svg'
];

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
    caches.open(CACHE_STATIC).then(async (cache) => {
      console.log('SW: Pre-caching App Shell');
      
      // We loop through each file so we can see exactly which one fails
      const cachePromises = APP_SHELL.map(async (url) => {
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
          return await cache.put(url, response);
        } catch (err) {
          console.error(`SW: Failed to cache critical file: ${url}. Error:`, err);
        }
      });
      
      return Promise.all(cachePromises);
    })
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
   FETCH
--------------------------------------------------------- */
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;

  if (BYPASS_DOMAINS.some(d => url.hostname.includes(d)) || url.pathname.endsWith('.ts')) {
    return;
  }

  if (url.pathname.endsWith('.m3u8')) {
    event.respondWith(fetch(req));
    return;
  }

  if (req.headers.get('accept')?.includes('application/json') || /\.(json|xml|m3u)$/i.test(url.pathname)) {
    event.respondWith(networkFirst(req, CACHE_API));
    return;
  }

  if (req.destination === 'image') {
    event.respondWith(staleWhileRevalidate(req, CACHE_MEDIA));
    return;
  }

  event.respondWith(cacheFirst(req, CACHE_STATIC));
});

/* ---------------------------------------------------------
   STRATEGIES
--------------------------------------------------------- */
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;

  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    return new Response('Network error', { status: 408 });
  }
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

function offlineJSON() {
  return new Response(JSON.stringify({ error: 'offline' }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

function broadcast(type, payload = {}) {
  self.clients.matchAll().then(clients => {
    clients.forEach(c => c.postMessage({ type, payload, ts: Date.now() }));
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
        Promise.all([caches.delete(CACHE_MEDIA), caches.delete(CACHE_API)])
        .then(() => broadcast('CACHE_CLEARED'))
      );
      break;
    case 'PING':
      event.source?.postMessage({ type: 'PONG', version: VERSION });
      break;
  }
});
