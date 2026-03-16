// lib/openai-translator.js - GPT-5-nano Translation Service
// Performance optimized: Token-aware batching, Hybrid cache, Adaptive throttling
// v3.1.0 - License Key Management integration

(function() {
  'use strict';

  const DEBUG = true;
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

  // ==================== Adaptive Throttle Controller ====================
  class AdaptiveThrottle {
    constructor() {
      this.baseDelay = 100; // Base delay between batches
      this.currentDelay = this.baseDelay;
      this.maxDelay = 5000; // Max 5s delay
      this.minDelay = 50;
      this.successStreak = 0;
      this.failureCount = 0;
      this.lastRequestTime = 0;
      this.rateLimitedUntil = 0;
    }

    async waitIfNeeded() {
      const now = Date.now();

      // If rate limited, wait until allowed
      if (this.rateLimitedUntil > now) {
        const waitTime = this.rateLimitedUntil - now;
        log(`Rate limited, waiting ${waitTime}ms`);
        await this.sleep(waitTime);
      }

      // Apply adaptive delay between requests
      const timeSinceLastRequest = now - this.lastRequestTime;
      if (timeSinceLastRequest < this.currentDelay) {
        await this.sleep(this.currentDelay - timeSinceLastRequest);
      }

      this.lastRequestTime = Date.now();
    }

    onSuccess() {
      this.successStreak++;
      this.failureCount = 0;

      // After 5 successes, reduce delay
      if (this.successStreak >= 5) {
        this.currentDelay = Math.max(this.minDelay, this.currentDelay * 0.8);
        this.successStreak = 0;
        log(`Throttle reduced to ${this.currentDelay}ms`);
      }
    }

    onFailure(error) {
      this.successStreak = 0;
      this.failureCount++;

      // Increase delay on failure
      this.currentDelay = Math.min(this.maxDelay, this.currentDelay * 2);
      log(`Throttle increased to ${this.currentDelay}ms`);
    }

    onRateLimit(retryAfter = 60) {
      this.rateLimitedUntil = Date.now() + (retryAfter * 1000);
      this.currentDelay = Math.min(this.maxDelay, this.currentDelay * 3);
      log(`Rate limited for ${retryAfter}s, delay now ${this.currentDelay}ms`);
    }

    sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    reset() {
      this.currentDelay = this.baseDelay;
      this.successStreak = 0;
      this.failureCount = 0;
      this.rateLimitedUntil = 0;
    }
  }

  // ==================== Main Translator Class ====================
  class OpenAITranslator {
    constructor() {
      this.apiKey = null;
      // L1 Cache (Memory - fast, volatile)
      this.l1Cache = new Map();
      // L2 Cache (IndexedDB - persistent, larger)
      this.l2Cache = new IndexedDBCache();
      // Pending requests to prevent duplicates
      this.pendingRequests = new Map();
      // Adaptive throttle controller
      this.throttle = new AdaptiveThrottle();
      // Stats
      this.stats = {
        l1Hits: 0,
        l2Hits: 0,
        apiCalls: 0,
        tokensSaved: 0
      };
      this.initialized = false;
    }

    // Load API key from LicenseService or fallback to legacy storage
    async init() {
      if (this.initialized) return;

      try {
        // Initialize IndexedDB L2 cache
        await this.l2Cache.init();

        // Try to get API key from LicenseService (new flow)
        if (window.licenseService) {
          this.apiKey = await window.licenseService.getApiKey();
          if (this.apiKey) {
            log('API key loaded from LicenseService');
          }
        }

        // Fallback to legacy storage (for migration)
        if (!this.apiKey) {
          const result = await chrome.storage.local.get(['openaiApiKey']);
          if (result.openaiApiKey) {
            this.apiKey = result.openaiApiKey;
            log('API key loaded from legacy storage');
          }
        }

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
      chrome.storage.local.set({ openaiApiKey: key });
    }

    getApiKey() {
      return this.apiKey;
    }

    getCacheKey(text, srcLang) {
      return `${srcLang}:vi:${text}`;
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
      const requestPromise = this.callOpenAI(text, srcLang);
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
          translate: result.pitTranslateModel || 'gpt-5-mini',
          reply: result.pitReplyModel || 'gpt-5-mini',
          expand: result.pitExpandModel || 'gpt-5-mini'
        };
      } catch (e) {
        return {
          translate: 'gpt-5-mini',
          reply: 'gpt-5-mini',
          expand: 'gpt-5-mini'
        };
      }
    }

    async callOpenAI(promptOrText, modelOrSrcLang = 'gpt-4.1-nano') {
      // Determine if this is a translation call or a general prompt call
      // Translation calls have srcLang like 'zh-TW', 'en', 'id', etc.
      // General prompt calls from inline-toolbar have model like 'gpt-4.1-nano'
      const isTranslationCall = ['zh-TW', 'zh-CN', 'en', 'id', 'tl', 'th', 'auto'].includes(modelOrSrcLang);

      if (isTranslationCall) {
        return this.callOpenAITranslate(promptOrText, modelOrSrcLang);
      } else {
        return this.callOpenAIGeneral(promptOrText, modelOrSrcLang);
      }
    }

    // Original translation method - Hardcoded GPT-4.1 Nano
    async callOpenAITranslate(text, srcLang) {
      const langNames = {
        'zh-TW': 'Traditional Chinese',
        'zh-CN': 'Simplified Chinese',
        'en': 'English',
        'id': 'Indonesian',
        'tl': 'Tagalog/Filipino',
        'th': 'Thai',
        'auto': 'the source language'
      };

      const sourceName = langNames[srcLang] || srcLang;

      // Apply adaptive throttle
      await this.throttle.waitIfNeeded();

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

      try {
        this.stats.apiCalls++;

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            model: 'gpt-4.1-nano',
            messages: [
              {
                role: 'system',
                content: `Translate from ${sourceName} to Vietnamese. Output ONLY the translation, nothing else. Keep emojis and special characters as-is.`
              },
              { role: 'user', content: text }
            ],
            temperature: 0.3,
            max_tokens: 500
          }),
          signal: controller.signal
        });

        clearTimeout(timeout);

        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get('Retry-After') || '60');
          this.throttle.onRateLimit(retryAfter);
          throw new Error(`Rate limited. Retry after ${retryAfter}s`);
        }

        // Handle invalid API key - notify LicenseService to invalidate cache
        if (response.status === 401 || response.status === 403) {
          if (window.licenseService) {
            await window.licenseService.onApiKeyError();
          }
          throw new Error('API key khong hop le. Vui long lam moi license.');
        }

        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          this.throttle.onFailure(error);
          throw new Error(error.error?.message || `API error: ${response.status}`);
        }

        const data = await response.json();
        const translation = data.choices?.[0]?.message?.content?.trim();

        if (!translation) {
          throw new Error('Empty response from API');
        }

        this.throttle.onSuccess();
        log('API call success');
        return translation;

      } catch (e) {
        clearTimeout(timeout);

        if (e.name === 'AbortError') {
          this.throttle.onFailure(e);
          throw new Error('Request timeout');
        }
        throw e;
      }
    }

    // General prompt method (used by inline-toolbar for AI Reply)
    async callOpenAIGeneral(prompt, model = 'gpt-4.1-nano') {
      // Load AI params from storage
      const aiParams = await this.getAiParams();
      const isGpt5 = model.startsWith('gpt-5');

      // Log API call with model info
      console.log(`%c[PIT] 🤖 Calling OpenAI API`, 'color: #2563EB; font-weight: bold;');
      console.log(`%c[PIT] Model: ${model}`, 'color: #10B981; font-weight: bold;');
      console.log(`%c[PIT] Max tokens: ${isGpt5 ? '8000 (max_completion_tokens)' : '1000 (max_tokens)'}`, 'color: #6366F1;');
      if (!isGpt5) {
        console.log(`%c[PIT] AI Params: temp=${aiParams.temperature}, top_p=${aiParams.top_p}, presence=${aiParams.presence_penalty}, frequency=${aiParams.frequency_penalty}`, 'color: #8B5CF6;');
      } else {
        console.log(`%c[PIT] AI Params: GPT-5 uses default values only`, 'color: #F59E0B;');
      }
      log('Using AI params:', aiParams);

      // Apply adaptive throttle
      await this.throttle.waitIfNeeded();

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout for longer prompts

      try {
        this.stats.apiCalls++;

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            model: model,
            messages: [
              { role: 'user', content: prompt }
            ],
            // GPT-5 models only support default values, so omit these params
            ...(isGpt5 ? {} : {
              temperature: aiParams.temperature,
              top_p: aiParams.top_p,
              presence_penalty: aiParams.presence_penalty,
              frequency_penalty: aiParams.frequency_penalty
            }),
            // GPT-5 models use max_completion_tokens (8000 for extended thinking), GPT-4 uses max_tokens
            ...(isGpt5 ? { max_completion_tokens: 8000 } : { max_tokens: 1000 })
          }),
          signal: controller.signal
        });

        clearTimeout(timeout);

        // Log response status
        console.log(`%c[PIT] Response Status: ${response.status} ${response.statusText}`,
          response.ok ? 'color: #10B981;' : 'color: #EF4444; font-weight: bold;');

        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get('Retry-After') || '60');
          this.throttle.onRateLimit(retryAfter);
          throw new Error(`Rate limited. Retry after ${retryAfter}s`);
        }

        // Handle invalid API key - notify LicenseService to invalidate cache
        if (response.status === 401 || response.status === 403) {
          console.log(`%c[PIT] ❌ API Key invalid (${response.status})`, 'color: #EF4444; font-weight: bold;');
          if (window.licenseService) {
            await window.licenseService.onApiKeyError();
          }
          throw new Error('API key khong hop le. Vui long lam moi license.');
        }

        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          console.log(`%c[PIT] ❌ API Error Response:`, 'color: #EF4444; font-weight: bold;');
          console.log(error);
          this.throttle.onFailure(error);
          throw new Error(error.error?.message || `API error: ${response.status}`);
        }

        const data = await response.json();

        // Log full response for debugging
        console.log(`%c[PIT] ✅ API Response:`, 'color: #10B981; font-weight: bold;');
        console.log('[PIT] Full data:', data);
        console.log('[PIT] Choices:', data.choices);
        console.log('[PIT] Usage:', data.usage);

        const result = data.choices?.[0]?.message?.content?.trim();

        if (!result) {
          console.log(`%c[PIT] ⚠️ Empty result! choices[0].message.content is empty or undefined`, 'color: #F59E0B; font-weight: bold;');
          console.log('[PIT] data.choices[0]:', data.choices?.[0]);
          throw new Error('Empty response from API');
        }

        this.throttle.onSuccess();
        console.log(`%c[PIT] ✅ Success! Response length: ${result.length} chars`, 'color: #10B981;');
        return result;

      } catch (e) {
        clearTimeout(timeout);

        if (e.name === 'AbortError') {
          this.throttle.onFailure(e);
          throw new Error('Request timeout');
        }
        throw e;
      }
    }

    // ==================== Optimized Batch Translate ====================
    async batchTranslate(items) {
      // items = [{ text, srcLang }]

      // Step 1: Deduplicate and check cache
      const uniqueItems = [];
      const resultMap = new Map(); // text -> result

      for (const item of items) {
        const cacheKey = this.getCacheKey(item.text, item.srcLang);

        // Check if already in our result map (duplicate in this batch)
        if (resultMap.has(item.text)) {
          continue;
        }

        // Check cache
        const cached = await this.getFromCache(cacheKey);
        if (cached) {
          resultMap.set(item.text, { translation: cached, cached: true });
          this.stats.tokensSaved += this.estimateTokens(item.text);
        } else if (!this.pendingRequests.has(cacheKey)) {
          // Not in cache and not pending
          uniqueItems.push(item);
        }
      }

      log(`Batch: ${items.length} total, ${uniqueItems.length} need API call`);

      // Step 2: Create token-aware batches
      if (uniqueItems.length > 0) {
        const batches = this.createBatches(uniqueItems);
        log(`Split into ${batches.length} batches`);

        // Step 3: Process batches sequentially (to respect rate limits)
        for (const batch of batches) {
          // Check if any in this batch are now pending (from concurrent calls)
          const needsTranslation = [];
          for (const item of batch) {
            const cacheKey = this.getCacheKey(item.text, item.srcLang);
            if (this.pendingRequests.has(cacheKey)) {
              // Wait for pending
              try {
                const result = await this.pendingRequests.get(cacheKey);
                resultMap.set(item.text, { translation: result, cached: false });
              } catch (e) {
                resultMap.set(item.text, { translation: null, error: e.message });
              }
            } else {
              needsTranslation.push(item);
            }
          }

          // Translate remaining items in parallel within batch
          if (needsTranslation.length > 0) {
            const promises = needsTranslation.map(async (item) => {
              try {
                const translation = await this.translateToVietnamese(item.text, item.srcLang);
                resultMap.set(item.text, { translation, cached: false });
              } catch (e) {
                resultMap.set(item.text, { translation: null, error: e.message });
              }
            });

            await Promise.all(promises);
          }
        }
      }

      // Step 4: Build final results array matching input order
      return items.map(item => ({
        original: item.text,
        translation: resultMap.get(item.text)?.translation || null,
        error: resultMap.get(item.text)?.error || null,
        cached: resultMap.get(item.text)?.cached || false
      }));
    }

    async clearCache() {
      this.l1Cache.clear();
      await this.l2Cache.clear();
      chrome.storage.local.remove('pitTranslationCache');
      this.stats = { l1Hits: 0, l2Hits: 0, apiCalls: 0, tokensSaved: 0 };
      this.throttle.reset();
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
