// ============================================
// IPTV CHANNEL MANAGER - ENHANCED VERSION
// Integrated Favorites & Recently Watched improvements
// ============================================


const DOUBLE_TAP_DELAY = 300;


class AppStateManager {
  constructor() {
    this.state = {
      channels: {
        all: [],
        filtered: [],
        searchQuery: ''
      },
      player: {
        instance: null,
        currentChannel: null,
        watchStartTime: 0,
        isPlaying: false
      },
      ui: {
        focusedIndex: 0,
        lastFocusedElement: null,
        sortMethod: 'none',
        isModalOpen: false,
        numberBuffer: '',
        touchStartX: 0,
        touchStartY: 0,
        touchEndX: 0,
        touchEndY: 0,
        lastTapTime: 0,
        doubleTapDelay: 300
      },
      cache: {
        rss: new Map(),
        live: new Map(),
        lastUpdate: 0
      },
      intervals: {
        watch: null,
        autoUpdate: null,
        overlayShow: null,
        overlayHide: null,
        promptTimeout: null,
        numberTimeout: null
      },
      settings: {
        isOnline: navigator.onLine,
        apiKey: '',
        isAutoUpdateEnabled: true,
        updateIntervalHours: 8
      },
      uiCollections: {
        allChannelItems: []
      }
    };
    this.subscribers = new Map();
    this.cleanupCallbacks = new Set();
  }


  get(path) {
    if (!path) return this.state;
    return path.split('.').reduce((o, k) => (o ? o[k] : undefined), this.state);
  }

  set(path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    let target = this.state;
    for (const k of keys) {
      if (!(k in target)) target[k] = {};
      target = target[k];
    }
    const old = target[last];
    target[last] = value;
    this.notify(path, value, old);
    return value;
  }

  merge(path, obj) {
    const cur = this.get(path) || {};
    this.set(path, Object.assign({}, cur, obj));
    return this.get(path);
  }

  subscribe(path, cb) {
    if (!this.subscribers.has(path)) this.subscribers.set(path, []);
    this.subscribers.get(path).push(cb);
    return () => {
      const arr = this.subscribers.get(path) || [];
      const i = arr.indexOf(cb);
      if (i !== -1) arr.splice(i, 1);
    };
  }

  notify(path, newVal, oldVal) {
    if (this.subscribers.has(path)) {
      for (const cb of [...this.subscribers.get(path)]) {
        try { cb(newVal, oldVal); } catch (e) { console.error(e); }
      }
    }
    const parts = path.split('.');
    while (parts.length > 1) {
      parts.pop();
      const p = parts.join('.');
      if (this.subscribers.has(p)) {
        for (const cb of [...this.subscribers.get(p)]) {
          try { cb(this.get(p)); } catch (e) { console.error(e); }
        }
      }
    }
  }

  // interval / timeout helpers (centralized)
  setIntervalRef(name, id) {
    const prev = this.get(`intervals.${name}`);
    if (prev) clearInterval(prev);
    this.set(`intervals.${name}`, id);
  }
  clearIntervalRef(name) {
    const id = this.get(`intervals.${name}`);
    if (id) { clearInterval(id); this.set(`intervals.${name}`, null); }
  }
  setTimeoutRef(name, id) {
    const prev = this.get(`intervals.${name}`);
    if (prev) clearTimeout(prev);
    this.set(`intervals.${name}`, id);
  }
  clearTimeoutRef(name) {
    const id = this.get(`intervals.${name}`);
    if (id) { clearTimeout(id); this.set(`intervals.${name}`, null); }
  }

  addCleanup(fn) {
    this.cleanupCallbacks.add(fn);
    return () => this.cleanupCallbacks.delete(fn);
  }

  reset(path) {
    if (path === 'intervals') {
      const ints = this.state.intervals;
      Object.values(ints).forEach(i => {
        if (i) {
          clearInterval(i);
          clearTimeout(i);
        }
      });
      this.state.intervals = {
        watch: null,
        autoUpdate: null,
        overlayShow: null,
        overlayHide: null,
        promptTimeout: null,
        numberTimeout: null
      };
    } else if (path === 'cache') {
      try {
        this.state.cache.rss.clear();
        this.state.cache.live.clear();
        this.state.cache.lastUpdate = 0;
      } catch (e) { }
    }
  }
  cleanup() {
    try {
      this.reset('intervals');
    } catch (e) { }
    try {
      this.reset('cache');
    } catch (e) { }
    for (const cb of [...this.cleanupCallbacks]) {
      try {
        cb();
      } catch (e) {
        console.warn(e);
      }
    }
    this.cleanupCallbacks.clear();
    this.subscribers.clear();
    this.set('player.instance', null);
  }
}

const appState = new AppStateManager();

// ============================================
// CONSTANTS & CONFIGURATION
// ============================================
const AUTO_UPDATE_KEY = "autoUpdateEnabled";
const UPDATE_INTERVAL_KEY = "updateIntervalHours";
const MAX_RECENT = 18;

let fullscreenPrompt = null;
let promptTimeout = null;
let hasUserInteracted = false;


// ✅ NEW: Improved localStorage keys with namespace
const LS_KEYS = {
  FAVORITES: "favorites",
  RECENT: "recentlyWatched",
  CHANNELS: "allChannelsData",
  LIVE: "liveChannelsData",
  FEEDS: "rssFeedsData",
  WATCH_TIME: "watchTimePerChannel",
};

const API_KEY_STORAGE_KEY = "youtube_api_key";
const CACHE_KEY = "lastChannelsUpdate";
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

const PLAYBACK_CONSTANTS = {
  MAX_ELEMENT_WAIT_TIME: 2000,
  PLAYER_READY_TIMEOUT: 5000,
  DOM_MUTATION_CHECK_INTERVAL: 50,
  YOUTUBE_READY_CHECK_INTERVAL: 100,
  TRANSITION_DELAY: 0,
};

const eventCleanupCallbacks = [];

// ✅ NEW: Debounce configuration
const DEBOUNCE_MS = 180;

// ============================================
// Utilities
// ============================================
function safeJSONParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch (e) {
    console.warn('JSON parse error:', e);
    return fallback;
  }
}

function readArray(key) {
  const raw = localStorage.getItem(key);
  const parsed = safeJSONParse(raw, null);
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Write array to localStorage safely
 */
function writeArray(key, arr) {
  try {
    localStorage.setItem(key, JSON.stringify(arr));
    return true;
  } catch (e) {
    console.error('localStorage write error', e);
    if (e.name === 'QuotaExceededError') {
      showNotification('Storage full - clearing old data', 'warning');
      clearOldStorageData();
      try {
        localStorage.setItem(key, JSON.stringify(arr));
        return true;
      } catch (e2) {
        console.error('Still failed after cleanup:', e2);
        return false;
      }
    }
    return false;
  }
}

// ============================================
// SAFE LOCALSTORAGE WRAPPER
// ============================================
function getActualStorageSize(str) {
  return new Blob([str]).size * 2; // UTF-16 = 2 bytes/char
}

function getAvailableSpace() {
  const MAX_BYTES = 5 * 1024 * 1024; // 5 MB quota
  const usage = getStorageUsage();   // { totalBytes, totalKB, totalMB, itemCount, items }

  if (!usage || typeof usage.totalBytes !== "number") {
    console.warn("⚠️ Storage usage unavailable.");
    return MAX_BYTES;
  }

  const available = MAX_BYTES - usage.totalBytes;
  return available > 0 ? available : 0;
}

/**
 * Safely sets data in localStorage with quota error handling
 * @param {string} key - Storage key
 * @param {string} value - Value to store (should be stringified JSON)
 * @param {boolean} retryOnFail - Whether to clear old data and retry
 * @returns {boolean} - Success status
 */
function safeLocalStorageSet(key, value, retryOnFail = true) {
  // ✅ Check storage before attempting to save

  const usage = getStorageUsage();
  const actualSize = getActualStorageSize(value);
  const available = getAvailableSpace();

  if (actualSize > available) {
    console.warn('⚠️ Insufficient storage space');
    if (retryOnFail) {
      clearOldStorageData();
      return safeLocalStorageSet(key, value, false);
    }
    showNotification('Storage full - please export your data', 'error');
    return false;
  }

  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      console.error('❌ Storage quota exceeded for key:', key);
      showNotification('Storage full. Clearing old data...', 'warning');

      if (retryOnFail) {
        // Clear non-critical data first
        clearOldStorageData();

        // Retry once
        try {
          localStorage.setItem(key, value);
          showNotification('✅ Data saved successfully', 'success');
          return true;
        } catch (e2) {
          console.error('❌ Still failed after cleanup:', e2);
          showNotification('❌ Storage full - please free up space', 'error');
          return false;
        }
      }
    } else {
      console.error('❌ Storage error:', e);
      showNotification('Failed to save data', 'error');
    }
    return false;
  }
}

// ============================================
// ✅ NEW: DEBOUNCE UTILITY
// ============================================

/**
 * Debounce function to limit rapid calls
 */
function debounce(fn, wait = DEBOUNCE_MS, options = {}) {
  let timeout;

  const debounced = function (...args) {
    const context = this; // Capture context
    clearTimeout(timeout);

    timeout = setTimeout(() => {
      fn.apply(context, args);
    }, wait);
  };

  debounced.cancel = () => clearTimeout(timeout);
  return debounced;
}

function getTimeAgo(timestamp) {
  const SECONDS_PER_MINUTE = 60;
  const MINUTES_PER_HOUR = 60;
  const HOURS_PER_DAY = 24;

  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < SECONDS_PER_MINUTE) {
    return "just now";
  }

  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  if (minutes < MINUTES_PER_HOUR) {
    return `${minutes} minute${minutes !== 1 ? "s" : ""} ago`;
  }

  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) {
    return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  }

  const days = Math.floor(hours / HOURS_PER_DAY);
  return `${days} day${days !== 1 ? "s" : ""} ago`;

}


// ============================================
// Notifications & error helpers
// ============================================
function showNotification(message, type = 'info') {
  const colors = {
    info: '#007BFF',
    success: '#28A745',
    warning: '#FFC107',
    error: '#DC3545'
  };

  const el = document.createElement('div');
  el.className = 'iptv-notification';
  el.style.cssText = `position:fixed;top:-100px;left:50%;transform:translateX(-50%);background:${colors[type] || colors.info};color:white;padding:10px 18px;border-radius:20px;z-index:10001;transition:top .4s,opacity .4s;font-weight:600;`;
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.style.top = '20px';
    el.style.opacity = '1';
  });
  setTimeout(() => {
    el.style.top = '-100px';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 400);
  }, 3000);
}

function showErrorToUser(message) {
  const errorDiv = document.createElement("div");
  errorDiv.className = "fixed top-4 right-4 bg-red-600 text-white p-4 rounded-lg shadow-lg z-50 max-w-sm animate-slide-in";
  errorDiv.innerHTML = `
<div class="flex items-start gap-3">
   <i class="fas fa-exclamation-circle text-2xl"></i>
   <div>
      <p class="font-semibold">Error</p>
      <p class="text-sm">${message}</p>
   </div>
   <button onclick="this.parentElement.parentElement.remove()" class="ml-auto">
   <i class="fas fa-times"></i>
   </button>
</div>
`;
  document.body.appendChild(errorDiv);
  setTimeout(() => {
    errorDiv.style.opacity = '0';
    setTimeout(() => errorDiv.remove(), 350);
  }, PLAYBACK_CONSTANTS.PLAYER_READY_TIMEOUT);
}



// ============================================
// Favorites & Recently Watched - unchanged semantics but now use appState
// ============================================

/**
 * Get all favorites with validation
 */
function getFavorites() {
  const favorites = readArray(LS_KEYS.FAVORITES);
  return favorites.filter(fav => fav && fav.url && fav.name);
}

/**
 * Check if channel is favorited
 */
function isFavorite(url) {
  if (!url) return false;
  return getFavorites().some(f => f.url === url);
}

/**
 * Add channel to favorites
 */
function addFavorite(channelData) {
  if (!channelData || !channelData.url) return false;
  const favs = getFavorites();
  if (favs.some(f => f.url === channelData.url)) return false;
  favs.unshift({
    name: channelData.name,
    url: channelData.url,
    image: channelData.image,
    description: channelData.description,
    number: channelData.number,
    isLive: channelData.isLive,
    category: channelData.category || "Unknown",
    addedAt: Date.now()
  });
  const ok = writeArray(LS_KEYS.FAVORITES, favs);
  if (ok) dispatchStorageUpdate('favorites');
  return ok;
}

/**
 * Remove channel from favorites
 */
function removeFavorite(url) {
  if (!url) return false;
  const favs = getFavorites();
  const newFavs = favs.filter(f => f.url !== url);
  if (newFavs.length === favs.length) return false;
  const ok = writeArray(LS_KEYS.FAVORITES, newFavs);
  if (ok) dispatchStorageUpdate('favorites');
  return ok;
}

/**
 * Toggle favorite status
 */
function toggleFavoriteStatus(channelData) {
  if (!channelData || !channelData.url) return false;
  return isFavorite(channelData.url) ? removeFavorite(channelData.url) : addFavorite(channelData);
}
function clearAllFavorites() { const ok = writeArray(LS_KEYS.FAVORITES, []); if (ok) dispatchStorageUpdate('favorites'); return ok; }

/**
 * Get recently watched channels with timestamp validation
 */
function getRecentlyWatched() {
  const raw = readArray(LS_KEYS.RECENT);
  return raw.map(item => {
    if (typeof item === 'string') return {
      url: item,
      watchedAt: 0
    };
    if (item && item.url) return {
      ...item,
      watchedAt: item.watchedAt || item.at || 0
    };
    return null;
  }).filter(Boolean);
}
/**
 * Add channel to recently watched (with debounce)
 */
function addToRecentlyWatched(channelData, opts = {}) {
  if (!channelData || !channelData.url) return false;

  const timestamp = opts.timestamp ?? Date.now();
  let recent = getRecentlyWatched();

  // Remove if already exists
  recent = recent.filter(r => r.url !== channelData.url);

  // Add to beginning with timestamp
  recent.unshift({
    name: channelData.name,
    url: channelData.url,
    image: channelData.image,
    description: channelData.description,
    number: channelData.number,
    isLive: channelData.isLive,
    category: channelData.category || "Unknown",
    watchedAt: timestamp
  });

  // Keep only MAX_RECENT items
  recent = recent.slice(0, MAX_RECENT);
  const ok = writeArray(LS_KEYS.RECENT, recent);
  if (ok) dispatchStorageUpdate('recent');
  return ok;
}
/**
 * Debounced version of addToRecentlyWatched
 */
const debouncedAddRecent = debounce(ch => addToRecentlyWatched(ch), DEBOUNCE_MS);

/**
 * Remove channel from recently watched
 */
function removeFromRecentlyWatched(url) {
  if (!url) return false;
  const recent = getRecentlyWatched();
  const filtered = recent.filter(r => r.url !== url);
  if (filtered.length === recent.length) return false;
  const ok = writeArray(LS_KEYS.RECENT, filtered);
  if (ok) dispatchStorageUpdate('recent');
  return ok;
}

/**
 * Clear all recently watched
 */
function clearRecentlyWatched() {
  const ok = writeArray(LS_KEYS.RECENT, []);
  if (ok) dispatchStorageUpdate('recent');
  return ok;
}

function saveRecentlyWatched(channel) {
  debouncedAddRecent(channel);
}

/**
 * Wrapper functions for backward compatibility
 */

