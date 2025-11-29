// ============================================
// IPTV CHANNEL MANAGER - ENHANCED VERSION
// Integrated Favorites & Recently Watched improvements
// ============================================

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

// ✅ NEW: Debounce configuration
const DEBOUNCE_MS = 180;

// ============================================
// GLOBAL STATE VARIABLES
// ============================================
let allChannels = [];
let allChannelItems = [];
let currentChannelId = "";
let watchStartTime = 0;
let lastFocusedElement = null;
let focusedIndex = 0;
let currentSortMethod = "none";
let isOnline = navigator.onLine;
let API_KEY = "";
let isAutoUpdateEnabled = true;
let updateIntervalHours = 8;
let touchStartX = 0;
let touchEndX = 0;
let touchStartY = 0;
let touchEndY = 0;
let lastTapTime = 0;
const DOUBLE_TAP_DELAY = 300;

// Search state
let searchQuery = "";
let filteredChannels = [];

// Caches
const rssCache = new Map();
const liveCache = new Map();

// Intervals & Timeouts
let watchInterval = null;
let autoUpdateInterval = null;
let overlayTimeoutShow = null;
let overlayTimeoutHide = null;
let numberTimeout = null;
let navigationDebounce = null;
let numberBuffer = "";

// ============================================
// ✅ NEW: SAFE LOCALSTORAGE HELPERS
// ============================================

/**
 * Safely parse JSON with fallback
 */
function safeJSONParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch (e) {
    console.warn('JSON parse error:', e);
    return fallback;
  }
}

/**
 * Read array from localStorage safely
 */
function readArray(key) {
  const raw = localStorage.getItem(key);
  const parsed = safeJSONParse(raw, null);
  if (Array.isArray(parsed)) return parsed;
  return [];
}

/**
 * Write array to localStorage safely
 */
function writeArray(key, arr) {
  try {
    localStorage.setItem(key, JSON.stringify(arr));
    return true;
  } catch (e) {
    console.error('localStorage write error:', e);
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
// ✅ NEW: DEBOUNCE UTILITY
// ============================================

/**
 * Debounce function to limit rapid calls
 */
function debounce(fn, wait = 200) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), wait);
  };
}

// ============================================
// ✅ NEW: ENHANCED FAVORITES API
// ============================================

/**
 * Get all favorites with validation
 */
function getFavorites() {
  const favorites = readArray(LS_KEYS.FAVORITES);
  // Validate structure: ensure each item has required fields
  return favorites.filter(fav =>
    fav && fav.url && fav.name
  );
}

/**
 * Check if channel is favorited
 */
function isFavorite(url) {
  if (!url) return false;
  return getFavorites().some(fav => fav.url === url);
}

/**
 * Add channel to favorites
 */
function addFavorite(channelData) {
  if (!channelData || !channelData.url) {
    console.warn('Invalid channel data for favorite');
    return false;
  }

  const favorites = getFavorites();

  // Check if already exists
  if (favorites.some(fav => fav.url === channelData.url)) {
    console.log('Channel already in favorites');
    return false;
  }

  // Add to beginning of array
  favorites.unshift({
    name: channelData.name,
    url: channelData.url,
    image: channelData.image,
    description: channelData.description,
    number: channelData.number,
    isLive: channelData.isLive,
    category: channelData.category || "Unknown",
    addedAt: Date.now()
  });

  const success = writeArray(LS_KEYS.FAVORITES, favorites);

  if (success) {
    dispatchStorageUpdate('favorites');
    return true;
  }

  return false;
}

/**
 * Remove channel from favorites
 */
function removeFavorite(url) {
  if (!url) return false;

  const favorites = getFavorites();
  const newFavorites = favorites.filter(fav => fav.url !== url);

  if (newFavorites.length === favorites.length) {
    console.log('Channel not in favorites');
    return false;
  }

  const success = writeArray(LS_KEYS.FAVORITES, newFavorites);

  if (success) {
    dispatchStorageUpdate('favorites');
    return true;
  }

  return false;
}

/**
 * Toggle favorite status
 */
function toggleFavoriteStatus(channelData) {
  if (!channelData || !channelData.url) {
    console.warn('Invalid channel data');
    return false;
  }

  if (isFavorite(channelData.url)) {
    return removeFavorite(channelData.url);

  } else {
    return addFavorite(channelData);
  }
}

/**
 * Clear all favorites
 */
function clearAllFavorites() {
  const success = writeArray(LS_KEYS.FAVORITES, []);
  if (success) {
    dispatchStorageUpdate('favorites');
  }
  return success;
}

// ============================================
// ✅ NEW: ENHANCED RECENTLY WATCHED API
// ============================================

/**
 * Get recently watched channels with timestamp validation
 */
function getRecentlyWatched() {
  const raw = readArray(LS_KEYS.RECENT);

  // Normalize and validate entries
  const normalized = raw.map(item => {
    // Handle legacy format (just URL string)
    if (typeof item === 'string') {
      return { url: item, watchedAt: 0 };
    }

    // Validate object format
    if (item && item.url) {
      return {
        url: item.url,
        name: item.name,
        image: item.image,
        description: item.description,
        number: item.number,
        isLive: item.isLive,
        category: item.category,
        watchedAt: item.watchedAt || item.at || 0
      };
    }

    return null;
  }).filter(Boolean);

  return normalized;
}

/**
 * Add channel to recently watched (with debounce)
 */
