const defaultSenderConfig = {
  fromTime: 3,
  toTime: 10,
  sendingOrder: "3",
  restAfterMessages: 20,
  restDuration: 30,
  limit: 0
};
var VaesaSender = {
  currentIndex: 0,
  successList: [],
  failureList: [],
  skippedList: [],
  customers: [],
  isRunning: false,
  isPaused: false,
  sendingTimer: null,
  startTime: null,
  config: defaultSenderConfig,
  onProgress: null,
  onLog: null,
  onFinish: null,
  start(customers, messageContent, attachmentFile, userConfig, callbacks) {
    this.customers = [...customers];
    this.messageContent = messageContent;
    this.attachmentFile = attachmentFile;
    this.config = {
      ...this.config,
      ...userConfig
    };
    // Pancake tag config
    this.pancakeTagConfig = userConfig.pancakeTagConfig || null;
    this.onProgress = callbacks.onProgress || (() => {});
    this.onLog = callbacks.onLog || (() => {});
    this.onFinish = callbacks.onFinish || (() => {});
    this.currentIndex = 0;
    this.successList = [];
    this.failureList = [];
    this.skippedList = [];
    this.successDetailList = [];
    this.failureDetailList = [];
    this._lastRestAt = -1;
    this.isRunning = true;
    this.isPaused = false;
    this.startTime = Date.now();
    if (this.config.sendingOrder === "3") {
      this.customers = VaesaUtils.shuffleArray(this.customers);
    } else {
      if (this.config.sendingOrder === "2") {
        this.customers.reverse();
      }
    }
    const limit = parseInt(this.config.limit) || 0;
    limit > 0 && limit < this.customers.length && (this.customers = this.customers.slice(0, limit));
    const seenIds = new Set();
    this.customers = this.customers.filter(customer => {
      {
        const uid = (typeof customer === "string" ? VaesaUtils.getCustomerId(customer) : customer.uid) || "";
        if (seenIds.has(uid)) {
          return false;
        }
        seenIds.add(uid);
        return true;
      }
    });
    this.onProgress(0, this.customers.length);
    this._loop();
  },
  stop() {
    this.isRunning = false;
    this.isPaused = false;
    this.sendingTimer && (clearTimeout(this.sendingTimer), this.sendingTimer = null);
    this._finish();
  },
  pause() {
    this.isPaused = true;
  },
  resume() {
    this.isPaused = false;
    this._loop();
  },
  async _loop() {
    if (!this.isRunning || this.isPaused) {
      return;
    }
    const totalProcessedCount = this.successList.length + this.failureList.length + this.skippedList.length;
    if (this.currentIndex >= this.customers.length || totalProcessedCount >= this.customers.length) {
      this._finish();
      return;
    }
    const restAfterMessages = this.config.restAfterMessages || 0;
    const restDuration = this.config.restDuration || 30;
    if (restAfterMessages > 0 && totalProcessedCount > 0 && totalProcessedCount % restAfterMessages === 0 && this._lastRestAt !== totalProcessedCount) {
      this._lastRestAt = totalProcessedCount;
      this.onLog("info", "Nghỉ " + restDuration + " giây...");
      this.sendingTimer = setTimeout(() => this._loop(), restDuration * 1000);
      return;
    }
    const currentCustomer = this.customers[this.currentIndex];
    const uid = typeof currentCustomer === "string" ? VaesaUtils.getCustomerId(currentCustomer) : currentCustomer.uid;
    const name = typeof currentCustomer === "string" ? VaesaUtils.getCustomerName(currentCustomer) : currentCustomer.name;
    if (!uid) {
      this.currentIndex++;
      this._loop();
      return;
    }
    if (this.successList.includes(uid) || this.failureList.includes(uid)) {
      this.skippedList.push(uid);
      this.onLog("skip", name + " — Đã xử lý trước đó");
      this.currentIndex++;
      this.onProgress(totalProcessedCount + 1, this.customers.length);
      this._scheduleNext();
      return;
    }
    const processedMessage = VaesaUtils.processMessageTemplate(this.messageContent, name);
    try {
      {
        const pageId = this.config.pageId;
        let isSentSuccessfully = false;
        if (this.attachmentFile && this.attachmentFile.length > 0) {
          {
            let selectedFiles;
            const imageMode = this.config.imageMode || "all";
            const allFiles = Array.from(this.attachmentFile);
            if (imageMode === "random" && allFiles.length > 1) {
              {
                const randomIndex = Math.floor(Math.random() * allFiles.length);
                selectedFiles = [allFiles[randomIndex]];
                this.onLog("info", "🎲 Random ảnh: " + allFiles[randomIndex].name);
              }
            } else {
              selectedFiles = allFiles;
            }
            const uploadedMediaIds = await this._uploadMedia(pageId, selectedFiles);
            if (uploadedMediaIds) {
              isSentSuccessfully = await this._sendMessage(uid, pageId, processedMessage, uploadedMediaIds);
            } else {
              this.onLog("error", name + " — Upload ảnh thất bại");
            }
          }
        } else {
          isSentSuccessfully = await this._sendMessage(uid, pageId, processedMessage, null);
        }
        if (isSentSuccessfully) {
          {
            this.successList.push(uid);
            var cPsid = typeof currentCustomer === "object" ? (currentCustomer.psid || "") : VaesaUtils.getCustomerPsid(currentCustomer);
            var cConvId = typeof currentCustomer === "object" ? (currentCustomer.convId || "") : VaesaUtils.getCustomerConvId(currentCustomer);
            const successInfo = {
              uid: uid,
              name: name,
              psid: cPsid,
              convId: cConvId
            };
            this.successDetailList.push(successInfo);
            this.onLog("success", name + " — \"" + processedMessage.substring(0, 40) + (processedMessage.length > 40 ? "..." : "") + "\"");
            // Gắn/gỡ tag Pancake sau khi gửi thành công
            await this._handlePancakeTags(currentCustomer, name);
          }
        } else {
          {
            this.failureList.push(uid);
            var fPsid = typeof currentCustomer === "object" ? (currentCustomer.psid || "") : VaesaUtils.getCustomerPsid(currentCustomer);
            var fConvId = typeof currentCustomer === "object" ? (currentCustomer.convId || "") : VaesaUtils.getCustomerConvId(currentCustomer);
            const failureInfo = {
              uid: uid,
              name: name,
              psid: fPsid,
              convId: fConvId
            };
            this.failureDetailList.push(failureInfo);
            this.onLog("error", name + " — Gửi thất bại");
            // Gắn tag lỗi nếu có cấu hình
            await this._handleErrorTags(currentCustomer, name);
          }
        }
      }
    } catch (error) {
      {
        this.failureList.push(uid);
        var ePsid = typeof currentCustomer === "object" ? (currentCustomer.psid || "") : VaesaUtils.getCustomerPsid(currentCustomer);
        var eConvId = typeof currentCustomer === "object" ? (currentCustomer.convId || "") : VaesaUtils.getCustomerConvId(currentCustomer);
        const failureInfo = {
          uid: uid,
          name: name,
          psid: ePsid,
          convId: eConvId
        };
        this.failureDetailList.push(failureInfo);
        this.onLog("error", name + " — " + error.message);
        // Gắn tag lỗi nếu có cấu hình
        await this._handleErrorTags(currentCustomer, name);
      }
    }
    this.currentIndex++;
    const newProcessedCount = this.successList.length + this.failureList.length + this.skippedList.length;
    this.onProgress(newProcessedCount, this.customers.length);
    this._scheduleNext();
  },
  _scheduleNext() {
    if (!this.isRunning || this.isPaused) {
      return;
    }
    const delay = VaesaUtils.randomInRange(this.config.fromTime || 3, this.config.toTime || 10) * 1000;
    this.sendingTimer = setTimeout(() => this._loop(), delay);
  },
  _finish() {
    this.isRunning = false;
    if (this.sendingTimer) {
      clearTimeout(this.sendingTimer);
      this.sendingTimer = null;
    }
    const durationSeconds = Math.floor((Date.now() - (this.startTime || Date.now())) / 1000);
    var processedUids = new Set([...this.successList.map(item => item.uid || item), ...this.failureList.map(item => item.uid || item), ...this.skippedList.map(item => item.uid || item)]);
    var unsentList = [];
    for (var i = 0; i < this.customers.length; i++) {
      {
        var customer = this.customers[i];
        var uid = typeof customer === "string" ? VaesaUtils.getCustomerId(customer) : customer.uid;
        var name = typeof customer === "string" ? VaesaUtils.getCustomerName(customer) : customer.name;
        uid && !processedUids.has(uid) && unsentList.push({
          uid: uid,
          name: name || ""
        });
      }
    }
    this.onFinish({
      totalSent: this.successList.length + this.failureList.length + this.skippedList.length,
      success: this.successList.length,
      failure: this.failureList.length,
      skipped: this.skippedList.length,
      unsent: unsentList.length,
      duration: durationSeconds,
      successList: this.successDetailList || [],
      failureList: this.failureDetailList || [],
      unsentList: unsentList
    });
  },
  async _handlePancakeTags(customer, name) {
    var tagCfg = this.pancakeTagConfig;
    if (!tagCfg || !tagCfg.accessToken || !tagCfg.pageId) return;
    // customer có thể là string (file .txt) hoặc object (scan list)
    var convId = typeof customer === "object" ? customer.convId : VaesaUtils.getCustomerConvId(customer);
    if (!convId) {
      console.log("[Vaesa] Skip tag: no convId for", name);
      return;
    }
    var pageId = tagCfg.pageId;
    var token = tagCfg.accessToken;
    var self = this;
    // Thêm tag
    if (tagCfg.addTagIds && tagCfg.addTagIds.length > 0) {
      await new Promise(function (resolve) {
        PancakeAPI.addTags(pageId, token, convId, tagCfg.addTagIds, function () {
          self.onLog("info", name + " — Đã gắn " + tagCfg.addTagIds.length + " tag");
          resolve();
        });
      });
    }
    // Gỡ tag
    if (tagCfg.removeTagIds && tagCfg.removeTagIds.length > 0) {
      for (var i = 0; i < tagCfg.removeTagIds.length; i++) {
        await new Promise(function (resolve) {
          PancakeAPI.removeTag(pageId, token, convId, tagCfg.removeTagIds[i], function () {
            resolve();
          });
        });
      }
      self.onLog("info", name + " — Đã gỡ " + tagCfg.removeTagIds.length + " tag");
    }
  },
  async _handleErrorTags(customer, name) {
    var tagCfg = this.pancakeTagConfig;
    if (!tagCfg || !tagCfg.accessToken || !tagCfg.pageId) return;
    if (!tagCfg.errorTagIds || tagCfg.errorTagIds.length === 0) return;
    var convId = typeof customer === "object" ? customer.convId : VaesaUtils.getCustomerConvId(customer);
    if (!convId) {
      console.log("[Vaesa] Skip error tag: no convId for", name);
      return;
    }
    var pageId = tagCfg.pageId;
    var token = tagCfg.accessToken;
    var self = this;
    await new Promise(function (resolve) {
      PancakeAPI.addTags(pageId, token, convId, tagCfg.errorTagIds, function () {
        self.onLog("warn", name + " — Đã gắn tag lỗi");
        resolve();
      });
    });
  },
  _sendMessage(uid, pageId, messageBody, attachmentIds) {
    return new Promise(resolve => {
      {
        const fbConfig = VaesaAPI.fbConfig;
        console.log("[Vaesa] fbConfig keys:", Object.keys(fbConfig), "fb_dtsg:", fbConfig.fb_dtsg ? "YES(" + fbConfig.fb_dtsg.substring(0,10) + "...)" : "MISSING", "c_user:", fbConfig.c_user || "MISSING");
        fbConfig.__req = VaesaUtils.generateRequestId();
        fbConfig.__s = VaesaUtils.generateS();
        const timestamp = Date.now();
        const threadingId = Math.floor(Math.random() * 100000000000000);
        const params = {
          client: "mercury",
          source: "source:page_unified_inbox",
          action_type: "ma-type:user-generated-message",
          timestamp: timestamp,
          message_id: threadingId,
          offline_threading_id: threadingId,
          "specific_to_list[0]": "fbid: " + uid,
          "specific_to_list[1]": "fbid: " + pageId,
          other_user_fbid: uid,
          request_user_id: pageId,
          __user: fbConfig.c_user,
          __a: fbConfig.__a,
          __req: fbConfig.__req,
          __csr: fbConfig.__csr,
          __beoa: 0,
          __pc: fbConfig.__pc,
          __ccg: fbConfig.__ccg,
          __rev: fbConfig.__rev,
          __hsi: fbConfig.__hsi,
          __hs: fbConfig.__hs,
          __comet_req: fbConfig.__comet_req,
          __spin_r: fbConfig.__spin_r,
          __spin_b: fbConfig.__spin_b,
          __spin_t: timestamp,
          __s: fbConfig.__s,
          __usid: fbConfig.usid,
          dpr: fbConfig.dpr,
          fb_dtsg: fbConfig.fb_dtsg,
          jazoest: fbConfig.jazoest,
          lsd: fbConfig.lsd,
          ephemeral_ttl_mode: 0,
          has_attachment: !!(attachmentIds && Object.keys(attachmentIds).length > 0)
        };
        if (attachmentIds && typeof attachmentIds === "object") {
          {
            Object.keys(attachmentIds).forEach(function (index) {
              {
                params["image_ids[" + index + "]"] = attachmentIds[index];
              }
            });
          }
        }
        if (messageBody) {
          params.body = messageBody;
        }
        chrome.runtime.sendMessage({
          action: "SEND_MESSAGE",
          payload: {
            body: new URLSearchParams(params).toString()
          }
        }, function (response) {
          if (chrome.runtime.lastError) {
            console.error("[VaesaSender] sendMessage error:", chrome.runtime.lastError.message);
            resolve(false);
            return;
          }
          resolve(response && response.success);
        });
      }
    });
  },
  _uploadMedia(pageId, files) {
    return new Promise(async resolve => {
      {
        try {
          {
            const fbConfig = VaesaAPI.fbConfig;
            fbConfig.__req = VaesaUtils.generateRequestId();
            const params = {
              request_user_id: pageId,
              __a: 1,
              __req: fbConfig.__req,
              __spin_r: fbConfig.__spin_r,
              __spin_b: fbConfig.__spin_b,
              __spin_t: Math.floor(Date.now() / 1000),
              cquick_token: fbConfig.cquick_token,
              fb_dtsg: fbConfig.fb_dtsg,
              cquick: fbConfig.cquick,
              __ccg: fbConfig.__ccg,
              dpr: fbConfig.dpr,
              jazoest: fbConfig.jazoest,
              __csr: fbConfig.__csr,
              __beoa: 0,
              ctarget: "https://www.facebook.com",
              hsi: fbConfig.__hsi,
              semr_host_bucket: fbConfig.semr_host_bucket,
              bl_hash_version: fbConfig.bl_hash_version,
              comet_env: fbConfig.comet_env,
              wbloks_env: fbConfig.wbloks_env,
              ef_page: "BusinessCometBizSuiteInboxAllMessagesRoute",
              compose_bootloads: fbConfig.compose_bootloads,
              spin: fbConfig.spin,
              __hsi: fbConfig.__hsi
            };
            const filesList = Array.isArray(files) ? files : files instanceof FileList ? Array.from(files) : [files];
            const fileDataArray = [];
            for (const fileEntry of filesList) {
              {
                const base64Data = await new Promise(resolveBase64 => {
                  {
                    const reader = new FileReader();
                    reader.onload = () => {
                      {
                        const result = reader.result;
                        const commaIndex = result.indexOf(",");
                        resolveBase64(commaIndex > -1 ? result.substring(commaIndex + 1) : result);
                      }
                    };
                    reader.onerror = () => resolveBase64(null);
                    reader.readAsDataURL(fileEntry);
                  }
                });
                if (base64Data) {
                  {
                    const fileData = {
                      data: base64Data,
                      type: fileEntry.type,
                      name: fileEntry.name
                    };
                    fileDataArray.push(fileData);
                  }
                }
              }
            }
            if (fileDataArray.length === 0) {
              {
                resolve(null);
                return;
              }
            }
            const queryString = Object.keys(params).map(key => encodeURIComponent(key) + "=" + encodeURIComponent(params[key])).join("&");
            const uploadUrl = "https://upload.facebook.com/ajax/mercury/upload.php?" + queryString;
            const payload = {
              url: uploadUrl,
              files: fileDataArray
            };
            const message = {
              action: "UPLOAD_MEDIA",
              payload: payload
            };
            chrome.runtime.sendMessage(message, function (response) {
              {
                if (chrome.runtime.lastError) {
                  {
                    console.error("[VaesaSender] upload error:", chrome.runtime.lastError.message);
                    resolve(null);
                    return;
                  }
                }
                if (response && response.success && response.ids) {
                  {
                    resolve(response.ids);
                  }
                } else {
                  console.error("[VaesaSender] upload failed:", response);
                  resolve(null);
                }
              }
            });
          }
        } catch (error) {
          console.error("[VaesaSender] _uploadMedia error:", error);
          resolve(null);
        }
      }
    });
  },
  _downloadTxt(filename, content) {
    const options = {
      type: "text/plain;charset=utf-8"
    };
    var blob = new Blob([content], options);
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
  exportSuccess(stats) {
    var nowStr = new Date().toLocaleString("vi-VN");
    var txtLines = ["# Vaesa Inbox Tool — GỬI THÀNH CÔNG", "# Ngày: " + nowStr, "# Tổng: " + (stats.successList ? stats.successList.length : 0), "# Format: UID|Name|Timestamp|PSID|ConvID", ""];
    (stats.successList || []).forEach(function (item) {
      txtLines.push((item.uid || item) + "|" + (item.name || "") + "|" + (item.timestamp || "") + "|" + (item.psid || "") + "|" + (item.convId || ""));
    });
    this._downloadTxt("vaesa_thanh_cong_" + Date.now() + ".txt", txtLines.join("\n"));
  },
  exportFailure(stats) {
    var nowStr = new Date().toLocaleString("vi-VN");
    var txtLines = ["# Vaesa Inbox Tool — GỬI THẤT BẠI", "# Ngày: " + nowStr, "# Tổng: " + (stats.failureList ? stats.failureList.length : 0), "# Format: UID|Name|Timestamp|PSID|ConvID", ""];
    (stats.failureList || []).forEach(function (item) {
      txtLines.push((item.uid || item) + "|" + (item.name || "") + "|" + (item.timestamp || "") + "|" + (item.psid || "") + "|" + (item.convId || ""));
    });
    this._downloadTxt("vaesa_that_bai_" + Date.now() + ".txt", txtLines.join("\n"));
  },
  exportUnsent(stats) {
    var nowStr = new Date().toLocaleString("vi-VN");
    var txtLines = ["# Vaesa Inbox Tool — CHƯA GỬI", "# Ngày: " + nowStr, "# Tổng: " + (stats.unsentList ? stats.unsentList.length : 0), "# Format: UID|Name|Timestamp|PSID|ConvID", ""];
    (stats.unsentList || []).forEach(function (item) {
      txtLines.push((item.uid || item) + "|" + (item.name || "") + "|" + (item.timestamp || "") + "|" + (item.psid || "") + "|" + (item.convId || ""));
    });
    this._downloadTxt("vaesa_chua_gui_" + Date.now() + ".txt", txtLines.join("\n"));
  },
  exportAllReports(stats) {
    var self = this;
    if (stats.successList && stats.successList.length > 0) {
      self.exportSuccess(stats);
    }
    setTimeout(function () {
      stats.failureList && stats.failureList.length > 0 && self.exportFailure(stats);
    }, 600);
    setTimeout(function () {
      stats.unsentList && stats.unsentList.length > 0 && self.exportUnsent(stats);
    }, 1200);
  }
};
window.VaesaSender = VaesaSender;