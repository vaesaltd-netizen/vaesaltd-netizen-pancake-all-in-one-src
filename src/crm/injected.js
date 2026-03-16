/**
 * Injected script - runs in page's main world
 * Reads Redux store and sends data to content script via CustomEvent
 */
(function() {
  // Listen for requests from content script
  window.addEventListener('pancake-crm-request', function(e) {
    const requestId = e.detail?.requestId || '';

    try {
      const store = window.__pancakeReduxStore__;
      if (!store) {
        window.dispatchEvent(new CustomEvent('pancake-crm-response', {
          detail: { requestId, error: 'Redux store not found' }
        }));
        return;
      }

      const state = store.getState();
      const conv = state?.conversations;

      if (!conv) {
        window.dispatchEvent(new CustomEvent('pancake-crm-response', {
          detail: { requestId, error: 'No conversations in state' }
        }));
        return;
      }

      // Extract pageId - use selectedPageId (key #42 in conversations)
      const pageId = conv.selectedPageId || '';

      // Detect TikTok source (fb_id starts with "tt_" or "ttm_")
      // tt_ = TikTok standard, ttm_ = TikTok Messenger/Mall
      const fromId = (conv.selectedFrom && conv.selectedFrom.id) ? String(conv.selectedFrom.id) : '';
      const isTikTok = fromId.length > 0 && (fromId.indexOf('tt_') === 0 || fromId.indexOf('ttm_') === 0);

      // TikTok username extraction with fallbacks
      let ttUniqueId = '';
      if (conv.selectedFrom) {
        ttUniqueId = conv.selectedFrom.tt_unique_id || conv.selectedFrom.username || '';
      }

      // DEBUG: TikTok detection logging
      console.log('[Pancake CRM] === TikTok Debug ===');
      console.log('[Pancake CRM] fromId:', fromId);
      console.log('[Pancake CRM] isTikTok:', isTikTok);
      console.log('[Pancake CRM] ttUniqueId:', ttUniqueId);
      console.log('[Pancake CRM] selectedFrom:', JSON.stringify(conv.selectedFrom, null, 2));
      console.log('[Pancake CRM] === End Debug ===');

      // Build conversation_id
      // TikTok: selectedThreadId already has full format (ttm_xxx_yyy)
      // Facebook: need to build as pageId_fromId
      let conversationId = '';
      const threadId = conv.selectedThreadId || '';

      if (isTikTok && threadId.startsWith('tt')) {
        // TikTok: use selectedThreadId directly
        conversationId = threadId;
      } else if (pageId && fromId) {
        // Facebook: build from pageId_fromId
        conversationId = `${pageId}_${fromId}`;
      }

      // DEBUG: Log conversation ID
      console.log('[Pancake CRM] conversationId:', conversationId, 'threadId:', threadId);

      const data = {
        name: (conv.selectedFrom && conv.selectedFrom.name) || '',
        fbId: fromId || (conv.selectedFrom && conv.selectedFrom.psid) || '',
        globalId: '',
        phone: '',
        adsId: '',
        pageId,
        conversationId, // Pancake conversation ID (e.g., 703803792818806_24907229868926829)
        // TikTok specific fields
        isTikTok,
        ttUniqueId: ttUniqueId
      };

      // Get detailed customer data
      if (conv.selectedCustomers && conv.selectedCustomers.length > 0) {
        const customer = conv.selectedCustomers[0];
        if (!data.name && customer.name) data.name = customer.name;
        if (!data.fbId && customer.fb_id) data.fbId = customer.fb_id;
        if (customer.global_id) data.globalId = customer.global_id;

        // TikTok: get username from customer if not from conv_from
        if (isTikTok && !data.ttUniqueId && customer.username) {
          data.ttUniqueId = customer.username;
        }

        // Phone
        if (customer.recent_phone_numbers && customer.recent_phone_numbers.length > 0) {
          const phoneData = customer.recent_phone_numbers[0];
          data.phone = typeof phoneData === 'object' ? phoneData.phone_number : phoneData;
        }

        // Ads ID - lấy mã mới nhất (cuối mảng)
        if (customer.ad_clicks && customer.ad_clicks.length > 0) {
          const lastClick = customer.ad_clicks[customer.ad_clicks.length - 1];
          if (lastClick.ad_id) {
            data.adsId = lastClick.ad_id;
          }
        }
      }

      window.dispatchEvent(new CustomEvent('pancake-crm-response', {
        detail: { requestId, success: true, data }
      }));

    } catch (e) {
      window.dispatchEvent(new CustomEvent('pancake-crm-response', {
        detail: { requestId, error: e.message }
      }));
    }
  });

  // Watch for conversation changes and notify content script
  // Fixed delay to wait for customer data to load
  let lastThreadId = null;
  let pendingNotify = null;

  const WAIT_DELAY = 1000; // Fixed 1000ms delay for customer data to load

  setInterval(() => {
    try {
      const store = window.__pancakeReduxStore__;
      if (!store) return;

      const conv = store.getState()?.conversations;
      const currentThreadId = conv?.selectedThreadId || '';

      if (currentThreadId && currentThreadId !== lastThreadId) {
        lastThreadId = currentThreadId;

        // Clear any pending notification
        if (pendingNotify) {
          clearTimeout(pendingNotify);
          pendingNotify = null;
        }

        // Wait fixed 600ms for customer data to load
        pendingNotify = setTimeout(() => {
          const currentConv = store.getState()?.conversations;
          const hasCustomerData = currentConv?.selectedCustomers?.length > 0;

          window.dispatchEvent(new CustomEvent('pancake-crm-conv-changed', {
            detail: {
              threadId: currentThreadId,
              hasCustomerData
            }
          }));
          console.log('[Pancake CRM] Conversation ready:', currentThreadId, 'hasData:', hasCustomerData);
          pendingNotify = null;
        }, WAIT_DELAY);
      }
    } catch (e) {
      // Ignore errors
    }
  }, 300);

  // ============================================
  // AVATAR CLICK INTERCEPTOR
  // Capture Facebook URL when user clicks avatar
  // ============================================

  // Override window.open to capture Facebook URLs
  const originalWindowOpen = window.open;
  let capturedFbUrl = null;

  window.open = function(url, ...args) {
    // Capture any Facebook URL opened via window.open
    if (url && typeof url === 'string') {
      const urlStr = url.toString();
      if (urlStr.includes('facebook.com') || urlStr.includes('fb.com')) {
        capturedFbUrl = urlStr;
        console.log('[Pancake CRM] Captured FB URL:', urlStr);

        // Notify content script
        window.dispatchEvent(new CustomEvent('pancake-crm-fb-url-captured', {
          detail: { url: urlStr }
        }));
      }
    }

    // Call original window.open
    return originalWindowOpen.call(this, url, ...args);
  };

  // Also intercept <a> clicks with facebook href
  document.addEventListener('click', function(e) {
    const link = e.target.closest('a[href*="facebook.com"]') || e.target.closest('a[href*="fb.com"]');
    if (link) {
      const href = link.getAttribute('href');
      capturedFbUrl = href;
      console.log('[Pancake CRM] Captured FB URL from link:', href);

      window.dispatchEvent(new CustomEvent('pancake-crm-fb-url-captured', {
        detail: { url: href }
      }));
    }
  }, true);

  // Listen for manual request to get last captured URL
  window.addEventListener('pancake-crm-get-fb-url', function(e) {
    window.dispatchEvent(new CustomEvent('pancake-crm-fb-url-response', {
      detail: { url: capturedFbUrl || '' }
    }));
  });

  console.log('[Pancake CRM] Injected script ready');
})();
