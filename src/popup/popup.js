// popup/popup.js - Settings popup logic
// v4.0 - Groq + OpenAI dual key, translate-only

document.addEventListener('DOMContentLoaded', async () => {

  // ==================== License Elements ====================
  const licenseKeyInput = document.getElementById('licenseKey');
  const validateLicenseBtn = document.getElementById('validateLicense');
  const refreshLicenseBtn = document.getElementById('refreshLicense');
  const changeLicenseBtn = document.getElementById('changeLicense');
  const licenseInputRow = document.getElementById('license-input-row');
  const licenseStatusRow = document.getElementById('license-status-row');
  const licenseStatusDiv = document.getElementById('licenseStatus');
  const licenseUserName = document.getElementById('license-user-name');
  const licenseGroupName = document.getElementById('license-group-name');
  const licenseRemaining = document.getElementById('license-remaining');

  // ==================== Settings Elements ====================
  const settingsStatusDiv = document.getElementById('settingsStatus');
  const providerSection = document.getElementById('provider-section');
  const activeProviderText = document.getElementById('activeProviderText');

  // ==================== Cache Elements ====================
  const cacheCountSpan = document.getElementById('cacheCount');
  const clearCacheBtn = document.getElementById('clearCache');

  // Load on startup
  await loadLicenseStatus();
  await loadProviderStatus();
  await loadSettings();

  // ==================== License Key Handlers ====================

  licenseKeyInput.addEventListener('input', (e) => {
    let value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
    const cleanValue = value.replace(/-/g, '');
    if (cleanValue.length > 5) {
      value = cleanValue.slice(0, 5) + '-' + cleanValue.slice(5);
    }
    if (cleanValue.length > 8) {
      value = cleanValue.slice(0, 5) + '-' + cleanValue.slice(5, 8) + '-' + cleanValue.slice(8, 11);
    }
    e.target.value = value;
  });

  validateLicenseBtn.addEventListener('click', async () => {
    const license = licenseKeyInput.value.trim().toUpperCase();
    if (!license) { showLicenseStatus('Vui long nhap License Key', 'error'); return; }
    if (!/^VEASA-[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(license)) {
      showLicenseStatus('Dinh dang: VEASA-XXX-XXX', 'error'); return;
    }
    validateLicenseBtn.disabled = true;
    showLicenseStatus('Dang xac thuc...', 'loading');
    try {
      const result = await validateLicenseWithServer(license);
      if (result.valid) {
        showLicenseStatus('Xac thuc thanh cong!', 'success');
        await loadLicenseStatus();
      } else {
        showLicenseStatus(result.error || 'License khong hop le', 'error');
      }
    } catch (e) {
      showLicenseStatus(`Loi: ${e.message}`, 'error');
    } finally {
      validateLicenseBtn.disabled = false;
    }
  });

  refreshLicenseBtn.addEventListener('click', async () => {
    refreshLicenseBtn.disabled = true;
    showLicenseStatus('Dang lam moi...', 'loading');
    try {
      const cache = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'CHECK_LICENSE' }, (response) => {
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve(response);
        });
      });
      if (!cache?.licenseKey) { showLicenseStatus('Chua co License Key', 'error'); return; }
      const result = await validateLicenseWithServer(cache.licenseKey);
      if (result.valid) {
        showLicenseStatus('Da lam moi thanh cong!', 'success');
        await loadLicenseStatus();
      } else {
        showLicenseStatus(result.error || 'Lam moi that bai', 'error');
      }
    } catch (e) {
      showLicenseStatus(`Loi: ${e.message}`, 'error');
    } finally {
      refreshLicenseBtn.disabled = false;
    }
  });

  changeLicenseBtn.addEventListener('click', async () => {
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'CLEAR_LICENSE' }, (response) => {
        if (chrome.runtime.lastError) { resolve(null); return; }
        resolve(response);
      });
    });
    licenseInputRow.style.display = 'block';
    licenseStatusRow.style.display = 'none';
    licenseKeyInput.value = '';
    licenseKeyInput.focus();
    showLicenseStatus('', '');
  });

  // ==================== Cache Handlers ====================

  clearCacheBtn.addEventListener('click', async () => {
    await chrome.storage.local.remove('pitTranslationCache');
    try {
      indexedDB.deleteDatabase('PancakeTranslatorCache');
    } catch (e) {}
    cacheCountSpan.textContent = '0';
    showSettingsStatus('Đã xóa cache!', 'success');
  });

  // ==================== Helper Functions ====================

  async function loadLicenseStatus() {
    try {
      const cache = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'CHECK_LICENSE' }, (response) => {
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve(response);
        });
      });
      if (cache && cache.valid) {
        licenseInputRow.style.display = 'none';
        licenseStatusRow.style.display = 'block';
        licenseUserName.textContent = cache.userName || '-';
        licenseGroupName.textContent = cache.groupName || '-';
        if (cache.expiresAt) {
          const days = Math.floor((new Date(cache.expiresAt) - new Date()) / 86400000);
          licenseRemaining.textContent = days > 30 ? new Date(cache.expiresAt).toLocaleDateString('vi-VN') : days > 0 ? `${days} ngay` : 'Het han';
        } else {
          licenseRemaining.textContent = 'Vinh vien';
        }
      } else if (cache && cache.licenseKey) {
        licenseInputRow.style.display = 'block';
        licenseStatusRow.style.display = 'none';
        licenseKeyInput.value = cache.licenseKey;
        showLicenseStatus('License het han, vui long lam moi', 'error');
      } else {
        licenseInputRow.style.display = 'block';
        licenseStatusRow.style.display = 'none';
      }
    } catch (e) {
      console.error('Failed to load license status:', e);
    }
  }

  async function validateLicenseWithServer(license) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'VALIDATE_LICENSE', licenseKey: license }, (response) => {
        if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
        resolve(response);
      });
    });
  }

  async function loadProviderStatus() {
    const data = await chrome.storage.local.get(['groqApiKey', 'openaiApiKey', 'activeProvider']);
    if (data.groqApiKey || data.openaiApiKey) {
      providerSection.style.display = 'block';
      const provider = data.activeProvider || 'groq';
      activeProviderText.textContent = provider === 'groq' ? '⚡ Đang dùng: Groq' : '🤖 Fallback: OpenAI GPT';
    }
  }

  async function loadSettings() {
    try {
      const result = await chrome.storage.local.get(['pitTranslationCache']);

      // Count cache
      let total = 0;
      if (result.pitTranslationCache) total += Object.keys(result.pitTranslationCache).length;
      try { total += await getIndexedDBCacheCount(); } catch (e) {}
      cacheCountSpan.textContent = total;
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
  }

  async function getIndexedDBCacheCount() {
    return new Promise((resolve) => {
      try {
        const request = indexedDB.open('PancakeTranslatorCache', 1);
        request.onerror = () => resolve(0);
        request.onupgradeneeded = () => resolve(0);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('translations')) { db.close(); resolve(0); return; }
          try {
            const tx = db.transaction(['translations'], 'readonly');
            const store = tx.objectStore('translations');
            const countReq = store.count();
            countReq.onsuccess = () => { db.close(); resolve(countReq.result); };
            countReq.onerror = () => { db.close(); resolve(0); };
          } catch (e) { db.close(); resolve(0); }
        };
      } catch (e) { resolve(0); }
    });
  }

  function showLicenseStatus(message, type) {
    licenseStatusDiv.textContent = message;
    licenseStatusDiv.className = 'status ' + (type || '');
    if (type !== 'loading' && type !== 'error' && message) {
      setTimeout(() => { licenseStatusDiv.textContent = ''; licenseStatusDiv.className = 'status'; }, 3000);
    }
  }

  function showSettingsStatus(message, type) {
    if (!settingsStatusDiv) return;
    settingsStatusDiv.textContent = message;
    settingsStatusDiv.className = 'status ' + (type || '');
    setTimeout(() => { settingsStatusDiv.textContent = ''; settingsStatusDiv.className = 'status'; }, 2000);
  }

  // Auto Inbox button (if exists)
  const openAutoInboxBtn = document.getElementById('openAutoInbox');
  if (openAutoInboxBtn) {
    openAutoInboxBtn.addEventListener('click', async () => {
      chrome.runtime.sendMessage({ action: 'OPEN_AUTO_INBOX' }, () => {
        if (chrome.runtime.lastError) { /* ignore */ }
        window.close();
      });
    });
  }
});
