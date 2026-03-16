// content-scripts/inline-translator.js - Auto-translate messages on Pancake
// Performance optimized: Lazy translation with IntersectionObserver
// UX: Toggle auto-translate per conversation

(function() {
  'use strict';

  const DEBUG = false;
  const log = (...args) => DEBUG && console.log('[PIT]', ...args);

  // Selectors based on Pancake DOM structure
  const MESSAGE_SELECTOR = '.message-text-ele';
  const TRANSLATED_CLASS = 'pit-translated';
  const TRANSLATION_CLASS = 'pit-translation';
  const LOADING_CLASS = 'pit-loading';
  const ERROR_CLASS = 'pit-error';
  const PENDING_CLASS = 'pit-pending'; // Marked for lazy translation

  // Configuration
  const INTERSECTION_ROOT_MARGIN = '100px'; // Pre-load when 100px from viewport
  const BATCH_DELAY_MS = 150; // Batch visible messages together
  const MUTATION_DEBOUNCE_MS = 500;

  // Toggle button colors
  const COLORS = {
    primary: '#2563EB',
    primaryHover: '#1D4ED8',
    success: '#10B981',
    successHover: '#059669',
    text: '#1E293B',
    textMuted: '#64748B',
    surface: '#FFFFFF',
    border: '#E2E8F0'
  };

  class InlineTranslator {
    constructor() {
      this.mutationObserver = null;
      this.intersectionObserver = null;
      this.isProcessing = false;
      this.lastProcessTime = 0;
      this.pendingQueue = new Set(); // Messages waiting to be translated
      this.batchTimeout = null;

      // Auto-translate global state
      this.autoTranslateEnabled = true;

      this.init();
    }

    async init() {
      log('Initializing Pancake Inline Translator (Lazy Mode)...');

      // Load saved global state
      await this.loadAutoTranslateState();

      // Wait for translator to load API key
      await window.openaiTranslator.init();

      if (!window.openaiTranslator.getApiKey()) {
        log('No API key configured. Waiting for key...');
        this.showNoKeyWarning();
      }

      // Listen for API key changes
      chrome.storage.onChanged.addListener((changes) => {
        if (changes.openaiApiKey?.newValue) {
          window.openaiTranslator.setApiKey(changes.openaiApiKey.newValue);
          log('API key updated');
          this.hideNoKeyWarning();
          this.scanForMessages();
        }
      });

      // Setup IntersectionObserver for lazy translation
      this.setupIntersectionObserver();

      // Setup MutationObserver for new messages
      this.setupMutationObserver();

      // Listen for auto-translate state changes from sidebar
      this.listenForStateChanges();

      // Initial scan after short delay (wait for Pancake to render)
      setTimeout(() => this.scanForMessages(), 1500);

      // Also scan on click (conversation change)
      document.addEventListener('click', () => {
        setTimeout(() => this.scanForMessages(), 500);
      }, true);

      log('Initialized with lazy translation');
    }

    // ==================== IntersectionObserver (Lazy Translation) ====================
    setupIntersectionObserver() {
      const options = {
        root: null, // viewport
        rootMargin: INTERSECTION_ROOT_MARGIN,
        threshold: 0 // trigger when any part is visible
      };

      this.intersectionObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const msgEl = entry.target;

            // Stop observing this element
            this.intersectionObserver.unobserve(msgEl);

            // Add to pending queue for batch processing
            this.addToPendingQueue(msgEl);
          }
        }
      }, options);

      log('IntersectionObserver setup complete');
    }

    addToPendingQueue(msgEl) {
      // Skip if already processed or in queue
      if (msgEl.classList.contains(TRANSLATED_CLASS) ||
          msgEl.classList.contains(LOADING_CLASS)) {
        return;
      }

      this.pendingQueue.add(msgEl);

      // Batch process with debounce
      if (this.batchTimeout) {
        clearTimeout(this.batchTimeout);
      }

      this.batchTimeout = setTimeout(() => {
        this.processPendingQueue();
      }, BATCH_DELAY_MS);
    }

    async processPendingQueue() {
      if (this.pendingQueue.size === 0) return;

      if (!window.openaiTranslator.getApiKey()) {
        log('No API key, skipping translation');
        return;
      }

      // Get all pending messages
      const messages = Array.from(this.pendingQueue);
      this.pendingQueue.clear();

      log(`Processing ${messages.length} visible messages`);

      // Prepare batch
      const batch = [];

      for (const msgEl of messages) {
        // Skip if already processed (could happen with race conditions)
        if (msgEl.classList.contains(TRANSLATED_CLASS)) {
          continue;
        }

        const extracted = this.extractMessageData(msgEl);
        if (!extracted) {
          msgEl.classList.add(TRANSLATED_CLASS);
          continue;
        }

        const { mainText, mainTextDiv, targetContainer } = extracted;

        // Detect language using Web Worker if available, else fallback
        const lang = this.detectLanguage(mainText);

        // Skip Vietnamese messages
        if (lang === 'vi') {
          msgEl.classList.add(TRANSLATED_CLASS);
          msgEl.classList.add('pit-vietnamese');
          log('Skipping Vietnamese:', mainText.substring(0, 30));
          continue;
        }

        // Add loading indicator
        this.addLoadingIndicator(targetContainer);

        batch.push({
          element: targetContainer,
          mainTextDiv: mainTextDiv,
          msgElement: msgEl,
          text: mainText,
          srcLang: lang
        });
      }

      if (batch.length === 0) {
        log('No non-Vietnamese messages to translate');
        return;
      }

      // Batch translate
      try {
        log(`Translating ${batch.length} messages...`);

        const results = await window.openaiTranslator.batchTranslate(
          batch.map(b => ({ text: b.text, srcLang: b.srcLang }))
        );

        // Inject translations
        for (let i = 0; i < batch.length; i++) {
          const { element, msgElement } = batch[i];
          const result = results[i];

          this.removeLoadingIndicator(element);
          msgElement.classList.add(TRANSLATED_CLASS);

          if (result.translation) {
            this.injectTranslation(element, result.translation);
            log('Translated:', result.original.substring(0, 20), '→', result.translation.substring(0, 20));
          } else {
            this.injectError(element, result.error || 'Dịch thất bại');
            log('Translation failed:', result.error);
          }
        }

        log('Batch complete');

      } catch (e) {
        log('Error processing batch:', e);
        // Remove loading indicators on error
        for (const { element, msgElement } of batch) {
          this.removeLoadingIndicator(element);
          msgElement.classList.remove(LOADING_CLASS);
        }
      }
    }

    // ==================== Language Detection ====================
    detectLanguage(text) {
      // Use Web Worker if available
      if (window.pitLanguageWorker && typeof window.pitLanguageWorker.detect === 'function') {
        // Web Worker is async, but for now we use sync fallback
        // Web Worker will be used for batch pre-processing
      }

      // Fallback to sync detection
      if (typeof window.detectLanguage === 'function') {
        return window.detectLanguage(text);
      }

      return 'auto';
    }

    // ==================== MutationObserver (New Messages) ====================
    setupMutationObserver() {
      const config = {
        childList: true,
        subtree: true
      };

      this.mutationObserver = new MutationObserver(() => {
        // Debounce scanning
        const now = Date.now();
        if (now - this.lastProcessTime < MUTATION_DEBOUNCE_MS) {
          return;
        }
        this.lastProcessTime = now;

        // Delay to let DOM settle
        setTimeout(() => this.scanForMessages(), 300);
      });

      this.mutationObserver.observe(document.body, config);
      log('MutationObserver setup complete');
    }

    // ==================== Auto-Translate State Management ====================
    async loadAutoTranslateState() {
      try {
        const result = await chrome.storage.local.get('pitAutoTranslateEnabled');
        if (result.pitAutoTranslateEnabled !== undefined) {
          this.autoTranslateEnabled = result.pitAutoTranslateEnabled;
          log('Loaded auto-translate state:', this.autoTranslateEnabled);
        }
      } catch (e) {
        log('Failed to load auto-translate state:', e);
      }
    }

    listenForStateChanges() {
      // Listen for storage changes from sidebar toggle
      chrome.storage.onChanged.addListener((changes) => {
        if (changes.pitAutoTranslateEnabled) {
          this.autoTranslateEnabled = changes.pitAutoTranslateEnabled.newValue;
          log('Auto-translate state changed:', this.autoTranslateEnabled);

          // If enabled, scan for messages
          if (this.autoTranslateEnabled) {
            this.scanForMessages();
          }
        }
      });
    }

    // ==================== Scan & Observe Messages ====================
    scanForMessages() {
      // Skip if auto-translate is disabled globally
      if (!this.autoTranslateEnabled) {
        log('Auto-translate disabled globally, skipping scan');
        return;
      }

      // Find all unprocessed messages
      const messages = document.querySelectorAll(
        `${MESSAGE_SELECTOR}:not(.${TRANSLATED_CLASS}):not(.${PENDING_CLASS})`
      );

      if (messages.length === 0) return;

      log(`Found ${messages.length} new messages to observe`);

      for (const msgEl of messages) {
        // Mark as pending to avoid re-observing
        msgEl.classList.add(PENDING_CLASS);

        // Start observing with IntersectionObserver
        this.intersectionObserver.observe(msgEl);
      }

      // Also check for incomplete translations (processing was interrupted)
      this.checkIncompleteTranslations();
    }

    checkIncompleteTranslations() {
      const maybeIncomplete = document.querySelectorAll(
        `${MESSAGE_SELECTOR}.${TRANSLATED_CLASS}:not(.pit-vietnamese)`
      );

      for (const msg of maybeIncomplete) {
        const wrapperDiv = msg.querySelector(':scope > div');
        if (wrapperDiv) {
          const hasTranslation = wrapperDiv.querySelector(`.${TRANSLATION_CLASS}`);
          const hasError = wrapperDiv.querySelector(`.${ERROR_CLASS}`);

          if (!hasTranslation && !hasError) {
            msg.classList.remove(TRANSLATED_CLASS);
            msg.classList.remove(PENDING_CLASS);
            this.intersectionObserver.observe(msg);
            log('Reset incomplete translation for reprocessing');
          }
        }
      }
    }

    // ==================== Message Data Extraction ====================
    extractMessageData(msgEl) {
      const replySection = msgEl.querySelector('.content-replied-message');

      let mainTextDiv = null;
      let mainText = '';
      let targetContainer = msgEl;

      if (replySection) {
        // Message has quote
        targetContainer = msgEl;
        const children = Array.from(msgEl.children);
        let passedQuoteWrapper = false;

        for (const child of children) {
          if (child.querySelector('.content-replied-message') ||
              child.classList.contains('content-replied-message')) {
            passedQuoteWrapper = true;
            continue;
          }

          if (child.classList.contains(TRANSLATION_CLASS) ||
              child.classList.contains(LOADING_CLASS) ||
              child.classList.contains(ERROR_CLASS) ||
              child.classList.contains('additional-info') ||
              child.classList.contains('clearfix')) {
            continue;
          }

          if (passedQuoteWrapper) {
            const txt = child.textContent?.trim();
            if (txt && txt.length > 0) {
              mainTextDiv = child;
              mainText = txt;
              break;
            }
          }
        }

        // Fallback for nested structure
        if (!mainText) {
          const wrapperDiv = msgEl.querySelector(':scope > div');
          if (wrapperDiv) {
            const wrapperChildren = Array.from(wrapperDiv.children);
            let passedReply = false;

            for (const child of wrapperChildren) {
              if (child.classList.contains('content-replied-message') ||
                  child.querySelector('.content-replied-message')) {
                passedReply = true;
                continue;
              }
              if (child.classList.contains(TRANSLATION_CLASS) ||
                  child.classList.contains(LOADING_CLASS) ||
                  child.classList.contains(ERROR_CLASS)) {
                continue;
              }
              if (passedReply) {
                const txt = child.textContent?.trim();
                if (txt && txt.length > 0) {
                  mainTextDiv = child;
                  mainText = txt;
                  targetContainer = wrapperDiv;
                  break;
                }
              }
            }
          }
        }
      } else {
        // No quote
        const wrapperDiv = msgEl.querySelector(':scope > div');
        if (!wrapperDiv) return null;

        targetContainer = wrapperDiv;

        const childDivs = wrapperDiv.querySelectorAll(':scope > div');
        if (childDivs.length > 0) {
          for (const child of childDivs) {
            if (!child.classList.contains(TRANSLATION_CLASS) &&
                !child.classList.contains(LOADING_CLASS) &&
                !child.classList.contains(ERROR_CLASS)) {
              mainTextDiv = child;
              mainText = child.textContent?.trim() || '';
              break;
            }
          }
        }

        if (!mainTextDiv) {
          mainTextDiv = wrapperDiv;
          mainText = this.getDirectText(wrapperDiv);
        }
      }

      if (!mainText || mainText.length === 0) {
        return null;
      }

      return { mainText, mainTextDiv, targetContainer };
    }

    // ==================== UI Helpers ====================
    showNoKeyWarning() {
      if (document.getElementById('pit-no-key-warning')) return;

      const warning = document.createElement('div');
      warning.id = 'pit-no-key-warning';
      warning.innerHTML = `
        <div style="
          position: fixed;
          bottom: 20px;
          right: 20px;
          background: #fff3cd;
          border: 1px solid #ffc107;
          border-radius: 8px;
          padding: 12px 16px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          z-index: 10000;
          font-family: sans-serif;
          font-size: 13px;
          max-width: 300px;
        ">
          <strong style="color: #856404;">Pancake Inline Translator</strong>
          <p style="margin: 8px 0 0; color: #856404;">
            Chưa có API key. Click vào icon extension để cài đặt.
          </p>
        </div>
      `;
      document.body.appendChild(warning);

      setTimeout(() => this.hideNoKeyWarning(), 10000);
    }

    hideNoKeyWarning() {
      const warning = document.getElementById('pit-no-key-warning');
      if (warning) warning.remove();
    }

    addLoadingIndicator(element) {
      this.removeLoadingIndicator(element);

      const loading = document.createElement('div');
      loading.className = LOADING_CLASS;
      loading.textContent = 'Đang dịch';
      element.appendChild(loading);
    }

    removeLoadingIndicator(element) {
      const existing = element.querySelector(`.${LOADING_CLASS}`);
      if (existing) existing.remove();
    }

    injectTranslation(element, translation) {
      const existing = element.querySelector(`.${TRANSLATION_CLASS}`);
      if (existing) existing.remove();

      const translationDiv = document.createElement('div');
      translationDiv.className = TRANSLATION_CLASS;
      translationDiv.textContent = translation;

      element.appendChild(translationDiv);
    }

    injectError(element, errorMsg) {
      const existing = element.querySelector(`.${ERROR_CLASS}`);
      if (existing) existing.remove();

      const errorDiv = document.createElement('div');
      errorDiv.className = ERROR_CLASS;
      errorDiv.textContent = `[!] ${errorMsg}`;

      element.appendChild(errorDiv);
    }

    getDirectText(element) {
      let text = '';
      for (const node of element.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          text += node.textContent;
        }
      }
      return text.trim();
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new InlineTranslator());
  } else {
    new InlineTranslator();
  }

})();
