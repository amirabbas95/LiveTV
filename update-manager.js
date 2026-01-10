// update-manager.js - Update Manager System - Optimized

// ============================================
// Utility Functions
// ============================================

/**
 * Debounce function for performance optimization
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttle function for performance optimization
 */
function throttle(func, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

// ============================================
// Update Manager Components
// ============================================

const RETRY_CONFIG = {
  RSS: {
    maxRetries: 3,
    baseDelay: 2 * 60 * 1000
  },
  LIVE: {
    maxRetries: 3,
    baseDelay: 90_000
  }
};

// ============================================
// Enhanced Retry Manager
// ============================================

class EnhancedRetryManager extends RetryManager {
  constructor(storageKey, options = {}) {
    super(storageKey, options);
    this.type = storageKey.includes('rss') ? 'rss' : 'live';
    this._cache = null;
    this._cacheTimestamp = 0;
    this._cacheDuration = 5000; // Cache for 5 seconds
  }

  /**
   * Clear cache when data changes
   */
  _clearCache() {
    this._cache = null;
    this._cacheTimestamp = 0;
  }

  /**
   * Override _save to clear cache
   */
  _save(data) {
    super._save(data);
    this._clearCache();
  }

  /**
   * Get all existing feeds/channels from localStorage with caching
   * @returns {Array} List of existing items
   */
  getExistingItems() {
    const now = Date.now();
    if (this._cache && (now - this._cacheTimestamp) < this._cacheDuration) {
      return this._cache;
    }

    const storageKey = this.type === 'rss' ? LS_KEYS.FEEDS : LS_KEYS.LIVE;
    const existing = safeJSONParse(localStorage.getItem(storageKey) || '[]', []);
    
    const items = existing.map(item => {
      if (this.type === 'rss') {
        return {
          id: item.url,
          name: item.name || 'Unnamed RSS Feed',
          url: item.url,
          category: item.category || 'Unknown',
          type: 'rss',
          ...item
        };
      } else {
        const channelId = extractChannelId(item.url);
        return {
          id: channelId || item.url,
          name: item.name || 'Unnamed Live Channel',
          url: item.url,
          channelId: channelId,
          category: item.category || 'Unknown',
          type: 'live',
          ...item
        };
      }
    });

    this._cache = items;
    this._cacheTimestamp = now;
    return items;
  }

  /**
   * Check if item already exists in the retry queue
   * @param {string} id - Item ID
   * @returns {boolean}
   */
  existsInQueue(id) {
    const data = this._load();
    return !!data[id];
  }

  /**
   * Get item by URL or channel ID
   * @param {string} identifier - URL or channel ID
   * @returns {Object|null} Item data
   */
  getExistingItem(identifier) {
    const items = this.getExistingItems();
    
    if (this.type === 'rss') {
      return items.find(item => 
        item.url === identifier || 
        item.id === identifier
      );
    } else {
      return items.find(item => 
        item.url === identifier || 
        item.channelId === identifier ||
        item.id === identifier
      );
    }
  }

  /**
   * Enhanced recordFailure with channel name support
   */
  recordFailure(id, error = "Unknown error", name = null) {
    const data = this._load();
    const entry = this._createRetryEntry(data[id]);
    entry.lastError = error;

    if (name) {
      entry.name = name;
    } else if (data[id] && data[id].name) {
      entry.name = data[id].name;
    }

    data[id] = entry;
    this._save(data);
  }

  /**
   * Manually add item to retry queue
   * @param {string} id - Item ID (URL for RSS, Channel ID for Live)
   * @param {string} name - Display name
   * @param {Object} options - Additional options
   * @returns {boolean} Success status
   */
  addManually(id, name, options = {}) {
    if (!id || !name) {
      console.error('❌ Manual retry addition requires both ID and name');
      return false;
    }

    const data = this._load();

    if (data[id]) {
      console.log(`⚠️ Item ${id} already in retry queue`);
      return false;
    }

    const entry = {
      retries: 0,
      nextRetry: Date.now() + (options.initialDelay || this.baseDelay),
      lastAttempt: Date.now(),
      lastError: options.reason || "Manually added",
      name: name,
      manuallyAdded: true,
      addedAt: Date.now(),
      addedBy: options.user || "user"
    };

    data[id] = entry;
    this._save(data);

    console.log(`✅ Manually added ${name} (${id}) to retry queue`);
    return true;
  }

  /**
   * Update existing entry
   * @param {string} id - Item ID
   * @param {Object} updates - Fields to update
   * @returns {boolean} Success status
   */
  updateEntry(id, updates) {
    const data = this._load();
    
    if (!data[id]) {
      console.error(`❌ Entry ${id} not found`);
      return false;
    }

    data[id] = { ...data[id], ...updates };
    this._save(data);
    
    console.log(`✅ Updated entry ${id}`);
    return true;
  }

  /**
   * Remove entry from retry queue
   * @param {string} id - Item ID
   * @returns {boolean} Success status
   */
  remove(id) {
    const data = this._load();
    
    if (!data[id]) {
      console.error(`❌ Entry ${id} not found`);
      return false;
    }

    delete data[id];
    this._save(data);
    
    console.log(`✅ Removed entry ${id}`);
    return true;
  }

  /**
   * Get all manually added items
   * @returns {Array} List of manually added items
   */
  getManualEntries() {
    const data = this._load();
    return Object.entries(data)
      .filter(([_, entry]) => entry.manuallyAdded)
      .map(([id, entry]) => ({ id, ...entry }));
  }

  /**
   * Check if item is manually added
   * @param {string} id - Item ID
   * @returns {boolean}
   */
  isManuallyAdded(id) {
    const entry = this.getEntry(id);
    return !!(entry && entry.manuallyAdded);
  }

  /**
   * Get entry with name
   */
  getEntry(id) {
    const data = this._load();
    return data[id] || null;
  }

  /**
   * Get all entries with names
   */
  getAllEntries() {
    const data = this._load();
    return Object.entries(data).map(([id, entry]) => ({
      id,
      ...entry
    }));
  }

  /**
   * Find entries by name (case-insensitive partial match)
   */
  findEntriesByName(searchTerm) {
    const entries = this.getAllEntries();
    const term = searchTerm.toLowerCase();

    return entries.filter(entry =>
      entry.name && entry.name.toLowerCase().includes(term)
    );
  }

  /**
   * Get statistics with manual entries breakdown
   */
  getEnhancedStats() {
    const stats = this.getStats();
    const manualEntries = this.getManualEntries();

    return {
      ...stats,
      manual: manualEntries.length,
      manualEntries: manualEntries
    };
  }
}

// ============================================
// Update History Manager
// ============================================

class UpdateHistory {
  constructor() {
    this.storageKey = 'update_history';
    this.maxEntries = 1000; // Keep last 1000 updates
  }

  /**
   * Load history from localStorage
   */
  _load() {
    try {
      const data = localStorage.getItem(this.storageKey);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('Failed to load update history:', e);
      return [];
    }
  }

  /**
   * Save history to localStorage
   */
  _save(history) {
    try {
      // Keep only the last maxEntries
      const trimmed = history.slice(-this.maxEntries);
      localStorage.setItem(this.storageKey, JSON.stringify(trimmed));
    } catch (e) {
      console.error('Failed to save update history:', e);
    }
  }

  /**
   * Add an update to history
   * @param {string} channelName - Channel name
   * @param {string} type - 'rss' or 'live'
   * @param {string} status - 'success' or 'failed'
   */
  addUpdate(channelName, type, status = 'success') {
    const history = this._load();
    
    const entry = {
      name: channelName,
      type: type.toLowerCase(),
      status: status,
      timestamp: Date.now()
    };

    history.push(entry);
    this._save(history);
  }

  /**
   * Get all history entries
   * @returns {Array} History entries sorted by newest first
   */
  getAll() {
    const history = this._load();
    return history.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get history filtered by type
   * @param {string} type - 'rss' or 'live'
   * @returns {Array} Filtered history entries
   */
  getByType(type) {
    return this.getAll().filter(entry => entry.type === type);
  }

  /**
   * Get history for a specific time range
   * @param {number} startTime - Start timestamp
   * @param {number} endTime - End timestamp
   * @returns {Array} Filtered history entries
   */
  getByTimeRange(startTime, endTime) {
    return this.getAll().filter(entry => 
      entry.timestamp >= startTime && entry.timestamp <= endTime
    );
  }

  /**
   * Clear all history
   */
  clear() {
    localStorage.removeItem(this.storageKey);
  }

  /**
   * Get statistics
   */
  getStats() {
    const history = this._load();
    
    const stats = {
      total: history.length,
      rss: history.filter(e => e.type === 'rss').length,
      live: history.filter(e => e.type === 'live').length,
      success: history.filter(e => e.status === 'success').length,
      failed: history.filter(e => e.status === 'failed').length
    };

    return stats;
  }

  /**
   * Format timestamp to readable date
   */
  formatDate(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();
    
    if (isToday) {
      // Today: Show "Today at HH:MM:SS"
      const time = date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
      return `Today at ${time}`;
    } else if (isYesterday) {
      // Yesterday: Show "Yesterday at HH:MM:SS"
      const time = date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
      return `Yesterday at ${time}`;
    } else {
      // Older: Show full date and time
      return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
    }
  }
}

// ============================================
// Update Manager Modal
// ============================================

class UpdateManagerModal {
  constructor() {
    this.modalId = 'updateManagerModal';
    this.isOpen = false;
    this.updateCheckInterval = null;
    this.currentTab = 'all';
    this.currentSource = 'existing';
    
    // Debounced methods for performance
    this.debouncedSearch = debounce(this.handleSearch.bind(this), 300);
    this.debouncedRefresh = debounce(this.refresh.bind(this), 500);
    
    this.createModal();
    this.setupEventListeners();
  }

  /**
   * Create the modal DOM structure with manual add forms
   */
  createModal() {
    if (document.getElementById(this.modalId)) return;

    const modal = document.createElement('div');
    modal.id = this.modalId;
    modal.className = 'update-manager-modal';
    modal.style.display = 'none';

    modal.innerHTML = `
      <div class="settings-content update-manager-content">
        <div class="settings-header">
          <h2><i class="fas fa-sync-alt"></i> Update Manager</h2>
          <button class="close-btn" id="closeUpdateManager" aria-label="Close Update Manager">
            <i class="fas fa-times"></i>
          </button>
        </div>
        
        <!-- Quick Actions Bar -->
        <div class="quick-actions-bar">
          <button id="addManualRetryBtn" class="btn-primary" title="Add Manual Retry">
            <i class="fas fa-plus-circle"></i> Add Manual Retry
          </button>
          <button id="clearAllBlockedBtn" class="btn-danger">
            <i class="fas fa-trash"></i> Clear Blocked
          </button>
          <button id="clearHistoryBtn" class="btn-danger" title="Clear Update History">
            <i class="fas fa-history"></i> Clear History
          </button>
        </div>
        
        <!-- Summary Stats -->
        <div class="update-summary">
          <div class="summary-card">
            <div class="summary-icon total">
              <i class="fas fa-layer-group"></i>
            </div>
            <div class="summary-details">
              <span class="summary-label">Total</span>
              <span class="summary-value" id="totalCount">0</span>
            </div>
          </div>
          
          <div class="summary-card">
            <div class="summary-icon ready">
              <i class="fas fa-play-circle"></i>
            </div>
            <div class="summary-details">
              <span class="summary-label">Ready</span>
              <span class="summary-value" id="readyCount">0</span>
            </div>
          </div>
          
          <div class="summary-card">
            <div class="summary-icon manual">
              <i class="fas fa-hand-paper"></i>
            </div>
            <div class="summary-details">
              <span class="summary-label">Manual</span>
              <span class="summary-value" id="manualCount">0</span>
            </div>
          </div>
          
          <div class="summary-card">
            <div class="summary-icon failed">
              <i class="fas fa-exclamation-triangle"></i>
            </div>
            <div class="summary-details">
              <span class="summary-label">Blocked</span>
              <span class="summary-value" id="blockedCount">0</span>
            </div>
          </div>
        </div>
        
        <!-- Tabs -->
        <div class="update-tabs">
          <button class="tab-btn active" data-tab="all">
            <i class="fas fa-th-list"></i> All Updates
          </button>
          <button class="tab-btn" data-tab="ready">
            <i class="fas fa-play-circle"></i> Ready
          </button>
          <button class="tab-btn" data-tab="manual">
            <i class="fas fa-hand-paper"></i> Manual
          </button>
          <button class="tab-btn" data-tab="blocked">
            <i class="fas fa-ban"></i> Blocked
          </button>
          <button class="tab-btn" data-tab="history">
            <i class="fas fa-history"></i> History
          </button>
        </div>
        
        <!-- Content Area -->
        <div class="update-content">
          <div id="allTab" class="tab-content active"></div>
          <div id="readyTab" class="tab-content"></div>
          <div id="manualTab" class="tab-content"></div>
          <div id="blockedTab" class="tab-content"></div>
          <div id="historyTab" class="tab-content"></div>
        </div>
        
        <!-- Last Update Info -->
        <div class="last-update-info">
          <div class="info-item">
            <span class="info-label">Last Check</span>
            <span class="info-value" id="lastCheckTime">Never</span>
          </div>
          <div class="info-item">
            <span class="info-label">Auto-Check</span>
            <span class="info-value" id="autoCheckStatus">-</span>
          </div>
          <div class="info-item">
            <span class="info-label">Next Check</span>
            <span class="info-value" id="nextCheckTime">-</span>
          </div>
        </div>
      </div>
      
      <!-- Manual Add Modal (Hidden by default) -->
      <div id="manualAddModal" class="manual-add-modal" style="display: none;">
        <div class="manual-add-content">
          <div class="manual-add-header">
            <h3><i class="fas fa-plus-circle"></i> Add Manual Retry</h3>
            <button class="close-btn" id="closeManualAdd">
              <i class="fas fa-times"></i>
            </button>
          </div>
          
          <!-- Existing Items Selection -->
          <div id="existingSource" class="source-content active">
            <div class="form-group">
              <label>Type</label>
              <select id="existingType" class="setting-select">
                <option value="live">Live Channels</option>
                <option value="rss">RSS Feeds</option>
              </select>
            </div>
            
            <div class="select-with-search">
              <div class="search-wrapper">
                <input 
                  type="text" 
                  id="existingSearch" 
                  class="search-input" 
                  placeholder="Search by name..."
                >
                <i class="fas fa-search"></i>
              </div>
              
              <div class="form-group">
                <label>Select Item</label>
                <select id="existingSelect" class="setting-select" size="8">
                  <option value="">Loading...</option>
                </select>
              </div>
              
              <div class="existing-stats">
                <span id="existingItemCount">0 items available</span>
                <span id="selectedInfo" class="selected-info"></span>
              </div>
            </div>
            
            <div id="selectedPreview" class="selected-item-preview" style="display: none;">
              <div class="preview-header"><strong>Selected Item:</strong></div>
              <div class="preview-details">
                <div class="preview-row">
                  <span class="preview-label">Name:</span>
                  <span id="previewName" class="preview-value">-</span>
                </div>
                <div class="preview-row">
                  <span class="preview-label">Type:</span>
                  <span id="previewType" class="preview-value">-</span>
                </div>
                <div class="preview-row">
                  <span class="preview-label">ID:</span>
                  <span id="previewId" class="preview-value">-</span>
                </div>
                <div class="preview-row">
                  <span class="preview-label">URL:</span>
                  <span id="previewUrl" class="preview-url">-</span>
                </div>
              </div>
            </div>
          </div>
          
          <!-- Action Buttons -->
          <div class="button-group">
            <button id="confirmAddBtn" class="btn-primary">
              <i class="fas fa-check"></i> Add to Queue
            </button>
            <button id="cancelAddBtn" class="btn-secondary">
              <i class="fas fa-times"></i> Cancel
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
  }

  /**
   * Setup all event listeners using event delegation where possible
   */
  setupEventListeners() {
    const modal = document.getElementById(this.modalId);
    if (!modal) return;

    // Use event delegation for better performance
    modal.addEventListener('click', (e) => {
      const target = e.target;
      const button = target.closest('button');
      
      if (!button) return;

      // Close buttons
      if (button.id === 'closeUpdateManager') {
        this.close();
      }
      // Add manual retry button
      else if (button.id === 'addManualRetryBtn') {
        this.showManualAddModal();
      }
      // Clear all blocked button
      else if (button.id === 'clearAllBlockedBtn') {
        this.clearAllBlocked();
      }
      // Clear history button
      else if (button.id === 'clearHistoryBtn') {
        this.clearHistory();
      }
      // Tab buttons
      else if (button.classList.contains('tab-btn')) {
        this.switchTab(button.dataset.tab);
      }
      // Retry button
      else if (button.classList.contains('retry-btn')) {
        this.handleRetry(button);
      }
      // Edit button - FIXED
      else if (button.classList.contains('edit-btn')) {
        this.handleEdit(button);
      }
      // Remove button
      else if (button.classList.contains('remove-btn')) {
        this.handleRemove(button);
      }
    });

    // Manual add modal event listeners
    this.setupManualAddListeners();

    // Close modal on outside click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        this.close();
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });
  }

  /**
   * Setup manual add modal event listeners
   */
  setupManualAddListeners() {
    const manualModal = document.getElementById('manualAddModal');
    if (!manualModal) return;

    // Use event delegation
    manualModal.addEventListener('click', (e) => {
      const target = e.target;
      const button = target.closest('button');
      
      if (!button) return;

      if (button.id === 'closeManualAdd' || button.id === 'cancelAddBtn') {
        this.hideManualAddModal();
      }
      else if (button.id === 'confirmAddBtn') {
        this.confirmManualAdd();
      }
    });

    // Type change listeners
    const existingType = document.getElementById('existingType');
    
    if (existingType) {
      existingType.addEventListener('change', () => this.loadExistingItems());
    }

    // Search input with debouncing
    const existingSearch = document.getElementById('existingSearch');
    if (existingSearch) {
      existingSearch.addEventListener('input', () => this.debouncedSearch());
    }

    // Selection change
    const existingSelect = document.getElementById('existingSelect');
    if (existingSelect) {
      existingSelect.addEventListener('change', () => this.updateSelectedPreview());
    }
  }

  /**
   * Open the modal
   */
  open() {
    const modal = document.getElementById(this.modalId);
    if (!modal) return;

    modal.style.display = 'flex';
    this.isOpen = true;
    this.refresh();

    // Start auto-refresh
    if (!this.updateCheckInterval) {
      this.updateCheckInterval = setInterval(() => this.debouncedRefresh(), 30000); // Every 30 seconds
    }
  }

  /**
   * Close the modal
   */
  close() {
    const modal = document.getElementById(this.modalId);
    if (!modal) return;

    modal.style.display = 'none';
    this.isOpen = false;

    // Stop auto-refresh
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
      this.updateCheckInterval = null;
    }

    this.hideManualAddModal();
  }

  /**
   * Switch between tabs
   */
  switchTab(tabName) {
    this.currentTab = tabName;

    // Update tab buttons
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    // Update content
    const contents = document.querySelectorAll('.tab-content');
    contents.forEach(content => {
      const contentId = `${tabName}Tab`;
      content.classList.toggle('active', content.id === contentId);
    });

    this.refresh();
  }

  /**
   * Refresh the current view - optimized with requestAnimationFrame
   */
  refresh() {
    if (!this.isOpen) return;

    requestAnimationFrame(() => {
      this.updateSummary();
      this.updateContent();
      this.updateLastCheckInfo();
    });
  }

  /**
   * Update summary statistics - optimized
   */
  updateSummary() {
    const rssStats = rssRetryManager.getEnhancedStats();
    const liveStats = liveRetryManager.getEnhancedStats();

    const total = rssStats.total + liveStats.total;
    const ready = rssStats.ready + liveStats.ready;
    const manual = rssStats.manual + liveStats.manual;
    const blocked = (rssStats.total - rssStats.ready) + (liveStats.total - liveStats.ready);

    // Use textContent for better performance
    const updateElement = (id, value) => {
      const el = document.getElementById(id);
      if (el && el.textContent !== String(value)) {
        el.textContent = value;
      }
    };

    updateElement('totalCount', total);
    updateElement('readyCount', ready);
    updateElement('manualCount', manual);
    updateElement('blockedCount', blocked);
  }

  /**
   * Update content for current tab
   */
  updateContent() {
    // Handle history tab separately
    if (this.currentTab === 'history') {
      this.renderHistoryTab();
      return;
    }

    const rssEntries = rssRetryManager.getAllEntries();
    const liveEntries = liveRetryManager.getAllEntries();
    
    // Add type to entries
    rssEntries.forEach(entry => entry.type = 'rss');
    liveEntries.forEach(entry => entry.type = 'live');

    const allEntries = [...rssEntries, ...liveEntries];

    let filteredEntries;
    switch (this.currentTab) {
      case 'ready':
        filteredEntries = allEntries.filter(e => this.isReady(e));
        break;
      case 'manual':
        filteredEntries = allEntries.filter(e => e.manuallyAdded);
        break;
      case 'blocked':
        filteredEntries = allEntries.filter(e => !this.isReady(e));
        break;
      default:
        filteredEntries = allEntries;
    }

    const contentId = `${this.currentTab}Tab`;
    const container = document.getElementById(contentId);
    if (!container) return;

    // Use DocumentFragment for better performance
    this.renderUpdateList(container, filteredEntries);
  }

  /**
   * Render update list - optimized with DocumentFragment
   */
  renderUpdateList(container, entries) {
    if (entries.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-inbox" style="font-size: 48px; margin-bottom: 15px; opacity: 0.3;"></i>
          <p>No items found in this category</p>
        </div>
      `;
      return;
    }

    const fragment = document.createDocumentFragment();
    
    // Create header
    const header = document.createElement('div');
    header.className = 'update-list-header';
    header.innerHTML = `
      <div>Name</div>
      <div>Type</div>
      <div>Status</div>
      <div>Retries</div>
      <div>Next Try</div>
      <div>Actions</div>
    `;
    fragment.appendChild(header);

    // Create list container
    const list = document.createElement('div');
    list.className = 'update-list';

    // Add items
    entries.forEach(entry => {
      const item = this.createUpdateItem(entry);
      list.appendChild(item);
    });

    fragment.appendChild(list);
    
    // Replace content
    container.innerHTML = '';
    container.appendChild(fragment);
  }

  /**
   * Create update item element
   */
  createUpdateItem(entry) {
    const item = document.createElement('div');
    const isReady = this.isReady(entry);
    const statusClass = isReady ? 'status-ready' : 'status-blocked';
    const typeClass = entry.manuallyAdded ? 'type-manual' : '';

    item.className = `update-item ${statusClass} ${typeClass}`;
    item.dataset.id = entry.id;
    item.dataset.type = entry.type;

    const nextRetryTime = entry.nextRetry ? 
      this.formatTimeRemaining(entry.nextRetry - Date.now()) : 'Now';
    
    const statusBadge = isReady ? 
      '<span class="status-badge status-ready">Ready</span>' :
      '<span class="status-badge status-blocked">Blocked</span>';

    item.innerHTML = `
      <div class="item-name" title="${entry.name || entry.id}">
        ${entry.name || entry.id}
        ${entry.manuallyAdded ? '<i class="fas fa-hand-paper" style="margin-left: 8px; color: #FFC107;" title="Manually Added"></i>' : ''}
      </div>
      <div class="item-type">${entry.type.toUpperCase()}</div>
      <div class="item-status">${statusBadge}</div>
      <div class="item-retries">${entry.retries || 0} / 3</div>
      <div class="item-next-try">${nextRetryTime}</div>
      <div class="item-actions">
        ${isReady ? '<button class="action-btn retry-btn" title="Retry Now"><i class="fas fa-redo"></i></button>' : ''}
        <button class="action-btn edit-btn" title="Edit Entry"><i class="fas fa-edit"></i></button>
        <button class="action-btn remove-btn" title="Remove Entry"><i class="fas fa-trash"></i></button>
      </div>
    `;

    return item;
  }

  /**
   * Check if entry is ready for retry
   */
  isReady(entry) {
    return entry.nextRetry <= Date.now();
  }

  /**
   * Format time remaining
   */
  formatTimeRemaining(ms) {
    if (ms <= 0) return 'Ready';
    
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m`;
  }

  /**
   * Update last check info
   */
  updateLastCheckInfo() {
    const lastCheck = localStorage.getItem('last_update_check');
    const lastCheckTime = document.getElementById('lastCheckTime');
    
    if (lastCheckTime) {
      if (lastCheck) {
        const time = new Date(parseInt(lastCheck));
        lastCheckTime.textContent = this.formatRelativeTime(time);
      } else {
        lastCheckTime.textContent = 'Never';
      }
    }

    const autoCheckStatus = document.getElementById('autoCheckStatus');
    if (autoCheckStatus) {
      autoCheckStatus.textContent = this.updateCheckInterval ? 'Active' : 'Inactive';
      autoCheckStatus.className = this.updateCheckInterval ? 
        'info-value status-on' : 'info-value status-off';
    }

    const nextCheckTime = document.getElementById('nextCheckTime');
    if (nextCheckTime) {
      if (this.updateCheckInterval && lastCheck) {
        const next = new Date(parseInt(lastCheck) + 300000); // 5 minutes
        nextCheckTime.textContent = this.formatRelativeTime(next);
      } else {
        nextCheckTime.textContent = '-';
      }
    }
  }

  /**
   * Format relative time
   */
  formatRelativeTime(date) {
    const now = Date.now();
    const diff = date - now;
    const absDiff = Math.abs(diff);

    const minutes = Math.floor(absDiff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (diff > 0) {
      if (days > 0) return `in ${days}d`;
      if (hours > 0) return `in ${hours}h`;
      return `in ${minutes}m`;
    } else {
      if (days > 0) return `${days}d ago`;
      if (hours > 0) return `${hours}h ago`;
      if (minutes > 0) return `${minutes}m ago`;
      return 'just now';
    }
  }

  /**
   * Handle retry button click
   */
  handleRetry(button) {
    const item = button.closest('.update-item');
    if (!item) return;

    const id = item.dataset.id;
    const type = item.dataset.type;
    const manager = type === 'rss' ? rssRetryManager : liveRetryManager;

    // Reset retry timer
    manager.updateEntry(id, {
      nextRetry: Date.now(),
      retries: 0
    });

    showNotification('✅ Retry scheduled', 'success');
    this.refresh();
  }

  /**
   * Handle edit button click - FIXED
   */
  handleEdit(button) {
    const item = button.closest('.update-item');
    if (!item) return;

    const id = item.dataset.id;
    const type = item.dataset.type;
    const manager = type === 'rss' ? rssRetryManager : liveRetryManager;
    const entry = manager.getEntry(id);

    if (!entry) {
      showNotification('❌ Entry not found', 'error');
      return;
    }

    // Show edit dialog
    this.showEditDialog(id, type, entry);
  }

  /**
   * Show edit dialog for entry
   */
  showEditDialog(id, type, entry) {
    const dialog = prompt(`Edit name for ${type.toUpperCase()} entry:`, entry.name || id);
    
    if (dialog !== null && dialog.trim() !== '') {
      const manager = type === 'rss' ? rssRetryManager : liveRetryManager;
      const success = manager.updateEntry(id, { name: dialog.trim() });
      
      if (success) {
        showNotification('✅ Entry updated', 'success');
        this.refresh();
      } else {
        showNotification('❌ Failed to update entry', 'error');
      }
    }
  }

  /**
   * Handle remove button click
   */
  handleRemove(button) {
    const item = button.closest('.update-item');
    if (!item) return;

    const id = item.dataset.id;
    const type = item.dataset.type;
    const manager = type === 'rss' ? rssRetryManager : liveRetryManager;
    const entry = manager.getEntry(id);

    if (!confirm(`Remove "${entry.name || id}" from retry queue?`)) {
      return;
    }

    manager.remove(id);
    showNotification('✅ Entry removed', 'success');
    this.refresh();
  }

  /**
   * Clear all blocked items
   */
  clearAllBlocked() {
    if (!confirm('Clear all blocked items from both RSS and Live retry queues?')) {
      return;
    }

    const rssEntries = rssRetryManager.getAllEntries();
    const liveEntries = liveRetryManager.getAllEntries();

    let cleared = 0;

    rssEntries.forEach(entry => {
      if (!this.isReady(entry)) {
        rssRetryManager.remove(entry.id);
        cleared++;
      }
    });

    liveEntries.forEach(entry => {
      if (!this.isReady(entry)) {
        liveRetryManager.remove(entry.id);
        cleared++;
      }
    });

    showNotification(`✅ Cleared ${cleared} blocked items`, 'success');
    this.refresh();
  }

  /**
   * Clear update history
   */
  clearHistory() {
    if (!confirm('Clear all update history? This cannot be undone.')) {
      return;
    }

    updateHistory.clear();
    showNotification('✅ Update history cleared', 'success');
    
    if (this.currentTab === 'history') {
      this.refresh();
    }
  }

  /**
   * Render history tab
   */
  renderHistoryTab() {
    const container = document.getElementById('historyTab');
    if (!container) return;

    const history = updateHistory.getAll();

    if (history.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-history" style="font-size: 48px; margin-bottom: 15px; opacity: 0.3;"></i>
          <p>No update history yet</p>
          <p style="font-size: 12px; opacity: 0.7;">Updates will appear here once channels are updated</p>
        </div>
      `;
      return;
    }

    const fragment = document.createDocumentFragment();
    
    // Create header
    const header = document.createElement('div');
    header.className = 'update-list-header';
    header.innerHTML = `
      <div>Channel Name</div>
      <div>Type</div>
      <div>Last Update</div>
      <div style="text-align: center;">Status</div>
    `;
    fragment.appendChild(header);

    // Create list container
    const list = document.createElement('div');
    list.className = 'update-list';

    // Add items
    history.forEach(entry => {
      const item = this.createHistoryItem(entry);
      list.appendChild(item);
    });

    fragment.appendChild(list);
    
    // Replace content
    container.innerHTML = '';
    container.appendChild(fragment);
  }

  /**
   * Create history item element
   */
  createHistoryItem(entry) {
    const item = document.createElement('div');
    item.className = 'update-item history-item';

    const statusClass = entry.status === 'success' ? 'status-success' : 'status-failed';
    const statusIcon = entry.status === 'success' ? 'fa-check-circle' : 'fa-times-circle';
    const statusText = entry.status === 'success' ? 'Success' : 'Failed';

    item.innerHTML = `
      <div class="item-name" title="${entry.name}">
        ${entry.name}
      </div>
      <div class="item-type">${entry.type.toUpperCase()}</div>
      <div class="item-date">${updateHistory.formatDate(entry.timestamp)}</div>
      <div class="item-status" style="text-align: center;">
        <span class="status-badge ${statusClass}">
          <i class="fas ${statusIcon}"></i> ${statusText}
        </span>
      </div>
    `;

    return item;
  }

  /**
   * Show manual add modal
   */
  showManualAddModal() {
    const manualModal = document.getElementById('manualAddModal');
    if (!manualModal) return;

    manualModal.style.display = 'block';
    this.loadExistingItems();
  }

  /**
   * Hide manual add modal
   */
  hideManualAddModal() {
    const manualModal = document.getElementById('manualAddModal');
    if (!manualModal) return;

    manualModal.style.display = 'none';
    
    // Reset form
    document.getElementById('existingSelect').innerHTML = '<option value="">Select an item...</option>';
    document.getElementById('existingSearch').value = '';
    
    const preview = document.getElementById('selectedPreview');
    if (preview) preview.style.display = 'none';
  }

  /**
   * Switch between existing and custom source
   */
  switchSource(source) {
    this.currentSource = source;

    // Update tabs
    document.querySelectorAll('.source-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.source === source);
    });

    // Update content
    document.querySelectorAll('.source-content').forEach(content => {
      const contentId = source === 'existing' ? 'existingSource' : 'customSource';
      content.classList.toggle('active', content.id === contentId);
    });
  }

  /**
   * Load existing items - optimized
   */
  loadExistingItems() {
    const type = document.getElementById('existingType').value;
    const manager = type === 'rss' ? rssRetryManager : liveRetryManager;
    const items = manager.getExistingItems();
    
    const select = document.getElementById('existingSelect');
    const countSpan = document.getElementById('existingItemCount');
    
    if (!select || !countSpan) return;

    // Use DocumentFragment for better performance
    const fragment = document.createDocumentFragment();
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Select an item...';
    fragment.appendChild(defaultOption);

    items.forEach(item => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = `${item.name} (${item.category || 'Unknown'})`;
      option.dataset.itemData = JSON.stringify(item);
      fragment.appendChild(option);
    });

    select.innerHTML = '';
    select.appendChild(fragment);
    countSpan.textContent = `${items.length} items available`;
  }

  /**
   * Handle search with debouncing
   */
  handleSearch() {
    const searchTerm = document.getElementById('existingSearch').value.toLowerCase();
    const select = document.getElementById('existingSelect');
    
    if (!select) return;

    Array.from(select.options).forEach(option => {
      if (option.value === '') return;
      
      const text = option.textContent.toLowerCase();
      option.style.display = text.includes(searchTerm) ? '' : 'none';
    });
  }

  /**
   * Update selected item preview
   */
  updateSelectedPreview() {
    const select = document.getElementById('existingSelect');
    const selectedOption = select.options[select.selectedIndex];
    const preview = document.getElementById('selectedPreview');
    
    if (!selectedOption || !selectedOption.value || !preview) {
      if (preview) preview.style.display = 'none';
      return;
    }

    const itemData = JSON.parse(selectedOption.dataset.itemData || '{}');
    
    document.getElementById('previewName').textContent = itemData.name || '-';
    document.getElementById('previewType').textContent = itemData.type?.toUpperCase() || '-';
    document.getElementById('previewId').textContent = itemData.id || '-';
    document.getElementById('previewUrl').textContent = itemData.url || '-';
    
    preview.style.display = 'block';
    
    const selectedInfo = document.getElementById('selectedInfo');
    if (selectedInfo) {
      selectedInfo.textContent = `✓ ${itemData.name}`;
      selectedInfo.classList.add('visible');
    }
  }

  /**
   * Confirm manual add
   */
  confirmManualAdd() {
    this.addFromExisting();
  }

  /**
   * Add from existing items
   */
  addFromExisting() {
    const select = document.getElementById('existingSelect');
    const type = document.getElementById('existingType').value;
    
    if (!select.value) {
      showNotification('⚠️ Please select an item', 'warning');
      return;
    }

    const selectedOption = select.options[select.selectedIndex];
    const itemData = JSON.parse(selectedOption.dataset.itemData || '{}');
    const manager = type === 'rss' ? rssRetryManager : liveRetryManager;

    if (manager.existsInQueue(itemData.id)) {
      showNotification('⚠️ This item is already in the retry queue', 'warning');
      return;
    }

    const success = manager.addManually(itemData.id, itemData.name, {
      reason: 'Added from existing items',
      user: 'manual_modal'
    });

    if (success) {
      showNotification(`✅ Added "${itemData.name}" to retry queue`, 'success');
      this.hideManualAddModal();
      this.refresh();
    } else {
      showNotification('❌ Failed to add to retry queue', 'error');
    }
  }

}

