// ============================================
// IPTV CHANNEL MANAGER - ENHANCED VERSION
// ============================================

// ============================================
// USER AGENT OVERRIDE - MUST BE FIRST!
// ============================================
(function initUserAgentOverride() {
  const _originalUserAgent = navigator.userAgent;
  const UA_STORAGE_KEY = "custom-useragent-string-ua";

  try {
    Object.defineProperty(navigator, "userAgent", {
      get: function () {
        const customUA = localStorage.getItem(UA_STORAGE_KEY);
        return customUA ? customUA : _originalUserAgent;
      },
      configurable: true
    });

    //console.log('✅ User Agent override initialized');
  } catch (error) {
    console.error('❌ Failed to override User Agent:', error);
  }

  window.UserAgentManager = {
    get current() { return navigator.userAgent; },
    get original() { return _originalUserAgent; },
    get isCustom() { return localStorage.getItem(UA_STORAGE_KEY) !== null; },

    set(ua) {
      if (!ua || typeof ua !== 'string') return false;
      try {
        localStorage.setItem(UA_STORAGE_KEY, ua);
        console.log('✅ Custom User Agent set. Reload to apply.');
        return true;
      } catch (error) {
        console.error('❌ Failed to set User Agent:', error);
        return false;
      }
    },

    reset() {
      try {
        localStorage.removeItem(UA_STORAGE_KEY);
        console.log('✅ User Agent reset. Reload to apply.');
        return true;
      } catch (error) {
        return false;
      }
    },

    presets: {
      chromeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      iPhoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      androidChrome: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36',
      androidTV: 'Mozilla/5.0 (Linux; Android 9; SHIELD Android TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.164 Safari/537.36',
      samsungTV: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.93 TV Safari/537.36'
    },
    usePreset(presetName) {
      if (!this.presets[presetName]) {
        console.error('Unknown preset:', presetName);
        return false;
      }
      return this.set(this.presets[presetName]);
    },

    info() {
      console.group('🔍 User Agent Info');
      console.log('Current:', this.current);
      console.log('Original:', this.original);
      console.log('Is Custom:', this.isCustom);
      console.groupEnd();
    }
  };
})();

/**
 * LRU (Least Recently Used) Cache implementation
 */
class LRUCache {
  constructor(maxSize = 50, maxAge = 3600000, maxBytes = 5 * 1024 * 1024) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.maxAge = maxAge; // milliseconds
    this.maxBytes = maxBytes;
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get item from cache
   * Returns null if expired or not found
   * Moves item to end (most recently used)
   */
  get(key) {
    if (!this.cache.has(key)) {
      this.misses++;
      return null;
    }

    const item = this.cache.get(key);
    const now = Date.now();

    // Check if expired
    if (now - item.timestamp > this.maxAge) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    // Move to end (mark as recently used)
    this.cache.delete(key);
    this.cache.set(key, {
      ...item,
      timestamp: now, // Update timestamp
      accessCount: (item.accessCount || 0) + 1
    });

    this.hits++;
    return item.data;
  }

  /**
   * Set item in cache
   * Automatically evicts oldest item if size limit reached
   */
  set(key, data, options = {}) {
    const now = Date.now();
    const size = this.estimateSize(data);

    // ✅ Evict until we have space for new item
    while (this.getTotalSize() + size > this.maxBytes && this.cache.size > 0) {
      this.evictOldest();
    }

    // If still can't fit, reject
    if (size > this.maxBytes) {
      console.warn(`⚠️ Item too large for cache: ${size} bytes`);
      return false;
    }

    // Remove oldest if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictOldest();
    }

    // If key exists, delete it first to move to end
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    this.cache.set(key, {
      data,
      timestamp: options.timestamp || now,
      accessCount: 0,
      size: this.estimateSize(data)
    });
  }

  /**
   * Check if key exists and is not expired
   */
  has(key) {
    if (!this.cache.has(key)) return false;

    const item = this.cache.get(key);
    const isExpired = Date.now() - item.timestamp > this.maxAge;

    if (isExpired) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete specific key
   */
  delete(key) {
    return this.cache.delete(key);
  }

  /**
   * Evict oldest (least recently used) item
   */
  evictOldest() {
    if (this.cache.size === 0) return;

    // First key is oldest (Map maintains insertion order)
    const oldestKey = this.cache.keys().next().value;
    this.cache.delete(oldestKey);

    console.log(`🗑️ Evicted cache entry: ${oldestKey}`);
  }

  /**
   * Clear all cache entries
   */
  clear() {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const totalAccess = this.hits + this.misses;
    const hitRate = totalAccess > 0 ? (this.hits / totalAccess * 100).toFixed(2) : 0;

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: `${hitRate}%`,
      entries: Array.from(this.cache.keys())
    };
  }

  /**
   * Remove expired entries
   */
  pruneExpired() {
    const now = Date.now();
    const keysToDelete = [];

    this.cache.forEach((item, key) => {
      if (now - item.timestamp > this.maxAge) {
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach(key => this.cache.delete(key));

    if (keysToDelete.length > 0) {
      console.log(`🧹 Pruned ${keysToDelete.length} expired cache entries`);
    }

    return keysToDelete.length;
  }

  /**
   * Estimate size of data for monitoring
   */
  estimateSize(data) {
    try {
      // JSON length is char count; Blob gives byte size which is more accurate
      const str = typeof data === 'string' ? data : JSON.stringify(data);
      return new Blob([str]).size;
    } catch (e) {
      return 0;
    }
  }


  /**
   * Get total cache size in bytes (approximate)
   */
  getTotalSize() {
    let total = 0;
    this.cache.forEach(item => {
      total += item.size || 0;
    });
    return total;
  }
}



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

    performance.clearMarks('channel-load-start');
    performance.clearMarks('channel-load-end');
    performance.clearMeasures('channel-load');
  }
}

/**
 * Network Status Monitoring System
 * Enhanced, configurable, and AppState-friendly single-file class
 */
class NetworkMonitor {
  constructor(options = {}) {
    // Configurable options with sensible defaults
    this.config = {
      checkInterval: options.checkInterval || 30000, // ms
      healthCheckTimeout: options.healthCheckTimeout || 5000, // ms
      qualitySamples: options.qualitySamples || 5,
      maxRetries: options.maxRetries || 3,
      autoResumeDelay: options.autoResumeDelay || 1000,
      // Connection quality thresholds (in milliseconds)
      thresholds: {
        EXCELLENT: (options.thresholds && options.thresholds.EXCELLENT) || 100, // < 100ms
        GOOD: (options.thresholds && options.thresholds.GOOD) || 300,           // 100-300ms
        FAIR: (options.thresholds && options.thresholds.FAIR) || 600,           // 300-600ms
        POOR: (options.thresholds && options.thresholds.POOR) || 1000           // > 600ms
      },
      ...options
    };

    // Basic runtime state (keeps original public fields for compatibility)
    this.isOnline = navigator.onLine;
    this.latency = 0;
    this.quality = 'unknown';
    this.connectionType = 'unknown';
    this.lastCheck = 0;
    this.checkInterval = null;
    this.statusListeners = new Set();
    this.qualityListeners = new Set();

    // Resilience and telemetry
    this.retryCount = 0;
    this.maxRetries = this.config.maxRetries;

    this.stats = {
      totalChecks: 0,
      successfulChecks: 0,
      failedChecks: 0,
      totalDowntime: 0,
      lastDowntimeStart: null
    };

    // Internal bound handlers (populated in setupEventListeners)
    this._onOnline = null;
    this._onOffline = null;
    this._onVisibilityChange = null;
    this._onConnectionChange = null;
  }

  /**
   * Initialize network monitoring
   */
  initialize() {
    // Avoid double initialization if desired (optional)
    if (this._initialized) return this;
    this._initialized = true;

    this.setupEventListeners();
    this.startQualityMonitoring();
    this.detectConnectionType();

    // Update appState
    try {
      appState.set('settings.isOnline', this.isOnline);
      appState.set('settings.networkQuality', this.quality);
      appState.set('settings.connectionType', this.connectionType);
    } catch (e) {
      // appState may be unavailable in some contexts; ignore safely
    }

    // Register cleanup with appState if available
    try {
      if (typeof appState?.addCleanup === 'function') {
        this._appStateCleanupUnsub = appState.addCleanup(() => this.cleanup());
      }
    } catch (e) { /* ignore */ }

    console.log(`🌐 Network Monitor: ${this.isOnline ? 'Online' : 'Offline'}, Type: ${this.connectionType}`);
    return this;
  }

  /**
   * Setup online/offline event listeners (stores bound handlers for cleanup)
   */
  setupEventListeners() {
    // store bound handlers so they can be removed later
    this._onOnline = this.handleOnline.bind(this);
    this._onOffline = this.handleOffline.bind(this);
    this._onVisibilityChange = this.handleVisibilityChange.bind(this);
    this._onConnectionChange = this.handleConnectionChange.bind(this);

    // Online/Offline events
    window.addEventListener('online', this._onOnline);
    window.addEventListener('offline', this._onOffline);

    // Network Information API (if available)
    if (navigator.connection) {
      try {
        navigator.connection.addEventListener('change', this._onConnectionChange);
      } catch (e) {
        // Some browsers may not support addEventListener on connection
      }
    }

    // Page visibility changes (tab switch)
    document.addEventListener('visibilitychange', this._onVisibilityChange);
  }

  /**
   * Start periodic network quality checks
   */
  startQualityMonitoring() {
    // Clear existing interval
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    const intervalMs = this.config.checkInterval || 30000;

    // Check periodically when online
    this.checkInterval = setInterval(() => {
      if (this.isOnline) {
        this.checkConnectionQuality();
      }
    }, intervalMs);

    // Initial check (short delay)
    if (this.isOnline) {
      setTimeout(() => this.checkConnectionQuality(), 1000);
    }

    // Store interval in appState for centralized cleanup
    try {
      if (typeof appState?.setIntervalRef === 'function') {
        appState.setIntervalRef('networkMonitor', this.checkInterval);
      }
    } catch (e) { /* ignore */ }
  }


  /**
   * Detect connection type using Network Information API
   */
  detectConnectionType() {
    try {
      const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (connection) {
        this.connectionType = connection.effectiveType || connection.type || 'unknown';
        if (typeof appState?.set === 'function') {
          appState.set('settings.connectionType', this.connectionType);
        }
      }
    } catch (e) {
      // ignore
    }
  }

  /**
   * Check connection quality by measuring latency
   */
  async checkConnectionQuality() {
    if (!this.isOnline) return;

    this.stats.totalChecks++;
    const startTime = Date.now();
    this.lastCheck = startTime;

    try {
      // Use multiple endpoints for reliability
      const endpoints = [
        'https://connectivitycheck.gstatic.com/generate_204',
        'https://clients3.google.com/generate_204'
      ];


      const results = await Promise.allSettled(
        endpoints.map(url => this.measureLatency(url))
      );

      // Calculate average latency from successful measurements
      const successful = results.filter(r => r.status === 'fulfilled');
      const successRate = successful.length / endpoints.length;

      if (successful.length > 0) {
        const latencies = successful.map(r => r.value);
        this.latency = Math.round(
          latencies.reduce((a, b) => a + b, 0) / latencies.length
        );

        // Determine quality based on latency thresholds
        this.quality = this.determineQuality(this.latency);

        // Update appState
        try {
          appState.set('settings.networkLatency', this.latency);
          appState.set('settings.networkQuality', this.quality);
        } catch (e) { /* ignore */ }

        // Notify listeners
        this.notifyQualityChange();

        //console.log(`📡 Network Quality: ${this.quality} (${this.latency}ms)`);

        // Show warning if quality is poor
        if (this.quality === 'poor') {
          this.showQualityWarning();
        }

        // success bookkeeping
        this.stats.successfulChecks++;
        this.retryCount = 0; // reset retry counter on success
      } else {
        // no successful checks — treat as partial failure
        this.stats.failedChecks++;
        this.retryCount++;
        console.warn(`Network checks failed (${this.retryCount}/${this.maxRetries})`);
        if (this.retryCount >= this.maxRetries) {
          // escalate to offline state
          this.handleOffline({ manual: false });
        }
      }
    } catch (error) {
      this.stats.failedChecks++;
      this.retryCount++;
      console.warn('Network quality check failed:', error);
      if (this.retryCount >= this.maxRetries) {
        this.handleOffline({ manual: false });
      }
    }
  }


