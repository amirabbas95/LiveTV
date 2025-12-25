// ============================================
// SERVICE WORKER - IPTV CHANNEL MANAGER
// ============================================

const SW_VERSION = '1.0.0';
const SW_NAME = 'iptv-channel-manager';

// ============================================
// CACHE CONFIGURATION
// ============================================

const CACHE_NAMES = {
  STATIC: `${SW_NAME}-static-v${SW_VERSION}`,
  DYNAMIC: `${SW_NAME}-dynamic-v${SW_VERSION}`,
  IMAGES: `${SW_NAME}-images-v${SW_VERSION}`,
  VIDEOS: `${SW_NAME}-videos-v${SW_VERSION}`,
  API: `${SW_NAME}-api-v${SW_VERSION}`
};

// Assets to cache immediately on install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/final.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/placeholder.png'
];

// Cache strategies
const CACHE_STRATEGIES = {
  CACHE_FIRST: 'cache-first',
  NETWORK_FIRST: 'network-first',
  NETWORK_ONLY: 'network-only',
  CACHE_ONLY: 'cache-only',
  STALE_WHILE_REVALIDATE: 'stale-while-revalidate'
};

// Route matching patterns
const ROUTE_PATTERNS = {
  STATIC: /\.(html|css|js|json|woff2?|ttf|eot)$/i,
  IMAGES: /\.(png|jpg|jpeg|gif|webp|svg|ico)$/i,
  VIDEOS: /\.(mp4|webm|m3u8|ts)$/i,
  API: /\/api\/|rss2json\.com|googleapis\.com|youtube\.com\/api/i,
  YOUTUBE: /youtube\.com|ytimg\.com|googlevideo\.com/i,
  EXTERNAL: /^https?:\/\//i
};

// Cache limits
const CACHE_LIMITS = {
  DYNAMIC: 50,   // Max 50 dynamic resources
  IMAGES: 100,   // Max 100 images
  VIDEOS: 10,    // Max 10 video segments
  API: 30        // Max 30 API responses
};

// Cache expiration times (in milliseconds)
const CACHE_EXPIRATION = {
  STATIC: 30 * 24 * 60 * 60 * 1000,    // 30 days
  DYNAMIC: 7 * 24 * 60 * 60 * 1000,     // 7 days
  IMAGES: 14 * 24 * 60 * 60 * 1000,     // 14 days
  VIDEOS: 2 * 60 * 60 * 1000,           // 2 hours
  API: 60 * 60 * 1000                   // 1 hour
};

// ============================================
// INSTALL EVENT
// ============================================

self.addEventListener('install', (event) => {
  console.log(`[SW ${SW_VERSION}] Installing...`);

  event.waitUntil(
    (async () => {
      try {
        // Open static cache
        const cache = await caches.open(CACHE_NAMES.STATIC);
        
        // Cache static assets with error handling
        const results = await Promise.allSettled(
          STATIC_ASSETS.map(url => 
            cache.add(url).catch(err => {
              console.warn(`[SW] Failed to cache ${url}:`, err.message);
              return null;
            })
          )
        );

        const successful = results.filter(r => r.status === 'fulfilled').length;
        console.log(`[SW ${SW_VERSION}] Cached ${successful}/${STATIC_ASSETS.length} static assets`);

        // Skip waiting to activate immediately
        await self.skipWaiting();
        
        console.log(`[SW ${SW_VERSION}] Installation complete`);
      } catch (error) {
        console.error(`[SW ${SW_VERSION}] Installation failed:`, error);
      }
    })()
  );
});

// ============================================
// ACTIVATE EVENT
// ============================================

self.addEventListener('activate', (event) => {
  console.log(`[SW ${SW_VERSION}] Activating...`);

  event.waitUntil(
    (async () => {
      try {
        // Clean up old caches
        const cacheNames = await caches.keys();
        const validCacheNames = Object.values(CACHE_NAMES);
        
        const deletedCaches = await Promise.all(
          cacheNames
            .filter(name => !validCacheNames.includes(name))
            .map(name => {
              console.log(`[SW] Deleting old cache: ${name}`);
              return caches.delete(name);
            })
        );

        console.log(`[SW ${SW_VERSION}] Deleted ${deletedCaches.filter(Boolean).length} old caches`);

        // Take control of all clients immediately
        await self.clients.claim();

        // Notify all clients that SW is ready
        const clients = await self.clients.matchAll({ type: 'window' });
        clients.forEach(client => {
          client.postMessage({
            type: 'SW_READY',
            payload: { version: SW_VERSION }
          });
        });

        console.log(`[SW ${SW_VERSION}] Activation complete`);
      } catch (error) {
        console.error(`[SW ${SW_VERSION}] Activation failed:`, error);
      }
    })()
  );
});

