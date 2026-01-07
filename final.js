/**
 * Performance monitoring utility
 */
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

    // Clear all at once for better performance
    performance.clearMarks();
    performance.clearMeasures();
  }
}

const CACHE_DURATION = 60 * 60 * 1000;
const DOUBLE_TAP_DELAY = 300;

// 1. Initialize State
const appState = new AppStateManager();

// 2. Initialize Cache
const rssCache = new LRUCache(50, CACHE_DURATION);
const liveCache = new LRUCache(30, CACHE_DURATION);

// 3. Initialize Network (Passing appState dependency)
const networkMonitor = new NetworkMonitor({ checkInterval: 15000 }, appState);
networkMonitor.initialize();

// 4. Example usage of State + Cache
appState.subscribe('settings.isOnline', (isOnline) => {
  console.log(`Application UI reacting to: ${isOnline ? 'Online' : 'Offline'}`);
});


let fullscreenPrompt = null;

const AUTO_UPDATE_KEY = "autoUpdateEnabled";
const UPDATE_INTERVAL_KEY = "updateIntervalHours";
const MAX_RECENT = 18;

// Frozen constants for immutability and optimization
const LS_KEYS = Object.freeze({
  FAVORITES: "favorites",
  RECENT: "recentlyWatched",
  CHANNELS: "allChannelsData",
  LIVE: "liveChannelsData",
  FEEDS: "rssFeedsData",
  WATCH_TIME: "watchTimePerChannel",
  YT_QUOTA: "__iptv_yt_quota",
  RSS_FAILED: "rssFailedFeeds"
});

const API_KEY_STORAGE_KEY = "youtube_api_key";
const CACHE_KEY = "lastChannelsUpdate";

const MAX_MB = 6;
const MAX_BYTES = MAX_MB * 1024 * 1024; // Pre-calculate constant

const VERSION = "1.0.0";

const PLAYBACK_CONSTANTS = Object.freeze({
  MAX_ELEMENT_WAIT_TIME: 2000,
  PLAYER_READY_TIMEOUT: 5000,
  DOM_MUTATION_CHECK_INTERVAL: 50,
  YOUTUBE_READY_CHECK_INTERVAL: 100,
  TRANSITION_DELAY: 0,
});

const DEBOUNCE_MS = 180;

const pendingRequests = new Map();

// Pre-compile regex patterns for better performance
const WHITESPACE_REGEX = /\s+/g;

function safeJSONParse(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (e) {
    console.warn('JSON parse error:', e);
    return fallback;
  }
}

function readArray(key) {
  const raw = localStorage.getItem(key);
  if (!raw) return [];
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

function getActualStorageSize(str) {
  // TextEncoder is faster than Blob for size calculation
  return new TextEncoder().encode(str).length;
}

// Cache storage usage to avoid recalculating
let cachedStorageUsage = null;
let storageUsageCacheTime = 0;
const STORAGE_CACHE_TTL = 5000; // 5 seconds

function getAvailableSpace() {
  const now = Date.now();

  // Use cached value if available and fresh
  if (cachedStorageUsage && (now - storageUsageCacheTime) < STORAGE_CACHE_TTL) {
    const available = MAX_BYTES - cachedStorageUsage.totalBytes;
    return available > 0 ? available : 0;
  }

  const usage = getStorageUsage();

  if (!usage || typeof usage.totalBytes !== "number") {
    console.warn("⚠️ Storage usage unavailable.");
    return MAX_BYTES;
  }

  // Cache the result
  cachedStorageUsage = usage;
  storageUsageCacheTime = now;

  const available = MAX_BYTES - usage.totalBytes;
  return available > 0 ? available : 0;
}

/**
 * Safely sets data in localStorage with quota error handling and backup protection
 * @param {string} key - Storage key
 * @param {string} value - Value to store (should be stringified JSON)
 * @param {boolean} retryOnFail - Whether to clear old data and retry once
 * @returns {boolean} - Success status
 */
function safeLocalStorageSet(key, value, retryOnFail = true) {
  const actualSize = getActualStorageSize(value);
  const available = getAvailableSpace();

  const backup = localStorage.getItem(key);

  if (actualSize > available) {
    console.warn(`⚠️ Data size (${actualSize}) exceeds available space (${available})`);

    if (retryOnFail) {
      predictiveCleanup();

      if (getAvailableSpace() < actualSize) {
        clearOldStorageData();
      }
    } else {
      return false;
    }
  }

  try {
    localStorage.setItem(key, value);
    // Invalidate cache on successful write
    cachedStorageUsage = null;
    return true;
  } catch (e) {
    console.warn("Storage write failed:", e);

    if (backup !== null) {
      try {
        localStorage.setItem(key, backup);
      } catch (backupErr) {
        console.error("CRITICAL: Failed to restore backup!", backupErr);
      }
    }

    if ((e.name === 'QuotaExceededError' || e.code === 22) && retryOnFail) {
      console.log("Quota exceeded, attempting aggressive cleanup and retry...");
      clearOldStorageData();
      return safeLocalStorageSet(key, value, false);
    }

    showNotification('Failed to save data', 'error');
    return false;
  }
}


/**
 * Optimized debounce function with better memory management
 */
function debounce(fn, wait = DEBOUNCE_MS, options = {}) {
  let timeout;
  let lastArgs, lastThis;
  const {
    leading = false, trailing = true, maxWait
  } = options;

  function invoke() {
    fn.apply(lastThis, lastArgs);
    timeout = null;
    lastArgs = lastThis = null; // Clear references for GC
  }

  const debounced = function (...args) {
    lastArgs = args;
    lastThis = this;

    const shouldInvokeLeading = leading && !timeout;

    if (timeout) clearTimeout(timeout);

    timeout = setTimeout(() => {
      if (trailing) invoke();
    }, wait);

    if (shouldInvokeLeading) invoke();
  };

  debounced.cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
      lastArgs = lastThis = null;
    }
  };

  debounced.flush = () => {
    if (timeout) {
      clearTimeout(timeout);
      invoke();
    }
  };

  return debounced;
}

// Pre-calculate time constants
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600; // 60 * 60
const SECONDS_PER_DAY = 86400; // 60 * 60 * 24

function getTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < SECONDS_PER_MINUTE) {
    return "just now";
  }

  if (seconds < SECONDS_PER_HOUR) {
    const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
    return `${minutes} minute${minutes !== 1 ? "s" : ""} ago`;
  }

  if (seconds < SECONDS_PER_DAY) {
    const hours = Math.floor(seconds / SECONDS_PER_HOUR);
    return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  }

  const days = Math.floor(seconds / SECONDS_PER_DAY);
  return `${days} day${days !== 1 ? "s" : ""} ago`;

}

// Cache notification element to avoid repeated creation
let activeNotification = null;

function showNotification(message, type = 'info', time = 3000) {
  appState.clearTimeoutRef('notificationTimer');

  document.querySelectorAll('.iptv-notification').forEach(n => {
    n.classList.remove('visible');
    setTimeout(() => {
      if (n.isConnected) n.remove();
    }, 400);
  });

  const el = document.createElement('div');
  el.className = `iptv-notification notification-${type}`;

  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  el.setAttribute('aria-atomic', 'true');

  el.textContent = message;

  document.body.appendChild(el);

  requestAnimationFrame(() => {
    el.classList.add('visible');
  });

  const cleanup = () => {
    document.removeEventListener('keydown', handleKeydown);
  };

  const hide = () => {
    if (!el.isConnected) return;
    el.classList.remove('visible');
    setTimeout(() => {
      if (el.isConnected) {
        el.remove();
        cleanup();
        appState.clearTimeoutRef('notificationTimer');
      }
    }, 400);
  };

  el.addEventListener('click', () => {
    appState.clearTimeoutRef('notificationTimer');
    hide();
  });

  const handleKeydown = (e) => {
    if (e.key === 'Escape' && el.isConnected) {
      appState.clearTimeoutRef('notificationTimer');
      hide();
    }
  };
  document.addEventListener('keydown', handleKeydown);

  const timer = setTimeout(hide, time);
  appState.setTimeoutRef('notificationTimer', timer);

  appState.addCleanup(() => {
    if (el.isConnected) {
      cleanup();
      el.remove();
    }
  });

  return { hide, cleanup };
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
</div>`;
  document.body.appendChild(errorDiv);

  setTimeout(() => {
    if (errorDiv.isConnected) {
      errorDiv.remove();
    }
  }, PLAYBACK_CONSTANTS.PLAYER_READY_TIMEOUT);
}



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

function clearAllFavorites() {
  if (confirm('Are you sure you want to clear ALL favorites? This cannot be undone!')) {
    const ok = writeArray(LS_KEYS.FAVORITES, []);
    if (ok) dispatchStorageUpdate('favorites');
    return ok;
  }
}

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

  recent = recent.filter(r => r.url !== channelData.url);

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
  if (confirm('Are you sure you want to clear your recently watched history?')) {
    const ok = writeArray(LS_KEYS.RECENT, []);
    if (ok) dispatchStorageUpdate('recent');
    return ok;
  }
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

/**
 * Cancellation token for async operations
 */
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

/**
 * Create stream configuration based on URL
 */
function createStreamConfig(url, opts = {}) {
  if (!url || typeof url !== "string") {
    console.warn("createStreamConfig: invalid URL");
    return null;
  }

  url = url.trim();
  const isHTTPS = window.location.protocol === "https:";
  const isHTTP = url.startsWith("http://");
  const isM3U8 = url.includes(".m3u8") || url.includes("playlist");
  const isMPD = url.endsWith(".mpd");
  const isMP4 = url.endsWith(".mp4") || url.includes(".mp4?") || url.includes("imarkaz");
  const isTS = url.endsWith(".ts");
  const isYouTube = url.includes("youtube.com") || url.includes("youtu.be");

  if (isHTTPS && isHTTP) {
    console.error("❌ Mixed Content Blocked:", url);

    let httpsRewrite = null;
    try {
      if (url.startsWith("http://")) {
        httpsRewrite = "https://" + url.substring(7);
      }
    } catch { }

    const proxy = opts.proxyUrl || "https://cors-anywhere.herokuapp.com/";
    const proxiedUrl = proxy + url;

    showNotification(
      "HTTP stream blocked on HTTPS. Using secure proxy fallback...",
      " `"
    );

    return {
      techOrder: ["html5"],
      type: isM3U8 ? "hls" : "auto",
      source: {
        src: proxiedUrl,
        type: isM3U8 ?
          "application/x-mpegURL" : isMP4 ?
            "video/mp4" : "video/mp2t",
      },
      _fallbackInfo: {
        original: url,
        throughProxy: proxiedUrl,
        httpsRewriteAttempt: httpsRewrite,
      },
    };
  }

  if (isYouTube) {
    return {
      type: "youtube",
      techOrder: ["youtube", "html5"],
      source: {
        src: url,
        type: "video/youtube"
      },
    };
  }

  if (isM3U8) {
    return {
      type: "hls",
      techOrder: ["html5"],
      html5: {
        hls: {
          overrideNative: true,
          enableLowLatency: true,
          smoothQualityChange: true,
          enableLowInitialPlaylist: true,
          withCredentials: false,
          maxPlaylistRetries: 5,
          bufferBehind: 30
        },
      },
      source: {
        src: url,
        type: "application/x-mpegURL",
      },
    };
  }

  if (isMPD) {
    return {
      type: "dash",
      techOrder: ["html5"],
      source: {
        src: url,
        type: "application/dash+xml",
      },
    };
  }

  if (isMP4) {
    return {
      type: "mp4",
      source: {
        src: url,
        type: "video/mp4"
      },
    };
  }

  if (isTS) {
    return {
      type: "ts",
      techOrder: ["html5"],
      source: {
        src: url,
        type: "video/mp2t"
      },
    };
  }

  console.warn("createStreamConfig: unknown format, using auto-detect →", url);

  return {
    type: "auto",
    techOrder: ["html5"],
    source: {
      src: url,
      type: "video/mp4"
    },
  };
}

/**
 * Build video.js player options
 */
function buildPlayerOptions(streamConfig, metadata) {
  const baseOptions = {
    autoplay: true,
    controls: false,
    preload: 'auto',
    fluid: true,
    liveui: metadata && (metadata.isLive === true || metadata.isLive === 'true'),
    responsive: true,
    techOrder: streamConfig.techOrder,
    sources: Array.isArray(streamConfig.source) ?
      streamConfig.source : (streamConfig.source ? [streamConfig.source] : []),
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
        mute: 1,
        rel: 0,
        disablekb: 1
      }
    };
  }

  /*   if (streamConfig.type === 'hls') {
          baseOptions.html5 = baseOptions.html5 || {};
           baseOptions.html5.vhs = Object.assign({}, baseOptions.html5.vhs || {}, {
                overrideNative: true,
                enableLowInitialPlaylist: true,
                smoothQualityChange: true,
                bandwidth: 4194304,
                withCredentials: false,
                limitRenditionByPlayerDimensions: false,
                useDevicePixelRatio: false,
                useNetworkInformationApi: false,
                maxPlaylistRetries: 5,
                experimentalBufferBasedABR: false,
                experimentalLLHLS: false,
                handleManifestRedirects: true,
                useBandwidthFromLocalStorage: false,
                timeout: 45000,
                enablePlaylistRefresh: true,
                playlistRefreshInterval: 30000,
                maxBufferLength: 30,
                maxBufferSize: 60 * 1024 * 1024,
                bufferBehind: 30
              });
          baseOptions.html5.nativeAudioTracks = false;
          baseOptions.html5.nativeVideoTracks = false;
    } */

  if (streamConfig.type === 'dash') {
    baseOptions.html5 = baseOptions.html5 || {};
    baseOptions.html5.vhs = Object.assign({}, (baseOptions.html5.vhs || {}), {
      overrideNative: true,
      withCredentials: false
    });
  }

  if (!baseOptions.sources || baseOptions.sources.length === 0) {
    console.warn('⚠️ buildPlayerOptions: sources are empty. Check streamConfig.source');
  }
  if (!baseOptions.techOrder || baseOptions.techOrder.length === 0) {
    console.warn('⚠️ buildPlayerOptions: techOrder is empty. Check streamConfig.techOrder');
  }

  return baseOptions;
}

/**
 * Resolve YouTube playback errors
 */
function resolveYouTubePlayback(player) {
  try {
    const src = player?.currentSrc?.();
    if (!src) return null;

    const videoId = extractYouTubeID(src);
    if (!videoId) return null;

    const liveFeeds = window.safeJSONParse ? window.safeJSONParse(
      window.LS_KEYS ? window.LS_KEYS.LIVE : "liveChannelsData",
      []
    ) : [];

    const match = liveFeeds.find(feed =>
      feed?.name &&
      document.body.textContent.includes(feed.name)
    );

    return match ? window.extractChannelId ? window.extractChannelId(match.url) : null : null;
  } catch {
    return null;
  }
}


/**
 * Extract YouTube ID from URL
 */
function extractYouTubeID(url) {
  if (!url) return null;
  const match = url.match(/(?:youtube\.com\/(?:.*v=|live\/|embed\/)|youtu\.be\/)([^&?/]+)/i);
  return match ? match[1] : null;
}