// ============================================
// UI Integration
// ============================================

/**
 * Add Update Manager button to settings modal
 */
function addUpdateManagerButton() {
  const checkModal = setInterval(() => {
    const settingsModal = document.getElementById('settingsModal');
    
    if (settingsModal) {
      clearInterval(checkModal);

      const apiKeySection = document.querySelector('#manageApiKeyBtn')?.closest('.setting-item');
      if (apiKeySection) {
        const updateManagerHtml = `
          <div class="setting-item">
            <h3><i class="fas fa-tasks"></i> Update Manager</h3>
            <p class="setting-description">
              Monitor and manage RSS & Live feed updates, retries, and failures
            </p>
            <button id="openUpdateManager" class="btn-secondary">
              <i class="fas fa-external-link-alt"></i> Open Update Manager
            </button>
          </div>
        `;

        apiKeySection.insertAdjacentHTML('afterend', updateManagerHtml);

        document.getElementById('openUpdateManager').addEventListener('click', () => {
          hideSettingsModal();
          setTimeout(() => updateManager.open(), 300);
        });
      }
    }
  }, 100);
}

/**
 * Quick function to manually add channel to retry queue from anywhere
 * @param {string} channelId - YouTube channel ID or RSS URL
 * @param {string} name - Channel name
 * @param {string} type - 'rss' or 'live'
 * @param {string} reason - Reason for manual retry
 */