// ============================================
// FETCH EVENT - REQUEST INTERCEPTION
// ============================================

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip chrome-extension and other protocols
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // Determine strategy based on request type
  const strategy = getStrategyForRequest(request, url);

  event.respondWith(
    handleRequest(request, url, strategy)
      .catch(error => {
        console.error(`[SW] Fetch error for ${url.pathname}:`, error.message);
        return createErrorResponse(error, url);
      })
  );
});

// ============================================
// REQUEST HANDLING STRATEGIES
// ============================================

/**
 * Determine the appropriate caching strategy for a request
 */
function getStrategyForRequest(request, url) {
  // Static assets - Cache first
  if (ROUTE_PATTERNS.STATIC.test(url.pathname)) {
    return {
      strategy: CACHE_STRATEGIES.CACHE_FIRST,
      cacheName: CACHE_NAMES.STATIC,
      expiration: CACHE_EXPIRATION.STATIC
    };
  }

  // Images - Cache first with expiration
  if (ROUTE_PATTERNS.IMAGES.test(url.pathname)) {
    return {
      strategy: CACHE_STRATEGIES.CACHE_FIRST,
      cacheName: CACHE_NAMES.IMAGES,
      expiration: CACHE_EXPIRATION.IMAGES,
      maxEntries: CACHE_LIMITS.IMAGES
    };
  }

  // API calls - Network first
  if (ROUTE_PATTERNS.API.test(url.href)) {
    return {
      strategy: CACHE_STRATEGIES.NETWORK_FIRST,
      cacheName: CACHE_NAMES.API,
      expiration: CACHE_EXPIRATION.API,
      maxEntries: CACHE_LIMITS.API
    };
  }

  // Video segments - Cache first with short expiration
  if (ROUTE_PATTERNS.VIDEOS.test(url.pathname)) {
    return {
      strategy: CACHE_STRATEGIES.NETWORK_FIRST, // Videos should be fresh
      cacheName: CACHE_NAMES.VIDEOS,
      expiration: CACHE_EXPIRATION.VIDEOS,
      maxEntries: CACHE_LIMITS.VIDEOS
    };
  }

  // YouTube and streaming - Network only (don't cache streams)
  if (ROUTE_PATTERNS.YOUTUBE.test(url.href) || url.pathname.includes('.m3u8') || url.pathname.includes('.ts')) {
    return {
      strategy: CACHE_STRATEGIES.NETWORK_ONLY
    };
  }

  // Default - Stale while revalidate
  return {
    strategy: CACHE_STRATEGIES.STALE_WHILE_REVALIDATE,
    cacheName: CACHE_NAMES.DYNAMIC,
    expiration: CACHE_EXPIRATION.DYNAMIC,
    maxEntries: CACHE_LIMITS.DYNAMIC
  };
}

/**
 * Handle request based on strategy
 */
async function handleRequest(request, url, strategyConfig) {
  const { strategy, cacheName, expiration, maxEntries } = strategyConfig;

  switch (strategy) {
    case CACHE_STRATEGIES.CACHE_FIRST:
      return cacheFirst(request, cacheName, expiration, maxEntries);

    case CACHE_STRATEGIES.NETWORK_FIRST:
      return networkFirst(request, cacheName, expiration, maxEntries);

    case CACHE_STRATEGIES.STALE_WHILE_REVALIDATE:
      return staleWhileRevalidate(request, cacheName, expiration, maxEntries);

    case CACHE_STRATEGIES.CACHE_ONLY:
      return cacheOnly(request, cacheName);

    case CACHE_STRATEGIES.NETWORK_ONLY:
    default:
      return fetch(request);
  }
}

/**
 * Cache First Strategy
 * Serves from cache if available, falls back to network
 */
async function cacheFirst(request, cacheName, expiration, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  if (cached) {
    // Check if cached response is expired
    if (await isCacheExpired(cached, expiration)) {
      console.log(`[SW] Cache expired for ${request.url}`);
      // Delete expired cache
      await cache.delete(request);
    } else {
      return cached;
    }
  }

  // Fetch from network
  try {
    const response = await fetch(request);
    
    // Only cache successful responses
    if (response.ok) {
      await putInCache(cache, request, response.clone(), maxEntries);
    }
    
    return response;
  } catch (error) {
    // If network fails and we had an expired cache, return it anyway
    if (cached) {
      console.log(`[SW] Network failed, returning expired cache for ${request.url}`);
      return cached;
    }
    throw error;
  }
}

/**
 * Network First Strategy
 * Try network first, fall back to cache on failure
 */
