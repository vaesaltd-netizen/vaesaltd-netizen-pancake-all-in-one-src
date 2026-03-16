// lib/license-service.js - License Key Management Service
// Validates license with Apps Script backend, caches API key for 24h
// Version: 1.0.0

(function() {
  'use strict';

  const DEBUG = true;
  const log = (...args) => DEBUG && console.log('[LicenseService]', ...args);

  // ==================== Configuration ====================
  const CONFIG = {
    // Hardcoded Apps Script URL - VEASA production
    APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbzOTIWRx2wQhXS1aA3wT90Sg-OsgCbzoZqXhBCqXLq2vdJVRVmyhepGI9Obm-SMH08nrw/exec',
    CACHE_DURATION_MS: 24 * 60 * 60 * 1000, // 24 hours
    LICENSE_PREFIX: 'VEASA-',
    LICENSE_PATTERN: /^VEASA-[A-Z0-9]{3}-[A-Z0-9]{3}$/
  };

  // ==================== License Service Class ====================
  class LicenseService {
    constructor() {
      this.cachedLicense = null;
      this.appsScriptUrl = null;
      this.initialized = false;
    }

    /**
     * Initialize service - load cached license from storage
     */
    async init() {
      if (this.initialized) return;

      // Use hardcoded URL from CONFIG
      this.appsScriptUrl = CONFIG.APPS_SCRIPT_URL;

      try {
        const result = await chrome.storage.local.get(['pitLicenseCache']);

        if (result.pitLicenseCache) {
          this.cachedLicense = result.pitLicenseCache;
          log('Loaded cached license:', this.cachedLicense.userName);
        }

        this.initialized = true;
        log('Initialized with Apps Script URL:', this.appsScriptUrl);
      } catch (e) {
        log('Failed to load license cache:', e);
        this.initialized = true;
      }
    }

    /**
     * Get Apps Script URL (hardcoded)
     */
    getAppsScriptUrl() {
      return this.appsScriptUrl || CONFIG.APPS_SCRIPT_URL;
    }

    /**
     * Check if license format is valid
     */
    isValidFormat(license) {
      return CONFIG.LICENSE_PATTERN.test(license);
    }

    /**
     * Check if cached license is still valid (not expired)
     */
    isCacheValid() {
      if (!this.cachedLicense) return false;
      if (!this.cachedLicense.expiresAt) return false;
      return Date.now() < this.cachedLicense.expiresAt;
    }

    /**
     * Get remaining cache time in milliseconds
     */
    getRemainingCacheTime() {
      if (!this.cachedLicense || !this.cachedLicense.expiresAt) return 0;
      return Math.max(0, this.cachedLicense.expiresAt - Date.now());
    }

    /**
     * Format remaining time as "Xh Ym"
     */
    formatRemainingTime() {
      const remainingMs = this.getRemainingCacheTime();
      if (remainingMs <= 0) return 'Hết hạn';

      const hours = Math.floor(remainingMs / (60 * 60 * 1000));
      const minutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));

      return `${hours}h ${minutes}m`;
    }

    /**
     * Get API key - from cache if valid, otherwise return null
     * Does NOT auto-refresh, caller should handle expired cache
     */
    async getApiKey() {
      await this.init();

      // Return cached if valid
      if (this.isCacheValid() && this.cachedLicense.apiKey) {
        log('Using cached API key (expires:', new Date(this.cachedLicense.expiresAt), ')');
        return this.cachedLicense.apiKey;
      }

      log('No valid cached API key');
      return null;
    }

    /**
     * Get current license status for UI display
     */
    async getStatus() {
      await this.init();

      if (!this.cachedLicense) {
        return {
          status: 'not_configured',
          message: 'Chưa nhập License Key'
        };
      }

      if (!this.isCacheValid()) {
        return {
          status: 'expired',
          message: 'License cần làm mới',
          licenseKey: this.cachedLicense.licenseKey,
          userName: this.cachedLicense.userName,
          groupName: this.cachedLicense.groupName
        };
      }

      return {
        status: 'active',
        userName: this.cachedLicense.userName,
        groupName: this.cachedLicense.groupName,
        licenseKey: this.cachedLicense.licenseKey,
        expiresAt: this.cachedLicense.expiresAt,
        remainingTime: this.formatRemainingTime(),
        message: `Đã kích hoạt: ${this.cachedLicense.userName}`
      };
    }

    /**
     * Validate license with Apps Script server
     */
    async validateLicense(licenseKey) {
      // Check format first
      if (!this.isValidFormat(licenseKey)) {
        return {
          valid: false,
          error: 'Định dạng License không hợp lệ (VEASA-XXX-XXX)'
        };
      }

      // Check if Apps Script URL is configured
      if (!this.appsScriptUrl) {
        return {
          valid: false,
          error: 'Chưa cấu hình Apps Script URL'
        };
      }

      try {
        log('Validating license:', licenseKey);

        const url = `${this.appsScriptUrl}?action=validate&license=${encodeURIComponent(licenseKey)}`;
        log('Calling:', url);

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'application/json'
          }
        });

        if (!response.ok) {
          throw new Error(`Server error: ${response.status}`);
        }

        const data = await response.json();
        log('Server response:', data);

        if (data.valid) {
          // Cache the result
          this.cachedLicense = {
            licenseKey: licenseKey,
            apiKey: data.apiKey,
            userName: data.userName,
            groupName: data.groupName,
            expiresAt: data.expiresAt
          };

          await chrome.storage.local.set({ pitLicenseCache: this.cachedLicense });
          log('License validated and cached:', data.userName);

          return {
            valid: true,
            userName: data.userName,
            groupName: data.groupName,
            apiKey: data.apiKey,
            expiresAt: data.expiresAt
          };
        } else {
          return {
            valid: false,
            error: data.error || 'License không hợp lệ hoặc đã bị vô hiệu hóa'
          };
        }

      } catch (e) {
        log('Validation error:', e);
        return {
          valid: false,
          error: `Lỗi kết nối: ${e.message}`
        };
      }
    }

    /**
     * Force refresh license (manual button click)
     */
    async refreshLicense() {
      if (!this.cachedLicense?.licenseKey) {
        return { valid: false, error: 'Chưa có License Key' };
      }

      log('Force refreshing license...');
      return this.validateLicense(this.cachedLicense.licenseKey);
    }

    /**
     * Clear license (logout / change license)
     */
    async clearLicense() {
      this.cachedLicense = null;
      await chrome.storage.local.remove(['pitLicenseCache']);
      log('License cleared');
    }

    /**
     * Called when OpenAI API returns 401/403 (invalid API key)
     * This invalidates the cache to force re-validation
     */
    async onApiKeyError() {
      log('API key error, invalidating cache...');
      if (this.cachedLicense) {
        this.cachedLicense.expiresAt = 0; // Force expired
        await chrome.storage.local.set({ pitLicenseCache: this.cachedLicense });
      }
    }

    /**
     * Check if license is configured (even if expired)
     */
    hasLicense() {
      return !!this.cachedLicense?.licenseKey;
    }

    /**
     * Get cached license key (masked for display)
     */
    getMaskedLicenseKey() {
      if (!this.cachedLicense?.licenseKey) return '';
      return this.cachedLicense.licenseKey;
    }
  }

  // ==================== Global Instance ====================
  window.licenseService = new LicenseService();

  // Auto-init when loaded
  window.licenseService.init().then(() => {
    log('LicenseService initialized');
  });

})();