/**
 * Manages video player lifecycle with race condition protection
 * @class ChannelLoader
 * @param {Object} opts - Configuration options
 * @param {string} opts.playerContainerId - DOM container ID
 * @param {number} opts.persistDelay - Delay before persisting state
 */
class ChannelLoader {
  constructor(opts = {}) {
    this.currentOperation = null;
    this.currentOperationId = null;
    this.playerInstance = null;
    this.eventCleanupCallbacks = [];

    this.config = {
      playerContainerId: "player-container",
      persistDelay: 100,
      ...opts
    };

    this.setupGlobalCleanup();
  }

  /**
   * Sets up global cleanup handler
   */
  setupGlobalCleanup() {
    if (typeof appState?.addCleanup === "function") {
      appState.addCleanup(() => this.cleanupPlayer(true));
    }
  }

  /**
   * Binds event with automatic cleanup
   */
  bindEvent(player, event, handler) {
    if (!player) return;

    try {
      player.on?.(event, handler);

      this.eventCleanupCallbacks.push(() => {
        player.off?.(event, handler);
      });
    } catch (e) {
      console.warn("Event binding failed:", e);
    }
  }

  /**
   * Disposes video.js player with HLS cleanup
   */
  async disposePlayer(player) {
    if (!player) return;

    try {
      // Stop playback first
      player.pause?.();

      // Clean up HLS/VHS if present
      const tech = player.tech?.({ IWillNotUseThisInPlugins: true });
      const hls = tech?.hls || tech?.vhs;

      if (hls) {
        hls.dispose?.();
        hls.destroy?.();
      }

      // Dispose player
      player.dispose?.();
      await player.destroy?.();

      // Remove DOM elements
      const container = document.getElementById(this.config.playerContainerId);
      if (container) {
        container.querySelectorAll("video, .video-js").forEach(node => node.remove());
      }
    } catch (e) {
      console.warn("Player disposal error:", e);
    }
  }

  /**
   * Clean up current player instance
   */
  async cleanupPlayer(force = false) {
    stopWatching?.();

    if (this.playerInstance) {
      await this.disposePlayer(this.playerInstance);
    }

    this.playerInstance = null;
    this.cleanupEventListeners();

    const container = document.getElementById(this.config.playerContainerId);
    if (container) container.innerHTML = '';

    if (!force) {
      appState.set('player.instance', null);
      appState.set('player.currentChannel', null);
      appState.set("player.isPlaying", false);
    }
  }

  /**
   * Initialize Video.js player
   */
  async initializePlayer(url, name, isLive, token) {
    const container = await this.waitForElement("player-container");
    token.throwIfCancelled();

    const streamConfig = createStreamConfig(url);
    const videoId = `player-${Date.now()}`;

    // Create and setup video element
    container.innerHTML = "";
    container.appendChild(this.createVideoElement(videoId));

    await this.waitForElement(videoId);
    token.throwIfCancelled();

    // Initialize player
    const playerConfig = buildPlayerOptions(streamConfig, { isLive: !!isLive });
    console.log('🎬 Initializing Video.js player...');

    try {
      this.playerInstance = videojs(videoId, playerConfig);
      appState.set("player.instance", this.playerInstance);
    } catch (e) {
      console.error("❌ Player init failed:", e);
      throw e;
    }

    token.throwIfCancelled();
    if (!this.playerInstance) throw new Error("Player failed to initialize");

    // Setup player events and features
    this.setupPlayerEvents(name, isLive, streamConfig.type === 'youtube', token);

    if (streamConfig.type === 'hls') {
      this.setupHLSErrorRecovery();
    }
    if (streamConfig.type === 'youtube') {
      this.setupYouTubeQualityMonitoring(token);
    }

    await this.waitForPlayerReady(token);
    showChannelInfoOverlay();
    await this.attemptAutoplay();
    this.setupFullscreenCloseButton();

    return this.playerInstance;
  }

  /**
   * Cancel current loading operation
   */
  cancelOperation() {
    this.currentOperation?.cancel?.("New channel selected");
    this.currentOperation = null;
  }

  /**
   * Verify operation is still current
   */
  verifyOperation(expectedId, token) {
    token.throwIfCancelled();
    if (this.currentOperationId !== expectedId) {
      throw new Error("Operation superseded");
    }
  }

  /**
   * Load channel with race-condition protection
   */
  async loadChannel(url, name, image, description, number, isLive) {
    if (!url) return;

    this.cancelOperation();

    const token = new CancellationToken();
    this.currentOperation = token;
    const opId = Date.now() + Math.random();
    this.currentOperationId = opId;

    console.log(`🚀 Loading channel: ${name}`);

    try {
      this.verifyOperation(opId, token);
      appState.set("ui.isModalOpen", true);

      this.updateChannelUI(name, image, description, number);

      this.verifyOperation(opId, token);
      await this.cleanupPlayer();

      this.verifyOperation(opId, token);
      await this.initializePlayer(url, name, isLive, token);

      this.verifyOperation(opId, token);
      appState.set("player.currentChannel", {
        url, name, image, description, number, isLive
      });
      appState.set("player.isPlaying", true);

    } catch (err) {
      if (!token.isCancelled()) {
        console.error(`❌ Failed to load channel ${name}:`, err);
        showErrorToUser(`Failed to load ${name}: ${err.message}`);
      }
    } finally {
      if (this.currentOperationId === opId) {
        this.currentOperation = null;
      }
    }
  }

  /**
   * Update channel UI elements
   */
  updateChannelUI(name, image, description, number) {
    const updates = {
      'content-image': el => el.src = fixImageUrl(image),
      'video-title': el => el.textContent = name || 'Unknown Channel',
      'channel-description': el => el.textContent = description || '',
      'channel-number': el => el.textContent = number ? `${number}.` : '',
      'video-quality': el => el.textContent = ''
    };

    for (const [id, updateFn] of Object.entries(updates)) {
      const el = document.getElementById(id);
      if (el) {
        try {
          updateFn(el);
        } catch (e) {
          console.warn(`Failed to update ${id}:`, e);
        }
      }
    }

    appState.set('ui.lastFocusedElement', document.activeElement);
  }

  /**
   * Setup HLS error recovery
   */
  setupHLSErrorRecovery() {
    if (!this.playerInstance) return;

    try {
      const tech = this.playerInstance.tech?.({ IWillNotUseThisInPlugins: true });
      if (!tech?.vhs) return;

      let errorCount = 0;
      const maxErrors = 3;

      const errorHandler = () => {
        errorCount++;
        console.warn(`⚠️ HLS error detected (${errorCount}/${maxErrors})`);

        if (errorCount < maxErrors) {
          setTimeout(() => {
            tech.vhs.playlists.trigger?.('loadedplaylist');
          }, 1000);
        }
      };

      tech.vhs.on('error', errorHandler);
      this.eventCleanupCallbacks.push(() => tech.vhs.off?.('error', errorHandler));
    } catch (e) {
      console.warn("HLS recovery setup failed:", e);
    }
  }

  /**
   * Create video element
   */
  createVideoElement(id) {
    const video = document.createElement('video');
    video.id = id;
    video.className = 'video-js vjs-default-skin';
    video.controls = false;
    video.preload = 'auto';
    video.setAttribute("data-setup", "{}");
    return video;
  }

