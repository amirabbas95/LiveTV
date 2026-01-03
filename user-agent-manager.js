// ============================================
// USER AGENT OVERRIDE MANAGER
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