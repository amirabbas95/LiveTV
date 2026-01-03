/**
 * LRU (Least Recently Used) Cache implementation
 */

class LRUCache {
  constructor(maxSize = 50, maxAge = 3600000, maxBytes = 5 * 1024 * 1024) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.maxAge = maxAge;
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

    if (now - item.timestamp > this.maxAge) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    this.cache.delete(key);
    this.cache.set(key, {
      ...item,
      timestamp: now,
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

    while (this.getTotalSize() + size > this.maxBytes && this.cache.size > 0) {
      this.evictOldest();
    }

    if (size > this.maxBytes) {
      console.warn(`⚠️ Item too large for cache: ${size} bytes`);
      return false;
    }

    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictOldest();
    }

    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    this.cache.set(key, {
      data,
      timestamp: options.timestamp || now,
      accessCount: 0,
      size: this.estimateSize(data)
    });
    return true;
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


if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LRUCache };
} else {
    window.LRUCache = LRUCache;
}