  /**
   * Wait for element to appear in DOM
   */
  waitForElement(id, timeout = PLAYBACK_CONSTANTS?.MAX_ELEMENT_WAIT_TIME || 5000) {
    return new Promise((resolve, reject) => {
      const existing = document.getElementById(id);
      if (existing) return resolve(existing);

      const observer = new MutationObserver(() => {
        const el = document.getElementById(id);
        if (el) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(el);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Element ${id} not found`));
      }, timeout);
    });
  }

  /**
   * Wait for player to be ready
   */
  async waitForPlayerReady(token, timeout = PLAYBACK_CONSTANTS?.PLAYER_READY_TIMEOUT || 10000) {
    if (!this.playerInstance) {
      throw new Error('No player instance');
    }

    return new Promise((resolve, reject) => {
      let isComplete = false;

      const timeoutId = setTimeout(() => {
        if (!isComplete) {
          isComplete = true;
          reject(new Error('Player ready timeout'));
        }
      }, timeout);

      this.playerInstance.ready(() => {
        if (isComplete) return;
        clearTimeout(timeoutId);

        if (token.isCancelled()) {
          isComplete = true;
          reject(new Error('Cancelled'));
          return;
        }

        isComplete = true;
        resolve();
      });
    });
  }

  /**
   * Attempt autoplay with fallback
   */
  async attemptAutoplay() {
    if (!this.playerInstance) return;

    try {
      await this.playerInstance.play();
    } catch (e) {
      console.warn('⚠️ Autoplay blocked:', e.message);
      this.showPlayButton();
    }
  }

  /**
   * Setup player event handlers
   */
  setupPlayerEvents(channelName, isLive, isYouTube, token) {
    if (!this.playerInstance) return;

    // Clear existing events
    this.playerInstance.off?.();

    const handlers = {
      error: (e) => this.handlePlayerError(e, channelName, isYouTube, token),
      waiting: () => this.handlePlayerWaiting(token),
      playing: () => this.handlePlayerPlaying(channelName, token),
      pause: () => this.handlePlayerPause(token),
      ended: () => this.handlePlayerEnded(token),
      loadedmetadata: () => this.handleMetadataLoaded(isLive, isYouTube)
    };

    // Bind events
    Object.entries(handlers).forEach(([event, handler]) => {
      this.bindEvent(this.playerInstance, event, handler);
    });
  }

  /**
   * Handle player error
   */
  handlePlayerError(e, channelName, isYouTube, token) {
    if (token.isCancelled()) return;

    const error = this.playerInstance.error();
    console.error('🚨 Player error:', error);

    // Handle YouTube specific error
    if (isYouTube && error?.code === 1150) {
      this.handleYouTubeError1150(channelName);
      return;
    }

    // Handle generic errors
    switch (error?.code) {
      case 2: // Network error
        this.handleNetworkError();
        break;
      case 3: // Decoding error
      case 4: // Source not supported
        showErrorToUser('Stream format not supported');
        break;
    }

    stopWatching();
  }

  /**
   * Handle YouTube error 1150
   */
  handleYouTubeError1150(channelName) {
    console.warn('⚠️ YouTube Error 1150 detected');

    const channelId = resolveYouTubePlayback?.(this.playerInstance);
    if (channelId) {
      liveRetryManager?.recordFailure(channelId, 'YouTube error 1150');
    }

    showErrorToUser('This live stream is temporarily unavailable. It will be retried automatically.');
    this.playerInstance.pause?.();
    stopWatching();
  }

  /**
   * Handle network error
   */
  handleNetworkError() {
    console.warn('⚠️ Network error - attempting recovery...');

    if (!navigator.onLine) {
      showNotification('Network offline. Please check connection.', 'error');
      return;
    }

    setTimeout(() => {
      if (this.playerInstance) {
        console.log('🔄 Attempting to reload stream...');
        this.playerInstance.src(this.playerInstance.currentSrc());
        this.playerInstance.play().catch(e => {
          console.error('❌ Reload failed:', e);
          showErrorToUser('Stream failed to load. Please check network connection.');
        });
      }
    }, PLAYBACK_CONSTANTS?.MAX_ELEMENT_WAIT_TIME || 2000);
  }

  /**
   * Handle player waiting/buffering
   */
  handlePlayerWaiting(token) {
    if (token.isCancelled()) return;
    showNotification('Buffering...', 'info');
  }

  /**
   * Handle player playing
   */
  handlePlayerPlaying(channelName, token) {
    if (token.isCancelled()) return;
    startWatching(channelName);
  }

  /**
   * Handle player pause
   */
  handlePlayerPause(token) {
    if (token.isCancelled()) return;
    stopWatching();
  }

  /**
   * Handle player ended
   */
  handlePlayerEnded(token) {
    if (token.isCancelled()) return;
    stopWatching();
    navigateToNextChannel?.();
  }

  /**
   * Handle metadata loaded
   */
  handleMetadataLoaded(isLive, isYouTube) {
    try {
      this.updateQualityDisplay?.();

      // Show controls for non-live, non-YouTube content
      const showControls = !isLive && !isYouTube;
      this.playerInstance.controls(showControls);
    } catch (e) {
      // Ignore
    }
  }

  /**
   * Setup YouTube quality monitoring
   */
  setupYouTubeQualityMonitoring(token, maxAttempts = 30) {
    let attempts = 0;

    const check = () => {
      if (token.isCancelled() || attempts >= maxAttempts) return;

      attempts++;

      try {
        const tech = this.playerInstance.tech?.({ IWillNotUseThisInPlugins: true });
        if (!tech?.ytPlayer) {
          setTimeout(check, PLAYBACK_CONSTANTS?.YOUTUBE_READY_CHECK_INTERVAL || 500);
          return;
        }

        const handler = (event) => {
          const qEl = document.getElementById('video-quality');
          if (qEl) qEl.textContent = event.data || 'auto';
        };

        tech.ytPlayer.addEventListener('onPlaybackQualityChange', handler);
        this.eventCleanupCallbacks.push(() => {
          tech.ytPlayer.removeEventListener?.('onPlaybackQualityChange', handler);
        });
      } catch (e) {
        setTimeout(check, PLAYBACK_CONSTANTS?.YOUTUBE_READY_CHECK_INTERVAL || 500);
      }
    };

    check();
  }

  /**
   * Update quality display
   */
  updateQualityDisplay() {
    const qEl = document.getElementById('video-quality');
    if (!qEl || !this.playerInstance) return;

    try {
      const height = this.playerInstance.videoHeight?.() || 0;
      qEl.textContent = height ? `${height}p` : 'Auto';
    } catch (e) {
      // Ignore
    }
  }

  /**
   * Show play button fallback
   */
  showPlayButton() {
    const existing = document.querySelector('.play-fallback-overlay');
    existing?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'play-fallback-overlay';
    overlay.style.cssText = `
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.7);
      z-index: 100;
      cursor: pointer;
    `;

    const button = document.createElement('button');
    button.className = 'play-button';
    button.textContent = '▶️ Click to Play';
    button.style.cssText = `
      padding: 12px 20px;
      background: #e74c3c;
      color: #fff;
      border-radius: 8px;
      border: 0;
      font-weight: 700;
      font-size: 16px;
      cursor: pointer;
    `;

    overlay.appendChild(button);

    const clickHandler = async (e) => {
      e.stopPropagation();
      if (!this.playerInstance) return;

      try {
        await this.playerInstance.play();
        overlay.remove();
      } catch (err) {
        showErrorToUser('Could not start playback');
      }
    };

    overlay.addEventListener('click', clickHandler);

    const container = document.getElementById('player-container');
    if (container) container.appendChild(overlay);

    this.eventCleanupCallbacks.push(() => {
      overlay.removeEventListener('click', clickHandler);
      overlay.remove();
    });
  }

  /**
   * Clean up event listeners
   */
  cleanupEventListeners() {
    this.eventCleanupCallbacks.forEach(fn => {
      try {
        fn();
      } catch (e) {
        // Ignore cleanup errors
      }
    });
    this.eventCleanupCallbacks = [];
  }

  /**
   * Setup fullscreen close button
   */
  setupFullscreenCloseButton() {
    if (!this.playerInstance) return;

    const playerEl = this.playerInstance.el?.();
    if (!playerEl) return;

    const closeBtn = document.createElement('button');
    closeBtn.id = 'fullscreenCloseBtn';
    closeBtn.className = 'fullscreen-close-button';
    closeBtn.innerHTML = '<i class="fas fa-compress"></i>';
    closeBtn.style.display = 'none';
    closeBtn.onclick = () => toggleFullscreen?.();

    playerEl.appendChild(closeBtn);

    const updateVisibility = () => {
      closeBtn.style.display = this.playerInstance?.isFullscreen?.() ? 'flex' : 'none';
    };

    this.bindEvent(this.playerInstance, 'fullscreenchange', updateVisibility);
    document.addEventListener('fullscreenchange', updateVisibility);

    this.eventCleanupCallbacks.push(() => {
      document.removeEventListener('fullscreenchange', updateVisibility);
      closeBtn.remove();
    });
  }

  /**
   * Get current player instance
   */
  getPlayer() {
    return this.playerInstance;
  }
}

// Export singleton instance
const channelLoader = new ChannelLoader();

// ============================================
// CHANNEL SELECTION & PLAYBACK
// ============================================

/**
 * Select and load channel
 */
async function selectChannel(url, name, image, description, number, isLive) {
  if (!url) return;

  appState.set("ui.isModalOpen", true);
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

/**
 * Show channel info overlay
 */
function showChannelInfoOverlay() {
  const overlay = document.getElementById('channel-info-overlay');
  if (!overlay) return;
  const modal = document.getElementById('videoModal');
  if (modal) {
    modal.style.display = 'flex';
    modal.classList.remove('hidden');
  }
  overlay.classList.remove('show');
  appState.clearTimeoutRef('overlayShow');
  appState.clearTimeoutRef('overlayHide');
  const sid = setTimeout(() => overlay.classList.add('show'), 300);
  const hid = setTimeout(() => overlay.classList.remove('show'), 6000);
  appState.setTimeoutRef('overlayShow', sid);
  appState.setTimeoutRef('overlayHide', hid);
}

/**
 * Close video modal
 */
function closeModal() {
  const modal = document.getElementById('videoModal');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.add('hidden');
  }

  try {
    appState.clearTimeoutRef('promptTimeout');
    if (typeof removeFullscreenPrompt === 'function') removeFullscreenPrompt(true);
  } catch (e) {
    console.warn('Error clearing fullscreen prompt during modal close', e);
  }

  if (window.player && typeof window.player.dispose === 'function') {
    window.player.dispose();
    window.player = null;
  }

  try {
    channelLoader.cleanupPlayer().catch(e => console.warn('⚠️ Error during player cleanup:', e));
  } catch (e) {
    console.error("Error cleaning up player:", e);
  }

  try {
    renderRecentlyWatched();
    updateAllChannelItems();
  } catch (e) {
    console.error("Error updating UI:", e);
  }

  const lastFocused = appState.get('ui.lastFocusedElement');
  const items = appState.get('uiCollections.allChannelItems') || [];
  if (lastFocused && lastFocused.isConnected) {
    try {
      lastFocused.focus();
    } catch (e) {
      console.error("Error focusing last element:", e);
    }
    appState.set('ui.focusedIndex', items.indexOf(lastFocused));
  } else if (items.length > 0) {
    try {
      items[0].focus();
    } catch (e) {
      console.error("Error focusing first item:", e);
    }
    appState.set('ui.focusedIndex', 0);
  }

  appState.set('ui.isModalOpen', false);
  appState.set('player.currentChannel', null);
}

// ============================================
// FULLSCREEN MANAGEMENT
// ============================================

/**
 * Show fullscreen prompt
 */
function showFullscreenPrompt() {
  const modal = document.getElementById('videoModal');
  if (!modal || modal.style.display !== 'flex') return;

  if (window.fullscreenPrompt) {
    appState.clearTimeoutRef('promptTimeout');
    const tid = setTimeout(() => removeFullscreenPrompt(), 8000);
    appState.setTimeoutRef('promptTimeout', tid);
    return;
  }

  removeFullscreenPrompt(true);

  const el = document.createElement('div');
  el.className = 'minimal-fullscreen-prompt';
  el.innerHTML = `
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

  modal.appendChild(el);
  window.fullscreenPrompt = el;

  const prevBtn = el.querySelector('#promptPrevBtn');
  const nextBtn = el.querySelector('#promptNextBtn');
  const fsBtn = el.querySelector('#promptFullscreenBtn');
  const closeBtn = el.querySelector('.prompt-close');

  const promptHandlers = {
    prev: (e) => {
      e.stopPropagation();
      navigateToPreviousChannel();
      removeFullscreenPrompt();
    },
    next: (e) => {
      e.stopPropagation();
      navigateToNextChannel();
      removeFullscreenPrompt();
    },
    fs: (e) => {
      e.stopPropagation();
      toggleFullscreen();
      removeFullscreenPrompt();
    },
    close: (e) => {
      e.stopPropagation();
      removeFullscreenPrompt();
    }
  };

  prevBtn && prevBtn.addEventListener('click', promptHandlers.prev);
  nextBtn && nextBtn.addEventListener('click', promptHandlers.next);
  fsBtn && fsBtn.addEventListener('click', promptHandlers.fs);
  closeBtn && closeBtn.addEventListener('click', promptHandlers.close);

  appState.clearTimeoutRef('promptTimeout');
  const tid = setTimeout(() => removeFullscreenPrompt(), 8000);
  appState.setTimeoutRef('promptTimeout', tid);

  appState.addCleanup(() => removeFullscreenPrompt(true));
}

/**
 * Remove fullscreen prompt
 */
function removeFullscreenPrompt(forceImmediate = false) {
  appState.clearTimeoutRef('promptTimeout');
  const el = window.fullscreenPrompt;
  if (!el) return;

  try {
    const btns = el.querySelectorAll('button');
    btns.forEach(btn => {
      btn.replaceWith(btn.cloneNode(true));
    });
  } catch (e) {
    console.warn(e);
  }

  if (forceImmediate) {
    if (el.parentNode) el.parentNode.removeChild(el);
    window.fullscreenPrompt = null;
  } else {
    el.classList.add('fade-out');
    setTimeout(() => {
      if (window.fullscreenPrompt?.parentNode) {
        window.fullscreenPrompt.parentNode.removeChild(window.fullscreenPrompt);
      }
      window.fullscreenPrompt = null;
    }, 250);
  }
}

/**
 * Toggle fullscreen mode
 */
function toggleFullscreen() {
  const player = channelLoader.getPlayer();
  const modal = document.getElementById('videoModal');

  if (!player || !modal || modal.style.display !== 'flex') return;

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
// WATCH TIME TRACKING
// ============================================

/**
 * Start watching timer
 */
function startWatching(channelId) {
  stopWatching();

  if (!channelId) {
    console.warn("⚠️ No channel name provided to start watching");
    showNotification("Cannot start watching: missing channel name", "error");
    return;
  }

  const now = Date.now();
  appState.set("player.currentChannelId", channelId);
  appState.set("player.watchStartTime", now);

  const id = setInterval(saveCurrentWatchTime, 10000);
  appState.setIntervalRef("watch", id);

  console.log(`▶️ Started watching: ${channelId}`);
}

/**
 * Stop watching timer
 */
function stopWatching() {
  const channelId = appState.get("player.currentChannelId");
  if (!channelId) return;

  appState.clearIntervalRef("watch");
  saveCurrentWatchTime();

  appState.set("player.currentChannelId", "");
  appState.set("player.watchStartTime", 0);
}

/**
 * Save current watch time
 */
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

/**
 * Load watch time data
 */
function loadWatchTime() {
  try {
    const data = localStorage.getItem(LS_KEYS.WATCH_TIME);
    if (!data) return {};

    return JSON.parse(data);
  } catch (e) {
    console.error("Error loading watch time:", e);
    try {
      localStorage.removeItem(LS_KEYS.WATCH_TIME);
    } catch { }
    showNotification('Watch history data corrupted - resetting', 'warning');
    return {};
  }
}

/**
 * Sort channels by watch time
 */
function sortChannelsByWatchTime(channels) {
  const watchData = loadWatchTime();
  return channels.slice().sort((a, b) => {
    const aTime = watchData[a.name] || 0;
    const bTime = watchData[b.name] || 0;
    return bTime - aTime;
  });
}

// ============================================
// CHANNEL UI RENDERING
// ============================================

/**
 * Enhanced createChannelItem with lazy loading
 */
function createChannelItem(channel) {
  const item = document.createElement('div');
  const numberText = channel.number || '';

  item.className = 'content-card channel-item';

  item.setAttribute('role', 'button');
  item.setAttribute('aria-label',
    `${channel.name}, Channel ${channel.number}${channel.isLive ? ', Live' : ''}`
  );
  item.setAttribute('aria-pressed', 'false');
  item.setAttribute('tabindex', '-1');

  if (channel.isLive) {
    item.setAttribute('aria-live', 'polite');
    item.setAttribute('aria-atomic', 'true');
  }

  item.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      item.click();
    }
  });

  item.dataset.url = channel.url || '';
  item.dataset.name = channel.name || '';
  item.dataset.image = channel.image || '';
  item.dataset.description = channel.description || '';
  item.dataset.number = numberText;
  item.dataset.isLive = channel.isLive;
  item.dataset.category = channel.category || 'Unknown';

  const clickHandler = (e) => {
    e.stopPropagation();
    if (e.target.classList.contains('favorite-icon') ||
      e.target.closest('.favorite-icon')) {
      return;
    }
    selectChannel(
      channel.url, channel.name, channel.image,
      channel.description, channel.number, channel.isLive
    );
    saveRecentlyWatched(channel);
  };

  item.addEventListener('click', clickHandler);

  item._cleanupHandlers = [
    () => item.removeEventListener('click', clickHandler)
  ];

  const thumb = document.createElement('div');
  thumb.className = 'thumb-wrapper';

  const img = document.createElement('img');
  const imageUrl = fixImageUrl(channel.image);

  img.dataset.src = imageUrl;

  img.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"%3E%3Crect fill="%23333" width="200" height="200"/%3E%3Ctext x="50%25" y="50%25" fill="%23666" font-size="20" text-anchor="middle" dominant-baseline="middle"%3ELoading...%3C/text%3E%3C/svg%3E';

  img.alt = `${channel.name || 'Channel'} Logo`;
  img.loading = 'lazy';
  img.decoding = 'async';

  img.onerror = function () {
    this.src = 'placeholder.png';
    this.alt = 'Image not available';
  };

  if (!window.lazyLoadObserver) {
    initializeLazyLoading();
  } else {
    window.lazyLoadObserver.observe(img);
  }

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

  const favoriteHandler = (e) => {
    e.stopPropagation();
    toggleFavorite(
      channel.url,
      channel.name,
      channel.image,
      channel.description,
      channel.number,
      channel.isLive,
      channel.category,
      e
    );
  };

  favoriteIcon.addEventListener('click', favoriteHandler);
  item._cleanupHandlers.push(
    () => favoriteIcon.removeEventListener('click', favoriteHandler)
  );

  if (isFavorite(channel.url)) {
    favoriteIcon.classList.add('active');
  }

  item.appendChild(thumb);
  item.appendChild(favoriteIcon);

  return item;
}
/**
 * Observe all unobserved images (useful after dynamic content load)
 */
function observeNewImages() {
  if (!window.lazyLoadObserver) {
    initializeLazyLoading();
  }

  const images = document.querySelectorAll('img[data-src]:not(.loaded):not(.loading)');
  images.forEach(img => {
    window.lazyLoadObserver.observe(img);
  });
}

/**
 * Cleanup channel items
 */
function cleanupChannelItems() {
  const arr = appState.get('uiCollections.allChannelItems') || [];
  arr.forEach(item => {
    if (item._cleanupHandlers) {
      item._cleanupHandlers.forEach(cleanup => {
        try {
          cleanup();
        } catch (e) { }
      });
      delete item._cleanupHandlers;
    }

    if (!item.isConnected) {
      try {
        item.remove();
      } catch (e) { }
    }
  });
  appState.set('uiCollections.allChannelItems', []);
}

/**
 * Cleanup single channel item
 */
function cleanupChannelItem(item) {
  if (item._cleanupHandlers) {
    item._cleanupHandlers.forEach(fn => {
      try {
        fn();
      } catch (e) { }
    });
    delete item._cleanupHandlers;
  }
  try {
    item.remove();
  } catch (e) { }
}

/**
 * Create or update category heading
 */
function createOrUpdateHeading(category, count) {
  let heading = document.querySelector(`h2[data-category="${category}"]`);
  if (!heading) {
    heading = document.createElement("h2");
    heading.dataset.category = category;
    heading.className = "text-xl font-bold mt-6 mb-4 col-span-full dynamic-heading";
    heading.textContent = `${category} (${count})`;
  } else {
    heading.textContent = `${category} (${count})`;
  }
  return heading;
}

/**
 * Create or update grid container
 */
function createOrUpdateGrid(category) {
  let grid = document.querySelector(`.content-grid[data-category="${category}"]`);
  if (!grid) {
    grid = document.createElement("div");
    grid.className = "content-grid";
    grid.dataset.category = category;
  } else {
    grid.querySelectorAll(".channel-item").forEach(item => {
      if (!item._keep) cleanupChannelItem(item);
    });
  }
  return grid;
}

/**
 * Renders channels with intelligent DOM reuse for performance,
 * but forces fresh rebuilds during search to ensure clickability.
 */
function renderChannels(channels) {
  const main = document.getElementById('channels');
  if (!main) return;

  cleanupChannelItems();

  const isSearching = appState.get('channels.searchQuery') !== '';
  const sortMethod = appState.get('ui.sortMethod') || 'none';

  const shouldReuseDOM = !isSearching && channels.length > 50;

  const existingItems = new Map();
  if (shouldReuseDOM) {
    main.querySelectorAll('.channel-item').forEach(item => {
      if (item.dataset.url) {
        existingItems.set(item.dataset.url, item);
      }
    });
  }

  const fragment = document.createDocumentFragment();

  const categorized = (sortMethod === 'none' && !isSearching) ?
    channels.reduce((acc, ch) => {
      const c = ch.category || 'Unknown';
      (acc[c] || (acc[c] = [])).push(ch);
      return acc;
    }, {}) : {
      [isSearching ? 'Search Results' : 'All Channels']: channels
    };

  if (!shouldReuseDOM) {
    main.innerHTML = '';
  }

  for (const [category, categoryChannels] of Object.entries(categorized)) {
    if (categoryChannels.length === 0) continue;

    const heading = createOrUpdateHeading(category, categoryChannels.length);
    const grid = createOrUpdateGrid(category);

    categoryChannels.forEach(channel => {
      let itemNode = null;

      if (shouldReuseDOM && channel.url) {
        itemNode = existingItems.get(channel.url);
        if (itemNode) {
          existingItems.delete(channel.url);
        }
      }

      if (!itemNode) {
        itemNode = createChannelItem(channel);
      }

      grid.appendChild(itemNode);
    });

    fragment.appendChild(heading);
    fragment.appendChild(grid);
  }

  if (shouldReuseDOM) {
    existingItems.forEach(item => cleanupChannelItem(item));
    main.querySelectorAll('.content-grid, .dynamic-heading').forEach(el => el.remove());
    main.appendChild(fragment);
  } else {
    main.appendChild(fragment);
  }

  updateAllChannelItems();

  if (window.lazyLoadObserver) {
    observeNewImages();
  }

  if (isSearching) {
    hideFavoritesAndRecent();
  } else {
    showFavoritesAndRecent();
  }
}

/**
 * Render favorites section
 */
function renderFavorites() {
  const container = document.getElementById('favoritesGrid');
  if (!container) return;

  const favorites = getFavorites();
  const favSection = document.getElementById('favorites');
  const frag = document.createDocumentFragment();

  if (!favorites || favorites.length === 0) {
    if (favSection) favSection.style.display = 'grid';
    const emptyMsg = document.createElement('p');
    emptyMsg.className = 'text-gray-400 col-span-full text-center';
    emptyMsg.textContent = 'No favorites yet';
    frag.appendChild(emptyMsg);
  } else {
    if (favSection) favSection.style.display = 'grid';
    favorites.forEach(ch => frag.appendChild(createChannelItem(ch)));
  }

  container.innerHTML = '';
  container.appendChild(frag);
}

/**
 * Render recently watched section
 */
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

/**
 * Update favorite icons state
 */
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

/**
 * Update all channel items reference
 */
function updateAllChannelItems() {
  const items = Array.from(document.querySelectorAll('.channel-item'));
  appState.set('uiCollections.allChannelItems', items);
}

// ============================================
// SEARCH FUNCTIONALITY
// ============================================

/**
 * Search channels
 */
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

/**
 * Clear search
 */
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

/**
 * Hide favorites and recent sections
 */
function hideFavoritesAndRecent() {
  const fav = document.getElementById('favorites');
  if (fav) fav.style.display = 'none';
  const recent = document.getElementById('recentlyWatched');
  if (recent) recent.style.display = 'none';
}

/**
 * Show favorites and recent sections
 */
function showFavoritesAndRecent() {
  const favs = getFavorites();
  const favSection = document.getElementById('favorites');
  if (favSection && favs.length > 0) favSection.style.display = 'grid';

  const rec = getRecentlyWatched();
  const recSection = document.getElementById('recentlyWatched');
  if (recSection && rec.length > 0) recSection.style.display = 'grid';
}

/**
 * Setup search bar functionality
 */
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

// ============================================
// SORTING FUNCTIONALITY
// ============================================

/**
 * Sort channels and render
 */
function sortChannelsAndRender(sortMethod = 'none') {
  const isSearching = appState.get('channels.searchQuery') !== '';
  const channelsToSort = (isSearching ? appState.get('channels.filtered') : appState.get('channels.all')) || [];
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
      break;
  }

  appState.set('ui.sortMethod', sortMethod);
  renderChannels(sorted);
  renderFavorites();
  updateFavoriteIcons();
  renderRecentlyWatched();
  updateAllChannelItems();

  if (isSearching) {
    hideFavoritesAndRecent();
  } else {
    showFavoritesAndRecent();
  }
}

/**
 * Handle sort change
 */
function handleSortChange(sortMethod) {
  localStorage.setItem("defaultSortMethod", sortMethod);
  sortChannelsAndRender(sortMethod);
  updateSortButtons(sortMethod);

  if (!appState.get('channels.searchQuery')) {
    showFavoritesAndRecent();
  }
}

/**
 * Update sort buttons state
 */
function updateSortButtons(method) {
  if (!method) return;

  const buttons = Array.from(document.querySelectorAll('.sort-controls button'));
  if (!buttons.length) return;

  buttons.forEach(btn => {
    btn.classList.remove('active');
    btn.setAttribute('aria-pressed', 'false');
  });

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

/**
 * Get grid columns count
 */
function getGridColumns() {
  const grid = document.querySelector('.content-grid');
  if (!grid) return 1;
  const cols = window.getComputedStyle(grid).getPropertyValue('grid-template-columns');
  if (!cols) return 1;
  return cols.split(' ').length;
}

/**
 * Setup keyboard navigation
 */
function setupKeyboardNavigation() {
  const numberKeyHandler = handleNumberKeyPress.bind(null);
  const navigationKeyHandler = handleNavigationKeys.bind(null);

  document.addEventListener("keydown", numberKeyHandler);
  document.addEventListener("keydown", navigationKeyHandler);

  appState.addCleanup(() => {
    document.removeEventListener("keydown", numberKeyHandler);
    document.removeEventListener("keydown", navigationKeyHandler);
  });
}

/**
 * Handle number key press for channel jumping
 */
function handleNumberKeyPress(e) {
  const searchInputDesktop = document.getElementById('channelSearchDesktop');
  const searchInputMobile = document.getElementById('channelSearchMobile');

  if ((searchInputDesktop && document.activeElement === searchInputDesktop) ||
    (searchInputMobile && document.activeElement === searchInputMobile)) {
    return;
  }

  const focusedTag = (document.activeElement?.tagName || '').toLowerCase();
  if (focusedTag === 'input' || focusedTag === 'textarea') return;

  if (e.key >= "0" && e.key <= "9") {
    const currentBuffer = appState.get('ui.numberBuffer') || '';
    appState.set('ui.numberBuffer', currentBuffer + e.key);

    const overlay = document.getElementById("channel-number-overlay");
    if (overlay) {
      overlay.textContent = appState.get('ui.numberBuffer');
      overlay.style.display = "block";
    }

    appState.clearTimeoutRef('numberTimeout');

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
            item.scrollIntoView({
              behavior: "smooth",
              block: "center"
            });
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
  const prevTimeout = appState.get('intervals.navigationDebounce');
  if (prevTimeout) clearTimeout(prevTimeout);

  const timeoutId = setTimeout(() => {
    const GRID_COLUMNS = getGridColumns();
    const modal = document.getElementById("videoModal");
    const isModalOpen = appState.get('ui.isModalOpen') || (modal && modal.style.display === "flex");

    const allChannelItems = appState.get('uiCollections.allChannelItems') || [];
    const focusedElement = document.activeElement;
    let currentFocusedIndex = allChannelItems.findIndex((item) => item === focusedElement);

    if (isModalOpen) {
      if (event.key === "Enter" || event.key === "OK") {
        event.preventDefault();
        event.stopPropagation();
        toggleFullscreen();
        return;
      }

      if (
        event.key === "Escape" ||
        event.key === "ArrowLeft" ||
        event.key === "Backspace" ||
        event.key === "BrowserBack" ||
        event.key === "GoBack"
      ) {
        event.preventDefault();
        event.stopPropagation();
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
        const {
          url,
          name,
          image,
          description,
          number,
          isLive = "false",
          category = "Unknown"
        } = newChannelCard.dataset;

        newChannelCard.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
        selectChannel(url, name, image, description, number, isLive);
        saveRecentlyWatched({
          name,
          url,
          image,
          description,
          number,
          isLive,
          category
        });

        appState.set('ui.lastFocusedElement', newChannelCard);
      }
      return;
    }

    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();

      if (allChannelItems.length === 0) return;

      if (currentFocusedIndex === -1) {
        allChannelItems[0].focus();
        allChannelItems[0].scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
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
        newCard.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
        appState.set('ui.focusedIndex', newIndex);
      }
    } else if (["PageUp", "PageDown", "Home", "End"].includes(event.key)) {
      event.preventDefault();

      if (allChannelItems.length === 0) return;

      if (currentFocusedIndex === -1) {
        allChannelItems[0].focus();
        allChannelItems[0].scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
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
        newCard.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
        appState.set('ui.focusedIndex', newIndex);
      }
    } else if (event.key === "Enter" && currentFocusedIndex !== -1) {
      event.preventDefault();

      const card = allChannelItems[currentFocusedIndex];
      if (!card) return;

      const {
        url,
        name,
        image,
        description,
        number,
        isLive = "false",
        category = "Unknown"
      } = card.dataset;

      card.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
      selectChannel(url, name, image, description, number, isLive);
      saveRecentlyWatched({
        name,
        url,
        image,
        description,
        number,
        isLive,
        category
      });
    }

    appState.setTimeoutRef('navigationDebounce', null);
  }, 50);

  appState.setTimeoutRef('navigationDebounce', timeoutId);
}


class RetryManager {
  constructor(storageKey, options = {}) {
    this.storageKey = storageKey;
    this.maxRetries = options.maxRetries ?? 5;
    this.baseDelay = options.baseDelay ?? 60_000;
  }

  _load() {
    const raw = localStorage.getItem(this.storageKey);
    return safeJSONParse(raw, {}) || {};
  }

  _save(data) {
    localStorage.setItem(this.storageKey, JSON.stringify(data));
  }

  _createRetryEntry(currentEntry = {
    retries: 0
  }) {
    const retries = currentEntry.retries + 1;
    return {
      retries,
      nextRetry: Date.now() + this.baseDelay * Math.pow(2, retries - 1),
      lastAttempt: Date.now()
    };
  }

  recordFailure(id, error = "Unknown error") {
    const data = this._load();
    const entry = this._createRetryEntry(data[id]);
    entry.lastError = error;
    data[id] = entry;
    this._save(data);
  }

  recordSuccess(id) {
    const data = this._load();
    if (data[id]) {
      delete data[id];
      this._save(data);
    }
  }

  shouldRetry(id) {
    const entry = this._load()[id];
    if (!entry) return false;
    return entry.retries < this.maxRetries && Date.now() >= entry.nextRetry;
  }

  hasPending() {
    const data = this._load();
    return Object.values(data).some(entry => entry.retries < this.maxRetries);
  }

  hasReadyRetries() {
    const data = this._load();
    return Object.values(data).some(
      entry => entry.retries < this.maxRetries && Date.now() >= entry.nextRetry
    );
  }

  getPendingIds() {
    const data = this._load();
    return Object.keys(data).filter(id => this.shouldRetry(id));
  }

  isBlocked(id) {
    const entry = this._load()[id];
    if (!entry) return false;
    return entry.retries >= this.maxRetries || Date.now() < entry.nextRetry;
  }

  getStats() {
    const data = this._load();
    const entries = Object.values(data);
    const now = Date.now();

    return {
      total: entries.length,
      blocked: entries.filter(e => e.retries >= this.maxRetries).length,
      pending: entries.filter(e => e.retries < this.maxRetries && now < e.nextRetry).length,
      ready: entries.filter(e => e.retries < this.maxRetries && now >= e.nextRetry).length
    };
  }

  cleanup(maxAge = 24 * 60 * 60 * 1000) {
    const data = this._load();
    const now = Date.now();
    const cleaned = {};
    let removed = 0;

    for (const [id, entry] of Object.entries(data)) {
      const shouldKeep = entry.retries < this.maxRetries ||
        (now - entry.lastAttempt) < maxAge;
      if (shouldKeep) {
        cleaned[id] = entry;
      } else {
        removed++;
      }
    }

    if (removed > 0) {
      this._save(cleaned);
      console.log(`🧹 RetryManager cleanup: removed ${removed} old entries`);
    }

    return removed;
  }
}


function extractChannelId(feedUrl) {
  const match = feedUrl.match(/channel_id=([^&]+)/);
  return match?.[1] ?? null;
}

function youtubeItemToChannel(videoId, title, feed = {}) {
  if (!feed || typeof feed !== 'object') {
    console.error('❌ youtubeItemToChannel: Invalid feed object', feed);
    feed = {};
  }

  return {
    url: `https://www.youtube.com/watch?v=${videoId}`,
    name: feed.name || 'Unknown Channel',
    image: feed.image || '',
    category: feed.category || "> Person <",
    description: title || 'No description'
  };
}

function updateOrAddChannel(channelObj) {
  if (!channelObj || typeof channelObj !== 'object') {
    console.error('❌ updateOrAddChannel: Invalid channel object', channelObj);
    return;
  }

  const channels = appState.get('channels.all') || [];
  const existingIndex = channels.findIndex(ch => ch?.name === channelObj.name);

  if (existingIndex !== -1) {
    const existing = channels[existingIndex];
    channels[existingIndex] = {
      ...existing,
      ...channelObj
    };
  } else {
    channels.push(channelObj);
  }

  appState.set('channels.all', channels);
}

function processRSSData(data, feed) {
  if (!feed || typeof feed !== 'object') {
    console.error('❌ processRSSData: Invalid feed object', feed);
    return;
  }

  if (!data?.items?.length) return;

  const latestValid = data.items.find(item =>
    item?.link && !item.link.includes("/shorts/")
  );
  if (!latestValid) return;

  const videoId = extractYouTubeID(latestValid.link);
  if (!videoId) return;

  const channelObj = youtubeItemToChannel(videoId, latestValid.title, feed);
  updateOrAddChannel(channelObj);
  console.log(`✅ RSS updated: ${feed.name}`);
}

class FeedProcessor {
  constructor(type, cache, retryManager) {
    this.type = type;
    this.cache = cache;
    this.retryManager = retryManager;
    this.storageKey = type === 'rss' ? LS_KEYS.FEEDS : LS_KEYS.LIVE;
  }

  async loadFeeds(options = {}) {
    const {
      force = false, signal
    } = options;

    const feeds = this._loadFeedsFromStorage();
    if (!feeds.length) return null;

    const feedsToProcess = this._getFeedsToProcess(feeds, force);
    const results = {
      successful: 0,
      failed: 0,
      cacheHits: 0
    };

    for (const [index, feed] of feedsToProcess.entries()) {
      if (index > 0) await this._delay(index);
      await this._processFeed(feed, signal, results);
    }

    this._cleanupAndLog(results);
    return results;
  }

  _loadFeedsFromStorage() {
    const stored = localStorage.getItem(this.storageKey);
    if (!stored) {
      showNotification(`No ${this.type} feeds found in localStorage.`, "warning");
      return [];
    }

    try {
      return JSON.parse(stored);
    } catch (error) {
      console.error(`Failed to parse ${this.type} feeds:`, error);
      showNotification(`Error loading ${this.type} feeds data.`, "error");
      return [];
    }
  }

  _getFeedsToProcess(feeds, force) {
    if (!force && this.retryManager.hasReadyRetries()) {
      const retryIds = new Set(this.retryManager.getPendingIds());
      const filtered = feeds.filter(feed => retryIds.has(this._getFeedId(feed)));
      console.log(`🔁 Retrying → ${filtered.length} failed ${this.type.toUpperCase()} feeds`);
      return filtered;
    }
    return feeds;
  }

  _getFeedId(feed) {
    return this.type === 'rss' ? feed.url : extractChannelId(feed.url);
  }

  _delay(index) {
    const delayMs = this.type === 'rss' ? 200 : 300;
    return new Promise(resolve => setTimeout(resolve, delayMs));
  }

  _cleanupAndLog(results) {
    try {
      this.cache.pruneExpired?.();
    } catch (e) {
      /* ignore */
    }

    console.log(
      `${this.type.toUpperCase()} update summary → ` +
      `success: ${results.successful}, failed: ${results.failed}, cache hits: ${results.cacheHits}`
    );
    console.log(`📊 ${this.type.toUpperCase()} Cache Stats:`, this.cache.getStats?.());
    console.log(`🔄 ${this.type.toUpperCase()} Retry Manager Stats:`, this.retryManager.getStats());
  }
}

class RSSProcessor extends FeedProcessor {
  constructor() {
    super('rss', rssCache, rssRetryManager);
  }

  async _processFeed(feed, signal, results) {
    if (!feed || typeof feed !== 'object') {
      console.warn(`⚠️ Skipping invalid RSS feed:`, feed);
      results.failed++;
      return;
    }

    const cacheKey = `rss_${feed.url}`;

    if (this.cache.has(cacheKey)) {
      this._handleCacheHit(feed, cacheKey, results);
      return;
    }

    try {
      await this._fetchAndProcess(feed, signal, cacheKey);
      results.successful++;
      this.retryManager.recordSuccess(feed.url);
    } catch (error) {
      this._handleError(feed, error, results);
    }
  }

  _handleCacheHit(feed, cacheKey, results) {
    const cached = this.cache.get(cacheKey);
    console.log(`📦 Cache hit for ${feed.name || 'Unknown'}`);
    processRSSData(cached, feed);
    results.cacheHits++;
    results.successful++;

    if (this.retryManager._load()[feed.url]) {
      this.retryManager.recordSuccess(feed.url);
    }
  }

  async _fetchAndProcess(feed, signal, cacheKey) {
    const feedUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed.url)}`;
    const res = await fetchWithTimeout(feedUrl, {
      timeout: 15000,
      signal
    });

    if (!res?.ok) {
      throw new Error(`HTTP ${res?.status || "fetch failed"}`);
    }

    const data = await res.json?.() ?? res;
    this.cache.set(cacheKey, data);
    processRSSData(data, feed);
  }

  _handleError(feed, error, results) {
    results.failed++;
    this.retryManager.recordFailure(feed.url, error?.message || "RSS fetch error", feed.name);
    console.log(`❌ Error loading RSS feed for ${feed.name}:`, error?.message || error);
  }
}

class LiveProcessor extends FeedProcessor {
  constructor() {
    super('live', liveCache, liveRetryManager);
  }

  async _processFeed(feed, signal, results, context = {
    apiQuotaExceeded: false
  }) {
    if (!feed || typeof feed !== 'object') {
      console.warn(`⚠️ Skipping invalid live feed:`, feed);
      results.failed++;
      return;
    }

    if (context.apiQuotaExceeded) {
      console.log(`⏸️ Skipping ${feed.name || 'Unknown'} - API quota exceeded`);
      return;
    }

    const channelId = extractChannelId(feed.url);
    if (!channelId) {
      console.warn("No channelId found in feed:", feed.url);
      results.failed++;
      return;
    }

    const cacheKey = `live_${channelId}`;

    if (this.cache.has(cacheKey)) {
      this._handleCacheHit(feed, channelId, cacheKey, results);
      return;
    }

    try {
      await this._fetchAndProcess(feed, channelId, signal, cacheKey, context, results);
    } catch (error) {
      this._handleError(feed, channelId, error, context, results);
    }
  }

  _handleCacheHit(feed, channelId, cacheKey, results) {
    const cached = this.cache.get(cacheKey);
    console.log(`📦 Cache hit for ${feed.name || 'Unknown'}`);
    results.cacheHits++;

    if (cached?.videoId) {
      const channelObj = youtubeItemToChannel(cached.videoId, cached.title, feed);
      updateOrAddChannel(channelObj);
      results.successful++;
    }

    if (this.retryManager._load()[channelId]) {
      this.retryManager.recordSuccess(channelId);
    }
  }

  async _fetchAndProcess(feed, channelId, signal, cacheKey, context, results) {
    const apiKey = appState.get('settings.apiKey') || getStoredAPIKey();
    if (!apiKey || !hasValidAPIKey()) {
      console.log("🔒 No valid API key found, prompting user...");
      showAPIKeyModal();
      throw new Error("No valid API key");
    }

    const apiUrl = `https://www.googleapis.com/youtube/v3/search?` +
      `part=snippet&channelId=${encodeURIComponent(channelId)}&eventType=live&` +
      `type=video&order=date&maxResults=1&key=${encodeURIComponent(apiKey)}`;

    const res = await fetchWithTimeout(apiUrl, {
      timeout: 15000,
      signal
    });

    if (!res.ok) {
      this._handleApiError(res, channelId, context, results);
      return;
    }

    const data = await res.json();
    if (data.error) {
      this._handleApiError(data.error, channelId, context, results);
      return;
    }

    this._processApiResponse(data, feed, channelId, cacheKey, results);
  }