async function networkFirst(request, cacheName, expiration, maxEntries) {
  try {
    const response = await fetch(request);
    
    // Cache successful responses
    if (response.ok) {
      const cache = await caches.open(cacheName);
      await putInCache(cache, request, response.clone(), maxEntries);
    }
    
    return response;
  } catch (error) {
    // Network failed, try cache
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    
    if (cached) {
      console.log(`[SW] Network failed, serving from cache: ${request.url}`);
      return cached;
    }
    
    throw error;
  }
}

/**
 * Stale While Revalidate Strategy
 * Return cached response immediately, update cache in background
 */
async function staleWhileRevalidate(request, cacheName, expiration, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  // Start network request (don't await)
  const fetchPromise = fetch(request)
    .then(async response => {
      if (response.ok) {
        await putInCache(cache, request, response.clone(), maxEntries);
      }
      return response;
    })
    .catch(err => {
      console.warn(`[SW] Background fetch failed for ${request.url}:`, err.message);
      return null;
    });

  // Return cached response immediately if available
  if (cached) {
    return cached;
  }

  // Otherwise wait for network
  return fetchPromise;
}

/**
 * Cache Only Strategy
 * Only serve from cache, never network
 */
async function cacheOnly(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  
  if (!cached) {
    throw new Error('No cached response available');
  }
  
  return cached;
}

/**
 * Put response in cache with size limit enforcement
 */
async function putInCache(cache, request, response, maxEntries) {
  try {
    // Check cache size limit
    if (maxEntries) {
      const keys = await cache.keys();
      if (keys.length >= maxEntries) {
        // Delete oldest entry (first key)
        await cache.delete(keys[0]);
      }
    }

    // Add timestamp header for expiration check
    const headers = new Headers(response.headers);
    headers.set('sw-cached-at', Date.now().toString());

    const newResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: headers
    });

    await cache.put(request, newResponse);
  } catch (error) {
    console.warn(`[SW] Failed to cache ${request.url}:`, error.message);
  }
}

/**
 * Check if cached response is expired
 */
async function isCacheExpired(response, maxAge) {
  if (!maxAge) return false;

  const cachedAt = response.headers.get('sw-cached-at');
  if (!cachedAt) return false;

  const age = Date.now() - parseInt(cachedAt, 10);
  return age > maxAge;
}

/**
 * Create error response
 */
function createErrorResponse(error, url) {
  // Return a simple error page for HTML requests
  if (url.pathname.endsWith('.html') || url.pathname === '/') {
    return new Response(
      `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Offline</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body {
              font-family: system-ui, -apple-system, sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              text-align: center;
              padding: 20px;
            }
            .container {
              max-width: 500px;
            }
            h1 {
              font-size: 4em;
              margin: 0;
            }
            p {
              font-size: 1.2em;
              margin: 20px 0;
            }
            button {
              background: white;
              color: #667eea;
              border: none;
              padding: 12px 24px;
              border-radius: 8px;
              font-size: 1em;
              font-weight: 600;
              cursor: pointer;
              margin-top: 20px;
            }
            button:hover {
              transform: scale(1.05);
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>📡</h1>
            <h2>You're Offline</h2>
            <p>Please check your internet connection and try again.</p>
            <button onclick="location.reload()">Retry</button>
          </div>
        </body>
      </html>
      `,
      {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'text/html' }
      }
    );
  }

  // Return empty response for other requests
  return new Response(null, { status: 503 });
}

// ============================================
// MESSAGE HANDLING
// ============================================

self.addEventListener('message', async (event) => {
  const { type, payload } = event.data || {};

  console.log(`[SW] Received message: ${type}`);

  try {
    switch (type) {
      case 'SKIP_WAITING':
        await handleSkipWaiting();
        break;

      case 'CLEAR_CACHE':
        await handleClearCache(event);
        break;

      case 'CLEAR_CACHE_TYPE':
        await handleClearCacheType(event, payload?.cacheType);
        break;

      case 'GET_CACHE_SIZE':
        await handleGetCacheSize(event);
        break;

      case 'GET_CACHE_STATS':
        await handleGetCacheStats(event);
        break;

      case 'PING':
        await handlePing(event);
        break;

      default:
        console.warn(`[SW] Unknown message type: ${type}`);
    }
  } catch (error) {
    console.error(`[SW] Message handler error:`, error);
    sendMessageToClient(event.source, {
      type: 'ERROR',
      payload: { message: error.message }
    });
  }
});

/**
 * Handle SKIP_WAITING message
 */
async function handleSkipWaiting() {
  console.log('[SW] Skipping waiting, activating new service worker...');
  await self.skipWaiting();
}

/**
 * Handle CLEAR_CACHE message
 */