function addChannelToRetryQueue(channelId, name, type = 'live', reason = 'Manual update requested') {
  let success = false;

  if (type === 'rss') {
    success = rssRetryManager.addManually(channelId, name, {
      reason: reason,
      user: 'manual'
    });
  } else if (type === 'live') {
    success = liveRetryManager.addManually(channelId, name, {
      reason: reason,
      user: 'manual'
    });
  }

  if (success) {
    showNotification(`✅ Added ${name} to retry queue`, 'success');

    if (updateManager.isOpen) {
      updateManager.refresh();
    }

    return true;
  } else {
    showNotification('❌ Failed to add to retry queue', 'error');
    return false;
  }
}

// ============================================
// Initialize Update Manager
// ============================================

// Create global instances
const rssRetryManager = new EnhancedRetryManager("rss_retry_queue", RETRY_CONFIG.RSS);
const liveRetryManager = new EnhancedRetryManager("live_retry_queue", RETRY_CONFIG.LIVE);
const updateHistory = new UpdateHistory();
const updateManager = new UpdateManagerModal();

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  addUpdateManagerButton();
});

// Export for use in final.js
window.UpdateManager = {
  rssRetryManager,
  liveRetryManager,
  updateHistory,
  updateManager,
  addChannelToRetryQueue
};