  _handleApiError(error, channelId, context, results) {
    if (error.status === 403 || error.code === 403 ||
      error.message?.includes("quota") || error.message?.includes("403")) {
      context.apiQuotaExceeded = true;
    }
    results.failed++;
    this.retryManager.recordFailure(channelId, error.message || "API error");
  }

  _processApiResponse(data, feed, channelId, cacheKey, results) {
    let cacheData = null;

    if (data.items?.length > 0) {
      const item = data.items[0];
      const videoId = item?.id?.videoId;
      const title = item?.snippet?.title || '';

      if (videoId) {
        cacheData = {
          videoId,
          title
        };
        const channelObj = youtubeItemToChannel(videoId, title, feed);
        updateOrAddChannel(channelObj);
        results.successful++;
        console.log(`✅ ${feed.name} Successfully updated`);
      } else {
        console.log(`ℹ️ No live stream id for ${feed.name}`);
      }
    } else {
      console.log(`ℹ️ No live stream found for ${feed.name}`);
    }

    this.cache.set(cacheKey, cacheData);
    this.retryManager.recordSuccess(channelId);
  }

  _handleError(feed, channelId, error, context, results) {
    results.failed++;

    if (error.message?.includes("quota") || error.message?.includes("403")) {
      context.apiQuotaExceeded = true;
    }

    if (channelId) {
      this.retryManager.recordFailure(channelId, error?.message || "Live fetch error", feed.name);
    }

    console.log(`❌ Error loading live feed for ${feed.name}:`, error?.message || error);
  }
}