async function handleClearCache(event) {
  console.log('[SW] Clearing all caches...');
  
  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map(name => caches.delete(name)));
  
  console.log(`[SW] Cleared ${cacheNames.length} caches`);
  
  sendMessageToClient(event.source, {
    type: 'CACHE_CLEARED',
    payload: { count: cacheNames.length }
  });
}

/**
 * Handle CLEAR_CACHE_TYPE message
 */
async function handleClearCacheType(event, cacheType) {
  const cacheName = CACHE_NAMES[cacheType?.toUpperCase()];
  
  if (!cacheName) {
    throw new Error(`Invalid cache type: ${cacheType}`);
  }

  console.log(`[SW] Clearing cache: ${cacheName}`);
  await caches.delete(cacheName);
  
  sendMessageToClient(event.source, {
    type: 'CACHE_CLEARED',
    payload: { cacheType, cacheName }
  });
}

/**
 * Handle GET_CACHE_SIZE message
 */
async function handleGetCacheSize(event) {
  const size = await calculateTotalCacheSize();
  
  sendMessageToClient(event.source, {
    type: 'CACHE_SIZE',
    payload: { 
      size: formatBytes(size),
      bytes: size 
    }
  });
}

/**
 * Handle GET_CACHE_STATS message
 */
async function handleGetCacheStats(event) {
  const stats = await getCacheStats();
  
  sendMessageToClient(event.source, {
    type: 'CACHE_STATS',
    payload: stats
  });
}

/**
 * Handle PING message
 */
async function handlePing(event) {
  sendMessageToClient(event.source, {
    type: 'PONG',
    payload: { 
      version: SW_VERSION,
      timestamp: Date.now()
    }
  });
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Send message to a specific client
 */
function sendMessageToClient(client, message) {
  if (client && client.postMessage) {
    client.postMessage(message);
  }
}

/**
 * Send message to all clients
 */
async function sendMessageToAllClients(message) {
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(client => sendMessageToClient(client, message));
}

/**
 * Calculate total cache size
 */
async function calculateTotalCacheSize() {
  let totalSize = 0;

  if (!self.caches) return totalSize;

  try {
    const cacheNames = await caches.keys();

    for (const cacheName of cacheNames) {
      const cache = await caches.open(cacheName);
      const requests = await cache.keys();

      for (const request of requests) {
        const response = await cache.match(request);
        if (response) {
          const blob = await response.blob();
          totalSize += blob.size;
        }
      }
    }
  } catch (error) {
    console.error('[SW] Error calculating cache size:', error);
  }

  return totalSize;
}

/**
 * Get cache statistics
 */
async function getCacheStats() {
  const stats = {};

  try {
    const cacheNames = await caches.keys();

    for (const cacheName of cacheNames) {
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      
      let size = 0;
      for (const request of keys) {
        const response = await cache.match(request);
        if (response) {
          const blob = await response.blob();
          size += blob.size;
        }
      }

      stats[cacheName] = {
        entries: keys.length,
        size: formatBytes(size),
        bytes: size
      };
    }
  } catch (error) {
    console.error('[SW] Error getting cache stats:', error);
  }

  return stats;
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

// ============================================
// BACKGROUND SYNC (Optional)
// ============================================

self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync:', event.tag);

  if (event.tag === 'sync-channels') {
    event.waitUntil(syncChannels());
  }
});

/**
 * Sync channels in background
 */
async function syncChannels() {
  try {
    console.log('[SW] Syncing channels...');
    
    // Notify clients that sync started
    await sendMessageToAllClients({
      type: 'SYNC_STARTED'
    });

    // Perform sync logic here
    // ...

    // Notify clients that sync completed
    await sendMessageToAllClients({
      type: 'SYNC_COMPLETED'
    });
  } catch (error) {
    console.error('[SW] Sync failed:', error);
    
    await sendMessageToAllClients({
      type: 'SYNC_FAILED',
      payload: { message: error.message }
    });
  }
}

// ============================================
// PUSH NOTIFICATIONS (Optional)
// ============================================

self.addEventListener('push', (event) => {
  console.log('[SW] Push notification received');

  const data = event.data?.json() || {};
  const title = data.title || 'IPTV Channel Manager';
  const options = {
    body: data.body || 'New content available',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: data,
    ...data.options
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked');
  
  event.notification.close();

  event.waitUntil(
    clients.openWindow(event.notification.data?.url || '/')
  );
});

// ============================================
// ERROR HANDLING
// ============================================

self.addEventListener('error', (event) => {
  console.error('[SW] Global error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('[SW] Unhandled rejection:', event.reason);
});

// ============================================
// LOGGING
// ============================================

console.log(`[SW ${SW_VERSION}] Service Worker loaded`);
