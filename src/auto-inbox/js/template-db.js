// template-db.js — IndexedDB helper for message templates
(function () {
  var DB_NAME = "vaesa_templates";
  var DB_VERSION = 1;
  var STORE_NAME = "templates";

  function openDB(callback) {
    var request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = function (e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = function (e) {
      callback(null, e.target.result);
    };
    request.onerror = function (e) {
      callback(e.target.error, null);
    };
  }

  window.TemplateDB = {
    getAll: function (callback) {
      openDB(function (err, db) {
        if (err) return callback(err, []);
        var tx = db.transaction(STORE_NAME, "readonly");
        var store = tx.objectStore(STORE_NAME);
        var request = store.getAll();
        request.onsuccess = function () {
          var templates = request.result || [];
          templates.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
          callback(null, templates);
        };
        request.onerror = function () { callback(request.error, []); };
      });
    },

    get: function (id, callback) {
      openDB(function (err, db) {
        if (err) return callback(err, null);
        var tx = db.transaction(STORE_NAME, "readonly");
        var store = tx.objectStore(STORE_NAME);
        var request = store.get(id);
        request.onsuccess = function () { callback(null, request.result || null); };
        request.onerror = function () { callback(request.error, null); };
      });
    },

    save: function (template, callback) {
      var now = Date.now();
      if (!template.id) template.id = now.toString(36) + Math.random().toString(36).substr(2, 4);
      if (!template.createdAt) template.createdAt = now;
      template.updatedAt = now;
      openDB(function (err, db) {
        if (err) return callback && callback(err);
        var tx = db.transaction(STORE_NAME, "readwrite");
        var store = tx.objectStore(STORE_NAME);
        store.put(template);
        tx.oncomplete = function () { callback && callback(null, template); };
        tx.onerror = function () { callback && callback(tx.error); };
      });
    },

    delete: function (id, callback) {
      openDB(function (err, db) {
        if (err) return callback && callback(err);
        var tx = db.transaction(STORE_NAME, "readwrite");
        var store = tx.objectStore(STORE_NAME);
        store.delete(id);
        tx.oncomplete = function () { callback && callback(null); };
        tx.onerror = function () { callback && callback(tx.error); };
      });
    }
  };
})();
