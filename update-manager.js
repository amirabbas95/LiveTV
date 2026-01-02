// update-manager.js - Update Manager System

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
  }

  /**
   * Get all existing feeds/channels from localStorage
   * @returns {Array} List of existing items
   */
  getExistingItems() {
    const storageKey = this.type === 'rss' ? LS_KEYS.FEEDS : LS_KEYS.LIVE;
    const existing = safeJSONParse(localStorage.getItem(storageKey) || '[]', []);
    
    return existing.map(item => {
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
// Update Manager Modal
// ============================================

class UpdateManagerModal {
  constructor() {
    this.modalId = 'updateManagerModal';
    this.isOpen = false;
    this.updateCheckInterval = null;
    
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
          <button id="forceCheckBtn" class="btn-secondary">
            <i class="fas fa-sync"></i> Force Check
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

        <!-- Manual Add Modal (Enhanced) -->
        <div id="manualAddModal" class="manual-add-modal" style="display: none;">
          <div class="manual-add-content">
            <div class="manual-add-header">
              <h3><i class="fas fa-plus-circle"></i> Add Manual Retry</h3>
              <button class="close-btn" id="closeManualAdd">
                <i class="fas fa-times"></i>
              </button>
            </div>
        

            <!-- Existing Data Selection -->
            <div id="existingSource" class="source-content active">
              <div class="form-group">
                <label for="retryTypeSelectExisting">Retry Type</label>
                <select id="retryTypeSelectExisting" class="setting-select">
                  <option value="rss">RSS Feed</option>
                  <option value="live">Live Channel</option>
                </select>
              </div>

              <div class="form-group">
                <label for="existingItemsSelect">Select Feed/Channel</label>
                <div class="select-with-search">
                  <div class="search-wrapper">
                    <input type="text" id="existingSearch" class="search-input" 
                           placeholder="Search existing items..." autocomplete="off">
                    <i class="fas fa-search"></i>
                  </div>
                  <select id="existingItemsSelect" class="setting-select" size="6">
                    <!-- Dynamically populated -->
                  </select>
                </div>
                <div class="existing-stats">
                  <span id="existingCount">0 items found</span>
                  <span id="selectedInfo" class="selected-info"></span>
                </div>
              </div>
              
              <div class="selected-item-preview" id="selectedPreview" style="display: none;">
                <div class="preview-header">
                  <strong>Selected Item:</strong>
                </div>
                <div class="preview-details">
                  <div class="preview-row">
                    <span class="preview-label">Name:</span>
                    <span class="preview-value" id="previewName"></span>
                  </div>
                  <div class="preview-row">
                    <span class="preview-label">ID:</span>
                    <span class="preview-value" id="previewId"></span>
                  </div>
                  <div class="preview-row">
                    <span class="preview-label">URL:</span>
                    <span class="preview-value preview-url" id="previewUrl"></span>
                  </div>
                  <div class="preview-row">
                    <span class="preview-label">Category:</span>
                    <span class="preview-value" id="previewCategory"></span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Common Fields -->
            <div class="form-group">
              <label for="manualRetryReason">Reason (Optional)</label>
              <input type="text" id="manualRetryReason" class="setting-input" 
                     placeholder="e.g., 'Manual update requested'">
            </div>
            
            <div class="button-group">
              <button id="submitManualRetry" class="btn-primary">
                <i class="fas fa-check"></i> Add to Queue
              </button>
              <button id="cancelManualRetry" class="btn-secondary">
                <i class="fas fa-times"></i> Cancel
              </button>
            </div>
          </div>
        </div>
        
        <!-- Tabs -->
        <div class="update-tabs">
          <button class="tab-btn active" data-tab="rss">
            <i class="fas fa-rss"></i> RSS Feeds
          </button>
          <button class="tab-btn" data-tab="live">
            <i class="fas fa-broadcast-tower"></i> Live Feeds
          </button>
          <button class="tab-btn" data-tab="manual">
            <i class="fas fa-hand-paper"></i> Manual Entries
          </button>
        </div>
        
        <!-- Content Areas -->
        <div class="update-content">
          <!-- RSS Tab Content -->
          <div id="rssTab" class="tab-content active">
            <div class="update-list-header">
              <span>Feed Name</span>
              <span>Type</span>
              <span>Status</span>
              <span>Retries</span>
              <span>Next Retry</span>
              <span>Actions</span>
            </div>
            <div id="rssList" class="update-list">
              <!-- Dynamic content -->
            </div>
          </div>
          
          <!-- Live Tab Content -->
          <div id="liveTab" class="tab-content">
            <div class="update-list-header">
              <span>Channel Name</span>
              <span>Type</span>
              <span>Status</span>
              <span>Retries</span>
              <span>Next Retry</span>
              <span>Actions</span>
            </div>
            <div id="liveList" class="update-list">
              <!-- Dynamic content -->
            </div>
          </div>
          
          <!-- Manual Entries Tab -->
          <div id="manualTab" class="tab-content">
            <div class="update-list-header">
              <span>Name</span>
              <span>Type</span>
              <span>Added By</span>
              <span>Status</span>
              <span>Added</span>
              <span>Actions</span>
            </div>
            <div id="manualList" class="update-list">
              <!-- Dynamic content -->
            </div>
          </div>
        </div>
        
        <!-- Last Update Info -->
        <div class="last-update-info">
          <div class="info-item">
            <span class="info-label">Last Update:</span>
            <span id="lastUpdateTime" class="info-value">Never</span>
          </div>
          <div class="info-item">
            <span class="info-label">Next Check:</span>
            <span id="nextCheckTime" class="info-value">-</span>
          </div>
          <div class="info-item">
            <span class="info-label">Auto Update:</span>
            <span id="autoUpdateStatus" class="info-value status-on">ON</span>
          </div>
        </div>
        
        <!-- Footer -->
        <div class="update-footer">
          <button id="clearFailedBtn" class="btn-warning">
            <i class="fas fa-trash"></i> Clear Failed
          </button>
          <button id="refreshUpdateManager" class="btn-secondary">
            <i class="fas fa-redo"></i> Refresh
          </button>
          <button id="closeUpdateManagerFooter" class="btn-primary">
            Close
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
  }

  /**
   * Setup event listeners including manual add
   */
  setupEventListeners() {
    document.addEventListener('click', (e) => {
      const tabBtn = e.target.closest('.tab-btn');
      if (tabBtn && tabBtn.dataset.tab) {
        this.switchTab(tabBtn.dataset.tab);
      }
    });
    
    document.addEventListener('click', (e) => {
      if (e.target.id === 'closeUpdateManager' ||
        e.target.closest('#closeUpdateManager') ||
        e.target.id === 'closeUpdateManagerFooter') {
        this.close();
      }
    });

    // Only one source tab remains, so we can simplify this
    document.addEventListener('click', (e) => {
      if (e.target.id === 'closeManualAdd' || e.target.closest('#closeManualAdd')) {
        this.hideManualAddModal();
      }
    });
    
    document.addEventListener('change', (e) => {
      if (e.target.id === 'retryTypeSelectExisting') {
        this.populateExistingItems(e.target.value);
      }
    });
    
    document.addEventListener('change', (e) => {
      if (e.target.id === 'existingItemsSelect') {
        this.handleExistingItemSelection(e.target.value);
      }
    });

    document.addEventListener('click', async (e) => {
      if (e.target.id === 'retryAllBtn' || e.target.closest('#retryAllBtn')) {
        await this.retryAllReady();
      } else if (e.target.id === 'forceCheckBtn' || e.target.closest('#forceCheckBtn')) {
        this.forceRetryCheck();
      } else if (e.target.id === 'refreshUpdateManager' || e.target.closest('#refreshUpdateManager')) {
        this.refresh();
      } else if (e.target.id === 'addManualRetryBtn' || e.target.closest('#addManualRetryBtn')) {
        this.showManualAddModal();
      } else if (e.target.id === 'clearFailedBtn' || e.target.closest('#clearFailedBtn')) {
        this.clearFailedItems();
      }
    });

    document.addEventListener('click', (e) => {
      if (e.target.id === 'submitManualRetry' || e.target.closest('#submitManualRetry')) {
        this.addManualRetry();
      } else if (e.target.id === 'cancelManualRetry' || e.target.closest('#cancelManualRetry')) {
        this.hideManualAddModal();
      }
    });

    const searchInput = document.getElementById('existingSearch');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        this.filterExistingItems();
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        if (document.getElementById('manualAddModal').style.display === 'block') {
          this.hideManualAddModal();
        } else {
          this.close();
        }
      }
    });

    document.addEventListener('click', (e) => {
      const modal = document.getElementById(this.modalId);
      if (e.target === modal && this.isOpen) {
        this.close();
      }

      const manualModal = document.getElementById('manualAddModal');
      if (e.target === manualModal && manualModal.style.display === 'block') {
        this.hideManualAddModal();
      }
    });
  }

  /**
   * Populate existing items in the dropdown
   */
  populateExistingItems(type) {
    const select = document.getElementById('existingItemsSelect');
    const searchInput = document.getElementById('existingSearch');
    const countSpan = document.getElementById('existingCount');
    
    if (!select) return;
    
    select.innerHTML = '';
    
    let items = [];
    if (type === 'rss') {
      items = rssRetryManager.getExistingItems();
    } else if (type === 'live') {
      items = liveRetryManager.getExistingItems();
    }
    
    const retryManager = type === 'rss' ? rssRetryManager : liveRetryManager;
    
    items.sort((a, b) => a.name.localeCompare(b.name));
    
    items.forEach(item => {
      const isInQueue = retryManager.existsInQueue(item.id);
      const option = document.createElement('option');
      option.value = JSON.stringify(item);
      option.textContent = item.name + (item.category ? ` (${item.category})` : '');
      
      if (isInQueue) {
        option.textContent += ' ⏳ Already in queue';
        option.disabled = true;
        option.style.color = '#888';
        option.style.fontStyle = 'italic';
      }
      
      select.appendChild(option);
    });
    
    countSpan.textContent = `${items.length} ${type === 'rss' ? 'RSS feeds' : 'live channels'} found`;
    
    if (searchInput) searchInput.value = '';
    
    this.clearSelectedPreview();
  }
  
  /**
   * Filter existing items based on search input
   */
  filterExistingItems() {
    const searchTerm = document.getElementById('existingSearch').value.toLowerCase();
    const select = document.getElementById('existingItemsSelect');
    const options = select.querySelectorAll('option');
    
    let visibleCount = 0;
    
    options.forEach(option => {
      const itemText = option.textContent.toLowerCase();
      const isVisible = !searchTerm || itemText.includes(searchTerm);
      
      option.style.display = isVisible ? '' : 'none';
      if (isVisible && !option.disabled) visibleCount++;
    });
    
    document.getElementById('existingCount').textContent = 
      `${visibleCount} items match your search`;
  }
  
  /**
   * Handle selection of existing item
   */
  handleExistingItemSelection(selectedValue) {
    if (!selectedValue) {
      this.clearSelectedPreview();
      return;
    }
    
    try {
      const item = JSON.parse(selectedValue);
      this.showSelectedPreview(item);
    } catch (error) {
      console.error('Error parsing selected item:', error);
      this.clearSelectedPreview();
    }
  }
  
  /**
   * Show preview of selected item
   */
  showSelectedPreview(item) {
    const preview = document.getElementById('selectedPreview');
    if (!preview) return;
    
    document.getElementById('previewName').textContent = item.name || 'Unnamed';
    document.getElementById('previewId').textContent = item.id || item.channelId || 'N/A';
    document.getElementById('previewUrl').textContent = item.url || 'N/A';
    document.getElementById('previewCategory').textContent = item.category || 'Unknown';
    
    preview.style.display = 'block';
    
    const selectedInfo = document.getElementById('selectedInfo');
    if (selectedInfo) {
      selectedInfo.textContent = `Selected: ${item.name}`;
      selectedInfo.className = 'selected-info visible';
    }
  }
  
  /**
   * Clear selected preview
   */
  clearSelectedPreview() {
    const preview = document.getElementById('selectedPreview');
    if (preview) preview.style.display = 'none';
    
    const selectedInfo = document.getElementById('selectedInfo');
    if (selectedInfo) {
      selectedInfo.textContent = '';
      selectedInfo.className = 'selected-info';
    }
  }

  /**
   * Add manual retry to queue
   */
  addManualRetry() {
    const select = document.getElementById('existingItemsSelect');
    const selectedValue = select.value;
    
    if (!selectedValue) {
      showNotification('❌ Please select an item from the list', 'error');
      return;
    }
    
    try {
      const item = JSON.parse(selectedValue);
      const type = document.getElementById('retryTypeSelectExisting').value;
      const reason = document.getElementById('manualRetryReason').value.trim() || 
                    'Manual update from existing list';
      
      let success = false;
      
      if (type === 'rss') {
        success = rssRetryManager.addManually(item.id, item.name, {
          reason: reason,
          user: 'manual'
        });
      } else if (type === 'live') {
        const channelId = item.channelId || item.id;
        success = liveRetryManager.addManually(channelId, item.name, {
          reason: reason,
          user: 'manual'
        });
      }
      
      if (success) {
        showNotification(`✅ Added "${item.name}" to ${type} retry queue`, 'success');
        this.hideManualAddModal();
        this.refresh();
        this.switchTab('manual');
      } else {
        showNotification('❌ Failed to add to retry queue', 'error');
      }
      
    } catch (error) {
      console.error('Error adding existing item:', error);
      showNotification('❌ Error processing selected item', 'error');
    }
  }

  /**
   * Quick-add function from channel context menu
   */
  quickAddFromChannel(channelData) {
    const isLive = channelData.url.includes('youtube.com') || 
                   channelData.url.includes('youtu.be');
    const type = isLive ? 'live' : 'rss';
    
    let identifier;
    if (isLive) {
      identifier = extractChannelId(channelData.url) || channelData.url;
    } else {
      identifier = channelData.url;
    }
    
    const retryManager = type === 'rss' ? rssRetryManager : liveRetryManager;
    const existingItem = retryManager.getExistingItem(identifier);
    
    if (existingItem) {
      retryManager.addManually(existingItem.id, existingItem.name, {
        reason: 'Quick add from channel',
        user: 'context_menu'
      });
      showNotification(`✅ Added "${existingItem.name}" to retry queue`, 'success');
    } else {
      retryManager.addManually(identifier, channelData.name || 'Unknown Channel', {
        reason: 'Quick add from channel',
        user: 'context_menu'
      });
      showNotification(`✅ Added channel to ${type} retry queue`, 'success');
    }
    
    if (this.isOpen) {
      this.refresh();
      this.switchTab('manual');
    }
  }

  /**
   * Open the modal
   */
  open() {
    const modal = document.getElementById(this.modalId);
    if (!modal) {
      this.createModal();
    }

    modal.style.display = 'flex';
    this.isOpen = true;

    this.refresh();
    this.startAutoRefresh();

    setTimeout(() => {
      const firstBtn = modal.querySelector('button');
      if (firstBtn) firstBtn.focus();
    }, 100);
  }

  /**
   * Close the modal
   */
  close() {
    const modal = document.getElementById(this.modalId);
    if (modal) {
      modal.style.display = 'none';
      this.isOpen = false;
    }

    this.stopAutoRefresh();
  }

  /**
   * Refresh all data in the modal
   */
  refresh() {
    if (!this.isOpen) return;

    this.updateSummaryStats();
    this.updateRSSList();
    this.updateLiveList();
    this.updateManualList();
    this.updateLastUpdateInfo();
  }

  /**
   * Update summary statistics with manual entries
   */
  updateSummaryStats() {
    if (!this.isOpen) return;

    const rssStats = rssRetryManager.getEnhancedStats();
    const liveStats = liveRetryManager.getEnhancedStats();

    const totalEntries = rssStats.total + liveStats.total;
    const readyEntries = rssStats.ready + liveStats.ready;
    const manualEntries = rssStats.manual + liveStats.manual;
    const blockedEntries = rssStats.blocked + liveStats.blocked;

    document.getElementById('totalCount').textContent = totalEntries;
    document.getElementById('readyCount').textContent = readyEntries;
    document.getElementById('manualCount').textContent = manualEntries;
    document.getElementById('blockedCount').textContent = blockedEntries;
  }

  /**
   * Update RSS feed list with manual entries highlighted
   */
  updateRSSList() {
    if (!this.isOpen) return;

    const rssList = document.getElementById('rssList');
    if (!rssList) return;

    const data = rssRetryManager.getAllEntries();
    const feeds = safeJSONParse(localStorage.getItem(LS_KEYS.FEEDS) || '[]', []);

    if (!data || data.length === 0) {
      rssList.innerHTML = '<div class="empty-state">No RSS feed retries pending</div>';
      return;
    }

    let html = '';

    data.forEach(entry => {
      const feed = feeds.find(f => f.url === entry.id);
      const feedName = entry.name || feed?.name || entry.id.substring(0, 30) + '...';

      const now = Date.now();
      let status = 'pending';
      let statusText = 'Pending';
      let statusClass = 'status-pending';

      if (entry.retries >= rssRetryManager.maxRetries) {
        status = 'blocked';
        statusText = 'Blocked';
        statusClass = 'status-blocked';
      } else if (now >= entry.nextRetry) {
        status = 'ready';
        statusText = 'Ready';
        statusClass = 'status-ready';
      }

      const nextRetryTime = entry.nextRetry ? new Date(entry.nextRetry).toLocaleTimeString() : '-';
      const timeUntil = entry.nextRetry ? Math.max(0, Math.round((entry.nextRetry - now) / 1000 / 60)) : 0;

      const isManual = entry.manuallyAdded;
      const typeClass = isManual ? 'type-manual' : 'type-auto';
      const typeIcon = isManual ? '<i class="fas fa-hand-paper" title="Manually added"></i>' : '<i class="fas fa-robot" title="Auto-added"></i>';

      html += `
        <div class="update-item ${statusClass} ${typeClass}" data-id="${entry.id}" data-type="rss" data-status="${status}" data-manual="${isManual}">
          <span class="item-name">${escapeHtml(feedName)}</span>
          <span class="item-type">${typeIcon}</span>
          <span class="item-status">
            <span class="status-badge ${statusClass}">${statusText}</span>
          </span>
          <span class="item-retries">${entry.retries}/${rssRetryManager.maxRetries}</span>
          <span class="item-next">
            ${timeUntil > 0 ? `in ${timeUntil} min` : nextRetryTime}
          </span>
          <span class="item-actions">
            ${status === 'ready' ? `
              <button class="action-btn retry-btn" title="Retry now" data-id="${entry.id}" data-type="rss">
                <i class="fas fa-redo"></i>
              </button>
            ` : ''}
            ${isManual ? `
              <button class="action-btn edit-btn" title="Edit entry" data-id="${entry.id}" data-type="rss">
                <i class="fas fa-edit"></i>
              </button>
            ` : ''}
            <button class="action-btn remove-btn" title="Remove from retry queue" data-id="${entry.id}" data-type="rss">
              <i class="fas fa-times"></i>
            </button>
          </span>
        </div>
      `;
    });

    rssList.innerHTML = html;
    this.setupItemActionListeners();
  }

  /**
   * Update Live feed list
   */
  updateLiveList() {
    if (!this.isOpen) return;

    const liveList = document.getElementById('liveList');
    if (!liveList) return;

    const data = liveRetryManager.getAllEntries();
    const liveFeeds = safeJSONParse(localStorage.getItem(LS_KEYS.LIVE) || '[]', []);

    if (!data || data.length === 0) {
      liveList.innerHTML = '<div class="empty-state">No live feed retries pending</div>';
      return;
    }

    let html = '';

    data.forEach(entry => {
      const feed = liveFeeds.find(f => extractChannelId(f.url) === entry.id);
      const channelName = entry.name || feed?.name || `Channel ${entry.id.substring(0, 8)}...`;

      const now = Date.now();
      let status = 'pending';
      let statusText = 'Pending';
      let statusClass = 'status-pending';

      if (entry.retries >= liveRetryManager.maxRetries) {
        status = 'blocked';
        statusText = 'Blocked';
        statusClass = 'status-blocked';
      } else if (now >= entry.nextRetry) {
        status = 'ready';
        statusText = 'Ready';
        statusClass = 'status-ready';
      }

      const nextRetryTime = entry.nextRetry ? new Date(entry.nextRetry).toLocaleTimeString() : '-';
      const timeUntil = entry.nextRetry ? Math.max(0, Math.round((entry.nextRetry - now) / 1000 / 60)) : 0;

      const isManual = entry.manuallyAdded;
      const typeClass = isManual ? 'type-manual' : 'type-auto';
      const typeIcon = isManual ? '<i class="fas fa-hand-paper" title="Manually added"></i>' : '<i class="fas fa-robot" title="Auto-added"></i>';

      html += `
        <div class="update-item ${statusClass} ${typeClass}" data-id="${entry.id}" data-type="live" data-status="${status}" data-manual="${isManual}">
          <span class="item-name">${escapeHtml(channelName)}</span>
          <span class="item-type">${typeIcon}</span>
          <span class="item-status">
            <span class="status-badge ${statusClass}">${statusText}</span>
          </span>
          <span class="item-retries">${entry.retries}/${liveRetryManager.maxRetries}</span>
          <span class="item-next">
            ${timeUntil > 0 ? `in ${timeUntil} min` : nextRetryTime}
          </span>
          <span class="item-actions">
            ${status === 'ready' ? `
              <button class="action-btn retry-btn" title="Retry now" data-id="${entry.id}" data-type="live">
                <i class="fas fa-redo"></i>
              </button>
            ` : ''}
            ${isManual ? `
              <button class="action-btn edit-btn" title="Edit entry" data-id="${entry.id}" data-type="live">
                <i class="fas fa-edit"></i>
              </button>
            ` : ''}
            <button class="action-btn remove-btn" title="Remove from retry queue" data-id="${entry.id}" data-type="live">
              <i class="fas fa-times"></i>
            </button>
          </span>
        </div>
      `;
    });

    liveList.innerHTML = html;
    this.setupItemActionListeners();
  }

  /**
   * Update Manual entries list
   */
  updateManualList() {
    if (!this.isOpen) return;

    const manualList = document.getElementById('manualList');
    if (!manualList) return;

    const rssManual = rssRetryManager.getManualEntries();
    const liveManual = liveRetryManager.getManualEntries();
    const allManual = [...rssManual, ...liveManual];

    if (allManual.length === 0) {
      manualList.innerHTML = '<div class="empty-state">No manual entries</div>';
      return;
    }

    let html = '';

    allManual.forEach(entry => {
      const type = entry.id.includes('youtube') || entry.id.startsWith('UC') ? 'live' : 'rss';
      const typeText = type === 'rss' ? 'RSS Feed' : 'Live Channel';
      const typeIcon = type === 'rss' ? '<i class="fas fa-rss"></i>' : '<i class="fas fa-broadcast-tower"></i>';

      const now = Date.now();
      let status = 'pending';
      let statusText = 'Pending';
      let statusClass = 'status-pending';

      const maxRetries = type === 'rss' ? rssRetryManager.maxRetries : liveRetryManager.maxRetries;

      if (entry.retries >= maxRetries) {
        status = 'blocked';
        statusText = 'Blocked';
        statusClass = 'status-blocked';
      } else if (now >= entry.nextRetry) {
        status = 'ready';
        statusText = 'Ready';
        statusClass = 'status-ready';
      }

      const addedTime = entry.addedAt ? new Date(entry.addedAt).toLocaleString() : '-';

      html += `
        <div class="update-item ${statusClass} type-manual" data-id="${entry.id}" data-type="${type}" data-status="${status}">
          <span class="item-name">${escapeHtml(entry.name || 'Unnamed')}</span>
          <span class="item-type">${typeIcon} ${typeText}</span>
          <span class="item-added-by">${entry.addedBy || 'user'}</span>
          <span class="item-status">
            <span class="status-badge ${statusClass}">${statusText}</span>
          </span>
          <span class="item-added">${getTimeAgo(entry.addedAt)}</span>
          <span class="item-actions">
            ${status === 'ready' ? `
              <button class="action-btn retry-btn" title="Retry now" data-id="${entry.id}" data-type="${type}">
                <i class="fas fa-redo"></i>
              </button>
            ` : ''}
            <button class="action-btn edit-btn" title="Edit entry" data-id="${entry.id}" data-type="${type}">
              <i class="fas fa-edit"></i>
            </button>
            <button class="action-btn remove-btn" title="Remove from retry queue" data-id="${entry.id}" data-type="${type}">
              <i class="fas fa-times"></i>
            </button>
          </span>
        </div>
      `;
    });

    manualList.innerHTML = html;
    this.setupItemActionListeners();
  }

  /**
   * Setup action button listeners for list items
   */
  setupItemActionListeners() {
    document.addEventListener('click', async (e) => {
      if (e.target.classList.contains('retry-btn') || e.target.closest('.retry-btn')) {
        const btn = e.target.classList.contains('retry-btn') ? e.target : e.target.closest('.retry-btn');
        const id = btn.dataset.id;
        const type = btn.dataset.type;

        await this.retrySingleItem(id, type);
      }

      if (e.target.classList.contains('remove-btn') || e.target.closest('.remove-btn')) {
        const btn = e.target.classList.contains('remove-btn') ? e.target : e.target.closest('.remove-btn');
        const id = btn.dataset.id;
        const type = btn.dataset.type;

        this.removeSingleItem(id, type);
      }
    });
  }

  /**
   * Update last update information
   */
  updateLastUpdateInfo() {
    if (!this.isOpen) return;

    const lastUpdate = parseInt(localStorage.getItem(CACHE_KEY) || "0");
    const lastUpdateEl = document.getElementById('lastUpdateTime');
    if (lastUpdateEl) {
      if (lastUpdate === 0) {
        lastUpdateEl.textContent = "Never";
        lastUpdateEl.className = 'info-value status-off';
      } else {
        const timeAgo = getTimeAgo(lastUpdate);
        lastUpdateEl.textContent = timeAgo;
        lastUpdateEl.className = 'info-value status-on';
      }
    }

    const nextCheckEl = document.getElementById('nextCheckTime');
    if (nextCheckEl) {
      const updateIntervalHours = appState.get('settings.updateIntervalHours') || 8;
      const cacheExpiryMs = updateIntervalHours * 60 * 60 * 1000;
      const nextCheck = lastUpdate + cacheExpiryMs;
      const now = Date.now();

      if (nextCheck > now) {
        const minsRemaining = Math.ceil((nextCheck - now) / 1000 / 60);
        nextCheckEl.textContent = `in ${minsRemaining} min`;
      } else {
        nextCheckEl.textContent = 'Now';
      }
    }

    const autoUpdateStatusEl = document.getElementById('autoUpdateStatus');
    if (autoUpdateStatusEl) {
      const isAutoUpdateEnabled = appState.get('settings.isAutoUpdateEnabled');
      if (isAutoUpdateEnabled) {
        autoUpdateStatusEl.textContent = 'ON';
        autoUpdateStatusEl.className = 'info-value status-on';
      } else {
        autoUpdateStatusEl.textContent = 'OFF';
        autoUpdateStatusEl.className = 'info-value status-off';
      }
    }
  }

  /**
   * Retry all ready items
   */
  async retryAllReady() {
    try {
      showNotification('🔄 Retrying all ready items...', 'info');

      if (rssRetryManager.hasReadyRetries()) {
        const processor = new RSSProcessor();
        await processor.loadFeeds({ force: false });
      }

      if (liveRetryManager.hasReadyRetries()) {
        const processor = new LiveProcessor();
        await processor.loadFeeds({ force: false });
      }

      this.refresh();
      showNotification('✅ All ready items retried successfully', 'success');

    } catch (error) {
      console.error('Failed to retry all items:', error);
      showNotification('❌ Failed to retry some items', 'error');
    }
  }

  /**
   * Retry a single item
   */
  async retrySingleItem(id, type) {
    try {
      if (type === 'rss') {
        const feeds = safeJSONParse(localStorage.getItem(LS_KEYS.FEEDS) || '[]', []);
        const feed = feeds.find(f => f.url === id);

        if (feed) {
          const processor = new RSSProcessor();
          await processor._processFeed(feed, new AbortController().signal, { successful: 0, failed: 0, cacheHits: 0 });
        }
      } else if (type === 'live') {
        const feeds = safeJSONParse(localStorage.getItem(LS_KEYS.LIVE) || '[]', []);
        const feed = feeds.find(f => extractChannelId(f.url) === id);

        if (feed) {
          const processor = new LiveProcessor();
          await processor._processFeed(feed, new AbortController().signal, { successful: 0, failed: 0, cacheHits: 0 }, { apiQuotaExceeded: false });
        }
      }

      this.refresh();
      showNotification('✅ Item retried successfully', 'success');

    } catch (error) {
      console.error('Failed to retry item:', error);
      showNotification('❌ Failed to retry item', 'error');
    }
  }

  /**
   * Remove a single item from retry queue
   */
  removeSingleItem(id, type) {
    if (type === 'rss') {
      rssRetryManager.recordSuccess(id);
    } else if (type === 'live') {
      liveRetryManager.recordSuccess(id);
    }

    this.refresh();
    showNotification('✅ Item removed from retry queue', 'success');
  }

  /**
   * Clear all failed items
   */
  clearFailedItems() {
    if (!confirm('Are you sure you want to clear all failed items? This cannot be undone.')) {
      return;
    }

    const rssCleared = rssRetryManager.cleanup(60 * 60 * 1000);
    const liveCleared = liveRetryManager.cleanup(60 * 60 * 1000);

    this.refresh();
    showNotification(`✅ Cleared ${rssCleared + liveCleared} failed items`, 'success');
  }

  /**
   * Force a retry check
   */
  forceRetryCheck() {
    checkAndProcessRetries();
    this.refresh();
    showNotification('🔁 Force checking retries...', 'info');
  }

  /**
   * Start auto-refresh interval
   */
  startAutoRefresh() {
    this.stopAutoRefresh();

    this.updateCheckInterval = setInterval(() => {
      if (this.isOpen) {
        this.refresh();
      }
    }, 10000);
  }

  /**
   * Stop auto-refresh interval
   */
  stopAutoRefresh() {
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
      this.updateCheckInterval = null;
    }
  }

  /**
   * Switch between tabs
   */
  switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.remove('active');
      if (btn.dataset.tab === tab) {
        btn.classList.add('active');
      }
    });

    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.remove('active');
      if (content.id === `${tab}Tab`) {
        content.classList.add('active');
      }
    });
  }

  /**
   * Show manual add modal
   */
  showManualAddModal() {
    const modal = document.getElementById('manualAddModal');
    modal.style.display = 'block';

    // Populate existing items with default type
    const initialType = document.getElementById('retryTypeSelectExisting').value;
    this.populateExistingItems(initialType);
    
    setTimeout(() => {
      document.getElementById('existingSearch').focus();
    }, 100);
  }

  /**
   * Hide manual add modal
   */
  hideManualAddModal() {
    const modal = document.getElementById('manualAddModal');
    modal.style.display = 'none';
    
    document.getElementById('existingSearch').value = '';
    document.getElementById('existingItemsSelect').innerHTML = '';
    document.getElementById('manualRetryReason').value = '';
    this.clearSelectedPreview();
  }


}

