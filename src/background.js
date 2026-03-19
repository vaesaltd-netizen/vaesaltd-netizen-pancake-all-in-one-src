/**
 * Pancake All-in-One Extension - Background Service Worker
 * Handles API calls for CRM, Translator, and Auto Inbox
 */

// Import unified license service
importScripts('shared/license.js');

// Configuration
const CONFIG = {
  // Google Sheet API for ads mapping
  SHEET_API_URL: 'https://script.google.com/macros/s/AKfycbw3zvxoVF_76VlCDBJnAlWjDyNNrTr9XkA3DqcoWOdyPbULSx0rAVh1mVBJvBdILuM/exec',
  // CRM API for sending customer data
  CRM_API_URL: 'https://vaesa.soly.com.vn/duongdankhachhang/5',
  // Cloudflare Worker proxy (API keys stored securely on Worker)
  WORKER_URL: 'https://vaesa-proxy.vaesa-ltd.workers.dev'
};

// Cache for ads mapping - fetched once, used for instant lookup
let adsMapping = null;
let postMapping = null; // post_id → note mapping (from column C)
let adsMappingLoading = false;

const ADS_CACHE_KEY = 'adsMapping';
const ADS_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 tiếng

async function loadAdsMappingFromStorage() {
  try {
    const result = await chrome.storage.local.get(ADS_CACHE_KEY);
    const cached = result[ADS_CACHE_KEY];
    if (cached && cached.data && (Date.now() - cached.timestamp < ADS_CACHE_TTL)) {
      adsMapping = cached.data.ads || cached.data;
      postMapping = cached.data.posts || null;
      console.log('[Pancake CRM] Ads mapping loaded from local cache:', Object.keys(adsMapping).length, 'entries');
      if (postMapping) console.log('[Pancake CRM] Post mapping loaded from local cache:', Object.keys(postMapping).length, 'entries');
      return true;
    }
  } catch (e) {
    console.error('[Pancake CRM] loadAdsMappingFromStorage error:', e);
  }
  return false;
}

async function saveAdsMappingToStorage(data) {
  try {
    await chrome.storage.local.set({
      [ADS_CACHE_KEY]: { data, timestamp: Date.now() }
    });
    console.log('[Pancake CRM] Ads mapping saved to local cache');
  } catch (e) {
    console.error('[Pancake CRM] saveAdsMappingToStorage error:', e);
  }
}

// Cache for ERP dropdown data
let erpSettingsCache = null;
let erpSettingsLoading = false;

// Cache for Order page dropdown data (warehouses, order types, sources, products)
let orderSettingsCache = null;
let orderSettingsLoading = false;

// Cache for combos data from Google Sheet
let combosCache = null;
let combosLoading = false;
const COMBOS_CACHE_KEY = 'combosData';
const COMBOS_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 tiếng

// Cache for content mapping from Google Sheet (VAS code → content codes)
let contentMappingCache = null;
let contentMappingLoading = false;
const CONTENT_CACHE_KEY = 'contentMapping';
const CONTENT_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 tiếng

/**
 * Listen for messages from content script
 */
// Actions that DON'T require license (license management itself)
const LICENSE_FREE_ACTIONS = [
  'VALIDATE_LICENSE', 'CHECK_LICENSE', 'CLEAR_LICENSE', 'GET_LICENSE_STATUS'
];

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Gate-keep: check license for all feature actions
  if (!LICENSE_FREE_ACTIONS.includes(request.action)) {
    chrome.storage.local.get('licenseValid', (data) => {
      if (data.licenseValid !== true) {
        sendResponse({ error: 'License khong hop le. Vui long nhap License Key.', licenseRequired: true });
        return;
      }
      // License valid — process the request
      handleMessage(request, sender, sendResponse);
    });
    return true; // async
  }

  // License-free actions: process directly
  return handleLicenseMessage(request, sender, sendResponse);
});

function handleLicenseMessage(request, sender, sendResponse) {
  if (request.action === 'VALIDATE_LICENSE') {
    validateLicenseWithVPS(request.licenseKey).then(sendResponse);
    return true;
  }
  if (request.action === 'CHECK_LICENSE') {
    getCachedLicense().then(sendResponse);
    return true;
  }
  if (request.action === 'CLEAR_LICENSE') {
    clearLicense().then(() => sendResponse({ success: true }));
    return true;
  }
  if (request.action === 'GET_LICENSE_STATUS') {
    getCachedLicense().then(sendResponse);
    return true;
  }
  return false;
}

