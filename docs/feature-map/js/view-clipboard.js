/* ════════════════════════════════════════════════════════════
   view-clipboard.js — 个人剪贴板 tab
   API: https://clip.yiiling.cn  (独立服务，port 3002)
   ──────────────────────────────────────────────────────────── */

const ViewClipboard = (() => {
  const API  = 'https://clip.yiiling.cn';
  let PASS   = localStorage.getItem('clip_pass') || '';
  let items  = [];
  let dragging = null;

  // ── API helpers ────────────────────────────────────────────
  function headers(extra = {}) {
    return { 'X-Clip-Pass': PASS, ...extra };
  }

  async function apiFetch(path, opts = {}) {
    const res = await fetch(API + path, {
      ...opts,
      headers: { ...headers(), ...(opts.headers || {}) }
    });
    if (res.status === 401) { showAuth(); return null; }
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  // ── Render entry ───────────────────────────────────────────
  function render() {
    const el = document.getElementById('view-clipboard');
    el.innerHTML = `
      <div id="clip-root">
        <div id="clip-auth" class="clip-auth-wrap" style="display:none">
          <div class="clip-auth-box">
            <div class="clip-auth-title">🔒 剪贴板</div>
            <input id="clip-pass-input" type="password" placeholder="访问密码" autocomplete="current-password">
            <button id="clip-pass-btn">进入</button>
          </div>
        </div>
        <div id="clip-main" style="display:none">
          <div id="clip-toolbar">
            <div id="clip-compose">
              <textarea id="clip-text-input" placeholder="输入文字，Ctrl+Enter 发送…" rows="2"></textarea>
              <div id="clip-compose-actions">
                <label id="clip-file-label" class="clip-btn clip-btn-ghost" title="上传图片或文件">
                  📎 上传
                  <input type="file" id="clip-file-input" style="display:none" multiple>
                </label>
                <button id="clip-send-btn" class="clip-btn clip-btn-primary">发送</button>
              </div>
            </div>
            <div id="clip-toolbar-right">
              <button id="clip-clear-btn" class="clip-btn clip-btn-ghost" title="清空未钉选条目">🗑 清空</button>
              <button id="clip-lock-btn" class="clip-btn clip-btn-ghost" title="锁定（退出）">🔒</button>
            </div>
          </div>
          <div id="clip-list"></div>
        </div>
      </div>
    `;

    bindAuth();
    if (PASS) loadAndShow();
    else showAuth();
  }

  // ── Auth ───────────────────────────────────────────────────
  function showAuth() {
    document.getElementById('clip-main').style.display = 'none';
    document.getElementById('clip-auth').style.display = 'flex';
    setTimeout(() => document.getElementById('clip-pass-input')?.focus(), 50);
  }

  function bindAuth() {
    const btn   = document.getElementById('clip-pass-btn');
    const input = document.getElementById('clip-pass-input');
    const go = async () => {
      PASS = input.value.trim();
      localStorage.setItem('clip_pass', PASS);
      const data = await apiFetch('/clips');
      if (data) showMain(data);
    };
    btn.addEventListener('click', go);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  }

  function showMain(data) {
    document.getElementById('clip-auth').style.display = 'none';
    document.getElementById('clip-main').style.display = 'flex';
    items = data;
    renderList();
    bindCompose();
    bindToolbar();
  }

  async function loadAndShow() {
    const data = await apiFetch('/clips');
    if (data) showMain(data);
  }

  // ── Compose ────────────────────────────────────────────────
  function bindCompose() {
    const sendBtn  = document.getElementById('clip-send-btn');
    const textarea = document.getElementById('clip-text-input');
    const fileInput = document.getElementById('clip-file-input');

    sendBtn.addEventListener('click', sendText);
    textarea.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') sendText();
    });
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) uploadFiles(fileInput.files);
    });

    // Paste image from clipboard
    document.getElementById('clip-main').addEventListener('paste', e => {
      const items = Array.from(e.clipboardData?.items || []);
      const imageItem = items.find(i => i.type.startsWith('image/'));
      if (imageItem) {
        e.preventDefault();
        const file = imageItem.getAsFile();
        if (file) uploadFiles([file]);
      }
    });

    // Drag & drop onto list area
    const list = document.getElementById('clip-list');
    list.addEventListener('dragover', e => { e.preventDefault(); list.classList.add('clip-drag-over'); });
    list.addEventListener('dragleave', () => list.classList.remove('clip-drag-over'));
    list.addEventListener('drop', e => {
      e.preventDefault();
      list.classList.remove('clip-drag-over');
      if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
    });
  }

  async function sendText() {
    const ta = document.getElementById('clip-text-input');
    const content = ta.value.trim();
    if (!content) return;
    ta.value = '';
    ta.style.height = '';
    const item = await apiFetch('/clips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    if (item) { items.unshift(item); renderList(); }
  }

  async function uploadFiles(files) {
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${API}/clips/upload`, {
        method: 'POST',
        headers: { 'X-Clip-Pass': PASS },
        body: fd
      });
      if (res.status === 401) { showAuth(); return; }
      if (res.ok) {
        const item = await res.json();
        items.unshift(item);
        renderList();
      }
    }
  }

  // ── Toolbar ────────────────────────────────────────────────
  function bindToolbar() {
    document.getElementById('clip-clear-btn').addEventListener('click', async () => {
      if (!confirm('清空所有未钉选的条目？')) return;
      const r = await apiFetch('/clips', { method: 'DELETE' });
      if (r) { items = items.filter(i => i.pinned); renderList(); }
    });
    document.getElementById('clip-lock-btn').addEventListener('click', () => {
      PASS = '';
      localStorage.removeItem('clip_pass');
      showAuth();
    });
  }

  // ── List render ────────────────────────────────────────────
  function renderList() {
    const list = document.getElementById('clip-list');
    if (!items.length) {
      list.innerHTML = `<div class="clip-empty">暂无内容 — 粘贴文字、上传文件或拖拽图片到这里</div>`;
      return;
    }

    list.innerHTML = items.map(item => `
      <div class="clip-item ${item.pinned ? 'clip-pinned' : ''}" data-id="${item.id}">
        <div class="clip-item-body">
          ${renderItemBody(item)}
        </div>
        <div class="clip-item-meta">
          <span class="clip-item-time">${fmtTime(item.created_at)}</span>
          ${item.note ? `<span class="clip-item-note">${esc(item.note)}</span>` : ''}
        </div>
        <div class="clip-item-actions">
          <button class="clip-act" data-action="copy"  data-id="${item.id}" title="复制">⎘</button>
          <button class="clip-act ${item.pinned ? 'active' : ''}" data-action="pin" data-id="${item.id}" title="${item.pinned ? '取消钉选' : '钉选'}">📌</button>
          <button class="clip-act" data-action="del"  data-id="${item.id}" title="删除">✕</button>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.clip-act').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        handleAction(btn.dataset.action, +btn.dataset.id);
      });
    });

    // Click text to copy
    list.querySelectorAll('.clip-item-body').forEach(el => {
      el.addEventListener('click', () => {
        const id = +el.closest('.clip-item').dataset.id;
        handleAction('copy', id);
      });
    });
  }

  function renderItemBody(item) {
    if (item.type === 'text') {
      const lines = esc(item.content).split('\n');
      const preview = lines.slice(0, 6).join('\n');
      const more = lines.length > 6 ? `<span class="clip-more">…还有 ${lines.length - 6} 行</span>` : '';
      return `<pre class="clip-text">${preview}</pre>${more}`;
    }
    if (item.type === 'image') {
      return `
        <div class="clip-img-wrap">
          <img src="${API}/uploads/${item.content}?pass=${PASS}" class="clip-img" loading="lazy"
               alt="${esc(item.filename || '')}"
               onclick="window.open('${API}/uploads/${item.content}?pass=${PASS}','_blank')">
        </div>
        <div class="clip-filename">${esc(item.filename || '')} · ${fmtSize(item.size)}</div>
      `;
    }
    // file
    return `
      <div class="clip-file-row">
        <span class="clip-file-icon">${fileIcon(item.mime)}</span>
        <div class="clip-file-info">
          <a class="clip-file-name" href="${API}/uploads/${item.content}?pass=${PASS}" target="_blank" download="${esc(item.filename || item.content)}">
            ${esc(item.filename || item.content)}
          </a>
          <span class="clip-file-size">${fmtSize(item.size)}</span>
        </div>
      </div>
    `;
  }

  async function handleAction(action, id) {
    const item = items.find(i => i.id === id);
    if (!item) return;

    if (action === 'copy') {
      if (item.type === 'text') {
        await navigator.clipboard.writeText(item.content).catch(() => {});
        flashItem(id, '✓ 已复制');
      } else {
        await navigator.clipboard.writeText(`${API}/uploads/${item.content}?pass=${PASS}`).catch(() => {});
        flashItem(id, '✓ 链接已复制');
      }
    }

    if (action === 'pin') {
      const updated = await apiFetch(`/clips/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: !item.pinned })
      });
      if (updated) {
        const idx = items.findIndex(i => i.id === id);
        items[idx] = updated;
        // re-sort: pinned first
        items.sort((a, b) => (b.pinned - a.pinned) || (new Date(b.created_at) - new Date(a.created_at)));
        renderList();
      }
    }

    if (action === 'del') {
      const r = await apiFetch(`/clips/${id}`, { method: 'DELETE' });
      if (r) { items = items.filter(i => i.id !== id); renderList(); }
    }
  }

  function flashItem(id, msg) {
    const el = document.querySelector(`.clip-item[data-id="${id}"] .clip-item-meta`);
    if (!el) return;
    const orig = el.innerHTML;
    el.innerHTML = `<span style="color:var(--done)">${msg}</span>`;
    setTimeout(() => { if (el) el.innerHTML = orig; }, 1500);
  }

  // ── Helpers ────────────────────────────────────────────────
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff/60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff/3600)} 小时前`;
    return d.toLocaleDateString('zh-CN', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
  }

  function fmtSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024*1024) return `${(bytes/1024).toFixed(1)} KB`;
    return `${(bytes/1024/1024).toFixed(1)} MB`;
  }

  function fileIcon(mime = '') {
    if (mime.startsWith('image/')) return '🖼';
    if (mime.startsWith('video/')) return '🎬';
    if (mime.startsWith('audio/')) return '🎵';
    if (mime.includes('pdf')) return '📄';
    if (mime.includes('zip') || mime.includes('tar') || mime.includes('gz')) return '🗜';
    if (mime.includes('word') || mime.includes('document')) return '📝';
    if (mime.includes('sheet') || mime.includes('excel')) return '📊';
    return '📁';
  }

  return { render };
})();
