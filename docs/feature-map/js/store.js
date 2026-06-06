/* ════════════════════════════════════════════════════════════
   store.js — in-memory state + file-backed persistence
   All edits POST to /save-data which writes back to data.js.
   localStorage is NOT used — data.js is the single source of truth.
   ──────────────────────────────────────────────────────────── */

const Store = (() => {
  let state = null;
  const listeners = new Set();

  let _saveTimer = null;

  function save() {
    // Debounce: batch rapid edits into one write
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(_flush, 300);
  }

  function _flush() {
    _saveTimer = null;
    fetch('/save-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state)
    }).catch(err => console.error('[Store] save failed:', err));
  }

  function init(defaults) {
    state = JSON.parse(JSON.stringify(defaults));
  }

  function get() { return state; }

  function notify() {
    listeners.forEach(fn => {
      try { fn(state); } catch (e) { console.error(e); }
    });
  }

  function update(fn, opts = {}) {
    fn(state);
    if (!opts.skipSave) save();
    if (!opts.silent) notify();
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function exportJSON() {
    return JSON.stringify(state, null, 2);
  }

  /* ─── id helpers ──────────────────────────── */
  function newId(prefix = 'id') {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  return {
    init, get, update, subscribe,
    exportJSON, newId
  };
})();

window.Store = Store;