// ============================================
// UI Integration Functions
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

/**
 * Add context menu option to channel items for manual retry
 */
function addRetryContextMenu() {
  document.addEventListener('contextmenu', (e) => {
    const channelItem = e.target.closest('.channel-item');
    if (!channelItem) return;

    e.preventDefault();

    const channelData = {
      url: channelItem.dataset.url,
      name: channelItem.dataset.name,
      isLive: channelItem.dataset.isLive === 'true'
    };

    const isYouTube = channelData.url.includes('youtube.com') || channelData.url.includes('youtu.be');

    if (isYouTube) {
      const videoId = extractYouTubeID(channelData.url);
      if (videoId) {
        showContextMenu(e, channelData, videoId);
      }
    }
  }, true);
}

/**
 * Show context menu for channel retry options
 */
function showContextMenu(e, channelData, videoId) {
  const existing = document.getElementById('retryContextMenu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.id = 'retryContextMenu';
  menu.className = 'context-menu';
  menu.style.cssText = `
    position: fixed;
    top: ${e.clientY}px;
    left: ${e.clientX}px;
    background: #2d2d2d;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    z-index: 10000;
    min-width: 220px;
    border: 1px solid #444;
  `;

  const isYouTube = channelData.url.includes('youtube.com') || 
                    channelData.url.includes('youtu.be');
  const type = isYouTube ? 'live' : 'rss';

  menu.innerHTML = `
    <div class="context-menu-header">
      <strong>${channelData.name}</strong>
      <small>(${type.toUpperCase()})</small>
    </div>
    <div class="context-menu-item" data-action="quick-retry">
      <i class="fas fa-redo"></i> Quick Add to Retry Queue
    </div>
    <div class="context-menu-item" data-action="open-manager">
      <i class="fas fa-external-link-alt"></i> Open Update Manager
    </div>
    <div class="context-menu-divider"></div>
    <div class="context-menu-item" data-action="copy-url">
      <i class="fas fa-copy"></i> Copy URL
    </div>
    ${isYouTube ? `
      <div class="context-menu-item" data-action="copy-id">
        <i class="fas fa-id-card"></i> Copy Channel ID
      </div>
    ` : ''}
  `;

  document.body.appendChild(menu);

  menu.addEventListener('click', (menuEvent) => {
    const action = menuEvent.target.closest('[data-action]')?.dataset.action;

    if (action === 'quick-retry') {
      updateManager.quickAddFromChannel(channelData);
    } else if (action === 'open-manager') {
      updateManager.open();
      updateManager.switchTab('manual');
    } else if (action === 'copy-url') {
      navigator.clipboard.writeText(channelData.url);
      showNotification('✅ URL copied to clipboard', 'success');
    } else if (action === 'copy-id' && isYouTube) {
      const channelId = extractChannelId(channelData.url);
      if (channelId) {
        navigator.clipboard.writeText(channelId);
        showNotification('✅ Channel ID copied to clipboard', 'success');
      }
    }

    menu.remove();
  });

  setTimeout(() => {
    const closeHandler = (clickEvent) => {
      if (!menu.contains(clickEvent.target)) {
        menu.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    document.addEventListener('click', closeHandler);
  }, 100);
}

/**
 * Add quick retry buttons to channel items
 */
function addQuickRetryButtons() {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1 && node.classList && node.classList.contains('channel-item')) {
          addQuickRetryButton(node);
        }
      });
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  document.querySelectorAll('.channel-item').forEach(addQuickRetryButton);
}