async function loadYouTubeLatestFeeds({
  force = false
} = {}) {
  const processor = new RSSProcessor();
  return deduplicateRequest(
    'loadYouTubeLatestFeeds',
    async ({
      signal
    } = {}) => {
      const result = await processor.loadFeeds({
        force,
        signal
      });

      if (result && !rssRetryManager.hasPending()) {
        localStorage.setItem(CACHE_KEY, Date.now().toString());
      } else if (result) {
        console.log("⚠️ RSS retries pending — global cache timestamp unchanged");
      }

      return result;
    }, {
    timeout: 20_000,
    ttl: 2 * 60 * 1000,
    force
  }
  );
}

/**
 * Load YouTube Live Feeds
 * NOTE: This is NOT called by auto-update service.
 * Used for:
 * - Manual API key setup (when user first enters API key)
 * - Retry mechanisms (when YouTube error 1150 or other errors occur)
 * - Manual/programmatic calls if needed
 */
async function loadYouTubeLiveFeeds({
  force = false
} = {}) {
  const processor = new LiveProcessor();
  return deduplicateRequest(
    'loadYouTubeLiveFeeds',
    async ({
      signal
    } = {}) => {
      return processor.loadFeeds({
        force,
        signal
      });
    }, {
    ttl: 30_000,
    timeout: 15_000,
    force
  }
  );
}

/**
 * Load All Channel Feeds
 * NOTE: Only loads RSS feeds for auto-update.
 * Live feeds are handled separately via:
 * - Retry checker (for error recovery)
 * - Manual API key setup
 */
async function loadAllChannelFeeds() {
  console.log("Starting channel update (RSS feeds only)...");

  try {
    console.log("Loading latest uploads from RSS...");
    await loadYouTubeLatestFeeds();

    const channels = appState.get("channels.all") || [];

    console.log("Saving updated channel data to localStorage...");
    const success = safeLocalStorageSet(LS_KEYS.CHANNELS, JSON.stringify(channels));

    if (!success) {
      console.warn("⚠️ Channels loaded but not saved to storage");
      showNotification("Channels loaded (not saved due to storage limits)", "warning");
    }

    _updateUI(channels);
    console.log("✅ RSS feeds update COMPLETE.");
    return true;
  } catch (error) {
    console.error(`❌ Critical error during channel update:`, error);

    const channels = appState.get("channels.all") || [];
    safeLocalStorageSet(LS_KEYS.CHANNELS, JSON.stringify(channels));

    _updateUI(channels);
    return false;
  }
}


function _updateUI(channels) {
  console.log("🔄 Refreshing UI...");
  renderChannels(channels);
  renderFavorites();
  updateFavoriteIcons();
  renderRecentlyWatched();
  updateAllChannelItems();
}

/**
 * Checks for pending retries and processes them when ready
 * Runs more frequently than the main update cycle
 */
async function checkAndProcessRetries() {
  try {
    let hadRetries = false;

    if (rssRetryManager.hasReadyRetries()) {
      console.log('🔁 RSS retry check: Processing ready retries...');
      const processor = new RSSProcessor();
      const result = await processor.loadFeeds({
        force: false
      });
      if (result && result.successful > 0) {
        hadRetries = true;
        console.log(`✅ RSS retry successful: ${result.successful} feeds recovered`);
      }
    }

    if (liveRetryManager.hasReadyRetries()) {
      console.log('🔁 LIVE retry check: Processing ready retries...');
      const processor = new LiveProcessor();
      const result = await processor.loadFeeds({
        force: false
      });
      if (result && result.successful > 0) {
        hadRetries = true;
        console.log(`✅ LIVE retry successful: ${result.successful} feeds recovered`);
      }
    }

    if (hadRetries) {
      const channels = appState.get('channels.all') || [];
      const success = safeLocalStorageSet(LS_KEYS.CHANNELS, JSON.stringify(channels));

      if (success) {
        console.log('✅ Updated channels saved after retry');
        _updateUI(channels);
        showNotification('Retried feeds updated successfully', 'success');
      } else {
        console.warn('⚠️ Failed to save retried channels to storage');
      }
    }
  } catch (error) {
    console.error('❌ Error during retry check:', error);
  }
}

/**
 * Starts the retry checker service
 * Checks every minute for pending retries that are ready
 */
function startRetryChecker() {
  const existing = appState.get('intervals.retryChecker');
  if (existing) clearInterval(existing);

  const RETRY_CHECK_INTERVAL = 60_000;

  const id = setInterval(checkAndProcessRetries, RETRY_CHECK_INTERVAL);
  appState.set('intervals.retryChecker', id);

  console.log('🔁 Retry checker service started. Checking every 1 minute.');

  setTimeout(checkAndProcessRetries, 5000);
}

/**
 * Stops the retry checker service
 */
function stopRetryChecker() {
  appState.clearIntervalRef('retryChecker');
  console.log('🔁 Retry checker service stopped');
}

