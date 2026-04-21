// lib/openai-translator.js - Groq Translation Service
// Performance optimized: Token-aware batching, Hybrid cache, Simple throttle
// v4.0.0 - Groq API + Context-aware translation

(function() {
  'use strict';

  const DEBUG = false;
  const log = (...args) => DEBUG && console.log('[OpenAITranslator]', ...args);

  // Default AI params (balanced preset)
  const DEFAULT_AI_PARAMS = {
    temperature: 0.5,
    top_p: 0.85,
    presence_penalty: 0.2,
    frequency_penalty: 0.3
  };

  // ==================== CONSTANTS ====================
  const MAX_TOKENS_PER_BATCH = 3000; // Leave room for response
  const APPROX_CHARS_PER_TOKEN = 4; // Approximate for CJK languages
  const L1_CACHE_MAX_SIZE = 200; // Memory cache
  const L2_DB_NAME = 'PancakeTranslatorCache';
  const L2_STORE_NAME = 'translations';
  const L2_CACHE_EXPIRY_DAYS = 7;

  // Groq API settings
  const GROQ_API_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
  const GROQ_TRANSLATE_MODEL = 'qwen/qwen3-32b';
  const GROQ_GENERAL_MODEL_FALLBACK = 'llama-3.3-70b-versatile';
  const REQUEST_DELAY_MS = 50; // Simple delay between requests

  // OpenAI fallback settings
  const OPENAI_API_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
  const OPENAI_FALLBACK_MODEL = 'gpt-4.1-mini';

  // ==================== IndexedDB L2 Cache ====================
  class IndexedDBCache {
    constructor() {
      this.db = null;
      this.ready = false;
    }

    async init() {
      if (this.ready) return;

      return new Promise((resolve, reject) => {
        const request = indexedDB.open(L2_DB_NAME, 1);

        request.onerror = () => {
          log('IndexedDB error:', request.error);
          this.ready = false;
          resolve(); // Don't block on error
        };

        request.onsuccess = () => {
          this.db = request.result;
          this.ready = true;
          log('IndexedDB ready');
          this.cleanup(); // Clean expired entries
          resolve();
        };

        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(L2_STORE_NAME)) {
            const store = db.createObjectStore(L2_STORE_NAME, { keyPath: 'key' });
            store.createIndex('timestamp', 'timestamp', { unique: false });
          }
        };
      });
    }

    async get(key) {
      if (!this.ready || !this.db) return null;

      return new Promise((resolve) => {
        try {
          const transaction = this.db.transaction([L2_STORE_NAME], 'readonly');
          const store = transaction.objectStore(L2_STORE_NAME);
          const request = store.get(key);

          request.onsuccess = () => {
            const result = request.result;
            if (result) {
              // Check expiry
              const expiryMs = L2_CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
              if (Date.now() - result.timestamp < expiryMs) {
                resolve(result.value);
              } else {
                this.delete(key); // Clean expired
                resolve(null);
              }
            } else {
              resolve(null);
            }
          };

          request.onerror = () => resolve(null);
        } catch (e) {
          resolve(null);
        }
      });
    }

    async set(key, value) {
      if (!this.ready || !this.db) return;

      return new Promise((resolve) => {
        try {
          const transaction = this.db.transaction([L2_STORE_NAME], 'readwrite');
          const store = transaction.objectStore(L2_STORE_NAME);
          store.put({ key, value, timestamp: Date.now() });
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => resolve();
        } catch (e) {
          resolve();
        }
      });
    }

    async delete(key) {
      if (!this.ready || !this.db) return;

      try {
        const transaction = this.db.transaction([L2_STORE_NAME], 'readwrite');
        const store = transaction.objectStore(L2_STORE_NAME);
        store.delete(key);
      } catch (e) {
        // Ignore errors
      }
    }

    async cleanup() {
      if (!this.ready || !this.db) return;

      const expiryMs = L2_CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
      const cutoff = Date.now() - expiryMs;

      try {
        const transaction = this.db.transaction([L2_STORE_NAME], 'readwrite');
        const store = transaction.objectStore(L2_STORE_NAME);
        const index = store.index('timestamp');
        const range = IDBKeyRange.upperBound(cutoff);
        const request = index.openCursor(range);

        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            store.delete(cursor.primaryKey);
            cursor.continue();
          }
        };
      } catch (e) {
        log('Cleanup error:', e);
      }
    }

    async clear() {
      if (!this.ready || !this.db) return;

      return new Promise((resolve) => {
        try {
          const transaction = this.db.transaction([L2_STORE_NAME], 'readwrite');
          const store = transaction.objectStore(L2_STORE_NAME);
          store.clear();
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => resolve();
        } catch (e) {
          resolve();
        }
      });
    }

    async getStats() {
      if (!this.ready || !this.db) return { count: 0 };

      return new Promise((resolve) => {
        try {
          const transaction = this.db.transaction([L2_STORE_NAME], 'readonly');
          const store = transaction.objectStore(L2_STORE_NAME);
          const countRequest = store.count();
          countRequest.onsuccess = () => resolve({ count: countRequest.result });
          countRequest.onerror = () => resolve({ count: 0 });
        } catch (e) {
          resolve({ count: 0 });
        }
      });
    }
  }

  // ==================== Simple hash for context cache key ====================
  function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  // ==================== Main Translator Class ====================
  class OpenAITranslator {
    constructor() {
      this.apiKey = null;
      this.groqApiKey = null;
      this.openaiApiKey = null;
      // L1 Cache (Memory - fast, volatile)
      this.l1Cache = new Map();
      // L2 Cache (IndexedDB - persistent, larger)
      this.l2Cache = new IndexedDBCache();
      // Pending requests to prevent duplicates
      this.pendingRequests = new Map();
      // Last request time for simple throttle
      this.lastRequestTime = 0;
      // Stats
      this.stats = {
        l1Hits: 0,
        l2Hits: 0,
        apiCalls: 0,
        tokensSaved: 0
      };
      this.initialized = false;
    }

    // Load API key from storage
    async init() {
      if (this.initialized) return;

      try {
        // Initialize IndexedDB L2 cache
        await this.l2Cache.init();

        // Load both Groq and OpenAI keys
        const data = await chrome.storage.local.get(['groqApiKey', 'openaiApiKey', 'vaesa_unified_license', 'pitLicenseCache']);
        this.groqApiKey = data.groqApiKey || null;
        this.openaiApiKey = data.openaiApiKey || null;

        // Fallback: read from license cache if keys not saved directly
        if (!this.groqApiKey || !this.openaiApiKey) {
          const lc = data.vaesa_unified_license;
          if (lc) {
            if (!this.groqApiKey && lc.groqApiKey) this.groqApiKey = lc.groqApiKey;
            if (!this.openaiApiKey && lc.openaiApiKey) this.openaiApiKey = lc.openaiApiKey;
            // Old format: single apiKey → use as groqApiKey
            if (!this.groqApiKey && !this.openaiApiKey && lc.apiKey) this.groqApiKey = lc.apiKey;
          }
          // Also check pitLicenseCache (legacy)
          if (!this.groqApiKey && data.pitLicenseCache?.apiKey) {
            this.groqApiKey = data.pitLicenseCache.apiKey;
          }
          // Save back to storage so next time is instant
          const toSave = {};
          if (this.groqApiKey && !data.groqApiKey) toSave.groqApiKey = this.groqApiKey;
          if (this.openaiApiKey && !data.openaiApiKey) toSave.openaiApiKey = this.openaiApiKey;
          if (Object.keys(toSave).length > 0) chrome.storage.local.set(toSave);
        }

        this.apiKey = this.groqApiKey;
        if (this.groqApiKey) log('Groq API key loaded');
        if (this.openaiApiKey) log('OpenAI API key loaded');

        // Load legacy cache into L1 (for backward compatibility)
        const cacheResult = await chrome.storage.local.get(['pitTranslationCache']);
        if (cacheResult.pitTranslationCache) {
          const entries = Object.entries(cacheResult.pitTranslationCache);
          entries.forEach(([key, value]) => {
            this.l1Cache.set(key, value);
          });
          log('Loaded', this.l1Cache.size, 'cached translations from legacy storage');

          // Migrate to L2 cache in background
          this.migrateToL2(cacheResult.pitTranslationCache);
        }

        this.initialized = true;
      } catch (e) {
        log('Failed to load from storage:', e.message);
        this.initialized = true;
      }
    }

    // Get Groq API key from chrome.storage.local
    async getGroqApiKey() {
      try {
        const result = await chrome.storage.local.get(['groqApiKey']);
        return result.groqApiKey || null;
      } catch (e) {
        return null;
      }
    }

    // Refresh API key from LicenseService
    async refreshApiKey() {
      if (window.licenseService) {
        const result = await window.licenseService.refreshLicense();
        if (result.valid && result.apiKey) {
          this.apiKey = result.apiKey;
          log('API key refreshed from LicenseService');
          return true;
        }
      }
      return false;
    }

    async migrateToL2(legacyCache) {
      // Migrate legacy cache to IndexedDB in background
      for (const [key, value] of Object.entries(legacyCache)) {
        await this.l2Cache.set(key, value);
      }
      log('Migrated', Object.keys(legacyCache).length, 'entries to IndexedDB');

      // Clear legacy storage
      chrome.storage.local.remove('pitTranslationCache');
    }

    setApiKey(key) {
      this.apiKey = key;
      this.groqApiKey = key;
      chrome.storage.local.set({ groqApiKey: key });
    }

    getApiKey() {
      return this.apiKey;
    }

    getCacheKey(text, srcLang) {
      return `${srcLang}:vi:${text}`;
    }

    getContextCacheKey(text, srcLang, contextMessages) {
      const contextStr = contextMessages.map(m => `${m.role}:${m.text}`).join('|');
      const hash = simpleHash(contextStr);
      return `ctx:${hash}:${srcLang}:${text}`;
    }

    // ==================== Hybrid Cache Get ====================
    async getFromCache(key) {
      // L1 first (memory - instant)
      if (this.l1Cache.has(key)) {
        this.stats.l1Hits++;
        return this.l1Cache.get(key);
      }

      // L2 fallback (IndexedDB - slightly slower)
      const l2Value = await this.l2Cache.get(key);
      if (l2Value) {
        this.stats.l2Hits++;
        // Promote to L1 for faster future access
        this.setL1Cache(key, l2Value);
        return l2Value;
      }

      return null;
    }

    // ==================== Hybrid Cache Set ====================
    async setCache(key, value) {
      this.setL1Cache(key, value);
      await this.l2Cache.set(key, value);
    }

    setL1Cache(key, value) {
      // Evict if L1 cache is full
      if (this.l1Cache.size >= L1_CACHE_MAX_SIZE) {
        const firstKey = this.l1Cache.keys().next().value;
        this.l1Cache.delete(firstKey);
      }
      this.l1Cache.set(key, value);
    }

    // ==================== Token Estimation ====================
    estimateTokens(text) {
      // CJK characters ~= 1-2 tokens per char, Latin ~= 4 chars per token
      let tokens = 0;
      for (const char of text) {
        if (/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\u0e00-\u0e7f]/.test(char)) {
          tokens += 1.5; // CJK/Thai
        } else {
          tokens += 0.25; // Latin
        }
      }
      return Math.ceil(tokens);
    }

    // ==================== Smart Batching ====================
    createBatches(items) {
      const batches = [];
      let currentBatch = [];
      let currentTokens = 0;

      for (const item of items) {
        const itemTokens = this.estimateTokens(item.text);

        // If single item exceeds limit, put in its own batch
        if (itemTokens > MAX_TOKENS_PER_BATCH) {
          if (currentBatch.length > 0) {
            batches.push(currentBatch);
            currentBatch = [];
            currentTokens = 0;
          }
          batches.push([item]);
          continue;
        }

        // If adding this would exceed limit, start new batch
        if (currentTokens + itemTokens > MAX_TOKENS_PER_BATCH) {
          batches.push(currentBatch);
          currentBatch = [item];
          currentTokens = itemTokens;
        } else {
          currentBatch.push(item);
          currentTokens += itemTokens;
        }
      }

      if (currentBatch.length > 0) {
        batches.push(currentBatch);
      }

      return batches;
    }

    // Simple delay between requests (Groq handles throttling better)
    async waitIfNeeded() {
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      if (this.lastRequestTime > 0 && timeSinceLastRequest < REQUEST_DELAY_MS) {
        await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS - timeSinceLastRequest));
      }
      this.lastRequestTime = Date.now();
    }

    async translateToVietnamese(text, srcLang = 'auto') {
      if (!text || text.trim().length === 0) return text;

      if (!this.apiKey) {
        throw new Error('API key not configured');
      }

      const cacheKey = this.getCacheKey(text, srcLang);

      // Check hybrid cache
      const cached = await this.getFromCache(cacheKey);
      if (cached) {
        log('Cache hit (L1/L2)');
        return cached;
      }

      // Check if same request is pending (prevent duplicate API calls)
      if (this.pendingRequests.has(cacheKey)) {
        log('Waiting for pending request...');
        return this.pendingRequests.get(cacheKey);
      }

      // Create request promise
      const requestPromise = this.callOpenAITranslate(text, srcLang);
      this.pendingRequests.set(cacheKey, requestPromise);

      try {
        const result = await requestPromise;
        await this.setCache(cacheKey, result);
        return result;
      } finally {
        this.pendingRequests.delete(cacheKey);
      }
    }

    async translateWithContext(text, srcLang = 'auto', contextMessages = [], currentRole = 'customer') {
      if (!text || text.trim().length === 0) return text;

      if (!this.apiKey) {
        throw new Error('API key not configured');
      }

      // If no context, fall back to regular translation with role
      if (!contextMessages || contextMessages.length === 0) {
        return this.callOpenAITranslate(text, srcLang, [], currentRole);
      }

      const cacheKey = this.getContextCacheKey(text, srcLang, contextMessages);

      // Check hybrid cache
      const cached = await this.getFromCache(cacheKey);
      if (cached) {
        log('Context cache hit (L1/L2)');
        return cached;
      }

      // Check if same request is pending
      if (this.pendingRequests.has(cacheKey)) {
        log('Waiting for pending context request...');
        return this.pendingRequests.get(cacheKey);
      }

      // Create request promise
      const requestPromise = this.callOpenAITranslate(text, srcLang, contextMessages, currentRole);
      this.pendingRequests.set(cacheKey, requestPromise);

      try {
        const result = await requestPromise;
        await this.setCache(cacheKey, result);
        return result;
      } finally {
        this.pendingRequests.delete(cacheKey);
      }
    }

    // Get AI params from storage or return defaults
    async getAiParams() {
      try {
        const result = await chrome.storage.local.get(['pitAiParams']);
        return result.pitAiParams || DEFAULT_AI_PARAMS;
      } catch (e) {
        return DEFAULT_AI_PARAMS;
      }
    }

    // Get model settings from storage
    async getModelSettings() {
      try {
        const result = await chrome.storage.local.get([
          'pitTranslateModel',
          'pitReplyModel',
          'pitExpandModel'
        ]);
        return {
          translate: result.pitTranslateModel || 'llama-3.3-70b-versatile',
          reply: result.pitReplyModel || 'llama-3.3-70b-versatile',
          expand: result.pitExpandModel || 'llama-3.3-70b-versatile'
        };
      } catch (e) {
        return {
          translate: 'llama-3.3-70b-versatile',
          reply: 'llama-3.3-70b-versatile',
          expand: 'llama-3.3-70b-versatile'
        };
      }
    }

    async callOpenAI(promptOrText, modelOrSrcLang = 'llama-3.3-70b-versatile') {
      // Determine if this is a translation call or a general prompt call
      // Translation calls have srcLang like 'zh-TW', 'en', 'id', etc.
      // General prompt calls from inline-toolbar have model like 'llama-3.3-70b-versatile'
      const isTranslationCall = ['zh-TW', 'zh-CN', 'en', 'id', 'tl', 'th', 'auto'].includes(modelOrSrcLang);

      if (isTranslationCall) {
        return this.callOpenAITranslate(promptOrText, modelOrSrcLang);
      } else {
        return this.callOpenAIGeneral(promptOrText, modelOrSrcLang);
      }
    }

    // Translation method - uses Groq with context-aware prompting
    async callOpenAITranslate(text, srcLang, contextMessages, currentRole = 'customer') {
      // Apply simple throttle
      await this.waitIfNeeded();

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

      let userContent;

      const roleLabel = (role) => role === 'customer' ? '[KH]' : '[NV]';
      const currentTag = roleLabel(currentRole);

      if (contextMessages && contextMessages.length > 0) {
        // Build context-aware prompt with current message tagged
        const contextLines = contextMessages
          .map(m => `${roleLabel(m.role)}: ${m.text}`)
          .join('\n');

        userContent = `Ngữ cảnh hội thoại:\n${contextLines}\n\nDịch tin nhắn sau sang tiếng Việt (chỉ trả về bản dịch):\n${currentTag}: ${text}`;
      } else {
        userContent = `Dịch tin nhắn sau sang tiếng Việt (chỉ trả về bản dịch):\n${currentTag}: ${text}`;
      }

      const systemContent = 'Bạn là dịch giả chuyên nghiệp hỗ trợ nhóm CSKH bán hàng online người Việt. Dịch tin nhắn sang tiếng Việt tự nhiên, giữ nguyên emoji. Chỉ trả về bản dịch thuần, không kèm tag, không giải thích, không thêm ký tự nào ngoài bản dịch.\n\nBối cảnh: Hội thoại bán hàng online đa ngôn ngữ (Trung, Anh, Indonesia, Tagalog, Thái...). Khi gặp tin nhắn ngắn hoặc viết tắt, hãy suy luận từ ngữ cảnh hội thoại trước đó để dịch đúng nghĩa.\n\nQuy tắc quan trọng:\n- Tên sản phẩm, mã sản phẩm, tên thương hiệu (ví dụ: "M美白", "SK-II", "A3 serum"...) → GIỮ NGUYÊN, không dịch, không thêm bất kỳ ký tự nào như "=", "()", [].\n- Nếu tin nhắn chỉ gồm tên sản phẩm → giữ nguyên toàn bộ.\n- KHÔNG giải thích, KHÔNG thêm chú thích, KHÔNG viết công thức hay phương trình.\n\nTừ viết tắt phổ biến:\n- "$", "$?", "$$?" = Hỏi giá\n- "hm", "how much" = Bao nhiêu\n- "brp", "hrg brp", "harga?" = Giá bao nhiêu (Indonesia)\n- "mgkno", "magkano" = Bao nhiêu tiền (Tagalog)\n- "多少", "價格?" = Giá bao nhiêu (Trung)\n- "nt" = No thanks\n- "cod" = Thanh toán khi nhận hàng, "dp" = Đặt cọc, "ck" = Thanh toán\n\nQuy tắc xưng hô:\n- Tin nhắn khách hàng [KH]: dịch tự nhiên theo ý khách, KHÔNG thêm xưng hô không có trong bản gốc.\n- Tin nhắn nhân viên [NV]: gọi khách là "chị", nhân viên tự xưng "em".\n- Không thêm từ xưng hô nếu bản gốc không có.';

      try {
        this.stats.apiCalls++;

        const response = await fetch(GROQ_API_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            model: GROQ_TRANSLATE_MODEL,
            messages: [
              {
                role: 'system',
                content: systemContent
              },
              { role: 'user', content: userContent }
            ],
            temperature: 0.3,
            max_tokens: 500,
            reasoning_effort: 'none'
          }),
          signal: controller.signal
        });

        clearTimeout(timeout);

        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get('Retry-After') || '60');
          throw new Error(`Rate limited. Retry after ${retryAfter}s`);
        }

        // Handle invalid API key - notify LicenseService to invalidate cache
        if (response.status === 401 || response.status === 403) {
          if (window.licenseService) {
            await window.licenseService.onApiKeyError();
          }
          throw new Error('API key khong hop le. Vui long kiem tra Groq API Key.');
        }

        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.error?.message || `API error: ${response.status}`);
        }

        const data = await response.json();
        let translation = data.choices?.[0]?.message?.content?.trim();

        if (!translation) {
          throw new Error('Empty response from API');
        }

        // Strip think blocks, role tags, system prompt echoes
        translation = this.cleanAIOutput(translation);

        // Mark Groq as active on success
        chrome.storage.local.set({ activeProvider: 'groq' });

        log('API call success');
        return translation;

      } catch (groqError) {
        clearTimeout(timeout);

        if (groqError.name === 'AbortError') {
          throw new Error('Request timeout');
        }

        // Fallback to OpenAI if available
        if (this.openaiApiKey) {
          log('Groq failed, falling back to OpenAI:', groqError.message);
          return this._callWithOpenAI(userContent, systemContent);
        }

        throw groqError;
      }
    }

    // OpenAI fallback translation method
    async _callWithOpenAI(userContent, systemContent) {
      if (!this.openaiApiKey) throw new Error('No OpenAI fallback key');

      // Mark fallback active
      chrome.storage.local.set({ activeProvider: 'openai' });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      try {
        const response = await fetch(OPENAI_API_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.openaiApiKey}`
          },
          body: JSON.stringify({
            model: OPENAI_FALLBACK_MODEL,
            messages: [
              { role: 'system', content: systemContent },
              { role: 'user', content: userContent }
            ],
            temperature: 0.3,
            max_tokens: 500
          }),
          signal: controller.signal
        });

        clearTimeout(timeout);

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.error?.message || `OpenAI error: ${response.status}`);
        }

        const data = await response.json();
        let result = data.choices?.[0]?.message?.content?.trim();
        if (!result) throw new Error('Empty response from OpenAI');
        result = this.cleanAIOutput(result);

        log('OpenAI fallback success');
        return result;
      } catch(e) {
        clearTimeout(timeout);
        throw e;
      }
    }

    // General prompt method (used by inline-toolbar for Dich cau tra loi)
    // Fixed: Groq first (llama-3.3-70b-versatile) → fallback GPT-4.1-mini
    async callOpenAIGeneral(prompt) {
      await this.waitIfNeeded();

      // Try Groq first
      if (this.apiKey) {
        try {
          const result = await this._callGeneralWithGroq(prompt);
          log(`General Groq success, ${result.length} chars`);
          return result;
        } catch (groqError) {
          log('General Groq failed, trying OpenAI fallback:', groqError.message);
          if (this.openaiApiKey) {
            return this._callGeneralWithOpenAI(prompt);
          }
          throw groqError;
        }
      }

      // No Groq key, try OpenAI directly
      if (this.openaiApiKey) {
        return this._callGeneralWithOpenAI(prompt);
      }

      throw new Error('Chưa có API Key. Vui lòng cài đặt Groq hoặc OpenAI key.');
    }

    // Translate reply to customer language (Groq qwen3-32b + reasoning_effort: none)
    async callTranslateReply(prompt) {
      await this.waitIfNeeded();
      if (this.apiKey) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 60000);
          try {
            this.stats.apiCalls++;
            const response = await fetch(GROQ_API_ENDPOINT, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
              body: JSON.stringify({
                model: GROQ_TRANSLATE_MODEL,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.3,
                max_tokens: 1000,
                reasoning_effort: 'none'
              }),
              signal: controller.signal
            });
            clearTimeout(timeout);
            if (!response.ok) {
              const err = await response.json().catch(() => ({}));
              throw new Error(err.error?.message || `Groq error: ${response.status}`);
            }
            const data = await response.json();
            const result = this.cleanAIOutput(data.choices?.[0]?.message?.content?.trim());
            if (!result) throw new Error('Empty response');
            chrome.storage.local.set({ activeProvider: 'groq' });
            return result;
          } catch (e) {
            clearTimeout(timeout);
            throw e;
          }
        } catch (groqError) {
          if (this.openaiApiKey) {
            return this._callGeneralWithOpenAI(prompt);
          }
          throw groqError;
        }
      }
      if (this.openaiApiKey) return this._callGeneralWithOpenAI(prompt);
      throw new Error('Chưa có API Key.');
    }

    async _callGeneralWithGroq(prompt) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      try {
        this.stats.apiCalls++;
        const response = await fetch(GROQ_API_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
          body: JSON.stringify({
            model: GROQ_TRANSLATE_MODEL,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.5,
            max_tokens: 1000,
            reasoning_effort: 'none'
          }),
          signal: controller.signal
        });
        clearTimeout(timeout);
        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.error?.message || `Groq error: ${response.status}`);
        }
        const data = await response.json();
        const result = this.cleanAIOutput(data.choices?.[0]?.message?.content?.trim());
        if (!result) throw new Error('Empty response from Groq');
        return result;
      } catch (e) {
        clearTimeout(timeout);
        if (e.name === 'AbortError') throw new Error('Request timeout');
        throw e;
      }
    }

    async _callGeneralWithOpenAI(prompt) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      try {
        this.stats.apiCalls++;
        const response = await fetch(OPENAI_API_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.openaiApiKey}` },
          body: JSON.stringify({
            model: 'gpt-4.1',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.5,
            max_tokens: 1000
          }),
          signal: controller.signal
        });
        clearTimeout(timeout);
        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.error?.message || `OpenAI error: ${response.status}`);
        }
        const data = await response.json();
        const result = this.cleanAIOutput(data.choices?.[0]?.message?.content?.trim());
        if (!result) throw new Error('Empty response from OpenAI');
        log(`General OpenAI fallback success, ${result.length} chars`);
        return result;
      } catch (e) {
        clearTimeout(timeout);
        if (e.name === 'AbortError') throw new Error('Request timeout');
        throw e;
      }
    }

    // ==================== Output Cleaner ====================
    cleanAIOutput(text) {
      if (!text) return text;
      // Strip <think>...</think> blocks (qwen3 reasoning leak)
      text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      // Strip unclosed <think> block (model cut off mid-think)
      text = text.replace(/<think>[\s\S]*/gi, '').trim();
      // Strip role echo tags [KH]: / [NV]:
      text = text.replace(/^\[(KH|NV)\]:\s*/i, '');
      // Strip system prompt echo lines
      text = text.replace(/^\[chỉ bản dịch.*\]\s*/im, '').trim();
      text = text.replace(/^\[only.*translation.*\]\s*/im, '').trim();
      return text.trim();
    }

    // ==================== Optimized Batch Translate ====================
    async batchTranslate(items) {
      // items = [{ text, srcLang, context? }]

      // Step 1: Deduplicate and check cache
      const uniqueItems = [];
      const resultMap = new Map(); // text -> result

      for (const item of items) {
        // Use context cache key if context is provided, otherwise standard key
        const cacheKey = (item.context && item.context.length > 0)
          ? this.getContextCacheKey(item.text, item.srcLang, item.context)
          : this.getCacheKey(item.text, item.srcLang);

        // Use text as map key for deduplication (simple case)
        // For context translations use a compound key
        const mapKey = (item.context && item.context.length > 0)
          ? `ctx:${cacheKey}`
          : item.text;

        // Check if already in our result map (duplicate in this batch)
        if (resultMap.has(mapKey)) {
          continue;
        }

        // Check cache
        const cached = await this.getFromCache(cacheKey);
        if (cached) {
          resultMap.set(mapKey, { translation: cached, cached: true });
          this.stats.tokensSaved += this.estimateTokens(item.text);
        } else if (!this.pendingRequests.has(cacheKey)) {
          // Not in cache and not pending
          uniqueItems.push({ ...item, _mapKey: mapKey, _cacheKey: cacheKey });
        }
      }

      log(`Batch: ${items.length} total, ${uniqueItems.length} need API call`);

      // Step 2: Create token-aware batches
      if (uniqueItems.length > 0) {
        const batches = this.createBatches(uniqueItems);
        log(`Split into ${batches.length} batches`);

        // Step 3: Process batches sequentially (to respect rate limits)
        for (const batch of batches) {
          const needsTranslation = [];
          for (const item of batch) {
            if (this.pendingRequests.has(item._cacheKey)) {
              // Wait for pending
              try {
                const result = await this.pendingRequests.get(item._cacheKey);
                resultMap.set(item._mapKey, { translation: result, cached: false });
              } catch (e) {
                resultMap.set(item._mapKey, { translation: null, error: e.message });
              }
            } else {
              needsTranslation.push(item);
            }
          }

          // Translate remaining items in parallel within batch
          if (needsTranslation.length > 0) {
            const promises = needsTranslation.map(async (item) => {
              try {
                let translation;
                if (item.context && item.context.length > 0) {
                  translation = await this.translateWithContext(item.text, item.srcLang, item.context, item.currentRole || 'customer');
                } else {
                  translation = await this.callOpenAITranslate(item.text, item.srcLang, [], item.currentRole || 'customer');
                }
                resultMap.set(item._mapKey, { translation, cached: false });
              } catch (e) {
                resultMap.set(item._mapKey, { translation: null, error: e.message });
              }
            });

            await Promise.all(promises);
          }
        }
      }

      // Step 4: Build final results array matching input order
      return items.map(item => {
        const mapKey = (item.context && item.context.length > 0)
          ? `ctx:${this.getContextCacheKey(item.text, item.srcLang, item.context)}`
          : item.text;
        const entry = resultMap.get(mapKey);
        return {
          original: item.text,
          translation: entry?.translation || null,
          error: entry?.error || null,
          cached: entry?.cached || false
        };
      });
    }

    async clearCache() {
      this.l1Cache.clear();
      await this.l2Cache.clear();
      chrome.storage.local.remove('pitTranslationCache');
      this.stats = { l1Hits: 0, l2Hits: 0, apiCalls: 0, tokensSaved: 0 };
      this.lastRequestTime = 0;
      log('All caches cleared');
    }

    async getCacheStats() {
      const l2Stats = await this.l2Cache.getStats();
      return {
        l1Size: this.l1Cache.size,
        l2Size: l2Stats.count,
        l1Hits: this.stats.l1Hits,
        l2Hits: this.stats.l2Hits,
        apiCalls: this.stats.apiCalls,
        tokensSaved: this.stats.tokensSaved
      };
    }

    // Legacy compatibility
    getCacheSize() {
      return this.l1Cache.size;
    }
  }

  // Global instance
  window.openaiTranslator = new OpenAITranslator();

})();
