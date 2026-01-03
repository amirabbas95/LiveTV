/**
 * Network Status Monitoring System
 * Enhanced, configurable, and AppState-friendly single-file class
 */
export class NetworkMonitor {
    constructor(options = {}, appStateInstance = null) {
        this.appState = appStateInstance; // Explicitly pass appState
        this.config = {
            checkInterval: options.checkInterval || 30000,
            healthCheckTimeout: options.healthCheckTimeout || 5000,
            qualitySamples: options.qualitySamples || 5,
            maxRetries: options.maxRetries || 3,
            autoResumeDelay: options.autoResumeDelay || 1000,
            thresholds: {
                EXCELLENT: (options.thresholds && options.thresholds.EXCELLENT) || 100,
                GOOD: (options.thresholds && options.thresholds.GOOD) || 300,
                FAIR: (options.thresholds && options.thresholds.FAIR) || 600,
                POOR: (options.thresholds && options.thresholds.POOR) || 1000
            },
            ...options
        };

        this.isOnline = navigator.onLine;
        this.latency = 0;
        this.quality = 'unknown';
        this.connectionType = 'unknown';
        this.lastCheck = 0;
        this.checkInterval = null;
        this.statusListeners = new Set();
        this.qualityListeners = new Set();

        this.retryCount = 0;
        this.maxRetries = this.config.maxRetries;

        this.stats = {
            totalChecks: 0,
            successfulChecks: 0,
            failedChecks: 0,
            totalDowntime: 0,
            lastDowntimeStart: null
        };

        this._onOnline = null;
        this._onOffline = null;
        this._onVisibilityChange = null;
        this._onConnectionChange = null;
    }

    /**
     * Initialize network monitoring
     */
    initialize() {
        if (this._initialized) return this;
        this._initialized = true;

        this.setupEventListeners();
        this.startQualityMonitoring();
        this.detectConnectionType();

        if (this.appState) {
            this.appState.set('settings.isOnline', this.isOnline);
            this.appState.set('settings.networkQuality', this.quality);
            this.appState.set('settings.connectionType', this.connectionType);

            if (typeof this.appState.addCleanup === 'function') {
                this._appStateCleanupUnsub = this.appState.addCleanup(() => this.cleanup());
            }
        }

        console.log(`🌐 Network Monitor: ${this.isOnline ? 'Online' : 'Offline'}, Type: ${this.connectionType}`);
        return this;
    }

    /**
     * Setup online/offline event listeners (stores bound handlers for cleanup)
     */
    setupEventListeners() {
        this._onOnline = this.handleOnline.bind(this);
        this._onOffline = this.handleOffline.bind(this);
        this._onVisibilityChange = this.handleVisibilityChange.bind(this);
        this._onConnectionChange = this.handleConnectionChange.bind(this);

        window.addEventListener('online', this._onOnline);
        window.addEventListener('offline', this._onOffline);

        if (navigator.connection) {
            try {
                navigator.connection.addEventListener('change', this._onConnectionChange);
            } catch (e) { }
        }

        document.addEventListener('visibilitychange', this._onVisibilityChange);
    }