function toggleFavorite(url, name, image, description, number, isLive, category, event) {
  if (event) event.stopPropagation();
  const ch = {
    url,
    name,
    image,
    description,
    number,
    isLive,
    category: category || "Unknown"
  };
  const success = toggleFavoriteStatus(ch);
  if (success) {
    setTimeout(() => {
      renderFavorites();
      updateFavoriteIcons();
      updateAllChannelItems();
    }, PLAYBACK_CONSTANTS.DOM_MUTATION_CHECK_INTERVAL);
  } else {
    showNotification('Failed to update favorite', 'error');
  }
}
/**
 * Dispatch custom event for storage updates
 */
// Cross-tab sync helpers
function dispatchStorageUpdate(type) {
  try {
    window.dispatchEvent(new CustomEvent('iptv-storage-updated', {
      detail: {
        type
      }
    }));
  } catch (e) { }
}

/**
 * Handle storage updates (same tab + other tabs)
 */
window.addEventListener('storage', (e) => {
  if (!e) return;
  if (e.key === LS_KEYS.FAVORITES) dispatchStorageUpdate('favorites');
  if (e.key === LS_KEYS.RECENT) dispatchStorageUpdate('recent');
});

window.addEventListener('iptv-storage-updated', (e) => {
  const type = e?.detail?.type;
  if (!type) {
    renderFavorites();
    renderRecentlyWatched();
    updateFavoriteIcons();
    return;
  }
  if (type === 'favorites') {
    renderFavorites();
    updateFavoriteIcons();
  }
  if (type === 'recent') {
    renderRecentlyWatched();
  }
});


// ============================================
// Cancellation token used during async ops
// ============================================
class CancellationToken {
  constructor() {
    this.cancelled = false;
    this.reason = null;
  }
  cancel(reason = 'Operation cancelled') {
    this.cancelled = true;
    this.reason = reason;
  }
  throwIfCancelled() {
    if (this.cancelled) throw new Error(this.reason || 'Cancelled');
  }
  isCancelled() {
    return this.cancelled;
  }
}

// ============================================
// ChannelLoader: manages player lifecycle, events, and cleanup
// ============================================
class ChannelLoader {
  constructor() {
    this.currentOperation = null;
    this.playerInstance = null;
    this.eventCleanupCallbacks = [];
    appState.addCleanup(() => this.cleanupPlayer(true));
  }

  async loadChannel(url, name, image, description, number, isLive) {
    if (!url) return;
    if (this.currentOperation) this.currentOperation.cancel('New channel selected');
    const token = new CancellationToken();
    this.currentOperation = token;

    const operationId = Date.now() + Math.random();
    this.currentOperationId = operationId;

    // Before critical operations, verify we're still current:
    if (this.currentOperationId !== operationId) {
      throw new Error('Operation superseded');
    }



    console.log(`🚀 Loading channel: ${name}`, {
      url,
      timestamp: new Date().toISOString(),
    });
    try {
      this.updateChannelUI(name, image, description, number);
      token.throwIfCancelled();
      await this.cleanupPlayer();
      token.throwIfCancelled();
      await this.initializePlayer(url, name, isLive, token);
      token.throwIfCancelled();
      appState.set('player.currentChannel', { url, name, image, description, number, isLive });
      appState.set('player.isPlaying', true);
      appState.set('ui.isModalOpen', true);
    } catch (err) {
      if (!token.isCancelled()) {
        console.error(`❌ Failed to load channel ${name}:`, err);
        showErrorToUser(`Failed to load ${name}: ${err.message}`);
      } else {
        console.log(`⭕️ Channel load cancelled: ${name} - ${err.message}`);
      }
    } finally {
      if (this.currentOperation === token) this.currentOperation = null;
    }
  }



  updateChannelUI(name, image, description, number) {
    const map = {
      'content-image': (el) => el.src = fixImageUrl(image),
      'video-title': (el) => el.textContent = name || 'Unknown Channel',
      'channel-description': (el) => el.textContent = description || '',
      'channel-number': (el) => el.textContent = number ? `${number}.` : '',
      'video-quality': (el) => el.textContent = ''
    };
    for (const id in map) {
      const el = document.getElementById(id);
      if (el) {
        try { map[id](el); } catch (e) { console.warn(e); }
      }
    }
    appState.set('ui.lastFocusedElement', document.activeElement);
  }

  async cleanupPlayer(skipStateReset = false) {
    // stop watching
    stopWatching();

    // run registered cleanup callbacks
    this.eventCleanupCallbacks.forEach(fn => {
      try {
        console.log('🧹 Cleaning up existing player...');
        fn();
      } catch (e) {
        console.warn(e);
      }
    });

    this.eventCleanupCallbacks = [];

    if (this.playerInstance) {
      try {
        try {
          this.playerInstance.off && this.playerInstance.off();
        } catch (e) { }
        try {
          this.playerInstance.pause && this.playerInstance.pause();
        } catch (e) { }
        const id = this.playerInstance.id ? this.playerInstance.id() : null;
        try {
          this.playerInstance.dispose && this.playerInstance.dispose();
        } catch (e) { }
        this.playerInstance = null;
        if (id) {
          const el = document.getElementById(id);
          if (el && el.parentNode) el.parentNode.removeChild(el);
        }
      } catch (e) {
        console.warn('⚠️ Error during cleanupPlayer:', e);
        this.playerInstance = null;
      }
    }

    // remove orphaned DOM nodes inside player container
    const container = document.getElementById('player-container');
    if (container) {
      container.querySelectorAll('video, .video-js, .play-fallback-overlay').forEach(el => {
        try {
          if (el.parentNode) el.parentNode.removeChild(el);
        } catch (e) { }
      });
    }

    if (!skipStateReset) {
      appState.set('player.instance', null);
      appState.set('player.currentChannel', null);
      appState.set('player.isPlaying', false);
    }
  }

  async initializePlayer(url, name, isLive, token) {
    const container = await this.waitForElement('player-container');
    token.throwIfCancelled();

    const streamConfig = createStreamConfig(url);
    const metadata = { isLive: !!isLive };

    const videoId = `player-${Date.now()}`;
    const videoElement = this.createVideoElement(videoId);
    container.innerHTML = '';
    container.appendChild(videoElement);
    await this.waitForElement(videoId);
    token.throwIfCancelled();

    const playerConfig = buildPlayerOptions(streamConfig, metadata);
    console.log('🎬 Initializing Video.js player...');
    try {
      this.playerInstance = videojs(videoElement, playerConfig);
    } catch (e) {
      console.error('Player init failed', e);
      throw e;
    }

    appState.set('player.instance', this.playerInstance);

    // hls error recovery if available
    this.setupHLSErrorRecovery();

    this.setupPlayerEvents(name, metadata, streamConfig.type === 'youtube', token);
    if (streamConfig.type === 'youtube') this.setupYouTubeQualityMonitoring(token);

    await this.waitForPlayerReady(token);
    token.throwIfCancelled();



    showChannelInfoOverlay();
    await this.attemptAutoplay();

    this.setupFullscreenCloseButton();
  }

  setupHLSErrorRecovery() {
    if (!this.playerInstance) return;
    try {
      const tech = this.playerInstance.tech ? this.playerInstance.tech({ IWillNotUseThisInPlugins: true }) : null;
      if (!tech || !tech.vhs) return;
      let errorCount = 0;
      const maxErrors = 3;
      const vhsErrorHandler = () => {
        errorCount++;
        console.warn(`⚠️ HLS error detected (${errorCount}/${maxErrors})`);
        if (errorCount < maxErrors) {
          setTimeout(() => {
            try { tech.vhs.playlists.trigger('loadedplaylist'); } catch (e) { }
          }, 1000);
        } else {
          console.error('Max HLS errors reached');
        }
      };
      tech.vhs.on('error', vhsErrorHandler);
      this.eventCleanupCallbacks.push(() => {
        try { if (tech && tech.vhs) tech.vhs.off('error', vhsErrorHandler); } catch (e) { }
      });
    } catch (e) { console.warn(e); }
  }



  createVideoElement(id) {
    const video = document.createElement('video');
    video.id = id;
    video.className = 'video-js vjs-default-skin';
    video.controls = false;
    video.preload = 'auto';
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('crossorigin', 'anonymous');
    return video;
  }

  waitForElement(id) {
    return new Promise((resolve, reject) => {
      const existing = document.getElementById(id);
      if (existing) return resolve(existing);
      const obs = new MutationObserver(() => {
        const el = document.getElementById(id);
        if (el) {
          obs.disconnect();
          clearTimeout(tid);
          resolve(el);
        }
      });
      obs.observe(document.body, {
        childList: true,
        subtree: true
      });
      const tid = setTimeout(() => {
        obs.disconnect();
        reject(new Error(`Element ${id} not found`));
      }, PLAYBACK_CONSTANTS.MAX_ELEMENT_WAIT_TIME);
    });
  }


  waitForPlayerReady(token) {
    return new Promise((resolve, reject) => {
      if (!this.playerInstance) return reject(new Error('No player instance'));
      let done = false;
      const timeoutId = setTimeout(() => {
        if (!done) { done = true; reject(new Error('Player ready timeout')); }
      }, PLAYBACK_CONSTANTS.PLAYER_READY_TIMEOUT);

      this.playerInstance.ready(() => {
        if (done) return;
        clearTimeout(timeoutId);
        if (token.isCancelled()) { done = true; return reject(new Error('Cancelled')); }
        done = true; resolve();
      });

      this.playerInstance.one && this.playerInstance.one('error', () => {
        if (done) return;
        clearTimeout(timeoutId);
        done = true;
        const err = this.playerInstance.error ? this.playerInstance.error() : null;
        reject(new Error(`Player error init: ${err ? err.code : 'unknown'}`));
      });
    });
  }

  async attemptAutoplay() {
    if (!this.playerInstance) return;
    try {
      const p = this.playerInstance.play();
      if (p !== undefined) await p;
    } catch (e) {
      console.warn('⚠️ Autoplay blocked:', e.message || e);
      this.showPlayButton();
    }
  }

  setupPlayerEvents(channel, isLive, isYouTube, token) {
    if (!this.playerInstance) return;
    try {
      this.playerInstance.off && this.playerInstance.off();
    } catch (e) { }

    const errorHandler = () => {
      if (token.isCancelled()) return;
      const error = this.playerInstance.error();
      console.error('🚨 Player error details:', {
        code: error?.code,
        message: error?.message,
        type: error?.type,
        metadata: error?.metadata
      });
      if (error) {
        switch (error.code) {
          case 1:
            console.warn('⚠️ Media loading aborted');
            break;
          case 2:
            console.warn('⚠️ Network error - attempting recovery...');
            setTimeout(() => {
              if (this.playerInstance && !token.isCancelled()) {
                console.log('🔄 Attempting to reload stream...');
                const currentSrc = this.playerInstance.currentSrc();
                this.playerInstance.src(currentSrc);
                this.playerInstance.play().catch(e => {
                  console.error('❌ Reload failed:', e);
                  showErrorToUser('Stream failed to load. Please try again.');
                });
              }
            }, PLAYBACK_CONSTANTS.MAX_ELEMENT_WAIT_TIME);
            return;
          case 3:
            console.error('❌ Decoding error - stream format issue');
            showErrorToUser('Stream format not supported');
            break;
          case 4:
            console.error('❌ Source not supported');
            showErrorToUser('Stream format not supported');
            break;
          default:
            console.error('❌ Unknown player error:', error.code);
        }
      }
      stopWatching();
    };
    const waitingHandler = () => {
      if (token.isCancelled()) return;
      console.log('⏱ Buffering...');
    };
    const playingHandler = () => {
      if (token.isCancelled()) return;
      startWatching(channel);
    };
    const pauseHandler = () => {
      if (token.isCancelled()) return;
      stopWatching();
    };
    const endedHandler = () => {
      if (token.isCancelled()) return;
      console.log('ℹ️ Playback ended');
      stopWatching();
    };
    const metadataHandler = () => {
      if (token.isCancelled()) return;
      try { this.updateQualityDisplay && this.updateQualityDisplay(); } catch (e) { }
      const channelLive = isLive === true || isLive === 'true';
      if (!channelLive && !isYouTube) { try { this.playerInstance.controls(true); } catch (e) { } } else { try { this.playerInstance.controls(false); } catch (e) { } }
    };

    this.playerInstance.on && this.playerInstance.on('error', errorHandler);
    this.playerInstance.on && this.playerInstance.on('waiting', waitingHandler);
    this.playerInstance.on && this.playerInstance.on('playing', playingHandler);
    this.playerInstance.on && this.playerInstance.on('pause', pauseHandler);
    this.playerInstance.on && this.playerInstance.on('ended', endedHandler);
    this.playerInstance.on && this.playerInstance.on('loadedmetadata', metadataHandler);
    this.playerInstance.on && this.playerInstance.on('retryplaylist', () => console.log('🔄 Attempting HLS recovery...'));


    this.eventCleanupCallbacks.push(() => {
      try {
        if (!this.playerInstance) return;
        this.playerInstance.off && this.playerInstance.off('error', errorHandler);
        this.playerInstance.off && this.playerInstance.off('waiting', waitingHandler);
        this.playerInstance.off && this.playerInstance.off('playing', playingHandler);
        this.playerInstance.off && this.playerInstance.off('pause', pauseHandler);
        this.playerInstance.off && this.playerInstance.off('ended', endedHandler);
        this.playerInstance.off && this.playerInstance.off('loadedmetadata', metadataHandler);
      } catch (e) { console.warn(e); }
    });
  }

  setupYouTubeQualityMonitoring(token) {
    let attempts = 0;
    const maxAttempts = 30;
    const check = () => {
      if (token.isCancelled()) return;
      attempts++;
      if (attempts > maxAttempts) return;
      try {
        const tech = this.playerInstance.tech && this.playerInstance.tech({ IWillNotUseThisInPlugins: true });
        if (!tech || !tech.ytPlayer) return setTimeout(check, PLAYBACK_CONSTANTS.YOUTUBE_READY_CHECK_INTERVAL);
        const qualityChangeHandler = (event) => {
          const qEl = document.getElementById('video-quality');
          if (qEl) qEl.textContent = event.data || 'auto';
        };
        try { tech.ytPlayer.addEventListener('onPlaybackQualityChange', qualityChangeHandler); } catch (e) { }
        this.eventCleanupCallbacks.push(() => {
          try { if (tech && tech.ytPlayer) tech.ytPlayer.removeEventListener('onPlaybackQualityChange', qualityChangeHandler); } catch (e) { }
        });
      } catch (e) { console.warn(e); setTimeout(check, PLAYBACK_CONSTANTS.YOUTUBE_READY_CHECK_INTERVAL); }
    };
    check();
  }

  updateQualityDisplay() {
    if (!this.playerInstance) return;
    const qEl = document.getElementById('video-quality');
    if (!qEl) return;
    try {
      const h = this.playerInstance.videoHeight ? this.playerInstance.videoHeight() : 0;
      qEl.textContent = h ? `${h}p` : 'Auto';
    } catch (e) { }
  }