function addToRecentlyWatched(channelData, opts = {}) {
  if (!channelData || !channelData.url) {
    console.warn('Invalid channel data for recent');
    return false;
  }

  const timestamp = opts.timestamp ?? Date.now();
  const recent = getRecentlyWatched();

  // Remove if already exists
  const filtered = recent.filter(item => item.url !== channelData.url);

  // Add to beginning with timestamp
  filtered.unshift({
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
  const trimmed = filtered.slice(0, MAX_RECENT);

  const success = writeArray(LS_KEYS.RECENT, trimmed);

  if (success) {
    dispatchStorageUpdate('recent');
    return true;
  }

  return false;
}

/**
 * Debounced version of addToRecentlyWatched
 */
const debouncedAddRecent = debounce((channelData) => {
  addToRecentlyWatched(channelData);
}, DEBOUNCE_MS);

/**
 * Remove channel from recently watched
 */
function removeFromRecentlyWatched(url) {
  if (!url) return false;

  const recent = getRecentlyWatched();
  const filtered = recent.filter(item => item.url !== url);

  if (filtered.length === recent.length) {
    console.log('Channel not in recent');
    return false;
  }

  const success = writeArray(LS_KEYS.RECENT, filtered);

  if (success) {
    dispatchStorageUpdate('recent');
    return true;
  }

  return false;
}

/**
 * Clear all recently watched
 */
function clearRecentlyWatched() {
  const success = writeArray(LS_KEYS.RECENT, []);
  if (success) {
    dispatchStorageUpdate('recent');
  }
  return success;
}

// ============================================
// ✅ NEW: CROSS-TAB SYNCHRONIZATION
// ============================================

/**
 * Dispatch custom event for storage updates
 */
function dispatchStorageUpdate(type) {
  window.dispatchEvent(new CustomEvent('iptv-storage-updated', {
    detail: { type }
  }));
}

/**
 * Listen to storage events from other tabs
 */
window.addEventListener('storage', (e) => {
  if (e.key === LS_KEYS.FAVORITES) {
    console.log('📡 Favorites updated in another tab');
    dispatchStorageUpdate('favorites');
  }
  if (e.key === LS_KEYS.RECENT) {
    console.log('📡 Recent updated in another tab');
    dispatchStorageUpdate('recent');
  }
});

/**
 * Handle storage updates (same tab + other tabs)
 */
window.addEventListener('iptv-storage-updated', (e) => {
  const type = e.detail && e.detail.type;

  if (!type) {
    // Refresh everything if type unknown
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
// LEGACY COMPATIBILITY LAYER
// ============================================

/**
 * Migrate old favorites format to new format
 */
function migrateLegacyFavorites() {
  const oldKey = "favorites";
  const oldFavorites = localStorage.getItem(oldKey);

  if (!oldFavorites) return;

  try {
    const parsed = JSON.parse(oldFavorites);
    if (Array.isArray(parsed) && parsed.length > 0) {
      console.log('🔄 Migrating old favorites format...');

      // Check if already in new format
      const newFavorites = getFavorites();
      if (newFavorites.length === 0) {
        writeArray(LS_KEYS.FAVORITES, parsed);
        console.log('✅ Favorites migrated successfully');
      }
    }
  } catch (e) {
    console.warn('Migration failed:', e);
  }
}

/**
 * Migrate old recently watched format
 */
function migrateLegacyRecent() {
  const oldKey = "recentlyWatched";
  const oldRecent = localStorage.getItem(oldKey);

  if (!oldRecent) return;

  try {
    const parsed = JSON.parse(oldRecent);
    if (Array.isArray(parsed) && parsed.length > 0) {
      console.log('🔄 Migrating old recent format...');

      const newRecent = getRecentlyWatched();
      if (newRecent.length === 0) {
        // Add timestamps to old entries
        const withTimestamps = parsed.map((item, index) => ({
          ...item,
          watchedAt: Date.now() - (index * 1000) // Stagger timestamps
        }));
        writeArray(LS_KEYS.RECENT, withTimestamps);
        console.log('✅ Recent watched migrated successfully');
      }
    }
  } catch (e) {
    console.warn('Migration failed:', e);
  }
}

/**
 * Wrapper functions for backward compatibility
 */
function saveRecentlyWatched(channel) {
  debouncedAddRecent(channel);
}

function toggleFavorite(url, name, image, description, number, isLive, category, event) {
  if (event) event.stopPropagation();

  const channelData = {
    url, name, image, description, number, isLive,
    category: category || "Unknown"
  };

  const success = toggleFavoriteStatus(channelData);

  if (success) {
    // Immediate UI update
    setTimeout(() => {
      renderFavorites();
      updateFavoriteIcons();
      updateAllChannelItems();
    }, PLAYBACK_CONSTANTS.DOM_MUTATION_CHECK_INTERVAL);
  } else {
    showNotification('Failed to update favorite', 'error');
  }
}

// ============================================
// CANCELLATION TOKEN SYSTEM
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
    if (this.cancelled) {
      throw new Error(this.reason || 'Operation cancelled');
    }
  }
  isCancelled() {
    return this.cancelled;
  }
}

// ============================================
// CHANNEL LOADER CLASS
// ============================================
class ChannelLoader {
  constructor() {
    this.currentOperation = null;
    this.playerInstance = null;
    this.eventCleanupCallbacks = [];
  }

  async loadChannel(url, name, image, description, number, isLive) {
    if (this.currentOperation) {
      this.currentOperation.cancel('New channel selected');
    }
    const token = new CancellationToken();
    this.currentOperation = token;
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
    } catch (error) {
      if (!token.isCancelled()) {
        console.error(`❌ Failed to load channel ${name}:`, error);
        showErrorToUser(`Failed to load ${name}: ${error.message}`);
      } else {
        console.log(`⭕️ Channel load cancelled: ${name} - ${error.message}`);
      }
    } finally {
      if (this.currentOperation === token) {
        this.currentOperation = null;
      }
    }

  }



  updateChannelUI(name, image, description, number) {
    const updates = {
      'content-image': (el) => el.src = fixImageUrl(image) || 'placeholder.png',
      'video-title': (el) => el.textContent = name || 'Unknown Channel',
      'channel-description': (el) => el.textContent = description || '',
      'channel-number': (el) => el.textContent = number ? `${number}.` : '',
      'video-quality': (el) => el.textContent = ''
    };
    Object.entries(updates).forEach(([id, updateFn]) => {
      const element = document.getElementById(id);
      if (element) updateFn(element);
    });
    lastFocusedElement = document.activeElement;
  }

  async cleanupPlayer() {
    stopWatching();
    this.cleanupEventListeners();
    
    if (this.playerInstance) {
      try {
        console.log('🧹 Cleaning up existing player...');
        this.playerInstance.off();
        if (!this.playerInstance.paused()) {
          this.playerInstance.pause();
        }
        const playerId = this.playerInstance.id();
        this.playerInstance.dispose();
        this.playerInstance = null;
        const oldElement = document.getElementById(playerId);
        if (oldElement && oldElement.parentNode) {
          oldElement.parentNode.removeChild(oldElement);
        }
      } catch (error) {
        console.warn('⚠️ Error during player cleanup:', error);
        this.playerInstance = null;
      }
    }
    const container = document.getElementById('player-container');
    if (container) {
      const orphans = container.querySelectorAll('video, .video-js');
      orphans.forEach(el => {
        try {
          if (el.parentNode) {
            el.parentNode.removeChild(el);
          }
        } catch (e) {
          console.warn('Could not remove orphaned element:', e);
        }
      });
    }
    document.querySelectorAll('.play-fallback-overlay').forEach(el => {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    });
  }

  async initializePlayer(url, name, isLive, token) {
    const container = await this.waitForElement('player-container');
    token.throwIfCancelled();
    const streamConfig = createStreamConfig(url);
    const metadata = {
      isLive: isLive || false
    };
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
    } catch (error) {
      console.error('❌ Player initialization failed:', error);
      throw new Error(`Failed to initialize player: ${error.message}`);
    }
    if (streamConfig.type === 'hls' && this.playerInstance.tech({
      IWillNotUseThisInPlugins: true
    })) {
      this.setupHLSErrorRecovery();
    }


    // ✅✅✅ ADD THIS SECTION HERE ✅✅✅
    // Attach orientation change listener
    window.addEventListener('orientationchange', handleOrientationChange);

    // Check orientation immediately on load
    handleOrientationChange();

    // Add cleanup for the event listener
    this.eventCleanupCallbacks.push(() => {
      window.removeEventListener('orientationchange', handleOrientationChange);
    });
    // ✅✅✅ END OF NEW SECTION ✅✅✅

    this.setupPlayerEvents(name, isLive, streamConfig.type === 'youtube', token);
    token.throwIfCancelled();
    if (streamConfig.type === 'youtube') {
      this.setupYouTubeQualityMonitoring(token);
    }
    await this.waitForPlayerReady(token);
    token.throwIfCancelled();

    // ✅ THIS LINE WAS ADDED:
    this.setupFullscreenCloseButton();


    showChannelInfoOverlay();
    await this.attemptAutoplay();
  }

  setupHLSErrorRecovery() {
    if (!this.playerInstance) return;
    const tech = this.playerInstance.tech({
      IWillNotUseThisInPlugins: true
    });
    if (!tech || !tech.vhs) return;
    let errorCount = 0;
    const maxErrors = 3;
    const vhsErrorHandler = () => {
      errorCount++;
      console.warn(`⚠️ HLS error detected (${errorCount}/${maxErrors})`);
      if (errorCount < maxErrors) {
        setTimeout(() => {
          if (this.playerInstance && tech.vhs) {
            console.log('🔄 Attempting HLS recovery...');
            try {
              tech.vhs.playlists.trigger('loadedplaylist');
            } catch (e) {
              console.warn('Recovery attempt failed:', e);
            }
          }
        }, 1000);
      } else {
        console.error('❌ Max HLS errors reached, stopping recovery attempts');
      }
    };
    if (tech.vhs) {
      tech.vhs.on('error', vhsErrorHandler);
      this.eventCleanupCallbacks.push(() => {
        try {
          if (tech && tech.vhs) {
            tech.vhs.off('error', vhsErrorHandler);
          }
        } catch (e) {
          console.warn('Could not remove VHS error listener:', e);
        }
      });
    }
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
      if (existing) {
        resolve(existing);
        return;
      }
      const observer = new MutationObserver(() => {
        const element = document.getElementById(id);
        if (element) {
          observer.disconnect();
          clearTimeout(timeoutId);
          resolve(element);
        }
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
      const timeoutId = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Element ${id} not found within ${PLAYBACK_CONSTANTS.MAX_ELEMENT_WAIT_TIME}ms`));
      }, PLAYBACK_CONSTANTS.MAX_ELEMENT_WAIT_TIME);
    });
  }

  waitForPlayerReady(token) {
    return new Promise((resolve, reject) => {
      if (!this.playerInstance) {
        reject(new Error('Player instance not available'));
        return;
      }
      let resolved = false;
      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error(`Player ready timeout after ${PLAYBACK_CONSTANTS.PLAYER_READY_TIMEOUT}ms`));
        }
      }, PLAYBACK_CONSTANTS.PLAYER_READY_TIMEOUT);
      this.playerInstance.ready(() => {
        if (resolved) return;
        clearTimeout(timeoutId);
        if (token.isCancelled()) {
          resolved = true;
          reject(new Error('Cancelled during player initialization'));
          return;
        }
        resolved = true;
        resolve();
      });
      this.playerInstance.one('error', () => {
        if (resolved) return;
        clearTimeout(timeoutId);
        resolved = true;
        const error = this.playerInstance.error();
        reject(new Error(`Player error during initialization: ${error ? error.code : 'unknown'}`));
      });
    });
  }

  async attemptAutoplay() {
    if (!this.playerInstance) return;
    try {
      const playPromise = this.playerInstance.play();
      if (playPromise !== undefined) {
        await playPromise;
      }
    } catch (error) {
      console.warn('⚠️ Autoplay blocked:', error.message);
      this.showPlayButton();
    }
  }

  setupPlayerEvents(name, isLive, isYouTube, token) {
    if (!this.playerInstance) return;
    this.playerInstance.off();
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
      startWatching(name);
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
      this.updateQualityDisplay();
      const isChannelLive = isLive === true || isLive === 'true';
      if (!isChannelLive && !isYouTube) {
        this.playerInstance.controls(true);
      } else {
        this.playerInstance.controls(false);
      }
    };
    const retryHandler = () => {
      if (token.isCancelled()) return;
      console.log('🔄 Attempting HLS recovery...');
    };



    this.playerInstance.on('error', errorHandler);
    this.playerInstance.on('waiting', waitingHandler);
    this.playerInstance.on('playing', playingHandler);
    this.playerInstance.on('pause', pauseHandler);
    this.playerInstance.on('ended', endedHandler);
    this.playerInstance.on('loadedmetadata', metadataHandler);
    this.playerInstance.on('retryplaylist', retryHandler);


    this.eventCleanupCallbacks.push(() => {
      if (this.playerInstance) {
        this.playerInstance.off('error', errorHandler);
        this.playerInstance.off('waiting', waitingHandler);
        this.playerInstance.off('playing', playingHandler);
        this.playerInstance.off('pause', pauseHandler);
        this.playerInstance.off('ended', endedHandler);
        this.playerInstance.off('loadedmetadata', metadataHandler);
        this.playerInstance.off('retryplaylist', retryHandler);

      }
    });
  }

  setupYouTubeQualityMonitoring(token) {
    const checkInterval = PLAYBACK_CONSTANTS.YOUTUBE_READY_CHECK_INTERVAL;
    let attempts = 0;
    const maxAttempts = 30;
    const checkYouTubeReady = () => {
      if (token.isCancelled()) return;
      attempts++;
      if (attempts > maxAttempts) {
        console.warn('⚠️ YouTube quality monitoring setup timed out');
        return;
      }
      try {
        if (!this.playerInstance) return;
        const tech = this.playerInstance.tech({
          IWillNotUseThisInPlugins: true
        });
        if (!tech || !tech.ytPlayer) {
          setTimeout(checkYouTubeReady, checkInterval);
          return;
        }
        const qualityChangeHandler = (event) => {
          const qualityEl = document.getElementById('video-quality');
          if (qualityEl) {
            qualityEl.textContent = event.data || 'auto';
          }
        };
        tech.ytPlayer.addEventListener('onPlaybackQualityChange', qualityChangeHandler);
        this.eventCleanupCallbacks.push(() => {
          try {
            if (tech && tech.ytPlayer) {
              tech.ytPlayer.removeEventListener('onPlaybackQualityChange', qualityChangeHandler);
            }
          } catch (e) {
            console.warn('Could not remove YouTube quality listener:', e);
          }
        });
      } catch (error) {
        console.warn('⚠️ YouTube quality monitoring setup failed:', error);
      }
    };
    checkYouTubeReady();
  }

  updateQualityDisplay() {
    if (!this.playerInstance) return;
    const qualityEl = document.getElementById('video-quality');
    if (!qualityEl) return;
    const height = this.playerInstance.videoHeight();
    qualityEl.textContent = height ? `${height}p` : 'Auto';
  }

  showPlayButton() {
    const existing = document.querySelector('.play-fallback-overlay');
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
    const overlay = document.createElement('div');
    overlay.className = 'play-fallback-overlay';
    overlay.style.cssText = `
position: absolute;
top: 0;
left: 0;
width: 100%;
height: 100%;
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
padding: 15px 30px;
background: #ff0000;
color: white;
border: none;
border-radius: 8px;
cursor: pointer;
font-size: 18px;
font-weight: bold;
box-shadow: 0 4px 6px rgba(0,0,0,0.3);
transition: transform 0.2s;
`;
    button.onmouseenter = () => button.style.transform = 'scale(1.05)';
    button.onmouseleave = () => button.style.transform = 'scale(1)';
    overlay.appendChild(button);
    const clickHandler = async () => {
      if (!this.playerInstance) return;
      try {
        await this.playerInstance.play();
        if (overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
      } catch (error) {
        console.error('❌ Manual play failed:', error);
        showErrorToUser('Could not start playback');
      }
    };
    overlay.addEventListener('click', clickHandler);
    const container = document.getElementById('player-container');
    if (container) {
      container.appendChild(overlay);
    }
    this.eventCleanupCallbacks.push(() => {
      overlay.removeEventListener('click', clickHandler);
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    });
  }

  cleanupEventListeners() {
    this.eventCleanupCallbacks.forEach(cleanup => {
      try {
        cleanup();
      } catch (error) {
        console.warn('Error during event cleanup:', error);
      }
    });
    this.eventCleanupCallbacks = [];
  }

  getPlayer() {
    return this.playerInstance;
  }

  /**
     * Sets up a dynamic close button that appears ONLY when the player is in Video.js fullscreen mode.
     * This is necessary because Video.js creates a new stacking context that overlays the main modal's close button.
     */
  setupFullscreenCloseButton() {
    if (!this.playerInstance) return;

    const playerEl = this.playerInstance.el();

    /**
     * Creates and returns the button element.
     * @param {videojs.Player} player - The VJS player instance.
     */
    const createCloseButton = (player) => {
      // 1. Remove any existing instances attached to the player element
      const existingBtn = document.getElementById('fullscreenCloseBtn');
      if (existingBtn) existingBtn.remove();

      const closeBtn = document.createElement('button');
      closeBtn.id = 'fullscreenCloseBtn';
      closeBtn.className = 'fullscreen-close-button';
      closeBtn.innerHTML = '<i class="fas fa-minimize"></i>';
      closeBtn.onclick = toggleFullscreen;
      closeBtn.title = 'Close Video';


      closeBtn.style.cssText = `
        position: absolute;
        top: 10px;
        right: 10px;
        z-index: 2000;
        background: rgba(0, 0, 0, 0.5);
        color: white;
        border: none;
        border-radius: 50%;
        width: 40px;
        height: 40px;
        font-size: 18px;
        cursor: pointer;
        display: none; /* Keep this as the final initial state */
        transition: background 0.2s;
        /* These properties are used for layout but don't need 'display: flex' here */
        align-items: center;
        justify-content: center;
      `;

      // Hover effect
      closeBtn.onmouseover = () => closeBtn.style.background = 'rgba(76, 175, 80, 0.7)';
      closeBtn.onmouseout = () => closeBtn.style.background = 'rgba(0, 0, 0, 0.5)';

      return closeBtn;
    };

    // Create the button once and append it to the player element
    const closeBtnInstance = createCloseButton(this.playerInstance);
    playerEl.appendChild(closeBtnInstance);

    /**
     * Handles showing/hiding the button based on fullscreen state.
     */
    const fullscreenChangeHandler = () => {
      if (!this.playerInstance) return;


      const isFullscreen = this.playerInstance.isFullscreen();

      // Toggle visibility, which is more reliable than adding/removing elements constantly
      closeBtnInstance.style.display = isFullscreen ? 'flex' : 'none';
      console.log(`Fullscreen close button ${isFullscreen ? 'shown' : 'hidden'}.`);
    };

    // Listen to fullscreen change events
    this.playerInstance.on('fullscreenchange', fullscreenChangeHandler);

    // Initial state check (in case it's called after a quick toggle)
    fullscreenChangeHandler();


    // Cleanup: Remove event listener and the button element
    this.eventCleanupCallbacks.push(() => {
      if (this.playerInstance) {
        this.playerInstance.off('fullscreenchange', fullscreenChangeHandler);
      }
      // Use the instance to remove it on cleanup
      if (closeBtnInstance.parentNode) {
        closeBtnInstance.remove();
      }
    });
  }

}


const channelLoader = new ChannelLoader();

// ============================================
// UTILITY FUNCTIONS
// ============================================

function extractYouTubeID(url) {
  const match = url.match(
    /(?:youtube\.com\/(?:.*v=|live\/|embed\/)|youtu\.be\/)([^&?/]+)/i
  );
  return match ? match[1] : null;
}

function log(message, isError = false) {
  const logArea = document.getElementById("logArea");
  if (!logArea) return;
  const prefix = isError ? "Error: " : "Info: ";
  const colorClass = isError ? "text-red-400" : "";
  const timestamp = new Date().toLocaleTimeString();
  logArea.innerHTML += `
<div class="${colorClass}">${prefix}[${timestamp}] ${message}</div>
`;
  logArea.scrollTop = logArea.scrollHeight;
}

function showNotification(message, type = "info") {
  console.log(`🔔 ${type.toUpperCase()}: ${message}`);
  const colors = {
    info: '#007BFF',   // Vibrant Blue
    success: '#28A745', // Deep Green (Highly Recommended)
    warning: '#FFC107',  // Golden Yellow
    error: '#DC3545'   // Intense Red
  };
  const notification = document.createElement("div");
  notification.className = "notification";
  notification.style.cssText = `
position: fixed;
top: -100px;
left: 50%;
transform: translateX(-50%);
background: ${colors[type] || colors.info};
color: white;
padding: 12px 24px;
border-radius: 8px;
z-index: 10001;
font-weight: 500;
box-shadow: 0 4px 6px rgba(0,0,0,0.3);
min-width: 250px;
transition: top 0.4s ease, opacity 0.4s ease;
`;
  notification.textContent = message;
  document.body.appendChild(notification);

  requestAnimationFrame(() => {
    notification.style.top = '20px';
    notification.style.opacity = '1';
  });

  setTimeout(() => {
    notification.style.top = '-100px';
    notification.style.opacity = '0';
    setTimeout(() => notification.remove(), 400);
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
    setTimeout(() => errorDiv.remove(), 300);
  }, PLAYBACK_CONSTANTS.PLAYER_READY_TIMEOUT);
}


function getTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

// ============================================
// API KEY MANAGEMENT
// ============================================

function saveAPIKey(apiKey) {
  if (apiKey && apiKey.trim()) {
    const encrypted = btoa(btoa(apiKey.trim()));
    localStorage.setItem(API_KEY_STORAGE_KEY, encrypted);
    API_KEY = apiKey.trim();
    return true;
  }
  return false;
}

function getStoredAPIKey() {
  const encoded = localStorage.getItem(API_KEY_STORAGE_KEY);
  if (encoded) {
    try {
      API_KEY = atob(atob(encoded));
      return API_KEY;
    } catch (e) {
      console.error("Error decoding API key:", e);
      return null;
    }
  }
  return null;
}

function hasValidAPIKey() {
  const storedKey = getStoredAPIKey();
  return storedKey && storedKey.length > 10;
}

function clearAPIKey() {
  localStorage.removeItem(API_KEY_STORAGE_KEY);
  API_KEY = "";
}

// ============================================
// STREAM CONFIGURATION
// ============================================

function createStreamConfig(url) {
  const youtubeID = extractYouTubeID(url);
  if (youtubeID) {
    return {
      type: 'youtube',
      techOrder: ['youtube'],
      source: {
        src: url,
        type: "video/youtube"
      }
    };
  }
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

async function selectChannel(url, name, image, description, number, isLive) {
  if (!url) {
    console.warn('⚠️ No URL provided for channel selection');
    return;
  }



  await channelLoader.loadChannel(url, name, image, description, number, isLive);
}

function showChannelInfoOverlay() {
  const channelInfoOverlay = document.getElementById("channel-info-overlay");
  if (!channelInfoOverlay) return;
  const modal = document.getElementById("videoModal");
  if (modal) {
    modal.style.display = "flex";
    modal.classList.remove("hidden");
  }
  channelInfoOverlay.classList.remove("show");
  overlayTimeoutShow = setTimeout(() => {
    channelInfoOverlay.classList.add("show");
  }, 300);
  overlayTimeoutHide = setTimeout(() => {
    channelInfoOverlay.classList.remove("show");
  }, 6000);
}

function closeModal() {
  const modal = document.getElementById("videoModal");
  if (modal) {
    modal.style.display = "none";
    modal.classList.add("hidden");
  }
  channelLoader.cleanupPlayer().then(() => {
  }).catch(error => {
    console.warn('⚠️ Error during player cleanup:', error);
  });
  renderRecentlyWatched();
  updateAllChannelItems();
  if (lastFocusedElement && lastFocusedElement.isConnected) {
    lastFocusedElement.focus();
    focusedIndex = allChannelItems.indexOf(lastFocusedElement);
  } else if (allChannelItems.length > 0) {
    allChannelItems[0].focus();
    focusedIndex = 0;
  }
}


// ============================================
// AUTOMATIC FULLSCREEN ON LANDSCAPE ROTATION
// ============================================
/**
 * Handles device orientation changes and toggles fullscreen accordingly.
 * This function checks if:
 * 1. A video player is currently active
 * 2. The device orientation has changed
 * Then automatically enters/exits fullscreen based on orientation.
 */
/*
* Condition:
* 1. A video is actively playing (player is present and modal is open)
* 2. The device orientation has changed
* Then automatically enters/exits fullscreen based on orientation.
*/
// ============================================
// ORIENTATION CHANGE HANDLER - CONFIRMED
// ============================================
function handleOrientationChange() {

  const player = channelLoader.getPlayer();
  // Do nothing if no player is active or no orientation API
  if (!player || !screen.orientation || !screen.orientation.type) {
    return;
  }

  const modal = document.getElementById("videoModal");
  const isModalOpen = modal && modal.style.display === "flex";
  if (!isModalOpen) {
    return;
  }

  const isLandscape = screen.orientation.type.startsWith('landscape');
  const isCurrentlyFullscreen = player.isFullscreen();

  // Check if we're on mobile
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  if (isLandscape && !isCurrentlyFullscreen) {
    // Landscape detected, but not fullscreen -> Enter Fullscreen
    // This call is the one that triggered the security error, but 
    // the corrected toggleFullscreen now handles the failure gracefully 
    // by attempting screen.orientation.lock() instead.
    if (isMobile && !hasUserInteracted) {
      // On mobile, show prompt instead of auto-entering
      console.log('📱 Mobile landscape detected - showing fullscreen prompt');
      setTimeout(() => {
        showFullscreenPrompt();
      }, 500);

    } else {
      // Desktop or mobile with user interaction - direct approach
      //console.log('🔄 Auto-entering fullscreen');
      //window.toggleFullscreen(); 
    }

  } else if (!isLandscape && isCurrentlyFullscreen) {
    // Portrait detected, but is fullscreen -> Exit Fullscreen
    // This is generally allowed and is the primary success case.
    console.log('🔄 Exiting fullscreen (portrait detected)');
    removeFullscreenPrompt();
    window.toggleFullscreen();
  } else if (isLandscape && isCurrentlyFullscreen) {
    removeFullscreenPrompt();
  }
}


// ============================================
// ✅ MINIMAL FULLSCREEN PROMPT FUNCTIONS
// ============================================

/**
 * Show enhanced fullscreen prompt with controls for mobile users
 */
function showFullscreenPrompt() {
  // Remove existing prompt first
  removeFullscreenPrompt();

  const modal = document.getElementById("videoModal");
  if (!modal || modal.style.display !== "flex") return;

  // Create enhanced prompt element with controls
  fullscreenPrompt = document.createElement('div');
  fullscreenPrompt.className = 'minimal-fullscreen-prompt';
  fullscreenPrompt.innerHTML = `
    <div class="prompt-backdrop">
      <div class="prompt-card">
        <div class="prompt-header">
          <div class="prompt-icon">
            <i class="fas fa-expand"></i>
          </div>
          <div class="prompt-text">
            <span>Video Controls</span>
          </div>
          <button class="prompt-close" onclick="removeFullscreenPrompt()">
            <i class="fas fa-times"></i>
          </button>
        </div>
        
        <div class="prompt-controls">
          <button class="control-btn" id="promptPrevBtn" title="Previous Channel">
            <i class="fas fa-step-backward"></i>
            <span>Previous</span>
          </button>
          
          <button class="control-btn control-btn-primary" id="promptFullscreenBtn" title="Toggle Fullscreen">
            <i class="fas fa-expand"></i>
            <span>Fullscreen</span>
          </button>
          
          <button class="control-btn" id="promptNextBtn" title="Next Channel">
            <i class="fas fa-step-forward"></i>
            <span>Next</span>
          </button>
        </div>
      </div>
    </div>
  `;



  modal.appendChild(fullscreenPrompt);

  // Event listeners for control buttons
  const prevBtn = fullscreenPrompt.querySelector('#promptPrevBtn');
  const nextBtn = fullscreenPrompt.querySelector('#promptNextBtn');
  const fullscreenBtn = fullscreenPrompt.querySelector('#promptFullscreenBtn');

  if (prevBtn) {
    prevBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      navigateToPreviousChannel();
      removeFullscreenPrompt();
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      navigateToNextChannel();
      removeFullscreenPrompt();
    });
  }

  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      window.toggleFullscreen();
      removeFullscreenPrompt();
    });
  }

  /*   // Add a click handler to the backdrop to dismiss the prompt without action
    fullscreenPrompt.querySelector('.prompt-backdrop').addEventListener('click', function (e) {
        // Check if the click target is the backdrop itself, not an element inside prompt-card
        if (e.target === this) {
            removeFullscreenPrompt();
        }
    }); */

  // Auto-hide after 8 seconds
  promptTimeout = setTimeout(() => {
    removeFullscreenPrompt();
  }, 8000);

  console.log('📱 Enhanced fullscreen prompt shown');
}

/**
 * Remove fullscreen prompt with smooth animation
 */
function removeFullscreenPrompt() {
  if (fullscreenPrompt) {
    // Add fade-out animation
    fullscreenPrompt.classList.add('fade-out');
    // Ensure hasUserInteracted is set to prevent reappearance if an action was taken
    hasUserInteracted = true;

    // Remove after animation completes
    setTimeout(() => {
      if (fullscreenPrompt && fullscreenPrompt.parentNode) {
        fullscreenPrompt.parentNode.removeChild(fullscreenPrompt);
        fullscreenPrompt = null;
      }
    }, 250);
  }

  if (promptTimeout) {
    clearTimeout(promptTimeout);
    promptTimeout = null;
  }
}


function toggleFullscreen() {
  const player = channelLoader.getPlayer();
  const modal = document.getElementById("videoModal");

  if (!player || !modal || modal.style.display !== "flex") {
    return;
  }

  // Mark user interaction for future auto-fullscreen attempts
  hasUserInteracted = true;

  // Check current fullscreen status
  const isCurrentlyFullscreen = player.isFullscreen();

  if (isCurrentlyFullscreen) {
    // EXIT FULLSCREEN
    try {
      player.exitFullscreen();
    } catch (e) {
      console.warn('Failed to exit fullscreen:', e);
    }

  } else {
    // ENTER FULLSCREEN
    try {
      player.requestFullscreen();
    } catch (e) {

      // Try mobile-specific methods
      const videoElement = player.el().querySelector('video');

      if (videoElement) {
        // iOS Safari
        if (videoElement.webkitEnterFullscreen) {
          try {
            videoElement.webkitEnterFullscreen();
            return;
          } catch (iosError) {
            console.warn('iOS fullscreen failed:', iosError);
          }
        }

        // Android/Chrome
        if (videoElement.requestFullscreen) {
          try {
            videoElement.requestFullscreen();
            return;
          } catch (androidError) {
            console.warn('Android fullscreen failed:', androidError);
          }
        }
      }

      console.warn('All fullscreen methods failed');
    }
  }
}


// ============================================
// WATCH TIME MANAGEMENT
// ============================================

function startWatching(channelId) {
  stopWatching();
  currentChannelId = channelId;
  watchStartTime = Date.now();
  watchInterval = setInterval(() => {
    saveCurrentWatchTime();
  }, 10000);
  console.log(`▶️ Started watching: ${channelId}`);
}

function stopWatching() {
  if (!currentChannelId) return;
  if (watchInterval) {
    clearInterval(watchInterval);
    watchInterval = null;
  }
  saveCurrentWatchTime();
  currentChannelId = "";
  watchStartTime = 0;
}

function saveCurrentWatchTime() {
  if (!currentChannelId || !watchStartTime) return;
  const watchedMs = Date.now() - watchStartTime;
  const watchedSeconds = Math.floor(watchedMs / 1000);
  if (watchedSeconds < 5) return;
  const watchData = loadWatchTime();
  watchData[currentChannelId] = (watchData[currentChannelId] || 0) + watchedSeconds;
  const success = safeLocalStorageSet(
    LS_KEYS.WATCH_TIME,
    JSON.stringify(watchData)
  );
  if (success) {
    watchStartTime = Date.now();
  } else {
    console.warn('Failed to save watch time');
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

function saveChannelsData(channels) {
  const success = safeLocalStorageSet(
    LS_KEYS.CHANNELS,
    JSON.stringify(channels)
  );
  if (!success) {
    console.error('Failed to save channels data');
    promptDataExport();
  }
  return success;
}

// ============================================
// ✅ ENHANCED CHANNEL UI FUNCTIONS
// ============================================

function createChannelItem(channel) {
  const item = document.createElement("div");
  const numberText = channel.number || "";
  item.className = "content-card channel-item";
  item.setAttribute("role", "button");
  item.setAttribute("aria-label", `Select channel ${channel.name}`);
  item.setAttribute("tabindex", "0");
  if (channel.isLive) {
    item.setAttribute("aria-live", "polite");
  }
  item.dataset.url = channel.url;
  item.dataset.name = channel.name;
  item.dataset.image = channel.image;
  item.dataset.description = channel.description;
  item.dataset.number = numberText;
  item.dataset.isLive = channel.isLive;
  item.dataset.category = channel.category || "Unknown";

  const clickHandler = (e) => {
    e.stopPropagation();
    if (e.target.classList.contains("favorite-icon") ||
      e.target.closest(".favorite-icon")) {
      return;
    }
    selectChannel(
      channel.url,
      channel.name,
      channel.image,
      channel.description,
      channel.number,
      channel.isLive
    );
    // ✅ Use debounced version for recently watched
    saveRecentlyWatched(channel);
  };

  item.addEventListener("click", clickHandler);
  item._clickHandler = clickHandler;

  const wrapper = document.createElement("div");
  wrapper.className = "thumb-wrapper";

  const img = document.createElement("img");
  img.src = fixImageUrl(channel.image);
  img.alt = `${channel.name} Logo`;
  img.loading = "lazy";
  img.decoding = "async";
  img.onerror = function () {
    this.src = "placeholder.png";
    this.alt = "Image not available";
  };

  const numberBadge = document.createElement("span");
  numberBadge.className = "channel-number";
  numberBadge.textContent = channel.number;

  if (channel.isLive === true || channel.isLive === "true") {
    const liveIndicator = document.createElement("img");
    liveIndicator.src = "live.webp";
    liveIndicator.alt = "Live";
    liveIndicator.className = "live-indicator";
    wrapper.appendChild(liveIndicator);
  }

  wrapper.appendChild(img);
  wrapper.appendChild(numberBadge);

  const favoriteIcon = document.createElement("span");
  favoriteIcon.className = "favorite-icon";
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

  favoriteIcon.addEventListener("click", favoriteHandler);
  item._favoriteHandler = favoriteHandler;

  item.appendChild(wrapper);
  item.appendChild(favoriteIcon);

  return item;
}

function cleanupChannelItems() {
  allChannelItems.forEach((item) => {
    if (item._clickHandler) {
      item.removeEventListener("click", item._clickHandler);
      delete item._clickHandler;
    }
    const favoriteIcon = item.querySelector(".favorite-icon");
    if (favoriteIcon && item._favoriteHandler) {
      favoriteIcon.removeEventListener("click", item._favoriteHandler);
      delete item._favoriteHandler;
    }
    if (!item.isConnected) {
      item.remove();
    }
  });
  allChannelItems.length = 0;
}

function renderChannels(channels) {
  cleanupChannelItems();
  const mainContainer = document.getElementById("channels");
  if (!mainContainer) return;

  const existingGrids = mainContainer.querySelectorAll(".content-grid");
  const existingHeadings = mainContainer.querySelectorAll("h2:not(.sort-container h2)");
  existingGrids.forEach((grid) => grid.remove());
  existingHeadings.forEach((heading) => heading.remove());

  const fragment = document.createDocumentFragment();

  if (currentSortMethod === "none") {
    const categorizedChannels = channels.reduce((acc, channel) => {
      const category = channel.category || "Unknown";
      if (!acc[category]) acc[category] = [];
      acc[category].push(channel);
      return acc;
    }, {});

    for (const category in categorizedChannels) {
      const channelCount = categorizedChannels[category].length;
      const categoryHeading = document.createElement("h2");
      categoryHeading.textContent = `${category} (${channelCount})`;
      categoryHeading.className = "text-xl font-bold mt-6 mb-4 col-span-full";

      const categoryGrid = document.createElement("div");
      categoryGrid.className = "content-grid";

      categorizedChannels[category].forEach((channel) => {
        const item = createChannelItem(channel);
        categoryGrid.appendChild(item);
      });

      fragment.appendChild(categoryHeading);
      fragment.appendChild(categoryGrid);
    }
  } else {
    // Render all channels in a single grid if sorted
    const totalChannelCount = channels.length;
    const mainHeading = document.createElement("h2");
    mainHeading.textContent = `> All Channels < (${totalChannelCount})`;
    mainHeading.className = "text-xl font-bold mt-6 mb-4 col-span-full";

    const categoryGrid = document.createElement("div");
    categoryGrid.className = "content-grid";

    channels.forEach((channel) => {
      const item = createChannelItem(channel);
      categoryGrid.appendChild(item);
    });

    fragment.appendChild(mainHeading);
    fragment.appendChild(categoryGrid);
  }

  mainContainer.appendChild(fragment);
  updateAllChannelItems();
  console.log(`✅ Rendered ${channels.length} channels in ${currentSortMethod} view`);
}

// ✅ ENHANCED: Render favorites with new API
function renderFavorites() {
  const container = document.getElementById("favoritesGrid");
  if (!container) return;

  const favorites = getFavorites();
  container.innerHTML = "";

  const favSection = document.getElementById("favorites");
  if (favorites.length === 0) {

    favSection.style.display = "grid"; // or "block"
    container.innerHTML = '<p class="text-gray-400 col-span-full text-center">No favorites yet</p>';

  } else {
    if (favSection) favSection.style.display = "grid";
    favorites.forEach((channel) => {
      const item = createChannelItem(channel);
      container.appendChild(item);
    });
  }
}

// ✅ ENHANCED: Render recently watched with timestamps
function renderRecentlyWatched() {
  const container = document.getElementById("recentlyWatchedGrid");
  if (!container) return;

  const recent = getRecentlyWatched();
  container.innerHTML = "";

  const recentSection = document.getElementById("recentlyWatched");
  if (recent.length === 0) {

    recentSection.style.display = "grid"; // or "block"
    container.innerHTML = '<p class="text-gray-400 col-span-full text-center">No recently watched channels</p>';

  } else {
    if (recentSection) recentSection.style.display = "grid";
    recent.forEach((channel) => {
      const item = createChannelItem(channel);
      container.appendChild(item);
    });
  }
}

// ✅ ENHANCED: Update favorite icons with new API
function updateFavoriteIcons() {
  const favorites = getFavorites();
  const favoriteUrls = new Set(favorites.map((fav) => fav.url));

  document.querySelectorAll(".channel-item").forEach((item) => {
    const url = item.dataset.url;
    const icon = item.querySelector(".favorite-icon");
    if (icon) {
      if (favoriteUrls.has(url)) {
        icon.classList.add("active");
      } else {
        icon.classList.remove("active");
      }
    }
  });
}

function updateAllChannelItems() {
  allChannelItems = Array.from(document.querySelectorAll(".channel-item"));
}

// ============================================
// SEARCH FUNCTIONALITY
// ============================================

function searchChannels(query) {
  searchQuery = query.toLowerCase().trim();
  if (!searchQuery) {
    filteredChannels = [];
    sortChannelsAndRender(currentSortMethod);
    showFavoritesAndRecent();
    return;
  }
  filteredChannels = allChannels.filter(channel => {
    return channel.name.toLowerCase().includes(searchQuery) ||
      (channel.description && channel.description.toLowerCase().includes(searchQuery)) ||
      (channel.category && channel.category.toLowerCase().includes(searchQuery));
  });
  console.log(`🔍 Search: "${query}" - Found ${filteredChannels.length} channels`);
  hideFavoritesAndRecent();
  renderChannels(filteredChannels);
  updateFavoriteIcons();
  updateAllChannelItems();
  const searchResultsMsg = document.getElementById("search-results-message");
  if (searchResultsMsg) {
    if (filteredChannels.length === 0) {
      searchResultsMsg.textContent = `No channels found for "${query}"`;
      searchResultsMsg.style.display = "block";
    } else {
      searchResultsMsg.textContent = `Found ${filteredChannels.length} channel${filteredChannels.length > 1 ? 's' : ''}`;
      searchResultsMsg.style.display = "block";
    }
  }
}

function clearSearch() {
  searchQuery = "";
  filteredChannels = [];
  const searchInput = document.getElementById("channelSearch");
  if (searchInput) {
    searchInput.value = "";
  }
  const searchResultsMsg = document.getElementById("search-results-message");
  if (searchResultsMsg) {
    searchResultsMsg.style.display = "none";
  }
  showFavoritesAndRecent();
  sortChannelsAndRender(currentSortMethod);
}

function hideFavoritesAndRecent() {
  const favSection = document.getElementById("favorites");
  const recentSection = document.getElementById("recentlyWatched");
  if (favSection) {
    favSection.style.display = "none";
  }
  if (recentSection) {
    recentSection.style.display = "none";
  }
}

function showFavoritesAndRecent() {
  const favorites = getFavorites();
  const favSection = document.getElementById("favorites");
  if (favSection && favorites.length > 0) {
    favSection.style.display = "grid";
  }
  const recent = getRecentlyWatched();
  const recentSection = document.getElementById("recentlyWatched");
  if (recentSection && recent.length > 0) {
    recentSection.style.display = "grid";
  }
}

function setupSearchBar() {
  const searchInputs = [
    document.getElementById("channelSearch"),
    document.getElementById("channelSearchDesktop"),
    document.getElementById("channelSearchMobile")
  ].filter(Boolean);

  const clearButtons = [
    document.getElementById("clearSearch"),
    document.getElementById("clearSearchMobile")
  ].filter(Boolean);

  const resultMessages = [
    document.getElementById("search-results-message"),
    document.getElementById("search-results-message-mobile")
  ].filter(Boolean);

  searchInputs.forEach((searchInput, index) => {
    let searchTimeout;

    searchInput.addEventListener("input", (e) => {
      const query = e.target.value;
      searchInputs.forEach(input => {
        if (input !== e.target && input.value !== query) {
          input.value = query;
        }
      });
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        performSearch(query, resultMessages);
      }, 300);
    });

    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        clearSearchAll(searchInputs, resultMessages);
        searchInput.blur();
      }
    });

    searchInput.addEventListener("focus", () => {
      searchInput.style.borderColor = "#007bff";
    });

    searchInput.addEventListener("blur", () => {
      searchInput.style.borderColor = "#444";
    });
  });

  clearButtons.forEach((btn, index) => {
    btn.addEventListener("click", () => {
      clearSearchAll(searchInputs, resultMessages);
      if (searchInputs[index]) {
        searchInputs[index].focus();
      }
    });
  });
}

function performSearch(query, resultMessages) {
  searchQuery = query.toLowerCase().trim();
  if (!searchQuery) {
    filteredChannels = [];
    sortChannelsAndRender(currentSortMethod);
    showFavoritesAndRecent();
    hideAllResultMessages(resultMessages);
    return;
  }
  filteredChannels = allChannels.filter(channel => {
    const nameMatch = channel.name.toLowerCase().includes(searchQuery);
    const descMatch = channel.description &&
      channel.description.toLowerCase().includes(searchQuery);
    const catMatch = channel.category &&
      channel.category.toLowerCase().includes(searchQuery);
    const numMatch = channel.number &&
      channel.number.toString().includes(searchQuery);
    return nameMatch || descMatch || catMatch || numMatch;
  });
  console.log(`🔍 Search: "${query}" - Found ${filteredChannels.length} channels`);
  hideFavoritesAndRecent();
  renderChannels(filteredChannels);
  updateFavoriteIcons();
  updateAllChannelItems();
  updateAllResultMessages(resultMessages, query, filteredChannels.length);
}

function updateAllResultMessages(resultMessages, query, count) {
  resultMessages.forEach(msg => {
    if (!msg) return;
    if (count === 0) {
      msg.innerHTML = `
        <div style="color: #ff9800; padding: 8px;">
          <i class="fas fa-exclamation-circle"></i>
          No channels found for "<strong>${escapeHtml(query)}</strong>"
        </div>
      `;
      msg.style.display = "block";
    } else {
      msg.innerHTML = `
        <div style="color: #4caf50; padding: 8px;">
          <i class="fas fa-check-circle"></i>
          Found <strong>${count}</strong> channel${count > 1 ? 's' : ''} 
          matching "<strong>${escapeHtml(query)}</strong>"
        </div>
      `;
      msg.style.display = "block";
    }
  });
}

function hideAllResultMessages(resultMessages) {
  resultMessages.forEach(msg => {
    if (msg) {
      msg.style.display = "none";
    }
  });
}

function clearSearchAll(searchInputs, resultMessages) {
  searchQuery = "";
  filteredChannels = [];
  searchInputs.forEach(input => {
    if (input) input.value = "";
  });
  hideAllResultMessages(resultMessages);
  showFavoritesAndRecent();
  sortChannelsAndRender(currentSortMethod);
  console.log("🔍 Search cleared");
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================
// SORTING & FILTERING
// ============================================

function sortChannelsAndRender(sortMethod = "none") {
  const channelsToSort = searchQuery ? filteredChannels : allChannels;
  let sortedChannels = [...channelsToSort];
  switch (sortMethod) {
    case "asc":
      sortedChannels.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "desc":
      sortedChannels.sort((a, b) => b.name.localeCompare(a.name));
      break;
    case "watchTime":
      sortedChannels = sortChannelsByWatchTime(channelsToSort);
      break;
    case "none":
    default:
      currentSortMethod = "none";
      renderChannels(sortedChannels);
      updateFavoriteIcons();
      updateAllChannelItems();
      return;
  }
  currentSortMethod = sortMethod;
  renderChannels(sortedChannels);
  updateFavoriteIcons();
  updateAllChannelItems();
}

function handleSortChange(sortMethod) {
  localStorage.setItem("defaultSortMethod", sortMethod);
  sortChannelsAndRender(sortMethod);
  updateSortButtons(sortMethod);
}

function updateSortButtons(method) {
  const buttons = document.querySelectorAll(".sort-controls button");
  buttons.forEach((btn) => btn.classList.remove("active"));
  const activeBtn = [...buttons].find((btn) =>
    btn.getAttribute("onclick")?.includes(method)
  );
  if (activeBtn) {
    activeBtn.classList.add("active");
  }
}

// ============================================
// KEYBOARD NAVIGATION
// ============================================

function getGridColumns() {
  const grid = document.querySelector(".content-grid");
  if (!grid) return 1;
  const gridComputedStyle = window.getComputedStyle(grid);
  const gridTemplateColumns = gridComputedStyle.getPropertyValue("grid-template-columns");
  if (!gridTemplateColumns) return 1;
  const columnArray = gridTemplateColumns.split(" ");
  return columnArray.length;
}

document.addEventListener("keydown", (e) => {
  const searchInputDesktop = document.getElementById('channelSearchDesktop');
  const searchInputMobile = document.getElementById('channelSearchMobile');
  if ((searchInputDesktop && document.activeElement === searchInputDesktop) ||
    (searchInputMobile && document.activeElement === searchInputMobile)) {
    return;
  }
  const focusedTag = document.activeElement.tagName.toLowerCase();
  if (focusedTag === 'input' || focusedTag === 'textarea') {
    return;
  }
  if (e.key >= "0" && e.key <= "9") {
    numberBuffer += e.key;
    const overlay = document.getElementById("channel-number-overlay");
    if (overlay) {
      overlay.textContent = numberBuffer;
      overlay.style.display = "block";
    }
    if (numberTimeout) clearTimeout(numberTimeout);
    numberTimeout = setTimeout(() => {
      if (overlay) overlay.style.display = "none";
      const channelNumber = parseInt(numberBuffer, 10);
      const channel = allChannels.find((c) => c.number === channelNumber);
      if (channel) {
        const index = allChannelItems.findIndex(
          (item) => parseInt(item.dataset.number, 10) === channelNumber
        );
        if (index !== -1) {
          focusedIndex = index;
          allChannelItems[focusedIndex].focus();
          allChannelItems[focusedIndex].scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
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
      numberBuffer = "";
    }, 1000);
  }
});

document.addEventListener("keydown", (event) => {
  if (navigationDebounce) clearTimeout(navigationDebounce);
  navigationDebounce = setTimeout(() => {
    const GRID_COLUMNS = getGridColumns();
    const modal = document.getElementById("videoModal");
    const isModalOpen = modal && modal.style.display === "flex";
    let focusedElement = document.activeElement;
    let currentFocusedIndex = allChannelItems.findIndex(
      (item) => item === focusedElement
    );
    if (isModalOpen) {
      if (event.key === "Enter") {
        event.preventDefault();
        toggleFullscreen();
        return;
      }
      if (event.key === "Escape" || event.key === "ArrowLeft") {
        event.preventDefault();
        closeModal();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        showChannelInfoOverlay();
      } else if (["ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(event.key)) {
        event.preventDefault();
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
        lastFocusedElement = newChannelCard;
      }
      return;
    }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      if (allChannelItems.length === 0) return;
      if (currentFocusedIndex === -1) {
        allChannelItems[0].focus();
        allChannelItems[0].scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
        focusedIndex = 0;
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
      newCard.focus();
      newCard.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
      focusedIndex = newIndex;
      event.preventDefault();
    } else if (["PageUp", "PageDown", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (currentFocusedIndex === -1 && allChannelItems.length > 0) {
        allChannelItems[0].focus();
        allChannelItems[0].scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
      } else {
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
        newCard.focus();
        newCard.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
        focusedIndex = newIndex;
      }
    } else if (event.key === "Enter" && currentFocusedIndex !== -1) {
      event.preventDefault();
      const card = allChannelItems[currentFocusedIndex];
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
  }, 50);
});

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
    console.log("Saving updated channel data to localStorage...");
    const success = safeLocalStorageSet(
      LS_KEYS.CHANNELS,
      JSON.stringify(allChannels)
    );
    if (!success) {
      console.warn('⚠️ Channels loaded but not saved to storage');
      showNotification('⚠️ Channels loaded (not saved due to storage limits)', 'warning');
    }
    console.log("🔄 Refreshing UI...");
    renderChannels(allChannels);
    updateFavoriteIcons();
    renderRecentlyWatched();
    updateAllChannelItems();
    console.log("✅ Full channels update COMPLETE.");
    return true;
  } catch (e) {
    console.log(`❌ Critical error during full channel update: ${e.message}`, true);
    safeLocalStorageSet(LS_KEYS.CHANNELS, JSON.stringify(allChannels));
    renderChannels(allChannels);
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
  if (lastFocusedElement && lastFocusedElement.isConnected) {
    lastFocusedElement.focus();
  } else if (allChannelItems.length > 0) {
    allChannelItems[0].focus();
  }
  console.log("✅ Cleanup complete");
}
async function initialize() {
  console.log("🚀 Initializing IPTV Channel Manager...");
  const contentGrid = document.querySelector(".content-grid");
  const loadingElement = document.getElementById("loading-spinner");
  if (contentGrid) contentGrid.style.display = "none";
  if (loadingElement) loadingElement.style.display = "block";
  const closeBtn = document.querySelector(".closeModal");
  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  const modal = document.getElementById("videoModal");
  if (modal) {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal();
    });
  }
  setupNetworkMonitoring();
  setupSettingsModal();
  setupSearchBar();
  setupTouchGestures();
  setupPWA();
  let savedChannels = localStorage.getItem(LS_KEYS.CHANNELS);
  if (savedChannels) {
    try {
      allChannels = JSON.parse(savedChannels);
      //console.log(`Successfully loaded ${allChannels.length} channels from localStorage.`);
    } catch (e) {
      console.log("Invalid 'allChannelsData' found in localStorage. The data will be ignored.", true);
      console.log(`Error details: ${e.message}`, true);
      console.warn("Invalid allChannelsData in localStorage, ignoring.", e);
      allChannels = [];
    }
  } else {
    console.log("No previous 'allChannelsData' found in localStorage. Starting fresh.");
    allChannels = [];
  }
  API_KEY = getStoredAPIKey() || "";
  if (hasValidAPIKey()) {
    console.log("✅ Using stored API key");
  } else {
    console.log("ℹ️ No valid API key stored");
  }
  startChannelAutoUpdate();
  allChannels.forEach((ch, i) => {
    if (!ch.number) ch.number = i + 1;
  });
  loadWatchTime();
  const savedSort = localStorage.getItem("defaultSortMethod") || "none";
  handleSortChange(savedSort);
  renderFavorites();
  renderRecentlyWatched();
  updateFavoriteIcons();
  updateAllChannelItems();
  if (loadingElement) loadingElement.style.display = "none";
  if (contentGrid) contentGrid.style.display = "grid";
  if (lastFocusedElement && lastFocusedElement.isConnected) {
    lastFocusedElement.focus();
  } else if (allChannelItems.length > 0) {
    allChannelItems[0].focus();
  }
}
// ============================================
// EVENT LISTENERS
// ============================================
window.addEventListener("DOMContentLoaded", async () => {
  await initialize();
});
window.addEventListener("beforeunload", () => {
  cleanup();
});

document.addEventListener("visibilitychange", function () {
  const player = channelLoader.getPlayer();
  if (document.hidden) {
    saveCurrentWatchTime();
    if (player && !player.paused()) {
      player.pause();
      console.log("⏸️ Video paused due to tab switch");
    }
  } else {
    if (player && player.paused()) {
      const playPromise = player.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            console.log("▶️ Video resumed after returning to tab");
          })
          .catch((error) => {
            console.error("Resume failed:", error);
          });
      }
    }
  }
});
// Add to initialize()
/**
 * Sets up Progressive Web App features (Service Worker registration and prompt).
 * Skips registration on localhost to allow seamless live reloading.
 */
function setupPWA() {
  const isLocalHost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  // Skip Service Worker registration during local development 
  if (isLocalHost) {
    console.warn("⚠️ Service Worker skipped for local development.");
    return;
  } else {
    // 1. Determine the Base Path (Needed for GitHub Project Pages like /LiveTV/)
    let basePath = '/';
    if (location.hostname.endsWith('github.io')) {
      if (location.pathname !== '/') {
        const pathParts = location.pathname.split('/');
        if (pathParts.length > 1 && pathParts[1].length > 0) {
          basePath = '/' + pathParts[1] + '/';
        }
      }
    }
    // 2. Service Worker registration (Combined with Update Logic)
    if ('serviceWorker' in navigator) {
      const swPath = basePath + 'sw.js';
      // Register the Service Worker dynamically
      navigator.serviceWorker.register(swPath)
        .then(registration => {
          console.log(`✅ SW registered successfully with scope: ${registration.scope}`);
          // --- BEGIN: Integrated Update Logic ---
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // Create a persistent notification with action
                const updateNotification = document.createElement('div');
                updateNotification.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: #2196F3;
        color: white;
        padding: 15px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 10000;
        display: flex;
        gap: 10px;
        align-items: center;
      `;
                updateNotification.innerHTML = `
        <span>New version available!</span>
        <button onclick="location.reload()" style="
          background: white;
          color: #2196F3;
          border: none;
          padding: 8px 16px;
          border-radius: 4px;
          cursor: pointer;
          font-weight: bold;
        ">Update Now</button>
      `;
                document.body.appendChild(updateNotification);
              }
            });
          });
          // --- END: Integrated Update Logic ---
        })
        .catch(error => {
          console.error('❌ SW registration failed:', error);
        });
    }
    // 3. Add to homescreen prompt logic
    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      console.log('✨ Before Install Prompt deferred. Ready to show UI.');
    });
  }
}

