(function () {
  "use strict";
  var mainContentEl = document.getElementById("main-content");
  var appState = {
    pages: [],
    sel: null,
    scanRes: [],
    pancakeTags: [],
  };
  var importedCustomers = [];

  // Quản lý danh sách quét đã lưu
  function saveScanToList(name, customers, pageId, callback) {
    chrome.storage.local.get(["vaesa_scan_list"], function (data) {
      var list = data.vaesa_scan_list || [];
      var entry = {
        id: Date.now().toString(36),
        name: name,
        count: customers.length,
        pageId: pageId || "",
        date: new Date().toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric", hour12: false }),
        customers: customers
      };
      list.unshift(entry); // Mới nhất ở trên
      if (list.length > 20) list = list.slice(0, 20); // Max 20 lần quét
      console.log("[Vaesa] saveScanToList: saving", entry.name, "count:", entry.count, "pageId:", entry.pageId, "total entries:", list.length);
      chrome.storage.local.set({ vaesa_scan_list: list }, function () {
        if (chrome.runtime.lastError) {
          console.error("[Vaesa] saveScanToList ERROR:", chrome.runtime.lastError.message);
        } else {
          console.log("[Vaesa] saveScanToList: saved OK");
        }
        if (callback) callback(entry);
      });
    });
  }

  function getScanList(callback) {
    chrome.storage.local.get(["vaesa_scan_list"], function (data) {
      callback(data.vaesa_scan_list || []);
    });
  }

  function deleteScanFromList(scanId, callback) {
    chrome.storage.local.get(["vaesa_scan_list"], function (data) {
      var list = (data.vaesa_scan_list || []).filter(function (s) { return s.id !== scanId; });
      chrome.storage.local.set({ vaesa_scan_list: list }, callback);
    });
  }

  // Lưu session state vào storage
  function saveSession() {
    var session = {
      sel: appState.sel,
      scanRes: appState.scanRes,
      pancakeTags: appState.pancakeTags || [],
      tagSelections: typeof tagSelections !== "undefined" ? {
        source: tagSelections.source || [],
        remove: tagSelections.remove || [],
        untag: tagSelections.untag || [],
        add: tagSelections.add || []
      } : null
    };
    chrome.storage.local.set({ vaesa_session: session });
  }

  // Khôi phục session state
  function loadSession(callback) {
    chrome.storage.local.get(["vaesa_session"], function (data) {
      callback(data.vaesa_session || null);
    });
  }
  try {
    document.getElementById("app-ver").textContent =
      "v" + chrome.runtime.getManifest().version;
  } catch (err) {}
  // Nút X đóng panel (nếu đang chạy trong iframe)
  var closePanelBtn = document.getElementById("btn-close-panel");
  if (closePanelBtn) {
    closePanelBtn.onclick = function () {
      if (window.parent !== window) {
        window.parent.postMessage({ action: "VAESA_CLOSE_PANEL" }, "*");
      } else {
        window.close();
      }
    };
  }
  function updateBadgeStatus() {
    chrome.tabs.query(
      {
        active: true,
        currentWindow: true,
      },
      function (tabs) {
        var currentUrl =
          (tabs && tabs[0] && (tabs[0].url || "")) || "";
        var badgeDot = document.querySelector(".badge-dot");
        var badgeText = document.querySelector(".badge-text");
        if (currentUrl.indexOf("facebook.com") > -1) {
          badgeDot.className = "badge-dot on";
          badgeText.textContent = "Facebook đã kết nối";
        } else {
          badgeDot.className = "badge-dot off";
          badgeText.textContent = "Hãy mở Facebook để sử dụng";
        }
      },
    );
  }
  updateBadgeStatus();
  if (chrome.tabs.onActivated) {
    chrome.tabs.onActivated.addListener(function () {
      setTimeout(updateBadgeStatus, 300);
    });
  }
  if (chrome.tabs.onUpdated) {
    chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
      if (changeInfo.status === "complete") {
        setTimeout(updateBadgeStatus, 300);
      }
    });
  }
  var scanRendered = false;
  var sendRendered = false;
  var templatesRendered = false;
  var scanContainer = document.createElement("div");
  var sendContainer = document.createElement("div");
  var templatesContainer = document.createElement("div");
  scanContainer.id = "tab-scan-content";
  sendContainer.id = "tab-send-content";
  templatesContainer.id = "tab-templates-content";
  sendContainer.style.display = "none";
  templatesContainer.style.display = "none";
  mainContentEl.appendChild(scanContainer);
  mainContentEl.appendChild(sendContainer);
  mainContentEl.appendChild(templatesContainer);

  function switchTab(tabName) {
    document.querySelectorAll(".tab").forEach(function (t) { t.classList.remove("active"); });
    document.querySelector('.tab[data-tab="' + tabName + '"]').classList.add("active");
    scanContainer.style.display = "none";
    sendContainer.style.display = "none";
    templatesContainer.style.display = "none";
    if (tabName === "scan") {
      scanContainer.style.display = "";
      if (!scanRendered) { scanRendered = true; renderScanTab(); }
    } else if (tabName === "send") {
      sendContainer.style.display = "";
      if (!sendRendered) { sendRendered = true; renderSendTab(); }
      if (window._refreshScanListInSendTab) window._refreshScanListInSendTab();
    } else if (tabName === "templates") {
      templatesContainer.style.display = "";
      if (!templatesRendered) { templatesRendered = true; renderTemplateTab(); }
      else if (window._refreshTemplateList) window._refreshTemplateList();
    }
  }

  document.querySelectorAll(".tab").forEach(function (tabItem) {
    tabItem.addEventListener("click", function () {
      switchTab(tabItem.dataset.tab);
    });
  });
  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
  function getEl(id) {
    return document.getElementById(id);
  }
  function renderScanTab() {
    scanContainer.innerHTML =
      '  <div class="card"><div class="card-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg> Chọn Fanpage</div>    <p class="card-desc"></p>    <div id="p-list" class="page-list"></div>    <button class="btn btn-outline" id="p-load" style="width:100%;margin-top:8px;font-size:12px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg> Tải lại danh sách Fanpage</button>    <div id="p-cfg" style="display:none;margin-top:14px">    <div style="font-weight:600;font-size:14px;margin-bottom:8px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;display:inline-block;vertical-align:middle;margin-right:4px"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.18V21a2 2 0 1 1-4 0v-.09z"/></svg> Cấu hình quét</div>    <div class="hint" style="margin-bottom:8px">Quét toàn bộ khách hàng đã từng nhắn tin đến Fanpage theo tag Pancake trong khoảng thời gian tuỳ chọn.</div>    <div id="p-session-status" style="margin-bottom:8px;padding:8px 12px;border-radius:8px;font-size:12px;display:none"></div>    <label class="label" style="margin-top:8px">Pancake Access Token</label>    <div style="display:flex;gap:6px;align-items:center">      <input type="password" class="input" id="p-pancake-token" placeholder="Nhập access_token..." style="flex:1">      <button class="btn btn-outline" id="p-token-toggle" title="Hiện/ẩn token" style="padding:8px 10px;font-size:13px;flex-shrink:0">👁</button>      <button class="btn btn-primary" id="p-token-save" style="padding:8px 14px;flex-shrink:0;font-size:12px">Lưu</button>    </div>    <div class="hint" id="p-token-status"></div>    <button class="btn btn-primary" id="p-scan-tags" style="width:100%;margin-top:8px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg> Quét tag Pancake</button>    <div id="p-tag-section" style="display:none;margin-top:12px">      <label class="label">Lọc tag</label>      <div style="position:relative">        <div class="tag-select-box" id="p-tag-box">          <span class="tag-placeholder" id="p-tag-placeholder">Chọn tag...</span>          <div class="tag-chips" id="p-tag-chips"></div>          <svg class="tag-arrow" id="p-tag-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>        </div>        <div class="tag-dropdown" id="p-tag-dropdown"></div>      </div>    </div>    <div id="p-tag-remove-section" style="display:none;margin-top:12px">      <label class="label">Loại trừ tag</label>      <div style="position:relative">        <div class="tag-select-box" id="p-tag-remove-box">          <span class="tag-placeholder" id="p-tag-remove-placeholder">Chọn tag loại trừ...</span>          <div class="tag-chips" id="p-tag-remove-chips"></div>          <svg class="tag-arrow" id="p-tag-remove-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>        </div>        <div class="tag-dropdown" id="p-tag-remove-dropdown"></div>      </div>    </div>    <div id="p-tag-untag-section" style="display:none;margin-top:12px">      <label class="label">Xoá tag sau gửi</label>      <div style="position:relative">        <div class="tag-select-box" id="p-tag-untag-box">          <span class="tag-placeholder" id="p-tag-untag-placeholder">Chọn tag cần xoá...</span>          <div class="tag-chips" id="p-tag-untag-chips"></div>          <svg class="tag-arrow" id="p-tag-untag-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>        </div>        <div class="tag-dropdown" id="p-tag-untag-dropdown"></div>      </div>    </div>    <div id="p-tag-add-section" style="display:none;margin-top:12px">      <label class="label">Gắn tag sau gửi</label>      <div style="position:relative">        <div class="tag-select-box" id="p-tag-add-box">          <span class="tag-placeholder" id="p-tag-add-placeholder">Chọn tag cần gắn...</span>          <div class="tag-chips" id="p-tag-add-chips"></div>          <svg class="tag-arrow" id="p-tag-add-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>        </div>        <div class="tag-dropdown" id="p-tag-add-dropdown"></div>      </div>    </div>    <label class="label" style="margin-top:12px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;margin-right:3px"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> Thời gian quét</label>    <div style="display:flex;gap:6px;align-items:center;margin-top:4px">      <div style="flex:1"><label class="label" style="font-size:11px;margin-bottom:2px">Từ ngày</label><input type="date" class="input" id="p-scan-since" style="font-size:12px"></div>      <div style="flex:1"><label class="label" style="font-size:11px;margin-bottom:2px">Đến ngày</label><input type="date" class="input" id="p-scan-until" style="font-size:12px"></div>    </div>    <div class="hint">Để trống = quét tối đa 24 tháng gần nhất.</div>    <button class="btn btn-primary" id="p-go" style="width:100%;margin-top:12px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> Quét khách hàng</button>    <div id="p-prog" style="display:none;margin-top:14px">      <div style="font-weight:600;font-size:14px;margin-bottom:8px"><span class="spinner" style="display:inline-block;vertical-align:middle;margin-right:6px"></span> Đang quét inbox...</div>      <div class="progress-bar"><div class="progress-fill" id="p-fill"></div></div>      <div class="progress-text" id="p-txt">Đang kết nối...</div>      <button class="btn btn-danger" id="p-stop-scan" style="width:100%;margin-top:10px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><rect x="3" y="3" width="18" height="18" rx="2"/></svg> Dừng quét</button>    </div>    <div id="p-res" style="display:none;margin-top:14px">      <div style="font-weight:600;font-size:14px;margin-bottom:8px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;display:inline-block;vertical-align:middle;margin-right:4px"><polyline points="20 6 9 17 4 12"/></svg> Quét hoàn tất</div>      <div style="text-align:center;padding:12px 0"><span style="font-size:28px;font-weight:700;color:var(--blue)" id="p-total">0</span><div class="hint" style="margin-top:4px">khách hàng được tìm thấy</div></div>      <button class="btn btn-primary" id="p-export" style="width:100%;margin-top:8px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Tải xuống</button>      <button class="btn btn-outline" id="p-rescan" style="width:100%;margin-top:6px;font-size:12px">Quét lại</button>      <div class="hint" id="p-hint" style="display:none;margin-top:8px"></div>    </div>  </div></div>';
    // Khôi phục danh sách page từ cache nếu có
    chrome.storage.local.get(["vaesa_cached_pages"], function (data) {
      if (data.vaesa_cached_pages && data.vaesa_cached_pages.length > 0) {
        renderPageList(data.vaesa_cached_pages);

        // Khôi phục session trước đó
        loadSession(function (session) {
          if (!session || !session.sel) return;

          // Tìm page đã chọn và click vào
          var pagesData = data.vaesa_cached_pages;
          var savedPageIdx = -1;
          for (var si = 0; si < pagesData.length; si++) {
            if (pagesData[si].id === session.sel.id) { savedPageIdx = si; break; }
          }
          if (savedPageIdx < 0) return;

          // Simulate chọn page
          var pageItem = document.querySelector('.page-item[data-i="' + savedPageIdx + '"]');
          if (pageItem) pageItem.click();

          // Khôi phục tag selections + kết quả quét sau 1 tick
          setTimeout(function () {
            // Khôi phục tags nếu có
            if (session.pancakeTags && session.pancakeTags.length > 0) {
              appState.pancakeTags = session.pancakeTags;

              // Khôi phục tagSelections trước khi populate
              if (session.tagSelections) {
                if (session.tagSelections.source) tagSelections.source = session.tagSelections.source;
                if (session.tagSelections.remove) tagSelections.remove = session.tagSelections.remove;
                if (session.tagSelections.untag) tagSelections.untag = session.tagSelections.untag;
                if (session.tagSelections.add) tagSelections.add = session.tagSelections.add;
              }

              // Populate dropdowns
              if (window._tagMultiSelects) {
                var ms = window._tagMultiSelects;
                if (ms.source) ms.source.populateDropdown(session.pancakeTags);
                if (ms.remove) ms.remove.populateDropdown(session.pancakeTags);
                if (ms.untag) ms.untag.populateDropdown(session.pancakeTags);
                if (ms.add) ms.add.populateDropdown(session.pancakeTags);

                // Update chips
                if (ms.source) ms.source.updateChips();
                if (ms.remove) ms.remove.updateChips();
                if (ms.untag) ms.untag.updateChips();
                if (ms.add) ms.add.updateChips();
              }

              // Hiện tag sections
              getEl("p-tag-section").style.display = "";
              getEl("p-tag-remove-section").style.display = "";
              getEl("p-tag-untag-section").style.display = "";
              getEl("p-tag-add-section").style.display = "";

              // Cập nhật nút quét tag
              var scanTagBtn = getEl("p-scan-tags");
              if (scanTagBtn) {
                scanTagBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg> Quét lại tag (' + session.pancakeTags.length + ' tag)';
              }
            }

            // Khôi phục kết quả quét
            if (session.scanRes && session.scanRes.length > 0) {
              handleScanResult({ customers: session.scanRes, _restored: true });
            }
          }, 300);
        });
      } else {
        var loadBtn = getEl("p-load");
        if (loadBtn) {
          loadBtn.className = "btn btn-primary";
          loadBtn.style.fontSize = "";
        }
      }
    });
    getEl("p-load").onclick = function () {
      var loadBtn = getEl("p-load");
      loadBtn.disabled = true;
      loadBtn.innerHTML = '<span class="spinner"></span> Đang tải danh sách Fanpage...';
      // Xoá cache cũ trước khi tải mới
      chrome.storage.local.remove(["vaesa_cached_pages"]);
      // Reset page đã chọn và cấu hình quét
      appState.sel = null;
      appState.scanRes = [];
      getEl("p-cfg").style.display = "none";
      getEl("p-res").style.display = "none";
      getEl("p-prog").style.display = "none";
      VaesaAPI.getPageList(
        null,
        function (response) {
          loadBtn.disabled = false;
          if (response.success) {
            renderPageList(response.pages);
            loadBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg> Tải lại (' + response.pages.length + ' fanpage)';
          } else {
            loadBtn.textContent = "⚠ Thử lại — " + (response.error || "Lỗi");
          }
        },
      );
    };
  }
  function renderPageList(pagesData) {
    appState.pages = pagesData;
    chrome.storage.local.set({ vaesa_cached_pages: pagesData });
    var pageListEl = getEl("p-list");

    // Tạo nút selected hiển thị page đang chọn
    var html = '<div id="p-selected" class="page-item" style="cursor:pointer;border:1.5px solid var(--blue)">' +
      '<div class="page-avatar"><span>?</span></div>' +
      '<div style="min-width:0;flex:1"><div class="page-name">Chọn Fanpage</div><div class="page-id">Nhấn để chọn</div></div>' +
      '<svg id="p-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;flex-shrink:0;transition:transform .2s"><polyline points="6 9 12 15 18 9"/></svg></div>';

    // Tạo danh sách dropdown (mặc định ẩn, position absolute để không đẩy layout)
    html += '<div style="position:relative"><div id="p-dropdown" style="display:none;position:absolute;top:0;left:0;right:0;z-index:100;background:#fff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.12);max-height:350px;overflow-y:auto">' + pagesData.map(function (page, index) {
      return '<div class="page-item" data-i="' + index + '" style="cursor:pointer">' +
        '<div class="page-avatar">' +
        (page.avatar ? '<img src="' + page.avatar + '" onerror="this.style.display=\'none\'">' : '') +
        '<span>' + escapeHtml(page.name.charAt(0)) + '</span></div>' +
        '<div style="min-width:0;flex:1"><div class="page-name">' + escapeHtml(page.name) + '</div>' +
        '<div class="page-id">ID: ' + page.id + '</div></div></div>';
    }).join("") + '</div></div>';

    pageListEl.innerHTML = html;

    var selectedEl = getEl("p-selected");
    var dropdownEl = getEl("p-dropdown");

    var arrowEl = getEl("p-arrow");
    // Click vào selected → toggle dropdown
    selectedEl.onclick = function (e) {
      e.stopPropagation();
      var isOpen = dropdownEl.style.display !== "none";
      dropdownEl.style.display = isOpen ? "none" : "";
      arrowEl.style.transform = isOpen ? "" : "rotate(180deg)";
    };
    // Click ngoài dropdown → đóng lại
    document.addEventListener("click", function () {
      if (dropdownEl.style.display !== "none") {
        dropdownEl.style.display = "none";
        arrowEl.style.transform = "";
      }
    });
    dropdownEl.addEventListener("click", function (e) {
      e.stopPropagation();
    });

    // Click vào page item → chọn page
    dropdownEl.querySelectorAll(".page-item").forEach(function (pageItem) {
      pageItem.onclick = function () {
        var page = pagesData[+pageItem.dataset.i];
        appState.sel = page;
        saveSession();

        // Cập nhật selected UI
        selectedEl.style.display = "";
        selectedEl.querySelector(".page-avatar").innerHTML =
          (page.avatar ? '<img src="' + page.avatar + '" onerror="this.style.display=\'none\'">' : '') +
          '<span>' + escapeHtml(page.name.charAt(0)) + '</span>';
        selectedEl.querySelector(".page-name").textContent = page.name;
        selectedEl.querySelector(".page-id").textContent = "ID: " + page.id;

        // Ẩn dropdown + reset arrow
        dropdownEl.style.display = "none";
        arrowEl.style.transform = "";

        // Reset kết quả quét cũ
        getEl("p-res").style.display = "none";
        getEl("p-prog").style.display = "none";
        appState.scanRes = [];

        // Reset token UI — load token riêng của page này
        var tokenInput = getEl("p-pancake-token");
        var tokenSaveBtn = getEl("p-token-save");
        var tokenStatus = getEl("p-token-status");
        tokenInput.value = "";
        tokenInput.type = "password";
        tokenSaveBtn.textContent = "Lưu";
        tokenSaveBtn.disabled = false;
        tokenStatus.innerHTML = "";

        // Reset session status
        var sessionEl = getEl("p-session-status");
        if (sessionEl) { sessionEl.style.display = "none"; sessionEl.innerHTML = ""; }

        // Reset tag sections
        var tagSection = getEl("p-tag-section");
        if (tagSection) tagSection.style.display = "none";
        var tagRemoveSection = getEl("p-tag-remove-section");
        if (tagRemoveSection) tagRemoveSection.style.display = "none";
        var tagUntagSection = getEl("p-tag-untag-section");
        if (tagUntagSection) tagUntagSection.style.display = "none";
        var tagAddSection = getEl("p-tag-add-section");
        if (tagAddSection) tagAddSection.style.display = "none";
        var scanTagBtn = getEl("p-scan-tags");
        if (scanTagBtn) scanTagBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg> Quét tag Pancake';

        // Hiện config
        getEl("p-cfg").style.display = "";
        getEl("p-go").onclick = handleScanClick;

        // Kiểm tra Pancake session token
        checkPancakeSession();

        setupTagUI();
      };
    });
  }
  var tagSelections = { source: [], remove: [], untag: [], add: [] };

  // Tạo multi-select dropdown cho tag — dùng chung cho cả 4 loại
  function initTagMultiSelect(prefix, placeholderText, selectionKey) {
    var box = getEl("p-tag-" + prefix + "-box") || getEl("p-tag-box");
    var dropdown = getEl("p-tag-" + prefix + "-dropdown") || getEl("p-tag-dropdown");
    var arrow = getEl("p-tag-" + prefix + "-arrow") || getEl("p-tag-arrow");
    var chips = getEl("p-tag-" + prefix + "-chips") || getEl("p-tag-chips");
    var placeholder = getEl("p-tag-" + prefix + "-placeholder") || getEl("p-tag-placeholder");
    tagSelections[selectionKey] = [];

    function updateChips() {
      var sel = tagSelections[selectionKey];
      if (sel.length === 0) {
        chips.innerHTML = "";
        placeholder.style.display = "";
        placeholder.textContent = placeholderText;
      } else {
        placeholder.style.display = "none";
        chips.innerHTML = sel.map(function (tag) {
          return '<span class="tag-chip">' + escapeHtml(tag.name) +
            '<span class="tag-chip-x" data-id="' + tag.id + '">&times;</span></span>';
        }).join("");
        chips.querySelectorAll(".tag-chip-x").forEach(function (xBtn) {
          xBtn.onclick = function (e) {
            e.stopPropagation();
            var removeId = xBtn.dataset.id;
            tagSelections[selectionKey] = tagSelections[selectionKey].filter(function (t) { return t.id !== removeId; });
            var cb = dropdown.querySelector('input[value="' + removeId + '"]');
            if (cb) cb.checked = false;
            updateChips();
            if (window._syncConflictDropdowns) window._syncConflictDropdowns();
          };
        });
      }
      saveSession();
    }

    function populateDropdown(tags) {
      dropdown.innerHTML = tags.map(function (tag) {
        var checked = tagSelections[selectionKey].find(function (t) { return t.id === tag.id; }) ? " checked" : "";
        return '<label class="tag-item" data-id="' + tag.id + '">' +
          '<input type="checkbox" value="' + tag.id + '"' + checked + '>' +
          '<span class="tag-item-name">' + escapeHtml(tag.name) + '</span>' +
          (tag.count !== undefined ? '<span class="tag-item-count">' + tag.count + '</span>' : '') + '</label>';
      }).join("");
      dropdown.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
        cb.onchange = function () {
          var tagId = cb.value;
          var tagItem = tags.find(function (t) { return t.id === tagId; });
          if (cb.checked) {
            if (!tagSelections[selectionKey].find(function (t) { return t.id === tagId; })) {
              tagSelections[selectionKey].push(tagItem);
            }
          } else {
            tagSelections[selectionKey] = tagSelections[selectionKey].filter(function (t) { return t.id !== tagId; });
          }
          updateChips();
          // Sync: disable tag đã chọn ở dropdown đối lập (source ↔ remove)
          if (window._syncConflictDropdowns) window._syncConflictDropdowns();
        };
      });
    }

    // Toggle dropdown
    box.onclick = function (e) {
      e.stopPropagation();
      // Đóng tất cả dropdown khác
      document.querySelectorAll(".tag-dropdown.open").forEach(function (d) {
        if (d !== dropdown) {
          d.classList.remove("open");
          d.previousElementSibling && d.previousElementSibling.classList.remove("active");
        }
      });
      document.querySelectorAll(".tag-arrow.open").forEach(function (a) {
        if (a !== arrow) a.classList.remove("open");
      });
      dropdown.classList.toggle("open");
      arrow.classList.toggle("open");
      box.classList.toggle("active");
    };

    // Click trong dropdown không đóng (cho chọn nhiều tag)
    dropdown.addEventListener("click", function (e) {
      e.stopPropagation();
    });

    return { populateDropdown: populateDropdown, updateChips: updateChips };
  }

  function checkPancakeSession() {
    var statusEl = getEl("p-session-status");
    if (!statusEl) return;
    chrome.runtime.sendMessage({ action: "GET_PANCAKE_SESSION" }, function (res) {
      if (res && res.token) {
        statusEl.style.display = "";
        statusEl.style.background = "#e8f5e9";
        statusEl.style.color = "#2e7d32";
        statusEl.innerHTML = "✅ Đã kết nối Pancake (session hợp lệ)";
      } else {
        statusEl.style.display = "";
        statusEl.style.background = "#fff3e0";
        statusEl.style.color = "#e65100";
        statusEl.innerHTML = '⚠️ Chưa đăng nhập Pancake. <a href="https://pancake.vn" target="_blank" style="color:#1565c0;text-decoration:underline">Đăng nhập tại đây</a> rồi quay lại.';
      }
    });
  }

  function setupTagUI() {
    var scanTagBtn = getEl("p-scan-tags");

    // Init 4 multi-selects
    var sourceMS = initTagMultiSelect("", "Chọn tag...", "source");
    var removeMS = initTagMultiSelect("remove", "Chọn tag loại trừ...", "remove");
    var untagMS = initTagMultiSelect("untag", "Chọn tag cần xoá...", "untag");
    var addMS = initTagMultiSelect("add", "Chọn tag cần gắn...", "add");

    // Expose để restore session có thể access
    window._tagMultiSelects = { source: sourceMS, remove: removeMS, untag: untagMS, add: addMS };

    // Sync: Lọc tag và Loại trừ tag không được chọn cùng tag
    // Hàm disable tag trong 1 dropdown dựa trên danh sách ID conflict
    function disableConflictTags(dropdownId, conflictIds, selectionKey, msRef) {
      var dropdown = getEl(dropdownId);
      if (!dropdown) return;
      dropdown.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
        var item = cb.closest(".tag-item");
        if (conflictIds.indexOf(cb.value) > -1) {
          cb.disabled = true;
          cb.checked = false;
          if (item) item.style.opacity = "0.35";
          tagSelections[selectionKey] = tagSelections[selectionKey].filter(function (t) { return t.id !== cb.value; });
        } else {
          cb.disabled = false;
          if (item) item.style.opacity = "";
        }
      });
      if (msRef && msRef.updateChips) msRef.updateChips();
    }

    window._syncConflictDropdowns = function () {
      var sourceIds = (tagSelections.source || []).map(function (t) { return t.id; });
      var removeIds = (tagSelections.remove || []).map(function (t) { return t.id; });
      var untagIds = (tagSelections.untag || []).map(function (t) { return t.id; });
      var addIds = (tagSelections.add || []).map(function (t) { return t.id; });

      // Lọc tag ↔ Loại trừ tag: không chọn chung
      disableConflictTags("p-tag-remove-dropdown", sourceIds, "remove", removeMS);
      disableConflictTags("p-tag-dropdown", removeIds, "source", sourceMS);

      // Xoá tag sau gửi ↔ Gắn tag sau gửi: không chọn chung
      disableConflictTags("p-tag-add-dropdown", untagIds, "add", addMS);
      disableConflictTags("p-tag-untag-dropdown", addIds, "untag", untagMS);
    }

    // Click ngoài → đóng tất cả tag dropdown
    document.addEventListener("click", function () {
      document.querySelectorAll(".tag-dropdown.open").forEach(function (d) { d.classList.remove("open"); });
      document.querySelectorAll(".tag-arrow.open").forEach(function (a) { a.classList.remove("open"); });
      document.querySelectorAll(".tag-select-box.active").forEach(function (b) { b.classList.remove("active"); });
    });

    // Token elements
    var tokenInput = getEl("p-pancake-token");
    var tokenToggle = getEl("p-token-toggle");
    var tokenSaveBtn = getEl("p-token-save");
    var tokenStatus = getEl("p-token-status");

    // Load saved token nếu có
    if (appState.sel && PancakeAPI) {
      PancakeAPI.getToken(appState.sel.id, function (savedToken) {
        if (savedToken && tokenInput) {
          tokenInput.value = savedToken;
          tokenInput.type = "password";
          tokenSaveBtn.textContent = "Đã lưu";
          tokenSaveBtn.disabled = true;
          tokenStatus.innerHTML = '<span style="color:var(--green)">Token đã lưu</span>';
          appState.pancakeToken = savedToken;
        }
      });
    }

    // Toggle hiện/ẩn token
    tokenToggle.onclick = function () {
      tokenInput.type = tokenInput.type === "password" ? "text" : "password";
      tokenToggle.textContent = tokenInput.type === "password" ? "👁" : "🙈";
    };

    // Nút lưu token
    tokenSaveBtn.onclick = function () {
      var token = tokenInput.value.trim();
      if (!token) {
        tokenStatus.innerHTML = '<span style="color:var(--red)">Chưa nhập token</span>';
        return;
      }
      PancakeAPI.saveToken(appState.sel.id, token);
      appState.pancakeToken = token;
      tokenInput.type = "password";
      tokenToggle.textContent = "👁";
      tokenSaveBtn.textContent = "Đã lưu";
      tokenSaveBtn.disabled = true;
      tokenStatus.innerHTML = '<span style="color:var(--green)">Token đã lưu</span>';
    };

    // Khi sửa token → cho phép lưu lại
    tokenInput.oninput = function () {
      tokenSaveBtn.textContent = "Lưu";
      tokenSaveBtn.disabled = false;
      tokenStatus.innerHTML = "";
    };

    // Nút quét tag
    scanTagBtn.onclick = function () {
      var token = tokenInput ? tokenInput.value.trim() : "";
      if (!token) {
        tokenStatus.innerHTML = '<span style="color:var(--red)">Vui lòng nhập token trước</span>';
        tokenInput.focus();
        return;
      }

      scanTagBtn.disabled = true;
      scanTagBtn.innerHTML = '<span class="spinner"></span> Đang quét tag...';

      PancakeAPI.getTags(appState.sel.id, token, function (err, tags) {
        scanTagBtn.disabled = false;
        if (err || !tags || tags.length === 0) {
          scanTagBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg> Quét tag Pancake';
          tokenStatus.innerHTML = '<span style="color:var(--red);font-weight:600">Token hết hạn hoặc không hợp lệ. Vui lòng thay token mới.</span>';
          tokenInput.type = "text";
          tokenInput.focus();
          tokenInput.select();
          tokenSaveBtn.textContent = "Lưu";
          tokenSaveBtn.disabled = false;
          return;
        }

        // Reset tag đã chọn trước đó
        tagSelections = { source: [], remove: [], untag: [], add: [] };

        // Populate tất cả 4 dropdown với cùng danh sách tag
        sourceMS.populateDropdown(tags);
        removeMS.populateDropdown(tags);
        untagMS.populateDropdown(tags);
        addMS.populateDropdown(tags);
        // Clear chips hiển thị
        sourceMS.updateChips();
        removeMS.updateChips();
        untagMS.updateChips();
        addMS.updateChips();

        // Hiện tất cả sections
        getEl("p-tag-section").style.display = "";
        getEl("p-tag-remove-section").style.display = "";
        getEl("p-tag-untag-section").style.display = "";
        getEl("p-tag-add-section").style.display = "";

        // Cache tags
        appState.pancakeTags = tags;
        saveSession();

        scanTagBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg> Quét lại tag (' + tags.length + ' tag)';
      });
    };
  }
  var scanStopped = false;

  function handleScanClick() {
    if (!appState.sel) {
      return;
    }
    scanStopped = false;
    // Lấy tag nguồn + bỏ tag đã chọn
    var sourceTagIds = (tagSelections.source || []).map(function (t) { return String(t.id); });
    var excludeTagIds = (tagSelections.remove || []).map(function (t) { return String(t.id); });
    var pancakeToken = "";
    var tokenEl = getEl("p-pancake-token");
    if (tokenEl) pancakeToken = tokenEl.value.trim();

    // Nếu có tag nguồn → quét Pancake + Facebook SONG SONG rồi mapping
    if (sourceTagIds.length > 0 && pancakeToken) {
      getEl("p-go").style.display = "none";
      getEl("p-prog").style.display = "";
      getEl("p-res").style.display = "none";
      getEl("p-fill").style.width = "0%";
      getEl("p-fill").style.transition = "none";
      getEl("p-fill").classList.add("progress-fill-pulse");
      getEl("p-txt").textContent = "Đang quét Pancake + Facebook song song...";

      // Nút dừng quét
      var stopBtn = getEl("p-stop-scan");
      if (stopBtn) {
        stopBtn.onclick = function () {
          scanStopped = true;
          getEl("p-txt").textContent = "Đang dừng...";
          stopBtn.disabled = true;
          stopBtn.textContent = "Đang dừng...";
        };
      }

      var scanSince = getEl("p-scan-since") ? getEl("p-scan-since").value : "";
      var scanUntil = getEl("p-scan-until") ? getEl("p-scan-until").value : "";

      var pancakeDone = false;
      var fbDone = false;
      var pancakeResult = null;
      var fbResult = null;
      var pancakeError = null;
      var pancakeCount = 0;
      var fbCount = 0;

      function updateProgress() {
        var parts = [];
        parts.push("Pancake: " + VaesaUtils.formatNumber(pancakeCount) + (pancakeDone ? " ✓" : "..."));
        parts.push("Facebook: " + VaesaUtils.formatNumber(fbCount) + (fbDone ? " ✓" : "..."));
        getEl("p-txt").textContent = parts.join(" | ");
      }

      function tryMerge() {
        if (!pancakeDone || !fbDone) return;

        if (pancakeError || !pancakeResult) {
          getEl("p-prog").style.display = "none";
          getEl("p-go").style.display = "";
          alert("Lỗi quét Pancake: " + (pancakeError || "Không có dữ liệu"));
          return;
        }

        getEl("p-txt").textContent = "Đang mapping UID...";

        console.log("===== [Vaesa] DEBUG BÁO CÁO =====");
        console.log("[Vaesa] 1. Pancake API trả về:", pancakeResult ? pancakeResult.length : 0, "conversations");
        console.log("[Vaesa] 2. Facebook API trả về:", (fbResult && fbResult.customers) ? fbResult.customers.length : 0, "customers");
        console.log("[Vaesa] sourceTagIds:", sourceTagIds);
        console.log("[Vaesa] excludeTagIds:", excludeTagIds);
        if (pancakeResult && pancakeResult.length > 0) {
          console.log("[Vaesa] Pancake sample[0]:", JSON.stringify(pancakeResult[0]).substring(0, 500));
        }
        if (fbResult && fbResult.customers && fbResult.customers.length > 0) {
          console.log("[Vaesa] Facebook sample[0]:", JSON.stringify(fbResult.customers[0]));
        }

        // Client-side filter: Lọc tag
        var pancakeFiltered = [];
        var skipNoTag = 0, skipExclude = 0, skipNoName = 0;
        for (var i = 0; i < pancakeResult.length; i++) {
          var conv = pancakeResult[i];
          var convTagIds = (conv.tags || [])
            .filter(function (t) { return t != null; })
            .map(function (t) { return String(t.id != null ? t.id : t); });

          var hasAnySource = sourceTagIds.some(function (id) {
            return convTagIds.indexOf(id) > -1;
          });
          if (!hasAnySource) { skipNoTag++; continue; }

          if (excludeTagIds.length > 0) {
            var hasExclude = excludeTagIds.some(function (id) {
              return convTagIds.indexOf(id) > -1;
            });
            if (hasExclude) { skipExclude++; continue; }
          }

          var customer = conv.customers && conv.customers[0];
          var clientName = (customer && customer.name) || conv.customer_name || conv.name || "";
          if (!clientName || clientName === "Facebook User" || clientName === "Người dùng Facebook") { skipNoName++; continue; }

          var psid = String(
            (customer && customer.fb_id) ||
            conv.customer_id ||
            (customer && customer.id) ||
            conv.id || ""
          );
          // Pancake updated_at có thể là unix seconds hoặc ms hoặc ISO string
          var rawUpdated = conv.updated_at || conv.last_message_at || "";
          var lastMsgMs;
          if (typeof rawUpdated === "number") {
            // Nếu < 10 tỷ → unix seconds, cần x1000
            lastMsgMs = rawUpdated < 10000000000 ? rawUpdated * 1000 : rawUpdated;
          } else if (typeof rawUpdated === "string" && rawUpdated) {
            var parsed = Date.parse(rawUpdated);
            if (!isNaN(parsed)) {
              lastMsgMs = parsed;
            } else {
              var asNum = parseInt(rawUpdated, 10);
              lastMsgMs = asNum < 10000000000 ? asNum * 1000 : asNum;
            }
          } else {
            lastMsgMs = Date.now();
          }

          // Format HH:mm dd/MM/yyyy (không có giây)
          var dateObj = new Date(lastMsgMs);
          var formattedTs = dateObj.toLocaleString("vi-VN", {
            hour: "2-digit", minute: "2-digit",
            day: "2-digit", month: "2-digit", year: "numeric",
            hour12: false
          });

          pancakeFiltered.push({
            psid: psid,
            name: clientName,
            nameLower: clientName.toLowerCase().trim(),
            timestamp: formattedTs,
            rawTimestamp: String(lastMsgMs),
            convId: String(conv.id || ""),
            tagIds: convTagIds
          });
        }

        console.log("[Vaesa] 3. Pancake sau lọc tag:", pancakeFiltered.length, "(bỏ: không có tag=" + skipNoTag + ", tag loại trừ=" + skipExclude + ", không tên=" + skipNoName + ")");

        if (pancakeFiltered.length === 0) {
          console.log("[Vaesa] KẾT QUẢ: 0 khách hàng (Pancake lọc ra 0)");
          handleScanResult({ customers: [] });
          return;
        }

        // Tạo map tên → UID từ Facebook
        var fbCustomers = (fbResult && fbResult.customers) || [];
        var nameToUid = {};
        for (var j = 0; j < fbCustomers.length; j++) {
          var fb = fbCustomers[j];
          var fbNameKey = (fb.name || "").toLowerCase().trim();
          if (fbNameKey && fb.uid) {
            nameToUid[fbNameKey] = fb.uid;
          }
        }

        // Mapping: Pancake name → Facebook UID
        var finalList = [];
        var mappedCount = 0;
        var unmappedCount = 0;
        for (var k = 0; k < pancakeFiltered.length; k++) {
          var pk = pancakeFiltered[k];
          var realUid = nameToUid[pk.nameLower];
          if (realUid) {
            mappedCount++;
            // Ưu tiên timestamp từ Facebook (chính xác hơn Pancake)
            var fbMatch = null;
            for (var fi = 0; fi < fbCustomers.length; fi++) {
              if (fbCustomers[fi].uid === realUid) { fbMatch = fbCustomers[fi]; break; }
            }
            var useTimestamp = (fbMatch && fbMatch.timestamp) ? fbMatch.timestamp : pk.timestamp;
            var useRawTimestamp = (fbMatch && fbMatch.rawTimestamp) ? fbMatch.rawTimestamp : pk.rawTimestamp;
            finalList.push({
              uid: realUid,
              name: pk.name,
              timestamp: useTimestamp,
              rawTimestamp: useRawTimestamp,
              psid: pk.psid,
              convId: pk.convId,
              tagIds: pk.tagIds
            });
          } else {
            unmappedCount++;
            // Bỏ qua — không map được UID thật thì không đưa vào kết quả
          }
        }


        // Dedup theo UID
        var seenUids = {};
        var dedupList = [];
        var dupCount = 0;
        for (var d = 0; d < finalList.length; d++) {
          if (!seenUids[finalList[d].uid]) {
            seenUids[finalList[d].uid] = true;
            dedupList.push(finalList[d]);
          } else {
            dupCount++;
          }
        }
        finalList = dedupList;

        console.log("[Vaesa] 4. Facebook nameToUid map size:", Object.keys(nameToUid).length);
        console.log("[Vaesa] 5. Mapping: " + mappedCount + " UID thật, " + unmappedCount + " bỏ qua (tên không khớp)" + (dupCount > 0 ? ", " + dupCount + " trùng UID" : ""));
        console.log("[Vaesa] ===== KẾT QUẢ CUỐI: " + finalList.length + " khách hàng =====");
        if (unmappedCount > 0 && pancakeFiltered.length > 0) {
          var unmappedList = [];
          for (var um = 0; um < pancakeFiltered.length; um++) {
            if (!nameToUid[pancakeFiltered[um].nameLower]) {
              unmappedList.push(pancakeFiltered[um].name + " (PSID: " + pancakeFiltered[um].psid + ")");
            }
          }
          console.log("[Vaesa] DANH SÁCH " + unmappedCount + " KHÁCH KHÔNG MAP ĐƯỢC:");
          console.log(unmappedList.join("\n"));
        }
        handleScanResult({ customers: finalList });
      }

      // === Chạy song song ===

      // 1. Pancake scan
      PancakeAPI.getAllConversationsByTag(
        appState.sel.id,
        pancakeToken,
        sourceTagIds[0],
        { sinceDate: scanSince || null, untilDate: scanUntil || null, maxMonths: 24 },
        function (total) { pancakeCount = total; updateProgress(); },
        function () { return scanStopped; },
        function (err, conversations) {
          pancakeDone = true;
          pancakeError = err;
          pancakeResult = conversations;
          updateProgress();
          tryMerge();
        }
      );

      // 2. Facebook scan (chạy đồng thời)
      VaesaAPI.scanInboxCustomers(
        appState.sel.id,
        10000,
        function (count) { fbCount = count; updateProgress(); },
        function (result) {
          fbDone = true;
          fbResult = result;
          updateProgress();
          tryMerge();
        },
        null,
        function () { return scanStopped; }
      );
      return;
    }

    // Quét bình thường qua Facebook API
    getEl("p-go").style.display = "none";
    getEl("p-prog").style.display = "";
    getEl("p-res").style.display = "none";
    getEl("p-fill").style.width = "0%";
    getEl("p-fill").style.transition = "none";
    getEl("p-fill").classList.add("progress-fill-pulse");

    // Nút dừng quét
    var stopBtn2 = getEl("p-stop-scan");
    if (stopBtn2) {
      stopBtn2.disabled = false;
      stopBtn2.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><rect x="3" y="3" width="18" height="18" rx="2"/></svg> Dừng quét';
      stopBtn2.onclick = function () {
        scanStopped = true;
        getEl("p-txt").textContent = "Đang dừng...";
        stopBtn2.disabled = true;
        stopBtn2.textContent = "Đang dừng...";
      };
    }

    VaesaAPI.scanInboxCustomers(
      appState.sel.id,
      10000,
      function (scanCount) {
        getEl("p-txt").textContent =
          VaesaUtils.formatNumber(scanCount) + " khách hàng đã quét...";
      },
      function (result) {
        // Nếu có tag loại trừ → lọc bằng Pancake API
        if (excludeTagIds.length > 0 && pancakeToken && result.customers && result.customers.length > 0) {
          getEl("p-txt").textContent = "Đang lọc tag loại trừ...";
          filterByExcludeTags(result, excludeTagIds, pancakeToken, function (filteredResult) {
            handleScanResult(filteredResult);
          });
        } else {
          handleScanResult(result);
        }
      },
      null,
      function () { return scanStopped; }
    );
  }

  // Lọc KH có tag loại trừ bằng Pancake API
  function filterByExcludeTags(result, excludeTagIds, pancakeToken, callback) {
    if (!appState.sel) return callback(result);

    var excludeNames = {};
    var tagsProcessed = 0;
    var totalTags = excludeTagIds.length;

    function processNextTag() {
      if (tagsProcessed >= totalTags) {
        // Đã quét hết tag loại trừ → filter kết quả
        var before = result.customers.length;
        var filtered = result.customers.filter(function (c) {
          var nameLower = (c.name || "").toLowerCase().trim();
          return !excludeNames[nameLower];
        });
        console.log("[Vaesa] Loại trừ tag: " + before + " → " + filtered.length + " (loại " + (before - filtered.length) + " KH)");
        result.customers = filtered;
        callback(result);
        return;
      }

      var tagId = excludeTagIds[tagsProcessed];
      getEl("p-txt").textContent = "Đang lọc tag loại trừ (" + (tagsProcessed + 1) + "/" + totalTags + ")...";

      PancakeAPI.getAllConversationsByTag(
        appState.sel.id,
        pancakeToken,
        tagId,
        { maxMonths: 24 },
        null,
        function () { return scanStopped; },
        function (err, conversations) {
          if (!err && conversations) {
            for (var i = 0; i < conversations.length; i++) {
              var conv = conversations[i];
              var customer = conv.customers && conv.customers[0];
              var name = (customer && customer.name) || conv.customer_name || conv.name || "";
              if (name) {
                excludeNames[name.toLowerCase().trim()] = true;
              }
            }
          }
          tagsProcessed++;
          processNextTag();
        }
      );
    }

    processNextTag();
  }
  function handleScanResult(result) {
    getEl("p-prog").style.display = "none";
    getEl("p-res").style.display = "";
    getEl("p-fill").classList.remove("progress-fill-pulse");
    appState.scanRes = result.customers || [];
    var totalCount = appState.scanRes.length;
    getEl("p-total").textContent = VaesaUtils.formatNumber(totalCount);
    saveSession();

    // Auto-save vào danh sách quét (nếu có kết quả và không phải restore)
    if (totalCount > 0 && !result._restored) {
      var selectedTags = (tagSelections.source || []).map(function (t) { return t.name; }).join(", ");
      var scanName = (appState.sel ? appState.sel.name : "Unknown") +
        (selectedTags ? " — " + selectedTags : "") +
        " (" + VaesaUtils.formatNumber(totalCount) + " khách)";
      console.log("[Vaesa] About to saveScanToList:", scanName);
      saveScanToList(scanName, appState.scanRes, appState.sel ? appState.sel.id : "", function () {
        // Refresh send tab list nếu đã render
        if (window._refreshScanListInSendTab) window._refreshScanListInSendTab();
      });
    }

    // Nút tải xuống
    getEl("p-export").onclick = function () {
      var hintEl = getEl("p-hint");
      if (appState.scanRes.length === 0) {
        hintEl.style.display = "";
        hintEl.innerHTML = '<span style="color:var(--red)">Không có khách hàng nào!</span>';
        return;
      }
      var filename = VaesaAPI.exportCustomersToTxt(appState.scanRes, appState.sel.name);
      hintEl.style.display = "";
      hintEl.innerHTML = "Đã xuất <strong>" + VaesaUtils.formatNumber(appState.scanRes.length) + "</strong> khách → <strong>" + filename + "</strong>";
    };

    // Nút quét lại
    var rescanBtn = getEl("p-rescan");
    if (rescanBtn) {
      rescanBtn.onclick = function () {
        getEl("p-res").style.display = "none";
        getEl("p-go").style.display = "";
      };
    }
  }
  function renderSendTab() {
    sendContainer.innerHTML =
      '  <div class="card" id="s-main-card"><div class="card-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> Chọn danh sách khách hàng</div>    <p class="card-desc">Chọn danh sách đã quét từ tab Quét khách hàng.</p>    <div style="position:relative;z-index:100">      <div class="tag-select-box" id="s-scan-box" style="min-height:42px;cursor:pointer">        <span class="tag-placeholder" id="s-scan-placeholder">Nhấn để tải danh sách tệp...</span>        <div id="s-scan-selected-info" style="display:none;width:100%"></div>        <svg class="tag-arrow" id="s-scan-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>      </div>      <div id="s-scan-dropdown-wrap" class="tag-dropdown" style="display:none;max-height:250px;overflow-y:auto;z-index:999"></div>    </div>    <div class="hint" id="s-finfo" style="display:none;margin-top:8px"></div>    <details style="margin-top:8px"><summary style="font-size:12px;color:#888;cursor:pointer">Hoặc tải file .txt thủ công</summary>    <div class="file-drop" id="s-drop" style="margin-top:6px"><input type="file" id="s-file" accept=".txt" style="display:none"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><span>Kéo thả hoặc <strong>nhấn chọn file .txt</strong></span></div>    </details>    <select class="select" id="s-page" style="display:none"></select>    <div id="s-cfg">    <label class="label" style="margin-top:12px">Chọn mẫu tin nhắn</label><select class="select" id="s-tmpl-select" style="margin-bottom:8px"><option value="">-- Chọn mẫu --</option></select>    <label class="label">Nội dung tin nhắn</label><textarea class="textarea" id="s-msg" rows="3" placeholder="Chào [name], mình muốn gửi bạn thông tin...&#10;{Sử dụng spin|để tạo|nội dung ngẫu nhiên}"></textarea>    <div class="hint"><code>[name]</code> = tên khách hàng · <code>{a|b|c}</code> = chọn ngẫu nhiên 1 trong 3</div>    <label class="label">Đính kèm ảnh (không bắt buộc)</label>    <div class="img-picker" id="s-img-picker">      <div class="img-drop" id="s-img-drop"><input type="file" id="s-att" accept="image/*" multiple style="display:none"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> <span>Chọn ảnh</span></div>      <div class="img-thumbs" id="s-img-thumbs"></div>      <div class="img-mode" id="s-img-mode" style="display:none">        <label class="label" style="margin-top:6px">Chế độ gửi ảnh</label>        <div class="img-mode-options">          <label class="img-mode-opt"><input type="radio" name="img-mode" value="all" checked> <span>Gửi tất cả ảnh</span><small>Mỗi tin nhắn đính kèm tất cả ảnh đã chọn</small></label>          <label class="img-mode-opt"><input type="radio" name="img-mode" value="random"> <span>Random 1 ảnh</span><small>Mỗi tin nhắn chọn ngẫu nhiên 1 ảnh</small></label>        </div>      </div>    </div>    <div class="row" style="margin-top:12px"><div style="flex:1"><label class="label">Delay từ (giây)</label><input type="number" class="input" id="s-ft" value="3" min="2"></div><div style="flex:1"><label class="label">Delay đến (giây)</label><input type="number" class="input" id="s-tt" value="10" min="3"></div></div>    <div class="row" style="margin-top:4px"><div style="flex:1"><label class="label">Nghỉ sau (tin)</label><input type="number" class="input" id="s-ra" value="20"></div><div style="flex:1"><label class="label">Nghỉ (giây)</label><input type="number" class="input" id="s-rd" value="30"></div></div>    <label class="label">Thứ tự gửi</label><select class="select" id="s-ord"><option value="3">Ngẫu nhiên (khuyên dùng)</option><option value="1">Mới nhất → Cũ nhất</option><option value="2">Cũ nhất → Mới nhất</option></select>    <label class="label">Giới hạn số tin (0 = gửi hết)</label><input type="number" class="input" id="s-lim" value="0" min="0">    <button class="btn btn-primary" id="s-go" style="width:100%;margin-top:14px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> Bắt đầu gửi tin nhắn</button>    <div id="s-sending" style="display:none;margin-top:14px">      <div style="font-weight:600;font-size:14px;margin-bottom:8px"><span class="spinner" style="display:inline-block;vertical-align:middle;margin-right:6px"></span> Đang gửi tin nhắn...</div>      <div class="progress-bar"><div class="progress-fill" id="s-fill"></div></div>      <div class="stat-row" style="margin:12px 0"><div class="stat"><span class="stat-num" id="ss-s">0</span><span class="stat-pct" id="ss-s-pct"></span><span class="stat-label">Đã xử lý</span></div><div class="stat"><span class="stat-num c-green" id="ss-ok">0</span><span class="stat-pct c-green" id="ss-ok-pct"></span><span class="stat-label">Thành công</span></div><div class="stat"><span class="stat-num c-red" id="ss-err">0</span><span class="stat-pct c-red" id="ss-err-pct"></span><span class="stat-label">Thất bại</span></div></div>      <div class="log-box" id="s-log"></div>      <div class="row" style="gap:8px;margin-top:12px"><button class="btn btn-warn" id="s-pause" style="flex:1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Tạm dừng</button><button class="btn btn-danger" id="s-stop" style="flex:1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg> Dừng lại</button></div>    </div>    <div id="s-report" style="display:none;margin-top:14px">      <div style="font-weight:600;font-size:14px;margin-bottom:8px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;display:inline-block;vertical-align:middle;margin-right:4px"><polyline points="20 6 9 17 4 12"/></svg> Báo cáo chiến dịch</div>      <div id="s-rpt"></div>      <div style="margin-top:14px;display:flex;flex-direction:column;gap:8px">        <button class="btn btn-primary" id="s-ea" style="width:100%"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Tải tất cả (3 file .txt)</button>        <div style="display:flex;gap:6px"><button class="btn btn-success" id="s-es" style="flex:1">✓ Thành công</button><button class="btn btn-danger" id="s-ef" style="flex:1">✗ Thất bại</button><button class="btn btn-amber" id="s-eu" style="flex:1">○ Chưa gửi</button></div>      </div>    </div>  </div></div>';
    var ddWrap = getEl("s-scan-dropdown-wrap");
    var scanBox = getEl("s-scan-box");
    var scanArrow = getEl("s-scan-arrow");
    var ddOpen = false;

    function populateSendPageSelect() {
      var selectEl = getEl("s-page");
      if (selectEl) {
        populatePageSelect(selectEl);
        // Mặc định chọn page đã chọn ở tab Quét
        if (appState.sel && appState.sel.id) {
          selectEl.value = appState.sel.id;
        }
      }
    }

    function closeScanDD() {
      ddOpen = false;
      if (ddWrap) ddWrap.style.display = "none";
      if (scanArrow) scanArrow.classList.remove("open");
      if (scanBox) scanBox.classList.remove("active");
    }

    function selectScan(scan) {
      closeScanDD();
      var ph = getEl("s-scan-placeholder");
      var infoEl = getEl("s-scan-selected-info");
      if (ph) ph.style.display = "none";
      if (infoEl) {
        infoEl.style.display = "";
        infoEl.innerHTML =
          '<div style="font-weight:600;font-size:13px">' + escapeHtml(scan.name) + '</div>' +
          '<div style="font-size:11px;color:#888;margin-top:2px">' + scan.date + ' · ' + VaesaUtils.formatNumber(scan.count) + ' khách</div>';
      }
      importedCustomers = scan.customers || [];
      var finfoEl = getEl("s-finfo");
      if (finfoEl) {
        finfoEl.style.display = "";
        finfoEl.innerHTML = "Đã chọn <strong>" + VaesaUtils.formatNumber(importedCustomers.length) + "</strong> khách hàng";
      }
      populateSendPageSelect();
    }

    function loadAndShowScanList() {
      var currentPageId = appState.sel ? appState.sel.id : "";
      getScanList(function (list) {
        var filtered = currentPageId ? list.filter(function (s) { return s.pageId === currentPageId; }) : list;
        if (filtered.length === 0) {
          ddWrap.style.display = "block";
          ddWrap.innerHTML = '<div style="padding:12px;text-align:center;color:#888;font-size:12px">' +
            (currentPageId ? 'Chưa có danh sách quét cho page này.' : 'Chưa có danh sách nào. Hãy quét khách hàng trước.') + '</div>';
          ddOpen = true;
          if (scanArrow) scanArrow.classList.add("open");
          if (scanBox) scanBox.classList.add("active");
          return;
        }
        ddWrap.innerHTML = filtered.map(function (scan) {
          return '<div class="scan-dd-item" data-id="' + scan.id + '" style="display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:pointer;border-bottom:1px solid #f0f0f0;transition:background .1s">' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(scan.name) + '</div>' +
              '<div style="font-size:11px;color:#888">' + scan.date + '</div>' +
            '</div>' +
            '<span style="font-size:11px;color:var(--blue);font-weight:600;white-space:nowrap">' + VaesaUtils.formatNumber(scan.count) + '</span>' +
            '<span class="scan-del" data-id="' + scan.id + '" title="Xoá" style="font-size:14px;color:#ccc;cursor:pointer;padding:2px 4px">&times;</span>' +
          '</div>';
        }).join("");
        ddWrap.style.display = "block";
        ddOpen = true;
        if (scanArrow) scanArrow.classList.add("open");
        if (scanBox) scanBox.classList.add("active");

        ddWrap.querySelectorAll(".scan-dd-item").forEach(function (item) {
          item.onmouseenter = function () { item.style.background = "#f5f7ff"; };
          item.onmouseleave = function () { item.style.background = ""; };
          item.onclick = function (e) {
            if (e.target.classList.contains("scan-del")) return;
            e.stopPropagation();
            var scanId = item.dataset.id;
            var scan = filtered.find(function (s) { return s.id === scanId; });
            if (scan) selectScan(scan);
          };
        });

        ddWrap.querySelectorAll(".scan-del").forEach(function (delBtn) {
          delBtn.onclick = function (e) {
            e.stopPropagation();
            var scanId = delBtn.dataset.id;
            deleteScanFromList(scanId, function () {
              loadAndShowScanList();
            });
          };
        });
      });
    }

    // Click vào box → toggle dropdown
    if (scanBox) {
      scanBox.addEventListener("click", function (e) {
        e.stopPropagation();
        if (ddOpen) { closeScanDD(); } else { loadAndShowScanList(); }
      });
    }

    // Click trong dropdown → không đóng
    if (ddWrap) {
      ddWrap.addEventListener("click", function (e) { e.stopPropagation(); });
    }

    // Click ra ngoài → đóng
    document.addEventListener("click", function () {
      if (ddOpen) closeScanDD();
    });

    // Populate page select ngay khi render
    populateSendPageSelect();

    // Gắn onclick cho nút gửi tin
    getEl("s-go").onclick = startSending;

    // Template dropdown
    loadTemplateDropdownInSendTab();
    getEl("s-tmpl-select").onchange = function () {
      var tmplId = this.value;
      if (tmplId) applyTemplateToSendTab(tmplId);
    };

    window._refreshScanListInSendTab = function () {
      loadTemplateDropdownInSendTab();
    };

    var dropZone = getEl("s-drop");
    var fileInput = getEl("s-file");
    dropZone.onclick = function () {
      fileInput.click();
    };
    dropZone.ondragover = function (evOver) {
      evOver.preventDefault();
      dropZone.classList.add("dragover");
    };
    dropZone.ondragleave = function () {
      dropZone.classList.remove("dragover");
    };
    dropZone.ondrop = function (evDrop) {
      evDrop.preventDefault();
      dropZone.classList.remove("dragover");
      if (evDrop.dataTransfer.files[0]) {
        handleFileSelect(evDrop.dataTransfer.files[0]);
      }
    };
    fileInput.onchange = function () {
      if (fileInput.files[0]) {
        handleFileSelect(fileInput.files[0]);
      }
    };
    var imgDropZone = getEl("s-img-drop");
    var imgFileInp = getEl("s-att");
    imgDropZone.onclick = function () {
      imgFileInp.click();
    };
    imgFileInp.onchange = function () {
      handleImagesSelect();
    };
  }
  function handleFileSelect(file) {
    var reader = new FileReader();
    reader.onload = function (evLoad) {
      var lines = evLoad.target.result
        .split("\n")
        .filter(function (line) {
          return line.trim() && !line.startsWith("#");
        });
      importedCustomers = lines;
      getEl("s-finfo").style.display = "";
      getEl("s-finfo").innerHTML =
        "Đã tải <strong>" +
        VaesaUtils.formatNumber(lines.length) +
        "</strong> khách hàng từ <strong>" +
        file.name +
        "</strong>";
      var pageSelect = getEl("s-page");
      if (appState.pages.length) {
        populatePageSelect(pageSelect);
      } else {
        pageSelect.innerHTML = "<option>Đang tải Fanpage...</option>";
        VaesaAPI.getPageList(null, function (res) {
          if (res.success) {
            appState.pages = res.pages;
            populatePageSelect(pageSelect);
          }
        });
      }
      getEl("s-go").onclick = startSending;
    };
    reader.readAsText(file);
  }
  function handleImagesSelect() {
    var fileInpUpload = getEl("s-att");
    var thumbsContainer = getEl("s-img-thumbs");
    var modeContainer = getEl("s-img-mode");
    thumbsContainer.innerHTML = "";
    if (!fileInpUpload.files || fileInpUpload.files.length === 0) {
      modeContainer.style.display = "none";
      return;
    }
    var filesArr = Array.from(fileInpUpload.files);
    filesArr.forEach(function (imgFile, idx) {
      var thumbDiv = document.createElement("div");
      thumbDiv.className = "img-thumb";
      var imgEl = document.createElement("img");
      imgEl.src = URL.createObjectURL(imgFile);
      imgEl.onload = function () {
        URL.revokeObjectURL(imgEl.src);
      };
      var nameEl = document.createElement("span");
      nameEl.className = "img-thumb-name";
      nameEl.textContent =
        imgFile.name.length > 12
          ? imgFile.name.substring(0, 10) + "..."
          : imgFile.name;
      var sizeEl = document.createElement("span");
      sizeEl.className = "img-thumb-size";
      sizeEl.textContent = (imgFile.size / 1024).toFixed(0) + " KB";
      var delBtn = document.createElement("button");
      delBtn.className = "img-thumb-remove";
      delBtn.textContent = "✕";
      delBtn.title = "Xoá ảnh này";
      delBtn.onclick = function (evClick) {
        evClick.stopPropagation();
        var dt = new DataTransfer();
        var currentFiles = Array.from(fileInpUpload.files);
        currentFiles.splice(idx, 1);
        currentFiles.forEach(function (f) {
          dt.items.add(f);
        });
        fileInpUpload.files = dt.files;
        handleImagesSelect();
      };
      thumbDiv.appendChild(imgEl);
      thumbDiv.appendChild(delBtn);
      thumbDiv.appendChild(nameEl);
      thumbDiv.appendChild(sizeEl);
      thumbsContainer.appendChild(thumbDiv);
    });
    modeContainer.style.display = filesArr.length >= 2 ? "" : "none";
  }
  function getImgMode() {
    var radios = document.querySelectorAll('input[name="img-mode"]');
    for (var i = 0; i < radios.length; i++) {
      if (radios[i].checked) {
        return radios[i].value;
      }
    }
    return "all";
  }
  function populatePageSelect(selectEl) {
    selectEl.innerHTML = appState.pages
      .map(function (pageObj) {
        return (
          '<option value="' +
          pageObj.id +
          '">' +
          escapeHtml(pageObj.name) +
          "</option>"
        );
      })
      .join("");
  }
  function startSending() {
    console.log("[Vaesa] startSending called, customers:", importedCustomers.length);
    if (!importedCustomers.length) {
      alert("Chưa có danh sách khách hàng. Hãy chọn danh sách đã quét hoặc tải file .txt");
      return;
    }
    var pageId = getEl("s-page").value;
    console.log("[Vaesa] pageId:", pageId, "s-page options:", getEl("s-page").options.length);
    var messageText = getEl("s-msg").value.trim();
    console.log("[Vaesa] messageText:", messageText);
    if (!messageText) {
      alert("Vui lòng nhập nội dung tin nhắn");
      return;
    }
    var msgFileInput = getEl("s-att");
    var msgFiles = msgFileInput.files.length ? msgFileInput.files : null;
    var imgMode =
      msgFiles && msgFileInput.files.length >= 2 ? getImgMode() : "all";
    getEl("s-go").style.display = "none";
    getEl("s-sending").style.display = "";
    getEl("s-report").style.display = "none";
    var logContainer = getEl("s-log");
    logContainer.innerHTML = "";

    // Đảm bảo fbConfig đã load trước khi gửi
    function doStartSend() {
    VaesaSender.start(
      importedCustomers,
      messageText,
      msgFiles,
      {
        pageId: pageId,
        imageMode: imgMode,
        fromTime: parseInt(getEl("s-ft").value) || 3,
        toTime: parseInt(getEl("s-tt").value) || 10,
        sendingOrder: getEl("s-ord").value,
        restAfterMessages: parseInt(getEl("s-ra").value) || 20,
        restDuration: parseInt(getEl("s-rd").value) || 30,
        limit: parseInt(getEl("s-lim").value) || 0,
        pancakeTagConfig: (function () {
          if (!tagSelections || !appState.sel) return null;
          var addIds = (tagSelections.add || []).map(function (t) { return t.id; });
          var removeIds = (tagSelections.untag || []).map(function (t) { return t.id; });
          if (addIds.length === 0 && removeIds.length === 0) return null;
          var token = appState.pancakeToken || "";
          if (!token) {
            var tokenEl = document.getElementById("p-pancake-token");
            if (tokenEl) token = tokenEl.value.trim();
          }
          if (!token) return null;
          return {
            pageId: appState.sel.id,
            accessToken: token,
            addTagIds: addIds,
            removeTagIds: removeIds
          };
        })(),
      },
      {
        onProgress: function (currentMsg, totalMsg) {
          var msgPercent =
            totalMsg > 0 ? Math.round((currentMsg / totalMsg) * 100) : 0;
          getEl("s-fill").style.width = msgPercent + "%";
          getEl("ss-s").textContent = currentMsg + "/" + totalMsg;
          getEl("ss-s-pct").textContent = msgPercent + "%";
          var okCount = VaesaSender.successList.length;
          var errCount = VaesaSender.failureList.length;
          getEl("ss-ok").textContent = okCount;
          getEl("ss-err").textContent = errCount;
          var totalProcessed = okCount + errCount;
          getEl("ss-ok-pct").textContent =
            totalProcessed > 0
              ? Math.round((okCount / totalProcessed) * 100) + "%"
              : "";
          getEl("ss-err-pct").textContent =
            totalProcessed > 0
              ? Math.round((errCount / totalProcessed) * 100) + "%"
              : "";
        },
        onLog: function (logType, logMsg) {
          var timeStr = VaesaUtils.formatDateTime(new Date());
          var logClass =
            logType === "success"
              ? "log-ok"
              : logType === "error"
                ? "log-err"
                : logType === "skip"
                  ? "log-skip"
                  : "log-info";
          logContainer.innerHTML =
            '<div class="log-line ' +
            logClass +
            '">[' +
            timeStr +
            "] " +
            logMsg +
            "</div>" +
            logContainer.innerHTML;
          if (logContainer.children.length > 150) {
            logContainer.removeChild(logContainer.lastChild);
          }
        },
        onFinish: function (report) {
          getEl("s-sending").style.display = "none";
          getEl("s-report").style.display = "";
          var totalReport =
            report.success + report.failure + (report.unsent || 0);
          var okPct =
            totalReport > 0
              ? Math.round((report.success / totalReport) * 100)
              : 0;
          var errPct =
            totalReport > 0
              ? Math.round((report.failure / totalReport) * 100)
              : 0;
          var unsentPct =
            totalReport > 0
              ? Math.round(((report.unsent || 0) / totalReport) * 100)
              : 0;
          getEl("s-rpt").innerHTML =
            '<div class="stat-row"><div class="stat"><span class="stat-num c-green">' +
            report.success +
            '</span><span class="stat-pct c-green">' +
            okPct +
            '%</span><span class="stat-label">Thành công</span></div><div class="stat"><span class="stat-num c-red">' +
            report.failure +
            '</span><span class="stat-pct c-red">' +
            errPct +
            '%</span><span class="stat-label">Thất bại</span></div><div class="stat"><span class="stat-num c-amber">' +
            (report.unsent || 0) +
            '</span><span class="stat-pct c-amber">' +
            unsentPct +
            '%</span><span class="stat-label">Chưa gửi</span></div></div><div class="hint" style="margin-top:10px">⏱ Thời gian: ' +
            VaesaUtils.formatDuration(report.duration) +
            " · Tổng: " +
            totalReport +
            "</div>";
          getEl("s-ea").onclick = function () {
            VaesaSender.exportAllReports(report);
          };
          getEl("s-es").onclick = function () {
            VaesaSender.exportSuccess(report);
          };
          getEl("s-ef").onclick = function () {
            VaesaSender.exportFailure(report);
          };
          getEl("s-eu").onclick = function () {
            VaesaSender.exportUnsent(report);
          };
          [
            ["s-es", report.successList],
            ["s-ef", report.failureList],
            ["s-eu", report.unsentList],
          ].forEach(function (reportItem) {
            if (!reportItem[1] || !reportItem[1].length) {
              var reportBtn = getEl(reportItem[0]);
              reportBtn.disabled = true;
              reportBtn.style.opacity = ".35";
              reportBtn.style.cursor = "not-allowed";
            }
          });
          // Hiện lại nút gửi
          getEl("s-go").style.display = "";
        },
      },
    );
    var isPaused = false;
    getEl("s-pause").onclick = function () {
      isPaused = !isPaused;
      getEl("s-pause").innerHTML = isPaused
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> Tiếp tục'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Tạm dừng';
      if (isPaused) {
        VaesaSender.pause();
      } else {
        VaesaSender.resume();
      }
    };
    getEl("s-stop").onclick = function () {
      if (confirm("Bạn có chắc muốn dừng chiến dịch?")) {
        VaesaSender.stop();
      }
    };
    } // end doStartSend

    // Load fbConfig nếu chưa có
    if (!VaesaAPI.fbConfig || !VaesaAPI.fbConfig.fb_dtsg) {
      console.log("[Vaesa] fbConfig missing, loading...");
      VaesaAPI.loadFbConfig(function (ok) {
        console.log("[Vaesa] fbConfig loaded:", ok, "fb_dtsg:", VaesaAPI.fbConfig.fb_dtsg ? "YES" : "NO");
        if (ok) {
          doStartSend();
        } else {
          alert("Không thể tải cấu hình Facebook. Vui lòng F5 reload trang Facebook rồi thử lại.");
          getEl("s-go").style.display = "";
          getEl("s-sending").style.display = "none";
        }
      });
    } else {
      doStartSend();
    }
  }
  // ==================== TAB: MẪU TIN NHẮN ====================
  function renderTemplateTab() {
    templatesContainer.innerHTML =
      '<div class="card">' +
      '  <div class="card-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> Mẫu tin nhắn</div>' +
      '  <p class="card-desc">Lưu sẵn nội dung + ảnh để dùng lại khi gửi tin.</p>' +
      '  <div id="tmpl-list"></div>' +
      '  <button class="btn btn-primary" id="tmpl-new" style="width:100%;margin-top:10px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Tạo mẫu mới</button>' +
      '  <div id="tmpl-form" style="display:none;margin-top:12px">' +
      '    <label class="label">Tên mẫu</label>' +
      '    <input class="input" id="tmpl-name" placeholder="VD: Chào khách mới">' +
      '    <label class="label" style="margin-top:8px">Nội dung tin nhắn</label>' +
      '    <textarea class="textarea" id="tmpl-msg" rows="4" placeholder="Chào [name], mình muốn gửi bạn thông tin..."></textarea>' +
      '    <div class="hint"><code>[name]</code> = tên khách hàng · <code>{a|b|c}</code> = chọn ngẫu nhiên 1 trong 3</div>' +
      '    <label class="label" style="margin-top:8px">Đính kèm ảnh</label>' +
      '    <div class="img-picker"><div class="img-drop" id="tmpl-img-drop"><input type="file" id="tmpl-att" accept="image/*" multiple style="display:none"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> <span>Chọn ảnh</span></div><div class="img-thumbs" id="tmpl-img-thumbs"></div></div>' +
      '    <label class="label" style="margin-top:8px">Chế độ gửi ảnh</label>' +
      '    <div style="display:flex;gap:12px"><label><input type="radio" name="tmpl-img-mode" value="all" checked> Gửi tất cả</label><label><input type="radio" name="tmpl-img-mode" value="random"> Random 1 ảnh</label></div>' +
      '    <div style="display:flex;gap:8px;margin-top:12px"><button class="btn btn-primary" id="tmpl-save" style="flex:1">Lưu mẫu</button><button class="btn btn-outline" id="tmpl-cancel" style="flex:1">Huỷ</button></div>' +
      '  </div>' +
      '</div>';

    var editingId = null;
    var tmplFiles = [];

    function refreshList() {
      TemplateDB.getAll(function (err, templates) {
        var listEl = getEl("tmpl-list");
        if (!templates || templates.length === 0) {
          listEl.innerHTML = '<p style="text-align:center;color:#999;padding:16px 0">Chưa có mẫu nào.</p>';
          return;
        }
        listEl.innerHTML = templates.map(function (t) {
          var preview = (t.message || "").substring(0, 60);
          if ((t.message || "").length > 60) preview += "...";
          var imgCount = (t.images || []).length;
          return '<div class="tmpl-item" data-id="' + t.id + '">' +
            '<div class="tmpl-item-info">' +
            '<strong>' + escapeHtml(t.name || "Không tên") + '</strong>' +
            '<span class="tmpl-preview">' + escapeHtml(preview) + '</span>' +
            (imgCount > 0 ? '<span class="tmpl-badge">' + imgCount + ' ảnh</span>' : '') +
            '</div>' +
            '<div class="tmpl-item-actions">' +
            '<button class="btn-icon tmpl-edit" data-id="' + t.id + '" title="Sửa"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>' +
            '<button class="btn-icon tmpl-del" data-id="' + t.id + '" title="Xoá"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>' +
            '</div></div>';
        }).join("");

        listEl.querySelectorAll(".tmpl-edit").forEach(function (btn) {
          btn.onclick = function () { loadTemplateForEdit(btn.dataset.id); };
        });
        listEl.querySelectorAll(".tmpl-del").forEach(function (btn) {
          btn.onclick = function () {
            if (confirm("Xoá mẫu này?")) {
              TemplateDB.delete(btn.dataset.id, function () { refreshList(); });
            }
          };
        });
      });
    }

    function showForm(template) {
      getEl("tmpl-form").style.display = "";
      getEl("tmpl-new").style.display = "none";
      getEl("tmpl-name").value = template ? template.name || "" : "";
      getEl("tmpl-msg").value = template ? template.message || "" : "";
      getEl("tmpl-img-thumbs").innerHTML = "";
      tmplFiles = [];
      editingId = template ? template.id : null;

      // Set image mode
      var modeRadios = document.querySelectorAll('input[name="tmpl-img-mode"]');
      modeRadios.forEach(function (r) { r.checked = r.value === ((template && template.imageMode) || "all"); });

      // Show existing images from template
      if (template && template.images && template.images.length > 0) {
        template.images.forEach(function (img, idx) {
          tmplFiles.push(img);
          var blob = new Blob([img.data], { type: img.type });
          var url = URL.createObjectURL(blob);
          var thumb = document.createElement("div");
          thumb.className = "img-thumb";
          thumb.innerHTML = '<img src="' + url + '" onload="URL.revokeObjectURL(this.src)"><span class="img-name">' + escapeHtml((img.name || "").substring(0, 12)) + '</span><button class="img-remove" data-idx="' + idx + '">&times;</button>';
          getEl("tmpl-img-thumbs").appendChild(thumb);
        });
        bindThumbRemove();
      }
    }

    function hideForm() {
      getEl("tmpl-form").style.display = "none";
      getEl("tmpl-new").style.display = "";
      editingId = null;
      tmplFiles = [];
    }

    function bindThumbRemove() {
      getEl("tmpl-img-thumbs").querySelectorAll(".img-remove").forEach(function (btn) {
        btn.onclick = function () {
          var idx = parseInt(btn.dataset.idx);
          tmplFiles.splice(idx, 1);
          renderThumbs();
        };
      });
    }

    function renderThumbs() {
      var container = getEl("tmpl-img-thumbs");
      container.innerHTML = "";
      tmplFiles.forEach(function (img, idx) {
        var blob = img instanceof File ? img : new Blob([img.data], { type: img.type });
        var url = URL.createObjectURL(blob);
        var thumb = document.createElement("div");
        thumb.className = "img-thumb";
        var name = (img.name || "").substring(0, 12);
        thumb.innerHTML = '<img src="' + url + '" onload="URL.revokeObjectURL(this.src)"><span class="img-name">' + escapeHtml(name) + '</span><button class="img-remove" data-idx="' + idx + '">&times;</button>';
        container.appendChild(thumb);
      });
      bindThumbRemove();
    }

    function loadTemplateForEdit(id) {
      TemplateDB.get(id, function (err, tmpl) {
        if (tmpl) showForm(tmpl);
      });
    }

    function saveTemplate() {
      var name = getEl("tmpl-name").value.trim();
      var message = getEl("tmpl-msg").value.trim();
      if (!name) { alert("Nhập tên mẫu"); return; }
      if (!message) { alert("Nhập nội dung tin nhắn"); return; }

      var modeRadios = document.querySelectorAll('input[name="tmpl-img-mode"]');
      var imageMode = "all";
      modeRadios.forEach(function (r) { if (r.checked) imageMode = r.value; });

      // Convert File objects to ArrayBuffer for IndexedDB storage
      var pending = tmplFiles.length;
      var images = [];
      if (pending === 0) {
        doSave([]);
        return;
      }
      tmplFiles.forEach(function (f) {
        if (f.data && !(f instanceof File)) {
          // Already stored format
          images.push({ name: f.name, type: f.type, data: f.data });
          pending--;
          if (pending === 0) doSave(images);
        } else {
          var reader = new FileReader();
          reader.onload = function () {
            images.push({ name: f.name, type: f.type, data: reader.result });
            pending--;
            if (pending === 0) doSave(images);
          };
          reader.readAsArrayBuffer(f);
        }
      });

      function doSave(imgs) {
        var tmpl = {
          name: name,
          message: message,
          images: imgs,
          imageMode: imageMode
        };
        if (editingId) tmpl.id = editingId;
        TemplateDB.save(tmpl, function (err) {
          if (err) { alert("Lỗi lưu: " + err); return; }
          hideForm();
          refreshList();
        });
      }
    }

    // Image file input
    var imgDrop = getEl("tmpl-img-drop");
    var imgInput = getEl("tmpl-att");
    imgDrop.onclick = function () { imgInput.click(); };
    imgInput.onchange = function () {
      for (var i = 0; i < imgInput.files.length; i++) {
        tmplFiles.push(imgInput.files[i]);
      }
      renderThumbs();
      imgInput.value = "";
    };

    getEl("tmpl-new").onclick = function () { showForm(null); };
    getEl("tmpl-cancel").onclick = hideForm;
    getEl("tmpl-save").onclick = saveTemplate;

    window._refreshTemplateList = refreshList;
    refreshList();
  }

  // ==================== DROPDOWN MẪU TRONG TAB GỬI TIN ====================
  function loadTemplateDropdownInSendTab() {
    TemplateDB.getAll(function (err, templates) {
      var sel = getEl("s-tmpl-select");
      if (!sel) return;
      var html = '<option value="">-- Chọn mẫu --</option>';
      (templates || []).forEach(function (t) {
        var imgCount = (t.images || []).length;
        html += '<option value="' + t.id + '">' + escapeHtml(t.name) + (imgCount > 0 ? " (" + imgCount + " ảnh)" : "") + '</option>';
      });
      sel.innerHTML = html;
    });
  }

  function applyTemplateToSendTab(templateId) {
    if (!templateId) return;
    TemplateDB.get(templateId, function (err, tmpl) {
      if (!tmpl) return;
      var msgEl = getEl("s-msg");
      if (msgEl) msgEl.value = tmpl.message || "";

      // Load images from template into file input
      if (tmpl.images && tmpl.images.length > 0) {
        var dt = new DataTransfer();
        tmpl.images.forEach(function (img) {
          var blob = new Blob([img.data], { type: img.type });
          var file = new File([blob], img.name || "image.jpg", { type: img.type });
          dt.items.add(file);
        });
        var fileInput = getEl("s-att");
        if (fileInput) {
          fileInput.files = dt.files;
          // Trigger change event to update thumbnails
          var evt = new Event("change", { bubbles: true });
          fileInput.dispatchEvent(evt);
        }

        // Set image mode
        var modeRadios = document.querySelectorAll('input[name="img-mode"]');
        modeRadios.forEach(function (r) { r.checked = r.value === (tmpl.imageMode || "all"); });
        var modeContainer = getEl("s-img-mode");
        if (modeContainer && tmpl.images.length >= 2) modeContainer.style.display = "";
      }
    });
  }

  switchTab("scan");
})();
