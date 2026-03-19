(function() {
  var existing = document.getElementById("vaesa-panel-frame");
  if (existing) {
    existing.remove();
    return;
  }
  var iframe = document.createElement("iframe");
  iframe.id = "vaesa-panel-frame";
  iframe.src = chrome.runtime.getURL("auto-inbox/sidepanel.html");
  iframe.style.cssText = "position:fixed;top:0;right:0;width:400px;height:100vh;border:none;z-index:2147483647;box-shadow:-2px 0 12px rgba(0,0,0,0.15);background:#fff;";
  iframe.allow = "clipboard-write";
  document.body.appendChild(iframe);

  // Lắng nghe message đóng panel từ iframe
  window.addEventListener("message", function(e) {
    if (e.data && e.data.action === "VAESA_CLOSE_PANEL") {
      var panel = document.getElementById("vaesa-panel-frame");
      if (panel) panel.remove();
    }
  });
})();
