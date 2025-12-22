// --------------------------------------------------
// IPTV SERVICE WORKER v1.0 - Optimized for final.js
// --------------------------------------------------

const VERSION = '1.0';
const STATIC_CACHE = `iptv-static-v1`;
const DYNAMIC_CACHE = `iptv-dynamic-v1`;
const LIVE_CACHE = `iptv-live-v1`;
const API_CACHE = `iptv-api-v1`;

// Maximum items per cache
const MAX_DYNAMIC_ITEMS = 150;
const MAX_LIVE_ITEMS = 100;
const MAX_API_ITEMS = 50;

// Critical app shell assets
const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './final.js',
  './placeholder.png',
  './favicon.svg',
  './logo.svg',
  './admin.html'
];

// External dependencies (CDN)
const EXTERNAL_ASSETS = [
  'https://unpkg.com/video.js@8.23.4/dist/video-js.min.css',
  'https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap',
  'https://vjs.zencdn.net/8.23.4/video.min.js',
  'https://cdn.jsdelivr.net/npm/videojs-youtube@3.0.1/dist/Youtube.min.js',
  'https://unpkg.com/@videojs/http-streaming@3.17.2/dist/videojs-http-streaming.min.js'
];

// Cache expiration times (in milliseconds)
const CACHE_TTL = {
  STATIC: 7 * 24 * 60 * 60 * 1000, // 7 days
  DYNAMIC: 24 * 60 * 60 * 1000,    // 24 hours
  LIVE: 60 * 60 * 1000,            // 1 hour
  API: 30 * 60 * 1000              // 30 minutes
};

// YouTube/Google domains for dynamic caching
const YOUTUBE_DOMAINS = [
  'ytimg.com',
  'ggpht.com',
  'googleusercontent.com',
  'youtube.com',
  'googlevideo.com'
];

// API endpoints (network-first strategy)
const API_ENDPOINTS = [
  'googleapis.com',
  'api.rss2json.com',
  'youtube.googleapis.com'
];

// --------------------------------------------------
// HELPER FUNCTIONS
// --------------------------------------------------

/**
 * Check if URL matches YouTube domain
 */
function isYouTubeResource(url) {
  return YOUTUBE_DOMAINS.some(domain => url.hostname.includes(domain));
}

/**
 * Check if URL is an API endpoint
 */
function isAPIRequest(url) {
  return API_ENDPOINTS.some(endpoint => url.hostname.includes(endpoint)) ||
    /\.(m3u|m3u8|json|xml)$/i.test(url.pathname) ||
    url.pathname.includes('/api/');
}

/**
 * Check if resource is static
 */
function isStaticAsset(url) {
  const staticExtensions = /\.(css|js|png|jpg|jpeg|gif|svg|ico|webp|woff|woff2|ttf|eot)$/i;
  return staticExtensions.test(url.pathname);
}

/**
 * Limit cache size by removing oldest entries
 */
async function trimCache(cacheName, maxItems) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    
    if (keys.length > maxItems) {
      // Remove oldest items (first in array)
      const toDelete = keys.slice(0, keys.length - maxItems);
      await Promise.all(toDelete.map(key => cache.delete(key)));
      console.log(`[SW] Trimmed ${cacheName}: removed ${toDelete.length} items`);
    }
  } catch (error) {
    console.warn(`[SW] Failed to trim cache ${cacheName}:`, error);
  }
}

/**
 * Clean expired cache entries
 */
async function cleanExpiredCache(cacheName, maxAge) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    const now = Date.now();
    
    const expired = await Promise.all(
      keys.map(async key => {
        try {
          const response = await cache.match(key);
          if (!response) return null;
          
          const dateHeader = response.headers.get('date');
          const cachedAt = dateHeader ? new Date(dateHeader).getTime() : now;
          
          return (now - cachedAt > maxAge) ? key : null;
        } catch {
          return null;
        }
      })
    );
    
    const expiredKeys = expired.filter(Boolean);
    await Promise.all(expiredKeys.map(key => cache.delete(key)));
    
    if (expiredKeys.length > 0) {
      console.log(`[SW] Cleaned ${expiredKeys.length} expired items from ${cacheName}`);
    }
  } catch (error) {
    console.warn(`[SW] Failed to clean cache ${cacheName}:`, error);
  }
}

