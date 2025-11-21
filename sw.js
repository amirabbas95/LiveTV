const CACHE_NAME = 'iptv-player-v1.0.2'; // Incremented version
const DYNAMIC_CACHE = 'iptv-dynamic-v1';

const APP_SHELL_ASSETS = [
    './', 
    'index.html',
    'script.js',
    'admin.html', 
    'styles.css', 
    'favicon.svg',
    'logo.svg',
    'https://unpkg.com/video.js@8.23.4/dist/video-js.min.css',
    'https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap',
    'https://vjs.zencdn.net/8.23.4/video.min.js',
    'https://cdn.jsdelivr.net/npm/videojs-youtube@3.0.1/dist/Youtube.min.js',
    'https://unpkg.com/@videojs/http-streaming@3.17.2/dist/videojs-http-streaming.min.js',
];

// 1. Install Event
self.addEventListener('install', (event) => {
    console.log('[ServiceWorker] Installing v1.0.2');
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return Promise.all(
                APP_SHELL_ASSETS.map(url => {
                    return cache.add(url).catch(e => {
                        console.warn(`[SW] Failed to cache: ${url}`, e.message);
                    });
                })
            );
        })
    );
    self.skipWaiting(); // Activate immediately
});

// 2. Activate Event
self.addEventListener('activate', (event) => {
    const cacheWhitelist = [CACHE_NAME, DYNAMIC_CACHE];
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        console.log(`[SW] Deleting old cache: ${cacheName}`);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    event.waitUntil(self.clients.claim());
});

// 3. UNIFIED Fetch Event - Handles both app shell AND dynamic content
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);

    // Skip non-cacheable requests
    if (url.protocol === 'chrome-extension:' || 
        url.hostname.includes('googleapis') ||
        url.pathname.includes('api.rss2json.com')) {
        return;
    }

    // Handle YouTube thumbnails with dynamic cache
    if (url.hostname.includes('ytimg.com') || 
        url.hostname.includes('ggpht.com') ||
        url.hostname.includes('googleusercontent.com')) {
        event.respondWith(
            caches.open(DYNAMIC_CACHE).then(cache => {
                return cache.match(event.request).then(response => {
                    if (response) return response;
                    
                    return fetch(event.request).then(fetchResponse => {
                        // Only cache successful responses
                        if (fetchResponse && fetchResponse.status === 200) {
                            cache.put(event.request, fetchResponse.clone());
                        }
                        return fetchResponse;
                    }).catch(() => {
                        // Return placeholder if offline
                        return new Response('', { status: 503 });
                    });
                });
            })
        );
        return;
    }

    // Default cache-first strategy for app shell
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request).catch(() => {
                // Return offline page if available
                return caches.match('./index.html');
            });
        })
    );
});

// Notify clients of updates
self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});