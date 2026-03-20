/**
 * Unified License Service - Pancake All-in-One
 * Validates license against lumiaura.vn VPS API
 * Single license controls all 3 modules: CRM, Translator, Auto Inbox
 *
 * Used by: background.js (service worker)
 * Other modules communicate via chrome.runtime.sendMessage
 */

const LICENSE_CONFIG = {
  API_URL: 'https://lumiaura.vn/api/license/validate',
  CACHE_KEY: 'vaesa_unified_license',
  DEVICE_ID_KEY: 'vaesa_device_id',
  CACHE_DURATION: 4 * 60 * 60 * 1000,  // 4 hours auto-refresh
  MAX_OFFLINE: 24 * 60 * 60 * 1000,    // 24 hours max offline
  LICENSE_PATTERN: /^VEASA-[A-Z0-9]{3}-[A-Z0-9]{3}$/,
  REFRESH_ALARM: 'LICENSE_AUTO_REFRESH'
};

/**
 * Get or create unique device ID for this Chrome profile
 * Persists in chrome.storage.local — one per machine/profile
 */
async function getDeviceId() {
  const result = await chrome.storage.local.get(LICENSE_CONFIG.DEVICE_ID_KEY);
  if (result[LICENSE_CONFIG.DEVICE_ID_KEY]) {
    return result[LICENSE_CONFIG.DEVICE_ID_KEY];
  }

  // Tạo ID ổn định từ Chrome profile (không đổi dù xóa cài lại extension)
  let deviceId;
  try {
    const info = await new Promise((resolve, reject) => {
      chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }, (res) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(res);
      });
    });

    if (info && info.id) {
      // Hash Chrome profile ID → luôn giống nhau cho cùng 1 profile
      const encoder = new TextEncoder();
      const data = encoder.encode('veasa-device-' + info.id);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      deviceId = 'dev-' + hashArray.slice(0, 6).map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (e) {
    console.warn('[License] chrome.identity not available:', e);
  }

  // Fallback nếu Chrome chưa đăng nhập Google
  if (!deviceId) {
    deviceId = 'dev-' + crypto.randomUUID().slice(0, 12);
  }

  await chrome.storage.local.set({ [LICENSE_CONFIG.DEVICE_ID_KEY]: deviceId });
  console.log('[License] Device ID created:', deviceId);
  return deviceId;
}

/**
 * Validate license key with VPS server
 * @param {string} licenseKey - Format: VEASA-XXX-XXX
 * @returns {Promise<{valid: boolean, userName?: string, groupName?: string, expiresAt?: string, error?: string}>}
 */
async function validateLicenseWithVPS(licenseKey) {
  // Format check
  if (!LICENSE_CONFIG.LICENSE_PATTERN.test(licenseKey)) {
    return { valid: false, error: 'Dinh dang License khong hop le (VEASA-XXX-XXX)' };
  }

  try {
    const deviceId = await getDeviceId();
    const response = await fetch(LICENSE_CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey, deviceId })
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const data = await response.json();

    if (data.valid) {
      // Save to cache (including apiKey from server)
      const cache = {
        licenseKey,
        userName: data.userName,
        groupName: data.groupName,
        expiresAt: data.expiresAt,
        apiKey: data.apiKey || null,
        validatedAt: Date.now(),
        cachedAt: Date.now()
      };

      await chrome.storage.local.set({ [LICENSE_CONFIG.CACHE_KEY]: cache });

      // Also keep pitLicenseCache for backward compatibility with translator
      await chrome.storage.local.set({
        pitLicenseCache: {
          licenseKey,
          apiKey: data.apiKey || null,
          userName: data.userName,
          groupName: data.groupName,
          expiresAt: data.expiresAt ? new Date(data.expiresAt).getTime() : (Date.now() + LICENSE_CONFIG.CACHE_DURATION)
        }
      });

      // Setup auto-refresh alarm
      setupLicenseRefreshAlarm();

      // Mark license as valid globally
      await chrome.storage.local.set({ licenseValid: true, licenseError: null });

      console.log('[License] Validated OK:', data.userName);
      return { valid: true, userName: data.userName, groupName: data.groupName, expiresAt: data.expiresAt, apiKey: data.apiKey || null };
    } else {
      // Mark license as INVALID globally + clear cache so getCachedLicense() also returns invalid
      await chrome.storage.local.set({ licenseValid: false, licenseError: data.error || 'License khong hop le' });
      await chrome.storage.local.remove([LICENSE_CONFIG.CACHE_KEY, 'pitLicenseCache']);
      chrome.alarms.clear(LICENSE_CONFIG.REFRESH_ALARM);

      // Broadcast to all tabs: disable all features
      broadcastLicenseInvalid();

      return { valid: false, error: data.error || 'License khong hop le' };
    }

  } catch (e) {
    console.error('[License] Validation error:', e);

    // If offline, check cache
    const cached = await getCachedLicense();
    if (cached && cached.valid) {
      const offlineTime = Date.now() - cached.validatedAt;
      if (offlineTime < LICENSE_CONFIG.MAX_OFFLINE) {
        console.log('[License] Offline, using cache (', Math.round(offlineTime / 3600000), 'h old)');
        return { valid: true, userName: cached.userName, groupName: cached.groupName, expiresAt: cached.expiresAt, fromCache: true };
      }
    }

    // If truly offline and no cache, mark invalid
    await chrome.storage.local.set({ licenseValid: false, licenseError: 'Khong the ket noi server' });
    return { valid: false, error: 'Khong the ket noi server. Vui long kiem tra mang.' };
  }
}

