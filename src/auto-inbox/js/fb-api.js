var VaesaAPI = {
  fbConfig: {},
  allCustomers: [],
  pageListData: [],
  loadFbConfig: function(callback) {
    var self = this;
    // 1. Thử đọc từ cache
    chrome.storage.local.get(["vaesa_fb_config", "vaesa_fb_config_ts"], function(data) {
      var cached = data.vaesa_fb_config;
      var ts = data.vaesa_fb_config_ts || 0;
      var age = Date.now() - ts;
      // Cache hợp lệ nếu < 4 giờ
      if (cached && cached.fb_dtsg && age < 4 * 60 * 60 * 1000) {
        self.fbConfig = cached;
        console.log("[VaesaAPI] loadFbConfig from cache OK, age:", Math.round(age / 60000), "min");
        callback(true);
        return;
      }
      // 2. Cache hết hạn hoặc rỗng → gọi getPageList gốc
      console.log("[VaesaAPI] loadFbConfig: cache miss, calling getPageList...");
      self._getFacebookUserId(function(userId) {
        if (!userId) {
          console.error("[VaesaAPI] loadFbConfig: no c_user");
          callback(false);
          return;
        }
        chrome.runtime.sendMessage({
          action: "GET_PAGE_LIST",
          payload: { c_user: userId }
        }, function(response) {
          if (chrome.runtime.lastError) {
            console.error("[VaesaAPI] loadFbConfig error:", chrome.runtime.lastError.message);
            callback(false);
            return;
          }
          if (response && response.request_config && response.request_config.fb_dtsg) {
            self.fbConfig = response.request_config;
            chrome.storage.local.set({ vaesa_fb_config: self.fbConfig, vaesa_fb_config_ts: Date.now() });
            console.log("[VaesaAPI] loadFbConfig via getPageList OK");
            callback(true);
          } else {
            console.error("[VaesaAPI] loadFbConfig via getPageList FAILED");
            callback(false);
          }
        });
      });
    });
  },
  _getFacebookUserId(callback) {
    var message = {
      action: "GET_FB_COOKIE"
    };
    chrome.runtime.sendMessage(message, function (response) {
      if (chrome.runtime.lastError) {
        callback(null, "Lỗi kết nối: " + chrome.runtime.lastError.message);
        return;
      }
      if (response && response.userId) {
        callback(response.userId, null);
      } else {
        callback(null, response && response.error || "Chưa đăng nhập Facebook hoặc cookie bị chặn.");
      }
    });
  },
  getPageList(onProgress, callback) {
    var self = this;
    this._getFacebookUserId(function (userId, error) {
      if (!userId) {
        callback({
          success: false,
          error: error || "Chưa đăng nhập Facebook"
        });
        return;
      }
      console.log("[VaesaAPI] Got FB userId:", userId);
      var payload = {
        c_user: userId
      };
      var message = {
        action: "GET_PAGE_LIST",
        payload: payload
      };
      chrome.runtime.sendMessage(message, function (response) {
        if (chrome.runtime.lastError) {
          var errorResponse = {
            success: false,
            error: chrome.runtime.lastError.message
          };
          callback(errorResponse);
          return;
        }
        if (response && response.success) {
          self.pageListData = response.data || [];
          self.fbConfig = response.request_config || {};
          // Cache fbConfig vào storage
          if (self.fbConfig.fb_dtsg) {
            chrome.storage.local.set({ vaesa_fb_config: self.fbConfig, vaesa_fb_config_ts: Date.now() });
            console.log("[VaesaAPI] fbConfig cached to storage");
          }
          callback({
            success: true,
            pages: self.pageListData
          });
        } else {
          callback({
            success: false,
            error: response && response.error || "Lỗi tải danh sách Fanpage"
          });
        }
      });
      var progressHandler = function (progressMessage) {
        if (progressMessage.action === "PAGE_LIST_PROGRESS" && onProgress) {
          onProgress(progressMessage.payload.count, progressMessage.payload.isComplete);
        }
      };
      chrome.runtime.onMessage.addListener(progressHandler);
      setTimeout(function () {
        chrome.runtime.onMessage.removeListener(progressHandler);
      }, 60000);
    });
  },
  getUserInfo(userId, callback) {
    var payload = {
      c_user: userId
    };
    var message = {
      action: "GET_USER_INFO",
      payload: payload
    };
    chrome.runtime.sendMessage(message, callback);
  },
  scanInboxCustomers(pageId, limit, onProgress, callback, filters, checkStop) {
    this.allCustomers = [];
    var seenUids = new Set();
    var self = this;
    var batchCount = 0;
    var minTimestamp = filters && filters.minTimestamp ? filters.minTimestamp : 0;
    var maxTimestamp = filters && filters.maxTimestamp ? filters.maxTimestamp : Infinity;
    var fetchBatch = function (cursor) {
      // Check stop trước mỗi batch
      if (checkStop && checkStop()) {
        console.log("[VaesaAPI] Scan stopped by user. Total:", self.allCustomers.length);
        callback({ success: true, customers: self.allCustomers, stoppedByUser: true });
        return;
      }
      batchCount++;
      console.log("[VaesaAPI] Batch #" + batchCount + ", cursor:", cursor, "total so far:", self.allCustomers.length);
      var payload = {
        page_id: pageId,
        before_call: cursor
      };
      var message = {
        action: "GET_USER_INBOX",
        payload: payload
      };
      chrome.runtime.sendMessage(message, function (response) {
        if (chrome.runtime.lastError) {
          console.error("[VaesaAPI] Runtime error:", chrome.runtime.lastError.message);
          callback({
            success: self.allCustomers.length > 0,
            customers: self.allCustomers,
            error: chrome.runtime.lastError.message
          });
          return;
        }
        if (response && response.request_config && response.request_config.fb_dtsg) {
          self.fbConfig = response.request_config;
          console.log("[VaesaAPI] fbConfig updated from scanInbox, fb_dtsg:", self.fbConfig.fb_dtsg ? "YES" : "NO");
        }
        if (!response || !response.success) {
          console.error("[VaesaAPI] Response error:", response);
          callback({
            success: self.allCustomers.length > 0,
            customers: self.allCustomers,
            error: response ? JSON.stringify(response.error) : "No response"
          });
          return;
        }
        try {
          var data = response.data;
          console.log("[VaesaAPI] Response data keys:", Object.keys(data || {}));
          var results = data.__q0__ || data.o0 || data;
          var threads = null;
          results && results.data && results.data.viewer && results.data.viewer.message_threads && (threads = results.data.viewer.message_threads.nodes);
          !threads && data.viewer && data.viewer.message_threads && (threads = data.viewer.message_threads.nodes);
          if (!threads && data.data && data.data.viewer && data.data.viewer.message_threads) {
            threads = data.data.viewer.message_threads.nodes;
          }
          console.log("[VaesaAPI] Threads found:", threads ? threads.length : 0);
          if (!threads || threads.length === 0) {
            console.log("[VaesaAPI] No threads, finishing. Raw data sample:", JSON.stringify(data).substring(0, 500));
            callback({
              success: self.allCustomers.length > 0,
              customers: self.allCustomers
            });
            return;
          }
          var newCustomersInBatchCount = 0;
          var isStoppedByTimeFilter = false;
          for (var i = 0; i < threads.length; i++) {
            var thread = threads[i];
            if (!thread) {
              continue;
            }
            var participants = thread.all_participants && thread.all_participants.edges;
            if (!participants || participants.length === 0) {
              continue;
            }
            var updatedTime = thread.updated_time_precise ? parseInt(thread.updated_time_precise) : 0;
            // Chuyển microseconds → milliseconds nếu cần
            if (updatedTime > 9999999999999) updatedTime = Math.floor(updatedTime / 1000);
            if (minTimestamp > 0 && updatedTime > 0 && updatedTime < minTimestamp) {
              console.log("[VaesaAPI] Thread timestamp " + updatedTime + " < minTs " + minTimestamp + ", stopping scan");
              isStoppedByTimeFilter = true;
              break;
            }
            var otherParticipantActor = null;
            for (var j = 0; i < participants.length; j++) {
              var actor = participants[j] && participants[j].node && participants[j].node.messaging_actor;
              if (actor && actor.id && actor.id !== pageId) {
                otherParticipantActor = actor;
                break;
              }
            }
            if (!otherParticipantActor && participants[0] && participants[0].node && participants[0].node.messaging_actor) {
              otherParticipantActor = participants[0].node.messaging_actor;
              if (otherParticipantActor.id === pageId) {
                continue;
              }
            }
            if (!otherParticipantActor || !otherParticipantActor.id) {
              continue;
            }
            var uid = otherParticipantActor.id;
            var name = otherParticipantActor.name || "";
            if (seenUids.has(uid)) {
              continue;
            }
            if (!name || name === "Người dùng Facebook" || name === "Facebook User" || name === "Facebook user") {
              continue;
            }
            if (uid.length > 16) {
              continue;
            }
            seenUids.add(uid);
            var lastMessageTimestamp = "";
            if (thread.last_message && thread.last_message.nodes && thread.last_message.nodes[0]) {
              lastMessageTimestamp = thread.last_message.nodes[0].timestamp_precise || "";
            }
            if (maxTimestamp < Infinity && lastMessageTimestamp) {
              var lastMessageTsInt = parseInt(lastMessageTimestamp);
              // Chuyển microseconds → milliseconds nếu cần
              if (lastMessageTsInt > 9999999999999) lastMessageTsInt = Math.floor(lastMessageTsInt / 1000);
              if (lastMessageTsInt > maxTimestamp) {
                continue;
              }
            }
            var formattedTimestamp = "";
            if (lastMessageTimestamp) {
              try {
                var tsInt = parseInt(lastMessageTimestamp);
                console.log("[VaesaAPI] DEBUG raw timestamp:", lastMessageTimestamp, "parsed:", tsInt, "digits:", String(tsInt).length, "name:", name);
                // Facebook có thể trả microseconds (16+ chữ số) thay vì milliseconds (13 chữ số)
                if (tsInt > 9999999999999) {
                  tsInt = Math.floor(tsInt / 1000);
                  console.log("[VaesaAPI] DEBUG converted to ms:", tsInt);
                }
                var date = new Date(tsInt);
                formattedTimestamp = date.toLocaleString("vi-VN", {
                  hour: "2-digit", minute: "2-digit",
                  day: "2-digit", month: "2-digit", year: "numeric",
                  hour12: false
                });
              } catch (error) {
                formattedTimestamp = lastMessageTimestamp;
              }
            }
            var customer = {
              uid: uid,
              name: name,
              timestamp: formattedTimestamp,
              rawTimestamp: lastMessageTimestamp
            };
            self.allCustomers.push(customer);
            newCustomersInBatchCount++;
          }
          console.log("[VaesaAPI] New customers this batch:", newCustomersInBatchCount, "Total:", self.allCustomers.length);
          var nextCursor = null;
          if (threads.length >= 50) {
            var lastThread = threads[threads.length - 1];
            var lastThreadTimestamp = lastThread && lastThread.updated_time_precise;
            lastThreadTimestamp && (nextCursor = (parseInt(lastThreadTimestamp) - 1).toString());
          }
          if (onProgress) {
            onProgress(self.allCustomers.length);
          }
          if (isStoppedByTimeFilter) {
            console.log("[VaesaAPI] Scan stopped by time filter. Total:", self.allCustomers.length, "Batches:", batchCount);
            var stopResponse = {
              success: true,
              customers: self.allCustomers,
              stoppedByTimeFilter: true
            };
            callback(stopResponse);
          } else {
            if (limit < Infinity && self.allCustomers.length >= limit) {
              console.log("[VaesaAPI] Scan stopped by max limit (" + limit + "). Total:", self.allCustomers.length, "Batches:", batchCount);
              self.allCustomers = self.allCustomers.slice(0, limit);
              var limitResponse = {
                success: true,
                customers: self.allCustomers,
                stoppedByLimit: true
              };
              callback(limitResponse);
            } else {
              if (nextCursor && newCustomersInBatchCount > 0) {
                setTimeout(function () {
                  fetchBatch(nextCursor);
                }, 800);
              } else {
                console.log("[VaesaAPI] Scan complete. Total:", self.allCustomers.length, "Batches:", batchCount);
                var completeResponse = {
                  success: true,
                  customers: self.allCustomers
                };
                callback(completeResponse);
              }
            }
          }
        } catch (error) {
          console.error("[VaesaAPI] Parse error:", error, error.stack);
          callback({
            success: self.allCustomers.length > 0,
            customers: self.allCustomers,
            error: error.message
          });
        }
      });
    };
    fetchBatch(null);
  },
  _downloadTxt(filename, content) {
    var blobOptions = {
      type: "text/plain;charset=utf-8"
    };
    var blob = new Blob([content], blobOptions);
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    setTimeout(function () {
      link.remove();
      URL.revokeObjectURL(url);
    }, 500);
  },
  _buildTxtContent(customers, pageName, suffix) {
    var lines = customers.map(function (customer) {
      return customer.uid + "|" + customer.name + "|" + (customer.timestamp || "") + "|" + (customer.psid || "") + "|" + (customer.convId || "");
    });
    var header = "# Vaesa Inbox Tools — Exported " + new Date().toLocaleString("vi-VN") + "\n" + "# Page: " + pageName + (suffix ? " — " + suffix : "") + "\n" + "# Total: " + customers.length + " customers\n" + "# Format: UID|Name|Timestamp|PSID|ConvID\n";
    return header + lines.join("\n");
  },
  _safeName(name) {
    return name.replace(/[^a-zA-Z0-9_\-\s]/g, "").trim().replace(/\s+/g, "_");
  },
  exportCustomersToTxt(customers, pageName) {
    var content = this._buildTxtContent(customers, pageName, null);
    var filename = "vaesa_inbox_" + this._safeName(pageName) + "_" + Date.now() + ".txt";
    this._downloadTxt(filename, content);
    return filename;
  },
  exportCustomersSplit(customers, pageName, splitSize) {
    var safePageName = this._safeName(pageName);
    var totalParts = Math.ceil(customers.length / splitSize);
    var self = this;
    var partIndex = 0;
    function exportPart() {
      if (partIndex >= totalParts) {
        return;
      }
      var start = partIndex * splitSize;
      var end = Math.min(start + splitSize, customers.length);
      var partCustomers = customers.slice(start, end);
      var partSuffix = "Part " + (partIndex + 1) + "/" + totalParts + " (" + partCustomers.length + " customers)";
      var partContent = self._buildTxtContent(partCustomers, pageName, partSuffix);
      var partFilename = "vaesa_inbox_" + safePageName + "_part" + (partIndex + 1) + "_of_" + totalParts + "_" + Date.now() + ".txt";
      self._downloadTxt(partFilename, partContent);
      partIndex++;
      partIndex < totalParts && setTimeout(exportPart, 700);
    }
    exportPart();
    return totalParts;
  }
};
window.VaesaAPI = VaesaAPI;