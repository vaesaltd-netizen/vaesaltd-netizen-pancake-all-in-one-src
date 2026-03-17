/**
 * Pancake CRM Extension - Content Script
 * Injects floating button and popup form into pancake.vn
 * Features: XHR/Fetch interception, draggable button, form auto-fill
 */

(function() {
  'use strict';

  // State - closure-scoped for security (not exposed to window)
  let currentData = {};
  let settingsData = null;
  let reduxData = null; // Data from Redux store (via injected script)
  let lastConversationId = null; // Track conversation changes

  // LocalStorage keys
  const STORAGE_KEY = 'pancake-crm-dropdown-selections';
  const ORDER_STORAGE_KEY = 'pancake-crm-order-selections';

  // Order page settings cache
  let orderSettingsData = null;
  let orderProductOptions = [];

  // F5/page reload → clear all dropdown caches in background so next load fetches fresh data from ERP
  chrome.runtime.sendMessage({ action: 'refreshSettings' });
  chrome.runtime.sendMessage({ action: 'refreshOrderSettings' });

  // Combos data - fetched from Google Sheet (dynamic, no longer hardcoded)
  let COMBOS = [];

  // Content mapping: VAS code → content codes (for manual mode)
  let contentMapping = {};

  // ============================================
  // REDUX DATA EXTRACTION
  // Inject external script to bypass CSP and read from main world's Redux store
  // ============================================

  let injectedScriptReady = false;

  /**
   * Inject the external script into page's main world
   * This bypasses CSP because it's a file, not inline script
   */
  function injectScript() {
    if (document.getElementById('pancake-crm-injected')) return;

    const script = document.createElement('script');
    script.id = 'pancake-crm-injected';
    script.src = chrome.runtime.getURL('crm/injected.js');
    script.onload = function() {
      injectedScriptReady = true;
      console.log('[Pancake CRM] Injected script loaded');
    };
    (document.head || document.documentElement).appendChild(script);
  }

  /**
   * Request data from Redux store
   * Returns Promise with extracted data
   */
  function requestReduxData() {
    return new Promise((resolve) => {
      // Generate unique request ID
      const requestId = 'pcrm_' + Date.now();

      // Listen for response
      const handler = function(e) {
        if (e.detail?.requestId === requestId) {
          window.removeEventListener('pancake-crm-response', handler);
          resolve(e.detail);
        }
      };
      window.addEventListener('pancake-crm-response', handler);

      // Dispatch request event
      window.dispatchEvent(new CustomEvent('pancake-crm-request', {
        detail: { requestId }
      }));

      // Timeout after 500ms
      setTimeout(() => {
        window.removeEventListener('pancake-crm-response', handler);
        resolve({ error: 'Timeout' });
      }, 500);
    });
  }

  // Inject script when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectScript);
  } else {
    injectScript();
  }

  console.log('[Pancake CRM] Extension loaded');

  // Refresh ads mapping cache on page load (always fetch latest from sheet)
  chrome.runtime.sendMessage({ action: 'refreshAdsMapping' }, (response) => {
    if (response && response.success) {
      console.log('[Pancake CRM] Ads mapping refreshed on page load');
    }
  });

  // ============================================
  // DOM ELEMENTS - Wait for DOM to be ready
  // ============================================

  function initUI() {
    // Prevent duplicate injection
    if (document.getElementById('pancake-crm-btn')) return;

    // SVG Icons (Heroicons)
    const ICONS = {
      scan: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>',
      send: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>',
      logo: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none"><rect x="2" y="2" width="28" height="28" rx="7" fill="white"/><ellipse cx="12" cy="10" rx="5" ry="2.5" stroke="#0891B2" stroke-width="1.8"/><path d="M7 10v8c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-8" stroke="#0891B2" stroke-width="1.8"/><path d="M7 14c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5" stroke="#0891B2" stroke-width="1.8"/><path d="M19 16l5 0" stroke="#0891B2" stroke-width="2" stroke-linecap="round"/><path d="M22 13l3 3-3 3" stroke="#0891B2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      success: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>',
      error: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>',
      loading: '<div class="pcrm-spinner"></div>',
      openLink: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>',
      manual: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" /></svg>'
    };

  // Create floating button
  const btn = document.createElement('button');
  btn.id = 'pancake-crm-btn';
  btn.innerHTML = ICONS.send;
  btn.title = 'Pancake → CRM';
  document.body.appendChild(btn);

  // Create popup - Tabbed design with 2 pages
  const popup = document.createElement('div');
  popup.id = 'pancake-crm-popup';
  popup.innerHTML = `
    <button class="pcrm-close" aria-label="Đóng">×</button>

    <div class="pcrm-header">
      <span class="pcrm-logo">${ICONS.logo}</span>
      <div class="pcrm-header-text">
        <h2>Pancake To CRM</h2>
        <span class="pcrm-subtitle">Đồng bộ dữ liệu khách hàng</span>
      </div>
    </div>

    <div class="pcrm-tabs">
      <button class="pcrm-tab active" data-tab="customer">Khách Hàng</button>
      <button class="pcrm-tab" data-tab="order">Đơn Hàng</button>
    </div>

    <!-- TAB 1: Khách Hàng (giữ nguyên) -->
    <div class="pcrm-content pcrm-page active" id="pcrm-page-customer">
      <div class="pcrm-field">
        <div class="pcrm-field-label-row">
          <label>Tên Khách Hàng</label>
          <button class="pcrm-manual-icon" id="pcrm-manual" title="Nhập tay (hotline)">
            ${ICONS.manual}
          </button>
        </div>
        <input type="text" id="pcrm-name" placeholder="Chưa có dữ liệu">
      </div>

      <div class="pcrm-field">
        <label>Số Điện Thoại</label>
        <input type="text" id="pcrm-phone" placeholder="Nhập số điện thoại">
      </div>

      <div class="pcrm-field pcrm-field-link">
        <label>ID Hội Thoại</label>
        <input type="text" id="pcrm-facebook" readonly placeholder="Chưa có dữ liệu">
        <button class="pcrm-open" data-target="pcrm-facebook" aria-label="Mở trong tab mới">${ICONS.openLink}</button>
      </div>

      <div class="pcrm-field">
        <label>ID Khách Hàng</label>
        <input type="text" id="pcrm-fbid" readonly placeholder="Chưa có dữ liệu">
      </div>

      <div class="pcrm-field pcrm-field-link">
        <label>Link Page</label>
        <input type="text" id="pcrm-linkpage" readonly placeholder="Chưa có dữ liệu">
        <button class="pcrm-open" data-target="pcrm-linkpage" aria-label="Mở trong tab mới">${ICONS.openLink}</button>
      </div>

      <div class="pcrm-field pcrm-field-search">
        <label>Ghi Chú</label>
        <div class="pcrm-search-wrapper">
          <input type="text" id="pcrm-note" readonly placeholder="Tự động từ Ads ID" autocomplete="off">
          <button type="button" class="pcrm-dropdown-toggle pcrm-note-toggle-hidden" id="pcrm-note-toggle" aria-label="Chọn mã content">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
          </button>
        </div>
        <div class="pcrm-dropdown" id="pcrm-note-dropdown"></div>
      </div>

      <div class="pcrm-field">
        <label>Quốc Gia</label>
        <select id="pcrm-country" aria-label="Quốc gia"><option value="">Chọn quốc gia</option></select>
      </div>

      <div class="pcrm-field">
        <label>Công Ty Con</label>
        <select id="pcrm-company" aria-label="Công ty"><option value="">Chọn công ty</option></select>
      </div>

      <div class="pcrm-field pcrm-field-search">
        <label>Nguồn Khách Hàng</label>
        <div class="pcrm-search-wrapper">
          <input type="text" id="pcrm-source-search" placeholder="Tìm hoặc chọn nguồn..." autocomplete="off">
          <button type="button" class="pcrm-dropdown-toggle" id="pcrm-source-toggle" aria-label="Mở danh sách">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
          </button>
        </div>
        <input type="hidden" id="pcrm-source" value="">
        <div class="pcrm-dropdown" id="pcrm-source-dropdown"></div>
      </div>

      <div class="pcrm-field pcrm-field-search">
        <label>Nhân Viên Kinh Doanh</label>
        <div class="pcrm-search-wrapper">
          <input type="text" id="pcrm-staff-search" placeholder="Tìm hoặc chọn nhân viên..." autocomplete="off">
          <button type="button" class="pcrm-dropdown-toggle" id="pcrm-staff-toggle" aria-label="Mở danh sách">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
          </button>
        </div>
        <input type="hidden" id="pcrm-staff" value="">
        <div class="pcrm-dropdown" id="pcrm-staff-dropdown"></div>
      </div>

      <div class="pcrm-status" id="pcrm-status"></div>

      <div class="pcrm-actions">
        <button class="pcrm-btn pcrm-btn-scan" id="pcrm-scan">
          ${ICONS.scan} Quét
        </button>
<button class="pcrm-btn pcrm-btn-send" id="pcrm-send">
          ${ICONS.send} Gửi CRM
        </button>
      </div>
    </div>

    <!-- TAB 2: Đơn Hàng -->
    <div class="pcrm-content pcrm-page" id="pcrm-page-order">
      <div class="pcrm-field">
        <label>Địa Chỉ Giao Hàng</label>
        <input type="text" id="pcrm-order-address" placeholder="Nhập địa chỉ giao hàng">
      </div>

      <div class="pcrm-field">
        <label>Kho Hàng</label>
        <select id="pcrm-order-warehouse"><option value="">Chọn kho hàng</option></select>
      </div>

      <div class="pcrm-field">
        <label>Loại Đơn Hàng</label>
        <select id="pcrm-order-type"><option value="">Chọn loại đơn</option></select>
      </div>

      <div class="pcrm-field">
        <label>Nguồn Bán / Đại Lý</label>
        <select id="pcrm-order-salessource"><option value="">Chọn nguồn bán</option></select>
      </div>

      <div class="pcrm-field">
        <label>Hồ Sơ Khách Hàng</label>
        <input type="text" id="pcrm-order-profile" placeholder="Nhập hồ sơ KH">
      </div>

      <div class="pcrm-field">
        <label>Ghi Chú NVKD</label>
        <input type="text" id="pcrm-order-staffnote" placeholder="Ghi chú nội bộ">
      </div>

      <div class="pcrm-field">
        <label>Ghi Chú Giao Hàng</label>
        <input type="text" id="pcrm-order-shipnote" placeholder="In lên vận đơn">
      </div>

      <div class="pcrm-section-title">Sản Phẩm</div>

      <div class="pcrm-field">
        <label>Combo</label>
        <select id="pcrm-order-combo">
          <option value="">-- Chọn combo --</option>
          <optgroup label="Công ty">
          </optgroup>
          <optgroup label="Đại lý">
          </optgroup>
        </select>
      </div>

      <div id="pcrm-order-lines"></div>

      <button type="button" class="pcrm-btn-add-line" id="pcrm-add-line">+ Thêm sản phẩm</button>

      <div class="pcrm-field" style="margin-top:12px">
        <label>Chiết Khấu (đ)</label>
        <input type="number" id="pcrm-order-discount" placeholder="VD: 500000 = 500.000đ" min="0">
        <span class="pcrm-field-hint" id="pcrm-discount-hint"></span>
      </div>

      <div class="pcrm-status" id="pcrm-order-status"></div>

      <div class="pcrm-actions">
        <button class="pcrm-btn pcrm-btn-send" id="pcrm-order-send" style="width:100%">
          ${ICONS.send} Gửi Đơn
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(popup);

  // Elements - Page 1
  const closeBtn = popup.querySelector('.pcrm-close');
  const scanBtn = document.getElementById('pcrm-scan');
  const manualBtn = document.getElementById('pcrm-manual');
  const sendBtn = document.getElementById('pcrm-send');
  const statusEl = document.getElementById('pcrm-status');
  let isManualMode = false;

  // Elements - Page 2
  const orderSendBtn = document.getElementById('pcrm-order-send');
  const orderStatusEl = document.getElementById('pcrm-order-status');
  const addLineBtn = document.getElementById('pcrm-add-line');
  const orderLinesContainer = document.getElementById('pcrm-order-lines');
  const comboSelect = document.getElementById('pcrm-order-combo');

  // Tab switching
  const tabs = popup.querySelectorAll('.pcrm-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Update tab active state
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Show corresponding page
      const targetPage = tab.dataset.tab;
      popup.querySelectorAll('.pcrm-page').forEach(page => page.classList.remove('active'));
      document.getElementById('pcrm-page-' + targetPage).classList.add('active');

      // Load order settings when switching to order tab (uses cache)
      if (targetPage === 'order' && !orderSettingsData) {
        loadOrderSettings();
      }
    });
  });

  /**
   * Position popup as right sidebar dock - no dynamic positioning needed
   * CSS handles top:0, right:0, height:100vh
   */
  function positionPopup() {
    // Sidebar is always docked to the right via CSS
    // Clear any leftover inline styles from old positioning/dragging
    popup.style.top = '';
    popup.style.left = '';
    popup.style.right = '';
    popup.style.bottom = '';
  }

  // Click button: toggle popup (open/close)
  btn.addEventListener('click', async (e) => {
    if (btn.classList.contains('dragging')) return;

    // Toggle: if open or closing, close it
    if (popup.classList.contains('show') || popup.classList.contains('closing')) {
      closePopup();
      return;
    }

    // Position and show popup
    positionPopup();
    popup.classList.add('show');

    // Load settings if not loaded
    if (!settingsData) {
      loadSettings();
    }

    // Load content mapping for manual mode
    if (Object.keys(contentMapping).length === 0) {
      loadContentMapping();
    }

    // Auto-scan data
    await scanPancakeData();
  });

  closeBtn.addEventListener('click', () => {
    closePopup();
  });

  /**
   * Close popup with animation
   */
  function closePopup() {
    if (!popup.classList.contains('show')) return;

    popup.classList.remove('show');
    popup.classList.add('closing');

    // Wait for animation to complete before hiding
    popup.addEventListener('animationend', function handler() {
      popup.classList.remove('closing');
      popup.removeEventListener('animationend', handler);
    }, { once: true });
  }

  // Close popup when clicking outside
  document.addEventListener('click', (e) => {
    if (!popup.contains(e.target) && e.target !== btn && popup.classList.contains('show')) {
      // Don't close if clicking inside popup
    }
  });

  // Make button draggable
  makeDraggable(btn);

  // Scan button
  scanBtn.addEventListener('click', scanPancakeData);

  // Manual mode toggle
  manualBtn.addEventListener('click', toggleManualMode);

  // Send button
  sendBtn.addEventListener('click', sendToCRM);

  // Order page buttons
  orderSendBtn.addEventListener('click', sendOrder);
  addLineBtn.addEventListener('click', () => addOrderLine());

  // Discount input - show formatted hint
  const discountInput = document.getElementById('pcrm-order-discount');
  const discountHint = document.getElementById('pcrm-discount-hint');
  discountInput.addEventListener('input', () => {
    const val = parseInt(discountInput.value) || 0;
    discountHint.textContent = val > 0 ? '= ' + formatPrice(val) : '';
  });

  // Combo select
  comboSelect.addEventListener('change', () => {
    const comboId = comboSelect.value;
    if (!comboId) return;

    const combo = COMBOS.find(c => c.id === comboId);
    if (!combo) return;

    // Clear existing lines
    orderLinesContainer.innerHTML = '';

    // Add product lines from combo
    combo.products.forEach(p => {
      addOrderLine(p.id, p.qty);
    });

    // Calculate discount: total original price - combo price
    const totalOriginal = combo.products.reduce((sum, p) => {
      const product = orderProductOptions.find(op => op.id === p.id);
      return sum + (product ? product.price * p.qty : 0);
    }, 0);
    const discount = Math.max(0, totalOriginal - combo.comboPrice);
    document.getElementById('pcrm-order-discount').value = discount;
    // Update hint
    discountHint.textContent = discount > 0 ? '= ' + formatPrice(discount) : '';
  });

  // Open link buttons - delegate event
  popup.addEventListener('click', (e) => {
    const openBtn = e.target.closest('.pcrm-open');
    if (!openBtn) return;

    const targetId = openBtn.dataset.target;
    const input = document.getElementById(targetId);
    if (!input || !input.value) return;

    // Open URL in new tab
    window.open(input.value, '_blank');
  });

  /**
   * Load settings from Google Sheet
   */
  function loadSettings() {
    showStatus('Đang tải cấu hình...', 'loading');

    chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
      if (chrome.runtime.lastError) {
        showStatus('Lỗi kết nối extension: ' + chrome.runtime.lastError.message, 'error');
        return;
      }

      if (response && response.success) {
        settingsData = response.data;
        populateDropdowns();
        hideStatus();
      } else {
        showStatus('Lỗi tải cấu hình: ' + (response?.error || 'Kiểm tra lại URL Google Sheet'), 'error');
      }
    });
  }

  /**
   * Load saved dropdown selections from localStorage
   */
  function loadSavedSelections() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  }

  /**
   * Save dropdown selections to localStorage
   */
  function saveSelections() {
    const selections = {
      'pcrm-country': document.getElementById('pcrm-country')?.value || '',
      'pcrm-company': document.getElementById('pcrm-company')?.value || '',
      'pcrm-source': document.getElementById('pcrm-source')?.value || '',
      'pcrm-staff': document.getElementById('pcrm-staff')?.value || ''
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(selections));
    } catch (e) {
      // Ignore storage errors
    }
  }

  // Store options for searchable dropdowns
  let sourceOptions = [];
  let staffOptions = [];

  /**
   * Populate dropdowns with settings data from ERP API
   * Data format: { id, name } objects
   */
  function populateDropdowns() {
    if (!settingsData) return;

    const saved = loadSavedSelections();

    // Regular selects
    fillSelect('pcrm-country', settingsData.countries || [], saved['pcrm-country']);
    fillSelect('pcrm-company', settingsData.companies || [], saved['pcrm-company']);

    // Searchable dropdowns
    sourceOptions = settingsData.sources || [];
    staffOptions = settingsData.users || [];

    initSearchableDropdown('pcrm-source', sourceOptions, saved['pcrm-source'], onSourceSelected);
    initSearchableDropdown('pcrm-staff', staffOptions, saved['pcrm-staff']);
  }

  /**
   * Fill select element with options
   * @param {string} id - Select element ID
   * @param {Array} options - Array of { id, name } objects
   * @param {string} savedValue - Previously saved value (id)
   */
  function fillSelect(id, options, savedValue) {
    const select = document.getElementById(id);
    if (!select) return;

    const placeholder = select.querySelector('option');

    // Keep first option (placeholder)
    select.innerHTML = placeholder ? placeholder.outerHTML : '<option value="">-- Chọn --</option>';

    options.forEach(opt => {
      if (!opt || !opt.id) return;
      const option = document.createElement('option');
      option.value = opt.id; // Use ID as value for CRM API
      option.textContent = opt.name; // Display name to user
      select.appendChild(option);
    });

    // Restore saved value if exists
    if (savedValue) select.value = savedValue;
  }

  /**
   * Initialize searchable dropdown with toggle button
   * @param {string} id - Hidden input ID (stores selected value)
   * @param {Array} options - Array of { id, name } objects
   * @param {string} savedValue - Previously saved value (id)
   */
  function initSearchableDropdown(id, options, savedValue, onSelectCallback) {
    const hiddenInput = document.getElementById(id);
    const searchInput = document.getElementById(id + '-search');
    const dropdown = document.getElementById(id + '-dropdown');
    const toggleBtn = document.getElementById(id + '-toggle');

    if (!hiddenInput || !searchInput || !dropdown) return;

    // Helper to select item
    const selectItem = (item) => {
      hiddenInput.value = item.id;
      searchInput.value = item.name;
      dropdown.classList.remove('show');
      toggleBtn?.classList.remove('open');
      if (onSelectCallback) onSelectCallback(item);
    };

    // Restore saved value
    if (savedValue) {
      const savedItem = options.find(opt => String(opt.id) === String(savedValue));
      if (savedItem) {
        hiddenInput.value = savedItem.id;
        searchInput.value = savedItem.name;
      }
    }

    // Toggle button - show all options
    if (toggleBtn) {
      toggleBtn.addEventListener('mousedown', (e) => {
        e.preventDefault(); // Prevent blur on search input

        if (dropdown.classList.contains('show')) {
          dropdown.classList.remove('show');
          toggleBtn.classList.remove('open');
        } else {
          // Show all options (limit 50 for performance)
          renderDropdown(dropdown, options.slice(0, 50), selectItem);
          dropdown.classList.add('show');
          toggleBtn.classList.add('open');
          searchInput.focus();
        }
      });
    }

    // Filter and show dropdown on input
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.toLowerCase().trim();
      hiddenInput.value = ''; // Clear selection when typing

      if (query.length < 1) {
        // Show all options when input is empty but focused
        renderDropdown(dropdown, options.slice(0, 50), selectItem);
        dropdown.classList.add('show');
        toggleBtn?.classList.add('open');
        return;
      }

      const filtered = options.filter(opt =>
        opt.name.toLowerCase().includes(query)
      ).slice(0, 20); // Limit to 20 results when searching

      renderDropdown(dropdown, filtered, selectItem);
      dropdown.classList.add('show');
      toggleBtn?.classList.add('open');
    });

    // Show dropdown on focus
    searchInput.addEventListener('focus', () => {
      const query = searchInput.value.toLowerCase().trim();

      if (query.length < 1) {
        // Show all options when empty
        renderDropdown(dropdown, options.slice(0, 50), selectItem);
      } else {
        const filtered = options.filter(opt =>
          opt.name.toLowerCase().includes(query)
        ).slice(0, 20);
        renderDropdown(dropdown, filtered, selectItem);
      }

      dropdown.classList.add('show');
      toggleBtn?.classList.add('open');
    });

    // Hide dropdown on blur (with delay for click)
    searchInput.addEventListener('blur', () => {
      setTimeout(() => {
        dropdown.classList.remove('show');
        toggleBtn?.classList.remove('open');
      }, 150);
    });

    // Close on escape
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        dropdown.classList.remove('show');
        toggleBtn?.classList.remove('open');
        searchInput.blur();
      }
    });
  }

  /**
   * Render dropdown items
   */
  function renderDropdown(dropdown, items, onSelect) {
    dropdown.innerHTML = '';

    if (items.length === 0) {
      dropdown.innerHTML = '<div class="pcrm-dropdown-empty">Không tìm thấy</div>';
      return;
    }

    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'pcrm-dropdown-item';
      div.textContent = item.name;
      div.addEventListener('mousedown', (e) => {
        e.preventDefault(); // Prevent blur
        onSelect(item);
      });
      dropdown.appendChild(div);
    });
  }

  /**
   * Toggle manual input mode (for hotline / no conversation)
   * Unlocks readonly fields so staff can type customer info manually
   */
  function toggleManualMode() {
    isManualMode = !isManualMode;
    const nameEl = document.getElementById('pcrm-name');
    const phoneEl = document.getElementById('pcrm-phone');
    const fbEl = document.getElementById('pcrm-facebook');
    const fbIdEl = document.getElementById('pcrm-fbid');
    const linkEl = document.getElementById('pcrm-linkpage');

    if (isManualMode) {
      // Unlock only name, keep others readonly
      nameEl.removeAttribute('readonly');
      nameEl.placeholder = 'Nhập tên khách hàng...';
      nameEl.value = '';
      phoneEl.value = '';
      fbEl.value = '';
      fbIdEl.value = '';
      linkEl.value = '';
      linkEl.setAttribute('readonly', true);
      linkEl.placeholder = '';
      fbEl.setAttribute('readonly', true);
      fbIdEl.setAttribute('readonly', true);

      // Auto-sync phone → ID Hội Thoại + ID Khách Hàng
      phoneEl._manualHandler = () => {
        fbEl.value = phoneEl.value;
        fbIdEl.value = phoneEl.value;
      };
      phoneEl.addEventListener('input', phoneEl._manualHandler);
    } else {
      // Lock all back
      nameEl.setAttribute('readonly', true);
      nameEl.placeholder = 'Chưa có dữ liệu';
      fbEl.setAttribute('readonly', true);
      fbEl.placeholder = 'Chưa có dữ liệu';
      fbIdEl.setAttribute('readonly', true);
      fbIdEl.placeholder = 'Chưa có dữ liệu';
      linkEl.setAttribute('readonly', true);
      linkEl.placeholder = 'Chưa có dữ liệu';

      // Remove phone sync handler
      if (phoneEl._manualHandler) {
        phoneEl.removeEventListener('input', phoneEl._manualHandler);
        phoneEl._manualHandler = null;
      }
    }

    // Visual feedback
    manualBtn.classList.toggle('pcrm-btn-manual-active', isManualMode);

    if (isManualMode) {
      showStatus('Chế độ nhập tay: Nhập Tên + SĐT, chọn Nguồn KH.', 'success');

      // If Nguồn KH already has saved value → trigger Ghi Chú dropdown
      const sourceVal = document.getElementById('pcrm-source')?.value;
      const sourceSearch = document.getElementById('pcrm-source-search')?.value;
      if (sourceVal && sourceSearch) {
        onSourceSelected({ id: sourceVal, name: sourceSearch });
      }

      // Focus on name field for quick input
      nameEl.focus();
    } else {
      showStatus('Đã tắt chế độ nhập tay.', 'success');
      // Hide note content dropdown when leaving manual mode
      const noteToggle = document.getElementById('pcrm-note-toggle');
      const noteDropdown = document.getElementById('pcrm-note-dropdown');
      const noteInput = document.getElementById('pcrm-note');
      if (noteToggle) noteToggle.classList.add('pcrm-note-toggle-hidden');
      if (noteDropdown) noteDropdown.classList.remove('show');
      if (noteInput) {
        noteInput.placeholder = 'Tự động từ Ads ID';
        noteInput.onfocus = null;
        noteInput.onblur = null;
      }
    }
    setTimeout(hideStatus, 2500);
  }

  /**
   * Called when Nguồn Khách Hàng is selected
   * Extracts VAS code and shows content dropdown for Ghi Chú
   */
  function onSourceSelected(item) {
    if (!isManualMode) return; // Only in manual mode

    const noteToggle = document.getElementById('pcrm-note-toggle');
    const noteDropdown = document.getElementById('pcrm-note-dropdown');
    const noteInput = document.getElementById('pcrm-note');
    if (!noteToggle || !noteDropdown || !noteInput) return;

    // Extract VAS code from source name (e.g., "Nhãn LumiAura / FB Ads / VAS0036" → "VAS0036")
    const vasMatch = item.name.match(/VAS\d+/i);
    if (!vasMatch) {
      // No VAS code → hide dropdown
      noteToggle.classList.add('pcrm-note-toggle-hidden');
      noteDropdown.classList.remove('show');
      return;
    }

    const vasCode = vasMatch[0].toUpperCase();
    const codes = contentMapping[vasCode];

    if (!codes || codes.length === 0) {
      noteToggle.classList.add('pcrm-note-toggle-hidden');
      noteDropdown.classList.remove('show');
      noteInput.placeholder = 'Không tìm thấy mã content cho ' + vasCode;
      return;
    }

    // Show toggle button and setup dropdown
    noteToggle.classList.remove('pcrm-note-toggle-hidden');
    noteInput.placeholder = 'Chọn mã content ▼';
    noteInput.value = '';

    // Setup note dropdown behavior
    const showNoteDropdown = () => {
      noteDropdown.innerHTML = '';
      codes.forEach(code => {
        const div = document.createElement('div');
        div.className = 'pcrm-dropdown-item';
        div.textContent = code;
        div.addEventListener('mousedown', (e) => {
          e.preventDefault();
          noteInput.value = code + '|K';
          noteDropdown.classList.remove('show');
          noteToggle.classList.remove('open');
        });
        noteDropdown.appendChild(div);
      });
      noteDropdown.classList.add('show');
      noteToggle.classList.add('open');
    };

    // Toggle button click
    noteToggle.onclick = (e) => {
      e.preventDefault();
      if (noteDropdown.classList.contains('show')) {
        noteDropdown.classList.remove('show');
        noteToggle.classList.remove('open');
      } else {
        showNoteDropdown();
      }
    };

    // Focus on note input shows dropdown
    noteInput.onfocus = showNoteDropdown;
    noteInput.onblur = () => {
      setTimeout(() => {
        noteDropdown.classList.remove('show');
        noteToggle.classList.remove('open');
      }, 150);
    };

    // Auto-show dropdown
    showNoteDropdown();
    noteInput.focus();
  }

  /**
   * Load content mapping from Google Sheet (VAS code → content codes)
   */
  function loadContentMapping() {
    chrome.runtime.sendMessage({ action: 'getContentMapping' }, (response) => {
      if (response && response.success && response.data) {
        contentMapping = response.data;
        console.log('[Pancake CRM] Content mapping loaded:', Object.keys(contentMapping).length, 'entries');
      }
    });
  }

  /**
   * Scan current Pancake conversation data
   * Requests data from Redux store via injected script
   */
  async function scanPancakeData() {
    showStatus('Đang quét dữ liệu...', 'loading');

    // Request data from Redux store
    const result = await requestReduxData();

    if (result.success && result.data?.name) {
      console.log('[Pancake CRM] ✓ Got data:', result.data);

      // Extract page_id: prefer Redux, fallback to URL patterns
      // Support both /pages/123/conversations/ and /multi_pages patterns
      let pageId = result.data.pageId;
      if (!pageId) {
        const urlMatch = window.location.href.match(/pages\/(\d+)/);
        pageId = urlMatch ? urlMatch[1] : '';
      }

      // Detect TikTok and get profile ID
      const isTikTok = result.data.isTikTok || false;
      const ttUniqueId = result.data.ttUniqueId || '';
      const conversationId = result.data.conversationId || ''; // Pancake conversation ID
      let profileId = '';

      if (isTikTok && ttUniqueId) {
        // TikTok: use username directly as ID
        profileId = ttUniqueId;
      } else if (result.data.globalId) {
        // Facebook: use global_id as ID
        profileId = result.data.globalId;
      }

      // Determine channel type: M=Mess, C=Comment, K=Manual
      const selectedType = result.data.selectedType || '';
      const channelSuffix = selectedType === 'COMMENT' ? 'C' : 'M';

      currentData = {
        name: result.data.name,
        phone: result.data.phone || '',
        fbId: profileId, // TikTok username or Facebook global_id
        globalId: result.data.globalId || '',
        pageId,
        adsId: result.data.adsId || '',
        postId: result.data.postId || '',
        channelSuffix,
        facebook: conversationId, // Pancake conversation ID (e.g., 786439674562387_25295945770063202)
        linkPageFacebook: pageId ? `https://facebook.com/${pageId}` : '',
        isTikTok
      };

      console.log('[Pancake CRM] pageId:', pageId, 'adsId:', currentData.adsId, 'postId:', currentData.postId, 'channel:', channelSuffix);

      // Fill form - clear all fields first, then populate with new data
      document.getElementById('pcrm-name').value = currentData.name;
      document.getElementById('pcrm-phone').value = currentData.phone;
      document.getElementById('pcrm-facebook').value = currentData.facebook;
      document.getElementById('pcrm-fbid').value = currentData.fbId;
      document.getElementById('pcrm-linkpage').value = currentData.linkPageFacebook;
      document.getElementById('pcrm-note').value = ''; // Clear old note first

      // Lookup note based on conversation type:
      // COMMENT → use postId (column C), INBOX/Mess → use adsId (column B)
      if (channelSuffix === 'C' && currentData.postId) {
        chrome.runtime.sendMessage({
          action: 'getPostNote',
          postId: currentData.postId
        }, (response) => {
          if (response && response.note) {
            document.getElementById('pcrm-note').value = response.note + '|' + channelSuffix;
          }
        });
      } else if (currentData.adsId) {
        chrome.runtime.sendMessage({
          action: 'getAdsNote',
          adsId: currentData.adsId
        }, (response) => {
          if (response && response.note) {
            document.getElementById('pcrm-note').value = response.note + '|' + channelSuffix;
          }
        });
      }

      showStatus('Đã quét thành công!', 'success');
      setTimeout(hideStatus, 2500);
    } else {
      console.log('[Pancake CRM] Scan failed:', result.error || 'No data');
      showStatus('Không tìm thấy dữ liệu. Vui lòng mở một conversation và thử lại.', 'error');
    }
  }

  /**
   * Extract data from Pancake page
   * Uses data from Redux store (via injected main world script)
   */
  function extractPancakeData() {
    try {
      // Extract page_id from URL
      const urlMatch = window.location.href.match(/pages\/(\d+)\/conversations\/(\d+_\d+)/);
      let pageId = urlMatch ? urlMatch[1] : null;

      // Request fresh data from Redux store
      window.dispatchEvent(new CustomEvent('pancake-crm-request'));

      // Use cached reduxData (will be updated by response handler)
      if (reduxData && reduxData.name) {
        console.log('[Pancake CRM] Using Redux data:', reduxData.name);

        // Detect TikTok and get profile ID
        const isTikTok = reduxData.isTikTok || false;
        const ttUniqueId = reduxData.ttUniqueId || '';
        const conversationId = reduxData.conversationId || '';
        let profileId = '';

        if (isTikTok && ttUniqueId) {
          profileId = ttUniqueId;
        } else if (reduxData.globalId) {
          profileId = reduxData.globalId;
        }

        return {
          name: reduxData.name,
          phone: reduxData.phone || '',
          fbId: profileId,
          globalId: reduxData.globalId || '',
          pageId,
          adsId: reduxData.adsId || '',
          facebook: conversationId, // Pancake conversation ID
          linkPageFacebook: pageId ? `https://facebook.com/${pageId}` : '',
          isTikTok
        };
      }

      console.log('[Pancake CRM] No Redux data available yet');
      return null;
    } catch (e) {
      console.error('[Pancake CRM] extractPancakeData error:', e);
      return null;
    }
  }

  /**
   * Get selected text from dropdown (for regular select or searchable dropdown)
   */
  function getDropdownText(id) {
    const el = document.getElementById(id);
    if (!el) return '';

    // For regular select - get selected option text
    if (el.tagName === 'SELECT') {
      return el.options[el.selectedIndex]?.text || '';
    }
    // For searchable dropdown - get text from search input
    const searchInput = document.getElementById(id + '-search');
    return searchInput?.value || '';
  }

  /**
   * Send data to CRM
   * Field names match CRM API format
   */
  function sendToCRM() {
    const payload = {
      tenkhachhang: document.getElementById('pcrm-name').value,
      sodienthoai: document.getElementById('pcrm-phone').value,
      facebook: document.getElementById('pcrm-facebook').value,
      idfacebook: document.getElementById('pcrm-fbid').value,
      linkpagefacebook: document.getElementById('pcrm-linkpage').value,
      khachhangghichu: document.getElementById('pcrm-note').value,
      // Dropdown fields
      quocgia: getDropdownText('pcrm-country'),
      congtycon: getDropdownText('pcrm-company'),
      nguonkhachhang: getDropdownText('pcrm-source'),
      nhanvienkinhdoanh: getDropdownText('pcrm-staff')
    };

    // Validate required fields
    if (!payload.tenkhachhang) {
      showStatus(isManualMode ? 'Vui lòng nhập Tên Khách Hàng!' : 'Vui lòng bấm Quét để lấy dữ liệu trước!', 'error');
      return;
    }

    if (!payload.khachhangghichu) {
      showStatus('Vui lòng chọn/nhập Ghi Chú trước khi gửi!', 'error');
      document.getElementById('pcrm-note').focus();
      return;
    }

    if (!payload.facebook) {
      showStatus('Thiếu ID Hội Thoại! Vui lòng quét dữ liệu hoặc bật nhập tay.', 'error');
      return;
    }

    if (!payload.idfacebook) {
      showStatus('Thiếu ID Khách Hàng! Vui lòng bấm vào avatar khách hàng hoặc bật nhập tay.', 'error');
      return;
    }

    showStatus('Đang gửi về CRM...', 'loading');
    sendBtn.disabled = true;

    chrome.runtime.sendMessage({
      action: 'sendToCRM',
      payload
    }, (response) => {
      sendBtn.disabled = false;

      if (chrome.runtime.lastError) {
        showStatus('Lỗi kết nối: ' + chrome.runtime.lastError.message, 'error');
        return;
      }

      if (response && response.success) {
        showStatus('Gửi thành công!', 'success');
        // Save dropdown selections for next time
        saveSelections();
        // Clear form after success
        setTimeout(() => {
          document.getElementById('pcrm-name').value = '';
          document.getElementById('pcrm-phone').value = '';
          document.getElementById('pcrm-facebook').value = '';
          document.getElementById('pcrm-fbid').value = '';
          document.getElementById('pcrm-linkpage').value = '';
          document.getElementById('pcrm-note').value = '';
          currentData = {};
          hideStatus();
        }, 2000);
      } else {
        showStatus('Lỗi: ' + (response?.error || 'Không thể gửi về CRM'), 'error');
      }
    });
  }

  // ============================================
  // ORDER PAGE FUNCTIONS
  // ============================================

  /**
   * Load order settings (warehouses, order types, sales sources, products)
   */
  function loadOrderSettings() {
    showOrderStatus('Đang tải cấu hình đơn hàng...', 'loading');

    let settingsDone = false, combosDone = false;

    chrome.runtime.sendMessage({ action: 'getOrderSettings' }, (response) => {
      if (chrome.runtime.lastError) {
        showOrderStatus('Lỗi kết nối: ' + chrome.runtime.lastError.message, 'error');
        return;
      }
      if (response && response.success) {
        orderSettingsData = response.data;
      }
      settingsDone = true;
      if (combosDone) finishLoadOrder();
    });

    chrome.runtime.sendMessage({ action: 'getCombos' }, (response) => {
      if (response && response.success && Array.isArray(response.data)) {
        COMBOS = response.data;
        console.log('[Pancake CRM] Combos loaded:', COMBOS.length);
      }
      combosDone = true;
      if (settingsDone) finishLoadOrder();
    });

    function finishLoadOrder() {
      if (orderSettingsData) {
        populateOrderDropdowns();
        hideOrderStatus();
      } else {
        showOrderStatus('Lỗi tải cấu hình đơn hàng', 'error');
      }
    }
  }

  /**
   * Populate order page dropdowns
   */
  function populateOrderDropdowns() {
    if (!orderSettingsData) return;

    const savedOrder = loadSavedOrderSelections();

    fillSelect('pcrm-order-warehouse', orderSettingsData.warehouses || [], savedOrder['pcrm-order-warehouse']);
    fillSelect('pcrm-order-type', orderSettingsData.orderTypes || [], savedOrder['pcrm-order-type']);
    fillSelect('pcrm-order-salessource', orderSettingsData.salesSources || [], savedOrder['pcrm-order-salessource']);

    // Store products for order lines
    orderProductOptions = orderSettingsData.products || [];

    // Populate combo dropdown with optgroups
    populateComboDropdown();
  }

  /**
   * Populate combo dropdown with channel grouping
   */
  function populateComboDropdown() {
    const select = document.getElementById('pcrm-order-combo');
    if (!select) return;

    select.innerHTML = '<option value="">-- Chọn combo --</option>';

    const ctyGroup = document.createElement('optgroup');
    ctyGroup.label = 'Công ty';
    const dlyGroup = document.createElement('optgroup');
    dlyGroup.label = 'Đại lý';

    COMBOS.forEach(combo => {
      const opt = document.createElement('option');
      opt.value = combo.id;
      opt.textContent = combo.label + ' - ₫' + formatPriceShort(combo.comboPrice);

      if (combo.channel === 'cty') ctyGroup.appendChild(opt);
      else dlyGroup.appendChild(opt);
    });

    if (ctyGroup.children.length > 0) select.appendChild(ctyGroup);
    if (dlyGroup.children.length > 0) select.appendChild(dlyGroup);
  }

  /**
   * Format price to Vietnamese format
   */
  function formatPrice(num) {
    return new Intl.NumberFormat('vi-VN').format(num) + 'đ';
  }

  /**
   * Format price in short "k" format for combo display
   * VD: 3750000 → "3.750k", 2812500 → "2.812,5k"
   */
  function formatPriceShort(num) {
    const k = num / 1000;
    return new Intl.NumberFormat('vi-VN').format(k) + 'k';
  }

  /**
   * Add a product line to order (with searchable dropdown)
   */
  function addOrderLine(productId, qty) {
    const line = document.createElement('div');
    line.className = 'pcrm-order-line';

    // Find selected product name
    const selectedProduct = productId ? orderProductOptions.find(p => p.id === productId) : null;
    const displayText = selectedProduct ? `${selectedProduct.name} - ${formatPrice(selectedProduct.price)}` : '';

    line.innerHTML = `
      <div class="pcrm-product-search-wrap">
        <input type="hidden" class="pcrm-line-product" value="${productId || ''}">
        <input type="text" class="pcrm-product-search" placeholder="Chọn SP" value="${displayText}" autocomplete="off">
        <div class="pcrm-product-dropdown"></div>
      </div>
      <input type="number" class="pcrm-line-qty" value="${qty || 1}" min="1" max="99">
      <button type="button" class="pcrm-line-remove" aria-label="Xóa">×</button>
    `;

    const searchInput = line.querySelector('.pcrm-product-search');
    const hiddenInput = line.querySelector('.pcrm-line-product');
    const dropdown = line.querySelector('.pcrm-product-dropdown');

    // Build dropdown items
    function renderDropdown(filter) {
      const keyword = (filter || '').toLowerCase();
      const filtered = orderProductOptions.filter(p =>
        p.price > 0 && p.name.toLowerCase().includes(keyword)
      );
      if (filtered.length === 0) {
        dropdown.innerHTML = '<div class="pcrm-product-no-result">Không tìm thấy</div>';
      } else {
        dropdown.innerHTML = filtered.map(p =>
          `<div class="pcrm-product-option" data-id="${p.id}" data-name="${p.name}" data-price="${p.price}">${p.name} - ${formatPrice(p.price)}</div>`
        ).join('');
      }
      dropdown.style.display = 'block';
    }

    // Show dropdown on focus
    searchInput.addEventListener('focus', () => {
      searchInput.select();
      renderDropdown(searchInput.value === displayText ? '' : searchInput.value);
    });

    // Filter on type
    searchInput.addEventListener('input', () => {
      hiddenInput.value = '';
      renderDropdown(searchInput.value);
    });

    // Select item
    dropdown.addEventListener('click', (e) => {
      const opt = e.target.closest('.pcrm-product-option');
      if (!opt) return;
      hiddenInput.value = opt.dataset.id;
      searchInput.value = `${opt.dataset.name} - ${formatPrice(Number(opt.dataset.price))}`;
      dropdown.style.display = 'none';
    });

    // Hide dropdown on blur (delay to allow click)
    searchInput.addEventListener('blur', () => {
      setTimeout(() => { dropdown.style.display = 'none'; }, 200);
    });

    // Remove button
    line.querySelector('.pcrm-line-remove').addEventListener('click', () => {
      line.remove();
    });

    orderLinesContainer.appendChild(line);
  }

  /**
   * Load saved order dropdown selections
   */
  function loadSavedOrderSelections() {
    try {
      const saved = localStorage.getItem(ORDER_STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  }

  /**
   * Save order dropdown selections
   */
  function saveOrderSelections() {
    const selections = {
      'pcrm-order-warehouse': document.getElementById('pcrm-order-warehouse')?.value || '',
      'pcrm-order-type': document.getElementById('pcrm-order-type')?.value || '',
      'pcrm-order-salessource': document.getElementById('pcrm-order-salessource')?.value || ''
    };
    try {
      localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(selections));
    } catch (e) {}
  }

  /**
   * Send CRM + Order sequentially
   * Step 1: Send customer to CRM (soly.com.vn)
   * Step 2: Send order to ERP (foxia.vn)
   */
  function sendOrder() {
    // === VALIDATE ===
    const customerName = document.getElementById('pcrm-name').value;
    if (!customerName) {
      showOrderStatus('Chưa có dữ liệu KH. Vui lòng bấm Quét trước!', 'error');
      return;
    }

    // Build order_line from product lines
    const lines = orderLinesContainer.querySelectorAll('.pcrm-order-line');
    const lineItems = [];
    for (const line of lines) {
      const productId = parseInt(line.querySelector('.pcrm-line-product').value);
      const qty = parseInt(line.querySelector('.pcrm-line-qty').value) || 1;
      if (!productId) {
        showOrderStatus('Vui lòng chọn sản phẩm cho tất cả các dòng!', 'error');
        return;
      }
      const product = orderProductOptions.find(p => p.id === productId);
      const price = product ? product.price : 0;
      lineItems.push({ productId, qty, price });
    }

    if (lineItems.length === 0) {
      showOrderStatus('Vui lòng thêm ít nhất 1 sản phẩm!', 'error');
      return;
    }

    // Distribute discount proportionally across products
    const totalDiscount = parseInt(document.getElementById('pcrm-order-discount').value) || 0;
    const totalOriginalPrice = lineItems.reduce((sum, item) => sum + item.price * item.qty, 0);
    const orderLine = [];

    if (totalDiscount > 0 && totalOriginalPrice > 0) {
      let discountUsed = 0;
      for (let i = 0; i < lineItems.length; i++) {
        const item = lineItems[i];
        const lineData = { product_id: item.productId, product_uom_qty: item.qty };
        if (i === lineItems.length - 1) {
          // Last item gets remaining discount to ensure exact total
          lineData.discount_fixed = totalDiscount - discountUsed;
        } else {
          const itemDiscount = Math.floor(item.price * item.qty / totalOriginalPrice * totalDiscount);
          lineData.discount_fixed = itemDiscount;
          discountUsed += itemDiscount;
        }
        orderLine.push([0, 0, lineData]);
      }
    } else {
      for (const item of lineItems) {
        orderLine.push([0, 0, { product_id: item.productId, product_uom_qty: item.qty }]);
      }
    }

    // Build payload - API /create tạo cả KH + đơn hàng cùng lúc
    const thongtinkhachhang = {
      name: customerName,
      sodienthoai: document.getElementById('pcrm-phone').value,
      facebook: document.getElementById('pcrm-facebook').value,
      idfacebook: document.getElementById('pcrm-fbid').value,
      duongdanpagefacebook: document.getElementById('pcrm-linkpage').value,
      khachhangghichu: document.getElementById('pcrm-note').value,
      congtycon_id: parseInt(document.getElementById('pcrm-company').value) || 0,
      nguonkhachhang_id: parseInt(document.getElementById('pcrm-source').value) || 0,
      nhanvienkinhdoanh1_id: parseInt(document.getElementById('pcrm-staff').value) || 0,
      quocgia_id: parseInt(document.getElementById('pcrm-country').value) || 0
    };

    const thongtindonhang = {
      tennguoinhan: thongtinkhachhang.name,
      quocgia_id: thongtinkhachhang.quocgia_id,
      sodienthoai: thongtinkhachhang.sodienthoai,
      diachi: document.getElementById('pcrm-order-address').value,
      warehouse_id: parseInt(document.getElementById('pcrm-order-warehouse').value) || 0,
      loaidonhang_id: parseInt(document.getElementById('pcrm-order-type').value) || 0,
      nguonbannguondaily_id: parseInt(document.getElementById('pcrm-order-salessource').value) || 0,
      hosokhachhang: document.getElementById('pcrm-order-profile').value,
      nhanvienkinhdoanhghichu: document.getElementById('pcrm-order-staffnote').value,
      note: document.getElementById('pcrm-order-shipnote').value,
      order_line: orderLine,
      chietkhaubosung: 0
    };

    const payload = { thongtinkhachhang, thongtindonhang };

    showOrderStatus('Đang gửi đơn hàng...', 'loading');
    orderSendBtn.disabled = true;

    chrome.runtime.sendMessage({ action: 'sendOrder', payload }, (response) => {
      orderSendBtn.disabled = false;

      if (chrome.runtime.lastError) {
        showOrderStatus('Lỗi kết nối: ' + chrome.runtime.lastError.message, 'error');
        return;
      }

      if (response && response.success) {
        const msg = response.data?.message || 'Tạo KH + đơn hàng thành công!';
        // Strip HTML tags from message
        const cleanMsg = msg.replace(/<[^>]*>/g, '');
        showOrderStatus(cleanMsg, 'success');
        saveOrderSelections();
        setTimeout(() => {
          document.getElementById('pcrm-order-address').value = '';
          document.getElementById('pcrm-order-profile').value = '';
          document.getElementById('pcrm-order-staffnote').value = '';
          document.getElementById('pcrm-order-shipnote').value = '';
          document.getElementById('pcrm-order-discount').value = '';
          orderLinesContainer.innerHTML = '';
          comboSelect.value = '';
          hideOrderStatus();
        }, 3000);
      } else {
        showOrderStatus('Lỗi: ' + (response?.error || 'Không thể tạo đơn hàng'), 'error');
      }
    });
  }

  /**
   * Order status helpers
   */
  function showOrderStatus(msg, type) {
    let icon = '';
    if (type === 'success') icon = ICONS.success;
    else if (type === 'error') icon = ICONS.error;
    else if (type === 'loading') icon = ICONS.loading;

    orderStatusEl.innerHTML = icon + '<span>' + msg + '</span>';
    orderStatusEl.className = 'pcrm-status show ' + type;
  }

  function hideOrderStatus() {
    orderStatusEl.className = 'pcrm-status';
  }

  /**
   * Make element draggable
   */
  function makeDraggable(el) {
    let isDragging = false;
    let hasMoved = false;
    let startX, startY, startLeft, startTop;

    el.addEventListener('mousedown', (e) => {
      isDragging = true;
      hasMoved = false;
      startX = e.clientX;
      startY = e.clientY;

      const rect = el.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;

      // Don't add dragging class yet - only when actually moved
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      // Consider it a drag if moved more than 5px
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        hasMoved = true;
        el.classList.add('dragging');
      }

      el.style.right = 'auto';
      el.style.bottom = 'auto';
      el.style.left = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, startLeft + dx)) + 'px';
      el.style.top = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, startTop + dy)) + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        // Delay removing dragging class to prevent click
        setTimeout(() => {
          el.classList.remove('dragging');
        }, hasMoved ? 100 : 0);
      }
    });
  }

  /**
   * Status helpers
   */
  function showStatus(msg, type) {
    let icon = '';
    if (type === 'success') icon = ICONS.success;
    else if (type === 'error') icon = ICONS.error;
    else if (type === 'loading') icon = ICONS.loading;

    statusEl.innerHTML = icon + '<span>' + msg + '</span>';
    statusEl.className = 'pcrm-status show ' + type;
  }

  function hideStatus() {
    statusEl.className = 'pcrm-status';
  }

  /**
   * Clear all form fields
   */
  function clearForm() {
    document.getElementById('pcrm-name').value = '';
    document.getElementById('pcrm-phone').value = '';
    document.getElementById('pcrm-facebook').value = '';
    document.getElementById('pcrm-fbid').value = '';
    document.getElementById('pcrm-linkpage').value = '';
    document.getElementById('pcrm-note').value = '';
    currentData = {};
    hideStatus();
    console.log('[Pancake CRM] Form cleared');
  }

  /**
   * Watch for conversation changes via Redux state
   * Injected script dispatches 'pancake-crm-conv-changed' event
   * Auto-scan new conversation data, keep popup open for user control
   */
  window.addEventListener('pancake-crm-conv-changed', async (e) => {
    console.log('[Pancake CRM] Conversation changed, auto-scanning...');
    // Only auto-scan if popup is open
    if (popup.classList.contains('show')) {
      await scanPancakeData();
    }
  });

  /**
   * Listen for Facebook URL captured from avatar click
   * When user clicks avatar, injected.js intercepts window.open and captures FB URL
   * Auto-fill form with ID (not full URL) if global_id was missing
   */
  window.addEventListener('pancake-crm-fb-url-captured', (e) => {
    const capturedUrl = e.detail?.url || '';
    if (!capturedUrl) return;

    console.log('[Pancake CRM] FB URL captured from avatar click:', capturedUrl);

    // Extract global_id from URL (e.g., https://facebook.com/100001234567890)
    const match = capturedUrl.match(/facebook\.com\/(\d+)/);
    const globalId = match ? match[1] : '';

    if (!globalId) {
      console.log('[Pancake CRM] Could not extract ID from URL');
      showStatus('Không thể lấy ID từ URL', 'error');
      setTimeout(hideStatus, 2000);
      return;
    }

    // Update form fields with ID only (not full URL)
    const fbField = document.getElementById('pcrm-facebook');
    const fbIdField = document.getElementById('pcrm-fbid');

    // ID Hội Thoại: điền ID thay vì full URL
    if (fbField && !fbField.value) {
      fbField.value = globalId;
      console.log('[Pancake CRM] Updated ID Hội Thoại field:', globalId);
    }

    // ID Khách Hàng: điền ID
    if (fbIdField && !fbIdField.value) {
      fbIdField.value = globalId;
      console.log('[Pancake CRM] Updated ID Khách Hàng field:', globalId);
    }

    // Update currentData with ID only
    if (!currentData.facebook) currentData.facebook = globalId;
    if (!currentData.fbId) currentData.fbId = globalId;
    if (!currentData.globalId) currentData.globalId = globalId;

    // Show brief success notification
    showStatus('Đã lấy ID từ avatar!', 'success');
    setTimeout(hideStatus, 2000);
  });

  console.log('[Pancake CRM] UI initialized');

  } // End of initUI function

  // ============================================
  // INITIALIZATION - Wait for DOM then init UI
  // ============================================

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    // DOM already loaded
    initUI();
  }

})();