  showPlayButton() {
    const existing = document.querySelector('.play-fallback-overlay');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    const overlay = document.createElement('div');
    overlay.className = 'play-fallback-overlay';
    overlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);z-index:100;cursor:pointer;';
    const button = document.createElement('button');
    button.className = 'play-button';
    button.textContent = '▶️ Click to Play';
    button.style.cssText = 'padding:12px 20px;background:#e74c3c;color:#fff;border-radius:8px;border:0;font-weight:700;font-size:16px;cursor:pointer;';
    overlay.appendChild(button);
    const clickHandler = async (e) => {
      e.stopPropagation();
      if (!this.playerInstance) return;
      try {
        await this.playerInstance.play();
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      } catch (err) {
        showErrorToUser('Could not start playback');
      }
    };
    overlay.addEventListener('click', clickHandler);
    const container = document.getElementById('player-container');
    if (container) container.appendChild(overlay);
    this.eventCleanupCallbacks.push(() => {
      try {
        overlay.removeEventListener('click', clickHandler);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      } catch (e) { }
    });
  }

  cleanupEventListeners() {
    this.eventCleanupCallbacks.forEach(fn => {
      try {
        fn();
      } catch (e) {
        console.warn(e);
      }
    });
    this.eventCleanupCallbacks = [];
  }

  getPlayer() { return this.playerInstance; }
  /**
     * Sets up a dynamic close button that appears ONLY when the player is in Video.js fullscreen mode.
     * This is necessary because Video.js creates a new stacking context that overlays the main modal's close button.
     */
  setupFullscreenCloseButton() {
    if (!this.playerInstance) return;
    try {
      const playerEl = this.playerInstance.el ? this.playerInstance.el() : null;
      if (!playerEl) return;
      const closeBtn = document.createElement('button');
      closeBtn.id = 'fullscreenCloseBtn';
      closeBtn.className = 'fullscreen-close-button';
      closeBtn.innerHTML = '<i class="fas fa-compress"></i>';
      closeBtn.style.display = 'none';
      closeBtn.onclick = () => toggleFullscreen();
      playerEl.appendChild(closeBtn);
      const update = () => {
        try {
          closeBtn.style.display = (this.playerInstance && this.playerInstance.isFullscreen && this.playerInstance.isFullscreen()) ? 'flex' : 'none';
        } catch (e) {
          closeBtn.style.display = 'none';
        }
      };
      this.playerInstance.on && this.playerInstance.on('fullscreenchange', update);
      document.addEventListener('fullscreenchange', update);
      this.eventCleanupCallbacks.push(() => {
        try {
          this.playerInstance.off && this.playerInstance.off('fullscreenchange', update);
          document.removeEventListener('fullscreenchange', update);
          closeBtn.remove();
        } catch (e) { }
      });
    } catch (e) {
      console.warn(e);
    }
  }
}


const channelLoader = new ChannelLoader();

// ============================================
// Stream helpers (YouTube ID extraction, config, player options)
// ============================================

function extractYouTubeID(url) {
  if (!url) return null;
  const match = url.match(/(?:youtube\.com\/(?:.*v=|live\/|embed\/)|youtu\.be\/)([^&?/]+)/i);
  return match ? match[1] : null;
}


// ============================================
// Settings helpers (API key, modals)
// ============================================

function saveAPIKey(apiKey) {
  if (!apiKey || !apiKey.trim()) return false;
  try {
    const enc = btoa(btoa(apiKey.trim()));
    localStorage.setItem(API_KEY_STORAGE_KEY, enc);
    appState.set('settings.apiKey', apiKey.trim());
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

function getStoredAPIKey() {
  const enc = localStorage.getItem(API_KEY_STORAGE_KEY);
  if (!enc) return null;
  try {
    const key = atob(atob(enc));
    appState.set('settings.apiKey', key);
    return key;
  } catch (e) {
    return null;
  }
}

function hasValidAPIKey() {
  const storedKey = getStoredAPIKey();
  return storedKey && storedKey.length > 10;
}

function clearAPIKey() {
  localStorage.removeItem(API_KEY_STORAGE_KEY);
  appState.set('settings.apiKey', '');
}

// ============================================
// STREAM CONFIGURATION
// ============================================

function createStreamConfig(url) {
  const youtubeID = extractYouTubeID(url);
  if (youtubeID) return {
    type: 'youtube',
    techOrder: ['youtube'],
    source: {
      src: url,
      type: 'video/youtube'
    }
  };

  if (window.location.protocol === 'https:' && url.startsWith('http://')) {
    console.error(`❌ Mixed Content Error: Cannot load HTTP stream on HTTPS page`);
    console.log(`Stream URL: ${url}`);
    setTimeout(() => {
      showErrorToUser('⚠️ This stream uses HTTP and cannot be played on this HTTPS site. Please contact the stream provider for an HTTPS URL.');
    }, 500);
    return {
      type: 'hls',
      techOrder: ['html5'],
      source: {
        src: '',
        type: "application/x-mpegURL"
      }
    };
  }
  if (url.includes('imarkaz')) {
    return {
      type: 'mp4',
      techOrder: ['html5'],
      source: {
        src: url,
        type: "video/mp4"
      }
    };
  }
  const ext = url.split('?')[0].split('.').pop().toLowerCase();
  switch (ext) {
    case 'mp4':
    case 'webm':
      return {
        type: 'mp4',
        techOrder: ['html5'],
        source: {
          src: url,
          type: `video/${ext}`
        }
      };
    case 'm3u8':
      return {
        type: 'hls',
        techOrder: ['html5'],
        source: {
          src: url,
          type: "application/x-mpegURL"
        }
      };
    case 'mpd':
      return {
        type: 'dash',
        techOrder: ['html5'],
        source: {
          src: url,
          type: "application/dash+xml"
        }
      };
    default:
      console.warn('Unknown stream type, defaulting to HLS:', url);
      return {
        type: 'hls',
        techOrder: ['html5'],
        source: {
          src: url,
          type: "application/x-mpegURL"
        }
      };
  }
}

function buildPlayerOptions(streamConfig, metadata) {
  const baseOptions = {
    autoplay: true,
    controls: false,
    preload: 'auto',
    fluid: true,
    liveui: metadata.isLive,
    responsive: true,
    techOrder: streamConfig.techOrder,
    sources: [streamConfig.source],
    playbackRates: [0.5, 1, 1.25, 1.5, 2],
    loadingSpinner: true,
    errorDisplay: false,
    html5: {
      nativeTextTracks: false,
      preloadTextTracks: false
    }
  };
  if (streamConfig.type === 'youtube') {
    baseOptions.youtube = {
      ytControls: true,
      playerVars: {
        autoplay: 1,
        playsinline: 1,
        controls: 1,
        mute: 0,
        rel: 0,
        modestbranding: 1,
        iv_load_policy: 3,
        enablejsapi: 1,
        origin: window.location.origin
      }
    };
  }
  if (streamConfig.type === 'hls') {
    baseOptions.html5 = {
      vhs: {
        overrideNative: true,
        enableLowInitialPlaylist: true,
        smoothQualityChange: true,
        maxPlaylistRetries: 5,
        playlistRefreshInterval: 30000,
        maxBufferLength: 30,
        maxBufferSize: 60 * 1024 * 1024,
        bufferBehind: 30
      },
      nativeAudioTracks: false,
      nativeVideoTracks: false
    };
  }
  if (streamConfig.type === 'dash') {
    baseOptions.html5 = baseOptions.html5 || {};
    baseOptions.html5.vhs = {
      ...baseOptions.html5.vhs,
      overrideNative: true,
      withCredentials: false
    };
  }
  return baseOptions;
}

// ============================================
// Public selection wrapper
// ============================================

async function selectChannel(url, name, image, description, number, isLive) {
  if (!url) return;
  await channelLoader.loadChannel(url, name, image, description, number, isLive);
  debouncedAddRecent({
    name,
    url,
    image,
    description,
    number,
    isLive
  });
}


// ============================================
// Overlay / modal / fullscreen helpers
// ============================================
function showChannelInfoOverlay() {
  const overlay = document.getElementById('channel-info-overlay');
  if (!overlay) return;
  const modal = document.getElementById('videoModal');
  if (modal) { modal.style.display = 'flex'; modal.classList.remove('hidden'); }
  overlay.classList.remove('show');
  appState.clearTimeoutRef('overlayShow');
  appState.clearTimeoutRef('overlayHide');
  const sid = setTimeout(() => overlay.classList.add('show'), 300);
  const hid = setTimeout(() => overlay.classList.remove('show'), 6000);
  appState.setTimeoutRef('overlayShow', sid);
  appState.setTimeoutRef('overlayHide', hid);
}

function closeModal() {
  const modal = document.getElementById('videoModal');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.add('hidden');
  }
  channelLoader.cleanupPlayer().catch(e => console.warn(console.warn('⚠️ Error during player cleanup:', e)));
  renderRecentlyWatched();
  updateAllChannelItems();
  const lastFocused = appState.get('ui.lastFocusedElement');
  const items = appState.get('uiCollections.allChannelItems') || [];
  if (lastFocused && lastFocused.isConnected) {
    try {
      lastFocused.focus();
    } catch (e) { }
    appState.set('ui.focusedIndex', items.indexOf(lastFocused));
  } else if (items.length > 0) {
    try {
      items[0].focus();
    } catch (e) { }
    appState.set('ui.focusedIndex', 0);
  }
  appState.set('ui.isModalOpen', false);
  appState.set('player.currentChannel', null);
}

/**
 * Show enhanced fullscreen prompt with controls for mobile users
 */
function showFullscreenPrompt() {
  removeFullscreenPrompt();
  const modal = document.getElementById('videoModal');
  if (!modal || modal.style.display !== 'flex') return;
  fullscreenPrompt = document.createElement('div');
  fullscreenPrompt.className = 'minimal-fullscreen-prompt';
  fullscreenPrompt.innerHTML = `
    <div class="prompt-backdrop">
      <div class="prompt-card">
        <div class="prompt-header">
          <div class="prompt-icon"><i class="fas fa-expand"></i></div>
          <div class="prompt-text"><span>Video Controls</span></div>
          <button class="prompt-close"><i class="fas fa-times"></i></button>
        </div>
        <div class="prompt-controls">
          <button class="control-btn" id="promptPrevBtn" title="Previous Channel"><i class="fas fa-step-backward"></i><span>Previous</span></button>
          <button class="control-btn control-btn-primary" id="promptFullscreenBtn" title="Toggle Fullscreen"><i class="fas fa-expand"></i><span>Fullscreen</span></button>
          <button class="control-btn" id="promptNextBtn" title="Next Channel"><i class="fas fa-step-forward"></i><span>Next</span></button>
        </div>
      </div>
    </div>`;
  modal.appendChild(fullscreenPrompt);

  const prevBtn = fullscreenPrompt.querySelector('#promptPrevBtn');
  const nextBtn = fullscreenPrompt.querySelector('#promptNextBtn');
  const fsBtn = fullscreenPrompt.querySelector('#promptFullscreenBtn');
  const closeBtn = fullscreenPrompt.querySelector('.prompt-close');

  const prevHandler = (e) => {
    e.stopPropagation();
    navigateToPreviousChannel();
    removeFullscreenPrompt();
  };
  const nextHandler = (e) => {
    e.stopPropagation();
    navigateToNextChannel();
    removeFullscreenPrompt();
  };
  const fsHandler = (e) => {
    e.stopPropagation();
    toggleFullscreen();
    removeFullscreenPrompt();
  };
  const closeHandler = (e) => {
    e.stopPropagation();
    removeFullscreenPrompt();
  };

  prevBtn && prevBtn.addEventListener('click', prevHandler);
  nextBtn && nextBtn.addEventListener('click', nextHandler);
  fsBtn && fsBtn.addEventListener('click', fsHandler);
  closeBtn && closeBtn.addEventListener('click', closeHandler);

  appState.clearTimeoutRef('promptTimeout');
  const tid = setTimeout(() => removeFullscreenPrompt(), 8000);
  appState.setTimeoutRef('promptTimeout', tid);

  appState.addCleanup(() => {
    prevBtn && prevBtn.removeEventListener('click', prevHandler);
    nextBtn && nextBtn.removeEventListener('click', nextHandler);
    fsBtn && fsBtn.removeEventListener('click', fsHandler);
    closeBtn && closeBtn.removeEventListener('click', closeHandler);
    if (fullscreenPrompt && fullscreenPrompt.parentNode) fullscreenPrompt.parentNode.removeChild(fullscreenPrompt);
    fullscreenPrompt = null;
  });
}

/**
 * Remove fullscreen prompt with smooth animation
 */
function removeFullscreenPrompt() {
  if (fullscreenPrompt) {
    fullscreenPrompt.classList.add('fade-out');
    hasUserInteracted = true;
    setTimeout(() => {
      if (fullscreenPrompt && fullscreenPrompt.parentNode) fullscreenPrompt.parentNode.removeChild(fullscreenPrompt);
      fullscreenPrompt = null;
    }, 250);
  }
  appState.clearTimeoutRef('promptTimeout');
}



function toggleFullscreen() {
  const player = channelLoader.getPlayer();
  const modal = document.getElementById('videoModal');

  if (!player || !modal || modal.style.display !== 'flex') return;

  hasUserInteracted = true;
  const isFs = player.isFullscreen ? player.isFullscreen() : false;
  if (isFs) {
    try {
      player.exitFullscreen();
    } catch (e) { }
    try {
      if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
    } catch (e) { }
  } else {
    try {
      player.requestFullscreen();
    } catch (e) {
      const videoEl = player.el ? player.el().querySelector('video') : null;
      if (videoEl) try {
        if (videoEl.webkitEnterFullscreen) videoEl.webkitEnterFullscreen();
        else if (videoEl.requestFullscreen) videoEl.requestFullscreen();
      } catch (e) { }
    }
    try {
      if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(e => console.warn(e));
    } catch (e) { }
  }
}


// ============================================
// Watch time management (centralized)
// ============================================

function startWatching(channelId) {
  stopWatching();

  if (!channelId) {
    console.warn("⚠️ No channel name provided to start watching");
    showNotification("❌ Cannot start watching: missing channel name", "error");
    return;
  }

  const now = Date.now();
  appState.set("player.currentChannelId", channelId);
  appState.set("player.watchStartTime", now);

  const id = setInterval(saveCurrentWatchTime, 10000);
  appState.setIntervalRef("watch", id);

  console.log(`▶️ Started watching: ${channelId}`);
}

function stopWatching() {
  const channelId = appState.get("player.currentChannelId");
  if (!channelId) return;

  appState.clearIntervalRef("watch");
  saveCurrentWatchTime();

  appState.set("player.currentChannelId", "");
  appState.set("player.watchStartTime", 0);
}

function saveCurrentWatchTime() {
  const channelId = appState.get("player.currentChannelId");
  const start = appState.get("player.watchStartTime");
  if (!channelId || !start) return;

  const watchedMs = Date.now() - start;
  const watchedSeconds = Math.floor(watchedMs / 1000);
  if (watchedSeconds < 5) return;

  const watchData = loadWatchTime();
  watchData[channelId] = (watchData[channelId] || 0) + watchedSeconds;

  const success = safeLocalStorageSet(LS_KEYS.WATCH_TIME, JSON.stringify(watchData));
  if (success) {
    appState.set("player.watchStartTime", Date.now());
  } else {
    console.warn("Failed to save watch time");
  }
}


function loadWatchTime() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEYS.WATCH_TIME)) || {};
  } catch (e) {
    console.error("Error loading watch time:", e);
    return {};
  }
}


function sortChannelsByWatchTime(channels) {
  const watchData = loadWatchTime();
  return channels.slice().sort((a, b) => {
    const aTime = watchData[a.name] || 0;
    const bTime = watchData[b.name] || 0;
    return bTime - aTime;
  });
}

// ============================================
// Channel UI rendering and helpers
// ============================================

