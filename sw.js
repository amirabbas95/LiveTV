// ============================================
// SERVICE WORKER - IPTV CHANNEL MANAGER
// ============================================

const SW_VERSION = '2.0.0';
const CACHE_NAME = `iptv-cache-v${SW_VERSION}`;

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

// ============================================
// INSTALL EVENT
// ============================================

self.addEventListener('install', (event) => {
  console.log(`[SW v${SW_VERSION}] Installing...`);
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// ============================================
// ACTIVATE EVENT
// ============================================

self.addEventListener('activate', (event) => {
  console.log(`[SW v${SW_VERSION}] Activating...`);
  
  event.waitUntil(
    Promise.all([
      // Clean up old caches
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(name => name !== CACHE_NAME)
            .map(name => caches.delete(name))
        );
      }),
      
      // Take control immediately
      self.clients.claim()
    ]).then(() => {
      // Notify all clients that SW is activated
      return self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(client => {
          client.postMessage({
            type: 'SW_READY',
            payload: { version: SW_VERSION }
          });
        });
      });
    })
  );
});

// ============================================
// FETCH EVENT
// ============================================

self.addEventListener('fetch', (event) => {
  const { request } = event;
  
  // Skip non-GET requests
  if (request.method !== 'GET') return;
  
  // Skip chrome-extension and other protocols
  if (!request.url.startsWith('http')) return;
  
  const url = new URL(request.url);
  
  // Special handling for HTML files - always try network first for updates
  if (url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(handleHtmlRequest(request));
    return;
  }
  
  // For static assets, use cache-first strategy
  event.respondWith(cacheFirst(request));
});

// ============================================
// CACHE STRATEGIES
// ============================================

// Handle HTML requests with network-first strategy
async function handleHtmlRequest(request) {
  try {
    // Try network first for fresh content
    const networkResponse = await fetch(request);
    
    // Update cache in background
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, networkResponse.clone());
    
    return networkResponse;
  } catch (error) {
    console.log('[SW] Network failed, trying cache for:', request.url);
    
    // Network failed, try cache
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // If offline and requested page not in cache, show offline.html
    // But don't show offline.html for the offline.html itself
    if (new URL(request.url).pathname !== '/offline.html') {
      const offlineResponse = await caches.match('/offline.html');
      if (offlineResponse) {
        return offlineResponse;
      }
    }
    
    // If everything fails, return a basic error
    return new Response('Network error and no cached content available', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

// Cache First for static assets
async function cacheFirst(request) {
  // Try cache first
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    // Try network
    const networkResponse = await fetch(request);
    
    // Cache successful responses (except video streams)
    if (networkResponse.ok && 
        !request.url.includes('.m3u8') && 
        !request.url.includes('.ts') &&
        !request.url.includes('youtube.com') &&
        !request.url.includes('googlevideo.com')) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    // For CSS/JS files, return empty response
    if (request.url.match(/\.(css|js)$/i)) {
      return new Response('', { 
        status: 404,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
    
    // For images, try to return a placeholder if available
    if (request.url.match(/\.(png|jpg|jpeg|gif|webp|svg|ico)$/i)) {
      const placeholder = await caches.match('/icon-192.png');
      if (placeholder) return placeholder;
    }
    
    throw error;
  }
}

// ============================================
// MESSAGE HANDLING
// ============================================

self.addEventListener('message', async (event) => {
  const { type } = event.data || {};
  
  console.log('[SW] Received message:', type);
  
  try {
    switch (type) {
      case 'SKIP_WAITING':
        await self.skipWaiting();
        break;
        
      case 'CLEAR_CACHE':
        await clearAllCaches();
        sendMessageToClient(event.source, { 
          type: 'CACHE_CLEARED',
          payload: { success: true }
        });
        break;
        
      case 'GET_CACHE_INFO':
        const info = await getCacheInfo();
        sendMessageToClient(event.source, {
          type: 'CACHE_INFO',
          payload: info
        });
        break;
        
      case 'PING':
        sendMessageToClient(event.source, {
          type: 'PONG',
          payload: { 
            version: SW_VERSION,
            timestamp: Date.now()
          }
        });
        break;
        
      case 'UPDATE_REQUESTED':
        // Force update and reload
        await self.skipWaiting();
        const clients = await self.clients.matchAll();
        clients.forEach(client => {
          client.postMessage({ type: 'RELOAD_PAGE' });
        });
        break;
    }
  } catch (error) {
    console.error('[SW] Message handler error:', error);
    sendMessageToClient(event.source, {
      type: 'ERROR',
      payload: { message: error.message }
    });
  }
});

// ============================================
// HELPER FUNCTIONS
// ============================================

async function clearAllCaches() {
  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map(name => caches.delete(name)));
  console.log('[SW] All caches cleared');
}

async function getCacheInfo() {
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  
  let totalSize = 0;
  const entries = [];
  
  for (const request of keys) {
    const response = await cache.match(request);
    if (response) {
      const blob = await response.blob();
      totalSize += blob.size;
      entries.push({
        url: request.url,
        size: blob.size
      });
    }
  }
  
  return {
    name: CACHE_NAME,
    version: SW_VERSION,
    entryCount: keys.length,
    totalSize: totalSize,
    formattedSize: formatBytes(totalSize),
    entries: entries
  };
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function sendMessageToClient(client, message) {
  if (client && client.postMessage) {
    client.postMessage(message);
  }
}

// ============================================
// UPDATE DETECTION
// ============================================

// This ensures that when SW updates, pages get reloaded
self.addEventListener('controllerchange', () => {
  console.log('[SW] New service worker activated');
  
  // Send message to all clients to reload
  self.clients.matchAll().then(clients => {
    clients.forEach(client => {
      client.postMessage({ type: 'SW_UPDATED' });
    });
  });
});

console.log(`[SW v${SW_VERSION}] Loaded`);