function fixImageUrl(imageUrl) {
  if (!imageUrl) return 'placeholder.png';

  // Already HTTPS
  if (imageUrl.startsWith('https://')) {
    return imageUrl;
  }

  // HTTP - use multiple fallback proxies
  if (imageUrl.startsWith('http://')) {
    // Try weserv.nl first (better for images)
    const cleanUrl = imageUrl.replace('http://', '');
    return `https://images.weserv.nl/?url=${encodeURIComponent(cleanUrl)}&w=200&fit=cover`;
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
  modal.addEventListener('touchstart', handleTouchStart, {
    passive: true
  });
  modal.addEventListener('touchend', handleTouchEnd, {
    passive: true
  });
}

function handleTouchStart(e) {
  touchStartX = e.changedTouches[0].screenX;
  touchStartY = e.changedTouches[0].screenY;
}

function handleTouchEnd(e) {
  const currentTime = new Date().getTime();
  const currentTouchX = e.changedTouches[0].screenX;
  const currentTouchY = e.changedTouches[0].screenY;

  touchEndX = currentTouchX;
  touchEndY = currentTouchY;

  // Check if the current tap is within the time window AND the touch movement is negligible
  if (currentTime - lastTapTime < DOUBLE_TAP_DELAY &&
    Math.abs(currentTouchX - touchStartX) < 10 &&
    Math.abs(currentTouchY - touchStartY) < 10) {

    showFullscreenPrompt();
    lastTapTime = 0; // Reset to prevent accidental triple tap detection
    return; // Skip the swipe handler
  }

  // If not a double tap, update the time for the next potential tap
  lastTapTime = currentTime;
  handleSwipe();
}

function handleSwipe() {
  const modal = document.getElementById('videoModal');
  if (!modal || modal.style.display !== 'flex') return;
  const deltaX = touchEndX - touchStartX;
  const deltaY = touchEndY - touchStartY;
  const minSwipeDistance = 50;
  // Determine if swipe is more horizontal or vertical
  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    // Horizontal swipe
    if (Math.abs(deltaX) > minSwipeDistance) {
      if (deltaX > 0) {
        // Swipe right - close modal
        console.log('👉 Swipe right detected');
        showChannelInfoOverlay();
      } else {
        // Swipe left - show channel info
        console.log('👈 Swipe left detected');
        closeModal();
      }
    }
  } else {
    // Vertical swipe
    if (Math.abs(deltaY) > minSwipeDistance) {
      if (deltaY < 0) {
        // Swipe up - next channel
        //console.log('👆 Swipe up detected');
        //navigateToNextChannel();
      } else {
        // Swipe down - previous channel
        //console.log('👇 Swipe down detected');
        //navigateToPreviousChannel();
      }
    }
  }
}