  /**
   * Measure latency to a specific endpoint
   */
  async measureLatency(url) {
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const timeoutMs = this.config.healthCheckTimeout || 5000;
      const timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error('Timeout'));
      }, timeoutMs);

      const start = performance.now();

      fetch(url, {
        method: 'HEAD',
        mode: 'no-cors',
        cache: 'no-cache',
        signal: controller.signal
      })
        .then(() => {
          clearTimeout(timeoutId);
          const end = performance.now();
          resolve(end - start);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * Determine connection quality based on latency
   */
  determineQuality(latency) {
    const t = this.config.thresholds;
    if (latency <= t.EXCELLENT) return 'excellent';
    if (latency <= t.GOOD) return 'good';
    if (latency <= t.FAIR) return 'fair';
    return 'poor';
  }

  /**
   * Handle online event
   */
  handleOnline(event) {
    if (this.isOnline) return; // already online

    this.isOnline = true;
    try { appState.set('settings.isOnline', true); } catch (e) { /* ignore */ }

    // Track downtime
    if (this.stats.lastDowntimeStart) {
      this.stats.totalDowntime += Date.now() - this.stats.lastDowntimeStart;
      this.stats.lastDowntimeStart = null;
    }

    console.log('🌐 Network: Online');
    showNotification('📶 Network connection restored', 'success');

    // Update connection type
    this.detectConnectionType();

    // Start quality monitoring
    this.startQualityMonitoring();

    // Notify listeners
    this.notifyStatusChange();

    // Auto-resume playback if applicable
    this.handleAutoResume();

    // Immediate re-check
    setTimeout(() => this.checkConnectionQuality(), 1000);
  }

  /**
   * Handle offline event
   */
  handleOffline(options = {}) {
    if (!this.isOnline && !options.force) return; // already offline

    this.isOnline = false;
    appState.set('settings.isOnline', false);
    this.quality = 'offline';
    try { appState.set('settings.isOnline', false); } catch (e) { /* ignore */ }

    // Start downtime timer
    if (!this.stats.lastDowntimeStart) {
      this.stats.lastDowntimeStart = Date.now();
    }

    console.log('🌐 Network: Offline');
    showNotification('📴 Network connection lost', 'error');

    // Notify listeners
    this.notifyStatusChange();

    // Handle playback interruption
    this.handlePlaybackInterruption();
  }

  /**
   * Handle connection change (Network Information API)
   */
  handleConnectionChange() {
    const previousType = this.connectionType;
    this.detectConnectionType();

    if (previousType !== this.connectionType) {
      console.log(`🔀 Connection type changed: ${previousType} → ${this.connectionType}`);
      showNotification(`Network changed to ${this.connectionType}`, 'info');
    }
  }

  /**
   * Handle visibility change (tab switch)
   */
  handleVisibilityChange() {
    if (!document.hidden && this.isOnline) {
      // Tab became visible - recheck network
      setTimeout(() => this.checkConnectionQuality(), 1000);
    }
  }

  /**
   * Handle playback interruption on network loss
   */
  handlePlaybackInterruption() {
    const player = channelLoader?.getPlayer?.();
    if (!player) return;

    // Pause player if playing
    try {
      if (!player.paused()) {
        player.pause();
        console.log('⏸️ Playback paused due to network loss');
      }
    } catch (error) {
      console.warn('Failed to pause player:', error);
    }

    // Clear buffers if using video.js with HLS
    try {
      if (player.tech_ && player.tech_.vhs && typeof player.tech_.vhs.resetEverything === 'function') {
        player.tech_.vhs.resetEverything();
        console.log('🧹 Cleared video buffers');
      }
    } catch (error) {
      // Ignore - not all players support this
    }
  }

  /**
   * Handle auto-resume when network returns
   */
  handleAutoResume() {
    const player = channelLoader?.getPlayer?.();
    const currentChannel = (typeof appState?.get === 'function') ? appState.get('player.currentChannel') : null;

    if (!player || !currentChannel) return;

    // Only auto-resume if player was playing before network loss
    if (player && player.paused()) {
      setTimeout(() => {
        if (this.isOnline && player.paused()) {
          player.play()
            .then(() => {
              console.log('▶️ Auto-resumed playback');
              showNotification('Playback resumed', 'success');
            })
            .catch((error) => {
              // Check for user-driven errors (like 'NotAllowedError' for unmuted play)
              if (error && (error.name === 'NotAllowedError' || error.name === 'AbortError')) {
                console.warn("Could not auto-resume playback due to browser policy or interruption:", error?.message);
                try { channelLoader.showPlayButton(); } catch (e) { /* ignore */ }
                showNotification("Playback failed: Please click the 'Play' button.", "warning");
              } else {
                console.error("Critical error during auto-resume:", error);
                showNotification("Error resuming stream. Please re-select the channel.", "error");
              }
            });
        }
      }, this.config.autoResumeDelay || 1000);
    }
  }

  /**
   * Show quality warning when connection is poor
   */
  showQualityWarning() {
    if (!this.isOnline) return;

    // Don't show too frequently (max once per 2 minutes)
    const lastWarning = (typeof appState?.get === 'function') ? appState.get('ui.lastNetworkWarning') || 0 : 0;
    if (Date.now() - lastWarning < 120000) return;

    try { appState.set('ui.lastNetworkWarning', Date.now()); } catch (e) { /* ignore */ }

    showNotification(
      `⚠️ Poor network detected (${this.latency}ms). Playback may buffer.`,
      'warning',
      5000
    );
  }

  /**
   * Add status change listener
   */
  addStatusListener(callback) {
    this.statusListeners.add(callback);
    return () => this.statusListeners.delete(callback);
  }

  /**
   * Add quality change listener
   */
  addQualityListener(callback) {
    this.qualityListeners.add(callback);
    return () => this.qualityListeners.delete(callback);
  }

  /**
   * Notify status change to all listeners
   */
  notifyStatusChange() {
    this.statusListeners.forEach(callback => {
      try {
        callback(this.isOnline, this.connectionType);
      } catch (error) {
        console.warn('Network status listener error:', error);
      }
    });
  }

  /**
   * Notify quality change to all listeners
   */
  notifyQualityChange() {
    this.qualityListeners.forEach(callback => {
      try {
        callback(this.quality, this.latency);
      } catch (error) {
        console.warn('Network quality listener error:', error);
      }
    });
  }

  /**
   * Get current network status
   */
  getStatus() {
    return {
      isOnline: this.isOnline,
      latency: this.latency,
      quality: this.quality,
      connectionType: this.connectionType,
      lastCheck: this.lastCheck,
      stats: { ...this.stats }
    };
  }

  /**
   * Force a network check
   */
  async forceCheck() {
    console.log('🔄 Forcing network check...');
    await this.checkConnectionQuality();
    return this.getStatus();
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    // Clear interval and appState reference
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    try {
      if (typeof appState?.clearIntervalRef === 'function') {
        appState.clearIntervalRef('networkMonitor');
      }
    } catch (e) { /* ignore */ }

    this.statusListeners.clear();
    this.qualityListeners.clear();

    // Remove bound event listeners (only if we stored them)
    if (this._onOnline) window.removeEventListener('online', this._onOnline);
    if (this._onOffline) window.removeEventListener('offline', this._onOffline);
    if (this._onVisibilityChange) document.removeEventListener('visibilitychange', this._onVisibilityChange);
    if (this._onConnectionChange && navigator.connection) {
      try {
        navigator.connection.removeEventListener('change', this._onConnectionChange);
      } catch (e) { /* ignore */ }
    }

    // Unregister appState cleanup if we registered one
    try {
      if (this._appStateCleanupUnsub) {
        this._appStateCleanupUnsub();
        this._appStateCleanupUnsub = null;
      }
    } catch (e) { /* ignore */ }

    // Clear any other references
    this._onOnline = null;
    this._onOffline = null;
    this._onVisibilityChange = null;
    this._onConnectionChange = null;

    this._initialized = false;
  }
}


// ============================================
// NETWORK MONITOR INSTANCE
// ============================================
const networkMonitor = new NetworkMonitor();

// ============================================
// CONSTANTS - MUST BE FIRST
// ============================================
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour
const DOUBLE_TAP_DELAY = 300;

// ============================================
// CACHE INSTANCES
// ============================================
const rssCache = new LRUCache(50, CACHE_DURATION);
const liveCache = new LRUCache(30, CACHE_DURATION);

// ============================================
// GLOBAL STATE VARIABLES
// ============================================
let fullscreenPrompt = null;
let hasUserInteracted = false;

// ============================================
// CONSTANTS & CONFIGURATION
// ============================================
const AUTO_UPDATE_KEY = "autoUpdateEnabled";
const UPDATE_INTERVAL_KEY = "updateIntervalHours";
const MAX_RECENT = 18;


// ✅ NEW: Improved localStorage keys with namespace
const LS_KEYS = {
  FAVORITES: "favorites",
  RECENT: "recentlyWatched",
  CHANNELS: "allChannelsData",
  LIVE: "liveChannelsData",
  FEEDS: "rssFeedsData",
  WATCH_TIME: "watchTimePerChannel",
  YT_QUOTA: "__iptv_yt_quota",
  RSS_FAILED: "rssFailedFeeds"
};

const API_KEY_STORAGE_KEY = "youtube_api_key";
const CACHE_KEY = "lastChannelsUpdate";

const MAX_MB = 6; // total quota in MB

const VERSION = "1.0.0";

const PLAYBACK_CONSTANTS = {
  MAX_ELEMENT_WAIT_TIME: 2000,
  PLAYER_READY_TIMEOUT: 5000,
  DOM_MUTATION_CHECK_INTERVAL: 50,
  YOUTUBE_READY_CHECK_INTERVAL: 100,
  TRANSITION_DELAY: 0,
};


// ✅ NEW: Debounce configuration
const DEBOUNCE_MS = 180;

const pendingRequests = new Map();


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
        lastNetworkWarning: null,
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
        lastUpdate: 0
      },
      intervals: {
        watch: null,
        autoUpdate: null,
        overlayShow: null,
        overlayHide: null,
        promptTimeout: null,
        numberTimeout: null,
        navigationDebounce: null
      },
      settings: {
        isOnline: navigator.onLine,
        networkQuality: null,
        connectionType: null,
        networkLatency: null,
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


  get userAgent() {
    return this._state.system.userAgent.current;
  }

  get isCustomUserAgent() {
    return this._state.system.userAgent.isCustom;
  }

  get(path) {
    if (!path) return this.state;
    return path.split('.').reduce((o, k) => (o ? o[k] : undefined), this.state);
  }

  set(path, value) {
    const version = (this._version || 0) + 1;
    this._version = version;

    // Apply state
    const keys = path.split('.');
    const last = keys.pop();
    let target = this.state;
    for (const k of keys) {
      if (!(k in target)) target[k] = {};
      target = target[k];
    }
    target[last] = value;

    // Delay localStorage save safely
    this._queuePersist(path, value, version);

    this.notify(path, value);
  }

  _queuePersist(path, value, version) {
    clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => {
      // Only persist if version is still the latest
      if (this._version === version) {
        this._doPersist(path, value);
      }
    }, 100);
  }

  _doPersist(path, value) {
    try {
      if (path === 'channels.all') {
        safeLocalStorageSet(LS_KEYS.CHANNELS, JSON.stringify(this.state.channels?.all || []));
      } else {
        // keep legacy behavior if needed for other paths (no-op)
      }
    } catch (e) {
      console.warn("Failed to persist", e);
    }
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

  getTimeoutRef(key) {
    return this.timeoutRefs[key];
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
    try { this.reset('intervals'); } catch (e) { }
    try { this.reset('cache'); } catch (e) { }

    // Call each cleanup callback safely
    for (const cb of Array.from(this.cleanupCallbacks)) {
      try { cb(); } catch (e) { console.warn(e); }
    }

    this.cleanupCallbacks.clear();
    this.subscribers.clear();
    this.set('player.instance', null);
  }

}

const appState = new AppStateManager();






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
  // Blob.size already reports the byte length
  return new Blob([str]).size;
}