/**
 * Broadcast message to all clients
 */
function broadcastMessage(type, payload = {}) {
  self.clients.matchAll().then(clients => {
    clients.forEach(client => {
      try {
        client.postMessage({ 
          type, 
          data: { ...payload, timestamp: Date.now() }
        });
      } catch (error) {
        // Client might be closed
      }
    });
  });
}

/**
 * Safe fetch with timeout and retry
 */
async function safeFetch(request, retries = 2) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  
  try {
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok && response.status >= 500 && retries > 0) {
      // Retry on server errors
      console.log(`[SW] Retrying ${request.url} (${retries} retries left)`);
      return safeFetch(request, retries - 1);
    }
    
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      console.warn(`[SW] Request timeout: ${request.url}`);
    }
    
    if (retries > 0) {
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 1000));
      return safeFetch(request, retries - 1);
    }
    
    throw error;
  }
}

// --------------------------------------------------
// INSTALL EVENT
// --------------------------------------------------
self.addEventListener('install', (event) => {
  console.log(`[SW] Installing IPTV ${VERSION}`);
  
  // Skip waiting to activate immediately
  self.skipWaiting();
  
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(STATIC_CACHE);
        
        // Cache core assets
        const corePromises = CORE_ASSETS.map(asset => 
          cache.add(asset).catch(error => 
            console.warn(`[SW] Failed to cache ${asset}:`, error.message)
          )
        );
        
        // Cache external assets (non-blocking)
        const externalPromises = EXTERNAL_ASSETS.map(asset => 
          cache.add(asset).catch(error => 
            console.debug(`[SW] External asset ${asset}:`, error.message)
          )
        );
        
        await Promise.all([...corePromises, ...externalPromises]);
        console.log(`[SW] Installation complete`);
      } catch (error) {
        console.error('[SW] Installation failed:', error);
      }
    })()
  );
});

// --------------------------------------------------
// ACTIVATE EVENT
// --------------------------------------------------
self.addEventListener('activate', (event) => {
  console.log(`[SW] Activating IPTV ${VERSION}`);
  
  event.waitUntil(
    (async () => {
      // Clean old caches
      const cacheKeys = await caches.keys();
      const validCaches = [STATIC_CACHE, DYNAMIC_CACHE, LIVE_CACHE, API_CACHE];
      
      await Promise.all(
        cacheKeys.map(key => {
          if (!validCaches.includes(key)) {
            console.log(`[SW] Deleting old cache: ${key}`);
            return caches.delete(key);
          }
        })
      );
      
      // Claim clients immediately
      await self.clients.claim();
      
      // Start periodic maintenance
      startCacheMaintenance();
      
      broadcastMessage('SW_ACTIVATED', { version: VERSION });
      console.log(`[SW] Activation complete`);
    })()
  );
});

