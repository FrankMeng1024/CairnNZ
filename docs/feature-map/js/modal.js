/* ════════════════════════════════════════════════════════════
   modal.js — Modal/dialog system + Toast + Context menu
   ──────────────────────────────────────────────────────────── */

const Modal = (() => {
  let activeBackdrop = null;
  let escHandler = null;
  let onCloseHook = null;

  /**
   * Open modal.
   * @param {object} opts
   * @param {string} opts.icon       - emoji
   * @param {string} opts.title
   * @param {string} [opts.sub]
   * @param {string} opts.bodyHTML   - inner HTML for body
   * @param {Array}  opts.buttons    - [{label, variant, onClick(modalEl), close:true}]
   * @param {string} [opts.size]     - 'sm' | 'lg'
   * @param {(modalEl)=>void} [opts.onMount]
   * @param {()=>void} [opts.onClose] - called once when modal is dismissed by ANY means (X / ESC / backdrop / buttons)
   */
  function open(opts) {
    close(); // close any existing
    onCloseHook = opts.onClose || null;

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';

    const sizeClass = opts.size === 'lg' ? ' modal-lg' : opts.size === 'sm' ? ' modal-sm' : '';

    backdrop.innerHTML = `
      <div class="modal${sizeClass}" role="dialog" aria-modal="true">
        <div class="modal-head">
          ${opts.icon ? `<div class="modal-icon">${opts.icon}</div>` : ''}
          <div class="modal-title-block">
            <div class="modal-title">${escapeHTML(opts.title || '')}</div>
            ${opts.sub ? `<div class="modal-sub">${escapeHTML(opts.sub)}</div>` : ''}
          </div>
          <button class="modal-close" aria-label="关闭" data-modal-close>✕</button>
        </div>
        <div class="modal-body">${opts.bodyHTML || ''}</div>
        ${opts.buttons && opts.buttons.length ? `
          <div class="modal-foot">
            ${opts.footLeft ? `<div class="modal-foot-left">${opts.footLeft}</div>` : ''}
            ${opts.buttons.map((b, i) => `
              <button class="btn ${b.variant ? 'btn-' + b.variant : ''}" data-btn="${i}">${escapeHTML(b.label)}</button>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;

    document.body.appendChild(backdrop);
    activeBackdrop = backdrop;

    const modalEl = backdrop.querySelector('.modal');

    // close handlers
    backdrop.querySelector('[data-modal-close]').addEventListener('click', close);
    let _pointerDownInModal = false;
    backdrop.addEventListener('pointerdown', e => {
      _pointerDownInModal = !!e.target.closest('.modal');
    });
    backdrop.addEventListener('click', e => {
      if (e.target === backdrop && !_pointerDownInModal) close();
    });
    escHandler = e => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', escHandler);

    // buttons
    if (opts.buttons) {
      opts.buttons.forEach((b, i) => {
        const el = backdrop.querySelector(`[data-btn="${i}"]`);
        if (!el) return;
        el.addEventListener('click', () => {
          let result = true;
          if (b.onClick) result = b.onClick(modalEl);
          if (result !== false && b.close !== false) close();
        });
      });
    }

    // focus first input
    requestAnimationFrame(() => {
      const firstInput = backdrop.querySelector('input, textarea, select');
      if (firstInput) firstInput.focus();
    });

    if (opts.onMount) opts.onMount(modalEl);

    return modalEl;
  }

  function close() {
    if (activeBackdrop) {
      const b = activeBackdrop;
      b.style.animation = 'backdropIn .15s reverse';
      setTimeout(() => b.remove(), 140);
      activeBackdrop = null;
    }
    if (escHandler) {
      document.removeEventListener('keydown', escHandler);
      escHandler = null;
    }
    if (onCloseHook) {
      const fn = onCloseHook;
      onCloseHook = null;
      try { fn(); } catch (e) { console.error(e); }
    }
  }

  /**
   * Confirm dialog.
   * @returns {Promise<boolean>}
   */
  function confirm({ title, message, confirmLabel = '确定', cancelLabel = '取消', danger = false, icon = '⚠️' }) {
    return new Promise(resolve => {
      let settled = false;
      const finish = v => { if (!settled) { settled = true; resolve(v); } };
      open({
        size: 'sm',
        icon,
        title,
        bodyHTML: `<div style="font-size:13px;color:var(--text2);line-height:1.6">${escapeHTML(message)}</div>`,
        buttons: [
          { label: cancelLabel, onClick: () => finish(false) },
          { label: confirmLabel, variant: danger ? 'danger' : 'primary', onClick: () => finish(true) }
        ],
        onClose: () => finish(false)
      });
    });
  }

  /**
   * Prompt dialog (single text input).
   * @returns {Promise<string|null>}
   */
  function prompt({ title, label, placeholder = '', initial = '', icon = '✏️' }) {
    return new Promise(resolve => {
      let settled = false;
      const finish = v => { if (!settled) { settled = true; resolve(v); } };
      let modalRef;
      modalRef = open({
        size: 'sm',
        icon,
        title,
        bodyHTML: `
          <div class="form-row">
            ${label ? `<label class="form-label">${escapeHTML(label)}</label>` : ''}
            <input type="text" class="form-input" id="__prompt-input" placeholder="${escapeHTML(placeholder)}" value="${escapeHTML(initial)}">
          </div>
        `,
        buttons: [
          { label: '取消', onClick: () => finish(null) },
          { label: '确定', variant: 'primary', onClick: el => {
              const v = el.querySelector('#__prompt-input').value.trim();
              finish(v || null);
          } }
        ],
        onClose: () => finish(null),
        onMount: el => {
          const input = el.querySelector('#__prompt-input');
          input.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
              const v = input.value.trim();
              finish(v || null);
              close();
            }
          });
        }
      });
    });
  }

  return { open, close, confirm, prompt };
})();

/* ════════════════════════════════════════════════════════════
   Toast
   ──────────────────────────────────────────────────────────── */
const Toast = (() => {
  let stack = null;

  function ensureStack() {
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      document.body.appendChild(stack);
    }
    return stack;
  }

  function show(message, opts = {}) {
    const { type = 'info', icon, duration = 1800 } = opts;
    const s = ensureStack();
    // deduplicate: remove existing toast with same text before adding new one
    const existing = s.querySelector(`[data-toast-msg="${CSS.escape(message)}"]`);
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.dataset.toastMsg = message;
    const iconChar = icon || (type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ');
    el.innerHTML = `<span class="toast-icon">${iconChar}</span><span>${escapeHTML(message)}</span>`;
    s.appendChild(el);

    setTimeout(() => {
      el.classList.add('toast-out');
      setTimeout(() => el.remove(), 220);
    }, duration);
  }

  return {
    show,
    success: (m, o) => show(m, { ...o, type: 'success' }),
    error:   (m, o) => show(m, { ...o, type: 'error' }),
    info:    (m, o) => show(m, { ...o, type: 'info' })
  };
})();

/* ════════════════════════════════════════════════════════════
   Context Menu
   ──────────────────────────────────────────────────────────── */
const ContextMenu = (() => {
  let active = null;

  function close() {
    if (active) {
      active.remove();
      active = null;
    }
  }

  /**
   * @param {MouseEvent} e
   * @param {Array} items - [{label, icon, danger, onClick}] or {sep:true}
   */
  function show(e, items) {
    e.preventDefault();
    close();
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.innerHTML = items.map((it, i) => {
      if (it.sep) return `<div class="ctx-sep"></div>`;
      return `<div class="ctx-item ${it.danger ? 'danger' : ''}" data-i="${i}">${it.icon || ''}<span>${escapeHTML(it.label)}</span></div>`;
    }).join('');
    document.body.appendChild(menu);

    // position (clamp to viewport)
    const w = menu.offsetWidth, h = menu.offsetHeight;
    const x = Math.min(e.clientX, window.innerWidth  - w - 8);
    const y = Math.min(e.clientY, window.innerHeight - h - 8);
    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';

    items.forEach((it, i) => {
      if (it.sep) return;
      const el = menu.querySelector(`[data-i="${i}"]`);
      if (el) el.addEventListener('click', () => {
        if (it.onClick) it.onClick();
        close();
      });
    });

    active = menu;
    setTimeout(() => {
      document.addEventListener('click', close, { once: true });
      document.addEventListener('contextmenu', closeIfOutside, { once: true });
    }, 0);
  }

  function closeIfOutside(e) {
    if (active && !active.contains(e.target)) close();
  }

  return { show, close };
})();

/* ════════════════════════════════════════════════════════════
   Helpers
   ──────────────────────────────────────────────────────────── */
function escapeHTML(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

window.Modal = Modal;
window.Toast = Toast;
window.ContextMenu = ContextMenu;
window.escapeHTML = escapeHTML;