function createChannelItem(channel) {
  const item = document.createElement('div');
  const numberText = channel.number || '';
  item.className = 'content-card channel-item';
  item.setAttribute('role', 'button');
  item.setAttribute('aria-label', `Select channel ${channel.name}`);
  item.setAttribute('tabindex', '0');
  if (channel.isLive) item.setAttribute('aria-live', 'polite');
  item.dataset.url = channel.url || '';
  item.dataset.name = channel.name || '';
  item.dataset.image = channel.image || '';
  item.dataset.description = channel.description || '';
  item.dataset.number = numberText;
  item.dataset.isLive = channel.isLive;
  item.dataset.category = channel.category || 'Unknown';

  const clickHandler = (e) => {
    e.stopPropagation();
    if (e.target.classList.contains('favorite-icon') || e.target.closest('.favorite-icon')) return;
    selectChannel(channel.url, channel.name, channel.image, channel.description, channel.number, channel.isLive);
    saveRecentlyWatched(channel);
  };
  item.addEventListener('click', clickHandler);
  item._clickHandler = clickHandler;

  const thumb = document.createElement('div');
  thumb.className = 'thumb-wrapper';
  const img = document.createElement('img');
  img.src = fixImageUrl(channel.image);
  img.alt = `${channel.name || 'Channel'} Logo`;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.onerror = function () { this.src = 'placeholder.png'; this.alt = 'Image not available'; };
  const numBadge = document.createElement('span');
  numBadge.className = 'channel-number';
  numBadge.textContent = channel.number || '';
  if (channel.isLive === true || channel.isLive === 'true') {
    const liveIndicator = document.createElement('img');
    liveIndicator.src = 'live.webp';
    liveIndicator.alt = 'Live';
    liveIndicator.className = 'live-indicator';
    thumb.appendChild(liveIndicator);
  }
  thumb.appendChild(img);
  thumb.appendChild(numBadge);

  const favoriteIcon = document.createElement('span');
  favoriteIcon.className = 'favorite-icon';
  favoriteIcon.innerHTML = '<i class="fas fa-star"></i>';
  const favoriteHandler = (e) => { e.stopPropagation(); toggleFavorite(channel.url, channel.name, channel.image, channel.description, channel.number, channel.isLive, channel.category, e); };
  favoriteIcon.addEventListener('click', favoriteHandler);
  item._favoriteHandler = favoriteHandler;

  item.appendChild(thumb);
  item.appendChild(favoriteIcon);

  return item;
}

function cleanupChannelItems() {
  const arr = appState.get('uiCollections.allChannelItems') || [];
  arr.forEach(item => {
    if (item._clickHandler) {
      item.removeEventListener('click', item._clickHandler);
      delete item._clickHandler;
    }
    const fi = item.querySelector('.favorite-icon');
    if (fi && item._favoriteHandler) {
      fi.removeEventListener('click', item._favoriteHandler);
      delete item._favoriteHandler;
    }
    if (!item.isConnected) try {
      item.remove();
    } catch (e) { }
  });
  appState.set('uiCollections.allChannelItems', []);
}

function renderChannels(channels) {
  cleanupChannelItems();
  const main = document.getElementById('channels');
  if (!main) return;
  // Keep the <h2> inside .sort-container intact
  const sortContainer = main.querySelector(".sort-container");

  // Remove only content grids
  main.querySelectorAll(".content-grid").forEach(el => el.remove());

  // Remove other h2s, but NOT the one inside .sort-container
  main.querySelectorAll("h2").forEach(h => {
    if (!sortContainer || !sortContainer.contains(h)) {
      h.remove();
    }
  });
  const frag = document.createDocumentFragment();

  const sortMethod = appState.get('ui.sortMethod') || 'none';
  if (sortMethod === 'none') {
    const categorized = channels.reduce((acc, ch) => { const c = ch.category || 'Unknown'; (acc[c] || (acc[c] = [])).push(ch); return acc; }, {});
    for (const cat of Object.keys(categorized)) {
      const chs = categorized[cat];
      const heading = document.createElement('h2');
      heading.textContent = `${cat} (${chs.length})`;
      heading.className = 'text-xl font-bold mt-6 mb-4 col-span-full';
      const grid = document.createElement('div');
      grid.className = 'content-grid';
      chs.forEach(channel => { const it = createChannelItem(channel); grid.appendChild(it); });
      frag.appendChild(heading); 
      frag.appendChild(grid);
    }
  } else {
    const heading = document.createElement('h2');
    heading.textContent = `All Channels (${channels.length})`;
    heading.className = 'text-xl font-bold mt-6 mb-4 col-span-full';
    const grid = document.createElement('div');
    grid.className = 'content-grid';
    channels.forEach(channel => {
      const it = createChannelItem(channel);
      grid.appendChild(it);
    });
    frag.appendChild(heading);
    frag.appendChild(grid);
  }

  main.appendChild(frag);
  updateAllChannelItems();

  console.log(`✅ Rendered ${channels.length} channels in ${sortMethod} view`);

}


// ✅ ENHANCED: Render favorites with new API
function renderFavorites() {
  const container = document.getElementById('favoritesGrid');
  if (!container) return;
  const favorites = getFavorites();
  container.innerHTML = '';
  const favSection = document.getElementById('favorites');
  if (!favorites || favorites.length === 0) {
    if (favSection) favSection.style.display = 'grid';
    container.innerHTML = '<p class="text-gray-400 col-span-full text-center">No favorites yet</p>';
    return;
  }
  if (favSection) favSection.style.display = 'grid';
  favorites.forEach(ch => container.appendChild(createChannelItem(ch)));
}

// ✅ ENHANCED: Render recently watched with timestamps
function renderRecentlyWatched() {
  const container = document.getElementById('recentlyWatchedGrid');
  if (!container) return;
  const recent = getRecentlyWatched();
  container.innerHTML = '';
  const recentSection = document.getElementById('recentlyWatched');
  if (!recent || recent.length === 0) {
    if (recentSection) recentSection.style.display = 'grid';
    container.innerHTML = '<p class="text-gray-400 col-span-full text-center">No recently watched channels</p>';
    return;
  }
  if (recentSection) recentSection.style.display = 'grid';
  recent.forEach(ch => container.appendChild(createChannelItem(ch)));
}

// ✅ ENHANCED: Update favorite icons with new API
function updateFavoriteIcons() {
  const favorites = getFavorites();
  const favSet = new Set(favorites.map(f => f.url));
  document.querySelectorAll('.channel-item').forEach(item => {
    const url = item.dataset.url;
    const icon = item.querySelector('.favorite-icon');
    if (icon) {
      if (favSet.has(url)) icon.classList.add('active');
      else icon.classList.remove('active');
    }
  });
}

function updateAllChannelItems() {
  const items = Array.from(document.querySelectorAll('.channel-item'));
  appState.set('uiCollections.allChannelItems', items);
}
// ============================================
// SEARCH FUNCTIONALITY
// ============================================

function searchChannels(query) {
  const q = (query || '').toLowerCase().trim();
  appState.set('channels.searchQuery', q);
  if (!q) {
    appState.set('channels.filtered', []);
    showFavoritesAndRecent();
    sortChannelsAndRender(appState.get('ui.sortMethod') || 'none');
    return;
  }
  const all = appState.get('channels.all') || [];
  const filtered = all.filter(ch => {
    const nameMatch = (ch.name || '').toLowerCase().includes(q);
    const descMatch = (ch.description || '').toLowerCase().includes(q);
    const catMatch = (ch.category || '').toLowerCase().includes(q);
    const numMatch = (ch.number && ch.number.toString().includes(q));
    return nameMatch || descMatch || catMatch || numMatch;
  });
  appState.set('channels.filtered', filtered);
  hideFavoritesAndRecent();
  renderChannels(filtered);
  updateFavoriteIcons();
  updateAllChannelItems();
  const msg = document.getElementById('search-results-message');
  if (msg) {
    if (filtered.length === 0) {
      msg.textContent = `No channels found for "${query}"`;
      msg.style.display = 'block';
    } else {
      msg.textContent = `Found ${filtered.length} channel${filtered.length > 1 ? 's' : ''}`;
      msg.style.display = 'block';
    }
  }
}



function clearSearch() {
  appState.set('channels.searchQuery', '');
  appState.set('channels.filtered', []);
  const input = document.getElementById('channelSearch');
  if (input) input.value = '';
  const msg = document.getElementById('search-results-message');
  if (msg) msg.style.display = 'none';
  showFavoritesAndRecent();
  sortChannelsAndRender(appState.get('ui.sortMethod') || 'none');
}

function hideFavoritesAndRecent() {
  const fav = document.getElementById('favorites');
  if (fav) fav.style.display = 'none';
  const recent = document.getElementById('recentlyWatched');
  if (recent) recent.style.display = 'none';
}

function showFavoritesAndRecent() {
  const favs = getFavorites();
  const favSection = document.getElementById('favorites');
  if (favSection && favs.length > 0) favSection.style.display = 'grid';
  const rec = getRecentlyWatched();
  const recSection = document.getElementById('recentlyWatched');
  if (recSection && rec.length > 0) recSection.style.display = 'grid';
}