// --------------------------------------------------
// FETCH EVENT - Main caching strategy
// --------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-GET requests and non-HTTP(S) protocols
  if (request.method !== 'GET' || !url.protocol.startsWith('http')) {
    return;
  }
  
  // Skip chrome-extension protocols
  if (url.protocol === 'chrome-extension:') {
    return;
  }
  
  // ----------------------------------------
  // 1. STATIC ASSETS: Cache First
  // ----------------------------------------
  if (isStaticAsset(url) || 
      CORE_ASSETS.includes(url.pathname) || 
      EXTERNAL_ASSETS.includes(request.url)) {
    
    event.respondWith(
      (async () => {
        // Try cache first
        const cached = await caches.match(request);
        if (cached) {
          // Update cache in background
          event.waitUntil(
            updateCache(request).catch(() => {})
          );
          return cached;
        }
        
        // Fetch and cache
        try {
          const response = await safeFetch(request);
          if (response.ok) {
            const cache = await caches.open(STATIC_CACHE);
            await cache.put(request, response.clone());
          }
          return response;
        } catch (error) {
          console.warn(`[SW] Failed to fetch ${request.url}:`, error);
          return new Response('Offline', { 
            status: 503, 
            headers: { 'Content-Type': 'text/plain' } 
          });
        }
      })()
    );
    return;
  }
  
  // ----------------------------------------
  // 2. YOUTUBE RESOURCES: Dynamic Caching
  // ----------------------------------------
  if (isYouTubeResource(url)) {
    event.respondWith(
      (async () => {
        try {
          // Try cache first for thumbnails
          const cached = await caches.match(request);
          if (cached) {
            // Update in background
            event.waitUntil(
              updateCache(request, DYNAMIC_CACHE).catch(() => {})
            );
            return cached;
          }
          
          // Fetch and cache
          const response = await safeFetch(request);
          if (response.ok) {
            const cache = await caches.open(DYNAMIC_CACHE);
            await cache.put(request, response.clone());
            await trimCache(DYNAMIC_CACHE, MAX_DYNAMIC_ITEMS);
          }
          return response;
        } catch (error) {
          console.warn(`[SW] Failed to fetch YouTube resource:`, error);
          // Return placeholder for failed thumbnails
          if (/\.(jpg|jpeg|png|gif|webp)$/i.test(url.pathname)) {
            const placeholder = await caches.match('./placeholder.png');
            if (placeholder) return placeholder;
          }
          return new Response('Offline', { status: 503 });
        }
      })()
    );
    return;
  }
  
  // ----------------------------------------
  // 3. API REQUESTS: Network First with Cache Fallback
  // ----------------------------------------
  if (isAPIRequest(url)) {
    event.respondWith(
      (async () => {
        // Notify client we're attempting network
        broadcastMessage('API_REQUEST_STARTED', { url: request.url });
        
        try {
          // Try network first
          const response = await safeFetch(request);
          
          // Cache successful API responses (except YouTube API with sensitive data)
          if (response.ok && !url.pathname.includes('/youtube/v3/')) {
            const cache = await caches.open(API_CACHE);
            await cache.put(request, response.clone());
            await trimCache(API_CACHE, MAX_API_ITEMS);
          }
          
          broadcastMessage('API_REQUEST_SUCCESS', { url: request.url });
          return response;
        } catch (error) {
          // Network failed, try cache
          console.warn(`[SW] API request failed, trying cache:`, error);
          
          const cached = await caches.match(request);
          if (cached) {
            broadcastMessage('API_REQUEST_CACHED', { url: request.url });
            return cached;
          }
          
          // No cache available
          broadcastMessage('API_REQUEST_FAILED', { 
            url: request.url, 
            error: error.message 
          });
          
          // For RSS/JSON APIs, return empty response instead of error
          if (url.pathname.includes('api.rss2json.com')) {
            return new Response(JSON.stringify({ items: [] }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }
          
          return new Response(JSON.stringify({ 
            error: 'Offline', 
            message: 'Please check your connection' 
          }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      })()
    );
    return;
  }
  
  // ----------------------------------------
  // 4. LIVE STREAMS: Stale-While-Revalidate
  // ----------------------------------------
  if (url.pathname.endsWith('.m3u') || url.pathname.endsWith('.m3u8')) {
    event.respondWith(
      (async () => {
        // Try cache first for quick response
        const cached = await caches.match(request);
        
        // Always try to update from network
        const fetchPromise = (async () => {
          try {
            const response = await safeFetch(request);
            if (response.ok) {
              const cache = await caches.open(LIVE_CACHE);
              await cache.put(request, response.clone());
              await trimCache(LIVE_CACHE, MAX_LIVE_ITEMS);
            }
          } catch (error) {
            console.warn(`[SW] Failed to update live stream:`, error);
          }
        })();
        
        // If we have cached version, use it immediately
        if (cached) {
          event.waitUntil(fetchPromise);
          return cached;
        }
        
        // Wait for network if no cache
        try {
          return await fetchPromise;
        } catch {
          return new Response('Stream unavailable', { status: 503 });
        }
      })()
    );
    return;
  }
  
  // ----------------------------------------
  // 5. DEFAULT: Network with cache fallback
  // ----------------------------------------
  event.respondWith(
    (async () => {
      try {
        const response = await safeFetch(request);
        return response;
      } catch (error) {
        // Try cache for HTML pages
        if (request.headers.get('Accept')?.includes('text/html')) {
          const cached = await caches.match('./index.html');
          if (cached) return cached;
        }
        
        return new Response('Offline', { 
          status: 503, 
          headers: { 'Content-Type': 'text/plain' } 
        });
      }
    })()
  );
});

// --------------------------------------------------
// CACHE MAINTENANCE
// --------------------------------------------------

/**
 * Start periodic cache maintenance
 */
function startCacheMaintenance() {
  // Run maintenance every hour
  setInterval(async () => {
    console.log('[SW] Running cache maintenance');
    
    try {
      // Clean expired cache entries
      await cleanExpiredCache(DYNAMIC_CACHE, CACHE_TTL.DYNAMIC);
      await cleanExpiredCache(LIVE_CACHE, CACHE_TTL.LIVE);
      await cleanExpiredCache(API_CACHE, CACHE_TTL.API);
      
      // Trim caches
      await trimCache(DYNAMIC_CACHE, MAX_DYNAMIC_ITEMS);
      await trimCache(LIVE_CACHE, MAX_LIVE_ITEMS);
      await trimCache(API_CACHE, MAX_API_ITEMS);
      
      // Report cache sizes
      const stats = await getCacheStats();
      broadcastMessage('CACHE_STATS', stats);
      
    } catch (error) {
      console.warn('[SW] Cache maintenance failed:', error);
    }
  }, 60 * 60 * 1000); // Every hour
}

/**
 * Update cache in background
 */
async function updateCache(request, cacheName = STATIC_CACHE) {
  try {
    const response = await safeFetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(request, response);
    }
  } catch (error) {
    // Silently fail - we already have cached version
  }
}

/**
 * Get cache statistics
 */
async function getCacheStats() {
  const stats = {};
  
  for (const cacheName of [STATIC_CACHE, DYNAMIC_CACHE, LIVE_CACHE, API_CACHE]) {
    try {
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      stats[cacheName] = keys.length;
    } catch (error) {
      stats[cacheName] = 0;
    }
  }
  
  return stats;
}

// --------------------------------------------------
// BACKGROUND SYNC
// --------------------------------------------------
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-failed-requests') {
    console.log('[SW] Background sync triggered');
    
    event.waitUntil(
      (async () => {
        broadcastMessage('BACKGROUND_SYNC_STARTED');
        
        try {
          // Retrieve failed requests from IndexedDB or cache
          const cache = await caches.open(API_CACHE);
          const keys = await cache.keys();
          
          let retryCount = 0;
          for (const key of keys) {
            try {
              // Check if this is a failed API request
              const response = await cache.match(key);
              if (response && response.status === 0) { // Network error
                const freshResponse = await safeFetch(key);
                if (freshResponse.ok) {
                  await cache.put(key, freshResponse.clone());
                  retryCount++;
                }
              }
            } catch (error) {
              console.warn(`[SW] Failed to retry ${key}:`, error);
            }
          }
          
          broadcastMessage('BACKGROUND_SYNC_COMPLETE', { retryCount });
          console.log(`[SW] Background sync completed, retried ${retryCount} requests`);
        } catch (error) {
          console.error('[SW] Background sync failed:', error);
          broadcastMessage('BACKGROUND_SYNC_FAILED', { error: error.message });
        }
      })()
    );
  }
});