function navigateToNextChannel() {
  if (!lastFocusedElement || allChannelItems.length === 0) return;
  const currentIndex = allChannelItems.findIndex(item => item === lastFocusedElement);
  if (currentIndex === -1) return;
  const nextIndex = (currentIndex + 1) % allChannelItems.length;
  const nextChannel = allChannelItems[nextIndex];
  const {
    url,
    name,
    image,
    description,
    number,
    isLive,
    category
  } = nextChannel.dataset;
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
  lastFocusedElement = nextChannel;
  showNotification(`▶️ ${name}`, 'info');
}

function navigateToPreviousChannel() {
  if (!lastFocusedElement || allChannelItems.length === 0) return;
  const currentIndex = allChannelItems.findIndex(item => item === lastFocusedElement);
  if (currentIndex === -1) return;
  const prevIndex = (currentIndex - 1 + allChannelItems.length) % allChannelItems.length;
  const prevChannel = allChannelItems[prevIndex];
  const {
    url,
    name,
    image,
    description,
    number,
    isLive,
    category
  } = prevChannel.dataset;
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
  lastFocusedElement = prevChannel;
  showNotification(`⏮️ ${name}`, 'info');
}


// ============================================
// SAFE LOCALSTORAGE WRAPPER
// ============================================

/**
 * Safely sets data in localStorage with quota error handling
 * @param {string} key - Storage key
 * @param {string} value - Value to store (should be stringified JSON)
 * @param {boolean} retryOnFail - Whether to clear old data and retry
 * @returns {boolean} - Success status
 */
