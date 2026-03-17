/**
 * Pancake CRM Extension - Background Service Worker
 * Handles API calls to bypass CORS restrictions
 */

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
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
});

// Preload ads mapping when service worker starts
(async () => {
  const fromCache = await loadAdsMappingFromStorage();
  if (!fromCache) fetchAllAdsMapping();
})();

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