// --------------------------------------------------
// PERIODIC SYNC (requires permission)
// --------------------------------------------------
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'refresh-feeds') {
    console.log('[SW] Periodic sync: refreshing feeds');
    
    event.waitUntil(
      (async () => {
        try {
          // Trigger RSS feed updates
          const response = await fetch('/api/refresh-feeds', { method: 'POST' });
          if (response.ok) {
            broadcastMessage('FEEDS_REFRESHED');
          }
        } catch (error) {
          console.warn('[SW] Periodic sync failed:', error);
        }
      })()
    );
  }
});

// --------------------------------------------------
// PUSH NOTIFICATIONS
// --------------------------------------------------
self.addEventListener('push', (event) => {
  if (!event.data) return;
  
  try {
    const data = event.data.json();
    
    const options = {
      body: data.body || 'New content available',
      icon: './logo.svg',
      badge: './logo.svg',
      tag: 'iptv-notification',
      data: data.url ? { url: data.url } : {},
      actions: data.url ? [
        { action: 'open', title: 'Watch Now' }
      ] : []
    };
    
    event.waitUntil(
      self.registration.showNotification(data.title || 'IPTV', options)
    );
  } catch (error) {
    // Fallback for non-JSON data
    event.waitUntil(
      self.registration.showNotification('IPTV', {
        body: event.data.text() || 'Update available',
        icon: './logo.svg'
      })
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'open' && event.notification.data.url) {
    event.waitUntil(
      clients.openWindow(event.notification.data.url)
    );
  } else {
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then(clientList => {
        // Focus existing window or open new one
        for (const client of clientList) {
          if (client.url.includes('/index.html') && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow('./');
        }
      })
    );
  }
});

// --------------------------------------------------
// MESSAGE HANDLING
// --------------------------------------------------
self.addEventListener('message', (event) => {
  const { data } = event.data || {};
  
  switch (data?.type || data) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
      
    case 'CLEAR_CACHE':
      (async () => {
        await Promise.all([
          caches.delete(DYNAMIC_CACHE),
          caches.delete(LIVE_CACHE),
          caches.delete(API_CACHE)
        ]);
        broadcastMessage('CACHE_CLEARED');
      })();
      break;
      
    case 'GET_CACHE_STATS':
      (async () => {
        const stats = await getCacheStats();
        event.ports?.[0]?.postMessage(stats);
      })();
      break;
      
    case 'PRELOAD_CHANNELS':
      // Preload channel images in background
      const urls = data.urls || [];
      urls.forEach(url => {
        fetch(url, { mode: 'no-cors' }).catch(() => {});
      });
      break;
      
    case 'UPDATE_AVAILABLE':
      // Trigger immediate update check
      self.registration.update();
      break;
  }
});