function setupSearchBar() {
  const inputs = [document.getElementById('channelSearch'), document.getElementById('channelSearchDesktop'), document.getElementById('channelSearchMobile')].filter(Boolean);
  const clears = [document.getElementById('clearSearch'), document.getElementById('clearSearchMobile')].filter(Boolean);
  inputs.forEach(input => {
    const handler = (e) => {
      const query = e.target.value;
      inputs.forEach(i => {
        if (i !== e.target && i.value !== query) i.value = query;
      });
      clearTimeout(input._searchTimeout);
      input._searchTimeout = setTimeout(() =>
        searchChannels(query), 300
      );
    };
    input.addEventListener('input', handler);
    appState.addCleanup(() => input.removeEventListener('input', handler));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        clearSearch();
        input.blur();
      }
    });
    input.addEventListener('focus', () => input.style.borderColor = '#007bff');
    input.addEventListener('blur', () => input.style.borderColor = '#444');
  });
  clears.forEach((btn, idx) => {
    const cb = () => {
      inputs.forEach(i => {
        if (i) i.value = '';
      });
      clearSearch();
      if (inputs[idx]) inputs[idx].focus();
    };
    btn.addEventListener('click', cb);
    appState.addCleanup(() => btn.removeEventListener('click', cb));
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================
// Sorting & keyboard navigation
// ============================================

function sortChannelsAndRender(sortMethod = 'none') {
  const channelsToSort = (appState.get('channels.searchQuery') ? appState.get('channels.filtered') : appState.get('channels.all')) || [];
  let sorted = [...channelsToSort];
  switch (sortMethod) {
    case 'asc':
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'desc':
      sorted.sort((a, b) => b.name.localeCompare(a.name));
      break;
    case 'watchTime':
      sorted = sortChannelsByWatchTime(channelsToSort);
      break;
    case 'none':
    default:
      appState.set('ui.sortMethod', 'none');
      renderChannels(sorted);
      updateFavoriteIcons();
      updateAllChannelItems();
      return;
  }
  appState.set('ui.sortMethod', sortMethod);
  renderChannels(sorted);
  updateFavoriteIcons();
  updateAllChannelItems();
}

function handleSortChange(sortMethod) {
  localStorage.setItem("defaultSortMethod", sortMethod);
  sortChannelsAndRender(sortMethod);
  updateSortButtons(sortMethod);
}

function updateSortButtons(method) {
  if (!method) return;

  const buttons = Array.from(document.querySelectorAll('.sort-controls button'));
  if (!buttons.length) return;

  // Clear previous state
  buttons.forEach(btn => {
    btn.classList.remove('active');
    btn.setAttribute('aria-pressed', 'false');
  });

  // Prefer data-sort attribute; fallback to checking onclick string for legacy markup
  const active = buttons.find(btn => {
    const ds = btn.dataset && btn.dataset.sort;
    if (ds) return ds === method;
    const onclick = btn.getAttribute && btn.getAttribute('onclick');
    return typeof onclick === 'string' && onclick.includes(method);
  });

  if (active) {
    active.classList.add('active');
    active.setAttribute('aria-pressed', 'true');
  }
}


// ============================================
// KEYBOARD NAVIGATION
// ============================================

function getGridColumns() {
  const grid = document.querySelector('.content-grid');
  if (!grid) return 1;
  const cols = window.getComputedStyle(grid).getPropertyValue('grid-template-columns');
  if (!cols) return 1;
  return cols.split(' ').length;
}

// ================================
// KEYBOARD NAVIGATION
// ================================

/**
 * Setup keyboard navigation system
 */
function setupKeyboardNavigation() {
  const numberKeyHandler = handleNumberKeyPress.bind(null);
  const navigationKeyHandler = handleNavigationKeys.bind(null);

  document.addEventListener("keydown", numberKeyHandler);
  document.addEventListener("keydown", navigationKeyHandler);

  // Register cleanup
  appState.addCleanup(() => {
    document.removeEventListener("keydown", numberKeyHandler);
    document.removeEventListener("keydown", navigationKeyHandler);
  });
}

/**
 * Handle number key press for channel jumping
 */
function handleNumberKeyPress(e) {
  // Prevent when typing in search inputs
  const searchInputDesktop = document.getElementById('channelSearchDesktop');
  const searchInputMobile = document.getElementById('channelSearchMobile');

  if ((searchInputDesktop && document.activeElement === searchInputDesktop) ||
    (searchInputMobile && document.activeElement === searchInputMobile)) {
    return;
  }

  // Prevent when typing in any input/textarea
  const focusedTag = (document.activeElement?.tagName || '').toLowerCase();
  if (focusedTag === 'input' || focusedTag === 'textarea') return;

  // Only accept numeric keys
  if (e.key >= "0" && e.key <= "9") {
    const currentBuffer = appState.get('ui.numberBuffer') || '';
    appState.set('ui.numberBuffer', currentBuffer + e.key);

    const overlay = document.getElementById("channel-number-overlay");
    if (overlay) {
      overlay.textContent = appState.get('ui.numberBuffer');
      overlay.style.display = "block";
    }

    // Clear existing timeout
    appState.clearTimeoutRef('numberTimeout');

    // Set new timeout
    const timeoutId = setTimeout(() => {
      if (overlay) overlay.style.display = "none";

      const channelNumber = parseInt(appState.get('ui.numberBuffer'), 10);
      const allChannels = appState.get('channels.all') || [];
      const channel = allChannels.find((c) => parseInt(c.number, 10) === channelNumber);

      if (channel) {
        const allChannelItems = appState.get('uiCollections.allChannelItems') || [];
        const index = allChannelItems.findIndex(
          (item) => parseInt(item.dataset.number, 10) === channelNumber
        );

        if (index !== -1) {
          appState.set('ui.focusedIndex', index);
          const item = allChannelItems[index];
          if (item) {
            item.focus();
            item.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }

        selectChannel(
          channel.url,
          channel.name,
          channel.image,
          channel.description,
          channel.number,
          channel.isLive
        );
        saveRecentlyWatched(channel);
      }

      appState.set('ui.numberBuffer', '');
      appState.setTimeoutRef('numberTimeout', null);
    }, 700);

    appState.setTimeoutRef('numberTimeout', timeoutId);
  }
}

/**
 * Handle arrow keys and navigation keys
 */
function handleNavigationKeys(event) {
  // Clear previous debounce
  appState.clearTimeoutRef('navigationDebounce');

  const timeoutId = setTimeout(() => {
    const GRID_COLUMNS = getGridColumns();
    const modal = document.getElementById("videoModal");
    const isModalOpen = appState.get('ui.isModalOpen') || (modal && modal.style.display === "flex");

    const allChannelItems = appState.get('uiCollections.allChannelItems') || [];
    const focusedElement = document.activeElement;
    let currentFocusedIndex = allChannelItems.findIndex((item) => item === focusedElement);

    // ===========================
    // MODAL OPEN NAVIGATION
    // ===========================
    if (isModalOpen) {
      if (event.key === "Enter" || event.key === "OK") {
        event.preventDefault();
        toggleFullscreen();
        return;
      }

      if (event.key === "Escape" || event.key === "ArrowLeft") {
        event.preventDefault();
        closeModal();
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        showChannelInfoOverlay();
        return;
      }

      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(event.key)) {
        event.preventDefault();

        const lastFocusedElement = appState.get('ui.lastFocusedElement');
        if (!lastFocusedElement || allChannelItems.length === 0) return;

        const currentChannelIndex = allChannelItems.findIndex(
          (item) => item === lastFocusedElement
        );

        if (currentChannelIndex === -1) return;

        let newIndex = currentChannelIndex;
        if (event.key === "ArrowDown" || event.key === "PageDown") {
          newIndex = (currentChannelIndex + 1) % allChannelItems.length;
        } else if (event.key === "ArrowUp" || event.key === "PageUp") {
          newIndex = (currentChannelIndex - 1 + allChannelItems.length) % allChannelItems.length;
        }

        const newChannelCard = allChannelItems[newIndex];
        const { url, name, image, description, number, isLive = "false", category = "Unknown" } = newChannelCard.dataset;

        newChannelCard.scrollIntoView({ behavior: "smooth", block: "center" });
        selectChannel(url, name, image, description, number, isLive);
        saveRecentlyWatched({ name, url, image, description, number, isLive, category });

        appState.set('ui.lastFocusedElement', newChannelCard);
      }
      return;
    }

    // ===========================
    // NORMAL NAVIGATION (GRID)
    // ===========================
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();

      if (allChannelItems.length === 0) return;

      // If nothing focused, focus first item
      if (currentFocusedIndex === -1) {
        allChannelItems[0].focus();
        allChannelItems[0].scrollIntoView({ behavior: "smooth", block: "center" });
        appState.set('ui.focusedIndex', 0);
        return;
      }

      let newIndex = currentFocusedIndex;

      if (event.key === "ArrowRight") {
        newIndex = (currentFocusedIndex + 1) % allChannelItems.length;
      } else if (event.key === "ArrowLeft") {
        newIndex = (currentFocusedIndex - 1 + allChannelItems.length) % allChannelItems.length;
      } else if (event.key === "ArrowDown") {
        newIndex = Math.min(currentFocusedIndex + GRID_COLUMNS, allChannelItems.length - 1);
      } else if (event.key === "ArrowUp") {
        newIndex = Math.max(currentFocusedIndex - GRID_COLUMNS, 0);
      }

      const newCard = allChannelItems[newIndex];
      if (newCard) {
        newCard.focus();
        newCard.scrollIntoView({ behavior: "smooth", block: "center" });
        appState.set('ui.focusedIndex', newIndex);
      }
    }

    // ===========================
    // PAGE/HOME/END NAVIGATION
    // ===========================
    else if (["PageUp", "PageDown", "Home", "End"].includes(event.key)) {
      event.preventDefault();

      if (allChannelItems.length === 0) return;

      if (currentFocusedIndex === -1) {
        allChannelItems[0].focus();
        allChannelItems[0].scrollIntoView({ behavior: "smooth", block: "center" });
        appState.set('ui.focusedIndex', 0);
        return;
      }

      let newIndex = currentFocusedIndex;

      if (event.key === "PageUp") {
        newIndex = Math.max(currentFocusedIndex - GRID_COLUMNS * 3, 0);
      } else if (event.key === "PageDown") {
        newIndex = Math.min(currentFocusedIndex + GRID_COLUMNS * 3, allChannelItems.length - 1);
      } else if (event.key === "Home") {
        newIndex = 0;
      } else if (event.key === "End") {
        newIndex = allChannelItems.length - 1;
      }

      const newCard = allChannelItems[newIndex];
      if (newCard) {
        newCard.focus();
        newCard.scrollIntoView({ behavior: "smooth", block: "center" });
        appState.set('ui.focusedIndex', newIndex);
      }
    }

    // ===========================
    // ENTER KEY - SELECT CHANNEL
    // ===========================
    else if (event.key === "Enter" && currentFocusedIndex !== -1) {
      event.preventDefault();

      const card = allChannelItems[currentFocusedIndex];
      if (!card) return;

      const { url, name, image, description, number, isLive = "false", category = "Unknown" } = card.dataset;

      card.scrollIntoView({ behavior: "smooth", block: "center" });
      selectChannel(url, name, image, description, number, isLive);
      saveRecentlyWatched({ name, url, image, description, number, isLive, category });
    }
  }, 50);

  appState.setTimeoutRef('navigationDebounce', timeoutId);
}

// ============================================
// YOUTUBE API & RSS FEEDS
// ============================================

function extractChannelId(feedUrl) {
  const match = feedUrl.match(/channel_id=([^&]+)/);
  return match ? match[1] : null;
}

function youtubeItemToChannel(videoId, title, feed) {
  return {
    url: `https://www.youtube.com/watch?v=${videoId}`,
    name: feed.name,
    image: feed.image,
    category: feed.category || "> Person <",
    description: title,
  };
}

function updateOrAddChannel(channelObj) {
  const existingIndex = allChannels.findIndex((ch) => ch.name === channelObj.name);
  if (existingIndex !== -1) {
    allChannels[existingIndex] = {
      ...allChannels[existingIndex],
      ...channelObj,
    };
  } else {
    allChannels.push(channelObj);
  }
}

function processRSSData(data, feed) {
  if (!data.items || data.items.length === 0) return;
  let latestValid = data.items.find((item) => !item.link.includes("/shorts/"));
  if (!latestValid) return;
  const videoId = extractYouTubeID(latestValid.link);
  if (!videoId) return;
  const channelObj = youtubeItemToChannel(videoId, latestValid.title, feed);
  updateOrAddChannel(channelObj);
  console.log(`✅ ${feed.name} Successfully updated`);
}

async function loadYouTubeLatestFeeds() {
  const storedFeeds = localStorage.getItem(LS_KEYS.FEEDS);
  if (!storedFeeds) {
    showNotification("No RSS feeds found in localStorage.", "warning");
    return;
  }
  let feeds = [];
  try {
    feeds = JSON.parse(storedFeeds);
  } catch (error) {
    console.error("Failed to parse RSS feeds:", error);
    showNotification("Error loading RSS feeds data.", "error");
    return;
  }
  if (!feeds || feeds.length === 0) return;
  for (const [index, feed] of feeds.entries()) {
    try {
      if (index > 0) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      const cacheKey = `rss_${feed.url}`;
      const cached = rssCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        console.log(`📦 Using cached data for ${feed.name}`);
        processRSSData(cached.data, feed);
        continue;
      }
      const feedUrl = "https://api.rss2json.com/v1/api.json?rss_url=" + encodeURIComponent(feed.url);
      const res = await fetch(feedUrl);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      rssCache.set(cacheKey, {
        data: data,
        timestamp: Date.now(),
      });
      processRSSData(data, feed);
    } catch (e) {
      console.log(`❌ Error loading RSS feed for ${feed.name}: ${e.message}`, true);
    }
  }
}

