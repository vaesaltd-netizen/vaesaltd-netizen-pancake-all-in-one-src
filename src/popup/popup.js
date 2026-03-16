// popup/popup.js - Settings popup logic (Trust Blue Design)
// Updated for v3.1.0 - License Key Management

// AI Mode Presets Configuration
const AI_PRESETS = {
  precise: {
    temperature: 0.2,
    top_p: 0.75,
    presence_penalty: 0.5,
    frequency_penalty: 0.5
  },
  balanced: {
    temperature: 0.5,
    top_p: 0.85,
    presence_penalty: 0.2,
    frequency_penalty: 0.3
  },
  creative: {
    temperature: 0.8,
    top_p: 0.9,
    presence_penalty: 0.1,
    frequency_penalty: 0.1
  }
};

// Default params (= precise)
const DEFAULT_AI_PARAMS = AI_PRESETS.precise;

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

  // Other elements
  const cacheCountSpan = document.getElementById('cacheCount');
  const clearCacheBtn = document.getElementById('clearCache');
  const systemPromptInput = document.getElementById('systemPrompt');
  const savePromptBtn = document.getElementById('savePrompt');
  const promptStatusDiv = document.getElementById('promptStatus');

  // AI Settings elements
  const responseLengthSelect = document.getElementById('responseLength');
  const translateModelSelect = document.getElementById('translateModel');
  const replyModelSelect = document.getElementById('replyModel');
  const expandModelSelect = document.getElementById('expandModel');
  const saveSettingsBtn = document.getElementById('saveSettings');
  const settingsStatusDiv = document.getElementById('settingsStatus');

  // Load saved settings
  await loadSettings();
  await loadLicenseStatus();

  // ==================== License Key Handlers ====================

  // Format license key as user types (auto-add dashes)
  licenseKeyInput.addEventListener('input', (e) => {
    let value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');

    // Remove existing dashes for reformatting
    const cleanValue = value.replace(/-/g, '');

    // Auto-add dashes at correct positions: VEASA-XXX-XXX
    if (cleanValue.length > 5) {
      value = cleanValue.slice(0, 5) + '-' + cleanValue.slice(5);
    }
    if (cleanValue.length > 8) {
      value = cleanValue.slice(0, 5) + '-' + cleanValue.slice(5, 8) + '-' + cleanValue.slice(8, 11);
    }

    e.target.value = value;
  });

  // Validate license button
  validateLicenseBtn.addEventListener('click', async () => {
    const license = licenseKeyInput.value.trim().toUpperCase();

    if (!license) {
      showLicenseStatus('Vui long nhap License Key', 'error');
      return;
    }

    if (!/^VEASA-[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(license)) {
      showLicenseStatus('Dinh dang: VEASA-XXX-XXX', 'error');
      return;
    }

    validateLicenseBtn.disabled = true;
    showLicenseStatus('Dang xac thuc...', 'loading');

    try {
      const validationResult = await validateLicenseWithServer(license);

      if (validationResult.valid) {
        showLicenseStatus('Xac thuc thanh cong!', 'success');
        await loadLicenseStatus();
      } else {
        showLicenseStatus(validationResult.error || 'License khong hop le', 'error');
      }
    } catch (e) {
      showLicenseStatus(`Loi: ${e.message}`, 'error');
    } finally {
      validateLicenseBtn.disabled = false;
    }
  });

  // Refresh license button
  refreshLicenseBtn.addEventListener('click', async () => {
    refreshLicenseBtn.disabled = true;
    showLicenseStatus('Dang lam moi...', 'loading');

    try {
      const result = await chrome.storage.local.get(['pitLicenseCache']);

      if (!result.pitLicenseCache?.licenseKey) {
        showLicenseStatus('Chua co License Key', 'error');
        return;
      }

      const validationResult = await validateLicenseWithServer(result.pitLicenseCache.licenseKey);

      if (validationResult.valid) {
        showLicenseStatus('Da lam moi thanh cong!', 'success');
        await loadLicenseStatus();
      } else {
        showLicenseStatus(validationResult.error || 'Lam moi that bai', 'error');
      }
    } catch (e) {
      showLicenseStatus(`Loi: ${e.message}`, 'error');
    } finally {
      refreshLicenseBtn.disabled = false;
    }
  });

  // Change license button
  changeLicenseBtn.addEventListener('click', async () => {
    // Clear current license
    await chrome.storage.local.remove(['pitLicenseCache']);

    // Show input row
    licenseInputRow.style.display = 'block';
    licenseStatusRow.style.display = 'none';
    licenseKeyInput.value = '';
    licenseKeyInput.focus();
    showLicenseStatus('', '');
  });

  // ==================== Cache Handlers ====================

  // Clear cache - clears both L1 (storage) and L2 (IndexedDB)
  clearCacheBtn.addEventListener('click', async () => {
    // Clear legacy storage cache
    await chrome.storage.local.remove('pitTranslationCache');

    // Clear IndexedDB L2 cache
    try {
      const deleteRequest = indexedDB.deleteDatabase('PancakeTranslatorCache');
      deleteRequest.onsuccess = () => {
        console.log('IndexedDB cache cleared');
      };
      deleteRequest.onerror = () => {
        console.warn('Failed to clear IndexedDB cache');
      };
    } catch (e) {
      console.warn('IndexedDB clear error:', e);
    }

    cacheCountSpan.textContent = '0';
    showSettingsStatus('Da xoa toan bo cache (L1 + L2)', 'success');
  });

  // ==================== System Prompt Handlers ====================

  savePromptBtn.addEventListener('click', async () => {
    const prompt = systemPromptInput.value.trim();
    await chrome.storage.local.set({ pitSystemPrompt: prompt });
    showPromptStatus('Da luu System Prompt!', 'success');
  });

  // ==================== AI Settings Handlers ====================

  saveSettingsBtn.addEventListener('click', async () => {
    const responseLength = responseLengthSelect.value;
    const translateModel = translateModelSelect.value;
    const replyModel = replyModelSelect.value;
    const expandModel = expandModelSelect.value;
    await chrome.storage.local.set({
      pitResponseLength: responseLength,
      pitTranslateModel: translateModel,
      pitReplyModel: replyModel,
      pitExpandModel: expandModel
    });
    showSettingsStatus('Da luu cai dat!', 'success');
  });

  // ==================== AI Mode Section ====================
  const presetBtns = document.querySelectorAll('.preset-btn');
  const temperatureSlider = document.getElementById('temperature');
  const topPSlider = document.getElementById('topP');
  const presencePenaltySlider = document.getElementById('presencePenalty');
  const frequencyPenaltySlider = document.getElementById('frequencyPenalty');
  const tempValueSpan = document.getElementById('tempValue');
  const topPValueSpan = document.getElementById('topPValue');
  const presenceValueSpan = document.getElementById('presenceValue');
  const frequencyValueSpan = document.getElementById('frequencyValue');
  const customModeHint = document.getElementById('customModeHint');
  const saveAiModeBtn = document.getElementById('saveAiMode');
  const aiModeStatusDiv = document.getElementById('aiModeStatus');

  // Load AI params on startup
  loadAiParams();

  // Preset button click handlers
  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset;
      applyPreset(preset);
    });
  });

  // Slider change handlers
  temperatureSlider.addEventListener('input', () => {
    tempValueSpan.textContent = temperatureSlider.value;
    checkIfCustomMode();
  });

  topPSlider.addEventListener('input', () => {
    topPValueSpan.textContent = topPSlider.value;
    checkIfCustomMode();
  });

  presencePenaltySlider.addEventListener('input', () => {
    presenceValueSpan.textContent = presencePenaltySlider.value;
    checkIfCustomMode();
  });

  frequencyPenaltySlider.addEventListener('input', () => {
    frequencyValueSpan.textContent = frequencyPenaltySlider.value;
    checkIfCustomMode();
  });

  // Save AI Mode button
  saveAiModeBtn.addEventListener('click', async () => {
    const params = {
      temperature: parseFloat(temperatureSlider.value),
      top_p: parseFloat(topPSlider.value),
      presence_penalty: parseFloat(presencePenaltySlider.value),
      frequency_penalty: parseFloat(frequencyPenaltySlider.value)
    };
    await chrome.storage.local.set({ pitAiParams: params });
    showAiModeStatus('Da luu che do AI!', 'success');
  });

  // ==================== Helper Functions ====================

  async function loadLicenseStatus() {
    try {
      const result = await chrome.storage.local.get(['pitLicenseCache']);
      const cache = result.pitLicenseCache;

      if (cache && cache.expiresAt > Date.now()) {
        // Show active status
        licenseInputRow.style.display = 'none';
        licenseStatusRow.style.display = 'block';

        licenseUserName.textContent = cache.userName || '-';
        licenseGroupName.textContent = cache.groupName || '-';

        // Calculate remaining time
        const remainingMs = cache.expiresAt - Date.now();
        const hours = Math.floor(remainingMs / (60 * 60 * 1000));
        const minutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
        licenseRemaining.textContent = `${hours}h ${minutes}m`;

      } else if (cache && cache.licenseKey) {
        // License expired but exists - show input with pre-filled value
        licenseInputRow.style.display = 'block';
        licenseStatusRow.style.display = 'none';
        licenseKeyInput.value = cache.licenseKey;
        showLicenseStatus('License het han, vui long lam moi', 'error');
      } else {
        // No license - show input form
        licenseInputRow.style.display = 'block';
        licenseStatusRow.style.display = 'none';
      }
    } catch (e) {
      console.error('Failed to load license status:', e);
    }
  }

  // Hardcoded Apps Script URL - VEASA production
  const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzOTIWRx2wQhXS1aA3wT90Sg-OsgCbzoZqXhBCqXLq2vdJVRVmyhepGI9Obm-SMH08nrw/exec';

  async function validateLicenseWithServer(license) {
    const url = `${APPS_SCRIPT_URL}?action=validate&license=${encodeURIComponent(license)}`;

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

    if (data.valid) {
      // Save to storage
      await chrome.storage.local.set({
        pitLicenseCache: {
          licenseKey: license,
          apiKey: data.apiKey,
          userName: data.userName,
          groupName: data.groupName,
          expiresAt: data.expiresAt
        }
      });
    }

    return data;
  }

  function showLicenseStatus(message, type) {
    licenseStatusDiv.textContent = message;
    licenseStatusDiv.className = 'status ' + (type || '');

    if (type !== 'loading' && type !== 'error' && message) {
      setTimeout(() => {
        licenseStatusDiv.textContent = '';
        licenseStatusDiv.className = 'status';
      }, 3000);
    }
  }

  async function loadAiParams() {
    const result = await chrome.storage.local.get(['pitAiParams']);
    const params = result.pitAiParams || DEFAULT_AI_PARAMS;

    // Set slider values
    temperatureSlider.value = params.temperature;
    topPSlider.value = params.top_p;
    presencePenaltySlider.value = params.presence_penalty;
    frequencyPenaltySlider.value = params.frequency_penalty;

    // Update display values
    tempValueSpan.textContent = params.temperature;
    topPValueSpan.textContent = params.top_p;
    presenceValueSpan.textContent = params.presence_penalty;
    frequencyValueSpan.textContent = params.frequency_penalty;

    // Determine which preset is active
    updateActivePreset();
  }

  function applyPreset(presetName) {
    const preset = AI_PRESETS[presetName];
    if (!preset) return;

    // Update sliders
    temperatureSlider.value = preset.temperature;
    topPSlider.value = preset.top_p;
    presencePenaltySlider.value = preset.presence_penalty;
    frequencyPenaltySlider.value = preset.frequency_penalty;

    // Update display values
    tempValueSpan.textContent = preset.temperature;
    topPValueSpan.textContent = preset.top_p;
    presenceValueSpan.textContent = preset.presence_penalty;
    frequencyValueSpan.textContent = preset.frequency_penalty;

    // Update active button
    presetBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.preset === presetName);
    });

    // Hide custom hint
    customModeHint.style.display = 'none';
  }

  function checkIfCustomMode() {
    const currentParams = {
      temperature: parseFloat(temperatureSlider.value),
      top_p: parseFloat(topPSlider.value),
      presence_penalty: parseFloat(presencePenaltySlider.value),
      frequency_penalty: parseFloat(frequencyPenaltySlider.value)
    };

    let matchedPreset = null;
    for (const [name, preset] of Object.entries(AI_PRESETS)) {
      if (paramsMatch(currentParams, preset)) {
        matchedPreset = name;
        break;
      }
    }

    presetBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.preset === matchedPreset);
    });

    customModeHint.style.display = matchedPreset ? 'none' : 'block';
  }

  function updateActivePreset() {
    const currentParams = {
      temperature: parseFloat(temperatureSlider.value),
      top_p: parseFloat(topPSlider.value),
      presence_penalty: parseFloat(presencePenaltySlider.value),
      frequency_penalty: parseFloat(frequencyPenaltySlider.value)
    };

    let matchedPreset = null;
    for (const [name, preset] of Object.entries(AI_PRESETS)) {
      if (paramsMatch(currentParams, preset)) {
        matchedPreset = name;
        break;
      }
    }

    presetBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.preset === matchedPreset);
    });

    customModeHint.style.display = matchedPreset ? 'none' : 'block';
  }

  function paramsMatch(a, b) {
    const tolerance = 0.001;
    return Math.abs(a.temperature - b.temperature) < tolerance &&
           Math.abs(a.top_p - b.top_p) < tolerance &&
           Math.abs(a.presence_penalty - b.presence_penalty) < tolerance &&
           Math.abs(a.frequency_penalty - b.frequency_penalty) < tolerance;
  }

  function showAiModeStatus(message, type) {
    aiModeStatusDiv.textContent = message;
    aiModeStatusDiv.className = 'status ' + (type || '');
    setTimeout(() => {
      aiModeStatusDiv.textContent = '';
      aiModeStatusDiv.className = 'status';
    }, 3000);
  }

  function showPromptStatus(message, type) {
    promptStatusDiv.textContent = message;
    promptStatusDiv.className = 'status ' + (type || '');
    setTimeout(() => {
      promptStatusDiv.textContent = '';
      promptStatusDiv.className = 'status';
    }, 3000);
  }

  function showSettingsStatus(message, type) {
    settingsStatusDiv.textContent = message;
    settingsStatusDiv.className = 'status ' + (type || '');
    setTimeout(() => {
      settingsStatusDiv.textContent = '';
      settingsStatusDiv.className = 'status';
    }, 3000);
  }

  // Load settings from storage
  async function loadSettings() {
    try {
      const result = await chrome.storage.local.get([
        'pitTranslationCache',
        'pitSystemPrompt',
        'pitResponseLength',
        'pitTranslateModel',
        'pitReplyModel',
        'pitExpandModel'
      ]);

      // Load system prompt
      if (result.pitSystemPrompt) {
        systemPromptInput.value = result.pitSystemPrompt;
      }

      // Load AI settings
      if (result.pitResponseLength) {
        responseLengthSelect.value = result.pitResponseLength;
      }
      if (result.pitTranslateModel) {
        translateModelSelect.value = result.pitTranslateModel;
      }
      if (result.pitReplyModel) {
        replyModelSelect.value = result.pitReplyModel;
      }
      if (result.pitExpandModel) {
        expandModelSelect.value = result.pitExpandModel;
      }

      // Count caches (L1 from storage + L2 from IndexedDB)
      let totalCacheCount = 0;

      // L1 cache (legacy storage)
      if (result.pitTranslationCache) {
        totalCacheCount += Object.keys(result.pitTranslationCache).length;
      }

      // L2 cache (IndexedDB)
      try {
        const l2Count = await getIndexedDBCacheCount();
        totalCacheCount += l2Count;
      } catch (e) {
        console.warn('Failed to count IndexedDB cache:', e);
      }

      cacheCountSpan.textContent = totalCacheCount;

    } catch (e) {
      console.error('Failed to load settings:', e);
    }
  }

  // Get IndexedDB cache count
  async function getIndexedDBCacheCount() {
    return new Promise((resolve) => {
      try {
        const request = indexedDB.open('PancakeTranslatorCache', 1);

        request.onerror = () => resolve(0);

        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('translations')) {
            db.close();
            resolve(0);
            return;
          }

          try {
            const transaction = db.transaction(['translations'], 'readonly');
            const store = transaction.objectStore('translations');
            const countRequest = store.count();

            countRequest.onsuccess = () => {
              db.close();
              resolve(countRequest.result);
            };

            countRequest.onerror = () => {
              db.close();
              resolve(0);
            };
          } catch (e) {
            db.close();
            resolve(0);
          }
        };

        request.onupgradeneeded = () => {
          resolve(0);
        };
      } catch (e) {
        resolve(0);
      }
    });
  }
});