function handleMessage(request, sender, sendResponse) {
  if (request.action === 'getSettings') {
    fetchSettings().then(sendResponse);
    return true; // Keep channel open for async response
  }

  if (request.action === 'refreshSettings') {
    erpSettingsCache = null;
    fetchSettings().then(sendResponse);
    return true;
  }

  if (request.action === 'getAdsNote') {
    fetchAdsNote(request.adsId).then(sendResponse);
    return true;
  }

  if (request.action === 'getPostNote') {
    fetchPostNote(request.postId).then(sendResponse);
    return true;
  }

  if (request.action === 'preloadAdsMapping') {
    fetchAllAdsMapping().then(sendResponse);
    return true;
  }

  if (request.action === 'refreshAdsMapping') {
    adsMapping = null;
    postMapping = null;
    chrome.storage.local.remove(ADS_CACHE_KEY);
    fetchAllAdsMapping().then(sendResponse);
    return true;
  }

  if (request.action === 'sendToCRM') {
    sendToCRM(request.payload).then(sendResponse);
    return true;
  }

  if (request.action === 'getOrderSettings') {
    fetchOrderSettings().then(sendResponse);
    return true;
  }

  if (request.action === 'refreshOrderSettings') {
    orderSettingsCache = null;
    fetchOrderSettings().then(sendResponse);
    return true;
  }

  if (request.action === 'sendOrder') {
    sendOrder(request.payload).then(sendResponse);
    return true;
  }

  if (request.action === 'getCombos') {
    fetchCombos().then(sendResponse);
    return true;
  }

  if (request.action === 'refreshCombos') {
    combosCache = null;
    chrome.storage.local.remove(COMBOS_CACHE_KEY);
    fetchCombos().then(sendResponse);
    return true;
  }

  if (request.action === 'getContentMapping') {
    fetchContentMapping().then(sendResponse);
    return true;
  }

  if (request.action === 'refreshContentMapping') {
    contentMappingCache = null;
    chrome.storage.local.remove(CONTENT_CACHE_KEY);
    fetchContentMapping().then(sendResponse);
    return true;
  }

  // ===== AUTO INBOX HANDLERS =====
  if (request.action === 'OPEN_AUTO_INBOX') {
    openAutoInboxPanel(sender.tab);
    sendResponse({ success: true });
    return false;
  }

  if (request.action === 'GET_FB_COOKIE') {
    getFBCookie().then(sendResponse);
    return true;
  }

  if (request.action === 'GET_PAGE_LIST') {
    fetchBusinessInboxPage(request.payload.c_user, sendResponse, (count, isComplete) => {
      if (sender.tab?.id) {
        chrome.tabs.sendMessage(sender.tab.id, {
          action: 'PAGE_LIST_PROGRESS',
          payload: { count, isComplete }
        }).catch(() => {});
      }
    });
    return true;
  }

  if (request.action === 'GET_USER_INBOX') {
    if (!inboxRequestConfig.fb_dtsg) {
      console.log('[AutoInbox] requestConfig empty, loading first...');
      const userId = request.payload.c_user || inboxRequestConfig.c_user;
      if (userId) {
        fetchBusinessInboxPage(userId, function (configResult) {
          if (configResult && configResult.success) {
            fetchUsersInbox(request.payload.page_id, request.payload.before_call || null, sendResponse);
          } else {
            sendResponse({ success: false, error: 'Cannot load Facebook config' });
          }
        });
      } else {
        getFBCookie().then(cookieResult => {
          const cookieUserId = cookieResult && cookieResult.userId;
          if (cookieUserId) {
            fetchBusinessInboxPage(cookieUserId, function (configResult) {
              if (configResult && configResult.success) {
                fetchUsersInbox(request.payload.page_id, request.payload.before_call || null, sendResponse);
              } else {
                sendResponse({ success: false, error: 'Cannot load Facebook config' });
              }
            });
          } else {
            sendResponse({ success: false, error: 'No Facebook session' });
          }
        });
      }
    } else {
      fetchUsersInbox(request.payload.page_id, request.payload.before_call || null, sendResponse);
    }
    return true;
  }

  if (request.action === 'GET_USER_INFO') {
    fetchUserInfo(request.payload.c_user, sendResponse);
    return true;
  }

  if (request.action === 'FETCH_IMAGE_BASE64') {
    fetchImageToBase64(request.url).then(sendResponse);
    return true;
  }

  if (request.action === 'SEND_MESSAGE') {
    sendFBMessage(request.payload).then(sendResponse);
    return true;
  }

  if (request.action === 'UPLOAD_MEDIA') {
    uploadFBMedia(request.payload).then(sendResponse);
    return true;
  }

  if (request.action === 'GET_PANCAKE_SESSION') {
    getPancakeSession().then(sendResponse);
    return true;
  }

  if (request.action === 'PANCAKE_REQUEST') {
    pancakeGet(request.payload).then(sendResponse);
    return true;
  }

  if (request.action === 'PANCAKE_POST') {
    pancakePost(request.payload).then(sendResponse);
    return true;
  }

}

// Preload ads mapping when service worker starts
(async () => {
  const fromCache = await loadAdsMappingFromStorage();
  if (!fromCache) fetchAllAdsMapping();
})();

// Initialize license system on startup
initLicense();

// Handle license auto-refresh alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === LICENSE_CONFIG.REFRESH_ALARM) {
    handleLicenseAlarm();
  }
});

// Auto-inject fab button on Facebook tabs
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url &&
      (tab.url.includes('facebook.com') || tab.url.includes('business.facebook.com'))) {
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['auto-inbox/js/fab-button.js']
    }).catch(() => {}); // Silently ignore errors (e.g. restricted pages)
  }
});

/**
 * Fetch dropdown settings from Vaesa ERP API
 * Fetches: Countries, Companies, UTM Sources, Users
 */