// ============================================
// ============================================
function startChannelAutoUpdate() {
  const savedAutoUpdate = localStorage.getItem(AUTO_UPDATE_KEY);
  const savedInterval = localStorage.getItem(UPDATE_INTERVAL_KEY);

  appState.set(
    'settings.isAutoUpdateEnabled',
    savedAutoUpdate === null ? true : savedAutoUpdate === "true"
  );

  appState.set(
    'settings.updateIntervalHours',
    savedInterval ? parseInt(savedInterval) : 8
  );

  const isAutoUpdateEnabled = appState.get('settings.isAutoUpdateEnabled');
  const updateIntervalHours = appState.get('settings.updateIntervalHours');

  const intervalMs = updateIntervalHours * 60 * 60 * 1000;
  const cacheExpiryMs = updateIntervalHours * 60 * 60 * 1000;

  console.log(
    `Auto-update service initializing. Enabled: ${isAutoUpdateEnabled}, Interval: ${updateIntervalHours}h`
  );

  const checkAndUpdate = async () => {
    if (!isAutoUpdateEnabled) {
      console.log("Auto-update is disabled. Skipping check.");
      return;
    }

    const lastUpdateTimestamp = parseInt(localStorage.getItem(CACHE_KEY) || "0");
    const currentTime = Date.now();
    const timeSinceLastUpdate = currentTime - lastUpdateTimestamp;
    const shouldUpdate =
      lastUpdateTimestamp === 0 || timeSinceLastUpdate >= cacheExpiryMs;

    if (shouldUpdate) {
      console.log("Cache has expired. Initiating RSS feeds update now.");
      try {
        const success = await loadAllChannelFeeds();
        if (success) {
          const newTimestamp = Date.now();
          localStorage.setItem(CACHE_KEY, newTimestamp.toString());
          const newLastUpdateDate = new Date(newTimestamp).toLocaleString();
          const newNextUpdateDate = new Date(newTimestamp + cacheExpiryMs).toLocaleString();
          console.log("✅ RSS feeds updated successfully.");
          console.log(`New Last Update Time: ${newLastUpdateDate}`);
          console.log(`Next Scheduled Check (Expiry): ${newNextUpdateDate}`);
        } else {
          console.log("❌ Update failed. Cache timestamp preserved for retry.");
        }
      } catch (error) {
        console.log(`❌ Unexpected error during update: ${error.message}`);
        console.log("Cache timestamp preserved for retry.");
      }
    } else {
      const timeRemaining = cacheExpiryMs - timeSinceLastUpdate;
      const minutesRemaining = Math.ceil(timeRemaining / (60 * 1000));
      const hoursRemaining = Math.floor(minutesRemaining / 60);
      const minsRemaining = minutesRemaining % 60;
      /*       if (hoursRemaining > 0) {
              console.log(`Cache is valid. Expires in ${hoursRemaining}h ${minsRemaining}m`);
            } else {
              console.log(`Cache is valid. Expires in ${minutesRemaining} minutes.`);
            } */
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

    const hoursRemaining = Math.floor(minutesRemaining / 60);
    const minsRemaining = minutesRemaining % 60;

    console.log(`Last Update: ${lastUpdateDate}`);
    console.log(`Next update available after: ${nextUpdateDate}`);

    if (hoursRemaining > 0) {
      console.log(`Time remaining: ${hoursRemaining}h ${minsRemaining}m`);
    } else {
      console.log(`Time remaining: ${minutesRemaining} minutes`);
    }
  }

  const existing = appState.get('intervals.autoUpdate');
  if (existing) clearInterval(existing);

  const id = setInterval(checkAndUpdate, intervalMs);
  appState.set('intervals.autoUpdate', id);

  if (appState.get('settings.isAutoUpdateEnabled')) {
    checkAndUpdate();
  }

  /*   console.log(
      `Auto-update service started (RSS feeds only). Checking every ${updateIntervalHours} hours. Status: ${isAutoUpdateEnabled ? "Enabled" : "Disabled"}`
    );
    console.log(
      `ℹ️ Live feeds are NOT auto-updated but will be retried automatically on errors via retry checker.`
    ); */

  startRetryChecker();
}

function stopAutoUpdateService() {
  appState.clearIntervalRef('autoUpdate');
  stopRetryChecker();
  console.log("Auto-update service stopped");
}


function showSettingsModal() {
  const settingsModal = document.getElementById("settingsModal");
  if (!settingsModal) return;

  settingsModal.style.display = "flex";

  const autoUpdateToggle = document.getElementById("autoUpdateToggle");
  const updateIntervalSelect = document.getElementById("updateInterval");
  const sortSelect = document.getElementById("sortSelect");

  if (sortSelect) {
    const currentSort = appState.get('ui.sortMethod') || localStorage.getItem("defaultSortMethod") || 'none';
    sortSelect.value = currentSort;
  }

  const savedAutoUpdate = localStorage.getItem(AUTO_UPDATE_KEY);
  const savedInterval = localStorage.getItem(UPDATE_INTERVAL_KEY);

  const isAutoUpdateEnabled =
    savedAutoUpdate === null ? true : savedAutoUpdate === "true";
  const updateIntervalHours =
    savedInterval !== null && !isNaN(parseInt(savedInterval)) ?
      parseInt(savedInterval) :
      8;

  appState.set("settings.isAutoUpdateEnabled", isAutoUpdateEnabled);
  appState.set("settings.updateIntervalHours", updateIntervalHours);

  if (autoUpdateToggle) autoUpdateToggle.checked = isAutoUpdateEnabled;
  if (updateIntervalSelect) updateIntervalSelect.value = updateIntervalHours.toString();

  updateIntervalDescriptionText(updateIntervalHours);
  updateUserAgentDisplay();
  updateStorageDisplay();
  updateTotalChannelsDisplay();
  updateLastUpdateDisplay();

}

/**
 * Create network status indicator in UI
 */
function setupNetworkStatusIndicator() {
  // Remove existing indicator if any
  const existing = document.getElementById('network-status-indicator');
  if (existing) existing.remove();

  // 1. Create the main container (Now transparent)
  const indicator = document.createElement('div');
  indicator.id = 'network-status-indicator';
  indicator.className = 'network-status-indicator';
  indicator.style.cssText = `
    position: fixed;
    top: 15px;
    left: 15px;
    z-index: 9999;
    cursor: pointer;
    transition: all 0.3s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent; /* No background */
  `;

  // 2. Create the FontAwesome Icon
  const icon = document.createElement('i');
  icon.className = 'fa fa-signal';
  icon.setAttribute('aria-hidden', 'true');
  icon.style.fontSize = '18px'; // Adjust size as needed
  icon.style.textShadow = '0 1px 3px rgba(0,0,0,0.5)'; // Makes it visible on light/dark backgrounds
  indicator.appendChild(icon);

  // 3. Click handler for details
  indicator.addEventListener('click', () => {
    const isOnline = appState.get('settings.isOnline');
    const quality = appState.get('settings.networkQuality') || 'unknown';
    const connectionType = appState.get('settings.connectionType') || 'unknown';
    const latency = appState.get('settings.networkLatency') || 0; // Retrieve latency from state

    // Format Strings

    const currentStatus = isOnline ? 'Online' : 'Offline';
    const qualityText = quality.charAt(0).toUpperCase() + quality.slice(1);
    const typeText = connectionType.charAt(0).toUpperCase() + connectionType.slice(1);

    showNotification(
      `Status: ${currentStatus},\n` +
      `Quality: ${qualityText},\n` +
      `Connection: ${typeText},\n` +
      `Latency: ${Math.round(latency)}ms\n`,
      'info',
      5000
    );
  });


  document.body.appendChild(indicator);

  // 4. Update logic: Change ONLY the icon color
  const updateIndicator = (isOnline, quality) => {
    if (!indicator.isConnected) return;

    // Set data attributes for CSS animations
    indicator.setAttribute('data-status', isOnline ? 'online' : 'offline');
    indicator.setAttribute('data-quality', quality);

    if (!isOnline) {
      icon.style.color = '#ff4d4d'; // Bright Red for offline (alert)
      indicator.title = 'Offline';
      return;
    }

    // Change color based on quality (modern palette)
    switch (quality) {
      case 'excellent':
        icon.style.color = '#009688'; // Spotify Green (Excellent)
        break;
      case 'good':
        icon.style.color = '#1DB954'; // Indigo Blue (Good)
        break;
      case 'fair':
        icon.style.color = '#FFC107'; // Amber Yellow (Fair)
        break;
      case 'poor':
        icon.style.color = '#D32F2F'; // Crimson Red (Poor)
        break;
      default:
        icon.style.color = '#455A64'; // Blue Gray (Unknown/Neutral)
    }

    indicator.title = `Quality: ${quality}`;

  };

  // 5. Listeners
  networkMonitor.addStatusListener((isOnline) => {
    const quality = appState.get('settings.networkQuality') || 'unknown';
    updateIndicator(isOnline, quality);
  });

  networkMonitor.addQualityListener((quality) => {
    const isOnline = appState.get('settings.isOnline');
    updateIndicator(isOnline, quality);
  });

  // Initial update
  updateIndicator(appState.get('settings.isOnline'), appState.get('settings.networkQuality') || 'unknown');

  /**
   * 6. MODAL HIDE LOGIC
   * This ensures the icon disappears completely when a video/modal is open
   */
  const syncVisibility = (isOpen) => {
    if (!isOpen) {
      indicator.style.opacity = '0';
      indicator.style.pointerEvents = 'none';
      indicator.style.visibility = 'hidden';
    } else {
      indicator.style.opacity = '1'; // Full visibility for the icon
      indicator.style.pointerEvents = 'auto';
      indicator.style.visibility = 'visible';
    }
  };

  appState.subscribe('ui.isModalOpen', syncVisibility);
  syncVisibility(appState.get('ui.isModalOpen'));

  return indicator;
}

/**
 * Hide settings modal
 */
function hideSettingsModal() {
  const settingsModal = document.getElementById("settingsModal");
  if (settingsModal) {
    settingsModal.style.display = "none";
  }
}

/**
 * Toggle auto-update
 */
function toggleAutoUpdate(enabled) {
  localStorage.setItem(AUTO_UPDATE_KEY, enabled.toString());
  appState.set("settings.isAutoUpdateEnabled", enabled);

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

/**
 * Change update interval
 */
function changeUpdateInterval(hours) {
  const parsed = parseInt(hours);
  localStorage.setItem(UPDATE_INTERVAL_KEY, parsed.toString());
  appState.set("settings.updateIntervalHours", parsed);

  console.log(`⏱️ Update interval changed to ${parsed} hours`);
  updateIntervalDescriptionText(parsed);
  showNotification(`Update interval set to ${parsed} hours`, "success");

  if (appState.get('settings.isAutoUpdateEnabled')) {
    stopAutoUpdateService();
    startChannelAutoUpdate();
  }
}

/**
 * Manual update channels
 */
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

/**
 * Update last update display
 */
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
    lastUpdateEl.textContent = `${timeAgo} (${formattedDate})`;
    lastUpdateEl.style.color = "#4caf50";
  }
}

/**
 * Update interval description text
 */
function updateIntervalDescriptionText(hours) {
  const descriptionEl = document.getElementById("updateIntervalDescription");
  if (descriptionEl) {
    descriptionEl.textContent = `Automatically check for new content every ${hours} hour${hours > 1 ? "s" : ""}`;
  }
}

/**
 * Setup settings modal
 */
function setupSettingsModal() {
  const settingsModal = document.getElementById("settingsModal");
  if (!settingsModal) return;

  const settingsBtn = document.getElementById("settingsBtn");
  const closeSettings = document.getElementById("closeSettings");
  const autoUpdateToggle = document.getElementById("autoUpdateToggle");
  const updateIntervalSelect = document.getElementById("updateInterval");
  const manualUpdateBtn = document.getElementById("manualUpdateBtn");
  const manageApiKeyBtn = document.getElementById("manageApiKeyBtn");
  const sortSelect = document.getElementById("sortSelect");

  if (settingsBtn) {
    settingsBtn.addEventListener("click", () => {
      showSettingsModal();
      updateUserAgentDisplay();
      updateStorageDisplay();
      updateTotalChannelsDisplay();
      updateLastUpdateDisplay();
    });
  }

  if (closeSettings) {
    closeSettings.addEventListener("click", () => {
      hideSettingsModal();
    });
  }

  if (settingsModal) {
    settingsModal.addEventListener("click", (e) => {
      if (e.target === settingsModal) {
        hideSettingsModal();
      }
    });
  }

  if (sortSelect) {
    sortSelect.addEventListener("change", (e) => {
      handleSortChange(e.target.value);
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

  setupUserAgentControls();

  setupStorageControls();

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && settingsModal.style.display === "flex") {
      hideSettingsModal();
    }
  });

  updateUserAgentDisplay();
  updateStorageDisplay();
}

/**
 * Update user agent display
 */
function updateUserAgentDisplay() {
  const display = document.getElementById('currentUserAgent');
  if (!display) return;

  try {
    const currentUA = navigator.userAgent;
    const isCustom = window.UserAgentManager?.isCustom || false;

    display.textContent = currentUA;
    display.style.color = isCustom ? '#4caf50' : '#888';
    display.title = `User Agent (${isCustom ? 'Custom' : 'Original'})`;

    if (isCustom) {
      display.classList.add('custom-ua');
      display.classList.remove('original-ua');
    } else {
      display.classList.add('original-ua');
      display.classList.remove('custom-ua');
    }
  } catch (error) {
    console.error('❌ Failed to update User Agent display:', error);
    display.textContent = 'Error loading User Agent';
    display.style.color = '#f44336';
  }
}

/**
 * Setup user agent controls
 */
function setupUserAgentControls() {
  const presetSelect = document.getElementById('userAgentPreset');
  const customInput = document.getElementById('customUserAgent');
  const applyBtn = document.getElementById('applyUserAgent');
  const resetBtn = document.getElementById('resetUserAgent');
  const applyPresetBtn = document.getElementById('applyPresetUserAgent');

  if (!window.UserAgentManager) {
    console.error('❌ UserAgentManager not available');
    return;
  }

  if (presetSelect && customInput) {
    presetSelect.addEventListener('change', (e) => {
      const presetName = e.target.value;
      if (presetName) {
        customInput.value = UserAgentManager.presets[presetName];
        showNotification(`Loaded ${presetName.replace(/_/g, ' ')} preset`, 'success');
      }
    });
  }

  if (applyBtn && customInput) {
    applyBtn.addEventListener('click', () => {
      const customUA = customInput.value.trim();

      if (!customUA) {
        showNotification('Please enter a user agent string', 'warning');
        return;
      }

      if (UserAgentManager.set(customUA)) {
        showNotification('User Agent updated! Reloading...', 'success');
        setTimeout(() => location.reload(), 1000);
      } else {
        showNotification('Failed to update User Agent', 'error');
      }
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (UserAgentManager.reset()) {
        showNotification('User Agent reset! Reloading...', 'success');
        setTimeout(() => location.reload(), 1000);
      } else {
        showNotification('Failed to reset User Agent', 'error');
      }
    });
  }
}

// ============================================
// API KEY MODAL
// ============================================

/**
 * Show API key modal
 */
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

/**
 * Hide API key modal
 */
function hideAPIKeyModal() {
  const apiModal = document.getElementById("apiKeyModal");
  if (apiModal) {
    apiModal.style.display = "none";
  }
}

/**
 * Setup API key modal events
 */
function setupAPIKeyModalEvents() {
  const submitBtn = document.getElementById("submitApiKey");
  const skipBtn = document.getElementById("skipApiKey");
  const closeBtn = document.getElementById("closeApiKeyModal");
  const apiKeyInput = document.getElementById("apiKeyInput");
  const toggleVisibilityBtn = document.getElementById("toggleApiKeyVisibility");
  const apiModal = document.getElementById("apiKeyModal");

  const handleSubmit = () => {
    const apiKey = apiKeyInput.value.trim();
    const remember = document.getElementById("rememberKey")?.checked;

    if (!apiKey || apiKey.length < 30) {
      apiKeyInput.classList.add("invalid");
      showNotification("Invalid API Key", "error");
      setTimeout(() => apiKeyInput.classList.remove("invalid"), 400);
      return;
    }

    if (remember) saveAPIKey(apiKey);
    else appState.set('settings.apiKey', apiKey);

    hideAPIKeyModal();
    showNotification("API Key saved successfully!", "success");
  };

  const handleSkip = () => {
    hideAPIKeyModal();
    showNotification("Live channels update skipped", "info");
    console.log("ℹ️ User skipped API key configuration");
  };

  if (submitBtn.dataset.bound) return;

  if (submitBtn) {
    submitBtn.addEventListener("click", handleSubmit);
    submitBtn.dataset.bound = "true";
  }

  if (skipBtn) skipBtn.addEventListener("click", handleSkip);

  if (closeBtn) closeBtn.addEventListener("click", () => hideAPIKeyModal());

  if (toggleVisibilityBtn && apiKeyInput) {
    toggleVisibilityBtn.addEventListener("click", () => {
      const isPass = apiKeyInput.type === "password";
      apiKeyInput.type = isPass ? "text" : "password";
      toggleVisibilityBtn.textContent = isPass ? "🙈 Hide" : "👁️ Show";
    });
  }

  if (apiKeyInput) {
    apiKeyInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") handleSubmit();
    });
  }
}