async function loadYouTubeLiveFeeds() {
  if (!API_KEY) {
    API_KEY = getStoredAPIKey();
  }
  if (!API_KEY || !hasValidAPIKey()) {
    console.log("🔒 No valid API key found, prompting user...");
    showAPIKeyModal();
    return;
  }
  const storedLive = localStorage.getItem(LS_KEYS.LIVE);
  if (!storedLive) {
    showNotification("No live channels found in localStorage.", "warning");
    return;
  }
  let live = [];
  try {
    live = JSON.parse(storedLive);
  } catch (error) {
    console.error("Failed to parse live channels:", error);
    showNotification("Error loading live channels data.", "error");
    return;
  }
  if (!live || live.length === 0) return;
  let apiQuotaExceeded = false;
  let successfulUpdates = 0;
  let failedUpdates = 0;
  let cacheHits = 0;
  for (const [index, feed] of live.entries()) {
    try {
      if (index > 0) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (apiQuotaExceeded) {
        console.log(`⏸️ Skipping ${feed.name} - API quota exceeded`);
        failedUpdates++;
        continue;
      }
      const channelId = extractChannelId(feed.url);
      if (!channelId) {
        console.warn("No channelId found in feed:", feed.url);
        continue;
      }
      const cacheKey = `live_${channelId}`;
      const cached = liveCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        console.log(`📦 Using cached live data for ${feed.name}`);
        cacheHits++;
        if (cached.data && cached.data.videoId) {
          const channelObj = youtubeItemToChannel(cached.data.videoId, cached.data.title, feed);
          updateOrAddChannel(channelObj);
          successfulUpdates++;
        }
        continue;
      }
      const apiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&eventType=live&type=video&order=date&maxResults=1&key=${API_KEY}`;
      const res = await fetch(apiUrl);
      if (!res.ok) {
        if (res.status === 403) {
          apiQuotaExceeded = true;
          console.log("🚫 YouTube API quota exceeded. Stopping live stream updates.");
          failedUpdates++;
          continue;
        } else if (res.status === 404) {
          console.log(`❌ Channel not found for ${feed.name}`);
          failedUpdates++;
          continue;
        }
        throw new Error(`API returned status ${res.status}: ${res.statusText}`);
      }
      const data = await res.json();
      if (data.error) {
        if (data.error.code === 403) {
          apiQuotaExceeded = true;
          console.log("🚫 YouTube API quota exceeded (in response). Stopping live stream updates.");
          failedUpdates++;
          continue;
        }
        throw new Error(`YouTube API Error for ${feed.name}: ${data.error.message}`);
      }
      let cacheData = null;
      if (data.items && data.items.length > 0) {
        const item = data.items[0];
        const videoId = item.id.videoId;
        const title = item.snippet.title;
        cacheData = {
          videoId: videoId,
          title: title
        };
        const channelObj = youtubeItemToChannel(videoId, title, feed);
        updateOrAddChannel(channelObj);
        successfulUpdates++;
        console.log(`✅ ${feed.name} Successfully updated`);
      } else {
        console.log(`ℹ️ No live stream found for ${feed.name}`);
        cacheData = null;
      }
      liveCache.set(cacheKey, {
        data: cacheData,
        timestamp: Date.now(),
      });
    } catch (e) {
      failedUpdates++;
      if (e.message.includes("quota exceeded") || e.message.includes("403")) {
        apiQuotaExceeded = true;
        console.log("🚫 YouTube API quota exceeded. Stopping live stream updates.");
      } else {
        console.log(`❌ Error loading live feed for ${feed.name}: ${e.message}`, true);
      }
    }
  }
  console.log(`Live streams update completed: ${successfulUpdates} successful, ${failedUpdates} failed, ${cacheHits} cache hits`);
  if (successfulUpdates === 0 && failedUpdates > 0 && apiQuotaExceeded) {
    throw new Error("YouTube API quota exceeded - no live streams updated");
  }
}

async function loadAllChannelFeeds() {
  console.log("Starting full channel update (RSS and Live API)...");

  try {
    console.log("1/2: Loading latest uploads from RSS...");
    await loadYouTubeLatestFeeds();

    console.log("2/2: Loading live streams (YouTube API)...");
    await loadYouTubeLiveFeeds();

    // Get updated channels from appState
    const channels = appState.get("channels.all") || [];

    console.log("Saving updated channel data to localStorage...");
    const success = safeLocalStorageSet(LS_KEYS.CHANNELS, JSON.stringify(channels));
    if (!success) {
      console.warn("⚠️ Channels loaded but not saved to storage");
      showNotification("⚠️ Channels loaded (not saved due to storage limits)", "warning");
    }

    console.log("🔄 Refreshing UI...");
    renderChannels(channels);
    updateFavoriteIcons();
    renderRecentlyWatched();
    updateAllChannelItems();

    console.log("✅ Full channels update COMPLETE.");
    return true;
  } catch (e) {
    console.error(`❌ Critical error during full channel update: ${e.message}`);

    // Fallback: still persist whatever channels we have
    const channels = appState.get("channels.all") || [];
    safeLocalStorageSet(LS_KEYS.CHANNELS, JSON.stringify(channels));

    renderChannels(channels);
    updateFavoriteIcons();
    renderRecentlyWatched();
    updateAllChannelItems();

    return false;
  }
}


// ============================================
// AUTO-UPDATE SERVICE
// ============================================
function startChannelAutoUpdate() {
  const savedAutoUpdate = localStorage.getItem(AUTO_UPDATE_KEY);
  const savedInterval = localStorage.getItem(UPDATE_INTERVAL_KEY);
  isAutoUpdateEnabled = savedAutoUpdate === null ? true : savedAutoUpdate === "true";
  updateIntervalHours = savedInterval ? parseInt(savedInterval) : 8;
  const intervalMs = updateIntervalHours * 60 * 60 * 1000;
  const cacheExpiryMs = updateIntervalHours * 60 * 60 * 1000;
  console.log(`Auto-update service initializing. Enabled: ${isAutoUpdateEnabled}, Interval: ${updateIntervalHours}h`);
  const checkAndUpdate = async () => {
    if (!isAutoUpdateEnabled) {
      console.log("Auto-update is disabled. Skipping check.");
      return;
    }
    const lastUpdateTimestamp = parseInt(localStorage.getItem(CACHE_KEY) || "0");
    const currentTime = Date.now();
    const timeSinceLastUpdate = currentTime - lastUpdateTimestamp;
    const shouldUpdate = lastUpdateTimestamp === 0 || timeSinceLastUpdate >= cacheExpiryMs;
    if (shouldUpdate) {
      console.log("Cache has expired. Initiating full data update now.");
      try {
        const success = await loadAllChannelFeeds();
        if (success) {
          const newTimestamp = Date.now();
          localStorage.setItem(CACHE_KEY, newTimestamp.toString());
          const newLastUpdateDate = new Date(newTimestamp).toLocaleString();
          const newNextUpdateDate = new Date(newTimestamp + cacheExpiryMs).toLocaleString();
          console.log("✅ Channels updated successfully.");
          console.log(`New Last Update Time: ${newLastUpdateDate}`);
          console.log(`Next Scheduled Check (Expiry): ${newNextUpdateDate}`);
        } else {
          console.log("❌ Update failed. Cache timestamp preserved for retry.", true);
        }
      } catch (error) {
        console.log(`❌ Unexpected error during update: ${error.message}`, true);
        console.log("Cache timestamp preserved for retry.");
      }
    } else {
      const timeRemaining = cacheExpiryMs - timeSinceLastUpdate;
      const minutesRemaining = Math.ceil(timeRemaining / (60 * 1000));
      const hoursRemaining = Math.floor(minutesRemaining / 60);
      const minsRemaining = minutesRemaining % 60;
      if (hoursRemaining > 0) {
        console.log(`Cache is valid. Expires in ${hoursRemaining}h ${minsRemaining}m`);
      } else {
        console.log(`Cache is valid. Expires in ${minutesRemaining} minutes.`);
      }
    }
  };
  const initialLastUpdate = parseInt(localStorage.getItem(CACHE_KEY) || "0");
  if (initialLastUpdate === 0) {
    console.log("Last Update: Never. Starting initial data fetch now.");
  } else {
    const lastUpdateDate = new Date(initialLastUpdate).toLocaleString();
    const nextExpiry = initialLastUpdate + cacheExpiryMs;
    const nextUpdateDate = new Date(nextExpiry).toLocaleString();
    const timeRemaining = nextExpiry - Date.now();
    const minutesRemaining = Math.ceil(timeRemaining / (60 * 1000));
    console.log(`Last Update: ${lastUpdateDate}`);
    console.log(`Next update available after: ${nextUpdateDate}`);
    console.log(`Time remaining: ${minutesRemaining} minutes`);
  }
  if (isAutoUpdateEnabled) {
    checkAndUpdate();
  }
  autoUpdateInterval = setInterval(checkAndUpdate, intervalMs);
  console.log(`Auto-update service started. Checking every ${updateIntervalHours} hours. Status: ${isAutoUpdateEnabled ? "Enabled" : "Disabled"}`);
}

function stopAutoUpdateService() {
  if (autoUpdateInterval) {
    clearInterval(autoUpdateInterval);
    autoUpdateInterval = null;
    console.log("Auto-update service stopped");
  }
}
// ============================================
// SETTINGS MODAL
// ============================================
function showSettingsModal() {
  const settingsModal = document.getElementById("settingsModal");
  if (!settingsModal) return;

  settingsModal.style.display = "flex";

  // Existing settings code...
  const autoUpdateToggle = document.getElementById("autoUpdateToggle");
  const updateIntervalSelect = document.getElementById("updateInterval");

  if (autoUpdateToggle) {
    autoUpdateToggle.checked = isAutoUpdateEnabled;
  }

  if (updateIntervalSelect) {
    updateIntervalSelect.value = updateIntervalHours.toString();
  }

  updateIntervalDescriptionText(updateIntervalHours);
  updateLastUpdateDisplay();

  // Add storage info
  if (!document.getElementById('storageUsageDisplay')) {
    addStorageInfoToSettings();
  } else {
    updateStorageDisplay();
  }

}

function hideSettingsModal() {
  const settingsModal = document.getElementById("settingsModal");
  if (settingsModal) {
    settingsModal.style.display = "none";
  }
}

function toggleAutoUpdate(enabled) {
  isAutoUpdateEnabled = enabled;
  localStorage.setItem(AUTO_UPDATE_KEY, enabled.toString());
  if (enabled) {
    console.log("✅ Auto-update enabled");
    showNotification("Auto-update enabled", "success");
    stopAutoUpdateService();
    startChannelAutoUpdate();
  } else {
    console.log("⏸️ Auto-update disabled");
    showNotification("Auto-update disabled", "info");
  }
}

function changeUpdateInterval(hours) {
  updateIntervalHours = parseInt(hours);
  localStorage.setItem(UPDATE_INTERVAL_KEY, hours.toString());
  updateIntervalDescriptionText(hours);
  console.log(`⏱️ Update interval changed to ${hours} hours`);
  showNotification(`Update interval set to ${hours} hours`, "success");
  if (isAutoUpdateEnabled) {
    stopAutoUpdateService();
    startChannelAutoUpdate();
  }
}
async function manualUpdate() {
  const manualUpdateBtn = document.getElementById("manualUpdateBtn");
  if (!manualUpdateBtn) return;
  manualUpdateBtn.disabled = true;
  const originalText = manualUpdateBtn.textContent;
  manualUpdateBtn.textContent = "Updating...";
  try {
    console.log("🔄 Manual update initiated...");
    const success = await loadAllChannelFeeds();
    if (success) {
      const newTimestamp = Date.now();
      localStorage.setItem(CACHE_KEY, newTimestamp.toString());
      console.log("✅ Manual update completed successfully");
      showNotification("Channels updated successfully!", "success");
      updateLastUpdateDisplay();
    } else {
      console.log("❌ Manual update failed", true);
      showNotification("Update failed. Please try again.", "error");
    }
  } catch (error) {
    console.log(`❌ Manual update error: ${error.message}`, true);
    showNotification("Update failed. Check console for details.", "error");
  } finally {
    manualUpdateBtn.disabled = false;
    manualUpdateBtn.textContent = originalText;
  }
}

function updateLastUpdateDisplay() {
  const lastUpdate = parseInt(localStorage.getItem(CACHE_KEY) || "0");
  const lastUpdateEl = document.getElementById("lastUpdateDisplay");
  if (!lastUpdateEl) return;
  if (lastUpdate === 0) {
    lastUpdateEl.textContent = "Never updated";
    lastUpdateEl.style.color = "#ff9800";
  } else {
    const timeAgo = getTimeAgo(lastUpdate);
    const date = new Date(lastUpdate);
    const formattedDate = date.toLocaleString();
    lastUpdateEl.textContent = `Last updated: ${timeAgo} (${formattedDate})`;
    lastUpdateEl.style.color = "#4caf50";
  }
}

function updateIntervalDescriptionText(hours) {
  const descriptionEl = document.getElementById("updateIntervalDescription");
  if (descriptionEl) {
    descriptionEl.textContent = `Automatically check for new content every ${hours} hour${hours > 1 ? "s" : ""}`;
  }
}

function setupSettingsModal() {
  const settingsModal = document.getElementById("settingsModal");
  if (!settingsModal) return;

  // Find all elements (no logic to set values yet)
  const settingsBtn = document.getElementById("settingsBtn");
  const closeSettings = document.getElementById("closeSettings");
  const autoUpdateToggle = document.getElementById("autoUpdateToggle");
  const updateIntervalSelect = document.getElementById("updateInterval");
  const manualUpdateBtn = document.getElementById("manualUpdateBtn");
  const manageApiKeyBtn = document.getElementById("manageApiKeyBtn");

  // --- Attach Event Listeners (Run Once) ---
  if (settingsBtn) {
    settingsBtn.addEventListener("click", showSettingsModal);
  }
  if (closeSettings) {
    closeSettings.addEventListener("click", hideSettingsModal);
  }
  if (settingsModal) {
    settingsModal.addEventListener("click", (e) => {
      if (e.target === settingsModal) {
        hideSettingsModal();
      }
    });
  }
  if (autoUpdateToggle) {
    autoUpdateToggle.addEventListener("change", (e) => {
      toggleAutoUpdate(e.target.checked);
    });
  }
  if (updateIntervalSelect) {
    updateIntervalSelect.addEventListener("change", (e) => {
      changeUpdateInterval(e.target.value);
    });
  }
  if (manualUpdateBtn) {
    manualUpdateBtn.addEventListener("click", manualUpdate);
  }
  if (manageApiKeyBtn) {
    manageApiKeyBtn.addEventListener("click", () => {
      hideSettingsModal();
      setTimeout(showAPIKeyModal, 300);
    });
  }

  if (!document.getElementById('storageUsageDisplay')) {
    addStorageInfoToSettings();
  }

  updateStorageDisplay();
}
// ============================================
// API KEY MODAL
// ============================================
function showAPIKeyModal() {
  const apiModal = document.getElementById("apiKeyModal");
  if (!apiModal) return;

  apiModal.style.display = "flex";

  const apiKeyInput = document.getElementById("apiKeyInput");
  if (apiKeyInput) {
    const existingKey = getStoredAPIKey();
    if (existingKey) {
      apiKeyInput.value = existingKey;
      apiKeyInput.type = "password";
    } else {
      apiKeyInput.value = "";
    }

    setTimeout(() => apiKeyInput.focus(), 100);
  }

  setupAPIKeyModalEvents();
}

function hideAPIKeyModal() {
  const apiModal = document.getElementById("apiKeyModal");
  if (apiModal) {
    apiModal.style.display = "none";
  }
}

// Replace your setupAPIKeyModalEvents() function with this updated version:

function setupAPIKeyModalEvents() {
  const submitBtn = document.getElementById("submitApiKey");
  const skipBtn = document.getElementById("skipApiKey");
  const closeBtn = document.getElementById("closeApiKeyModal"); // NEW
  const apiKeyInput = document.getElementById("apiKeyInput");
  const toggleVisibilityBtn = document.getElementById("toggleApiKeyVisibility");
  const apiModal = document.getElementById("apiKeyModal");

  if (submitBtn) {
    const newSubmitBtn = submitBtn.cloneNode(true);
    submitBtn.parentNode.replaceChild(newSubmitBtn, submitBtn);
    newSubmitBtn.addEventListener("click", function () {
      const apiKey = apiKeyInput.value.trim();
      const remember = document.getElementById("rememberKey")?.checked;
      if (!apiKey) {
        apiKeyInput.classList.add("invalid");
        showNotification("Please enter a valid API key", "error");
        setTimeout(() => apiKeyInput.classList.remove("invalid"), 400);
        return;
      }
      if (apiKey.length < 30) {
        apiKeyInput.classList.add("invalid");
        showNotification("API key seems too short. Please check it.", "error");
        setTimeout(() => apiKeyInput.classList.remove("invalid"), 400);
        return;
      }
      if (remember) {
        saveAPIKey(apiKey);
      } else {
        API_KEY = apiKey;
      }
      hideAPIKeyModal();
      showNotification("✅ API Key saved successfully!", "success");
      setTimeout(() => {
        console.log("🔄 Starting live feeds update with new API key...");
        loadYouTubeLiveFeeds().catch(console.error);
      }, 1000);
    });
  }

  if (skipBtn) {
    const newSkipBtn = skipBtn.cloneNode(true);
    skipBtn.parentNode.replaceChild(newSkipBtn, skipBtn);
    newSkipBtn.addEventListener("click", function () {
      hideAPIKeyModal();
      showNotification("⭕️ Live channels update skipped", "info");
      console.log("ℹ️ User skipped API key configuration");
    });
  }

  // NEW: Close button handler
  if (closeBtn) {
    const newCloseBtn = closeBtn.cloneNode(true);
    closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
    newCloseBtn.addEventListener("click", function () {
      hideAPIKeyModal();
      console.log("ℹ️ API Key modal closed");
    });
  }

  if (toggleVisibilityBtn && apiKeyInput) {
    const newToggleBtn = toggleVisibilityBtn.cloneNode(true);
    toggleVisibilityBtn.parentNode.replaceChild(newToggleBtn, toggleVisibilityBtn);
    newToggleBtn.addEventListener("click", function () {
      if (apiKeyInput.type === "password") {
        apiKeyInput.type = "text";
        newToggleBtn.textContent = "🙈 Hide";
      } else {
        apiKeyInput.type = "password";
        newToggleBtn.textContent = "👁️ Show";
      }
    });
  }

  if (apiKeyInput) {
    apiKeyInput.addEventListener("keypress", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        document.getElementById("submitApiKey").click();
      }
    });
  }

  if (apiModal) {
    apiModal.addEventListener("click", (e) => {
      if (e.target === apiModal) {
        hideAPIKeyModal();
      }
    });
  }

  document.addEventListener("keydown", function escapeHandler(e) {
    if (e.key === "Escape" && apiModal && apiModal.style.display === "flex") {
      hideAPIKeyModal();
      document.removeEventListener("keydown", escapeHandler);
    }
  });
}

// ============================================
// NETWORK MONITORING
// ============================================

function setupNetworkMonitoring() {
  window.addEventListener("online", handleNetworkRestored);
  window.addEventListener("offline", handleNetworkLost);
}

function handleNetworkLost() {
  isOnline = false;
  //console.log("📡 Network connection lost");
  showNotification("📡 Network Connection lost", "error");
  const player = channelLoader.getPlayer();
  if (player && !player.paused()) {
    player.pause();
    showNotification("Connection lost - video paused", "error");
  }
}

function handleNetworkRestored() {
  isOnline = true;
  //console.log("📡 Network connection restored");
  showNotification("📡 Network Connection restored", "success");
  const player = channelLoader.getPlayer();
  if (player && player.paused()) {
    setTimeout(() => {
      player.play()
        .then(() => {
          showNotification("▶️ Resuming playback...", "success");
          //console.log("▶️ Resuming playback after network recovery");
        })
        .catch((error) => {
          console.warn("❌ Could not auto-resume playback:", error);
        });
    }, 1000);
  }
}
// ============================================
// CLEANUP & INITIALIZATION
// ============================================
function cleanup() {
  console.log("🧹 Performing cleanup...");
  stopWatching();
  stopAutoUpdateService();
  if (overlayTimeoutShow) {
    clearTimeout(overlayTimeoutShow);
    overlayTimeoutShow = null;
  }
  if (overlayTimeoutHide) {
    clearTimeout(overlayTimeoutHide);
    overlayTimeoutHide = null;
  }
  if (numberTimeout) {
    clearTimeout(numberTimeout);
    numberTimeout = null;
  }
  if (navigationDebounce) {
    clearTimeout(navigationDebounce);
    navigationDebounce = null;
  }
  channelLoader.cleanupPlayer().then(() => {
    console.log("✅ Player cleanup complete");
  }).catch(error => {
    console.warn("Error during player cleanup:", error);
  });
  document.querySelectorAll(".network-status, .error-notification, .play-fallback-overlay, .notification").forEach((el) => {
    if (el.parentNode) {
      el.parentNode.removeChild(el);
    }
  });

  restoreFocus();

  console.log("✅ Cleanup complete");
}

// Restore focus to the last focused element, or fallback to the first channel item
function restoreFocus() {
  const lastFocusedElement = appState.get('ui.lastFocusedElement');
  const allChannelItems = appState.get('uiCollections.allChannelItems') || [];

  if (lastFocusedElement && lastFocusedElement.isConnected) {
    lastFocusedElement.focus();
  } else if (allChannelItems.length > 0) {
    allChannelItems[0].focus();
    appState.set('ui.focusedIndex', 0);
  }
}

async function initialize() {
  PerformanceMonitor.measureChannelLoad();

  // --- UI setup: hide grid, show spinner ---
  const contentGrid = document.querySelector(".content-grid");
  const loadingElement = document.getElementById("loading-spinner");
  if (contentGrid) contentGrid.style.display = "none";
  if (loadingElement) loadingElement.style.display = "block";

  // --- Modal setup ---
  const closeBtn = document.querySelector(".closeModal");
  if (closeBtn) closeBtn.addEventListener("click", closeModal);

  const modal = document.getElementById("videoModal");
  if (modal) {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal();
    });
  }

  // --- Feature setup ---
  setupNetworkMonitoring();
  setupSettingsModal();
  setupSearchBar();
  setupTouchGestures();
  setupPWA();
  setupKeyboardNavigation();

  // --- Background health checks ---
  setInterval(checkStorageHealth, 60_000); // every minute

  // --- Load channels from localStorage ---
  const stored = localStorage.getItem(LS_KEYS.CHANNELS);
  if (stored) {
    try {
      const parsed = safeJSONParse(stored, []);
      if (!Array.isArray(parsed)) throw new Error("Parsed channels data is not an array");

      appState.set("channels.all", parsed);
      appState.set("channels.filtered", []);
      // console.log(`Successfully loaded ${parsed.length} channels from localStorage.`);
    } catch (e) {
      console.warn("Invalid channels data in localStorage. Ignoring.", e);
      appState.set("channels.all", []);
      appState.set("channels.filtered", []);
    }
  } else {
    console.log("No previous channels data found in localStorage. Starting fresh.");
    appState.set("channels.all", []);
    appState.set("channels.filtered", []);
  }

  PerformanceMonitor.channelLoadComplete();

  // --- API key setup ---
  API_KEY = getStoredAPIKey() || "";
  if (hasValidAPIKey()) {
    console.log("✅ Using stored API key");
  } else {
    console.log("ℹ️ No valid API key stored");
  }

  // --- Auto update ---
  startChannelAutoUpdate();

  // --- Ensure channel numbering ---
  const channels = appState.get("channels.all") || [];
  const numbered = channels.map((ch, i) => ({
    ...ch,
    number: ch.number || i + 1,
  }));
  appState.set("channels.all", numbered);

  // --- UI state restoration ---
  loadWatchTime();
  const savedSort = localStorage.getItem("defaultSortMethod") || "none";
  handleSortChange(savedSort);

  renderFavorites();
  renderRecentlyWatched();
  updateFavoriteIcons();
  updateAllChannelItems();

  if (loadingElement) loadingElement.style.display = "none";
  if (contentGrid) contentGrid.style.display = "grid";

  restoreFocus();
}

// ============================================
// EVENT LISTENERS
// ============================================
// Initialize once DOM is ready
window.addEventListener("DOMContentLoaded", async () => {
  try {
    await initialize();
  } catch (e) {
    console.error("Initialization failed:", e);
  }
});

// Clean up before leaving the page
window.addEventListener("beforeunload", () => {
  try {
    cleanup();
  } catch (e) {
    console.warn("Cleanup encountered an error:", e);
  }
});

// Pause/resume video when tab visibility changes
document.addEventListener("visibilitychange", () => {
  const player = channelLoader.getPlayer();

  if (document.hidden) {
    saveCurrentWatchTime();

    if (player && !player.paused()) {
      player.pause();
      console.log("⏸️ Video paused due to tab switch");
      appState.set("player.isPlaying", false);
    }
  } else {
    if (player && player.paused()) {
      const playPromise = player.play();
      if (playPromise) {
        playPromise
          .then(() => {
            console.log("▶️ Video resumed after returning to tab");
            appState.set("player.isPlaying", true);
          })
          .catch((error) => {
            console.error("Resume failed:", error);
          });
      }
    }
  }
});

/**
 * Sets up Progressive Web App features (Service Worker registration and prompt).
 * Skips registration on localhost to allow seamless live reloading.
 */
function setupPWA() {
  const isLocalHost = ['localhost', '127.0.0.1'].includes(location.hostname);

  // Skip Service Worker registration during local development
  if (isLocalHost) {
    console.warn("⚠️ Service Worker skipped for local development.");
    return;
  }

  // --- 1. Determine the Base Path (needed for GitHub Pages like /LiveTV/) ---
  let basePath = '/';
  if (location.hostname.endsWith('github.io')) {
    const pathParts = location.pathname.split('/').filter(Boolean);
    if (pathParts.length > 0) {
      basePath = `/${pathParts[0]}/`;
    }
  }

  // --- 2. Service Worker registration with update logic ---
  if ('serviceWorker' in navigator) {
    const swPath = `${basePath}sw.js`;

    navigator.serviceWorker.register(swPath)
      .then(registration => {
        console.log(`✅ SW registered successfully with scope: ${registration.scope}`);

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateNotification();
            }
          });
        });
      })
      .catch(error => {
        console.error('❌ SW registration failed:', error);
      });
  }

  // --- 3. Add to homescreen prompt logic ---
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    console.log('✨ Before Install Prompt deferred. Ready to show UI.');
    // You can trigger a custom "Install" button here using deferredPrompt.prompt()
  });

  // --- Helper: show update notification ---
  function showUpdateNotification() {
    const updateNotification = document.createElement('div');
    updateNotification.className = 'update-notification';
    updateNotification.innerHTML = `
      <span>New version available!</span>
      <button class="update-btn">Update Now</button>
    `;

    Object.assign(updateNotification.style, {
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      background: '#2196F3',
      color: 'white',
      padding: '15px 20px',
      borderRadius: '8px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      zIndex: '10000',
      display: 'flex',
      gap: '10px',
      alignItems: 'center'
    });

    updateNotification.querySelector('.update-btn').addEventListener('click', () => {
      location.reload();
    });

    document.body.appendChild(updateNotification);
  }
}


function fixImageUrl(imageUrl) {
  if (!imageUrl) return 'placeholder.png';
  if (imageUrl.startsWith('https://')) return imageUrl;

  if (imageUrl.startsWith('http://')) {
    const cleanUrl = imageUrl.replace('http://', '');

    // Try multiple proxies with fallback
    const proxies = [
      `https://images.weserv.nl/?url=${encodeURIComponent(cleanUrl)}`,
      `https://wsrv.nl/?url=${encodeURIComponent(cleanUrl)}`, // Backup
      `https://imageproxy.pimg.tw/resize?url=${encodeURIComponent(imageUrl)}` // Another backup
    ];

    return proxies[0]; // You could rotate on failure
  }

  return imageUrl;
}

