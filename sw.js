// --------------------------------------------------
// IPTV SERVICE WORKER – Enhanced + Safe Cache System
// --------------------------------------------------

const CACHE_NAME = 'iptv-v1';          // Static cache
const DYNAMIC_CACHE = 'iptv-dynamic-v1'; // Dynamic responses

// App Shell / Static Assets
const STATIC_ASSETS = [
  './',
  '/index.html',
  '/styles.css',
  '/final.js',
  '/placeholder.png',
  '/admin.html',
  '/favicon.svg',
  '/logo.svg',
  'https://unpkg.com/video.js@8.23.4/dist/video-js.min.css',
  'https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap',
  'https://vjs.zencdn.net/8.23.4/video.min.js',
  'https://cdn.jsdelivr.net/npm/videojs-youtube@3.0.1/dist/Youtube.min.js',
  'https://unpkg.com/@videojs/http-streaming@3.17.2/dist/videojs-http-streaming.min.js'
];

// --------------------------------------------------
// INSTALL – Cache static assets
// --------------------------------------------------
self.addEventListener('install', (event) => {
  console.log('[SW] Installing IPTV v1');

  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.all(
        STATIC_ASSETS.map(asset =>
          cache.add(asset).catch(err =>
            console.warn('[SW] Failed to cache:', asset, err.message)
          )
        )
      );
    })
  );

  self.skipWaiting();
});

// --------------------------------------------------
// ACTIVATE – Remove old caches
// --------------------------------------------------
self.addEventListener('activate', (event) => {
  const keep = [CACHE_NAME, DYNAMIC_CACHE];

  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (!keep.includes(key)) {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          }
        })
      )
    )
  );

  self.clients.claim();
});

// --------------------------------------------------
// FETCH – Smart handling
// - App shell: Cache-first
// - Dynamic (YouTube thumbnails, images): Cache-first dynamic
// - API calls (YouTube, RSS, others): Network-first
// --------------------------------------------------
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Skip extension protocols
  if (url.protocol === 'chrome-extension:') return;

  // ----------------------------------------
  // 1. Handle YouTube Thumbnails / Images
  // ----------------------------------------
  if (
    url.hostname.includes('ytimg.com') ||
    url.hostname.includes('ggpht.com') ||
    url.hostname.includes('googleusercontent.com')
  ) {
    event.respondWith(
      caches.open(DYNAMIC_CACHE).then(async cache => {
        const cached = await cache.match(req);

        const fetchPromise = fetch(req).then(res => {
          if (res.ok) {
            cache.put(req, res.clone());
          }
          return res;
        }).catch(() => null);

        // Return cached immediately, update in background
        return cached || fetchPromise || caches.match('/placeholder.png');
      })
    );
    return;
  }
  // ----------------------------------------
  // 2. Network-first for API endpoints
  // ----------------------------------------
  if (
    url.hostname.includes('googleapis.com') ||
    url.pathname.includes('api.rss2json.com') ||
    url.pathname.endsWith('.m3u') ||
    url.pathname.endsWith('.m3u8')
  ) {
    event.respondWith(
      fetch(req)
        .then(res => res)
        .catch(() => caches.match(req))
    );
    return;
  }

  // ----------------------------------------
  // 3. Default: App Shell → Cache First
  // ----------------------------------------
  event.respondWith(
    caches.match(req).then(cached => {
      return (
        cached ||
        fetch(req).catch(() => caches.match('/index.html'))
      );
    })
  );
});

// --------------------------------------------------
// MANUAL UPDATE TRIGGER
// --------------------------------------------------
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
