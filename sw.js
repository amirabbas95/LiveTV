const CACHE_NAME = 'iptv-player-v1.0.1'; // Increment cache version for updates

// List of all essential files and external CDN dependencies from index.html
const APP_SHELL_ASSETS = [
    // Local Files
    './', 
    'index.html',
    'script.js',
    'admin.html', 
    'styles.css', 
    'favicon.svg',
    'logo.svg',

    // CDN CSS & Fonts
    'https://unpkg.com/video.js@8.23.4/dist/video-js.min.css',
    'https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap',

    // CDN JS
    'https://vjs.zencdn.net/8.23.4/video.min.js',
    'https://cdn.jsdelivr.net/npm/videojs-youtube@3.0.1/dist/Youtube.min.js',
    'https://unpkg.com/@videojs/http-streaming@3.17.2/dist/videojs-http-streaming.min.js',
];

// 1. Install Event: Cache all essential assets
self.addEventListener('install', (event) => {
    console.log('[ServiceWorker] Installing and caching app shell');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                // cache.addAll works, but Promise.all with individual cache.add handles failures better
                return Promise.all(
                    APP_SHELL_ASSETS.map(url => {
                        return cache.add(url).catch(e => {
                            // Non-critical CDN files may fail to cache, but don't halt installation
                            console.warn(`[ServiceWorker] Failed to cache (non-critical): ${url}`, e.message);
                        });
                    })
                );
            })
    );
});

// 2. Activate Event: Clean up old caches
self.addEventListener('activate', (event) => {
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    // Delete old caches that are not in the whitelist
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        console.log(`[ServiceWorker] Deleting old cache: ${cacheName}`);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    // Take control of all clients immediately
    event.waitUntil(self.clients.claim());
});

// 3. Fetch Event: Cache-First Strategy
self.addEventListener('fetch', (event) => {
    // Only intercept GET requests
    if (event.request.method !== 'GET') return;

    // Skip stream/non-cachable network calls (M3U, APIs, YouTube video data)
    const url = new URL(event.request.url);
    if (url.protocol === 'chrome-extension:' || url.hostname.includes('youtube') || url.hostname.includes('googleapis')) {
        return; 
    }

    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                // Cache hit - return the resource from cache
                if (response) {
                    return response;
                }
                // Cache miss - fetch from network
                return fetch(event.request);
            })
    );
});


// In your sw.js (service worker)
self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('.m3u8') || event.request.url.includes('live.geoiptv.org')) {
    event.respondWith(
      fetch(event.request.url.replace('http://', 'https://'))
        .catch(() => {
          // Fallback to CORS proxy
          return fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(event.request.url)}`);
        })
    );
  }
});