function optimizeImageUrl(imageUrl, width = 200) {
  if (imageUrl.startsWith('https://images.weserv.nl/')) {
    return imageUrl;
  }
  // Use weserv.nl for automatic image optimization
  const cleanUrl = imageUrl.replace('http://', '').replace('https://', '');
  return `https://images.weserv.nl/?url=${encodeURIComponent(cleanUrl)}&w=${width}&fit=cover&a=attention`;
}

function setupTouchGestures() {
  const modal = document.getElementById('videoModal');
  if (!modal) return;

  modal.addEventListener('touchstart', handleTouchStart, { passive: true });
  modal.addEventListener('touchend', handleTouchEnd, { passive: true });
}

function handleTouchStart(e) {
  const touch = e.changedTouches[0];
  appState.set('ui.touchStartX', touch.screenX);
  appState.set('ui.touchStartY', touch.screenY);
  appState.set('ui.touchEndX', touch.screenX); // initialize
  appState.set('ui.touchEndY', touch.screenY);
}

function handleTouchEnd(e) {
  const touch = e.changedTouches[0];
  appState.set('ui.touchEndX', touch.screenX);
  appState.set('ui.touchEndY', touch.screenY);

  const startX = appState.get('ui.touchStartX') || 0;
  const startY = appState.get('ui.touchStartY') || 0;
  const endX = appState.get('ui.touchEndX') || 0;
  const endY = appState.get('ui.touchEndY') || 0;

  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const totalDelta = Math.abs(deltaX) + Math.abs(deltaY);

  const player = appState.get('player.instance');
  const isCurrentlyFullscreen = player?.isFullscreen?.() || false;

  const currentTime = Date.now();
  const lastTapTime = appState.get('ui.lastTapTime') || 0;
  const DOUBLE_TAP_DELAY = 300; // ms, adjust as needed

  // If minimal movement, treat as tap
  if (totalDelta < 10) {
    if (currentTime - lastTapTime < DOUBLE_TAP_DELAY) {
      if (!isCurrentlyFullscreen) {
        window.showFullscreenPrompt();
      } else {
        window.toggleFullscreen();
        showNotification("Exit fullscreen to use player. Double‑tap again!", "success");
      }
      appState.set('ui.lastTapTime', 0);
      return;
    }
    appState.set('ui.lastTapTime', currentTime);
    return; // Don't process as swipe
  }

  // Process swipe only if significant movement
  handleSwipe(deltaX, deltaY);
}

function handleSwipe(deltaX, deltaY) {
  const modal = document.getElementById('videoModal');
  if (!modal || modal.style.display !== 'flex') return;

  const minSwipeDistance = 50;

  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    // Horizontal swipe
    if (Math.abs(deltaX) > minSwipeDistance) {
      if (deltaX > 0) {
        console.log('👉 Swipe right detected');
        showChannelInfoOverlay();
      } else {
        console.log('👈 Swipe left detected');
        closeModal();
      }
    }
  } else {
    // Vertical swipe
    if (Math.abs(deltaY) > minSwipeDistance) {
      if (deltaY < 0) {
        // console.log('👆 Swipe up detected');
        // navigateToNextChannel();
      } else {
        // console.log('👇 Swipe down detected');
        // navigateToPreviousChannel();
      }
    }
  }
}


// ============================================
// Previous/Next navigation helpers
// ============================================

function navigateChannel(direction = 1) {
  const items = appState.get('uiCollections.allChannelItems') || [];
  if (!items.length) return;

  const lastFocused = appState.get('ui.lastFocusedElement') || items[0];
  let currentIndex = items.indexOf(lastFocused);
  if (currentIndex === -1) currentIndex = 0;

  // direction: +1 for next, -1 for previous
  const newIndex = (currentIndex + direction + items.length) % items.length;
  const target = items[newIndex];

  const { url, name, image, description, number, isLive, category } = target.dataset;

  selectChannel(url, name, image, description, number, isLive);
  saveRecentlyWatched({ name, url, image, description, number, isLive, category });
  appState.set('ui.lastFocusedElement', target);

  const icon = direction === -1 ? "⏮️" : "⏭️";
  showNotification(`${icon} ${name}`, "info");
}

// Convenience wrappers
function navigateToPreviousChannel() {
  navigateChannel(-1);
}

function navigateToNextChannel() {
  navigateChannel(1);
}

/**
 * Clears old/non-critical data from localStorage
 */
function clearOldStorageData() {
  // Priority: Keep channels and feeds, clear watch time first
  const keysToTryClearing = [
    LS_KEYS.WATCH_TIME,  // Least critical
    CACHE_KEY,   // Can be regenerated
    LS_KEYS.RECENT,     // User can rebuild this
    // Only as last resort:
    //LS_KEYS.FAVORITES,
    //LS_KEYS.CHANNELS
  ];

  for (const key of keysToTryClearing) {
    if (localStorage.getItem(key)) {
      console.log(`🗑️ Clearing ${key} to free space`);
      localStorage.removeItem(key);

      // Check if we have enough space now
      try {
        const testData = 'x'.repeat(100000); // 100KB test
        localStorage.setItem('_test', testData);
        localStorage.removeItem('_test');
        console.log('✅ Space freed successfully');
        return; // We have space now
      } catch (e) {
        console.log('⚠️ Still need more space, continuing cleanup...');
        continue;
      }
    }
  }

  console.warn('⚠️ All non-critical data cleared, but may still be low on space');
}

/**
 * Get current storage usage statistics
 * @returns {Object} Storage usage info
 */
function getStorageUsage() {
  let totalSize = 0;
  const items = {};

  for (let key in localStorage) {
    if (localStorage.hasOwnProperty(key)) {
      const size = (localStorage[key].length + key.length) * 2; // UTF-16 = 2 bytes per char
      items[key] = size;
      totalSize += size;
    }
  }

  return {
    totalBytes: totalSize,
    totalKB: (totalSize / 1024).toFixed(2),
    totalMB: (totalSize / 1024 / 1024).toFixed(2),
    items: items,
    itemCount: Object.keys(items).length
  };
}

/**
 * Log storage usage to console
 */
function logStorageUsage() {
  const usage = getStorageUsage();
  if (!usage) {
    console.warn("⚠️ No storage usage data available.");
    return;
  }

  const MAX_MB = 5; // total quota in MB
  const availableBytes = getAvailableSpace();
  const availableMB = (availableBytes / (1024 * 1024)).toFixed(2);
  const availableKB = (availableBytes / 1024).toFixed(2);

  console.group("📊 Storage Usage:");
  console.log(`   Total Space: ${MAX_MB} MB`);
  console.log(`   Used: ${usage.totalMB} MB (${usage.totalKB} KB)`);
  console.log(`   Remaining: ${availableMB} MB (${availableKB} KB)`);
  console.log(`   Items: ${usage.itemCount}`);
  console.log("   Breakdown (Top 10):");

  const sorted = Object.entries(usage.items || {})
    .sort(([, sizeA], [, sizeB]) => sizeB - sizeA)
    .slice(0, 10);

  sorted.forEach(([key, size]) => {
    console.log(`   - ${key}: ${(size / 1024).toFixed(2)} KB`);
  });

  console.groupEnd();
}


// ============================================
// COMPLETE IMPORT/EXPORT BACKUP SYSTEM
// ============================================

/**
 * Export all application data as JSON backup
 */
function exportAllData() {
  try {
    // Gather all data from localStorage and memory safely
    const data = {
      version: "1.0.0",
      exportDate: new Date().toISOString(),
      channels: appState.get("channels.all") || [],
      favorites: safeJSONParse(localStorage.getItem(LS_KEYS.FAVORITES) || "[]", []),
      recentlyWatched: safeJSONParse(localStorage.getItem(LS_KEYS.RECENT) || "[]", []),
      watchTime: loadWatchTime() || {},
      rssFeeds: safeJSONParse(localStorage.getItem(LS_KEYS.FEEDS) || "[]", []),
      liveChannels: safeJSONParse(localStorage.getItem(LS_KEYS.LIVE) || "[]", []),
      settings: {
        autoUpdateEnabled: localStorage.getItem(AUTO_UPDATE_KEY) ?? "true",
        updateIntervalHours: localStorage.getItem(UPDATE_INTERVAL_KEY) ?? "8",
        defaultSortMethod: localStorage.getItem("defaultSortMethod") ?? "none",
        lastUpdate: localStorage.getItem(CACHE_KEY) ?? "0"
      }
    };

    // Create blob and download
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `iptv-backup-${Date.now()}.json`;
    document.body.appendChild(a);

    a.click();

    // Cleanup
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showNotification("✅ Backup exported successfully", "success");
    console.log("✅ Backup exported:", data);

    return true;
  } catch (error) {
    console.error("❌ Export failed:", error);
    showNotification("❌ Failed to export backup", "error");
    return false;
  }
}
/**
 * Import backup data from JSON file
 * @param {File} file - The backup file to import
 */
async function importBackupData(file) {
  if (!file) {
    showNotification('❌ No file selected', 'error');
    return false;
  }

  // Validate file type
  if (!file.name.endsWith('.json')) {
    showNotification('❌ Please select a valid JSON backup file', 'error');
    return false;
  }

  try {
    // Read file
    const text = await file.text();
    const data = JSON.parse(text);

    // Validate backup structure
    if (!validateBackupData(data)) {
      showNotification('❌ Invalid backup file format', 'error');
      return false;
    }

    // Show confirmation dialog
    const confirmed = await showImportConfirmation(data);
    if (!confirmed) {
      showNotification('ℹ️ Import cancelled', 'info');
      return false;
    }

    // Perform import
    await performImport(data);

    return true;

  } catch (error) {
    console.error('❌ Import failed:', error);
    showNotification('❌ Failed to import backup: ' + error.message, 'error');
    return false;
  }
}

/**
 * Validate backup data structure
 * @param {Object} data - Backup data to validate
 * @returns {boolean} - Whether data is valid
 */
function validateBackupData(data) {
  // Check required fields
  if (!data || typeof data !== 'object') {
    console.error('Invalid data structure');
    return false;
  }

  // Check version compatibility (optional)
  if (data.version && !isVersionCompatible(data.version)) {
    console.warn('⚠️ Backup version mismatch:', data.version);
    // Still allow import, but warn user
  }

  // Validate channels array
  if (data.channels && !Array.isArray(data.channels)) {
    console.error('Invalid channels data');
    return false;
  }

  // Validate favorites array
  if (data.favorites && !Array.isArray(data.favorites)) {
    console.error('Invalid favorites data');
    return false;
  }

  console.log('✅ Backup validation passed');
  return true;
}

/**
 * Check if backup version is compatible
 * @param {string} version - Backup version
 * @returns {boolean} - Whether version is compatible
 */
function isVersionCompatible(version) {
  // Simple version check - expand as needed
  const currentVersion = "1.0.0";
  return version === currentVersion;
}

/**
 * Show import confirmation dialog
 * @param {Object} data - Backup data
 * @returns {Promise<boolean>} - User confirmation
 */