    /**
     * Start periodic network quality checks
     */
    startQualityMonitoring() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }

        const intervalMs = this.config.checkInterval || 30000;

        this.checkInterval = setInterval(() => {
            if (this.isOnline) {
                this.checkConnectionQuality();
            }
        }, intervalMs);

        if (this.isOnline) {
            setTimeout(() => this.checkConnectionQuality(), 1000);
        }

        try {
            if (typeof appState?.setIntervalRef === 'function') {
                appState.setIntervalRef('networkMonitor', this.checkInterval);
            }
        } catch (e) { }
    }

    /**
     * Detect connection type using Network Information API
     */
    detectConnectionType() {
        try {
            const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
            if (connection) {
                this.connectionType = connection.effectiveType || connection.type || 'unknown';
            }
        } catch (e) { }
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
            const endpoints = [
                'https://connectivitycheck.gstatic.com/generate_204',
                'https://clients3.google.com/generate_204'
            ];

            const results = await Promise.allSettled(
                endpoints.map(url => this.measureLatency(url))
            );

            const successful = results.filter(r => r.status === 'fulfilled');
            const successRate = successful.length / endpoints.length;

            if (successful.length > 0) {
                const latencies = successful.map(r => r.value);
                this.latency = Math.round(
                    latencies.reduce((a, b) => a + b, 0) / latencies.length
                );

                this.quality = this.determineQuality(this.latency);

                try {
                    appState.set('settings.networkLatency', this.latency);
                    appState.set('settings.networkQuality', this.quality);
                } catch (e) { /* ignore */ }

                this.notifyQualityChange();

                if (this.quality === 'poor') {
                    this.showQualityWarning();
                }

                this.stats.successfulChecks++;
                this.retryCount = 0;
            } else {
                this.stats.failedChecks++;
                this.retryCount++;
                console.warn(`Network checks failed (${this.retryCount}/${this.maxRetries})`);
                if (this.retryCount >= this.maxRetries) {
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
        if (this.isOnline) return;

        this.isOnline = true;
        try { appState.set('settings.isOnline', true); } catch (e) { /* ignore */ }

        if (this.stats.lastDowntimeStart) {
            this.stats.totalDowntime += Date.now() - this.stats.lastDowntimeStart;
            this.stats.lastDowntimeStart = null;
        }

        console.log('🌐 Network: Online');
        showNotification('📶 Network connection restored', 'success');

        this.detectConnectionType();

        this.startQualityMonitoring();

        this.notifyStatusChange();

        this.handleAutoResume();

        setTimeout(() => this.checkConnectionQuality(), 1000);
    }

    /**
     * Handle offline event
     */
    handleOffline(options = {}) {
        if (!this.isOnline && !options.force) return;

        this.isOnline = false;
        appState.set('settings.isOnline', false);
        this.quality = 'offline';
        
        if (this.appState) {
            this.appState.set('settings.isOnline', false);
        }

        if (!this.stats.lastDowntimeStart) {
            this.stats.lastDowntimeStart = Date.now();
        }

        console.log('🌐 Network: Offline');
        if (typeof showNotification === 'function') showNotification('📴 Network connection lost', 'error');

        this.notifyStatusChange();

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
            setTimeout(() => this.checkConnectionQuality(), 1000);
        }
    }

    /**
     * Handle playback interruption on network loss
     */
    handlePlaybackInterruption() {
        const player = channelLoader?.getPlayer?.();
        if (!player) return;

        try {
            if (!player.paused()) {
                player.pause();
                console.log('⏸️ Playback paused due to network loss');
            }
        } catch (error) {
            console.warn('Failed to pause player:', error);
        }

        try {
            if (player.tech_ && player.tech_.vhs && typeof player.tech_.vhs.resetEverything === 'function') {
                player.tech_.vhs.resetEverything();
                console.log('🧹 Cleared video buffers');
            }
        } catch (error) {
        }
    }

    /**
     * Handle auto-resume when network returns
     */
    handleAutoResume() {
        const player = channelLoader?.getPlayer?.();
        const currentChannel = (typeof appState?.get === 'function') ? appState.get('player.currentChannel') : null;

        if (!player || !currentChannel) return;

        if (player && player.paused()) {
            setTimeout(() => {
                if (this.isOnline && player.paused()) {
                    player.play()
                        .then(() => {
                            console.log('▶️ Auto-resumed playback');
                            showNotification('Playback resumed', 'success');
                        })
                        .catch((error) => {
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

        if (this._onOnline) window.removeEventListener('online', this._onOnline);
        if (this._onOffline) window.removeEventListener('offline', this._onOffline);
        if (this._onVisibilityChange) document.removeEventListener('visibilitychange', this._onVisibilityChange);
        if (this._onConnectionChange && navigator.connection) {
            try {
                navigator.connection.removeEventListener('change', this._onConnectionChange);
            } catch (e) { /* ignore */ }
        }

        try {
            if (this._appStateCleanupUnsub) {
                this._appStateCleanupUnsub();
                this._appStateCleanupUnsub = null;
            }
        } catch (e) { /* ignore */ }

        this._onOnline = null;
        this._onOffline = null;
        this._onVisibilityChange = null;
        this._onConnectionChange = null;

        this._initialized = false;
    }
}


// Export for modular usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NetworkMonitor };
} else if (typeof define !== 'undefined' && define.amd) {
    define([], function () { return { NetworkMonitor }; });
} else {
    window.NetworkMonitor = NetworkMonitor;
}