// ============================================
// ============================================
function cleanup() {
  console.log("🧹 Performing cleanup...");

  try {
    networkMonitor.cleanup();
  } catch (error) {
    console.warn('Error during network monitor cleanup:', error);
  }

  stopWatching();
  stopAutoUpdateService();

  appState.clearTimeoutRef("overlayShow");
  appState.clearTimeoutRef("overlayHide");
  appState.clearTimeoutRef("numberTimeout");
  appState.clearTimeoutRef("promptTimeout");

  channelLoader.cleanupPlayer()
    .then(() => {
      console.log("✅ Player cleanup complete");
    })
    .catch(error => {
      console.warn("Error during player cleanup:", error);
    });

  document.querySelectorAll(
    ".network-status, .error-notification, .play-fallback-overlay, .notification"
  ).forEach(el => {
    if (el.parentNode) {
      el.parentNode.removeChild(el);
    }
  });

  restoreFocus();

  console.log("✅ Cleanup complete");
}

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
  try {
    PerformanceMonitor.measureChannelLoad();

    const contentGrid = document.querySelector(".content-grid");
    const loadingElement = document.getElementById("loading-spinner");
    if (contentGrid) contentGrid.style.display = "none";
    if (loadingElement) loadingElement.style.display = "block";

    try {
      networkMonitor.initialize();
    } catch (error) {
      console.error('Failed to initialize network monitor:', error);
    }

    const closeBtn = document.querySelector(".closeModal");
    if (closeBtn) closeBtn.addEventListener("click", closeModal);

    const modal = document.getElementById("videoModal");
    if (modal) {
      modal.addEventListener("click", (event) => {
        if (event.target === modal) closeModal();
      });
    }


    const features = [{
      name: 'Lazy Loading',
      fn: initializeLazyLoading
    },
    {
      name: 'Cache Maintenance',
      fn: startCacheMaintenance
    },
    {
      name: 'Network Status',
      fn: setupNetworkStatusIndicator
    },
    {
      name: 'Settings Modal',
      fn: setupSettingsModal
    },
    {
      name: 'Search Bar',
      fn: setupSearchBar
    },
    {
      name: 'Touch Gestures',
      fn: setupTouchGestures
    },
    {
      name: 'Keyboard Navigation',
      fn: setupKeyboardNavigation
    }
    ];

    for (const {
      name,
      fn
    } of features) {
      try {
        fn();
      } catch (e) {
        console.error(`❌ ${name} setup failed:`, e);
      }
    }

    setInterval(checkStorageHealth, 60_000);

    const stored = localStorage.getItem(LS_KEYS.CHANNELS);
    if (stored) {
      try {
        const parsed = safeJSONParse(stored, []);
        if (!Array.isArray(parsed)) throw new Error("Invalid channels data");
        appState.set("channels.all", parsed);
        appState.set("channels.filtered", []);
      } catch (e) {
        console.warn("Invalid channels data:", e);
        appState.set("channels.all", []);
        appState.set("channels.filtered", []);
      }
    } else {
      appState.set("channels.all", []);
      appState.set("channels.filtered", []);
    }

    PerformanceMonitor.channelLoadComplete();

    const storedKey = getStoredAPIKey() || "";
    appState.set('settings.apiKey', storedKey);

    if (hasValidAPIKey()) {
      console.log("✅ Using stored API key");
    } else {
      console.log("ℹ️ No valid API key stored");
    }

    startChannelAutoUpdate();

    const channels = appState.get("channels.all") || [];
    const numbered = channels.map((ch, i) => ({
      ...ch,
      number: ch.number || i + 1,
    }));
    appState.set("channels.all", numbered);

    loadWatchTime();
    const savedSort = localStorage.getItem("defaultSortMethod") || "none";
    handleSortChange(savedSort);

    addSkipLinks();

    renderFavorites();
    renderRecentlyWatched();
    updateFavoriteIcons();
    updateAllChannelItems();

    if (loadingElement) loadingElement.style.display = "none";
    if (contentGrid) contentGrid.style.display = "grid";

    restoreFocus();

    if (window.__GLOBAL_ERROR_BOUNDARIES_INSTALLED__) return;
    window.__GLOBAL_ERROR_BOUNDARIES_INSTALLED__ = true;

  } catch (error) {
    console.error("❌ Critical initialization error:", error);
    showNotification('Failed to initialize app', 'error');

    const main = document.getElementById('channels');
    if (main) {
      main.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #f44336;">
          <h2>⚠️ Initialization Failed</h2>
          <p>${escapeHtml(error.message)}</p>
          <button onclick="location.reload()" 
                  style="margin-top: 20px; padding: 10px 20px; 
                         background: #007bff; color: white; 
                         border: none; border-radius: 8px; cursor: pointer;">
            🔄 Reload Page
          </button>
        </div>
      `;
    }
  }
}

// ============================================
// ============================================
window.addEventListener("DOMContentLoaded", async () => {
  try {
    await initialize();
  } catch (e) {
    console.error("Initialization failed:", e);
  }
});

window.addEventListener("beforeunload", () => {
  try {
    cleanup();
  } catch (e) {
    console.warn("Cleanup encountered an error:", e);
  }
});

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


function fixImageUrl(imageUrl, { width = 200, quality = 80 } = {}) {
  const PLACEHOLDER = 'placeholder.png';

  // 1. Guard against null, undefined, or non-string inputs
  if (!imageUrl || typeof imageUrl !== 'string') return PLACEHOLDER;

  // 2. RELIABILITY: If it's already HTTPS, return it as-is.
  // This ensures thumbnails from strict CDNs don't break.
  if (imageUrl.startsWith('https://')) {
    return imageUrl;
  }

  // 3. PERFORMANCE: If it's HTTP, proxy and optimize it.
  // This fixes "Mixed Content" warnings and speeds up your site.
  if (imageUrl.startsWith('http://')) {
    const cleanUrl = imageUrl.replace(/^http:\/\//, '');

    const params = new URLSearchParams({
      url: cleanUrl,
      w: width,
      q: quality,
      fit: 'cover',
      a: 'attention', // Smart-crops to faces/subjects
      default: PLACEHOLDER // If the source HTTP image is 404, Weserv shows this
    });

    return `https://images.weserv.nl/?${params.toString()}`;
  }

  // 4. FALLBACK: Return the input (useful for local paths like /assets/logo.png)
  return imageUrl || PLACEHOLDER;
}


function setupTouchGestures() {
  const modal = document.getElementById('videoModal');
  if (!modal) return;

  modal.addEventListener('touchstart', handleTouchStart, {
    passive: true
  });
  modal.addEventListener('touchend', handleTouchEnd, {
    passive: true
  });
}

function handleTouchStart(e) {
  const touch = e.changedTouches[0];
  appState.set('ui.touchStartX', touch.screenX);
  appState.set('ui.touchStartY', touch.screenY);
  appState.set('ui.touchEndX', touch.screenX);
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
  const DOUBLE_TAP_DELAY = 300;

  if (totalDelta < 10) {
    if (currentTime - lastTapTime < DOUBLE_TAP_DELAY) {
      if (!isCurrentlyFullscreen) {
        if (window.fullscreenPrompt) removeFullscreenPrompt();
        else showFullscreenPrompt();
      } else {
        window.toggleFullscreen();
        showNotification("Exit fullscreen. Doubletap again!", "success");
      }
      appState.set('ui.lastTapTime', 0);
      return;
    }
    appState.set('ui.lastTapTime', currentTime);
    return;
  }

  handleSwipe(deltaX, deltaY);
}

function handleSwipe(deltaX, deltaY) {
  const modal = document.getElementById('videoModal');
  if (!modal || modal.style.display !== 'flex') return;

  const minSwipeDistance = 50;

  if (Math.abs(deltaX) > Math.abs(deltaY)) {
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
    if (Math.abs(deltaY) > minSwipeDistance) {
      if (deltaY < 0) { } else { }
    }
  }
}

// ============================================
// ============================================