// --------------------------------------------------
// ERROR HANDLING
// --------------------------------------------------
self.addEventListener('error', (event) => {
  console.error('[SW] Error:', event.error);
  
  // Send error to analytics
  broadcastMessage('SW_ERROR', {
    message: event.error?.message,
    stack: event.error?.stack,
    timestamp: Date.now()
  });
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('[SW] Unhandled rejection:', event.reason);
  
  broadcastMessage('SW_REJECTION', {
    reason: event.reason?.message || String(event.reason),
    timestamp: Date.now()
  });
});

// --------------------------------------------------
// OFFLINE FALLBACK
// --------------------------------------------------
const OFFLINE_FALLBACKS = {
  'text/html': './index.html',
  'image/*': './placeholder.png',
  'application/json': JSON.stringify({ error: 'offline', message: 'No network connection' })
};

// Check for offline mode and serve fallbacks
self.addEventListener('fetch', (event) => {
  const { request } = event;
  
  // Only handle GET requests
  if (request.method !== 'GET') return;
  
  // Handle offline fallback for navigation requests
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          // Try network first
          const response = await fetch(request);
          return response;
        } catch (error) {
          // Fallback to cached offline page
          const cache = await caches.open(STATIC_CACHE);
          const offlinePage = await cache.match('./index.html');
          if (offlinePage) return offlinePage;
          
          // Ultimate fallback
          return new Response(
            '<h1>Offline</h1><p>Please check your internet connection.</p>',
            { 
              status: 200, 
              headers: { 'Content-Type': 'text/html' } 
            }
          );
        }
      })()
    );
  }
});

//console.log(`[SW] IPTV Service Worker ${VERSION} loaded`);
