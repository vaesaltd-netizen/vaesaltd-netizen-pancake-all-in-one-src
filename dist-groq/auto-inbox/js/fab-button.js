// Auto Inbox - Floating Action Button on Facebook (draggable, with license check)
(function () {
  if (document.getElementById('vaesa-inbox-fab')) return;

  // Listen for license invalidation — remove fab + panel immediately
  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg.type === 'LICENSE_INVALID') {
      var existingFab = document.getElementById('vaesa-inbox-fab');
      var existingPanel = document.getElementById('vaesa-panel-frame');
      if (existingFab) existingFab.style.display = 'none';
      if (existingPanel) existingPanel.remove();
      console.log('[AutoInbox] License invalid — UI disabled');
    }
  });

  // Check license on startup — don't show fab if invalid
  chrome.storage.local.get('licenseValid', function (data) {
    if (data.licenseValid !== true) {
      console.log('[AutoInbox] No valid license — fab hidden');
      return; // Don't create fab
    }
    // License OK — show fab
    initFab();
  });

  function initFab() {

  var fab = document.createElement('div');
  fab.id = 'vaesa-inbox-fab';
  fab.title = 'Vaesa Auto Inbox';
  fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg>';
  fab.style.cssText = 'position:fixed;top:12px;right:20px;width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#22D3EE 0%,#0891B2 100%);display:flex;align-items:center;justify-content:center;cursor:grab;z-index:2147483646;box-shadow:0 4px 12px rgba(8,145,178,0.35);transition:box-shadow .2s;user-select:none;';

  // Drag state
  var isDragging = false;
  var hasDragged = false;
  var startX, startY, origX, origY;

  fab.addEventListener('mousedown', function (e) {
    isDragging = true;
    hasDragged = false;
    startX = e.clientX;
    startY = e.clientY;
    var rect = fab.getBoundingClientRect();
    origX = rect.left;
    origY = rect.top;
    fab.style.cursor = 'grabbing';
    fab.style.transition = 'box-shadow .2s';
    e.preventDefault();
  });

  document.addEventListener('mousemove', function (e) {
    if (!isDragging) return;
    var dx = e.clientX - startX;
    var dy = e.clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasDragged = true;
    fab.style.left = (origX + dx) + 'px';
    fab.style.top = (origY + dy) + 'px';
    fab.style.right = 'auto';
  });

  document.addEventListener('mouseup', function () {
    if (!isDragging) return;
    isDragging = false;
    fab.style.cursor = 'grab';
  });

  fab.addEventListener('click', function (e) {
    if (hasDragged) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // Toggle panel
    var existing = document.getElementById('vaesa-panel-frame');
    if (existing) {
      existing.remove();
      return;
    }

    // Check license before opening
    chrome.runtime.sendMessage({ action: 'CHECK_LICENSE' }, function (response) {
      if (chrome.runtime.lastError) {
        showLicenseToast('Khong the kiem tra license');
        return;
      }

      if (!response || !response.valid) {
        showLicenseToast('Can nhap License Key. Mo popup extension de nhap.');
        return;
      }

      // License OK - open panel
      var iframe = document.createElement('iframe');
      iframe.id = 'vaesa-panel-frame';
      iframe.src = chrome.runtime.getURL('auto-inbox/sidepanel.html');
      iframe.style.cssText = 'position:fixed;top:0;right:0;width:400px;height:100vh;border:none;z-index:2147483647;box-shadow:-2px 0 12px rgba(0,0,0,0.15);background:#fff;';
      iframe.allow = 'clipboard-write';
      document.body.appendChild(iframe);
    });
  });

  // Toast notification for license errors
  function showLicenseToast(msg) {
    var existing = document.getElementById('vaesa-license-toast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.id = 'vaesa-license-toast';
    toast.textContent = msg;
    toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#ef4444;color:#fff;padding:12px 24px;border-radius:8px;font-size:14px;z-index:2147483647;box-shadow:0 4px 12px rgba(0,0,0,0.2);animation:fadeIn .3s;';
    document.body.appendChild(toast);

    setTimeout(function () {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity .3s';
      setTimeout(function () { toast.remove(); }, 300);
    }, 3000);
  }

  fab.addEventListener('mouseenter', function () {
    if (!isDragging) fab.style.boxShadow = '0 6px 20px rgba(8,145,178,0.45)';
  });
  fab.addEventListener('mouseleave', function () {
    fab.style.boxShadow = '0 4px 12px rgba(8,145,178,0.35)';
  });

  document.body.appendChild(fab);

  // Listen for close panel message from iframe
  window.addEventListener('message', function (e) {
    if (e.data && e.data.action === 'VAESA_CLOSE_PANEL') {
      var panel = document.getElementById('vaesa-panel-frame');
      if (panel) panel.remove();
    }
  });
  } // end initFab()
})();
