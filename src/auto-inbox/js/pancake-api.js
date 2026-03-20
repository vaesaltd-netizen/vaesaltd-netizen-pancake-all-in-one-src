var PancakeAPI = (function () {
  "use strict";

  var BASE_URL = "https://pages.fm/api/public_api/v1";
  var PANCAKE_URL = "https://pancake.vn/api/v1";
  var lastRequestTime = 0;

  // Lấy session token (cookie jwt) từ pancake.vn
  function getSessionToken(callback) {
    chrome.runtime.sendMessage({ action: "GET_PANCAKE_SESSION" }, function (res) {
      callback(res && res.token ? res.token : null);
    });
  }

  // Rate-limited fetch (500ms giữa mỗi request)
  function pancakeFetch(url, sessionToken, callback) {
    var now = Date.now();
    var delay = Math.max(0, 500 - (now - lastRequestTime));
    setTimeout(function () {
      lastRequestTime = Date.now();
      chrome.runtime.sendMessage({
        action: "PANCAKE_REQUEST",
        payload: { url: url, session_token: sessionToken }
      }, function (res) {
        if (chrome.runtime.lastError) {
          return callback(chrome.runtime.lastError.message, null);
        }
        if (res && res.error) return callback(res.error, null);
        callback(null, res && res.data);
      });
    }, delay);
  }

  // Fetch với fallback: pages.fm → pancake.vn
  function fetchWithFallback(pageId, path, accessToken, sessionToken, callback) {
    var pagesFmUrl = BASE_URL + "/pages/" + pageId + "/" + path +
      (path.indexOf("?") > -1 ? "&" : "?") + "access_token=" + accessToken;

    pancakeFetch(pagesFmUrl, sessionToken, function (err, data) {
      if (!err && data && data.success !== false) {
        return callback(null, data);
      }
      // Fallback to pancake.vn
      if (sessionToken) {
        var pancakeUrl = PANCAKE_URL + "/pages/" + pageId + "/" + path +
          (path.indexOf("?") > -1 ? "&" : "?") + "access_token=" + sessionToken;
        pancakeFetch(pancakeUrl, sessionToken, callback);
      } else {
        callback(err || "pages.fm failed, no session token for fallback", null);
      }
    });
  }

  // Lấy danh sách tags
  function getTags(pageId, accessToken, callback) {
    getSessionToken(function (sessionToken) {
      fetchWithFallback(pageId, "tags", accessToken, sessionToken, function (err, data) {
        if (err) return callback(err, []);
        var tagsData = [];
        if (Array.isArray(data)) {
          tagsData = data;
        } else if (data && typeof data === "object") {
          tagsData = data.data || data.tags || [];
        }
        var tags = tagsData.map(function (tag) {
          return {
            id: String(tag.id),
            name: tag.text || tag.name || tag.tag_name || "",
            count: tag.count || tag.conversation_count || 0
          };
        });
        callback(null, tags);
      });
    });
  }

  // Quét conversations theo tag (1 page)
  function getConversationsByTag(pageId, accessToken, tagId, pageNumber, since, until, callback) {
    getSessionToken(function (sessionToken) {
      var path = "conversations?tag_ids[]=" + tagId +
        "&page_number=" + pageNumber +
        "&since=" + since + "&until=" + until;
      fetchWithFallback(pageId, path, accessToken, sessionToken, callback);
    });
  }

  // Quét TẤT CẢ conversations, chia theo tháng
  // options: { sinceDate, untilDate, maxMonths }
  // sinceDate/untilDate: "YYYY-MM-DD" hoặc null
  function getAllConversationsByTag(pageId, accessToken, tagId, options, onProgress, checkStop, callback) {
    var maxMonths = (options && options.maxMonths) || 24;
    var sinceDate = options && options.sinceDate;
    var untilDate = options && options.untilDate;

    getSessionToken(function (sessionToken) {
      var nowTs = Math.floor(Date.now() / 1000);
      var MONTH = 30 * 24 * 3600;

      // Tính timestamp từ ngày nhập
      var globalSince = sinceDate ? Math.floor(new Date(sinceDate + "T00:00:00").getTime() / 1000) : null;
      var globalUntil = untilDate ? Math.floor(new Date(untilDate + "T23:59:59").getTime() / 1000) : nowTs;

      // Nếu có cả 2 ngày → tính số tháng cần quét
      if (globalSince) {
        maxMonths = Math.ceil((globalUntil - globalSince) / MONTH) + 1;
      }

      var allConversations = [];
      var seenIds = {};
      var consecutiveErrors = 0;
      var lastError = "";
      var monthIndex = 0;

      function scanNextMonth() {
        if (monthIndex >= maxMonths || consecutiveErrors >= 3) {
          if (allConversations.length === 0 && lastError) {
            return callback("Không quét được. Lỗi: " + lastError, []);
          }
          return callback(null, allConversations);
        }
        if (checkStop && checkStop()) {
          return callback(null, allConversations);
        }

        var until = globalUntil - monthIndex * MONTH;
        var since = until - MONTH;

        // Clamp theo globalSince nếu có
        if (globalSince && since < globalSince) since = globalSince;
        // Nếu until < globalSince → đã quét xong
        if (globalSince && until < globalSince) {
          return callback(null, allConversations);
        }

        var pageNumber = 1;

        function scanNextPage() {
          if (checkStop && checkStop()) {
            return callback(null, allConversations);
          }

          var path = "conversations?tag_ids[]=" + tagId +
            "&page_number=" + pageNumber +
            "&since=" + since + "&until=" + until;

          fetchWithFallback(pageId, path, accessToken, sessionToken, function (err, data) {
            if (err) {
              lastError = err;
              consecutiveErrors++;
              monthIndex++;
              return scanNextMonth();
            }
            consecutiveErrors = 0;
            var convs = (data && (data.conversations || data.data)) || [];
            if (convs.length === 0) {
              monthIndex++;
              return scanNextMonth();
            }
            for (var i = 0; i < convs.length; i++) {
              var cid = String(convs[i].id);
              if (!seenIds[cid]) {
                seenIds[cid] = true;
                allConversations.push(convs[i]);
              }
            }
            if (onProgress) onProgress(allConversations.length);
            if (convs.length < 200) {
              monthIndex++;
              scanNextMonth();
            } else {
              pageNumber++;
              scanNextPage();
            }
          });
        }
        scanNextPage();
      }
      scanNextMonth();
    });
  }

  // Thêm tag vào conversation (có retry)
  function addTags(pageId, accessToken, conversationId, tagIds, callback) {
    getSessionToken(function (sessionToken) {
      var index = 0;
      function addNext() {
        if (index >= tagIds.length) return callback(null);
        var tagId = tagIds[index];
        addSingleTag(pageId, accessToken, conversationId, tagId, sessionToken, 0, function (err) {
          if (err) {
            console.warn("[PancakeAPI] addTag failed after retries, tagId:", tagId, "err:", err);
          }
          index++;
          addNext();
        });
      }
      addNext();
    });
  }

  function addSingleTag(pageId, accessToken, conversationId, tagId, sessionToken, attempt, callback) {
    var maxRetries = 2;
    var url = BASE_URL + "/pages/" + pageId + "/conversations/" + conversationId +
      "/tags?access_token=" + accessToken;
    chrome.runtime.sendMessage({
      action: "PANCAKE_POST",
      payload: {
        url: url,
        session_token: sessionToken,
        body: JSON.stringify({ action: "add", tag_id: String(tagId) })
      }
    }, function (res) {
      if (res && res.error && attempt < maxRetries) {
        console.log("[PancakeAPI] addTag retry " + (attempt + 1) + " for tagId:", tagId);
        setTimeout(function () {
          addSingleTag(pageId, accessToken, conversationId, tagId, sessionToken, attempt + 1, callback);
        }, 2000);
      } else {
        callback(res && res.error ? res.error : null);
      }
    });
  }

  // Gỡ tag khỏi conversation (có retry)
  function removeTag(pageId, accessToken, conversationId, tagId, callback) {
    getSessionToken(function (sessionToken) {
      removeSingleTag(pageId, accessToken, conversationId, tagId, sessionToken, 0, callback);
    });
  }

  function removeSingleTag(pageId, accessToken, conversationId, tagId, sessionToken, attempt, callback) {
    var maxRetries = 2;
    var url = BASE_URL + "/pages/" + pageId + "/conversations/" + conversationId +
      "/tags?access_token=" + accessToken;
    chrome.runtime.sendMessage({
      action: "PANCAKE_POST",
      payload: {
        url: url,
        session_token: sessionToken,
        body: JSON.stringify({ action: "remove", tag_id: String(tagId) })
      }
    }, function (res) {
      if (res && res.error && attempt < maxRetries) {
        console.log("[PancakeAPI] removeTag retry " + (attempt + 1) + " for tagId:", tagId);
        setTimeout(function () {
          removeSingleTag(pageId, accessToken, conversationId, tagId, sessionToken, attempt + 1, callback);
        }, 2000);
      } else {
        callback(res && res.error ? res.error : null);
      }
    });
  }

  // Lưu/đọc access_token theo page
  function saveToken(pageId, token) {
    var data = {};
    data["pancake_token_" + pageId] = token;
    chrome.storage.local.set(data);
  }

  function getToken(pageId, callback) {
    chrome.storage.local.get(["pancake_token_" + pageId], function (data) {
      callback(data["pancake_token_" + pageId] || "");
    });
  }

  return {
    getTags: getTags,
    getConversationsByTag: getConversationsByTag,
    getAllConversationsByTag: getAllConversationsByTag,
    addTags: addTags,
    removeTag: removeTag,
    saveToken: saveToken,
    getToken: getToken
  };
})();
window.PancakeAPI = PancakeAPI;