/**
 * Add quick retry button to a channel item
 */
function addQuickRetryButton(item) {
  if (item.querySelector('.quick-retry-btn')) return;

  const channelData = {
    url: item.dataset.url || '',
    name: item.dataset.name || 'Unknown',
    isLive: item.dataset.isLive === 'true',
    category: item.dataset.category || 'Unknown'
  };

  const isYouTube = channelData.url.includes('youtube.com') || 
                    channelData.url.includes('youtu.be');
  const type = isYouTube ? 'live' : 'rss';

  if ((type === 'live' && extractChannelId(channelData.url)) || type === 'rss') {
    const button = document.createElement('button');
    button.className = 'quick-retry-btn';
    button.title = `Add ${channelData.name} to retry queue`;
    button.innerHTML = '<i class="fas fa-redo"></i>';
    
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      
      const identifier = type === 'live' ? 
        extractChannelId(channelData.url) : channelData.url;
      
      const retryManager = type === 'rss' ? rssRetryManager : liveRetryManager;
      
      if (retryManager.existsInQueue(identifier)) {
        showNotification('⚠️ This item is already in the retry queue', 'warning');
        return;
      }
      
      const success = retryManager.addManually(identifier, channelData.name, {
        reason: 'Quick add from channel item',
        user: 'quick_button'
      });
      
      if (success) {
        showNotification(`✅ Added "${channelData.name}" to retry queue`, 'success');
        
        button.innerHTML = '<i class="fas fa-check"></i>';
        button.style.background = '#4CAF50';
        
        setTimeout(() => {
          button.innerHTML = '<i class="fas fa-redo"></i>';
          button.style.background = '';
        }, 2000);
        
        if (!updateManager.isOpen) {
          updateManager.open();
          updateManager.switchTab('manual');
        }
      }
    });
    
    item.appendChild(button);
  }
}


// ============================================
// Initialize Update Manager
// ============================================

// Create global instances
const rssRetryManager = new EnhancedRetryManager("rss_retry_queue", RETRY_CONFIG.RSS);
const liveRetryManager = new EnhancedRetryManager("live_retry_queue", RETRY_CONFIG.LIVE);
const updateManager = new UpdateManagerModal();

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  addUpdateManagerButton();
  //addRetryContextMenu();
  //addQuickRetryButtons();
});

// Export for use in final.js
window.UpdateManager = {
  rssRetryManager,
  liveRetryManager,
  updateManager,
  addChannelToRetryQueue,
  showContextMenu
};