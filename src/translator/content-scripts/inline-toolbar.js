// content-scripts/inline-toolbar.js - v3.0 Inline AI Toolbar
(function() {
  'use strict';

  const DEBUG = false;
  const log = (...args) => DEBUG && console.log('[PIT-Toolbar]', ...args);

  // Color palette - Trust Blue
  const COLORS = {
    primary: '#2563EB',
    primaryHover: '#1D4ED8',
    primaryLight: '#DBEAFE',
    success: '#10B981',
    successHover: '#059669',
    background: '#F8FAFC',
    surface: '#FFFFFF',
    text: '#1E293B',
    textMuted: '#64748B',
    border: '#E2E8F0',
    error: '#EF4444'
  };

  // Pancake DOM selectors
  const SELECTORS = {
    chatInput: '#replyBoxComposer',
    pancakeToolbar: '.new-reply-box-btn',
    clientMessage: '.message-text-ele.client-message',
    pageMessage: '.message-text-ele.page-message'
  };

  // SVG Icons (compact)
  const ICONS = {
    translate: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>`,
    sparkles: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.753.381c-.833.067-1.171 1.107-.536 1.651l3.62 3.102-1.106 4.637c-.194.813.691 1.456 1.405 1.02L10 15.591l4.069 2.485c.713.436 1.598-.207 1.404-1.02l-1.106-4.637 3.62-3.102c.635-.544.297-1.584-.536-1.65l-4.752-.382-1.831-4.401Z"/></svg>`,
    send: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086l-1.414 4.926a.75.75 0 0 0 .826.95 28.897 28.897 0 0 0 15.293-7.155.75.75 0 0 0 0-1.114A28.897 28.897 0 0 0 3.105 2.288Z"/></svg>`,
    loading: `<svg class="pit-spinner" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="14" height="14"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-opacity="1"/></svg>`
  };

  // Inject CSS for spinner animation
  const injectSpinnerCSS = () => {
    if (document.getElementById('pit-spinner-style')) return;
    const style = document.createElement('style');
    style.id = 'pit-spinner-style';
    style.textContent = `
      @keyframes pit-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      .pit-spinner {
        animation: pit-spin 0.8s linear infinite;
      }
      .pit-btn-loading {
        position: relative;
        overflow: hidden;
      }
      .pit-btn-loading::after {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
        animation: pit-shimmer 1.5s infinite;
      }
      @keyframes pit-shimmer {
        0% { left: -100%; }
        100% { left: 100%; }
      }
    `;
    document.head.appendChild(style);
  };
  injectSpinnerCSS();

  class InlineToolbar {
    constructor() {
      this.injected = false;
      this.isLoading = false;
      this.selectedMode = 'translate-reply'; // Default mode: Dịch
      this.autoTranslateEnabled = true;
      this.aiAutoSendEnabled = true; // AI toggle: Enter = Tạo & Gửi (default ON)
      this.overrideLanguage = 'auto'; // Language override: 'auto' | 'zh-TW' | 'zh-CN' | 'id' | 'en' | 'tl' | 'th'
      this.init();
    }

    async init() {
      log('Initializing Inline Toolbar...');

      // Wait for OpenAI translator to be ready
      if (window.openaiTranslator) {
        await window.openaiTranslator.init();
      }

      // Load settings
      await this.loadSettings();

      // Wait for Pancake chat to load
      this.waitForChatInput();

      // Setup mutation observer for dynamic content
      this.setupObserver();
    }

    async loadSettings() {
      try {
        const result = await chrome.storage.local.get([
          'pitAutoTranslateEnabled',
          'pitAiAutoSendEnabled',
          'pitResponseLength',
          'pitTranslateModel',
          'pitReplyModel',
          'pitExpandModel'
        ]);

        this.autoTranslateEnabled = result.pitAutoTranslateEnabled !== false;
        this.aiAutoSendEnabled = result.pitAiAutoSendEnabled !== false;
        this.responseLength = result.pitResponseLength || 'medium';
        // Load 3 separate models for 3 toolbar functions
        this.translateModel = result.pitTranslateModel || 'gpt-5.2';
        this.replyModel = result.pitReplyModel || 'gpt-5.2';
        this.expandModel = result.pitExpandModel || 'gpt-5.2';

        log('Settings loaded:', {
          autoTranslate: this.autoTranslateEnabled,
          length: this.responseLength,
          translateModel: this.translateModel,
          replyModel: this.replyModel,
          expandModel: this.expandModel
        });
      } catch (e) {
        log('Failed to load settings:', e);
      }
    }

    waitForChatInput() {
      const checkInterval = setInterval(() => {
        const chatInput = document.querySelector(SELECTORS.chatInput);
        if (chatInput && !this.injected) {
          clearInterval(checkInterval);
          this.injectToolbar();
        }
      }, 500);

      // Timeout after 30s
      setTimeout(() => clearInterval(checkInterval), 30000);
    }

    setupObserver() {
      const observer = new MutationObserver(() => {
        // Re-inject if toolbar was removed
        if (!document.getElementById('pit-inline-toolbar') && this.injected) {
          this.injected = false;
          const chatInput = document.querySelector(SELECTORS.chatInput);
          if (chatInput) {
            this.injectToolbar();
          }
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      // Listen for conversation switches - clear Vietnamese preview
      this.setupConversationSwitchListener();
    }

    setupConversationSwitchListener() {
      // Use capture phase to catch event before Pancake stops propagation
      document.addEventListener('click', (e) => {
        const convItem = e.target.closest('.conversation-list-item');
        if (convItem && !convItem.classList.contains('selected')) {
          // User clicked on a different conversation - clear everything
          log('Conversation switched - clearing Vietnamese preview, chatbox, and language override');
          this.hideVietPreview();
          this.clearChatbox();
          this.resetLanguageOverride();
        }
      }, true); // capture phase = true
    }

    resetLanguageOverride() {
      this.overrideLanguage = 'auto';
      const langSelect = document.getElementById('pit-lang-select');
      if (langSelect) {
        langSelect.value = 'auto';
      }
      log('Language override reset to auto');
    }

    clearChatbox() {
      const chatInput = document.querySelector(SELECTORS.chatInput);
      if (chatInput) {
        // Clear the textarea value
        chatInput.value = '';
        // Dispatch input event to trigger any listeners (React state update)
        chatInput.dispatchEvent(new Event('input', { bubbles: true }));
        log('Chatbox cleared');
      }
    }

    injectToolbar() {
      if (this.injected) return;

      // Find Pancake toolbar container (div with flex-grow: 1 containing .new-reply-box-btn)
      const pancakeBtn = document.querySelector(SELECTORS.pancakeToolbar);
      if (!pancakeBtn) {
        log('Pancake toolbar not found');
        return;
      }

      // Go up to find the toolbar container (div with flex-grow: 1)
      const pancakeToolbarRow = pancakeBtn.parentElement;
      if (!pancakeToolbarRow) {
        log('Pancake toolbar row not found');
        return;
      }

      log('Injecting toolbar into Pancake toolbar row...');

      // Create toolbar element - inline with Pancake icons
      const toolbar = document.createElement('div');
      toolbar.id = 'pit-inline-toolbar';
      toolbar.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 0 8px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 12px;
        flex-shrink: 0;
      `;

      toolbar.innerHTML = this.createToolbarHTML();

      // Insert at the beginning of Pancake toolbar row (before icons)
      pancakeToolbarRow.insertBefore(toolbar, pancakeToolbarRow.firstChild);

      // Inject action buttons into reply-box__text-area
      this.injectActionButtons();

      // Setup event handlers
      this.setupEventHandlers();

      this.injected = true;
      log('Toolbar injected successfully');
    }

    injectActionButtons() {
      // Find reply-box__text-area
      const replyBox = document.querySelector('.reply-box__text-area');
      if (!replyBox) {
        log('reply-box__text-area not found');
        return;
      }

      // Remove existing if any
      const existing = document.getElementById('pit-action-buttons');
      if (existing) existing.remove();

      // Create action buttons container - vertical layout, centered (original logic)
      const actionButtons = document.createElement('div');
      actionButtons.id = 'pit-action-buttons';
      actionButtons.style.cssText = `
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 6px;
        padding: 10px;
        flex-shrink: 0;
      `;

      actionButtons.innerHTML = `
        <button id="pit-btn-create" style="
          display: ${this.aiAutoSendEnabled ? 'flex' : 'none'};
          align-items: center;
          justify-content: center;
          gap: 4px;
          padding: 8px 14px;
          background: ${COLORS.primary};
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          box-shadow: 0 2px 6px rgba(37, 99, 235, 0.25);
          white-space: nowrap;
        ">
          ${ICONS.sparkles}
          <span>Tạo</span>
        </button>

        <button id="pit-btn-send" style="
          display: none;
          align-items: center;
          justify-content: center;
          gap: 4px;
          padding: 8px 14px;
          background: ${COLORS.success};
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          box-shadow: 0 2px 6px rgba(16, 185, 129, 0.25);
          white-space: nowrap;
        ">
          ${ICONS.send}
          <span>Tạo & Gửi</span>
        </button>
      `;

      // Make reply-box flex container with proper alignment
      replyBox.style.display = 'flex';
      replyBox.style.alignItems = 'stretch';
      replyBox.style.flexDirection = 'row';
      replyBox.style.justifyContent = 'flex-end';

      // Append to reply-box (right side of textarea)
      replyBox.appendChild(actionButtons);

      // Setup observer to re-inject buttons when conversation changes (message vs comment)
      this.setupButtonsObserver();

      log('Action buttons injected into reply-box__text-area');
    }

    setupButtonsObserver() {
      // Skip if already setup
      if (this.buttonsObserverSetup) return;
      this.buttonsObserverSetup = true;

      // Watch for reply-box changes (when switching between message and comment views)
      const observer = new MutationObserver((mutations) => {
        const replyBox = document.querySelector('.reply-box__text-area');
        const actionButtons = document.getElementById('pit-action-buttons');
        
        // If reply-box exists but buttons are not inside it, re-inject
        if (replyBox && (!actionButtons || !replyBox.contains(actionButtons))) {
          log('Reply-box changed, re-injecting action buttons...');
          // Remove old buttons if they exist elsewhere
          if (actionButtons) actionButtons.remove();
          
          // Re-create and append buttons
          const newButtons = document.createElement('div');
          newButtons.id = 'pit-action-buttons';
          newButtons.style.cssText = `
            display: flex;
            flex-direction: column;
            justify-content: center;
            gap: 6px;
            padding: 10px;
            flex-shrink: 0;
          `;
          newButtons.innerHTML = `
            <button id="pit-btn-create" style="
              display: ${this.aiAutoSendEnabled ? 'flex' : 'none'};
              align-items: center;
              justify-content: center;
              gap: 4px;
              padding: 8px 14px;
              background: ${COLORS.primary};
              color: white;
              border: none;
              border-radius: 8px;
              font-size: 12px;
              font-weight: 600;
              cursor: pointer;
              transition: all 0.2s;
              box-shadow: 0 2px 6px rgba(37, 99, 235, 0.25);
              white-space: nowrap;
            ">
              ${ICONS.sparkles}
              <span>Tạo</span>
            </button>
            <button id="pit-btn-send" style="
              display: none;
              align-items: center;
              justify-content: center;
              gap: 4px;
              padding: 8px 14px;
              background: ${COLORS.success};
              color: white;
              border: none;
              border-radius: 8px;
              font-size: 12px;
              font-weight: 600;
              cursor: pointer;
              transition: all 0.2s;
              box-shadow: 0 2px 6px rgba(16, 185, 129, 0.25);
              white-space: nowrap;
            ">
              ${ICONS.send}
              <span>Tạo & Gửi</span>
            </button>
          `;
          
          // Apply flex styles to reply-box
          replyBox.style.display = 'flex';
          replyBox.style.alignItems = 'stretch';
          replyBox.style.flexDirection = 'row';
          replyBox.style.justifyContent = 'flex-end';
          
          replyBox.appendChild(newButtons);
          
          // Re-bind click handlers
          this.bindActionButtonHandlers();
          log('Action buttons re-injected successfully');
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
      log('Buttons observer setup complete');
    }

    bindActionButtonHandlers() {
      const createBtn = document.getElementById('pit-btn-create');
      
      if (createBtn) {
        createBtn.onclick = () => this.handleAction(false);
        createBtn.onmouseenter = () => { createBtn.style.background = COLORS.primaryHover; };
        createBtn.onmouseleave = () => { createBtn.style.background = COLORS.primary; };
      }
    }

    createToolbarHTML() {
      const modes = [
        { id: 'translate-reply', label: 'Dịch' },
        { id: 'expand-reply', label: 'Ý chính' },
        { id: 'auto-reply', label: 'Trả lời' }
      ];

      // Calculate initial indicator position
      const modeIndex = modes.findIndex(m => m.id === this.selectedMode);

      const modeButtons = modes.map(mode => {
        const isActive = this.selectedMode === mode.id;
        return `
          <button class="pit-mode-btn" data-mode="${mode.id}" style="
            position: relative;
            z-index: 1;
            padding: 4px 8px;
            border: none;
            border-radius: 6px;
            font-size: 10px;
            font-weight: 500;
            cursor: pointer;
            transition: color 0.3s ease;
            background: transparent;
            color: ${isActive ? 'white' : COLORS.textMuted};
            white-space: nowrap;
          ">${mode.label}</button>
        `;
      }).join('');

      return `
        <!-- Auto-translate Toggle -->
        <div style="
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 0 6px;
          background: white;
          border: 1px solid ${COLORS.border};
          border-radius: 8px;
          height: 28px;
          flex-shrink: 0;
        ">
          ${ICONS.translate}
          <div id="pit-auto-toggle" style="
            position: relative;
            width: 32px;
            height: 18px;
            background: ${this.autoTranslateEnabled ? COLORS.primary : '#D1D5DB'};
            border-radius: 9px;
            cursor: pointer;
            transition: background 0.3s ease;
          ">
            <div id="pit-toggle-knob" style="
              position: absolute;
              top: 2px;
              left: ${this.autoTranslateEnabled ? '16px' : '2px'};
              width: 14px;
              height: 14px;
              background: white;
              border-radius: 50%;
              box-shadow: 0 1px 2px rgba(0,0,0,0.3);
              transition: left 0.3s ease;
            "></div>
          </div>
        </div>

        <!-- Mode selector -->
        <div id="pit-mode-container" style="
          position: relative;
          display: flex;
          align-items: center;
          gap: 0;
          padding: 0 3px;
          background: white;
          border: 1px solid ${COLORS.border};
          border-radius: 8px;
          height: 28px;
          flex-shrink: 0;
        ">
          <div id="pit-mode-indicator" style="
            position: absolute;
            top: 3px;
            left: 3px;
            height: calc(100% - 6px);
            background: ${COLORS.primary};
            border-radius: 6px;
            transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 0 1px 4px rgba(37, 99, 235, 0.3);
            z-index: 0;
          "></div>
          ${modeButtons}
        </div>

        <!-- Language dropdown -->
        <select id="pit-lang-select" style="
          padding: 0 6px;
          background: white;
          border: 1px solid ${COLORS.border};
          border-radius: 8px;
          height: 28px;
          font-size: 10px;
          font-weight: 500;
          color: ${COLORS.text};
          cursor: pointer;
          outline: none;
          flex-shrink: 0;
        ">
          <option value="auto">🌐 Auto</option>
          <option value="vi">🇻🇳 Việt</option>
          <option value="zh-TW">🇹🇼 繁中</option>
          <option value="zh-CN">🇨🇳 简中</option>
          <option value="id">🇮🇩 Indo</option>
          <option value="en">🇬🇧 EN</option>
          <option value="tl">🇵🇭 Filipino</option>
          <option value="th">🇹🇭 ไทย</option>
        </select>

        <!-- AI Auto-Send Toggle -->
        <div style="
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 0 6px;
          background: white;
          border: 1px solid ${COLORS.border};
          border-radius: 8px;
          height: 28px;
          flex-shrink: 0;
        ">
          <span style="font-size: 10px; font-weight: 600; color: ${COLORS.text};">AI</span>
          <div id="pit-ai-toggle" style="
            position: relative;
            width: 32px;
            height: 18px;
            background: ${this.aiAutoSendEnabled ? COLORS.primary : '#D1D5DB'};
            border-radius: 9px;
            cursor: pointer;
            transition: background 0.3s ease;
          ">
            <div id="pit-ai-toggle-knob" style="
              position: absolute;
              top: 2px;
              left: ${this.aiAutoSendEnabled ? '16px' : '2px'};
              width: 14px;
              height: 14px;
              background: white;
              border-radius: 50%;
              box-shadow: 0 1px 2px rgba(0,0,0,0.3);
              transition: left 0.3s ease;
            "></div>
          </div>
        </div>

      `;
    }

    setupEventHandlers() {
      // Auto-translate toggle
      const autoToggle = document.getElementById('pit-auto-toggle');
      if (autoToggle) {
        autoToggle.addEventListener('click', () => this.toggleAutoTranslate());
      }

      // Mode selector - Segmented Control with sliding indicator
      const modeButtons = document.querySelectorAll('.pit-mode-btn');
      modeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          this.selectMode(btn.dataset.mode);
        });
      });

      // Initialize indicator position after a short delay (DOM needs to render)
      setTimeout(() => this.updateIndicatorPosition(), 50);

      // Language override selector
      const langSelect = document.getElementById('pit-lang-select');
      if (langSelect) {
        langSelect.addEventListener('change', (e) => {
          this.overrideLanguage = e.target.value;
          log('Language override set to:', this.overrideLanguage);
        });
      }

      // AI Auto-Send toggle
      const aiToggle = document.getElementById('pit-ai-toggle');
      if (aiToggle) {
        aiToggle.addEventListener('click', () => this.toggleAiAutoSend());
      }

      // Intercept Enter key when AI toggle is ON
      this.setupEnterKeyIntercept();

      // Create button
      const createBtn = document.getElementById('pit-btn-create');
      if (createBtn) {
        createBtn.addEventListener('click', () => this.handleAction(false));
        createBtn.addEventListener('mouseenter', () => {
          createBtn.style.background = COLORS.primaryHover;
        });
        createBtn.addEventListener('mouseleave', () => {
          createBtn.style.background = COLORS.primary;
        });
      }
    }

    updateIndicatorPosition() {
      const indicator = document.getElementById('pit-mode-indicator');
      const activeBtn = document.querySelector(`.pit-mode-btn[data-mode="${this.selectedMode}"]`);
      const container = document.getElementById('pit-mode-container');

      if (indicator && activeBtn && container) {
        const containerRect = container.getBoundingClientRect();
        const btnRect = activeBtn.getBoundingClientRect();

        // Calculate position relative to container
        const left = btnRect.left - containerRect.left;
        indicator.style.width = `${btnRect.width}px`;
        indicator.style.transform = `translateX(${left - 4}px)`;
      }
    }

    async toggleAutoTranslate() {
      this.autoTranslateEnabled = !this.autoTranslateEnabled;

      // Save to storage
      await chrome.storage.local.set({ pitAutoTranslateEnabled: this.autoTranslateEnabled });

      // Update UI - iOS Toggle style
      const toggle = document.getElementById('pit-auto-toggle');
      const knob = document.getElementById('pit-toggle-knob');

      if (toggle) {
        toggle.style.background = this.autoTranslateEnabled ? COLORS.primary : '#D1D5DB';
      }
      if (knob) {
        knob.style.left = this.autoTranslateEnabled ? '20px' : '2px';
      }

      log('Auto-translate toggled:', this.autoTranslateEnabled);
    }

    async toggleAiAutoSend() {
      this.aiAutoSendEnabled = !this.aiAutoSendEnabled;

      // Save to storage
      await chrome.storage.local.set({ pitAiAutoSendEnabled: this.aiAutoSendEnabled });

      // Update UI
      const toggle = document.getElementById('pit-ai-toggle');
      const knob = document.getElementById('pit-ai-toggle-knob');

      if (toggle) {
        toggle.style.background = this.aiAutoSendEnabled ? COLORS.primary : '#D1D5DB';
      }
      if (knob) {
        knob.style.left = this.aiAutoSendEnabled ? '16px' : '2px';
      }

      // AI OFF: hide both buttons. AI ON: show Create only (Enter handles send)
      const createBtn = document.getElementById('pit-btn-create');
      const sendBtn = document.getElementById('pit-btn-send');
      if (createBtn) {
        createBtn.style.display = this.aiAutoSendEnabled ? 'flex' : 'none';
      }
      if (sendBtn) {
        sendBtn.style.display = 'none'; // always hidden
      }

      log('AI auto-send toggled:', this.aiAutoSendEnabled);
    }

    setupEnterKeyIntercept() {
      // Avoid duplicate listeners
      if (this._enterInterceptSetup) return;
      this._enterInterceptSetup = true;

      // Listen on document in capture phase - survives DOM re-renders
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.shiftKey) return;
        if (!e.isTrusted) return; // CRITICAL: ignore synthetic Enter to prevent infinite loop
        if (!this.aiAutoSendEnabled || this.isLoading) return;

        // Only intercept when the active element is the chat input
        const chatInput = document.querySelector(SELECTORS.chatInput);
        if (!chatInput || document.activeElement !== chatInput) return;

        const text = this.getPancakeChatInput();
        if (!text) return;

        e.preventDefault();
        e.stopImmediatePropagation();
        log('AI toggle ON - intercepting Enter to run Tạo & Gửi');
        this.handleAction(true);
      }, true); // capture phase

      log('Enter key intercept setup on document (capture phase)');
    }

    selectMode(mode) {
      this.selectedMode = mode;

      // Update button text colors
      const buttons = document.querySelectorAll('.pit-mode-btn');
      buttons.forEach(btn => {
        const isActive = btn.dataset.mode === mode;
        btn.style.color = isActive ? 'white' : COLORS.textMuted;
      });

      // Slide the indicator to new position
      this.updateIndicatorPosition();

      log('Mode selected:', mode);
    }

    // Get text from Pancake chat input
    getPancakeChatInput() {
      const input = document.querySelector(SELECTORS.chatInput);
      return input?.value?.trim() || '';
    }

    // Set text to Pancake chat input
    setPancakeChatInput(text) {
      const input = document.querySelector(SELECTORS.chatInput);
      if (input) {
        input.value = text;
        // Trigger input event for Pancake to detect change
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        // Focus the input
        input.focus();
      }
    }

    // Get last customer message
    getLastCustomerMessage() {
      const messages = document.querySelectorAll(SELECTORS.clientMessage);
      if (messages.length === 0) return null;

      const lastMsg = messages[messages.length - 1];
      const innerDiv = lastMsg.querySelector(':scope > div');
      if (!innerDiv) return null;

      // Get text content, excluding translations
      let text = '';
      for (const child of innerDiv.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          text += child.textContent;
        } else if (child.nodeType === Node.ELEMENT_NODE &&
                   !child.classList.contains('pit-translation') &&
                   !child.classList.contains('pit-loading')) {
          text += child.textContent;
        }
      }

      return text.trim();
    }

    // Extract conversation context - sorted by DOM order (chronological)
    extractConversation() {
      const messages = [];

      // Select ALL message elements and sort by DOM position (chronological order)
      const allMsgElements = document.querySelectorAll('.message-text-ele');

      allMsgElements.forEach(el => {
        const innerDiv = el.querySelector(':scope > div');
        if (!innerDiv) return;

        // Clone the div and remove translation/loading elements before extracting text
        const clonedDiv = innerDiv.cloneNode(true);

        // Remove all pit-translation, pit-loading, content-replied-message elements
        clonedDiv.querySelectorAll('.pit-translation, .pit-loading, .content-replied-message').forEach(child => {
          child.remove();
        });

        const text = clonedDiv.textContent.trim();
        if (!text) return;

        const isClient = el.classList.contains('client-message');
        messages.push({
          role: isClient ? 'customer' : 'shop',
          text
        });
      });

      log('Extracted conversation:', messages);
      return messages;
    }

    setLoading(loading) {
      this.isLoading = loading;

      const createBtn = document.getElementById('pit-btn-create');

      if (loading) {
        if (createBtn) {
          createBtn.innerHTML = `${ICONS.loading}<span>Đang tạo...</span>`;
          createBtn.classList.add('pit-btn-loading');
          createBtn.style.transition = 'all 0.3s ease';
          createBtn.style.opacity = '0.85';
          createBtn.style.transform = 'scale(0.98)';
          createBtn.disabled = true;
        }
      } else {
        if (createBtn) {
          createBtn.innerHTML = `${ICONS.sparkles}<span>Tạo</span>`;
          createBtn.classList.remove('pit-btn-loading');
          createBtn.style.opacity = '1';
          createBtn.style.transform = 'scale(1)';
          createBtn.disabled = false;
        }
      }
    }

    async handleAction(shouldSend) {
      if (this.isLoading) return;

      // Check API key
      if (!window.openaiTranslator?.getApiKey()) {
        alert('Chưa có API key. Vui lòng cài đặt trong popup extension.');
        return;
      }

      this.setLoading(true);

      try {
        let result;

        switch (this.selectedMode) {
          case 'auto-reply':
            // Read last customer message + context
            const conversation = this.extractConversation();
            if (conversation.length === 0) {
              alert('Không tìm thấy tin nhắn trong hội thoại.');
              this.setLoading(false);
              return;
            }
            result = await this.generateAutoReply(conversation);
            break;

          case 'expand-reply':
            // Get key points from chat input
            const keyPoints = this.getPancakeChatInput();
            if (!keyPoints) {
              alert('Vui lòng nhập ý chính vào ô chat trước.');
              this.setLoading(false);
              return;
            }
            const convForExpand = this.extractConversation();
            result = await this.expandKeyPoints(convForExpand, keyPoints);
            break;

          case 'translate-reply':
            // Get Vietnamese text from chat input
            const vnText = this.getPancakeChatInput();
            if (!vnText) {
              alert('Vui lòng nhập câu trả lời tiếng Việt vào ô chat trước.');
              this.setLoading(false);
              return;
            }
            const convForTranslate = this.extractConversation();
            result = await this.translateToCustomerLanguage(convForTranslate, vnText);
            break;
        }

        if (result) {
          // Extract foreign language reply and Vietnamese translation
          const foreignMatch = result.match(/REPLY:\s*(.+?)(?=VIET:|$)/s);
          const vietMatch = result.match(/VIET:\s*(.+?)$/s);

          const reply = foreignMatch ? foreignMatch[1].trim() : result;
          const vietTranslation = vietMatch ? vietMatch[1].trim() : '';

          // Set to chat input
          this.setPancakeChatInput(reply);

          // Show Vietnamese preview (for staff to understand)
          if (vietTranslation) {
            this.showVietPreview(vietTranslation);
          }

          // Auto send if requested
          if (shouldSend) {
            this.hideVietPreview();
            setTimeout(() => this.triggerSend(), 100);
          }
        }

      } catch (err) {
        log('Error:', err);
        this.hideVietPreview(); // Clear preview on error
        alert(`Lỗi: ${err.message}`);
      } finally {
        this.setLoading(false);
      }
    }

    triggerSend() {
      // Find Pancake's send button
      const sendBtns = document.querySelectorAll('.new-reply-box-btn');
      for (const btn of sendBtns) {
        // Look for the send icon (paper airplane)
        if (btn.querySelector('svg path[d*="M240,127.89"]') ||
            btn.innerHTML.includes('M3.105 2.288') ||
            btn.innerHTML.includes('M240,127.89')) {
          btn.click();
          log('Send button clicked');
          return;
        }
      }

      // Fallback: try keyboard Enter
      const chatInput = document.querySelector(SELECTORS.chatInput);
      if (chatInput) {
        const enterEvent = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true
        });
        chatInput.dispatchEvent(enterEvent);
        log('Enter key simulated');
      }
    }

    // ==================== AI Methods ====================

    /**
     * Detect the target language for response
     * Supported: Vietnamese, Chinese Traditional, Chinese Simplified, English, Indonesian, Filipino, Thai
     * Priority: 1) Override setting, 2) Customer messages, 3) Shop messages
     */
    async detectTargetLanguage(conversation) {
      // ===== STEP 0: Dropdown chọn cụ thể =====
      if (this.overrideLanguage && this.overrideLanguage !== 'auto') {
        const overrideMap = {
          'zh-TW': 'Chinese_Traditional',
          'zh-CN': 'Chinese_Simplified',
          'id': 'Indonesian',
          'en': 'English',
          'tl': 'Filipino',
          'th': 'Thai',
          'vi': 'Vietnamese'
        };
        const overrideLang = overrideMap[this.overrideLanguage];
        if (overrideLang) {
          log('[Step 0] Using language override:', overrideLang);
          return overrideLang;
        }
      }

      const customerMsgs = conversation.filter(m => m.role === 'customer');
      const shopMsgs = conversation.filter(m => m.role === 'shop');

      // ===== KEYWORD DETECTION FUNCTIONS =====

      const hasThai = (text) => /[\u0e00-\u0e7f]/.test(text);
      const countThai = (text) => (text.match(/[\u0e00-\u0e7f]/g) || []).length;

      const hasChinese = (text) => /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
      const countChinese = (text) => (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;

      const traditionalChars = /[繁體國語學習電話時間東師書長問題開發國際關係說話機構體會實際內對廣義經濟過業營應達設認識變數據貿處報財務組織證適進運幾機統計類農醫術與開團義監會學員職處經營組織評監類對問題]/;
      const simplifiedChars = /[简体国语学习电话时间东师书长问题开发国际关系说话机构体会实际内对广义经济过业营应达设认识变数据贸处报财务组织证适进运几机统计类农医术与开团义监会学员职处经营组织评监类对问题]/;
      const isTraditionalChinese = (text) => traditionalChars.test(text);
      const isSimplifiedChinese = (text) => simplifiedChars.test(text);

      const indonesianWords = [
        'apa', 'ini', 'itu', 'yang', 'dan', 'di', 'ke', 'dari', 'untuk', 'dengan',
        'tidak', 'ada', 'saya', 'anda', 'kamu', 'kami', 'mereka', 'sudah', 'belum',
        'bisa', 'bisah', 'mau', 'akan', 'harus', 'boleh', 'juga', 'atau', 'tapi', 'karena',
        'berapa', 'harga', 'harganya', 'produk', 'beli', 'jual', 'kirim', 'ongkir',
        'terima', 'kasih', 'selamat', 'pagi', 'siang', 'sore', 'malam', 'baik',
        'bagaimana', 'kapan', 'dimana', 'siapa', 'mengapa', 'kenapa', 'gimana',
        'dong', 'nih', 'ya', 'yah', 'sih', 'deh', 'loh', 'kan', 'kak', 'mas', 'mbak',
        'tolong', 'mohon', 'maaf', 'permisi', 'sampai', 'jumpa',
        'kalau', 'gak', 'ga', 'nggak', 'ngga', 'liat', 'lihat', 'muka', 'wajah',
        'sy', 'sya', 'emang', 'memang', 'udah', 'udh', 'blm', 'blum',
        'oke', 'oia', 'oiya', 'gitu', 'gini', 'banget', 'bgt',
        'hp', 'nomor', 'nomer', 'pake', 'pakai', 'coba', 'cobain',
        'mba', 'kaka', 'kakak', 'sis', 'min', 'gan', 'bro',
        'cocok', 'bagus', 'murah', 'mahal', 'cek', 'lagi', 'dulu',
        'nanti', 'aja', 'aje', 'nya', 'tahu', 'perlu'
      ];
      const countIndonesian = (text) => {
        const words = text.split(/\s+/);
        return words.filter(w => indonesianWords.includes(w.replace(/[^a-z]/g, ''))).length;
      };

      const filipinoWords = [
        'ang', 'ng', 'sa', 'na', 'at', 'ay', 'ko', 'mo', 'ka', 'ito', 'iyan', 'iyon',
        'ako', 'ikaw', 'siya', 'kami', 'tayo', 'sila', 'nila', 'namin', 'natin',
        'hindi', 'oo', 'opo', 'po', 'ho', 'ba', 'pa', 'din', 'rin', 'lang', 'lamang',
        'mga', 'kung', 'para', 'pero', 'kasi', 'dahil', 'kaya', 'pag', 'kapag',
        'magkano', 'ilan', 'saan', 'kailan', 'sino', 'ano', 'bakit', 'paano',
        'salamat', 'maraming', 'ingat', 'mabuhay', 'magandang', 'umaga',
        'hapon', 'gabi', 'tanghali', 'araw', 'gusto', 'ayaw', 'pwede', 'puwede',
        'meron', 'wala', 'mahal', 'mura', 'bili', 'benta', 'padala', 'kuha'
      ];
      const countFilipino = (text) => {
        const words = text.split(/\s+/);
        return words.filter(w => filipinoWords.includes(w.replace(/[^a-z]/g, ''))).length;
      };

      const englishWords = [
        'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
        'i', 'you', 'he', 'she', 'it', 'we', 'they', 'my', 'your', 'his', 'her',
        'this', 'that', 'these', 'those', 'what', 'which', 'who', 'where', 'when',
        'how', 'much', 'many', 'price', 'cost', 'buy', 'want', 'need', 'please',
        'thank', 'thanks', 'hello', 'hi', 'hey', 'good', 'morning', 'afternoon',
        'evening', 'night', 'yes', 'no', 'okay', 'can', 'may', 'help',
        'send', 'me', 'more', 'info', 'about', 'product', 'order', 'delivery',
        'ship', 'shipping', 'free', 'discount', 'set', 'skin', 'care', 'cream',
        'really', 'very', 'just', 'also', 'too', 'but', 'because', 'if', 'then',
        'with', 'from', 'for', 'not', 'don', 'doesn', 'didn', 'won'
      ];
      const countEnglish = (text) => {
        const words = text.split(/\s+/);
        return words.filter(w => englishWords.includes(w.replace(/[^a-z]/g, ''))).length;
      };

      const vietnameseRegex = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
      const hasVietnamese = (text) => vietnameseRegex.test(text);

      // ===== DETECT FROM SINGLE MESSAGE =====
      const detectFromText = (text) => {
        if (!text || text.trim().length === 0) return null;
        if (text.trim().length <= 2) return null;

        if (hasVietnamese(text)) return 'Vietnamese';
        if (hasThai(text) && countThai(text) >= 2) return 'Thai';
        if (hasChinese(text) && countChinese(text) >= 2) {
          if (isTraditionalChinese(text)) return 'Chinese_Traditional';
          if (isSimplifiedChinese(text)) return 'Chinese_Simplified';
          return 'Chinese_Traditional';
        }

        const indoScore = countIndonesian(text);
        const filipinoScore = countFilipino(text);
        const englishScore = countEnglish(text);
        log('Language scores:', { indo: indoScore, filipino: filipinoScore, english: englishScore });

        const maxLatinScore = Math.max(indoScore, filipinoScore, englishScore);
        if (maxLatinScore >= 1) {
          if (englishScore === maxLatinScore && englishScore > 0) return 'English';
          if (indoScore === maxLatinScore && indoScore > 0) return 'Indonesian';
          if (filipinoScore === maxLatinScore && filipinoScore > 0) return 'Filipino';
        }

        return null;
      };

      // ===== STEP 1: Tin cuối khách =====
      if (customerMsgs.length > 0) {
        const lastText = customerMsgs[customerMsgs.length - 1].text.toLowerCase();
        log('[Step 1] Last customer:', lastText.substring(0, 80));
        const lang = detectFromText(lastText);
        if (lang) { log('[Step 1] →', lang); return lang; }
      }

      // ===== STEP 2: 3 tin gần nhất khách =====
      if (customerMsgs.length > 1) {
        const recent = customerMsgs.slice(-4, -1);
        for (let i = recent.length - 1; i >= 0; i--) {
          const lang = detectFromText(recent[i].text.toLowerCase());
          if (lang) { log('[Step 2] →', lang); return lang; }
        }
      }

      // ===== STEP 3: 3 tin gần nhất shop =====
      if (shopMsgs.length > 0) {
        const recent = shopMsgs.slice(-3);
        for (let i = recent.length - 1; i >= 0; i--) {
          const lang = detectFromText(recent[i].text.toLowerCase());
          if (lang) { log('[Step 3] →', lang); return lang; }
        }
      }

      // ===== STEP 4: AI detect (tên khách + tin nhắn) =====
      log('[Step 4] Keyword failed, calling AI...');
      try {
        const aiLang = await this.aiDetectLanguage(customerMsgs);
        if (aiLang && aiLang !== 'unknown') {
          log('[Step 4] AI →', aiLang);
          return aiLang;
        }
      } catch (e) {
        log('[Step 4] AI error:', e.message);
      }

      // ===== STEP 5: Thông báo nhân viên chọn =====
      log('[Step 5] All detection failed');
      return 'ask_user';
    }

    // AI-powered language detection (Pancake: lấy tên từ sidebar hoặc customer info panel)
    async aiDetectLanguage(customerMsgs) {
      const customerName =
        document.querySelector('.conversation-list-item.selected .name-text')?.textContent?.trim() ||
        document.querySelector('.customer-info-wrapper .copyable-text.customer-name')?.textContent?.trim() ||
        '';

      const recentTexts = customerMsgs.slice(-4).map((m, i) => `${i + 1}. "${m.text}"`).join('\n');

      const prompt = `Xác định ngôn ngữ chính của khách hàng này.

Tên khách: ${customerName}
Tin nhắn của khách:
${recentTexts || '(chưa có tin nhắn text)'}

Dựa vào tên khách và nội dung tin nhắn, khách này sử dụng ngôn ngữ gì?
Trả lời CHỈ 1 trong các giá trị sau:
Chinese_Traditional / Chinese_Simplified / English / Indonesian / Filipino / Thai / Vietnamese

Nếu không đủ dữ liệu để xác định, trả lời: unknown`;

      log('[AI Detect] Prompt:', prompt);

      const response = await window.openaiTranslator.callOpenAIGeneral(prompt, 'gpt-4.1-nano');
      const result = response?.trim();
      log('[AI Detect] Response:', result);

      const validLangs = ['Chinese_Traditional', 'Chinese_Simplified', 'English', 'Indonesian', 'Filipino', 'Thai', 'Vietnamese', 'unknown'];
      if (validLangs.includes(result)) return result;

      for (const lang of validLangs) {
        if (result?.includes(lang)) return lang;
      }

      return 'unknown';
    }

    async generateAutoReply(conversation) {
      const systemPrompt = await this.getSystemPrompt();
      const customerMsgs = conversation.filter(m => m.role === 'customer');
      const lastCustomerMsg = customerMsgs[customerMsgs.length - 1];

      if (!lastCustomerMsg) {
        throw new Error('Không tìm thấy tin nhắn của khách');
      }

      // Limit to last 50 messages (both shop + customer) for token optimization
      const recentConversation = conversation.slice(-50);
      const conversationText = recentConversation.map(m =>
        `${m.role === 'customer' ? 'Khách' : 'Shop'}: ${m.text}`
      ).join('\n');

      // Detect target language
      const targetLang = await this.detectTargetLanguage(conversation);
      if (targetLang === 'ask_user') {
        throw new Error('Không nhận diện được ngôn ngữ khách. Vui lòng chọn ngôn ngữ trên dropdown.');
      }
      const langInstruction = this.getLangInstruction(targetLang, 'trả lời');
      const lengthGuide = this.getLengthGuide();
      const langDisplay = targetLang === 'auto' ? 'ngôn ngữ của khách' : targetLang;

      const prompt = `🔴 SYSTEM RULES - LUẬT BẤT DI BẤT DỊCH (PHẢI TUÂN THỦ 100%):
---
${systemPrompt}
---

📝 HỘI THOẠI GẦN NHẤT (${recentConversation.length} tin nhắn):
---
${conversationText}
---

🎯 TIN NHẮN CUỐI CỦA KHÁCH:
"${lastCustomerMsg.text}"

📋 NHIỆM VỤ CỦA BẠN:
1. ĐỌC KỸ SYSTEM RULES ở trên - đây là luật không được vi phạm
2. PHÂN TÍCH toàn bộ hội thoại để hiểu context
3. XÁC ĐỊNH câu hỏi/yêu cầu CHÍNH của khách trong tin nhắn cuối
4. KIỂM TRA shop đã hỏi/nói gì trước đó - TUYỆT ĐỐI KHÔNG lặp lại
5. TẠO câu trả lời TIẾP NỐI hội thoại một cách tự nhiên

🚫 TUYỆT ĐỐI KHÔNG ĐƯỢC:
- Hỏi lại câu hỏi shop đã hỏi rồi
- Yêu cầu thông tin shop đã yêu cầu rồi
- Lặp lại nội dung tin nhắn trước của shop
- Nếu khách trả lời ngắn (yes/ok/được) → hiểu họ đồng ý với yêu cầu trước đó → TIẾN TỚI BƯỚC TIẾP THEO

⚠️ QUY TẮC TRẢ LỜI NGHIÊM NGẶT:
- Tuân thủ 100% nội dung trong SYSTEM RULES
- ${langInstruction}
- ${lengthGuide}
- KHÔNG bịa thông tin không có trong SYSTEM RULES hoặc hội thoại
- Nếu không biết thông tin → nói sẽ kiểm tra và phản hồi sau

Format output:
REPLY: [câu trả lời - PHẢI đúng ngôn ngữ: ${langDisplay}]
VIET: [bản dịch tiếng Việt cho nhân viên hiểu]`;

      // DEBUG: Log full prompt
      if (DEBUG) {
        console.log('[PIT-Debug] ========== FULL PROMPT ==========');
        console.log(prompt);
        console.log('[PIT-Debug] ========== END PROMPT ==========');
        console.log('[PIT-Debug] System Prompt length:', systemPrompt.length);
        console.log('[PIT-Debug] Conversation length:', recentConversation.length);
        console.log('[PIT-Debug] Target language:', targetLang);
      }

      try {
        // Use replyModel for auto-reply function
        const response = await window.openaiTranslator.callOpenAI(prompt, this.replyModel);

        // DEBUG: Log response
        if (DEBUG) {
          console.log('[PIT-Debug] ========== AI RESPONSE ==========');
          console.log(response);
          console.log('[PIT-Debug] ========== END RESPONSE ==========');
        }

        // Validate response format
        if (!response || (!response.includes('REPLY:') && !response.includes('Reply:'))) {
          throw new Error('Invalid response format');
        }

        return response;
      } catch (error) {
        log('generateAutoReply failed:', error.message);

        // User-friendly error messages
        if (error.message.includes('rate') || error.message.includes('429')) {
          throw new Error('⏳ Đang quá tải, vui lòng thử lại sau 30 giây');
        }
        if (error.message.includes('network') || error.message.includes('fetch')) {
          throw new Error('🌐 Lỗi kết nối mạng, vui lòng kiểm tra internet');
        }
        if (error.message.includes('API key') || error.message.includes('401')) {
          throw new Error('🔑 API key không hợp lệ, vui lòng kiểm tra Settings');
        }
        if (error.message.includes('Invalid response')) {
          throw new Error('⚠️ AI trả lời sai format, vui lòng thử lại');
        }

        throw new Error('❌ Không thể tạo câu trả lời. Vui lòng thử lại.');
      }
    }

    async expandKeyPoints(conversation, keyPoints) {
      // Validate input
      if (!keyPoints || keyPoints.trim().length === 0) {
        throw new Error('📝 Vui lòng nhập ý chính');
      }

      const systemPrompt = await this.getSystemPrompt();

      // Limit to last 50 messages (both shop + customer) for token optimization
      const recentConversation = conversation.slice(-50);
      const conversationText = recentConversation.map(m =>
        `${m.role === 'customer' ? 'Khách' : 'Shop'}: ${m.text}`
      ).join('\n');

      // Detect target language - CRITICAL
      const targetLang = await this.detectTargetLanguage(conversation);
      if (targetLang === 'ask_user') {
        throw new Error('Không nhận diện được ngôn ngữ khách. Vui lòng chọn ngôn ngữ trên dropdown.');
      }
      const langInstruction = this.getLangInstruction(targetLang, 'viết');
      const lengthGuide = this.getLengthGuide();
      const langDisplay = targetLang === 'auto' ? 'ngôn ngữ của khách' : targetLang;

      const prompt = `🔴 SYSTEM RULES - LUẬT BẤT DI BẤT DỊCH (PHẢI TUÂN THỦ 100%):
---
${systemPrompt}
---

📝 HỘI THOẠI GẦN NHẤT (${recentConversation.length} tin nhắn):
---
${conversationText}
---

✍️ Ý CHÍNH TỪ NHÂN VIÊN (tiếng Việt):
"${keyPoints}"

📋 NHIỆM VỤ CỦA BẠN:
1. ĐỌC KỸ SYSTEM RULES ở trên - đây là luật không được vi phạm
2. PHÂN TÍCH toàn bộ hội thoại để hiểu context và tone
3. HIỂU ý chính mà nhân viên muốn truyền đạt
4. MỞ RỘNG ý chính thành câu văn hoàn chỉnh, chuyên nghiệp
5. GIỮ NGUYÊN meaning - KHÔNG thêm thông tin nhân viên không đề cập

⚠️ QUY TẮC VIẾT NGHIÊM NGẶT:
- Tuân thủ 100% nội dung trong SYSTEM RULES
- ${langInstruction}
- Ý chính = NỘI DUNG muốn nói (tiếng Việt)
- Output = NGÔN NGỮ CỦA KHÁCH
- ${lengthGuide}
- KHÔNG thêm cam kết, hứa hẹn, giá cả mà ý chính không đề cập
- KHÔNG bịa thông tin không có trong SYSTEM RULES

Format output:
REPLY: [câu trả lời hoàn chỉnh - PHẢI đúng ngôn ngữ: ${langDisplay}]
VIET: [bản dịch tiếng Việt cho nhân viên hiểu]`;

      // DEBUG: Log key points expansion
      if (DEBUG) {
        console.log('[PIT-Debug] ========== EXPAND KEY POINTS ==========');
        console.log('[PIT-Debug] Key points:', keyPoints);
        console.log('[PIT-Debug] Target language:', targetLang);
      }

      try {
        // Use expandModel for expand key points function
        const response = await window.openaiTranslator.callOpenAI(prompt, this.expandModel);

        // DEBUG: Log response
        if (DEBUG) {
          console.log('[PIT-Debug] ========== AI RESPONSE ==========');
          console.log(response);
          console.log('[PIT-Debug] ========== END RESPONSE ==========');
        }

        // Validate response format
        if (!response || (!response.includes('REPLY:') && !response.includes('Reply:'))) {
          throw new Error('Invalid response format');
        }

        return response;
      } catch (error) {
        log('expandKeyPoints failed:', error.message);

        // User-friendly error messages
        if (error.message.includes('rate') || error.message.includes('429')) {
          throw new Error('⏳ Đang quá tải, vui lòng thử lại sau 30 giây');
        }
        if (error.message.includes('network') || error.message.includes('fetch')) {
          throw new Error('🌐 Lỗi kết nối mạng, vui lòng kiểm tra internet');
        }
        if (error.message.includes('API key') || error.message.includes('401')) {
          throw new Error('🔑 API key không hợp lệ, vui lòng kiểm tra Settings');
        }
        if (error.message.includes('Invalid response')) {
          throw new Error('⚠️ AI trả lời sai format, vui lòng thử lại');
        }

        throw new Error('❌ Không thể mở rộng ý chính. Vui lòng thử lại.');
      }
    }

    async translateToCustomerLanguage(conversation, vietnameseText) {
      // Detect target language
      const targetLang = await this.detectTargetLanguage(conversation);
      if (targetLang === 'ask_user') {
        throw new Error('Không nhận diện được ngôn ngữ khách. Vui lòng chọn ngôn ngữ trên dropdown.');
      }
      const langInstruction = this.getLangInstruction(targetLang, 'dịch sang');

      const conversationText = conversation.slice(-50).map(m =>
        `${m.role === 'customer' ? 'Khách' : 'Shop'}: ${m.text}`
      ).join('\n');

      const prompt = `Hội thoại gần đây:
${conversationText}

Câu cần dịch:
"""
${vietnameseText}
"""

🔴 YÊU CẦU: ${langInstruction}
- Dịch TOÀN BỘ sang ngôn ngữ khách, KHÔNG giữ lại bất kỳ từ nào từ ngôn ngữ gốc trong output
- GIỮ NGUYÊN ĐỊNH DẠNG: xuống dòng, emoji, số thứ tự, ký hiệu đặc biệt phải giữ đúng vị trí như bản gốc
- KHÔNG gộp nhiều dòng thành 1 dòng
- KHÔNG thay đổi cấu trúc danh sách

Trả lời ĐÚNG format sau (không thêm bất kỳ text nào khác):
REPLY: [chỉ bản dịch sang ngôn ngữ khách - giữ nguyên format xuống dòng]
VIET: ${vietnameseText}`;

      // Use translateModel for translate function (same as conversation translation)
      return await window.openaiTranslator.callOpenAI(prompt, this.translateModel);
    }

    async getSystemPrompt() {
      try {
        const result = await chrome.storage.local.get('pitSystemPrompt');
        return result.pitSystemPrompt || 'Bạn là nhân viên bán hàng chuyên nghiệp, thân thiện.';
      } catch (e) {
        return 'Bạn là nhân viên bán hàng chuyên nghiệp, thân thiện.';
      }
    }

    getLengthGuide() {
      switch (this.responseLength) {
        case 'short':
          return '- Trả lời ngắn gọn, 1-2 câu';
        case 'detailed':
          return '- Trả lời chi tiết, đầy đủ thông tin';
        default:
          return '- Trả lời vừa phải, 2-3 câu';
      }
    }

    /**
     * Get language instruction for AI prompt
     * @param {string} lang - Detected language code
     * @param {string} action - Action verb (trả lời, viết, dịch sang)
     * @returns {string} Instruction text
     */
    getLangInstruction(lang, action = 'trả lời') {
      const langMap = {
        'Chinese_Traditional': 'tiếng Trung phồn thể (繁體中文)',
        'Chinese_Simplified': 'tiếng Trung giản thể (简体中文)',
        'English': 'tiếng Anh (English)',
        'Indonesian': 'tiếng Indonesia (Bahasa Indonesia)',
        'Filipino': 'tiếng Philippines/Tagalog (Filipino)',
        'Thai': 'tiếng Thái (ภาษาไทย)',
        'Vietnamese': 'tiếng Việt (Vietnamese)'
      };

      if (lang === 'auto' || !langMap[lang]) {
        return `${action.charAt(0).toUpperCase() + action.slice(1)} bằng ngôn ngữ mà khách hàng đang sử dụng trong hội thoại.`;
      }

      return `BẮT BUỘC ${action} bằng ${langMap[lang]}`;
    }

    // ==================== Vietnamese Preview ====================

    showVietPreview(text) {
      // Remove existing preview
      this.hideVietPreview();

      // Find the flex row containing textarea (parent of reply-box__text-area's wrapper)
      const replyBox = document.querySelector('.reply-box__text-area');
      if (!replyBox) return;

      // Navigate up to find the flex row (display: flex; height: 198px)
      // Structure: reply-box-container > div[flex row] > div[wrapper] > reply-box__text-area
      const flexRow = replyBox.closest('.reply-box-container > div');
      if (!flexRow) return;

      const preview = document.createElement('div');
      preview.id = 'pit-viet-preview';
      preview.style.cssText = `
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 8px 12px;
        margin: 4px 8px;
        background: ${COLORS.primaryLight};
        border: 1px solid ${COLORS.primary};
        border-radius: 8px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
        color: ${COLORS.text};
        line-height: 1.5;
      `;

      preview.innerHTML = `
        <div style="
          flex-shrink: 0;
          padding: 3px 8px;
          background: ${COLORS.primary};
          color: white;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 600;
        ">VN</div>
        <div style="flex: 1; word-break: break-word;">${this.escapeHtml(text)}</div>
        <button id="pit-preview-close" style="
          flex-shrink: 0;
          padding: 4px 8px;
          background: transparent;
          border: 1px solid ${COLORS.border};
          border-radius: 4px;
          font-size: 11px;
          color: ${COLORS.textMuted};
          cursor: pointer;
        ">✕</button>
      `;

      // Insert after the flex row (between textarea row and toolbar row)
      flexRow.parentElement.insertBefore(preview, flexRow.nextSibling);

      // Close button handler
      const closeBtn = document.getElementById('pit-preview-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => this.hideVietPreview());
      }

      log('Vietnamese preview shown');
    }

    hideVietPreview() {
      const preview = document.getElementById('pit-viet-preview');
      if (preview) {
        preview.remove();
        log('Vietnamese preview hidden');
      }
    }

    escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  }

  // Initialize when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new InlineToolbar());
  } else {
    new InlineToolbar();
  }

  // Expose for debugging
  window.pitInlineToolbar = InlineToolbar;
})();
