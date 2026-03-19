// lib/license-service.js - License Key Management Service
// Delegates to background unified license service (lumiaura.vn VPS)
// Version: 2.0.0 - Unified License

(function() {
  'use strict';

  const DEBUG = true;
  const log = (...args) => DEBUG && console.log('[LicenseService]', ...args);

  class LicenseService {
    constructor() {
      this.cachedLicense = null;
      this.initialized = false;
    }

    async init() {
      if (this.initialized) return;

      try {
        // Get license status from background
        const cache = await this._sendMessage({ action: 'CHECK_LICENSE' });

        if (cache && cache.valid) {
          this.cachedLicense = {
            licenseKey: cache.licenseKey,
            userName: cache.userName,
            groupName: cache.groupName,
            apiKey: cache.apiKey || null,
            expiresAt: cache.expiresAt ? new Date(cache.expiresAt).getTime() : null
          };
          log('License active:', this.cachedLicense.userName, 'apiKey:', cache.apiKey ? 'YES' : 'NO');
        } else {
          // Fallback: check pitLicenseCache for backward compat
          const result = await chrome.storage.local.get(['pitLicenseCache']);
          if (result.pitLicenseCache) {
            this.cachedLicense = result.pitLicenseCache;
            log('Loaded from pitLicenseCache:', this.cachedLicense.userName);
          }
        }

        this.initialized = true;
      } catch (e) {
        log('Init error:', e);
        this.initialized = true;
      }
    }

    isCacheValid() {
      if (!this.cachedLicense) return false;
      if (this.cachedLicense.expiresAt && Date.now() > this.cachedLicense.expiresAt) return false;
      return true;
    }

    formatRemainingTime() {
      if (!this.cachedLicense?.expiresAt) return 'Vinh vien';
      const remainingMs = this.cachedLicense.expiresAt - Date.now();
      if (remainingMs <= 0) return 'Het han';
      const hours = Math.floor(remainingMs / (60 * 60 * 1000));
      const minutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
      return `${hours}h ${minutes}m`;
    }

    async getApiKey() {
      await this.init();

      // Get apiKey directly from unified license cache
      const cache = await this._sendMessage({ action: 'CHECK_LICENSE' });
      if (cache && cache.valid && cache.apiKey) {
        return cache.apiKey;
      }

      log('No valid API key');
      return null;
    }

    async getStatus() {
      await this.init();

      const cache = await this._sendMessage({ action: 'CHECK_LICENSE' });

      if (!cache || cache.status === 'not_configured') {
        return { status: 'not_configured', message: 'Chua nhap License Key' };
      }

      if (!cache.valid) {
        return {
          status: 'expired',
          message: 'License can lam moi',
          licenseKey: cache.licenseKey,
          userName: cache.userName
        };
      }

      return {
        status: 'active',
        userName: cache.userName,
        groupName: cache.groupName,
        licenseKey: cache.licenseKey,
        expiresAt: cache.expiresAt ? new Date(cache.expiresAt).getTime() : null,
        remainingTime: this.formatRemainingTime(),
        message: `Da kich hoat: ${cache.userName}`
      };
    }

    async validateLicense(licenseKey) {
      return this._sendMessage({ action: 'VALIDATE_LICENSE', licenseKey });
    }

    async refreshLicense() {
      if (!this.cachedLicense?.licenseKey) {
        return { valid: false, error: 'Chua co License Key' };
      }
      return this.validateLicense(this.cachedLicense.licenseKey);
    }

    async clearLicense() {
      this.cachedLicense = null;
      return this._sendMessage({ action: 'CLEAR_LICENSE' });
    }

    async onApiKeyError() {
      log('API key error, clearing cache...');
      if (this.cachedLicense) {
        this.cachedLicense.expiresAt = 0;
      }
      // Force re-validate on next getApiKey
    }

    hasLicense() {
      return !!this.cachedLicense?.licenseKey;
    }

    getMaskedLicenseKey() {
      return this.cachedLicense?.licenseKey || '';
    }

    _sendMessage(msg) {
      return new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage(msg, (response) => {
            if (chrome.runtime.lastError) {
              log('Message error:', chrome.runtime.lastError.message);
              resolve(null);
              return;
            }
            resolve(response);
          });
        } catch (e) {
          log('Send error:', e);
          resolve(null);
        }
      });
    }
  }

  window.licenseService = new LicenseService();
  window.licenseService.init().then(() => {
    log('LicenseService v2 initialized (unified)');
  });

})();