function safeLocalStorageSet(key, value, retryOnFail = true) {
  // ✅ Check storage before attempting to save
  const estimatedSize = new Blob([value]).size;
  const usage = getStorageUsage();
  const availableSpace = (5 * 1024 * 1024) - usage.totalBytes; // 5MB total

  if (estimatedSize > availableSpace) {
    console.warn('⚠️ Insufficient storage space');
    if (retryOnFail) {
      clearOldStorageData();
      // Retry with same logic
    } else {
      showNotification('Storage full - please export your data', 'error');
      return false;
    }
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
  console.log('📊 Storage Usage:');
  console.log(`   Total: ${usage.totalMB} MB (${usage.totalKB} KB)`);
  console.log(`   Items: ${usage.itemCount}`);
  console.log('   Breakdown:');

  const sorted = Object.entries(usage.items)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10); // Top 10 items

  sorted.forEach(([key, size]) => {
    console.log(`   - ${key}: ${(size / 1024).toFixed(2)} KB`);
  });
}


// ============================================
// COMPLETE IMPORT/EXPORT BACKUP SYSTEM
// ============================================

/**
 * Export all application data as JSON backup
 */
function exportAllData() {
  try {
    // Gather all data from localStorage and memory
    const data = {
      version: "1.0.0",
      exportDate: new Date().toISOString(),
      channels: allChannels || [],
      favorites: JSON.parse(localStorage.getItem(LS_KEYS.FAVORITES) || "[]"),
      recentlyWatched: JSON.parse(localStorage.getItem(LS_KEYS.RECENT) || "[]"),
      watchTime: loadWatchTime() || {},
      rssFeeds: JSON.parse(localStorage.getItem(LS_KEYS.FEEDS) || "[]"),
      liveChannels: JSON.parse(localStorage.getItem(LS_KEYS.LIVE) || "[]"),
      settings: {
        autoUpdateEnabled: localStorage.getItem(AUTO_UPDATE_KEY) || "true",
        updateIntervalHours: localStorage.getItem(UPDATE_INTERVAL_KEY) || "8",
        defaultSortMethod: localStorage.getItem("defaultSortMethod") || "none",
        lastUpdate: localStorage.getItem(CACHE_KEY) || "0"
      }
    };

    // Create blob and download
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `iptv-backup-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showNotification('✅ Backup exported successfully', 'success');
    console.log('✅ Backup exported:', data);

    return true;
  } catch (error) {
    console.error('❌ Export failed:', error);
    showNotification('❌ Failed to export backup', 'error');
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
    const exportDate = data.exportDate ?
      new Date(data.exportDate).toLocaleString() : 'Unknown';

    const channelCount = data.channels?.length || 0;
    const favoriteCount = data.favorites?.length || 0;
    const recentCount = data.recentlyWatched?.length || 0;

    // Create modal
    const modal = document.createElement('div');
    modal.className = 'settings-modal';
    modal.style.display = 'flex';
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
            ${data.version ? `<li>🔢 Version: ${data.version}</li>` : ''}
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
            <input type="checkbox" id="mergeDataCheckbox" style="margin-right: 10px;">
            Merge with existing data (don't replace)
          </label>
          <p class="setting-description">
            If checked, imported data will be added to your current data instead of replacing it.
          </p>
        </div>
        
        <div style="display: flex; gap: 10px; margin-top: 20px;">
          <button id="confirmImportBtn" class="btn-primary" style="flex: 1;">
            ✅ Import
          </button>
          <button id="cancelImportBtn" class="btn-secondary" style="flex: 1;">
            ❌ Cancel
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Event listeners
    document.getElementById('confirmImportBtn').addEventListener('click', () => {
      const mergeData = document.getElementById('mergeDataCheckbox').checked;
      modal.remove();
      resolve({ confirmed: true, merge: mergeData });
    });

    document.getElementById('cancelImportBtn').addEventListener('click', () => {
      modal.remove();
      resolve({ confirmed: false });
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
        resolve({ confirmed: false });
      }
    });
  }).then(result => {
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
    // Step 1: Create automatic backup of current data
    console.log('📦 Creating automatic backup of current data...');
    const backupSuccess = await createAutoBackup();
    if (!backupSuccess) {
      console.warn('⚠️ Auto-backup failed, but continuing with import...');
    }

    // Step 2: Import channels
    if (data.channels && data.channels.length > 0) {
      if (mergeMode) {
        // Merge: Add new channels, update existing ones
        console.log('🔄 Merging channels...');
        data.channels.forEach(importedChannel => {
          const existingIndex = allChannels.findIndex(
            ch => ch.url === importedChannel.url
          );
          if (existingIndex !== -1) {
            // Update existing
            allChannels[existingIndex] = { ...allChannels[existingIndex], ...importedChannel };
          } else {
            // Add new
            allChannels.push(importedChannel);
          }
        });
      } else {
        // Replace mode
        console.log('🔄 Replacing channels...');
        allChannels = [...data.channels];
      }

      safeLocalStorageSet(LS_KEYS.CHANNELS, JSON.stringify(allChannels));
    }

    // Step 3: Import favorites
    if (data.favorites) {
      let favorites = mergeMode ?
        JSON.parse(localStorage.getItem(LS_KEYS.FAVORITES) || "[]") : [];

      if (mergeMode) {
        // Merge favorites (avoid duplicates)
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
    if (data.recentlyWatched) {
      let recent = mergeMode ?
        JSON.parse(localStorage.getItem(LS_KEYS.RECENT) || "[]") : [];

      if (mergeMode) {
        // Merge recent (keep newest)
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
    if (data.watchTime) {
      if (mergeMode) {
        const currentWatchTime = loadWatchTime();
        // Merge watch times (add them together)
        Object.keys(data.watchTime).forEach(channelId => {
          currentWatchTime[channelId] =
            (currentWatchTime[channelId] || 0) + data.watchTime[channelId];
        });
        safeLocalStorageSet(LS_KEYS.WATCH_TIME, JSON.stringify(currentWatchTime));
      } else {
        safeLocalStorageSet(LS_KEYS.WATCH_TIME, JSON.stringify(data.watchTime));
      }
    }

    // Step 6: Import RSS feeds (only if not merging or no existing feeds)
    if (data.rssFeeds && !mergeMode) {
      safeLocalStorageSet(LS_KEYS.FEEDS, JSON.stringify(data.rssFeeds));
    }

    // Step 7: Import live channels config (only if not merging)
    if (data.liveChannels && !mergeMode) {
      safeLocalStorageSet(LS_KEYS.LIVE, JSON.stringify(data.liveChannels));
    }

    // Step 8: Import settings (only if not merging)
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
    console.log('🔄 Refreshing UI...');
    renderChannels(allChannels);
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
      `✅ Import successful! ${mergeMode ? 'Data merged' : 'Data restored'}`,
      'success'
    );
    console.log('✅ Import completed successfully');

    // Close settings modal if open
    hideSettingsModal();

  } catch (error) {
    console.error('❌ Import failed:', error);
    showNotification('❌ Import failed: ' + error.message, 'error');
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
      channels: allChannels || [],
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


// ============================================
// EXPORT GLOBAL FUNCTIONS
// ============================================
window.selectChannel = selectChannel;
window.handleSortChange = handleSortChange;
window.showSettingsModal = showSettingsModal;
window.hideSettingsModal = hideSettingsModal;
window.toggleAutoUpdate = toggleAutoUpdate;
window.changeUpdateInterval = changeUpdateInterval;
window.manualUpdate = manualUpdate;
window.showAPIKeyModal = showAPIKeyModal;
window.hideAPIKeyModal = hideAPIKeyModal;
window.closeModal = closeModal;
window.searchChannels = searchChannels;
window.clearSearch = clearSearch;
window.exportAllData = exportAllData;
window.importBackupData = importBackupData;
window.triggerImportDialog = triggerImportDialog;
window.clearOldStorageData = clearOldStorageData;
window.updateStorageDisplay = updateStorageDisplay;
window.handleOrientationChange = handleOrientationChange;
window.toggleFullscreen = toggleFullscreen; 