function navigateChannel(direction = 1) {
  const items = appState.get('uiCollections.allChannelItems') || [];
  if (!items.length) return;

  const lastFocused = appState.get('ui.lastFocusedElement') || items[0];
  let currentIndex = items.indexOf(lastFocused);
  if (currentIndex === -1) currentIndex = 0;

  const newIndex = (currentIndex + direction + items.length) % items.length;
  const target = items[newIndex];

  const {
    url,
    name,
    image,
    description,
    number,
    isLive,
    category
  } = target.dataset;

  selectChannel(url, name, image, description, number, isLive);
  saveRecentlyWatched({
    name,
    url,
    image,
    description,
    number,
    isLive,
    category
  });
  appState.set('ui.lastFocusedElement', target);

  //const icon = direction === -1 ? "⏮️" : "⏭️";
  //showNotification(`${icon} ${name}`, "info");
}

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
  const keysToTryClearing = [
    LS_KEYS.RECENT,
    LS_KEYS.FAVORITES,
    LS_KEYS.WATCH_TIME
  ];

  for (const key of keysToTryClearing) {
    if (localStorage.getItem(key)) {
      console.log(`🗑️ Clearing ${key} to free space`);
      localStorage.removeItem(key);

      try {
        const testData = 'x'.repeat(100000);
        localStorage.setItem('_test', testData);
        localStorage.removeItem('_test');
        console.log('✅ Space freed successfully');
        return;
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
      const size = (localStorage[key].length + key.length) * 2;
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
// DATA IMPORT/EXPORT
// ============================================

/**
 * Export all application data as JSON backup
 */
function exportAllData() {
  try {
    const data = {
      version: VERSION,
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

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `iptv-backup-${Date.now()}.json`;
    document.body.appendChild(a);

    a.click();

    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showNotification("Backup exported successfully", "success");
    console.log("✅ Backup exported:", data);

    return true;
  } catch (error) {
    console.error("❌ Export failed:", error);
    showNotification("Failed to export backup", "error");
    return false;
  }
}
/**
 * Import backup data from JSON file
 * @param {File} file - The backup file to import
 */
async function importBackupData(file) {
  if (!file) {
    showNotification('No file selected', 'error');
    return false;
  }

  if (!file.name.endsWith('.json')) {
    showNotification('Please select a valid JSON backup file', 'error');
    return false;
  }

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!validateBackupData(data)) {
      showNotification('Invalid backup file format', 'error');
      return false;
    }

    const confirmed = await showImportConfirmation(data);
    if (!confirmed) {
      showNotification('Import cancelled', 'info');
      return false;
    }

    await performImport(data);

    return true;

  } catch (error) {
    console.error('❌ Import failed:', error);
    showNotification('Failed to import backup: ' + error.message, 'error');
    return false;
  }
}

/**
 * Validate backup data structure
 * @param {Object} data - Backup data to validate
 * @returns {boolean} - Whether data is valid
 */
function validateBackupData(data) {
  if (!data || typeof data !== 'object') {
    console.error('Invalid data structure');
    return false;
  }

  if (data.version && !isVersionCompatible(data.version)) {
    console.warn('⚠️ Backup version mismatch:', data.version);
  }

  if (data.channels && !Array.isArray(data.channels)) {
    console.error('Invalid channels data');
    return false;
  }

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
  const currentVersion = VERSION;
  return version === currentVersion;
}

/**
 * Show import confirmation dialog
 * @param {Object} data - Backup data
 * @returns {Promise<boolean>} - User confirmation
 */
function showImportConfirmation(data) {
  return new Promise((resolve) => {
    const exportDate = data?.exportDate ?
      new Date(data.exportDate).toLocaleString() :
      "Unknown";

    const channelCount = Array.isArray(data?.channels) ? data.channels.length : 0;
    const favoriteCount = Array.isArray(data?.favorites) ? data.favorites.length : 0;
    const recentCount = Array.isArray(data?.recentlyWatched) ? data.recentlyWatched.length : 0;

    const modal = document.createElement("div");
    modal.className = "settings-modal";
    modal.style.display = "flex";

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

    const confirmBtn = modal.querySelector(".confirm-btn");
    const cancelBtn = modal.querySelector(".cancel-btn");
    const mergeCheckbox = modal.querySelector(".merge-checkbox");

    confirmBtn.addEventListener("click", () => {
      const mergeData = mergeCheckbox.checked;
      modal.remove();
      resolve({
        confirmed: true,
        merge: mergeData
      });
    });

    cancelBtn.addEventListener("click", () => {
      modal.remove();
      resolve({
        confirmed: false
      });
    });

    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        modal.remove();
        resolve({
          confirmed: false
        });
      }
    });
  }).then((result) => {
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
  delete window._importMergeMode;

  try {
    console.log("📦 Creating automatic backup of current data...");
    const backupSuccess = await createAutoBackup();
    if (!backupSuccess) {
      console.warn("⚠️ Auto-backup failed, but continuing with import...");
    }

    if (Array.isArray(data.channels) && data.channels.length > 0) {
      let channels = appState.get("channels.all") || [];

      if (mergeMode) {
        console.log("🔄 Merging channels...");
        data.channels.forEach(importedChannel => {
          const existingIndex = channels.findIndex(ch => ch.url === importedChannel.url);
          if (existingIndex !== -1) {
            channels[existingIndex] = {
              ...channels[existingIndex],
              ...importedChannel
            };
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

    if (Array.isArray(data.favorites)) {
      let favorites = mergeMode ?
        safeJSONParse(localStorage.getItem(LS_KEYS.FAVORITES) || "[]", []) : [];

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

    if (Array.isArray(data.recentlyWatched)) {
      let recent = mergeMode ?
        safeJSONParse(localStorage.getItem(LS_KEYS.RECENT) || "[]", []) : [];

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

    if (Array.isArray(data.rssFeeds) && !mergeMode) {
      safeLocalStorageSet(LS_KEYS.FEEDS, JSON.stringify(data.rssFeeds));
    }

    if (Array.isArray(data.liveChannels) && !mergeMode) {
      safeLocalStorageSet(LS_KEYS.LIVE, JSON.stringify(data.liveChannels));
    }

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

    console.log("🔄 Refreshing UI...");
    renderChannels(appState.get("channels.all"));
    renderFavorites();
    renderRecentlyWatched();
    updateFavoriteIcons();
    updateAllChannelItems();

    if (!mergeMode && data.settings) {
      stopAutoUpdateService();
      startChannelAutoUpdate();
    }

    showNotification(
      `Import successful! ${mergeMode ? "Data merged" : "Data restored"}`,
      "success"
    );
    console.log("✅ Import completed successfully");

    hideSettingsModal();
  } catch (error) {
    console.error("❌ Import failed:", error);
    showNotification("Import failed: " + error.message, "error");
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
      version: VERSION,
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
// STORAGE CONTROLS SETUP
// ============================================

/**
 * Setup storage controls
 */
function setupStorageControls() {
  const viewStorageDetailsBtn = document.getElementById('viewStorageDetails');
  if (viewStorageDetailsBtn) {
    viewStorageDetailsBtn.addEventListener('click', () => {
      logStorageUsage();
      showNotification('Check console for storage details', 'info');
    });
  }

  const exportDataBtn = document.getElementById('exportDataBtn');
  if (exportDataBtn) {
    exportDataBtn.addEventListener('click', exportAllData);
  }

  const importDataBtn = document.getElementById('importDataBtn');
  if (importDataBtn) {
    importDataBtn.addEventListener('click', triggerImportDialog);
  }

  const clearRecentBtn = document.getElementById('clearRecentBtn');
  if (clearRecentBtn) {
    clearRecentBtn.addEventListener('click', clearRecentlyWatched);
  }

  const clearFavoritesBtn = document.getElementById('clearFavoritesBtn');
  if (clearFavoritesBtn) {
    clearFavoritesBtn.addEventListener('click', clearAllFavorites);
  }

  const fileInput = document.getElementById('importFileInput');
  if (fileInput) {
    fileInput.addEventListener('change', handleImportFile);
  }
}

/**
 * Update total channels display
 */
function updateTotalChannelsDisplay() {
  const totalChannelsElement = document.getElementById('totalChannelsCount');
  if (!totalChannelsElement) return;

  try {
    const channels = appState.get('channels.all') || [];
    const totalCount = channels.length;

    totalChannelsElement.textContent = totalCount;
    totalChannelsElement.style.color = '#4CAF50';
  } catch (error) {
    console.error('Error updating total channels display:', error);
    totalChannelsElement.textContent = 'Error';
    totalChannelsElement.style.color = '#f44336';
  }
}

/**
 * Update storage display
 */
async function updateStorageDisplay() {
  const display = document.getElementById('storageUsageDisplay');
  if (!display) return;

  display.textContent = '';
  display.setAttribute('aria-live', 'polite');

  try {
    const maybePromise = getStorageUsage();
    const usage = (maybePromise && typeof maybePromise.then === 'function') ?
      await maybePromise :
      maybePromise;

    if (!usage || typeof usage.totalBytes !== 'number') {
      display.innerHTML = '<div class="storage-loading">⚠️ Unable to calculate storage usage</div>';
      return;
    }

    const MAX_MB_VALUE = (typeof MAX_MB === 'number' && MAX_MB > 0) ? MAX_MB : 6;
    const totalBytes = Number(usage.totalBytes) || 0;
    const totalMB = (typeof usage.totalMB === 'number') ? usage.totalMB : (totalBytes / (1024 * 1024));

    const usedPercentRaw = (totalBytes / (MAX_MB_VALUE * 1024 * 1024)) * 100;
    const usedPercent = Math.max(0, Math.min(100, Number(usedPercentRaw.toFixed(1))));

    let colorClass = 'storage-good';
    let statusIcon = '✅';
    let statusText = 'Healthy';

    if (usedPercentRaw > 80) {
      colorClass = 'storage-warning';
      statusIcon = '⚠️';
      statusText = 'Getting Full';
    }
    if (usedPercentRaw > 95) {
      colorClass = 'storage-critical';
      statusIcon = '🚨';
      statusText = 'Critical';
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'storage-grid';

    const statusCard = document.createElement('div');
    statusCard.className = `storage-card ${colorClass}`;

    const header = document.createElement('div');
    header.className = 'storage-header';
    const title = document.createElement('strong');
    title.textContent = 'Storage Status';
    const statusSpan = document.createElement('span');
    statusSpan.className = 'storage-status-text';
    statusSpan.style.color = '';
    statusSpan.textContent = `${statusIcon} ${statusText}`;
    header.appendChild(title);
    header.appendChild(statusSpan);

    const usageLine = document.createElement('div');
    usageLine.className = 'storage-usage-line';
    const usedText = document.createElement('span');
    usedText.innerHTML = `Used: <strong class="storage-amount">${totalMB.toFixed(1)} MB</strong> / ${MAX_MB_VALUE} MB`;
    const percentText = document.createElement('span');
    percentText.className = 'storage-percent';
    percentText.textContent = ` (${usedPercent}%)`;
    usageLine.appendChild(usedText);
    usageLine.appendChild(percentText);

    const progressWrap = document.createElement('div');
    progressWrap.className = 'storage-progress-wrap';
    const progressBar = document.createElement('div');
    progressBar.className = 'storage-progress-bar';
    progressBar.style.width = `${usedPercent}%`;
    progressBar.setAttribute('role', 'progressbar');
    progressBar.setAttribute('aria-valuemin', '0');
    progressBar.setAttribute('aria-valuemax', '100');
    progressBar.setAttribute('aria-valuenow', String(usedPercent));
    progressWrap.appendChild(progressBar);

    statusCard.appendChild(header);
    statusCard.appendChild(usageLine);
    statusCard.appendChild(progressWrap);

    wrapper.appendChild(statusCard);

    display.appendChild(wrapper);
  } catch (error) {
    console.error('Error updating storage display:', error);
    display.innerHTML = '<div class="storage-loading">❌ Error calculating storage</div>';
  }
}

function cleanupAllEventListeners() {
  eventCleanupCallbacks.forEach(cleanup => cleanup());
  eventCleanupCallbacks.length = 0;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function checkStorageHealth() {
  const usage = getStorageUsage();
  const percentUsed = (usage.totalBytes / (MAX_MB * 1024 * 1024)) * 100;

  if (percentUsed > 80) {
    showNotification('Storage 80% full - consider exporting data', 'warning');
    const res = predictiveCleanup();
    if (res.freedBytes > 0) {
      showNotification(`Auto-cleaned ${Math.round(res.freedBytes / 1024)} KB`, 'info');
    } else {
      clearOldStorageData();
    }
  }

  if (percentUsed > 95) {
    showNotification('Storage critical - forcing cleanup', 'error');
    const res = predictiveCleanup();
    if (res.freedBytes <= 0) {
      localStorage.removeItem(LS_KEYS.WATCH_TIME);
      clearOldStorageData();
    }
  }
}


function predictiveCleanup() {
  try {
    const usage = getStorageUsage();
    if (!usage) return {
      freedBytes: 0,
      removedKeys: []
    };

    const threshold = 8 * 1024 * 1024;

    if (usage.totalBytes <= threshold) {
      return {
        freedBytes: 0,
        removedKeys: []
      };
    }

    const importance = {
      [LS_KEYS.CHANNELS]: 10,
      [LS_KEYS.WATCH_TIME]: 5,
      [LS_KEYS.FAVORITES]: 2,
      [LS_KEYS.RECENT]: 1,
    };

    const items = Object.entries(usage.items || {}).map(([key, size]) => {
      const imp = importance.hasOwnProperty(key) ? importance[key] : 5;
      return {
        key,
        size,
        importance: imp,
        ratio: size / imp
      };
    });

    items.sort((a, b) => b.ratio - a.ratio);

    const removedKeys = [];
    let freedBytes = 0;
    let totalBytes = usage.totalBytes;

    for (const item of items) {
      if (totalBytes <= threshold) break;

      if (!item.key || item.key === '__iptv' || item.key.startsWith('__')) continue;

      if (item.key === LS_KEYS.CHANNELS || item.key === LS_KEYS.FAVORITES) {
        if (totalBytes <= threshold * 1.5) continue;
      }

      try {
        console.log(`🧹 predictiveCleanup: removing ${item.key} (~${Math.round(item.size / 1024)}KB)`);
        localStorage.removeItem(item.key);
        removedKeys.push(item.key);
        freedBytes += item.size;
        totalBytes -= item.size;

        if (item.key === LS_KEYS.RECENT) dispatchStorageUpdate('recent');
        if (item.key === LS_KEYS.FAVORITES) dispatchStorageUpdate('favorites');
        if (item.key === CACHE_KEY) {
          try {
            rssCache.clear();
            liveCache.clear();
          } catch (e) {
            /* ignore */
          }
        }

      } catch (e) {
        console.warn('predictiveCleanup: failed to remove', item.key, e);
      }
    }

    console.log(`🧹 predictiveCleanup: Freed ~${Math.round(freedBytes / 1024)} KB, removed:`, removedKeys);
    return {
      freedBytes,
      removedKeys
    };
  } catch (err) {
    console.warn('predictiveCleanup failed:', err);
    return {
      freedBytes: 0,
      removedKeys: []
    };
  }
}

/**
 * Optimized lazy loading with better resource management
 */
function initializeLazyLoading() {
  if (!('IntersectionObserver' in window)) {
    console.warn('IntersectionObserver not supported - loading all images immediately');
    document.querySelectorAll('img[data-src]').forEach(loadImage);
    return null;
  }

  // Disconnect existing observer if present
  if (window.lazyLoadObserver) {
    window.lazyLoadObserver.disconnect();
  }

  const options = {
    root: null,
    rootMargin: '50px', // Preload slightly before visible
    threshold: 0.01
  };

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        loadImage(img);
        obs.unobserve(img); // Stop observing after loading
      }
    });
  }, options);

  // Observe all lazy images
  document.querySelectorAll('img[data-src]').forEach(img => {
    observer.observe(img);
  });

  window.lazyLoadObserver = observer;

  appState.addCleanup(() => {
    observer.disconnect();
    window.lazyLoadObserver = null;
  });

  return observer;
}

/**
 * Load image from data-src to src with better error handling
 */
function loadImage(img) {
  const src = img.dataset.src;
  if (!src || img.src === src) return; // Prevent duplicate loads

  img.classList.add('loading');

  const tempImg = new Image();

  tempImg.onload = () => {
    img.src = src;
    img.classList.remove('loading');
    img.classList.add('loaded');
    delete img.dataset.src; // Clean up data attribute
  };

  tempImg.onerror = () => {
    img.src = 'placeholder.png';
    img.alt = 'Image not available';
    img.classList.remove('loading');
    img.classList.add('error');
  };

  tempImg.src = src;
}

function startCacheMaintenance({
  verbose = false,
  intervalMinutes = 15,
  onComplete = null
} = {}) {
  const MAINTENANCE_INTERVAL_MS = intervalMinutes * 60 * 1000;
  const LOG_PREFIX = '[Cache]';

  const runMaintenance = () => {
    try {
      const startTime = Date.now();
      const rssPruned = rssCache?.pruneExpired?.() ?? 0;
      const livePruned = liveCache?.pruneExpired?.() ?? 0;
      const totalPruned = rssPruned + livePruned;

      if (totalPruned > 0 || verbose) {
        console.log(`${LOG_PREFIX} Pruned ${totalPruned} entries in ${Date.now() - startTime}ms`);
      }

      if (verbose) {
        console.group(`${LOG_PREFIX} Stats`);
        console.log('RSS:', rssCache?.getStats?.());
        console.log('Live:', liveCache?.getStats?.());
        console.groupEnd();
      }

      onComplete?.({
        rssPruned,
        livePruned,
        totalPruned
      });
    } catch (error) {
      console.error(`${LOG_PREFIX} Maintenance error:`, error);
    }
  };

  const maintenanceInterval = setInterval(runMaintenance, MAINTENANCE_INTERVAL_MS);

  appState?.setIntervalRef?.('cacheMaintenance', maintenanceInterval);

  appState?.addCleanup?.(() => clearInterval(maintenanceInterval));

  runMaintenance();

  return () => {
    clearInterval(maintenanceInterval);
    console.log(`${LOG_PREFIX} Maintenance stopped`);
  };
}


function addSkipLinks() {
  const skipNav = document.createElement('a');
  skipNav.href = '#channels';
  skipNav.className = 'skip-link';
  skipNav.textContent = 'Skip to channels';
  skipNav.style.cssText = `
    position: absolute;
    top: -40px;
    left: 0;
    background: #000;
    color: #fff;
    padding: 8px;
    z-index: 1000;
    font-size: 14px;
    text-decoration: none;
  `;

  const handleFocus = () => skipNav.style.top = '0';
  const handleBlur = () => skipNav.style.top = '-40px';

  skipNav.addEventListener('focus', handleFocus);
  skipNav.addEventListener('blur', handleBlur);
  document.body.insertBefore(skipNav, document.body.firstChild);
}

/**
 * Optimized request deduplication with better memory management
 */
function deduplicateRequest(key, requestFn, options = {}) {
  const {
    ttl = 0, timeout = 15000, force = false
  } = options;

  if (!force && pendingRequests.has(key)) {
    const entry = pendingRequests.get(key);

    // Return cached value if still fresh
    if (entry?.resolved && (ttl <= 0 || (Date.now() - entry.resolvedAt) < ttl)) {
      return Promise.resolve(entry.value);
    }

    // Return pending promise if exists
    if (entry?.promise) return entry.promise;
  }

  const controller = new AbortController();
  const signal = controller.signal;

  const p = (async () => {
    try {
      const result = await Promise.race([
        typeof requestFn === 'function'
          ? requestFn({ signal })
          : Promise.reject(new Error('requestFn not a function')),
        new Promise((_, rej) => setTimeout(() => {
          controller.abort();
          rej(new Error('Request timeout'));
        }, timeout))
      ]);

      pendingRequests.set(key, {
        resolved: true,
        resolvedAt: Date.now(),
        value: result,
        promise: Promise.resolve(result)
      });

      return result;
    } catch (err) {
      pendingRequests.delete(key);
      throw err;
    }
  })();

  pendingRequests.set(key, {
    resolved: false,
    promise: p
  });

  p.abortController = controller;
  return p;
}

// Optimize error log with circular buffer
const MAX_ERROR_LOG_SIZE = 50;
const errorLog = [];

function logErrorToService(error) {
  const entry = {
    timestamp: Date.now(),
    message: error?.message || String(error),
    stack: error?.stack,
    type: error?.type || 'unknown',
    url: window.location.href
  };

  errorLog.push(entry);

  // More efficient than shift() for large arrays
  if (errorLog.length > MAX_ERROR_LOG_SIZE) {
    errorLog.splice(0, errorLog.length - MAX_ERROR_LOG_SIZE);
  }

  // Add error logging service call here if needed
}

function fetchWithTimeout(url, options = {}) {
  const { timeout = 15000, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  return fetch(url, {
    ...fetchOptions,
    signal: controller.signal
  }).finally(() => clearTimeout(timeoutId));
}



// ======================================================================
// GLOBAL ERROR HANDLERS - Optimized to avoid duplicate registration
// ======================================================================

(function setupGlobalErrorHandlers() {
  if (window.__GLOBAL_ERROR_BOUNDARIES_INSTALLED__) return;
  window.__GLOBAL_ERROR_BOUNDARIES_INSTALLED__ = true;

  window.addEventListener("error", (event) => {
    try {
      const error = event.error || event.message || "Unknown error";
      console.error("GLOBAL ERROR:", error);

      logErrorToService?.(error);
      showNotification?.("Unexpected error occurred", "error");

      if (typeof canRecover === "function" && canRecover(error)) {
        attemptRecovery?.();
      }
    } catch (handlerErr) {
      console.warn("Global error handler failed:", handlerErr);
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    try {
      const reason = event.reason || "Unknown async error";
      console.error("UNHANDLED REJECTION:", reason);

      event.preventDefault();

      showNotification?.("Failed to complete operation", "error");
      logErrorToService?.(reason);
    } catch (handlerErr) {
      console.warn("Rejection handler failed:", handlerErr);
    }
  });
})();


window.addEventListener('error', (ev) => {
  try {
    logErrorToService(ev.error || {
      message: ev.message,
      stack: ev.error?.stack
    });
  } catch (e) {
    /* ignore */
  }
});

window.addEventListener('unhandledrejection', (ev) => {
  try {
    logErrorToService(ev.reason || {
      message: String(ev)
    });
  } catch (e) {
    /* ignore */
  }
});


// Public API - Frozen for better performance and immutability
const __iptv = Object.freeze({
  appState,
  get channelLoader() {
    return channelLoader;
  },

  // Channel functions
  selectChannel,

  // UI functions
  handleSortChange,
  showSettingsModal,
  hideSettingsModal,
  closeModal,
  searchChannels,
  clearSearch,
  showFullscreenPrompt,
  toggleFullscreen,
  renderChannels,
  getFavorites,
  getRecentlyWatched,
  updateUserAgentDisplay,

  // Settings functions
  toggleAutoUpdate,
  changeUpdateInterval,
  manualUpdate,
  showAPIKeyModal,
  hideAPIKeyModal,

  // Storage functions
  exportAllData,
  importBackupData,
  triggerImportDialog,
  clearOldStorageData,
  updateStorageDisplay,

  // Debug functions
  getErrorLog: () => [...errorLog],

  // Fullscreen prompt reference
  get fullscreenPrompt() {
    return window.fullscreenPrompt;
  }
});

window.__iptv = __iptv;
