// lib/language-worker-client.js - Client for Language Detection Web Worker
// Provides async API and fallback for environments without Worker support

(function() {
  'use strict';

  const DEBUG = true;
  const log = (...args) => DEBUG && console.log('[LangWorker]', ...args);

  class LanguageWorkerClient {
    constructor() {
      this.worker = null;
      this.pendingRequests = new Map();
      this.requestId = 0;
      this.ready = false;
      this.fallbackMode = false;
    }

    async init() {
      if (this.ready || this.fallbackMode) return;

      try {
        // Get extension URL for worker script
        const workerUrl = chrome.runtime.getURL('translator/lib/language-worker.js');
        this.worker = new Worker(workerUrl);

        // Wait for worker ready signal
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Worker initialization timeout'));
          }, 5000);

          this.worker.onmessage = (e) => {
            if (e.data.type === 'ready') {
              clearTimeout(timeout);
              this.setupMessageHandler();
              this.ready = true;
              log('Web Worker initialized');
              resolve();
            }
          };

          this.worker.onerror = (e) => {
            clearTimeout(timeout);
            reject(new Error(`Worker error: ${e.message}`));
          };
        });

      } catch (e) {
        log('Worker init failed, using fallback:', e.message);
        this.fallbackMode = true;
        this.ready = true;
      }
    }

    setupMessageHandler() {
      this.worker.onmessage = (e) => {
        const { id, success, result, error } = e.data;

        // Skip ready message
        if (e.data.type === 'ready') return;

        const pending = this.pendingRequests.get(id);
        if (pending) {
          this.pendingRequests.delete(id);
          if (success) {
            pending.resolve(result);
          } else {
            pending.reject(new Error(error));
          }
        }
      };

      this.worker.onerror = (e) => {
        log('Worker error:', e.message);
        // Reject all pending requests
        for (const [id, pending] of this.pendingRequests) {
          pending.reject(new Error('Worker crashed'));
        }
        this.pendingRequests.clear();
        this.fallbackMode = true;
      };
    }

    postMessage(type, data) {
      return new Promise((resolve, reject) => {
        if (this.fallbackMode) {
          // Use sync fallback
          if (type === 'detect' && typeof window.detectLanguage === 'function') {
            resolve(window.detectLanguage(data.text));
          } else if (type === 'batchDetect' && typeof window.detectLanguage === 'function') {
            resolve(data.texts.map(text => ({
              text,
              lang: window.detectLanguage(text)
            })));
          } else {
            reject(new Error('Fallback not available'));
          }
          return;
        }

        const id = ++this.requestId;
        this.pendingRequests.set(id, { resolve, reject });

        try {
          this.worker.postMessage({ type, id, data });
        } catch (e) {
          this.pendingRequests.delete(id);
          reject(e);
        }
      });
    }

    /**
     * Detect language for a single text
     * @param {string} text - Text to analyze
     * @returns {Promise<string>} - Language code
     */
    async detect(text) {
      await this.init();
      return this.postMessage('detect', { text });
    }

    /**
     * Batch detect languages for multiple texts
     * @param {string[]} texts - Array of texts to analyze
     * @returns {Promise<Array<{text: string, lang: string}>>}
     */
    async batchDetect(texts) {
      await this.init();
      return this.postMessage('batchDetect', { texts });
    }

    /**
     * Sync detect (uses fallback, blocks main thread)
     * Use only when async is not possible
     */
    detectSync(text) {
      if (typeof window.detectLanguage === 'function') {
        return window.detectLanguage(text);
      }
      return 'auto';
    }

    /**
     * Check if worker is available and ready
     */
    isReady() {
      return this.ready;
    }

    /**
     * Check if running in fallback mode
     */
    isFallbackMode() {
      return this.fallbackMode;
    }

    /**
     * Terminate the worker
     */
    terminate() {
      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
      }
      this.ready = false;
      this.pendingRequests.clear();
    }
  }

  // Create global instance
  window.pitLanguageWorker = new LanguageWorkerClient();

  // Auto-initialize
  window.pitLanguageWorker.init().catch(e => {
    log('Auto-init failed:', e.message);
  });

})();
