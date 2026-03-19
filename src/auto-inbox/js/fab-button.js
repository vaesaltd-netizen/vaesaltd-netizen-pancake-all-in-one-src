// Auto Inbox - Floating Action Button on Facebook
(function () {
  if (document.getElementById('vaesa-inbox-fab')) return;

  var fab = document.createElement('div');
  fab.id = 'vaesa-inbox-fab';
  fab.title = 'Vaesa Auto Inbox';
  fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg>';
  fab.style.cssText = 'position:fixed;bottom:24px;right:24px;width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#0061ff,#00c2ff);display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2147483646;box-shadow:0 4px 16px rgba(0,97,255,0.4);transition:transform .2s,box-shadow .2s;';

  fab.addEventListener('mouseenter', function () {
    fab.style.transform = 'scale(1.1)';
    fab.style.boxShadow = '0 6px 24px rgba(0,97,255,0.55)';
  });
  fab.addEventListener('mouseleave', function () {
    fab.style.transform = 'scale(1)';
    fab.style.boxShadow = '0 4px 16px rgba(0,97,255,0.4)';
  });

  fab.addEventListener('click', function () {
    // Toggle panel: if exists, remove; if not, inject
    var existing = document.getElementById('vaesa-panel-frame');
    if (existing) {
      existing.remove();
    } else {
      var iframe = document.createElement('iframe');
      iframe.id = 'vaesa-panel-frame';
      iframe.src = chrome.runtime.getURL('auto-inbox/sidepanel.html');
      iframe.style.cssText = 'position:fixed;top:0;right:0;width:400px;height:100vh;border:none;z-index:2147483647;box-shadow:-2px 0 12px rgba(0,0,0,0.15);background:#fff;';
      iframe.allow = 'clipboard-write';
      document.body.appendChild(iframe);
    }
  });

  document.body.appendChild(fab);

  // Listen for close panel message from iframe
  window.addEventListener('message', function (e) {
    if (e.data && e.data.action === 'VAESA_CLOSE_PANEL') {
      var panel = document.getElementById('vaesa-panel-frame');
      if (panel) panel.remove();
    }
  });
})();