async function fetchSettings() {
  // Return cached data if available
  if (erpSettingsCache) {
    return { success: true, data: erpSettingsCache };
  }

  // Prevent multiple simultaneous fetches
  if (erpSettingsLoading) {
    await new Promise(resolve => {
      const checkInterval = setInterval(() => {
        if (!erpSettingsLoading) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });
    return { success: true, data: erpSettingsCache || {} };
  }

  erpSettingsLoading = true;
  console.log('[Pancake CRM] Fetching settings from ERP API...');

  try {
    // Fetch all 4 dropdown data in parallel
    const [countriesRes, companiesRes, sourcesRes, usersRes] = await Promise.all([
      fetchERPList('/api/vaesa/res_country/list', [], 500),
      fetchERPList('/api/vaesa/congtycon/list', [], 100),
      fetchERPList('/api/vaesa/utm_source/list', [], 500),
      fetchERPList('/api/vaesa/res_users/list', [['active', '=', true]], 500)
    ]);

    // Transform to dropdown format: { id, name }
    erpSettingsCache = {
      countries: countriesRes.map(item => ({ id: item.id, name: item.name })),
      companies: companiesRes.map(item => ({ id: item.id, name: item.name })),
      sources: sourcesRes.map(item => ({ id: item.id, name: item.name })),
      users: usersRes.map(item => ({ id: item.id, name: item.name }))
    };

    console.log('[Pancake CRM] ERP settings loaded:', {
      countries: erpSettingsCache.countries.length,
      companies: erpSettingsCache.companies.length,
      sources: erpSettingsCache.sources.length,
      users: erpSettingsCache.users.length
    });

    return { success: true, data: erpSettingsCache };
  } catch (error) {
    console.error('[Pancake CRM] fetchSettings error:', error);
    return { success: false, error: error.message };
  } finally {
    erpSettingsLoading = false;
  }
}

/**
 * Fetch list from Vaesa ERP API
 * @param {string} endpoint - API endpoint path
 * @param {Array} domain - Odoo domain filter
 * @param {number} limit - Max records to fetch
 */
async function fetchERPList(endpoint, domain = [], limit = 100) {
  // Extract resource name: /api/vaesa/congtycon/list → congtycon
  const resource = endpoint.replace('/api/vaesa/', '').replace('/list', '');
  const response = await fetch(`${CONFIG.WORKER_URL}/api/list/${resource}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      params: { domain, limit, offset: 0 },
      id: Date.now()
    })
  });

  if (!response.ok) {
    throw new Error(`ERP API error: ${response.status}`);
  }

  const data = await response.json();
  return data.result?.items || [];
}

/**
 * Fetch all ads mapping from Google Sheet (batch fetch for performance)
 * Called once, cached in memory for instant lookup
 */
async function fetchAllAdsMapping(forceRefresh = false) {
  // If force refresh, clear all caches
  if (forceRefresh) {
    adsMapping = null;
    await chrome.storage.local.remove(ADS_CACHE_KEY);
    console.log('[Pancake CRM] Ads mapping cache cleared (force refresh)');
  }

  // Return memory cache if available
  if (adsMapping) {
    return { success: true, data: adsMapping };
  }

  // Try load from chrome.storage.local first (only if not force refresh)
  if (!forceRefresh) {
    const fromCache = await loadAdsMappingFromStorage();
    if (fromCache) {
      return { success: true, data: adsMapping };
    }
  }

  // Prevent multiple simultaneous fetches
  if (adsMappingLoading) {
    await new Promise(resolve => {
      const checkInterval = setInterval(() => {
        if (!adsMappingLoading) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });
    return { success: true, data: adsMapping || {} };
  }

  adsMappingLoading = true;
  try {
    const response = await fetch(`${CONFIG.SHEET_API_URL}?action=adsAll`);
    const rawData = await response.json();
    // New format: { ads: { adsId: note }, posts: { postId: note } }
    // Old format fallback: { adsId: note } (flat)
    if (rawData.ads && rawData.posts) {
      adsMapping = rawData.ads;
      postMapping = rawData.posts;
    } else {
      adsMapping = rawData;
      postMapping = {};
    }
    console.log('[Pancake CRM] Ads mapping fetched from sheet:', Object.keys(adsMapping).length, 'entries');
    console.log('[Pancake CRM] Post mapping fetched from sheet:', Object.keys(postMapping).length, 'entries');
    await saveAdsMappingToStorage({ ads: adsMapping, posts: postMapping });
    return { success: true, data: adsMapping };
  } catch (error) {
    console.error('fetchAllAdsMapping error:', error);
    return { success: false, error: error.message, data: {} };
  } finally {
    adsMappingLoading = false;
  }
}

/**
 * Get ads note from cached mapping (instant lookup)
 */
async function fetchAdsNote(adsId) {
  // Ensure mapping is loaded
  if (!adsMapping) {
    await fetchAllAdsMapping();
  }

  const note = adsMapping?.[adsId] || '';
  return { success: true, note };
}

/**
 * Get post note from cached post mapping (instant lookup)
 */
async function fetchPostNote(postId) {
  // Ensure mapping is loaded
  if (!postMapping) {
    await fetchAllAdsMapping();
  }

  const note = postMapping?.[postId] || '';
  return { success: true, note };
}

/**
 * Fetch combos from Google Sheet (cached)
 */
async function fetchCombos() {
  // Memory cache
  if (combosCache) {
    return { success: true, data: combosCache };
  }

  // chrome.storage.local cache
  try {
    const result = await chrome.storage.local.get(COMBOS_CACHE_KEY);
    const cached = result[COMBOS_CACHE_KEY];
    if (cached && cached.data && (Date.now() - cached.timestamp < COMBOS_CACHE_TTL)) {
      combosCache = cached.data;
      console.log('[Pancake CRM] Combos loaded from local cache:', combosCache.length, 'entries');
      return { success: true, data: combosCache };
    }
  } catch (e) {}

  // Prevent multiple simultaneous fetches
  if (combosLoading) {
    await new Promise(resolve => {
      const checkInterval = setInterval(() => {
        if (!combosLoading) { clearInterval(checkInterval); resolve(); }
      }, 100);
    });
    return { success: true, data: combosCache || [] };
  }

  combosLoading = true;
  try {
    const response = await fetch(`${CONFIG.SHEET_API_URL}?action=combos`);
    combosCache = await response.json();
    console.log('[Pancake CRM] Combos fetched from sheet:', combosCache.length, 'entries');
    await chrome.storage.local.set({
      [COMBOS_CACHE_KEY]: { data: combosCache, timestamp: Date.now() }
    });
    return { success: true, data: combosCache };
  } catch (error) {
    console.error('[Pancake CRM] fetchCombos error:', error);
    return { success: false, error: error.message, data: [] };
  } finally {
    combosLoading = false;
  }
}

/**
 * Fetch content mapping from Google Sheet (VAS code → content codes)
 */
async function fetchContentMapping() {
  if (contentMappingCache) {
    return { success: true, data: contentMappingCache };
  }

  try {
    const result = await chrome.storage.local.get(CONTENT_CACHE_KEY);
    const cached = result[CONTENT_CACHE_KEY];
    if (cached && cached.data && (Date.now() - cached.timestamp < CONTENT_CACHE_TTL)) {
      contentMappingCache = cached.data;
      console.log('[Pancake CRM] Content mapping loaded from cache:', Object.keys(contentMappingCache).length, 'entries');
      return { success: true, data: contentMappingCache };
    }
  } catch (e) {}

  if (contentMappingLoading) {
    await new Promise(resolve => {
      const checkInterval = setInterval(() => {
        if (!contentMappingLoading) { clearInterval(checkInterval); resolve(); }
      }, 100);
    });
    return { success: true, data: contentMappingCache || {} };
  }

  contentMappingLoading = true;
  try {
    const response = await fetch(`${CONFIG.SHEET_API_URL}?action=content`);
    contentMappingCache = await response.json();
    console.log('[Pancake CRM] Content mapping fetched:', Object.keys(contentMappingCache).length, 'entries');
    await chrome.storage.local.set({
      [CONTENT_CACHE_KEY]: { data: contentMappingCache, timestamp: Date.now() }
    });
    return { success: true, data: contentMappingCache };
  } catch (error) {
    console.error('[Pancake CRM] fetchContentMapping error:', error);
    return { success: false, error: error.message, data: {} };
  } finally {
    contentMappingLoading = false;
  }
}

/**
 * Extract short error message from CRM response
 * Input: "Tạo thất bại khách hàng. Lỗi: null value in column \"quocgia_id\" of relation... DETAIL: ..."
 * Output: "Thiếu trường: quocgia_id" hoặc short message
 */
function extractShortError(fullError) {
  if (!fullError) return 'Lỗi không xác định';

  const str = String(fullError);

  // Pattern: null value in column "xxx"
  const nullMatch = str.match(/null value in column [\\"]?([^"\\\s]+)[\\"]?/i);
  if (nullMatch) {
    const field = nullMatch[1];
    // Map field names to Vietnamese
    const fieldMap = {
      'quocgia_id': 'Quốc gia',
      'congtycon_id': 'Công ty con',
      'nguonkhachhang_id': 'Nguồn khách hàng',
      'nhanvienkinhdoanh_id': 'Nhân viên kinh doanh',
      'tenkhachhang': 'Tên khách hàng',
      'sodienthoai': 'Số điện thoại'
    };
    const fieldName = fieldMap[field] || field;
    return `Thiếu trường: ${fieldName}`;
  }

  // Pattern: "Lỗi: xxx" - extract just the error part before DETAIL
  const errorMatch = str.match(/Lỗi:\s*([^\\n]+?)(?:\s*DETAIL:|$)/i);
  if (errorMatch) {
    let msg = errorMatch[1].trim();
    // Truncate if too long
    if (msg.length > 80) msg = msg.substring(0, 80) + '...';
    return msg;
  }

  // Truncate long messages
  if (str.length > 100) {
    return str.substring(0, 100) + '...';
  }

  return str;
}

/**
 * Fetch dropdown settings for Order page
 * Fetches: Warehouses, Order Types, Sales Sources, Products
 */
async function fetchOrderSettings() {
  if (orderSettingsCache) {
    return { success: true, data: orderSettingsCache };
  }

  if (orderSettingsLoading) {
    await new Promise(resolve => {
      const checkInterval = setInterval(() => {
        if (!orderSettingsLoading) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });
    return { success: true, data: orderSettingsCache || {} };
  }

  orderSettingsLoading = true;
  console.log('[Pancake CRM] Fetching order settings from ERP API...');

  try {
    const [warehousesRes, orderTypesRes, salesSourcesRes, productsRes] = await Promise.all([
      fetchERPList('/api/vaesa/stock_warehouse/list', [], 100),
      fetchERPList('/api/vaesa/loaidonhang/list', [], 100),
      fetchERPList('/api/vaesa/nguondaily/list', [], 100),
      fetchERPList('/api/vaesa/product_product/list', [['sale_ok', '=', true]], 500)
    ]);

    orderSettingsCache = {
      warehouses: warehousesRes.map(item => ({ id: item.id, name: item.name })),
      orderTypes: orderTypesRes.map(item => ({ id: item.id, name: item.name })),
      salesSources: salesSourcesRes.map(item => ({ id: item.id, name: item.name })),
      products: productsRes.map(item => ({
        id: item.id,
        name: item.name,
        price: item.lst_price || 0
      }))
    };

    console.log('[Pancake CRM] Order settings loaded:', {
      warehouses: orderSettingsCache.warehouses.length,
      orderTypes: orderSettingsCache.orderTypes.length,
      salesSources: orderSettingsCache.salesSources.length,
      products: orderSettingsCache.products.length
    });

    return { success: true, data: orderSettingsCache };
  } catch (error) {
    console.error('[Pancake CRM] fetchOrderSettings error:', error);
    return { success: false, error: error.message };
  } finally {
    orderSettingsLoading = false;
  }
}

/**
 * Send order to VAESA ERP API
 */
async function sendOrder(payload) {
  const orderUrl = `${CONFIG.WORKER_URL}/api/order/create`;
  console.log('[Pancake CRM] Sending order to ERP via Worker:', orderUrl);
  console.log('[Pancake CRM] Order payload:', JSON.stringify(payload, null, 2));

  try {
    const response = await fetch(orderUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    console.log('[Pancake CRM] Order response status:', response.status, response.statusText);

    const responseText = await response.text();
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      responseData = { message: responseText };
    }

    console.log('[Pancake CRM] Order response body:', responseText);

    if (!response.ok) {
      const errorMsg = extractShortError(responseData?.message || responseData?.error || `HTTP ${response.status}`);
      return { success: false, error: errorMsg };
    }

    if (responseData?.success === false || responseData?.success === 'false') {
      const errorMsg = extractShortError(responseData?.message || responseData?.error || 'Lỗi không xác định');
      return { success: false, error: errorMsg };
    }

    console.log('[Pancake CRM] Order created successfully');
    return { success: true, data: responseData };
  } catch (error) {
    console.error('[Pancake CRM] sendOrder error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send customer data to CRM API
 */
async function sendToCRM(payload) {
  console.log('[Pancake CRM] Sending to CRM:', CONFIG.CRM_API_URL);
  console.log('[Pancake CRM] Payload:', JSON.stringify(payload, null, 2));

  try {
    const response = await fetch(CONFIG.CRM_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    console.log('[Pancake CRM] Response status:', response.status, response.statusText);

    // Parse response body (could be JSON with error message)
    const responseText = await response.text();
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      responseData = { message: responseText };
    }

    console.log('[Pancake CRM] Response body:', responseText);

    if (!response.ok) {
      // Extract detailed error message from API response
      const errorMsg = extractShortError(responseData?.message || responseData?.error || `HTTP ${response.status}`);
      console.error('[Pancake CRM] Error:', errorMsg);
      return { success: false, error: errorMsg };
    }

    // Check if API returns success:false in body (like CRM does)
    if (responseData?.success === false || responseData?.success === 'false') {
      const errorMsg = extractShortError(responseData?.message || responseData?.error || 'Lỗi không xác định');
      console.error('[Pancake CRM] API error:', errorMsg);
      return { success: false, error: errorMsg };
    }

    console.log('[Pancake CRM] Success');
    return { success: true, data: responseData };
  } catch (error) {
    console.error('[Pancake CRM] sendToCRM error:', error);
    return { success: false, error: error.message };
  }
}

// =============================================================================
// AUTO INBOX — Facebook Inbox scanning & bulk messaging
// =============================================================================

const INBOX_BUSINESS_API_URL = 'https://business.facebook.com';
const INBOX_ORIGIN_API_URL = 'https://www.facebook.com';
let inboxRequestConfig = {};

/**
 * Open Auto Inbox side panel by injecting content-inject.js into the active Facebook tab
 */
async function openAutoInboxPanel(senderTab) {
  try {
    // If triggered from a Facebook tab, use that tab
    if (senderTab && senderTab.url && senderTab.url.includes('facebook.com')) {
      await chrome.scripting.executeScript({
        target: { tabId: senderTab.id },
        files: ['auto-inbox/js/content-inject.js']
      });
      return;
    }
    // Otherwise find a Facebook tab or open one
    const tabs = await chrome.tabs.query({ url: ['https://www.facebook.com/*', 'https://*.facebook.com/*'] });
    if (tabs && tabs.length > 0) {
      await chrome.tabs.update(tabs[0].id, { active: true });
      await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        files: ['auto-inbox/js/content-inject.js']
      });
    } else {
      // Open Facebook first
      const newTab = await chrome.tabs.create({ url: 'https://www.facebook.com/' });
      // Wait for page to load before injecting
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === newTab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          chrome.scripting.executeScript({
            target: { tabId: newTab.id },
            files: ['auto-inbox/js/content-inject.js']
          }).catch(err => console.error('[AutoInbox] Inject error:', err));
        }
      });
    }
  } catch (err) {
    console.error('[AutoInbox] openAutoInboxPanel error:', err);
  }
}

/**
 * Get Facebook c_user cookie
 */
async function getFBCookie() {
  try {
    if (chrome.cookies) {
      try {
        const cookie = await chrome.cookies.get({ url: 'https://www.facebook.com', name: 'c_user' });
        if (cookie && cookie.value) {
          return { userId: cookie.value };
        }
      } catch (err) {
        console.log('[AutoInbox] chrome.cookies failed:', err.message);
      }
    }
    try {
      const tabs = await chrome.tabs.query({ url: ['https://www.facebook.com/*', 'https://*.facebook.com/*'] });
      if (tabs && tabs.length > 0) {
        const injectionResults = await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: function () {
            var cookiesString = '; ' + document.cookie;
            var parts = cookiesString.split('; c_user=');
            if (parts.length === 2) {
              return parts.pop().split(';').shift();
            }
            return null;
          }
        });
        var userId = injectionResults && injectionResults[0] && injectionResults[0].result;
        if (userId) {
          return { userId: userId };
        }
      }
    } catch (err) {
      console.log('[AutoInbox] scripting fallback failed:', err.message);
    }
    return { userId: null, error: 'Chưa đăng nhập Facebook hoặc không tìm thấy tab Facebook.' };
  } catch (error) {
    return { userId: null, error: error.message };
  }
}

/**
 * Send Facebook message via /messaging/send
 */
async function sendFBMessage(payload) {
  try {
    const response = await fetch('https://www.facebook.com/messaging/send', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payload.body
    });
    const responseText = await response.text();
    const jsonResponse = JSON.parse(responseText.replace('for (;;);', ''));
    const isSuccess = !jsonResponse.error && !!jsonResponse.payload;
    if (!isSuccess) {
      console.error('[AutoInbox] Send failed:', JSON.stringify(jsonResponse.error || jsonResponse.errorSummary || '').substring(0, 200));
    }
    return { success: isSuccess };
  } catch (error) {
    console.error('[AutoInbox] Send error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Upload media to Facebook
 */
async function uploadFBMedia(payload) {
  try {
    const formData = new FormData();
    if (payload.files && payload.files.length > 0) {
      for (let i = 0; i < payload.files.length; i++) {
        const fileEntry = payload.files[i];
        const binaryString = atob(fileEntry.data);
        const uint8Array = new Uint8Array(binaryString.length);
        for (let j = 0; j < binaryString.length; j++) {
          uint8Array[j] = binaryString.charCodeAt(j);
        }
        const blob = new Blob([uint8Array], { type: fileEntry.type || 'image/jpeg' });
        formData.append('upload_102' + i, blob, fileEntry.name || 'image' + i + '.jpg');
      }
    }
    const response = await fetch(payload.url, { method: 'POST', body: formData });
    const responseText = await response.text();
    let jsonResponse;
    try {
      jsonResponse = JSON.parse(responseText.replace('for (;;);', ''));
    } catch (err) {
      return { success: false, error: 'JSON parse error' };
    }
    if (jsonResponse.error || !jsonResponse.payload || !jsonResponse.payload.metadata) {
      return { success: false, error: jsonResponse.errorSummary || jsonResponse.error || 'Upload failed' };
    }
    const idsMap = {};
    Object.keys(jsonResponse.payload.metadata).forEach(key => {
      const metadata = jsonResponse.payload.metadata[key];
      idsMap[key] = metadata.image_id || metadata.video_id || metadata.file_id || metadata.audio_id || metadata.fbid;
    });
    return { success: Object.keys(idsMap).length > 0, ids: idsMap };
  } catch (error) {
    console.error('[AutoInbox] Upload error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Fetch Facebook business inbox page to extract config (fb_dtsg, tokens, etc.)
 */
function fetchBusinessInboxPage(userId, callback, onProgress) {
  fetch(INBOX_BUSINESS_API_URL + '/latest/inbox/all').then(response => {
    if (!response.ok) throw new Error('Network error');
    return response.text();
  }).then(html => {
    const dtsgMatches = html.match(/DTSGInitialData(.?)+IntlPhonologicalRules/gm);
    const fb_dtsg = dtsgMatches[0].split('"')[4];
    const iframeTokenMatches = html.match(/compat_iframe_token":"(.?)+",/gm);
    const cquick_token = iframeTokenMatches[0].split('"')[2];
    const hsiJson = '{' + html.match(/"hsi":"(.?)+__spin_t":\d+/gm)[0] + '}';
    const hsiData = JSON.parse(hsiJson);
    const queryMatches = html.match(/\\\/ajax\\\/qm\\\/(.*?)"/);
    const queryParams = new URLSearchParams(queryMatches[1]);
    let siteData = html.match(/\["SiteData",\[\],([^\]]+),\d+\]/)[1];
    let lsdData = html.match(/\["LSD",\[\],([^\]]+),\d+\]/)[1];
    let webConnectionData = html.match(/\["WebConnectionClassServerGuess",\[\],([^\]]+),\d+\]/)[1];
    let asyncParamsData = html.match(/\["GetAsyncParamsExtraData",\[\],([^\]]+),\d+\]/)[1];
    siteData = JSON.parse(siteData);
    webConnectionData = JSON.parse(webConnectionData);
    lsdData = JSON.parse(lsdData);
    asyncParamsData = JSON.parse(asyncParamsData);
    inboxRequestConfig = {
      c_user: userId,
      fb_dtsg: fb_dtsg,
      cquick_token: cquick_token,
      cquick: 'jsc_c_' + (Math.floor(6 * Math.random()) + 10).toString(36),
      dpr: siteData.pr,
      jazoest: queryParams.get('jazoest'),
      lsd: lsdData.token,
      usid: _inboxRnd(8) + ':' + _inboxRnd(14) + ':' + Math.floor(Math.random() * 11) + '-' + _inboxRnd(14) + '-RV=6:F=',
      semr_host_bucket: siteData.semr_host_bucket,
      bl_hash_version: siteData.bl_hash_version,
      comet_env: siteData.comet_env,
      compose_bootloads: siteData.compose_bootloads,
      spin: siteData.spin,
      wbloks_env: siteData.wbloks_env,
      __a: +queryParams.get('__a'),
      __comet_req: +queryParams.get('__comet_req'),
      __aaid: asyncParamsData.extra_data.__aaid,
      __ccg: webConnectionData.connectionClass,
      __csr: _inboxRnd(60),
      __dyn: _inboxRnd(44),
      __hs: siteData.haste_session,
      __hsi: siteData.hsi,
      __pc: siteData.pkg_cohort,
      __rev: siteData.server_revision,
      __spin_b: siteData.__spin_b,
      __spin_r: siteData.__spin_r,
      ...hsiData
    };
    fetchPageList(callback, [], null, onProgress);
  }).catch(error => callback({ success: false, error: error.message }));
}

/**
 * Recursively fetch user's Facebook Pages via GraphQL
 */
function fetchPageList(callback, pages, cursor, onProgress) {
  inboxRequestConfig.__req = _inboxReqId();
  const isFirstPage = !cursor;
  const variables = isFirstPage ? { scale: 1 } : { count: 50, cursor: cursor, scale: 1 };
  const docId = isFirstPage ? '7608279105858845' : '29849393258040848';
  const friendlyName = isFirstPage
    ? 'PagesCometLaunchpointUnifiedQueryPagesListRedesignedQuery'
    : 'PagesCometLaunchPointUnifiedQueryPagesListRedesignedUpdatedPagesSectionQuery';
  const params = {
    cquick_token: inboxRequestConfig.cquick_token,
    fb_dtsg: inboxRequestConfig.fb_dtsg,
    cquick: inboxRequestConfig.cquick,
    __ccg: inboxRequestConfig.__ccg,
    dpr: inboxRequestConfig.dpr,
    jazoest: inboxRequestConfig.jazoest,
    __csr: inboxRequestConfig.__csr,
    __beoa: 0,
    __req: inboxRequestConfig.__req,
    __a: inboxRequestConfig.__a,
    ctarget: 'https://www.facebook.com',
    hsi: inboxRequestConfig.__hsi,
    semr_host_bucket: inboxRequestConfig.semr_host_bucket,
    bl_hash_version: inboxRequestConfig.bl_hash_version,
    comet_env: inboxRequestConfig.comet_env,
    wbloks_env: inboxRequestConfig.wbloks_env,
    ef_page: 'BusinessCometBizSuiteInboxAllMessagesRoute',
    compose_bootloads: inboxRequestConfig.compose_bootloads,
    spin: inboxRequestConfig.spin,
    __spin_r: inboxRequestConfig.__spin_r,
    __spin_b: inboxRequestConfig.__spin_b,
    __spin_t: Date.now(),
    __hsi: inboxRequestConfig.__hsi,
    av: inboxRequestConfig.c_user,
    __user: inboxRequestConfig.c_user,
    fb_api_caller_class: 'RelayModern',
    server_timestamps: true,
    fb_api_req_friendly_name: friendlyName,
    variables: JSON.stringify(variables),
    doc_id: docId
  };
  fetch(INBOX_ORIGIN_API_URL + '/api/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: new URLSearchParams(params)
  }).then(response => response.text()).then(responseText => {
    let cleanText = responseText.replace('for (;;);', '');
    let labelIndex = /\s\{"label":"/gm.exec(cleanText);
    let jsonData = labelIndex ? JSON.parse(cleanText.substring(0, labelIndex.index)) : JSON.parse(cleanText);
    const pagesData = jsonData.data?.viewer?.actor?.additional_profiles_with_biz_tools;
    if (pagesData?.edges?.length > 0) {
      pagesData.edges.forEach(edge => {
        const delegatePageId = edge.node.delegate_page_id;
        if (!pages.some(p => p.id === delegatePageId)) {
          pages.push({
            id: delegatePageId,
            name: edge.node.name,
            avatar: edge.node.profile_picture?.uri || ''
          });
        }
      });
      if (onProgress) onProgress(pages.length, !pagesData.page_info?.has_next_page);
      if (pagesData.page_info?.has_next_page && pagesData.page_info?.end_cursor) {
        fetchPageList(callback, pages, pagesData.page_info.end_cursor, onProgress);
      } else {
        callback({ success: true, data: pages, request_config: inboxRequestConfig });
      }
    } else {
      if (pages.length > 0) {
        callback({ success: true, data: pages, request_config: inboxRequestConfig });
      } else {
        callback({ success: false, error: 'No pages found' });
      }
    }
  }).catch(error => {
    if (pages.length > 0) {
      callback({ success: true, data: pages, request_config: inboxRequestConfig });
    } else {
      callback({ success: false, error: error.message });
    }
  });
}

/**
 * Fetch inbox conversations for a Facebook Page
 */
function fetchUsersInbox(pageId, cursor, callback) {
  inboxRequestConfig.__req = _inboxReqId();
  const params = {
    batch_name: 'MessengerGraphQLThreadlistFetcher',
    av: pageId,
    queries: JSON.stringify({
      __q0__: {
        doc_id: '5947328892029037',
        query_params: { limit: 50, before: cursor }
      }
    }),
    cquick_token: inboxRequestConfig.cquick_token,
    fb_dtsg: inboxRequestConfig.fb_dtsg,
    cquick: inboxRequestConfig.cquick,
    __ccg: inboxRequestConfig.__ccg,
    dpr: inboxRequestConfig.dpr,
    jazoest: inboxRequestConfig.jazoest,
    __csr: inboxRequestConfig.__csr,
    __beoa: 0,
    __req: inboxRequestConfig.__req,
    __a: inboxRequestConfig.__a,
    ctarget: 'https://www.facebook.com',
    hsi: inboxRequestConfig.__hsi,
    semr_host_bucket: inboxRequestConfig.semr_host_bucket,
    bl_hash_version: inboxRequestConfig.bl_hash_version,
    comet_env: inboxRequestConfig.comet_env,
    wbloks_env: inboxRequestConfig.wbloks_env,
    ef_page: 'BusinessCometBizSuiteInboxAllMessagesRoute',
    compose_bootloads: inboxRequestConfig.compose_bootloads,
    spin: inboxRequestConfig.spin,
    __spin_r: inboxRequestConfig.__spin_r,
    __spin_b: inboxRequestConfig.__spin_b,
    __spin_t: Math.floor(Date.now() / 1000),
    __hsi: inboxRequestConfig.__hsi
  };
  fetch(INBOX_ORIGIN_API_URL + '/api/graphqlbatch/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: new URLSearchParams(params)
  }).then(response => {
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.text();
  }).then(responseText => {
    if (responseText.includes('"error":') && responseText.includes('"errorSummary"')) {
      const errorSummaryMatch = responseText.match(/"errorSummary":\s*"([^"]+)"/);
      callback({ success: false, error: { errorSummary: errorSummaryMatch ? errorSummaryMatch[1] : 'Unknown error' } });
      return;
    }
    let cleanedResponse = responseText.replace('for (;;);', '').replace(/\{"successful_results":\d+,"error_results":\d+,"skipped_results":\d+\}$/, '').trim();
    try {
      const jsonResponse = JSON.parse(cleanedResponse);
      callback({ success: true, data: jsonResponse });
    } catch (error) {
      callback({ success: false, error: 'JSON parse error: ' + error.message });
    }
  }).catch(error => {
    callback({ success: false, error: error.message });
  });
}

/**
 * Fetch user profile info from Facebook
 */
function fetchUserInfo(userId, callback) {
  fetch(INBOX_ORIGIN_API_URL + '/me').then(response => response.text()).then(html => {
    let userName = 'Tài khoản cá nhân';
    let avatarUrl = 'https://graph.facebook.com/' + userId + '/picture?type=normal';
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch?.[1]) {
      const titleText = titleMatch[1].replace(/ \| Facebook.*$/i, '').trim();
      if (titleText && titleText !== 'Facebook' && !titleText.includes('Đăng nhập')) {
        userName = titleText;
      }
    }
    const actorMatch = html.match(/"actorID":"(\d+)","name":"([^"]+)"/);
    if (actorMatch?.[2]) userName = actorMatch[2];
    const picMatch = html.match(/"profilePicLarge":\{"uri":"([^"]+)"/);
    if (picMatch?.[1]) avatarUrl = picMatch[1].replace(/\\\//g, '/');
    callback({ success: true, data: { id: userId, name: userName, avatar: avatarUrl } });
  }).catch(() => callback({
    success: true,
    data: { id: userId, name: 'Tài khoản cá nhân', avatar: 'https://graph.facebook.com/' + userId + '/picture?type=normal' }
  }));
}

/**
 * Fetch image and convert to base64
 */
async function fetchImageToBase64(url) {
  if (!url?.startsWith('http')) return { success: false };
  try {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok || !response.headers.get('Content-Type')?.includes('image')) return { success: false };
    const blob = await response.blob();
    if (blob.size < 100) return { success: false };
    const reader = new FileReader();
    const base64 = await new Promise((resolve, reject) => {
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    return { success: true, base64, size: blob.size };
  } catch {
    return { success: false };
  }
}

/**
 * Get Pancake session token from cookie
 */
async function getPancakeSession() {
  try {
    if (chrome.cookies) {
      const cookie = await chrome.cookies.get({ url: 'https://pancake.vn', name: 'jwt' });
      if (cookie && cookie.value) return { token: cookie.value };
    }
    return { token: null };
  } catch (e) {
    return { token: null };
  }
}

/**
 * Pancake GET request proxy
 */
async function pancakeGet(payload) {
  try {
    const headers = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
    if (payload.url.includes('pancake.vn') && payload.session_token) {
      headers['Cookie'] = 'jwt=' + payload.session_token;
    }
    const response = await fetch(payload.url, { method: 'GET', headers });
    if (!response.ok) return { error: 'HTTP ' + response.status, data: null };
    const data = await response.json();
    return { error: null, data };
  } catch (e) {
    return { error: e.message, data: null };
  }
}

/**
 * Pancake POST request proxy
 */
async function pancakePost(payload) {
  try {
    const headers = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
    if (payload.url.includes('pancake.vn') && payload.session_token) {
      headers['Cookie'] = 'jwt=' + payload.session_token;
    }
    const response = await fetch(payload.url, { method: 'POST', headers, body: payload.body });
    const data = await response.json();
    return { error: null, data };
  } catch (e) {
    return { error: e.message, data: null };
  }
}

// Auto Inbox helper functions
function _inboxRnd(length) {
  const chars = 'abcdefghijklmnorstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890_';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function _inboxReqId() {
  return '1' + (Math.floor(6 * Math.random()) + 10).toString(36);
}