function getAvailableSpace() {
  const MAX_BYTES = MAX_MB * 1024 * 1024;
  const usage = getStorageUsage();   // { totalBytes, totalKB, totalMB, itemCount, items }

  if (!usage || typeof usage.totalBytes !== "number") {
    console.warn("⚠️ Storage usage unavailable.");
    return MAX_BYTES;
  }

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

  // 1. Get backup just in case we need to roll back
  const backup = localStorage.getItem(key);

  // 2. Pre-check: If we already know it won't fit, clean up first
  if (actualSize > available) {
    console.warn(`⚠️ Data size (${actualSize}) exceeds available space (${available})`);

    if (retryOnFail) {
      // Try smart cleanup first
      predictiveCleanup();

      // If still not enough, try aggressive cleanup
      if (getAvailableSpace() < actualSize) {
        clearOldStorageData();
      }
    } else {
      // If we already retried and it still doesn't fit, fail early
      return false;
    }
  }

  try {
    // 3. Attempt Write
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    console.warn("Storage write failed:", e);

    // 4. Restore Backup (Critical: Wrap in try-catch to prevent crash)
    if (backup !== null) {
      try {
        localStorage.setItem(key, backup);
      } catch (backupErr) {
        console.error("CRITICAL: Failed to restore backup!", backupErr);
        // Data is likely lost for this key, but app won't crash
      }
    }

    // 5. Handle Quota Error specifically
    if ((e.name === 'QuotaExceededError' || e.code === 22) && retryOnFail) {
      console.log("Quota exceeded, attempting aggressive cleanup and retry...");
      clearOldStorageData();
      // Retry exactly once (pass false to prevent infinite recursion)
      return safeLocalStorageSet(key, value, false);
    }

    showNotification('Failed to save data', 'error');
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
  let lastArgs, lastThis;
  const { leading = false, trailing = true, maxWait } = options;

  function invoke() {
    fn.apply(lastThis, lastArgs);
    timeout = null;
  }

  const debounced = function (...args) {
    lastArgs = args;
    lastThis = this;

    const shouldInvokeLeading = leading && !timeout;

    clearTimeout(timeout);
    timeout = setTimeout(() => {
      if (trailing) invoke();
    }, wait);

    if (shouldInvokeLeading) invoke();
  };

  debounced.cancel = () => clearTimeout(timeout);
  debounced.flush = () => {
    if (timeout) {
      clearTimeout(timeout);
      invoke();
    }
  };

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
function showNotification(message, type = 'info', time = 3000) {
  // --- Clear any existing notification timeout from AppStateManager ---
  // This ensures a new notification won't be removed prematurely by an old timer.
  appState.clearTimeoutRef('notificationTimer');

  // --- Remove existing notifications gracefully ---
  // Fade them out by removing 'visible', then remove from DOM after transition.
  document.querySelectorAll('.iptv-notification').forEach(n => {
    n.classList.remove('visible');
    setTimeout(() => {
      if (n.isConnected) n.remove();
    }, 400); // Match this delay with your CSS transition duration
  });

  // --- Create new notification element ---
  const el = document.createElement('div');
  el.className = `iptv-notification notification-${type}`;

  // Accessibility roles: 'alert' for errors, 'status' for others
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  el.setAttribute('aria-atomic', 'true');

  // Allow HTML markup (icons, SVG, etc.) inside the message
  el.innerHTML = message;

  // Add to DOM
  document.body.appendChild(el);

  // --- Trigger CSS transition ---
  // Using requestAnimationFrame ensures the 'visible' class is applied
  // after the element is in the DOM, so transitions animate correctly.
  requestAnimationFrame(() => {
    el.classList.add('visible');
  });

  // --- Cleanup helper ---
  // Removes event listeners when notification is dismissed.
  const cleanup = () => {
    document.removeEventListener('keydown', handleKeydown);
  };

  // --- Hide function ---
  // Handles fade out, DOM removal, timeout clearing, and cleanup.
  const hide = () => {
    if (!el.isConnected) return;
    el.classList.remove('visible');
    setTimeout(() => {
      if (el.isConnected) {
        el.remove();
        cleanup(); // Ensure Escape listener is removed
        appState.clearTimeoutRef('notificationTimer');
      }
    }, 400); // Match CSS transition duration
  };

  // --- Click to dismiss ---
  el.addEventListener('click', () => {
    appState.clearTimeoutRef('notificationTimer');
    hide();
  });

  // --- Escape key to dismiss ---
  const handleKeydown = (e) => {
    if (e.key === 'Escape' && el.isConnected) {
      appState.clearTimeoutRef('notificationTimer');
      hide();
    }
  };
  document.addEventListener('keydown', handleKeydown);

  // --- Centralized timeout management ---
  // Automatically hide after 'time' ms, stored in AppStateManager.
  const timer = setTimeout(hide, time);
  appState.setTimeoutRef('notificationTimer', timer);

  // --- Register cleanup with AppStateManager ---
  // Ensures notification and listeners are removed if appState triggers cleanup.
  appState.addCleanup(() => {
    if (el.isConnected) {
      cleanup();
      el.remove();
    }
  });

  // --- Return controls for external management ---
  // Allows manual hide or cleanup from outside if needed.
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
// ChannelLoader: manages player lifecycle, events, and cleanup
// ============================================
// ======================================================================
// ChannelLoader – Final, Leak-Safe, Error-Proof Version
// ======================================================================
/**
 * Manages video player lifecycle with race condition protection
 * @class ChannelLoader
 * @param {Object} opts - Configuration options
 * @param {string} opts.playerContainerId - DOM container ID
 * @param {number} opts.persistDelay - Delay before persisting state
 */
class ChannelLoader {
  constructor(opts = {}) {
    // async operation control
    this.currentOperation = null;
    this.currentOperationId = null;

    // modern WeakRef player
    this.playerRef = null;

    // legacy player reference (your file still uses this in places)
    this.playerInstance = null;

    // legacy event cleanup list
    this.eventCleanupCallbacks = [];

    // automatic GC cleanup
    this.cleanupRegistry = new FinalizationRegistry((cleanup) => {
      try { cleanup(); } catch (e) { console.warn("Finalizer cleanup error:", e); }
    });

    // optional config (timeouts, container id)
    this.config = Object.assign({ playerContainerId: "player-container", persistDelay: 100 }, opts);

    // make sure app-level cleanup triggers player cleanup on app shutdown
    if (typeof appState !== "undefined" && typeof appState.addCleanup === "function") {
      appState.addCleanup(() => {
        try { this.cleanupPlayer(true); } catch (e) { console.warn(e); }
      });
    }
  }

  // ----------------------------------------------------------------------
  // SAFE: used to bind event listeners
  // ----------------------------------------------------------------------
  _bindPlayerEvent(player, event, handler) {
    // Bind listener with whatever API exists
    try {
      if (typeof player.addEventListener === "function") {
        player.addEventListener(event, handler);
      } else if (typeof player.on === "function") {
        player.on(event, handler);
      } else if (typeof player.addListener === "function") {
        player.addListener(event, handler);
      }
    } catch (e) { /* ignore */ }

    // Track for manual disposal
    try {
      if (!player._boundEvents) player._boundEvents = [];
      player._boundEvents.push({ event, handler });

      // GC-based cleanup
      this.cleanupRegistry.register(player, () => {
        try {
          if (typeof player.removeEventListener === "function") {
            player.removeEventListener(event, handler);
          } else if (typeof player.off === "function") {
            player.off(event, handler);
          } else if (typeof player.removeListener === "function") {
            player.removeListener(event, handler);
          }
        } catch (e) { }
      });
    } catch (e) { /* ignore */ }
  }




  // --------------------------
  // Video.js / HLS safe disposal routine
  // --------------------------

  /**
 * Safely disposes video.js player with HLS cleanup
 * @private
 * @param {Object} player - Video.js player instance
 * @returns {Promise<void>}
 */
  async _disposeVideoJS(player) {
    try {
      if (!player) return;

      // Pause playback if possible
      try { player.pause?.(); } catch (e) { }

      // Remove generic event listeners
      try {
        if (typeof player.off === "function") {
          // video.js: off() removes all handlers
          try { player.off(); } catch (e) { }
        } else if (typeof player.removeEventListener === "function") {
          // best-effort removal for tracked events
          const events = player._boundEvents;
          if (events && typeof events.forEach === "function") {
            try {
              events.forEach(({ event, handler }) => {
                try {
                  player.removeEventListener(event, handler);
                } catch (e) { }
              });
            } catch (e) { }
            try { events.clear?.(); } catch (e) { }
          }
        }
      } catch (e) { }

      // Attempt to dispose internal HLS/VHS instances
      try {
        // video.js tech internals vary by version; handle common cases
        const tech = player.tech_ || (typeof player.tech === "function" && player.tech(true)) || null;
        const hls = tech?.hls || tech?.vhs || tech?.hlsHandler || tech?.vhsHandler;
        if (hls) {
          try { typeof hls.dispose === "function" && hls.dispose(); } catch (e) { }
          try { typeof hls.destroy === "function" && hls.destroy(); } catch (e) { }
        }
      } catch (e) { }

      // Call video.js dispose() if available (safest path)
      try {
        if (typeof player.dispose === "function") {
          // video.js dispose is synchronous; wrap in try/catch
          try { player.dispose(); } catch (e) { console.warn("player.dispose() error:", e); }
        }
      } catch (e) { }

      // As a fallback, call destroy() if available
      try {
        if (typeof player.destroy === "function") {
          try { await player.destroy(); } catch (e) { }
        }
      } catch (e) { }

      // Remove DOM node created by player
      try {
        const el = (typeof player.el === "function") ? player.el() : player.element || null;
        if (el && el.parentNode) {
          try { el.parentNode.removeChild(el); } catch (e) { }
        }

        // Also attempt to remove known wrappers
        const container = document.getElementById(this.config.playerContainerId);
        if (container) {
          container.querySelectorAll("video, .video-js, .vjs-tech, .vjs-video").forEach(node => {
            try { node.remove(); } catch (e) { }
          });
        }
      } catch (e) { }
    } catch (outer) {
      console.warn("Video.js disposal outer error:", outer);
    }
  }

  // ======================================================================
  // FINAL cleanupPlayer() — Universal, Safe, Leak-Free, Video.js Compatible
  // ======================================================================
  async cleanupPlayer(force = false) {
    // Stop any playback timers / analytics
    try { stopWatching?.(); } catch { }

    // Get player from either source
    const player = this.playerRef?.deref?.() || this.playerInstance;

    if (player) {
      // Single unified cleanup
      await this._disposeVideoJS(player);
    }

    // Clear all references
    this.playerRef = null;
    this.playerInstance = null;
    this.eventCleanupCallbacks = [];

    // Clear DOM
    const container = document.getElementById(this.config.playerContainerId);
    if (container) container.innerHTML = '';

    if (!force) {
      appState.set('player.instance', null);
      appState.set('player.currentChannel', null);
      appState.set("player.isPlaying", false);
    }
  }


  // ----------------------------------------------------------------------
  // initializePlayer – handles creation and event binding
  // ----------------------------------------------------------------------
  // --------------------------
  // initializePlayer — loads a player (video.js / Clappr / custom) and binds events
  // Note: relies on your existing loadVideoPlayer(url, options) function to create the player
  // --------------------------
  async initializePlayer(url, name, isLive, token) {
    // Wait for container
    const container = await this.waitForElement("player-container");
    token.throwIfCancelled();

    // Build stream + metadata
    const streamConfig = createStreamConfig(url);
    const metadata = { isLive: !!isLive };

    // Create video element
    const videoId = `player-${Date.now()}`;
    const videoElement = this.createVideoElement(videoId);
    container.innerHTML = "";
    container.appendChild(videoElement);

    await this.waitForElement(videoId);
    token.throwIfCancelled();

    // Build player config
    const playerConfig = buildPlayerOptions(streamConfig, metadata);
    console.log('🎬 Initializing Video.js player...');

    // ✅ This is your actual player creation

    let player;
    try {
      player = videojs(videoElement, playerConfig);
      this.playerInstance = player;
      appState.set("player.instance", player);
    } catch (e) {
      console.error("❌ Player init failed:", e);
      throw e;
    }

    token.throwIfCancelled();
    if (!player) throw new Error("Player failed to initialize");

    // Store references safely
    try {
      this.playerRef = new WeakRef(player);
    } catch {
      this.playerRef = { deref: () => player };
    }

    // Defensive event container
    if (!player._boundEvents) {
      player._boundEvents = new Set();
    }

    // Safe event binding
    try {
      this._bindPlayerEvent(player, "error", (e) => {
        try { console.warn("⚠️ Player error event:", e); } catch { }
      });
      this._bindPlayerEvent(player, "ended", () => {
        try { console.log("ℹ️ Playback ended"); } catch { }
      });
      this._bindPlayerEvent(player, "timeupdate", () => {
        try { /* analytics hook */ } catch { }
      });
    } catch (e) {
      console.warn("Event binding failed:", e);
    }

    // Register cleanup
    try {
      this.cleanupRegistry.register(player, () => {
        try { this._disposeVideoJS(player); } catch { }
      });
    } catch (e) {
      console.warn("Cleanup registry failed:", e);
    }

    // Error recovery for HLS
    try {
      if (streamConfig.type === "hls" && player.tech({ IWillNotUseThisInPlugins: true })) {
        this.setupHLSErrorRecovery();
      }
    } catch (e) {
      console.warn("HLS recovery setup failed:", e);
    }

    appState.set('player.instance', player);

    // Setup events and monitoring
    this.setupPlayerEvents(name, isLive, streamConfig.type === 'youtube', token);
    if (streamConfig.type === 'youtube') this.setupYouTubeQualityMonitoring(token);

    // Wait for ready
    await this.waitForPlayerReady(token);
    token.throwIfCancelled();

    // UI setup
    showChannelInfoOverlay();
    await this.attemptAutoplay();
    this.setupFullscreenCloseButton();

    return player;
  }


  // ----------------------------------------------------------------------
  // Cancel active load operation
  // ----------------------------------------------------------------------
  cancelOperation() {
    try {
      if (this.currentOperation) {
        this.currentOperation.cancel?.("New channel selected");
        this.currentOperation = null;
      }
    } catch (e) { }
  }

  // ----------------------------------------------------------------------
  // Race-condition protection
  // ----------------------------------------------------------------------
  verifyOperation(expectedId, token) {
    token.throwIfCancelled();
    if (this.currentOperationId !== expectedId) {
      throw new Error("Operation superseded");
    }
  }

  // ----------------------------------------------------------------------
  // loadChannel – main entry point
  // ----------------------------------------------------------------------
  /**
 * Loads a channel with race-condition protection and cleanup
 * @param {string} url - Stream URL (HLS/DASH/YouTube)
 * @param {string} name - Channel display name
 * @param {string} image - Channel thumbnail URL
 * @param {string} description - Channel description
 * @param {number} number - Channel number for direct access
 * @param {boolean} isLive - Whether channel is live stream
 * @returns {Promise<void>}
 * @throws {Error} If player initialization fails
 */
  async loadChannel(url, name, image, description, number, isLive) {
    if (!url) return;

    // cancel previous load
    this.cancelOperation();

    const token = new CancellationToken();
    this.currentOperation = token;
    const opId = Date.now() + Math.random();
    this.currentOperationId = opId;

    console.log(`🚀 Loading channel: ${name} (OpID: ${opId})`);

    // Add token checks before EVERY async operation:
    try {
      this.verifyOperation(opId, token);

      appState.set("ui.isModalOpen", true);

      this.updateChannelUI(name, image, description, number);

      this.verifyOperation(opId, token);
      await this.cleanupPlayer();

      this.verifyOperation(opId, token);
      await this.initializePlayer(url, name, isLive, token);

      this.verifyOperation(opId, token);
      appState.set("player.currentChannel", { url, name, image, description, number, isLive });
      appState.set("player.isPlaying", true);

    } catch (err) {
      if (!token.isCancelled()) {
        console.error(`❌ Failed to load channel ${name}:`, err);
        showErrorToUser(`Failed to load ${name}: ${err.message}`);
      } else {
        console.log(`⏹️ Channel load cancelled: ${name}`);
      }
    } finally {
      // Only clear current op if it's strictly THIS operation finishing
      if (this.currentOperationId === opId) {
        this.currentOperation = null;
      }

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

      let tid = null; // <-- declared early
      const obs = new MutationObserver(() => {
        const el = document.getElementById(id);
        if (el) {
          try { obs.disconnect(); } catch (_) { }
          if (tid) clearTimeout(tid);
          resolve(el);
        }
      });

      obs.observe(document.body, { childList: true, subtree: true });

      tid = setTimeout(() => {
        try { obs.disconnect(); } catch (_) { }
        reject(new Error(`Element ${id} not found`));
      }, PLAYBACK_CONSTANTS.MAX_ELEMENT_WAIT_TIME);
    });
  }


  async waitForPlayerReady(token) {
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

      const isNetworkError =
        error?.code === 2 ||
        error?.message?.toLowerCase().includes('network') ||
        error?.message?.toLowerCase().includes('fetch');

      console.error('🚨 Player error details:', {
        code: error?.code,
        message: error?.message,
        type: error?.type,
        metadata: error?.metadata,
        isNetworkError
      });

      /* --------------------------------------------------
         YOUTUBE ERROR 1150 (NEW, SAFE ADDITION)
      -------------------------------------------------- */
      if (isYouTube && error?.code === 1150) {
        console.warn('⚠️ YouTube Error 1150 detected - Video restricted/unavailable');

        // Record the failure for retry system
        const channelId =
          resolveYouTubePlayback(this.playerInstance);

        if (channelId) {
          liveRetryManager.recordFailure(
            channelId,
            'YouTube error 1150'
          );
          console.log(`🔁 Queued channel for retry: ${channelId}`);
        } else {
          console.warn('⚠️ Failed to resolve channelId for 1150');
        }

        showErrorToUser(
          'This live stream is temporarily unavailable. It will be retried automatically.'
        );

        // Don't stop watching immediately - let user decide
        // But pause the player to prevent continuous errors
        if (this.playerInstance && !this.playerInstance.paused()) {
          this.playerInstance.pause();
        }

        stopWatching();
        return;
      }

      /* --------------------------------------------------
         EXISTING ERROR HANDLING (UNCHANGED)
      -------------------------------------------------- */
      if (error) {
        switch (error.code) {
          case 1:
            console.warn('⚠️ Media loading aborted');
            break;

          case 2:
            console.warn('⚠️ Network error - attempting recovery...');

            if (!navigator.onLine) {
              showNotification(
                'Network offline. Please check connection.',
                'error'
              );
              return;
            }

            const networkQuality =
              appState.get('settings.networkQuality');

            if (networkQuality === 'poor') {
              showNotification(
                'Poor network quality. Trying lower quality...',
                'warning'
              );
            }

            setTimeout(() => {
              if (this.playerInstance && !token.isCancelled()) {
                console.log('🔄 Attempting to reload stream...');
                const currentSrc = this.playerInstance.currentSrc();

                this.playerInstance.src(currentSrc);
                this.playerInstance.play().catch(e => {
                  console.error('❌ Reload failed:', e);
                  showErrorToUser(
                    'Stream failed to load. Please check network connection.'
                  );
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

    /* --------------------------------------------------
       WAITING / BUFFERING
    -------------------------------------------------- */
    const waitingHandler = () => {
      if (token.isCancelled()) return;

      console.log('⏱ Buffering...');
      const isOnline = appState.get('settings.isOnline');

      if (isOnline) {
        showNotification(
          '<i class="fas fa-spinner fa-spin"></i> Buffering...',
          'general'
        );
      } else {
        console.warn(
          'Player waiting while network is reported as offline. Waiting for network recovery...'
        );
      }
    };

    /* --------------------------------------------------
       PLAY STATE HANDLERS
    -------------------------------------------------- */
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

    /* --------------------------------------------------
       METADATA / CONTROLS
    -------------------------------------------------- */
    const metadataHandler = () => {
      if (token.isCancelled()) return;

      try {
        this.updateQualityDisplay &&
          this.updateQualityDisplay();
      } catch (e) { }

      const channelLive =
        isLive === true || isLive === 'true';

      if (!channelLive && !isYouTube) {
        try {
          this.playerInstance.controls(true);
        } catch (e) { }
      } else {
        try {
          this.playerInstance.controls(false);
        } catch (e) { }
      }
    };

    /* --------------------------------------------------
       EVENT BINDINGS
    -------------------------------------------------- */
    this.playerInstance.on &&
      this.playerInstance.on('error', errorHandler);

    this.playerInstance.on &&
      this.playerInstance.on('waiting', waitingHandler);

    this.playerInstance.on &&
      this.playerInstance.on('playing', playingHandler);

    this.playerInstance.on &&
      this.playerInstance.on('pause', pauseHandler);

    this.playerInstance.on &&
      this.playerInstance.on('ended', endedHandler);

    this.playerInstance.on &&
      this.playerInstance.on(
        'loadedmetadata',
        metadataHandler
      );

    this.playerInstance.on &&
      this.playerInstance.on(
        'retryplaylist',
        () => console.log('🔄 Attempting HLS recovery...')
      );

    /* --------------------------------------------------
       CLEANUP
    -------------------------------------------------- */
    this.eventCleanupCallbacks.push(() => {
      try {
        if (!this.playerInstance) return;

        this.playerInstance.off &&
          this.playerInstance.off('error', errorHandler);

        this.playerInstance.off &&
          this.playerInstance.off('waiting', waitingHandler);

        this.playerInstance.off &&
          this.playerInstance.off('playing', playingHandler);

        this.playerInstance.off &&
          this.playerInstance.off('pause', pauseHandler);

        this.playerInstance.off &&
          this.playerInstance.off('ended', endedHandler);

        this.playerInstance.off &&
          this.playerInstance.off(
            'loadedmetadata',
            metadataHandler
          );
      } catch (e) {
        console.warn(e);
      }
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

function resolveYouTubePlayback(player) {
  try {
    const src = player?.currentSrc?.();
    if (!src) return null;

    const videoId = extractYouTubeID(src);
    if (!videoId) return null;

    const liveFeeds = safeJSONParse(
      localStorage.getItem(LS_KEYS.LIVE),
      []
    );

    const match = liveFeeds.find(feed =>
      feed?.name &&
      document.body.textContent.includes(feed.name)
    );

    return match ? extractChannelId(match.url) : null;
  } catch {
    return null;
  }
}


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

// ======================================================================
// createStreamConfig() — Final, complete version with Mixed Content Fix
// ======================================================================
function createStreamConfig(url, opts = {}) {
  if (!url || typeof url !== "string") {
    console.warn("createStreamConfig: invalid URL");
    return null;
  }

  // normalize
  url = url.trim();
  const isHTTPS = window.location.protocol === "https:";
  const isHTTP = url.startsWith("http://");
  const isM3U8 = url.includes(".m3u8") || url.includes("playlist");
  const isMPD = url.endsWith(".mpd");
  const isMP4 = url.endsWith(".mp4") || url.includes(".mp4?") || url.includes("imarkaz");
  const isTS = url.endsWith(".ts");
  const isYouTube = url.includes("youtube.com") || url.includes("youtu.be");


  // ------------------------------------------------------------------
  // 1. Mixed Content Protection (HTTPS site → HTTP stream = block)
  // ------------------------------------------------------------------
  if (isHTTPS && isHTTP) {
    console.error("❌ Mixed Content Blocked:", url);

    // Try fallback: direct HTTPS rewrite (rarely works, but try)
    let httpsRewrite = null;
    try {
      if (url.startsWith("http://")) {
        httpsRewrite = "https://" + url.substring(7);
      }
    } catch { }

    // Try user-defined proxy (best)
    const proxy = opts.proxyUrl || "https://cors-anywhere.herokuapp.com/";
    const proxiedUrl = proxy + url;

    showNotification(
      "⚠ HTTP stream blocked on HTTPS. Using secure proxy fallback...",
      "warning"
    );

    return {
      techOrder: ["html5"],
      type: isM3U8 ? "hls" : "auto",
      source: {
        src: proxiedUrl,
        type: isM3U8
          ? "application/x-mpegURL"
          : isMP4
            ? "video/mp4"
            : "video/mp2t",
      },
      _fallbackInfo: {
        original: url,
        throughProxy: proxiedUrl,
        httpsRewriteAttempt: httpsRewrite,
      },
    };
  }

  // ------------------------------------------------------------------
  // 2. YouTube video support
  // ------------------------------------------------------------------
  if (isYouTube) {
    return {
      type: "youtube",
      techOrder: ["youtube"],
      source: { src: url, type: "video/youtube" },
    };
  }

  // ------------------------------------------------------------------
  // 3. HLS (.m3u8)
  // ------------------------------------------------------------------
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

  // ------------------------------------------------------------------
  // 4. DASH (.mpd)
  // ------------------------------------------------------------------
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

  // ------------------------------------------------------------------
  // 5. MP4
  // ------------------------------------------------------------------
  if (isMP4) {
    return {
      type: "mp4",
      source: { src: url, type: "video/mp4" },
    };
  }

  // ------------------------------------------------------------------
  // 6. MPEG-TS / direct TS link
  // ------------------------------------------------------------------
  if (isTS) {
    return {
      type: "ts",
      techOrder: ["html5"],
      source: { src: url, type: "video/mp2t" },
    };
  }

  // ------------------------------------------------------------------
  // 7. Unknown → Auto-detect fallback
  // ------------------------------------------------------------------
  console.warn("createStreamConfig: unknown format, using auto-detect →", url);

  return {
    type: "auto",
    techOrder: ["html5"],
    source: { src: url, type: "video/mp4" }, // safe generic
  };
}


function buildPlayerOptions(streamConfig, metadata) {
  const baseOptions = {
    autoplay: true,
    controls: false,
    preload: 'auto',
    fluid: true,
    liveui: metadata && (metadata.isLive === true || metadata.isLive === 'true'),
    responsive: true,
    techOrder: streamConfig.techOrder,
    sources: Array.isArray(streamConfig.source)
      ? streamConfig.source
      : (streamConfig.source ? [streamConfig.source] : []),
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
        controls: 0,
        mute: 0,
        rel: 0,
        modestbranding: 1
        /*         iv_load_policy: 3,
                enablejsapi: 1,
                origin: (window && window.location && window.location.origin) ? window.location.origin : undefined */
      }
    };
  }

  if (streamConfig.type === 'hls') {
    /*     baseOptions.html5 = baseOptions.html5 || {};
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
        baseOptions.html5.nativeVideoTracks = false; */
  }

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



// ============================================
// Public selection wrapper
// ============================================

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

  // Ensure fullscreen prompt is removed immediately to avoid orphaned elements/timers
  try {
    // clear centralized auto-hide timer and force immediate removal
    appState.clearTimeoutRef('promptTimeout');
    // removeFullscreenPrompt(forceImmediate = true) - ensure your implementation accepts this flag
    if (typeof removeFullscreenPrompt === 'function') removeFullscreenPrompt(true);
  } catch (e) {
    console.warn('Error clearing fullscreen prompt during modal close', e);
  }

  if (window.player && typeof window.player.dispose === 'function') {
    window.player.dispose();
    window.player = null;
  }

  // Player cleanup
  try {
    channelLoader.cleanupPlayer().catch(e => console.warn('⚠️ Error during player cleanup:', e));
  } catch (e) {
    console.error("Error cleaning up player:", e);
  }

  // Refresh UI
  try {
    renderRecentlyWatched();
  } catch (e) {
    console.error("Error rendering recently watched:", e);
  }

  try {
    updateAllChannelItems();
  } catch (e) {
    console.error("Error updating channel items:", e);
  }

  // Restore focus
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

  // Update app state
  appState.set('ui.isModalOpen', false);
  appState.set('player.currentChannel', null);
}


/**
 * Show enhanced fullscreen prompt with controls for mobile users
 */
// single module-scoped state for prompt internals
let promptHandlers = null;

// show or reset prompt
function showFullscreenPrompt() {
  const modal = document.getElementById('videoModal');
  if (!modal || modal.style.display !== 'flex') return;

  // If prompt already exists, just reset auto-hide timer and return
  if (window.fullscreenPrompt) {
    appState.clearTimeoutRef('promptTimeout');
    const tid = setTimeout(() => removeFullscreenPrompt(), 8000);
    appState.setTimeoutRef('promptTimeout', tid);
    return;
  }

  // Ensure any leftover prompt is removed immediately (avoid fade race)
  removeFullscreenPrompt(true);

  // Create prompt element
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

  // attach handlers and keep references for removal
  const prevBtn = el.querySelector('#promptPrevBtn');
  const nextBtn = el.querySelector('#promptNextBtn');
  const fsBtn = el.querySelector('#promptFullscreenBtn');
  const closeBtn = el.querySelector('.prompt-close');

  promptHandlers = {
    prev: (e) => { e.stopPropagation(); navigateToPreviousChannel(); removeFullscreenPrompt(); },
    next: (e) => { e.stopPropagation(); navigateToNextChannel(); removeFullscreenPrompt(); },
    fs: (e) => { e.stopPropagation(); toggleFullscreen(); removeFullscreenPrompt(); },
    close: (e) => { e.stopPropagation(); removeFullscreenPrompt(); }
  };

  prevBtn && prevBtn.addEventListener('click', promptHandlers.prev);
  nextBtn && nextBtn.addEventListener('click', promptHandlers.next);
  fsBtn && fsBtn.addEventListener('click', promptHandlers.fs);
  closeBtn && closeBtn.addEventListener('click', promptHandlers.close);

  // centralized auto-hide timer
  appState.clearTimeoutRef('promptTimeout');
  const tid = setTimeout(() => removeFullscreenPrompt(), 8000);
  appState.setTimeoutRef('promptTimeout', tid);

  // ensure cleanup on app teardown (only add once ideally)
  appState.addCleanup(() => removeFullscreenPrompt(true));
}

function removeFullscreenPrompt(forceImmediate = false) {
  appState.clearTimeoutRef('promptTimeout');
  const el = window.fullscreenPrompt;
  if (!el) return;

  // 1. Synchronously remove listeners
  try {
    if (promptHandlers) {
      const btns = el.querySelectorAll('button');
      btns.forEach(btn => {
        // Generic listener removal if specific ones are lost
        btn.replaceWith(btn.cloneNode(true));
      });
    }
  } catch (e) { console.warn(e); }

  promptHandlers = null;

  // 2. Determine if we can wait for animation
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
    const data = localStorage.getItem(LS_KEYS.WATCH_TIME);
    if (!data) return {};

    return JSON.parse(data);
  } catch (e) {
    console.error("Error loading watch time:", e);
    logErrorToService({ type: 'storage_parse_error', key: LS_KEYS.WATCH_TIME, error: e });

    // Try to recover
    try {
      localStorage.removeItem(LS_KEYS.WATCH_TIME);
    } catch { }

    showNotification('Watch history data corrupted - resetting', 'warning');
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

/**
 * Enhanced createChannelItem with lazy loading
 */
function createChannelItem(channel) {
  const item = document.createElement('div');
  const numberText = channel.number || '';

  item.className = 'content-card channel-item';


  // Better ARIA attributes
  item.setAttribute('role', 'button');
  item.setAttribute('aria-label',
    `${channel.name}, Channel ${channel.number}${channel.isLive ? ', Live' : ''}`
  );
  item.setAttribute('aria-pressed', 'false');
  item.setAttribute('tabindex', '-1');

  // Add live region for updates
  if (channel.isLive) {
    item.setAttribute('aria-live', 'polite');
    item.setAttribute('aria-atomic', 'true');
  }

  // Keyboard support
  item.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      item.click();
    }
  });

  // Store data attributes
  item.dataset.url = channel.url || '';
  item.dataset.name = channel.name || '';
  item.dataset.image = channel.image || '';
  item.dataset.description = channel.description || '';
  item.dataset.number = numberText;
  item.dataset.isLive = channel.isLive;
  item.dataset.category = channel.category || 'Unknown';

  // Click handler
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

  // ✅ Store for cleanup
  item._cleanupHandlers = [
    () => item.removeEventListener('click', clickHandler)
  ];

  // Thumbnail wrapper
  const thumb = document.createElement('div');
  thumb.className = 'thumb-wrapper';

  // Lazy loaded image
  const img = document.createElement('img');
  const imageUrl = fixImageUrl(channel.image);

  // Set data-src for lazy loading
  img.dataset.src = imageUrl;

  // Use inline SVG placeholder (tiny, no network request)
  img.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"%3E%3Crect fill="%23333" width="200" height="200"/%3E%3Ctext x="50%25" y="50%25" fill="%23666" font-size="20" text-anchor="middle" dominant-baseline="middle"%3ELoading...%3C/text%3E%3C/svg%3E';

  img.alt = `${channel.name || 'Channel'} Logo`;
  img.loading = 'lazy'; // Native lazy loading as fallback
  img.decoding = 'async';

  // Error handler
  img.onerror = function () {
    this.src = 'placeholder.png';
    this.alt = 'Image not available';
  };

  // Observe for lazy loading
  if (!window.lazyLoadObserver) {
    initializeLazyLoading();
  } else {
    window.lazyLoadObserver.observe(img);
  }


  // Channel number badge
  const numBadge = document.createElement('span');
  numBadge.className = 'channel-number';
  numBadge.textContent = channel.number || '';

  // Live indicator
  if (channel.isLive === true || channel.isLive === 'true') {
    const liveIndicator = document.createElement('img');
    liveIndicator.src = 'live.webp';
    liveIndicator.alt = 'Live';
    liveIndicator.className = 'live-indicator';
    thumb.appendChild(liveIndicator);
  }

  thumb.appendChild(img);
  thumb.appendChild(numBadge);

  // Favorite icon
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

  // Update favorite state
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


// ✅ Enhanced cleanup
function cleanupChannelItems() {
  const arr = appState.get('uiCollections.allChannelItems') || [];
  arr.forEach(item => {
    // Run all cleanup handlers
    if (item._cleanupHandlers) {
      item._cleanupHandlers.forEach(cleanup => {
        try { cleanup(); } catch (e) { }
      });
      delete item._cleanupHandlers;
    }

    if (!item.isConnected) {
      try { item.remove(); } catch (e) { }
    }
  });
  appState.set('uiCollections.allChannelItems', []);
}

function cleanupChannelItem(item) {
  if (item._cleanupHandlers) {
    item._cleanupHandlers.forEach(fn => {
      try { fn(); } catch (e) { }
    });
    delete item._cleanupHandlers;
  }
  // Remove safely
  try { item.remove(); } catch (e) { }
}

function createOrUpdateHeading(category, count) {
  let heading = document.querySelector(`h2[data-category="${category}"]`);
  if (!heading) {
    heading = document.createElement("h2");
    heading.dataset.category = category;
    heading.className = "text-xl font-bold mt-6 mb-4 col-span-full dynamic-heading";
    heading.textContent = `${category} (${count})`;
  } else {
    // Update count if heading already exists
    heading.textContent = `${category} (${count})`;
  }
  return heading;
}

function createOrUpdateGrid(category) {
  let grid = document.querySelector(`.content-grid[data-category="${category}"]`);
  if (!grid) {
    grid = document.createElement("div");
    grid.className = "content-grid";
    grid.dataset.category = category;
  } else {
    // Clear only dynamic children, keep reused items
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

  // ✅ FIX: Only reuse DOM elements when NOT searching.
  // Recreating a small list of search results is fast and guarantees listeners work.
  const shouldReuseDOM = !isSearching && channels.length > 50;

  // Map of existing items for reuse (only populated if we are reusing)
  const existingItems = new Map();
  if (shouldReuseDOM) {
    main.querySelectorAll('.channel-item').forEach(item => {
      // Only store if it has a valid URL key
      if (item.dataset.url) {
        existingItems.set(item.dataset.url, item);
      }
    });
  }

  const fragment = document.createDocumentFragment();

  // Categorize channels (Search results usually go into one category)
  const categorized = (sortMethod === 'none' && !isSearching)
    ? channels.reduce((acc, ch) => {
      const c = ch.category || 'Unknown';
      (acc[c] || (acc[c] = [])).push(ch);
      return acc;
    }, {})
    : { [isSearching ? 'Search Results' : 'All Channels']: channels };

  // If we are forcing a rebuild (Search), clear the container immediately
  if (!shouldReuseDOM) {
    main.innerHTML = '';
  }



  // Build the new Grid
  for (const [category, categoryChannels] of Object.entries(categorized)) {
    if (categoryChannels.length === 0) continue;

    // Use helper functions to create structure
    const heading = createOrUpdateHeading(category, categoryChannels.length);
    const grid = createOrUpdateGrid(category);

    categoryChannels.forEach(channel => {
      let itemNode = null;

      // 1. Try to reuse existing DOM node
      if (shouldReuseDOM && channel.url) {
        itemNode = existingItems.get(channel.url);
        if (itemNode) {
          existingItems.delete(channel.url); // Mark as used so we don't delete it later
        }
      }

      // 2. If no reusable node found (or searching), create NEW one
      if (!itemNode) {
        itemNode = createChannelItem(channel);
      }

      grid.appendChild(itemNode);
    });

    fragment.appendChild(heading);
    fragment.appendChild(grid);
  }

  // Final DOM Updates
  if (shouldReuseDOM) {
    // If reusing, we need to explicitly remove items that weren't in the new list
    existingItems.forEach(item => cleanupChannelItem(item));

    // Remove old structural elements (grids/headings)
    main.querySelectorAll('.content-grid, .dynamic-heading').forEach(el => el.remove());

    // Append the new structure
    main.appendChild(fragment);
  } else {
    // If not reusing (Search mode), we already cleared innerHTML, so just append
    main.appendChild(fragment);
  }

  // Post-render updates
  updateAllChannelItems();

  if (window.lazyLoadObserver) {
    observeNewImages();
  }

  // Toggle visibility of other sections
  if (isSearching) {
    hideFavoritesAndRecent();
  } else {
    showFavoritesAndRecent();
  }

  // console.log(`✅ Rendered ${channels.length} channels in ${sortMethod} view`);
}



// ✅ ENHANCED: Render favorites with new API
// ✅ Use DocumentFragment consistently
function renderFavorites() {
  const container = document.getElementById('favoritesGrid');
  if (!container) return;

  const favorites = getFavorites();
  const favSection = document.getElementById('favorites');

  // ✅ Single DOM manipulation
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


// ============================================
// Sorting & keyboard navigation
// ============================================

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
      // Handle none case
      break;
  }

  appState.set('ui.sortMethod', sortMethod);
  renderChannels(sorted);
  renderFavorites();
  updateFavoriteIcons();
  renderRecentlyWatched();
  updateAllChannelItems();

  // ✅ CRITICAL FIX: Always manage visibility after rendering
  if (isSearching) {
    hideFavoritesAndRecent();
  } else {
    showFavoritesAndRecent();
  }
}

function handleSortChange(sortMethod) {
  localStorage.setItem("defaultSortMethod", sortMethod);
  sortChannelsAndRender(sortMethod);
  updateSortButtons(sortMethod);

  // ✅ Ensure favorites and recent are visible if not searching
  if (!appState.get('channels.searchQuery')) {
    showFavoritesAndRecent();
  }
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
  // ✅ Clear previous timeout first
  const prevTimeout = appState.get('intervals.navigationDebounce');
  if (prevTimeout) clearTimeout(prevTimeout);

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
        event.stopPropagation();
        toggleFullscreen();
        return;
      }


      if (
        event.key === "Escape" ||
        event.key === "ArrowLeft" ||
        event.key === "Backspace" || // sometimes used as back
        event.key === "BrowserBack" || // some remotes or browsers
        event.key === "GoBack" // Android TV or custom remotes
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

    // ✅ Clear the timeout reference after execution
    appState.setTimeoutRef('navigationDebounce', null);
  }, 50);


  appState.setTimeoutRef('navigationDebounce', timeoutId);
}

// ============================================
// YOUTUBE API & RSS FEEDS
// ============================================

// Constants for better maintainability
const RETRY_CONFIG = {
  RSS: {
    maxRetries: 3,
    baseDelay: 2 * 60 * 1000 // 2 minutes
  },
  LIVE: {
    maxRetries: 3,
    baseDelay: 90_000 // 1.5 minutes
  }
};

// ============================================
// RETRY MANAGER
// ============================================

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

  _createRetryEntry(currentEntry = { retries: 0 }) {
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

// ============================================
// HELPER FUNCTIONS
// ============================================

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
    channels[existingIndex] = { ...existing, ...channelObj };
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

// ============================================
// FEED LOADERS
// ============================================

const rssRetryManager = new RetryManager("rss_retry_queue", RETRY_CONFIG.RSS);
const liveRetryManager = new RetryManager("live_retry_queue", RETRY_CONFIG.LIVE);

class FeedProcessor {
  constructor(type, cache, retryManager) {
    this.type = type;
    this.cache = cache;
    this.retryManager = retryManager;
    this.storageKey = type === 'rss' ? LS_KEYS.FEEDS : LS_KEYS.LIVE;
  }

  async loadFeeds(options = {}) {
    const { force = false, signal } = options;

    const feeds = this._loadFeedsFromStorage();
    if (!feeds.length) return null;

    const feedsToProcess = this._getFeedsToProcess(feeds, force);
    const results = { successful: 0, failed: 0, cacheHits: 0 };

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
    } catch (e) { /* ignore */ }

    console.log(
      `${this.type.toUpperCase()} update summary → ` +
      `success: ${results.successful}, failed: ${results.failed}, cache hits: ${results.cacheHits}`
    );
    console.log(`📊 ${this.type.toUpperCase()} Cache Stats:`, this.cache.getStats?.());
    console.log(`🔄 ${this.type.toUpperCase()} Retry Manager Stats:`, this.retryManager.getStats());
  }
}

// ============================================
// RSS FEED LOADER
// ============================================

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
    const res = await fetchWithTimeout(feedUrl, { timeout: 15000, signal });

    if (!res?.ok) {
      throw new Error(`HTTP ${res?.status || "fetch failed"}`);
    }

    const data = await res.json?.() ?? res;
    this.cache.set(cacheKey, data);
    processRSSData(data, feed);
  }

  _handleError(feed, error, results) {
    results.failed++;
    this.retryManager.recordFailure(feed.url, error?.message || "RSS fetch error");
    console.log(`❌ Error loading RSS feed for ${feed.name}:`, error?.message || error);
  }
}

// ============================================
// LIVE FEED LOADER
// ============================================

class LiveProcessor extends FeedProcessor {
  constructor() {
    super('live', liveCache, liveRetryManager);
  }

  async _processFeed(feed, signal, results, context = { apiQuotaExceeded: false }) {
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

    const res = await fetchWithTimeout(apiUrl, { timeout: 15000, signal });

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
        cacheData = { videoId, title };
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
      this.retryManager.recordFailure(channelId, error?.message || "Live fetch error");
    }

    console.log(`❌ Error loading live feed for ${feed.name}:`, error?.message || error);
  }
}

// ============================================
// PUBLIC API FUNCTIONS
// ============================================

async function loadYouTubeLatestFeeds({ force = false } = {}) {
  const processor = new RSSProcessor();
  return deduplicateRequest(
    'loadYouTubeLatestFeeds',
    async ({ signal } = {}) => {
      const result = await processor.loadFeeds({ force, signal });

      if (result && !rssRetryManager.hasPending()) {
        localStorage.setItem(CACHE_KEY, Date.now().toString());
      } else if (result) {
        console.log("⚠️ RSS retries pending — global cache timestamp unchanged");
      }

      return result;
    },
    { timeout: 20_000, ttl: 2 * 60 * 1000, force }
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
async function loadYouTubeLiveFeeds({ force = false } = {}) {
  const processor = new LiveProcessor();
  return deduplicateRequest(
    'loadYouTubeLiveFeeds',
    async ({ signal } = {}) => {
      return processor.loadFeeds({ force, signal });
    },
    { ttl: 30_000, timeout: 15_000, force }
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
      showNotification("⚠️ Channels loaded (not saved due to storage limits)", "warning");
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

// ============================================
// PRIVATE HELPER
// ============================================

function _updateUI(channels) {
  console.log("🔄 Refreshing UI...");
  renderChannels(channels);
  renderFavorites();
  updateFavoriteIcons();
  renderRecentlyWatched();
  updateAllChannelItems();
}

// ============================================
// RETRY CHECKER SERVICE
// ============================================
/**
 * Checks for pending retries and processes them when ready
 * Runs more frequently than the main update cycle
 */
async function checkAndProcessRetries() {
  try {
    let hadRetries = false;
    
    // Check RSS retries
    if (rssRetryManager.hasReadyRetries()) {
      console.log('🔁 RSS retry check: Processing ready retries...');
      const processor = new RSSProcessor();
      const result = await processor.loadFeeds({ force: false });
      if (result && result.successful > 0) {
        hadRetries = true;
        console.log(`✅ RSS retry successful: ${result.successful} feeds recovered`);
      }
    }

    // Check LIVE retries
    if (liveRetryManager.hasReadyRetries()) {
      console.log('🔁 LIVE retry check: Processing ready retries...');
      const processor = new LiveProcessor();
      const result = await processor.loadFeeds({ force: false });
      if (result && result.successful > 0) {
        hadRetries = true;
        console.log(`✅ LIVE retry successful: ${result.successful} feeds recovered`);
      }
    }

    // If we had successful retries, save channels and update UI
    if (hadRetries) {
      const channels = appState.get('channels.all') || [];
      const success = safeLocalStorageSet(LS_KEYS.CHANNELS, JSON.stringify(channels));
      
      if (success) {
        console.log('✅ Updated channels saved after retry');
        // Update UI
        _updateUI(channels);
        showNotification('🔁 Retried feeds updated successfully', 'success');
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
  // Clear any existing retry checker
  const existing = appState.get('intervals.retryChecker');
  if (existing) clearInterval(existing);

  // Check every 1 minute (60000ms) for pending retries
  const RETRY_CHECK_INTERVAL = 60_000;
  
  const id = setInterval(checkAndProcessRetries, RETRY_CHECK_INTERVAL);
  appState.set('intervals.retryChecker', id);

  console.log('🔁 Retry checker service started. Checking every 1 minute.');
  
  // Run initial check after a short delay
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
// AUTO-UPDATE SERVICE
// ============================================
function startChannelAutoUpdate() {
  const savedAutoUpdate = localStorage.getItem(AUTO_UPDATE_KEY);
  const savedInterval = localStorage.getItem(UPDATE_INTERVAL_KEY);

  // Save settings into appState
  appState.set(
    'settings.isAutoUpdateEnabled',
    savedAutoUpdate === null ? true : savedAutoUpdate === "true"
  );

  appState.set(
    'settings.updateIntervalHours',
    savedInterval ? parseInt(savedInterval) : 8
  );

  // ✅ Read values back from appState instead of using undeclared variables
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

  // Clear any existing interval before starting a new one
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
  
  // ✅ Start the retry checker service (handles LIVE feed retries for error 1150 etc.)
  startRetryChecker();
}


function stopAutoUpdateService() {
  // ✅ Clear interval using appState instead of global variable
  appState.clearIntervalRef('autoUpdate');
  stopRetryChecker();
  console.log("Auto-update service stopped");
}
// ============================================
// SETTINGS MODAL
// ============================================
function showSettingsModal() {
  const settingsModal = document.getElementById("settingsModal");
  if (!settingsModal) return;

  settingsModal.style.display = "flex";

  const autoUpdateToggle = document.getElementById("autoUpdateToggle");
  const updateIntervalSelect = document.getElementById("updateInterval");

  // ✅ NEW: Sync Sort Dropdown state
  const sortSelect = document.getElementById("sortSelect");
  if (sortSelect) {
    const currentSort = appState.get('ui.sortMethod') || localStorage.getItem("defaultSortMethod") || 'none';
    sortSelect.value = currentSort;
  }

  // 🔄 Restore values from localStorage
  const savedAutoUpdate = localStorage.getItem(AUTO_UPDATE_KEY);
  const savedInterval = localStorage.getItem(UPDATE_INTERVAL_KEY);

  const isAutoUpdateEnabled =
    savedAutoUpdate === null ? true : savedAutoUpdate === "true";
  const updateIntervalHours =
    savedInterval !== null && !isNaN(parseInt(savedInterval))
      ? parseInt(savedInterval)
      : 8;

  // 🔄 Sync into appState
  appState.set("settings.isAutoUpdateEnabled", isAutoUpdateEnabled);
  appState.set("settings.updateIntervalHours", updateIntervalHours);

  // 🔄 Update UI
  if (autoUpdateToggle) autoUpdateToggle.checked = isAutoUpdateEnabled;
  if (updateIntervalSelect) updateIntervalSelect.value = updateIntervalHours.toString();

  updateIntervalDescriptionText(updateIntervalHours);

  // Update all dynamic displays
  updateUserAgentDisplay();
  updateStorageDisplay();
  updateTotalChannelsDisplay();
  updateLastUpdateDisplay();
  updateNetworkInfoDisplay();

}

function updateNetworkInfoDisplay() {
  const networkInfoEl = document.getElementById('networkInfoDisplay');
  if (!networkInfoEl) return;

  const isOnline = appState.get('settings.isOnline');
  const quality = appState.get('settings.networkQuality') || 'unknown';
  const latency = appState.get('settings.networkLatency') || 0;
  const connectionType = appState.get('settings.connectionType') || 'unknown';

  let statusColor = '#4CAF50'; // Green
  let statusText = 'Online';

  if (!isOnline) {
    statusColor = '#f44336';
    statusText = 'Offline';
  } else if (quality === 'poor') {
    statusColor = '#ff9800';
    statusText = 'Poor';
  }

  // prepare CSS classes based on runtime values
  const statusClass = !networkMonitor?.isOnline ? 'network-offline' : `network-quality-${quality}`;
  const connBadgeClass = `connection-badge connection-${(connectionType || 'unknown').toString().replace(/\s+/g, '-').toLowerCase()}`;

  networkInfoEl.innerHTML = `
  <div class="network-info" role="status" aria-live="polite">
    <div class="info-row" style="display:flex;justify-content:space-between;align-items:center;">
      <div class="info-label">Status</div>
      <div class="info-value ${statusClass}" style="font-weight:700;">${statusText}</div>
    </div>

    <div class="info-row" style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
      <div class="info-label">Quality</div>
      <div class="info-value ${statusClass}">
        ${quality.charAt(0).toUpperCase() + quality.slice(1)}
      </div>
    </div>

    ${latency > 0 ? `
      <div class="info-row" style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
        <div class="info-label">Latency</div>
        <div class="info-value">${latency}ms</div>
      </div>
    ` : ''}

    <div class="info-row" style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
      <div class="info-label">Connection</div>
      <div style="display:flex;gap:8px;align-items:center;">
        <span class="${connBadgeClass}">${connectionType}</span>
      </div>
    </div>

    <div class="modal-actions" style="margin-top:14px;">
      <button class="btn-secondary" type="button" onclick="networkMonitor.forceCheck()" aria-label="Test connection">
        🔄 Test Connection
      </button>
    </div>
  </div>
`;
}

/**
 * Create network status indicator in UI
 */
function setupNetworkStatusIndicator() {
  // Remove existing indicator if any
  const existing = document.getElementById('network-status-indicator');
  if (existing) existing.remove();

  // 1. Create the main container
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
    background: transparent;
    font-size: 18px;
  `;

  // 2. Create Emoji Marker (default neutral)
  const emojiMarker = document.createElement('span');
  emojiMarker.textContent = '⚪'; // neutral default
  indicator.appendChild(emojiMarker);

  // 3. Click handler for details
  indicator.addEventListener('click', () => {
    const isOnline = appState.get('settings.isOnline');
    const quality = appState.get('settings.networkQuality') || 'unknown';
    const connectionType = appState.get('settings.connectionType') || 'unknown';
    const latency = appState.get('settings.networkLatency') || 0;

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

  // 4. Update logic: Change emoji only
  const updateIndicator = (isOnline, quality) => {
    if (!indicator.isConnected) return;

    indicator.setAttribute('data-status', isOnline ? 'online' : 'offline');
    indicator.setAttribute('data-quality', quality);

    if (!isOnline) {
      emojiMarker.textContent = '🔴'; // Red for offline
      indicator.title = 'Offline';
      return;
    }

    switch (quality) {
      case 'excellent':
        emojiMarker.textContent = '🟢'; // Green
        break;
      case 'good':
        emojiMarker.textContent = '🔵'; // Blue
        break;
      case 'fair':
        emojiMarker.textContent = '🟡'; // Yellow
        break;
      case 'poor':
        emojiMarker.textContent = '🟠'; // Orange
        break;
      default:
        emojiMarker.textContent = '⚪'; // Neutral
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

  // 6. Modal hide logic
  const syncVisibility = (isOpen) => {
    if (!isOpen) {
      indicator.style.opacity = '0';
      indicator.style.pointerEvents = 'none';
      indicator.style.visibility = 'hidden';
    } else {
      indicator.style.opacity = '1';
      indicator.style.pointerEvents = 'auto';
      indicator.style.visibility = 'visible';
    }
  };

  appState.subscribe('ui.isModalOpen', syncVisibility);
  syncVisibility(appState.get('ui.isModalOpen'));

  return indicator;
}



function hideSettingsModal() {
  const settingsModal = document.getElementById("settingsModal");
  if (settingsModal) {
    settingsModal.style.display = "none";
  }
}

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
    lastUpdateEl.textContent = `${timeAgo} (${formattedDate})`;
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

  const settingsBtn = document.getElementById("settingsBtn");
  const closeSettings = document.getElementById("closeSettings");
  const autoUpdateToggle = document.getElementById("autoUpdateToggle");
  const updateIntervalSelect = document.getElementById("updateInterval");
  const manualUpdateBtn = document.getElementById("manualUpdateBtn");
  const manageApiKeyBtn = document.getElementById("manageApiKeyBtn");
  const sortSelect = document.getElementById("sortSelect");

  // --- SHOW/HIDE MODAL ---
  if (settingsBtn) {
    settingsBtn.addEventListener("click", () => {
      showSettingsModal();
      // Update dynamic displays when modal opens
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

  // --- SORT ---
  if (sortSelect) {
    sortSelect.addEventListener("change", (e) => {
      handleSortChange(e.target.value);
    });
  }

  // --- AUTO UPDATE ---
  if (autoUpdateToggle) {
    autoUpdateToggle.addEventListener("change", (e) => {
      toggleAutoUpdate(e.target.checked);
    });
  }

  // --- UPDATE INTERVAL ---
  if (updateIntervalSelect) {
    updateIntervalSelect.addEventListener("change", (e) => {
      changeUpdateInterval(e.target.value);
    });
  }

  // --- MANUAL UPDATE ---
  if (manualUpdateBtn) {
    manualUpdateBtn.addEventListener("click", manualUpdate);
  }

  // --- API KEY ---
  if (manageApiKeyBtn) {
    manageApiKeyBtn.addEventListener("click", () => {
      hideSettingsModal();
      setTimeout(showAPIKeyModal, 300);
    });
  }

  // --- USER AGENT CONTROLS ---
  setupUserAgentControls();

  // --- STORAGE MANAGEMENT BUTTONS ---
  setupStorageControls();


  // --- ESC KEY CLOSES MODAL ---
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && settingsModal.style.display === "flex") {
      hideSettingsModal();
    }
  });

  // Initial updates
  updateUserAgentDisplay();
  updateStorageDisplay();
}

function updateUserAgentDisplay() {
  const display = document.getElementById('currentUserAgent');
  if (!display) return;

  try {
    const currentUA = navigator.userAgent;
    const isCustom = window.UserAgentManager?.isCustom || false;

    display.textContent = currentUA;
    display.style.color = isCustom ? '#4caf50' : '#888';
    display.title = `User Agent (${isCustom ? 'Custom' : 'Original'})`;

    // Add a subtle indicator for custom UAs
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

function setupUserAgentControls() {
  const presetSelect = document.getElementById('userAgentPreset');
  const customInput = document.getElementById('customUserAgent');
  const applyBtn = document.getElementById('applyUserAgent');
  const resetBtn = document.getElementById('resetUserAgent');
  const applyPresetBtn = document.getElementById('applyPresetUserAgent');

  // Ensure UserAgentManager is available
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


function setupAPIKeyModalEvents() {
  const submitBtn = document.getElementById("submitApiKey");
  const skipBtn = document.getElementById("skipApiKey");
  const closeBtn = document.getElementById("closeApiKeyModal");
  const apiKeyInput = document.getElementById("apiKeyInput");
  const toggleVisibilityBtn = document.getElementById("toggleApiKeyVisibility");
  const apiModal = document.getElementById("apiKeyModal");

  // Handler functions defined to allow clean removal
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
    showNotification("✅ API Key saved successfully!", "success");
    console.log("🔄 Starting live feeds update with new API key...");
    loadYouTubeLiveFeeds().catch(console.error);
  };

  const handleSkip = () => {
    hideAPIKeyModal();
    showNotification("⭕️ Live channels update skipped", "info");
    console.log("ℹ️ User skipped API key configuration");
  };

  // 1. Remove old listeners (if any exist from previous opens)
  // Note: This requires storing these functions externally or simply assuming
  // the modal DOM isn't destroyed/recreated constantly. 
  // A better way for simple apps: use on-click attributes OR ensure this setup runs ONLY ONCE.

  // SIMPLEST FIX: Ensure setupAPIKeyModalEvents is called only ONCE in initialize(), 
  // not every time the modal opens.
  if (submitBtn.dataset.bound) return; // Prevent double binding

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

  // Input Enter key
  if (apiKeyInput) {
    apiKeyInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") handleSubmit();
    });
  }
}

// ============================================
// CLEANUP & INITIALIZATION
// ============================================
function cleanup() {
  console.log("🧹 Performing cleanup...");

  // Stop network monitoring
  try {
    networkMonitor.cleanup();
  } catch (error) {
    console.warn('Error during network monitor cleanup:', error);
  }

  // Stop watchers and auto-update
  stopWatching();
  stopAutoUpdateService();

  // ✅ Clear timeouts/intervals via appState helpers
  appState.clearTimeoutRef("overlayShow");
  appState.clearTimeoutRef("overlayHide");
  appState.clearTimeoutRef("numberTimeout");
  appState.clearTimeoutRef("promptTimeout"); // if you use navigationDebounce, store it here

  // ✅ Player cleanup
  channelLoader.cleanupPlayer()
    .then(() => {
      console.log("✅ Player cleanup complete");
    })
    .catch(error => {
      console.warn("Error during player cleanup:", error);
    });

  // ✅ Remove transient UI elements
  document.querySelectorAll(
    ".network-status, .error-notification, .play-fallback-overlay, .notification"
  ).forEach(el => {
    if (el.parentNode) {
      el.parentNode.removeChild(el);
    }
  });

  // ✅ Restore focus
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
  try {
    PerformanceMonitor.measureChannelLoad();

    // UI setup
    const contentGrid = document.querySelector(".content-grid");
    const loadingElement = document.getElementById("loading-spinner");
    if (contentGrid) contentGrid.style.display = "none";
    if (loadingElement) loadingElement.style.display = "block";

    // ✅ NEW: Initialize Network Monitor
    try {
      networkMonitor.initialize();
    } catch (error) {
      console.error('Failed to initialize network monitor:', error);
    }


    // Modal setup
    const closeBtn = document.querySelector(".closeModal");
    if (closeBtn) closeBtn.addEventListener("click", closeModal);

    const modal = document.getElementById("videoModal");
    if (modal) {
      modal.addEventListener("click", (event) => {
        if (event.target === modal) closeModal();
      });
    }

    // ✅ Feature setup with error boundaries
    const features = [
      { name: 'Lazy Loading', fn: initializeLazyLoading },
      { name: 'Cache Maintenance', fn: startCacheMaintenance },
      { name: 'Network Status', fn: setupNetworkStatusIndicator },
      { name: 'Settings Modal', fn: setupSettingsModal },
      { name: 'Search Bar', fn: setupSearchBar },
      { name: 'Touch Gestures', fn: setupTouchGestures },
/*       { name: 'PWA', fn: setupPWA }, */
      { name: 'Keyboard Navigation', fn: setupKeyboardNavigation }
    ];

    for (const { name, fn } of features) {
      try {
        fn();
      } catch (e) {
        console.error(`❌ ${name} setup failed:`, e);
      }
    }

    // Storage health checks
    setInterval(checkStorageHealth, 60_000);

    // Load channels
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

    // API key
    const storedKey = getStoredAPIKey() || "";
    appState.set('settings.apiKey', storedKey);

    if (hasValidAPIKey()) {
      console.log("✅ Using stored API key");
    } else {
      console.log("ℹ️ No valid API key stored");
    }

    // Auto update
    startChannelAutoUpdate();

    // Ensure numbering
    const channels = appState.get("channels.all") || [];
    const numbered = channels.map((ch, i) => ({
      ...ch,
      number: ch.number || i + 1,
    }));
    appState.set("channels.all", numbered);

    // UI restoration
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

    // Graceful degradation
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
        // toggle prompt: remove if visible, otherwise show
        if (window.fullscreenPrompt) removeFullscreenPrompt();
        else showFullscreenPrompt();
      } else {
        window.toggleFullscreen();
        showNotification("Exit fullscreen. Double‑tap again!", "success");
      }
      appState.set('ui.lastTapTime', 0);
      return;
    }
    appState.set('ui.lastTapTime', currentTime);
    return;
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
function setupStorageControls() {
  // View Storage Details
  const viewStorageDetailsBtn = document.getElementById('viewStorageDetails');
  if (viewStorageDetailsBtn) {
    viewStorageDetailsBtn.addEventListener('click', () => {
      logStorageUsage();
      showNotification('Check console for storage details', 'info');
    });
  }

  // Export Data
  const exportDataBtn = document.getElementById('exportDataBtn');
  if (exportDataBtn) {
    exportDataBtn.addEventListener('click', exportAllData);
  }

  // Import Data
  const importDataBtn = document.getElementById('importDataBtn');
  if (importDataBtn) {
    importDataBtn.addEventListener('click', triggerImportDialog);
  }

  // Clear Recently Watched
  const clearRecentBtn = document.getElementById('clearRecentBtn');
  if (clearRecentBtn) {
    clearRecentBtn.addEventListener('click', clearRecentlyWatched);
  }

  // Clear All Favorites
  const clearFavoritesBtn = document.getElementById('clearFavoritesBtn');
  if (clearFavoritesBtn) {
    clearFavoritesBtn.addEventListener('click', clearAllFavorites);
  }

  // File Input for Import
  const fileInput = document.getElementById('importFileInput');
  if (fileInput) {
    fileInput.addEventListener('change', handleImportFile);
  }
}


// ============================================
// UPDATE TOTAL CHANNELS DISPLAY
// Add this new function
// ============================================

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

function updateStorageStatsDisplay() {
  const statsEl = document.getElementById("storageUsageDisplay");
  if (!statsEl) return;

  const usage = getStorageUsage();
  if (!usage) {
    statsEl.innerHTML = "<em>⚠️ No storage usage data available.</em>";
    return;
  }

  const availableBytes = getAvailableSpace();
  const availableMB = (availableBytes / (1024 * 1024)).toFixed(2);
  const availableKB = (availableBytes / 1024).toFixed(2);

  statsEl.innerHTML = `
    <div style="display: grid; gap: 10px; margin-top: 10px;">
      <div style="background: rgba(76, 175, 80, 0.1); padding: 10px; border-radius: 8px;">
        <strong>Total Space:</strong><br>
        ${MAX_MB} MB
      </div>
      <div style="background: rgba(33, 150, 243, 0.1); padding: 10px; border-radius: 8px;">
        <strong>Used:</strong><br>
        ${usage.totalMB} MB (${usage.totalKB} KB) | ${usage.itemCount} items
      </div>
      <div style="background: rgba(255, 152, 0, 0.1); padding: 10px; border-radius: 8px;">
        <strong>Remaining:</strong><br>
        ${availableMB} MB (${availableKB} KB)
      </div>
    </div>
  `;
}


async function updateStorageDisplay() {
  const display = document.getElementById('storageUsageDisplay');
  if (!display) return;

  // Clear previous content and set an accessible live region
  display.textContent = '';
  display.setAttribute('aria-live', 'polite');

  try {
    // Support both sync and async getStorageUsage implementations
    const maybePromise = getStorageUsage();
    const usage = (maybePromise && typeof maybePromise.then === 'function')
      ? await maybePromise
      : maybePromise;

    if (!usage || typeof usage.totalBytes !== 'number') {
      display.innerHTML = '<div class="storage-loading">⚠️ Unable to calculate storage usage</div>';
      return;
    }

    // Defensive defaults
    const MAX_MB_VALUE = (typeof MAX_MB === 'number' && MAX_MB > 0) ? MAX_MB : 6;
    const totalBytes = Number(usage.totalBytes) || 0;
    const totalMB = (typeof usage.totalMB === 'number') ? usage.totalMB : (totalBytes / (1024 * 1024));

    // Percent used (clamped 0..100)
    const usedPercentRaw = (totalBytes / (MAX_MB_VALUE * 1024 * 1024)) * 100;
    const usedPercent = Math.max(0, Math.min(100, Number(usedPercentRaw.toFixed(1))));

    // Determine status
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

    // Build DOM structure (safer than large innerHTML)
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
    statusSpan.style.color = ''; // color handled by CSS class
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

    // Progress bar
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

    // Replace display content
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


// ADD SANITIZATION:
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Add proactive monitoring
function checkStorageHealth() {
  const usage = getStorageUsage();
  const percentUsed = (usage.totalBytes / (MAX_MB * 1024 * 1024)) * 100;

  if (percentUsed > 80) {
    showNotification('⚠️ Storage 80% full - consider exporting data', 'warning');
    // Auto-cleanup non-critical data
    // Try predictive cleanup first (less aggressive than full clear)
    const res = predictiveCleanup();
    if (res.freedBytes > 0) {
      showNotification(`🧹 Auto-cleaned ${Math.round(res.freedBytes / 1024)} KB`, 'info');
    } else {
      // fallback to legacy cleanup
      clearOldStorageData();
    }
  }

  if (percentUsed > 95) {
    // Emergency cleanup
    showNotification('🚨 Storage critical - forcing cleanup', 'error');
    // attempt predictive cleanup first
    const res = predictiveCleanup();
    if (res.freedBytes <= 0) {
      // remove the least-critical known keys explicitly
      localStorage.removeItem(LS_KEYS.WATCH_TIME);
      clearOldStorageData();
    }
  }
}




// ============================================
// 9. LAZY LOADING IMAGES
// Intersection Observer for performance
// ============================================

/**
 * Initialize global lazy load observer
 */
function initializeLazyLoading() {
  // Check if already initialized
  if (window.lazyLoadObserver) {
    return window.lazyLoadObserver;
  }

  // Create Intersection Observer
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        if (img.dataset.src && !img.classList.contains('loaded')) {
          loadImage(img);
          observer.unobserve(img);
        }
      }
    });
  }, {
    root: null, // viewport
    rootMargin: '100px', // Start loading 100px before visible
    threshold: [0, 0.1, 0.5, 1] // Multiple thresholds for smoother loading
  });

  // Store globally
  window.lazyLoadObserver = observer;

  // Cleanup on page unload
  appState.addCleanup(() => {
    observer.disconnect();
    window.lazyLoadObserver = null;
  });

  return observer;
}


/**
 * Load image from data-src to src
 */
function loadImage(img) {
  const src = img.dataset.src;
  if (!src) return;

  // Show loading state
  img.classList.add('loading');

  // Create a new image to preload
  const tempImg = new Image();

  tempImg.onload = () => {
    img.src = src;
    img.classList.remove('loading');
    img.classList.add('loaded');
  };

  tempImg.onerror = () => {
    img.src = 'placeholder.png';
    img.alt = 'Image not available';
    img.classList.remove('loading');
    img.classList.add('error');
  };

  tempImg.src = src;
}


// ✅ Add periodic cache maintenance
// ✅ Periodic cache maintenance with flexible options
// ✅ Hybrid cache maintenance: simple defaults + optional advanced features
function startCacheMaintenance({
  verbose = false,
  intervalMinutes = 15,
  onComplete = null
} = {}) {
  const MAINTENANCE_INTERVAL_MS = intervalMinutes * 60 * 1000;
  const LOG_PREFIX = '[Cache]';

  //console.log(`${LOG_PREFIX} Starting maintenance every ${intervalMinutes} minutes`);

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

      onComplete?.({ rssPruned, livePruned, totalPruned });
    } catch (error) {
      console.error(`${LOG_PREFIX} Maintenance error:`, error);
    }
  };

  // Schedule periodic maintenance
  const maintenanceInterval = setInterval(runMaintenance, MAINTENANCE_INTERVAL_MS);

  // Register interval in appState for centralized control
  appState?.setIntervalRef?.('cacheMaintenance', maintenanceInterval);

  // Ensure cleanup is idempotent
  appState?.addCleanup?.(() => clearInterval(maintenanceInterval));

  // Run once immediately
  runMaintenance();

  // Return a stop function for manual control
  return () => {
    clearInterval(maintenanceInterval);
    console.log(`${LOG_PREFIX} Maintenance stopped`);
  };
}


// ======================================================================
// GLOBAL ERROR BOUNDARY (SAFE IMPLEMENTATION FOR final.js)
// ======================================================================

(function setupGlobalErrorHandlers() {
  if (window.__GLOBAL_ERROR_BOUNDARIES_INSTALLED__) return;
  window.__GLOBAL_ERROR_BOUNDARIES_INSTALLED__ = true;

  // ---- Normal runtime errors ----
  window.addEventListener("error", (event) => {
    try {
      const error = event.error || event.message || "Unknown error";

      console.error("GLOBAL ERROR:", error);

      // Log to your remote logging system
      try { logErrorToService?.(error); } catch { }

      // Friendly notification
      try { showNotification?.("Unexpected error occurred", "error"); } catch { }

      // Optional: Try smart recovery
      try {
        if (typeof canRecover === "function" && canRecover(error)) {
          attemptRecovery?.();
        }
      } catch { }

    } catch (handlerErr) {
      console.warn("Global error handler failed:", handlerErr);
    }
  });

  // ---- Unhandled Promise Rejections ----
  window.addEventListener("unhandledrejection", (event) => {
    try {
      const reason = event.reason || "Unknown async error";

      console.error("UNHANDLED REJECTION:", reason);

      event.preventDefault();

      try { showNotification?.("Failed to complete operation", "error"); } catch { }
      try { logErrorToService?.(reason); } catch { }

    } catch (handlerErr) {
      console.warn("Rejection handler failed:", handlerErr);
    }
  });

  //console.log("✅ Global Error Boundaries Installed");
})();


/**
 * Predictive cleanup - attempts to free storage by removing
 * low-importance, large items first based on a size/importance ratio.
 *
 * This function is non-destructive for critical keys (channels / favorites)
 * unless absolutely necessary: it uses the importance map to prefer
 * removing watch-time, caches, recent lists, or the last-update cache.
 *
 * Returns: { freedBytes: number, removedKeys: string[] }
 */
function predictiveCleanup() {
  try {
    const usage = getStorageUsage();
    if (!usage) return { freedBytes: 0, removedKeys: [] };

    // threshold in bytes (4MB default, adjust if you want)
    const threshold = 8 * 1024 * 1024;

    // If under threshold, nothing to do
    if (usage.totalBytes <= threshold) {
      return { freedBytes: 0, removedKeys: [] };
    }

    // Importance map: higher = more important, less likely to be removed
    const importance = {
      [LS_KEYS.CHANNELS]: 10,    // critical: channel DB
      [LS_KEYS.FAVORITES]: 9,    // very important
      [LS_KEYS.FEEDS]: 8,        // important
      [LS_KEYS.LIVE]: 7,         // live channels metadata
      [LS_KEYS.RECENT]: 5,       // moderate
      [LS_KEYS.WATCH_TIME]: 2,   // low
      [CACHE_KEY]: 1             // lowest/ephemeral
    };

    // Build sortable list of items
    const items = Object.entries(usage.items || {}).map(([key, size]) => {
      const imp = importance.hasOwnProperty(key) ? importance[key] : 5;
      return {
        key,
        size,
        importance: imp,
        ratio: size / imp
      };
    });

    // Sort descending by ratio (largest size per importance first)
    items.sort((a, b) => b.ratio - a.ratio);

    const removedKeys = [];
    let freedBytes = 0;
    let totalBytes = usage.totalBytes;

    for (const item of items) {
      // stop if we're under threshold
      if (totalBytes <= threshold) break;

      // Never remove the app namespace by accident (defensive)
      if (!item.key || item.key === '__iptv' || item.key.startsWith('__')) continue;

      // Prefer not to remove channels/favorites unless absolutely required.
      // importance map already biases against them, but add safety:
      if (item.key === LS_KEYS.CHANNELS || item.key === LS_KEYS.FAVORITES) {
        // only remove if we are still dramatically over threshold (> 150%)
        if (totalBytes <= threshold * 1.5) continue;
      }

      try {
        console.log(`🧹 predictiveCleanup: removing ${item.key} (~${Math.round(item.size / 1024)}KB)`);
        localStorage.removeItem(item.key);
        removedKeys.push(item.key);
        freedBytes += item.size;
        totalBytes -= item.size;

        // notify UI of changes for keys we know about
        if (item.key === LS_KEYS.RECENT) dispatchStorageUpdate('recent');
        if (item.key === LS_KEYS.FAVORITES) dispatchStorageUpdate('favorites');
        // caches: clear associated runtime caches too
        if (item.key === CACHE_KEY) {
          try { rssCache.clear(); liveCache.clear(); } catch (e) { /* ignore */ }
        }

      } catch (e) {
        console.warn('predictiveCleanup: failed to remove', item.key, e);
      }
    }

    console.log(`🧹 predictiveCleanup: Freed ~${Math.round(freedBytes / 1024)} KB, removed:`, removedKeys);
    return { freedBytes, removedKeys };
  } catch (err) {
    console.warn('predictiveCleanup failed:', err);
    return { freedBytes: 0, removedKeys: [] };
  }
}

// Accessibility: Skip navigation link
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
  skipNav.addEventListener('focus', () => {
    skipNav.style.top = '0';
  });
  skipNav.addEventListener('blur', () => {
    skipNav.style.top = '-40px';
  });
  document.body.insertBefore(skipNav, document.body.firstChild);
}

/**
 * Deduplicates concurrent API requests
 */
function deduplicateRequest(key, requestFn, options = {}) {
  const { ttl = 0, timeout = 15000, force = false } = options;

  // If already have an in-flight or cached entry and not forcing
  if (pendingRequests.has(key) && !force) {
    const entry = pendingRequests.get(key);
    // if cached resolved value still fresh, return Promise.resolve(value)
    if (entry && entry.resolved && (ttl <= 0 || (Date.now() - entry.resolvedAt) < ttl)) {
      return Promise.resolve(entry.value);
    }
    // return the in-flight promise
    if (entry && entry.promise) return entry.promise;
  }

  // Use AbortController for timeout
  const controller = new AbortController();
  const signal = controller.signal;
  let timedOut = false;

  const p = (async () => {
    try {
      // requestFn may optionally accept signal
      const result = await Promise.race([
        (typeof requestFn === 'function') ? requestFn({ signal }) : Promise.reject(new Error('requestFn not a function')),
        new Promise((_, rej) => setTimeout(() => { timedOut = true; controller.abort(); rej(new Error('timeout')); }, timeout))
      ]);
      // store resolved snapshot (for ttl)
      pendingRequests.set(key, { resolved: true, resolvedAt: Date.now(), value: result, promise: Promise.resolve(result) });
      return result;
    } catch (err) {
      // Always remove pending entry on error to allow retry
      pendingRequests.delete(key);
      throw err;
    } finally {
      // if there is a non-cached pending entry and not storing for ttl, ensure removal
      const cur = pendingRequests.get(key);
      if (cur && !cur.resolved) {
        pendingRequests.delete(key);
      }
    }
  })();

  // store as in-flight
  pendingRequests.set(key, { resolved: false, promise: p });
  // If caller wants to access controller (for manual abort), attach it
  p.abortController = controller;
  return p;
}

// Add this after your error handling utilities
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

  // Keep only last 50 errors
  if (errorLog.length > 50) {
    errorLog.shift();
  }

  // Optional: Send to analytics service
  try {
    // Example: Google Analytics, Sentry, etc.
    // gtag('event', 'exception', { description: entry.message });
  } catch (e) { }
}

function fetchWithTimeout(url, options = {}) {
  const { timeout = 15000 } = options;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  const cleanOptions = { ...options };
  delete cleanOptions.json;
  cleanOptions.signal = controller.signal;

  return fetch(url, cleanOptions)
    .finally(() => clearTimeout(id));
}


// Global error hooks - call your log send utility (non-blocking)
window.addEventListener('error', (ev) => {
  try { logErrorToService(ev.error || { message: ev.message, stack: ev.error?.stack }); } catch (e) { /* ignore */ }
});

window.addEventListener('unhandledrejection', (ev) => {
  try { logErrorToService(ev.reason || { message: String(ev) }); } catch (e) { /* ignore */ }
});

// ============================================
// EXPORT GLOBAL FUNCTIONS
// ============================================

// Build the namespace object
const __iptv = {
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
  getRecentlyWatched,

  // debugging / utilities
  getErrorLog: () => Array.isArray(errorLog) ? [...errorLog] : [],
  updateUserAgentDisplay,
  fullscreenPrompt
};

// Attach to global scope
window.__iptv = Object.freeze(__iptv);