function showImportConfirmation(data) {
  return new Promise((resolve) => {
    const exportDate = data?.exportDate
      ? new Date(data.exportDate).toLocaleString()
      : "Unknown";

    const channelCount = Array.isArray(data?.channels) ? data.channels.length : 0;
    const favoriteCount = Array.isArray(data?.favorites) ? data.favorites.length : 0;
    const recentCount = Array.isArray(data?.recentlyWatched) ? data.recentlyWatched.length : 0;

    // Create modal container
    const modal = document.createElement("div");
    modal.className = "settings-modal";
    modal.style.display = "flex";

    // Build modal content
    modal.innerHTML = `
      <div class="settings-content" style="max-width: 500px;">
        <h2>📥 Import Backup</h2>
        
        <div class="setting-item">
          <p><strong>Backup Information:</strong></p>
          <ul style="list-style: none; padding: 0; margin: 10px 0;">
            <li>📅 Export Date: ${exportDate}</li>
            <li>📺 Channels: ${channelCount}</li>
            <li>⭐ Favorites: ${favoriteCount}</li>
            <li>🕐 Recent: ${recentCount}</li>
            ${data?.version ? `<li>🔢 Version: ${data.version}</li>` : ""}
          </ul>
        </div>
        
        <div class="setting-item" style="background: rgba(255, 152, 0, 0.1); 
             padding: 15px; border-radius: 8px; border: 1px solid rgba(255, 152, 0, 0.3);">
          <p style="color: #ff9800; margin: 0;">
            <i class="fas fa-exclamation-triangle"></i>
            <strong>Warning:</strong> This will replace your current data!
          </p>
          <p style="color: #ff9800; font-size: 14px; margin: 10px 0 0 0;">
            Current data will be backed up automatically before import.
          </p>
        </div>
        
        <div class="setting-item">
          <label style="cursor: pointer;">
            <input type="checkbox" class="merge-checkbox" style="margin-right: 10px;">
            Merge with existing data (don't replace)
          </label>
          <p class="setting-description">
            If checked, imported data will be added to your current data instead of replacing it.
          </p>
        </div>
        
        <div style="display: flex; gap: 10px; margin-top: 20px;">
          <button class="confirm-btn btn-primary" style="flex: 1;">✅ Import</button>
          <button class="cancel-btn btn-secondary" style="flex: 1;">❌ Cancel</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Scoped selectors inside modal
    const confirmBtn = modal.querySelector(".confirm-btn");
    const cancelBtn = modal.querySelector(".cancel-btn");
    const mergeCheckbox = modal.querySelector(".merge-checkbox");

    // Event listeners
    confirmBtn.addEventListener("click", () => {
      const mergeData = mergeCheckbox.checked;
      modal.remove();
      resolve({ confirmed: true, merge: mergeData });
    });

    cancelBtn.addEventListener("click", () => {
      modal.remove();
      resolve({ confirmed: false });
    });

    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        modal.remove();
        resolve({ confirmed: false });
      }
    });
  }).then((result) => {
    // Store merge preference for performImport
    if (result.confirmed) {
      window._importMergeMode = result.merge;
    }
    return result.confirmed;
  });
}


/**
 * Perform the actual import of backup data
 * @param {Object} data - Backup data
 */
async function performImport(data) {
  const mergeMode = window._importMergeMode || false;
  delete window._importMergeMode; // Clean up

  try {
    // Step 1: Auto-backup
    console.log("📦 Creating automatic backup of current data...");
    const backupSuccess = await createAutoBackup();
    if (!backupSuccess) {
      console.warn("⚠️ Auto-backup failed, but continuing with import...");
    }

    // Step 2: Import channels
    if (Array.isArray(data.channels) && data.channels.length > 0) {
      let channels = appState.get("channels.all") || [];

      if (mergeMode) {
        console.log("🔄 Merging channels...");
        data.channels.forEach(importedChannel => {
          const existingIndex = channels.findIndex(ch => ch.url === importedChannel.url);
          if (existingIndex !== -1) {
            channels[existingIndex] = { ...channels[existingIndex], ...importedChannel };
          } else {
            channels.push(importedChannel);
          }
        });
      } else {
        console.log("🔄 Replacing channels...");
        channels = [...data.channels];
      }

      appState.set("channels.all", channels);
      safeLocalStorageSet(LS_KEYS.CHANNELS, JSON.stringify(channels));
    }

    // Step 3: Import favorites
    if (Array.isArray(data.favorites)) {
      let favorites = mergeMode
        ? safeJSONParse(localStorage.getItem(LS_KEYS.FAVORITES) || "[]", [])
        : [];

      if (mergeMode) {
        data.favorites.forEach(fav => {
          if (!favorites.find(f => f.url === fav.url)) {
            favorites.push(fav);
          }
        });
      } else {
        favorites = [...data.favorites];
      }

      safeLocalStorageSet(LS_KEYS.FAVORITES, JSON.stringify(favorites));
    }

    // Step 4: Import recently watched
    if (Array.isArray(data.recentlyWatched)) {
      let recent = mergeMode
        ? safeJSONParse(localStorage.getItem(LS_KEYS.RECENT) || "[]", [])
        : [];

      if (mergeMode) {
        data.recentlyWatched.forEach(item => {
          recent = recent.filter(r => r.url !== item.url);
          recent.unshift(item);
        });
        recent = recent.slice(0, MAX_RECENT);
      } else {
        recent = [...data.recentlyWatched];
      }

      safeLocalStorageSet(LS_KEYS.RECENT, JSON.stringify(recent));
    }

    // Step 5: Import watch time
    if (data.watchTime && typeof data.watchTime === "object") {
      if (mergeMode) {
        const currentWatchTime = loadWatchTime();
        Object.keys(data.watchTime).forEach(channelId => {
          currentWatchTime[channelId] =
            (currentWatchTime[channelId] || 0) + data.watchTime[channelId];
        });
        safeLocalStorageSet(LS_KEYS.WATCH_TIME, JSON.stringify(currentWatchTime));
      } else {
        safeLocalStorageSet(LS_KEYS.WATCH_TIME, JSON.stringify(data.watchTime));
      }
    }

    // Step 6: Import RSS feeds
    if (Array.isArray(data.rssFeeds) && !mergeMode) {
      safeLocalStorageSet(LS_KEYS.FEEDS, JSON.stringify(data.rssFeeds));
    }

    // Step 7: Import live channels
    if (Array.isArray(data.liveChannels) && !mergeMode) {
      safeLocalStorageSet(LS_KEYS.LIVE, JSON.stringify(data.liveChannels));
    }

    // Step 8: Import settings
    if (data.settings && !mergeMode) {
      if (data.settings.autoUpdateEnabled) {
        localStorage.setItem(AUTO_UPDATE_KEY, data.settings.autoUpdateEnabled);
      }
      if (data.settings.updateIntervalHours) {
        localStorage.setItem(UPDATE_INTERVAL_KEY, data.settings.updateIntervalHours);
      }
      if (data.settings.defaultSortMethod) {
        localStorage.setItem("defaultSortMethod", data.settings.defaultSortMethod);
      }
    }

    // Step 9: Refresh UI
    console.log("🔄 Refreshing UI...");
    renderChannels(appState.get("channels.all"));
    renderFavorites();
    renderRecentlyWatched();
    updateFavoriteIcons();
    updateAllChannelItems();

    // Step 10: Restart auto-update if needed
    if (!mergeMode && data.settings) {
      stopAutoUpdateService();
      startChannelAutoUpdate();
    }

    showNotification(
      `✅ Import successful! ${mergeMode ? "Data merged" : "Data restored"}`,
      "success"
    );
    console.log("✅ Import completed successfully");

    hideSettingsModal();
  } catch (error) {
    console.error("❌ Import failed:", error);
    showNotification("❌ Import failed: " + error.message, "error");
    throw error;
  }
}


/**
 * Create automatic backup before import
 * @returns {Promise<boolean>} Success status
 */
async function createAutoBackup() {
  try {
    const data = {
      version: "1.0.0",
      exportDate: new Date().toISOString(),
      autoBackup: true,
      channels: appState.get('channels.all') || [],
      favorites: JSON.parse(localStorage.getItem(LS_KEYS.FAVORITES) || "[]"),
      recentlyWatched: JSON.parse(localStorage.getItem(LS_KEYS.RECENT) || "[]"),
      watchTime: loadWatchTime() || {},
      settings: {
        autoUpdateEnabled: localStorage.getItem(AUTO_UPDATE_KEY),
        updateIntervalHours: localStorage.getItem(UPDATE_INTERVAL_KEY),
        defaultSortMethod: localStorage.getItem("defaultSortMethod"),
      }
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `iptv-auto-backup-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log('✅ Auto-backup created');
    return true;
  } catch (error) {
    console.error('❌ Auto-backup failed:', error);
    return false;
  }
}

/**
 * Handle file input change event
 * @param {Event} event - Change event from file input
 */
async function handleImportFile(event) {
  const file = event.target.files[0];
  if (file) {
    await importBackupData(file);
  }
  // Reset file input so same file can be selected again
  event.target.value = '';
}

/**
 * Trigger file input click
 */
function triggerImportDialog() {
  const fileInput = document.getElementById('importFileInput');
  if (fileInput) {
    fileInput.click();
  }
}



// ============================================
// ADD TO SETTINGS MODAL
// ============================================
function addStorageInfoToSettings() {
  const settingsContent = document.querySelector('.settings-content');
  if (!settingsContent) return;

  const storageInfo = document.createElement('div');
  storageInfo.className = 'setting-item';
  storageInfo.innerHTML = `
    <h3>Storage Usage</h3> 
    <div id="storageUsageDisplay" class="setting-description">
      Calculating...
    </div>
    <button id="viewStorageDetails" class="btn-secondary" style="margin-top: 10px;">
      <i class="fas fa-chart-bar text-green-500"></i> View Details
    </button>
    <button id="exportDataBtn" class="btn-secondary" style="margin-top: 10px;">
      <i class="fas fa-file-export text-blue-500"></i> Export Backup
    </button>
    <button id="importDataBtn" class="btn-secondary" style="margin-top: 10px;">
      <i class="fas fa-file-import text-red-500"></i> Import Backup
    </button>
    <button id="clearRecentBtn" class="btn-secondary" style="margin-top: 10px;">
      <i class="fas fa-history text-green-500"></i> Clear Recently Watched
    </button>
    <button id="clearFavoritesBtn" class="btn-secondary" style="margin-top: 10px;">
      <i class="fas fa-star text-yellow-500"></i>Clear All Favorites
    </button>

    <input type="file" id="importFileInput" accept=".json" style="display: none;">
    
  `;

  // 💡 Recommendation: Append to the main content instead of finding the close button
  settingsContent.appendChild(storageInfo);

  // Event listeners (attached only once)
  document.getElementById('viewStorageDetails')?.addEventListener('click', () => {
    logStorageUsage();
    showNotification('Check console for storage details', 'info');
  });


  document.getElementById('exportDataBtn')?.addEventListener('click', exportAllData);
  document.getElementById('importDataBtn')?.addEventListener('click', triggerImportDialog);

  document.getElementById('clearRecentBtn')?.addEventListener('click', clearRecentlyWatched);
  document.getElementById('clearFavoritesBtn')?.addEventListener('click', clearAllFavorites);

  const closeBtn = document.getElementById('closeSettings');
  if (closeBtn && closeBtn.parentNode) {
    closeBtn.parentNode.insertBefore(storageInfo, closeBtn);
  }

  const fileInput = document.getElementById('importFileInput');
  if (fileInput) {
    fileInput.addEventListener('change', handleImportFile);
  }

}

function updateStorageDisplay() {
  const usage = getStorageUsage();
  const display = document.getElementById('storageUsageDisplay');

  if (display) {
    let color = '#4caf50'; // Green
    if (parseFloat(usage.totalMB) > 4) {
      color = '#ff9800'; // Orange - getting close to limit
    }
    if (parseFloat(usage.totalMB) > 8) {
      color = '#f44336'; // Red - danger zone
    }

    display.innerHTML = `
      <span style="color: ${color}; font-weight: bold;">
        ${usage.totalMB} MB
      </span> 
      used (${usage.itemCount} items)
      ${parseFloat(usage.totalMB) > 4 ? '<br>⚠️ Consider clearing old data' : ''}
    `;
  }
}


function cleanupAllEventListeners() {
  eventCleanupCallbacks.forEach(cleanup => cleanup());
  eventCleanupCallbacks.length = 0;
}

function renderVirtualizedChannels(channels) {
  // Implement using Intersection Observer
  const container = document.getElementById("channels");
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const item = entry.target;
        // Load actual content here
      }
    });
  }, { rootMargin: '200px' });

  // Create placeholder items and observe them
  channels.forEach(channel => {
    const placeholder = document.createElement('div');
    placeholder.className = 'content-card lazy';
    placeholder.dataset.channelUrl = channel.url;
    container.appendChild(placeholder);
    observer.observe(placeholder);
  });
}

// Add intersection observer for lazy loading
function setupLazyLoading() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        img.src = img.dataset.src;
        observer.unobserve(img);
      }
    });
  }, { rootMargin: '50px' });

  document.querySelectorAll('img[data-src]').forEach(img => {
    observer.observe(img);
  });
}

// ADD SANITIZATION:
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Add proactive monitoring
function checkStorageHealth() {
  const usage = getStorageUsage();
  const percentUsed = (usage.totalBytes / (5 * 1024 * 1024)) * 100;

  if (percentUsed > 80) {
    showNotification('⚠️ Storage 80% full - consider exporting data', 'warning');
    // Auto-cleanup non-critical data
    clearOldStorageData();
  }

  if (percentUsed > 95) {
    // Emergency cleanup
    showNotification('🚨 Storage critical - forcing cleanup', 'error');
    localStorage.removeItem(LS_KEYS.WATCH_TIME);
    clearOldStorageData();
  }
}


// Use Promise.allSettled for parallel requests with rate limiting
async function fetchWithRateLimit(feeds, maxConcurrent = 3) {
  const results = [];

  for (let i = 0; i < feeds.length; i += maxConcurrent) {
    const batch = feeds.slice(i, i + maxConcurrent);
    const batchPromises = batch.map(feed =>
      fetch(feed.url)
        .then(res => res.json())
        .then(data => ({ feed, data, status: 'fulfilled' }))
        .catch(error => ({ feed, error, status: 'rejected' }))
    );

    const batchResults = await Promise.allSettled(batchPromises);
    results.push(...batchResults);

    // Small delay between batches
    if (i + maxConcurrent < feeds.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return results;
}


class PerformanceMonitor {
  static measureChannelLoad() {
    performance.mark('channel-load-start');
  }

  static channelLoadComplete() {
    performance.mark('channel-load-end');
    performance.measure('channel-load', 'channel-load-start', 'channel-load-end');

    const measure = performance.getEntriesByName('channel-load')[0];
    if (measure) {
      console.log(`🚀 Initializing IPTV Channel Manager in ${measure.duration.toFixed(2)}ms`);
    }

    // Clean up marks/measures to keep buffer tidy
    performance.clearMarks('channel-load-start');
    performance.clearMarks('channel-load-end');
    performance.clearMeasures('channel-load');
  }
}




// ============================================
// EXPORT GLOBAL FUNCTIONS
// ============================================
// Build the namespace object
window.__iptv = {
  // state / modules
  appState,
  channelLoader,

  // UI / actions
  selectChannel,
  handleSortChange,
  showSettingsModal,
  hideSettingsModal,
  toggleAutoUpdate,
  changeUpdateInterval,
  manualUpdate,
  showAPIKeyModal,
  hideAPIKeyModal,
  closeModal,
  searchChannels,
  clearSearch,
  exportAllData,
  importBackupData,
  triggerImportDialog,
  clearOldStorageData,
  updateStorageDisplay,
  showFullscreenPrompt,
  toggleFullscreen,

  // rendering / helpers
  renderChannels,
  getFavorites,
  getRecentlyWatched
};

// Optionally make it immutable to avoid accidental reassignment
Object.freeze(window.__iptv);