/**
 * Broadcast LICENSE_INVALID to all open tabs — disable all features immediately
 */
async function broadcastLicenseInvalid() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'LICENSE_INVALID' });
      } catch (_) { /* tab may not have content script */ }
    }
    console.log('[License] Broadcast LICENSE_INVALID to all tabs');
  } catch (e) {
    console.error('[License] Broadcast error:', e);
  }
}

/**
 * Get cached license status
 * @returns {Promise<{valid: boolean, licenseKey?: string, userName?: string, groupName?: string, expiresAt?: string, validatedAt?: number}>}
 */
async function getCachedLicense() {
  try {
    const result = await chrome.storage.local.get([LICENSE_CONFIG.CACHE_KEY]);
    const cache = result[LICENSE_CONFIG.CACHE_KEY];

    if (!cache || !cache.licenseKey) {
      return { valid: false, status: 'not_configured' };
    }

    // Check if cache is still fresh (within CACHE_DURATION)
    const cacheAge = Date.now() - (cache.cachedAt || 0);
    const isFresh = cacheAge < LICENSE_CONFIG.CACHE_DURATION;

    // Check if license has expired (server-side expiry)
    const isExpired = cache.expiresAt && new Date(cache.expiresAt).getTime() < Date.now();

    if (isExpired) {
      return { valid: false, status: 'expired', licenseKey: cache.licenseKey, userName: cache.userName };
    }

    return {
      valid: true,
      isFresh,
      licenseKey: cache.licenseKey,
      userName: cache.userName,
      groupName: cache.groupName,
      expiresAt: cache.expiresAt,
      apiKey: cache.apiKey || null,
      validatedAt: cache.validatedAt,
      cachedAt: cache.cachedAt
    };

  } catch (e) {
    console.error('[License] Cache read error:', e);
    return { valid: false, status: 'error' };
  }
}

/**
 * Clear license (logout)
 */
async function clearLicense() {
  await chrome.storage.local.remove([LICENSE_CONFIG.CACHE_KEY, 'pitLicenseCache']);
  await chrome.storage.local.set({ licenseValid: false, licenseError: null });
  chrome.alarms.clear(LICENSE_CONFIG.REFRESH_ALARM);
  broadcastLicenseInvalid();
  console.log('[License] Cleared');
}

/**
 * Auto-refresh license every 4 hours
 */
function setupLicenseRefreshAlarm() {
  chrome.alarms.create(LICENSE_CONFIG.REFRESH_ALARM, {
    periodInMinutes: LICENSE_CONFIG.CACHE_DURATION / 60000  // 240 minutes = 4 hours
  });
}

/**
 * Handle alarm - auto refresh license
 */
async function handleLicenseAlarm() {
  const cached = await getCachedLicense();
  if (cached.licenseKey) {
    console.log('[License] Auto-refreshing...');
    const result = await validateLicenseWithVPS(cached.licenseKey);
    if (!result.valid) {
      console.warn('[License] Auto-refresh: license no longer valid!', result.error);
    }
  }
}

/**
 * Quick check - is license valid right now? (no network call)
 * @returns {Promise<boolean>}
 */
async function isLicenseValid() {
  const cached = await getCachedLicense();
  if (!cached.valid) return false;

  // If cache is stale but within MAX_OFFLINE, still valid
  const cacheAge = Date.now() - (cached.cachedAt || 0);
  return cacheAge < LICENSE_CONFIG.MAX_OFFLINE;
}

/**
 * Init license on extension startup
 * Auto-validates if cache exists
 */
async function initLicense() {
  const cached = await getCachedLicense();

  if (cached.valid && cached.licenseKey) {
    // Mark license as valid in storage
    await chrome.storage.local.set({ licenseValid: true, licenseError: null });

    // If cache is stale, refresh in background
    if (!cached.isFresh) {
      console.log('[License] Cache stale, refreshing...');
      validateLicenseWithVPS(cached.licenseKey); // fire and forget
    }
    // Setup alarm
    setupLicenseRefreshAlarm();
  } else {
    // No valid license
    await chrome.storage.local.set({ licenseValid: false, licenseError: null });
  }

  console.log('[License] Init complete. Status:', cached.valid ? 'active' : 'no license');
}
