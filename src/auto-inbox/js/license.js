var VaesaLicense = (function () {
  "use strict";

  // ===== THAY URL NÀY BẰNG URL APPS SCRIPT CỦA ANH =====
  var APPS_SCRIPT_URL = "PASTE_YOUR_APPS_SCRIPT_URL_HERE";

  var STORAGE_KEY = "vaesa_license_key";
  var CACHE_KEY = "vaesa_license_cache";
  var CACHE_DURATION = 4 * 60 * 60 * 1000; // 4 giờ cache

  function verify(key, callback) {
    fetch(APPS_SCRIPT_URL + "?action=verify&key=" + encodeURIComponent(key))
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.success) {
          // Save key + cache
          chrome.storage.local.set({
            [STORAGE_KEY]: key,
            [CACHE_KEY]: { time: Date.now(), name: data.name, status: data.status }
          });
        }
        callback(data);
      })
      .catch(function (err) {
        // Offline: check cache
        chrome.storage.local.get([CACHE_KEY], function (stored) {
          var cache = stored[CACHE_KEY];
          if (cache && cache.status === "active") {
            callback({ success: true, name: cache.name, status: "active", cached: true });
          } else {
            callback({ success: false, error: "Không thể kết nối server. Vui lòng kiểm tra mạng." });
          }
        });
      });
  }

  function getSavedKey(callback) {
    chrome.storage.local.get([STORAGE_KEY, CACHE_KEY], function (data) {
      callback(data[STORAGE_KEY] || null, data[CACHE_KEY] || null);
    });
  }

  function logout() {
    chrome.storage.local.remove([STORAGE_KEY, CACHE_KEY]);
  }

  function checkWithCache(callback) {
    getSavedKey(function (key, cache) {
      if (!key) {
        callback({ needLogin: true });
        return;
      }
      // Nếu cache còn hạn, dùng cache
      if (cache && cache.status === "active" && (Date.now() - cache.time) < CACHE_DURATION) {
        callback({ success: true, name: cache.name, cached: true });
        return;
      }
      // Cache hết hạn, verify lại
      verify(key, function (result) {
        if (result.success) {
          callback({ success: true, name: result.name });
        } else {
          callback({ needLogin: true, error: result.error });
        }
      });
    });
  }

  return {
    verify: verify,
    getSavedKey: getSavedKey,
    logout: logout,
    checkWithCache: checkWithCache
  };
})();
