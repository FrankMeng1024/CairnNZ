/* ════════════════════════════════════════════════════════════
   view-modules.js — Page 3: Module Grid
   ──────────────────────────────────────────────────────────── */

const ViewModules = (() => {

  const STATUS_LABELS = { done: '完成', wip: '进行中', planned: '计划中', p4: '第4阶段', blocked: '阻塞' };
  const BADGE_CLASS  = { done: 'fb-done', wip: 'fb-wip', planned: 'fb-plan', p4: 'fb-p4', blocked: 'fb-plan' };
  const BADGE_LABEL  = { done: '完成', wip: '进行中', planned: '计划中', p4: '第4阶段', blocked: '阻塞' };

  const ICON_BG_PALETTE = {
    indigo: 'rgba(99,102,241,.15)',
    green:  'rgba(34,197,94,.15)',
    red:    'rgba(239,68,68,.15)',
    purple: 'rgba(167,139,250,.15)',
    pink:   'rgba(244,114,182,.15)',
    orange: 'rgba(249,115,22,.15)',
    slate:  'rgba(100,116,139,.15)',
    teal:   'rgba(56,189,248,.15)',
    yellow: 'rgba(251,191,36,.15)'
  };

  const PROGRESS_COLOR_PALETTE = {
    done: 'var(--done)', wip: 'var(--wip)', plan: 'var(--plan)', p4: 'var(--p4)', block: 'var(--block)'
  };

  function calcAutoProgress(features) {
    if (!features || !features.length) return 0;
    const score = features.reduce((s, f) => s + (f.status === 'done' ? 1 : f.status === 'wip' ? 0.5 : 0), 0);
    return Math.round(score / features.length * 100);
  }

  function render() {
    const root = document.getElementById('view-modules');
    if (!root) return;
    const state = Store.get();
    const modules = [...state.modules].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const collapsed = state._uiCollapsed?.modules || {};

    root.innerHTML = `
      <div class="module-grid" id="mod-grid">
        ${modules.map(m => moduleCard(m, collapsed[m.id])).join('')}
        <button class="module-card" data-action="add-module"
          style="display:flex;align-items:center;justify-content:center;min-height:120px;border-style:dashed;background:transparent;color:var(--sub);font-size:13px;cursor:pointer">
          + 新增模块
        </button>
      </div>
    `;

    bindEvents(root);
    bindDrag(root);
  }

  function moduleCard(m, isCollapsed) {
    const progress = m.progress != null ? m.progress : calcAutoProgress(m.features);
    return `
      <div class="module-card ${isCollapsed ? 'collapsed' : ''}" id="${m.id}" data-id="${m.id}" data-kind="module">
        <div class="module-actions">
          <button class="card-icon-btn" data-action="edit-module" data-id="${m.id}" data-tip="编辑模块">✏️</button>
          <button class="card-icon-btn danger" data-action="delete-module" data-id="${m.id}" data-tip="删除模块">✕</button>
        </div>
        <div class="module-header" data-action="toggle-module" data-id="${m.id}">
          <div class="module-icon" style="background:${m.iconBg || 'rgba(99,102,241,.15)'}">${m.icon || '📦'}</div>
          <div class="module-title-block">
            <div class="module-title">${escapeHTML(m.title)}</div>
            <div class="module-meta">${escapeHTML(m.meta || '')}</div>
          </div>
          <div class="module-toggle">▾</div>
        </div>
        <div class="module-progress"><div class="module-progress-fill" style="width:${progress}%;background:${m.progressColor || 'var(--done)'}"></div></div>
        <div class="module-body" data-feat-list>
          ${m.features.map(f => featRow(f)).join('')}
          <button class="module-body-add" data-action="add-feature" data-module-id="${m.id}">+ 新增功能点</button>
        </div>
      </div>
    `;
  }

  function featRow(f) {
    const cls = BADGE_CLASS[f.status] || 'fb-plan';
    const lbl = BADGE_LABEL[f.status] || '计划中';
    return `
      <div class="feat-row" data-id="${f.id}" data-kind="feature">
        <span class="feat-text">${escapeHTML(f.title)}</span>
        <span class="feat-badge ${cls}">${lbl}</span>
        <div class="feat-actions">
          <button class="card-icon-btn" data-action="edit-feature" data-id="${f.id}" data-tip="编辑">✏️</button>
          <button class="card-icon-btn danger" data-action="delete-feature" data-id="${f.id}" data-tip="删除">✕</button>
        </div>
      </div>
    `;
  }

  function bindEvents(root) {
    root.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      const moduleId = btn.dataset.moduleId;

      // toggle: ignore if click was on action buttons inside header
      if (action === 'toggle-module') {
        if (e.target.closest('[data-action]:not([data-action="toggle-module"])')) return;
        toggleCollapse(id);
        return;
      }
      if (action === 'add-module')      return editModule(null);
      if (action === 'edit-module')     return editModule(id);
      if (action === 'delete-module')   return deleteModule(id);
      if (action === 'add-feature')     return editFeature(null, moduleId);
      if (action === 'edit-feature')    return editFeature(id);
      if (action === 'delete-feature')  return deleteFeature(id);
    });

    root.addEventListener('dblclick', e => {
      const feat = e.target.closest('.feat-row');
      const moduleEl = e.target.closest('.module-card[data-id]');
      if (feat) editFeature(feat.dataset.id);
      else if (moduleEl) editModule(moduleEl.dataset.id);
    });

    root.addEventListener('contextmenu', e => {
      const feat = e.target.closest('.feat-row');
      const moduleEl = e.target.closest('.module-card[data-id]');
      if (feat) {
        ContextMenu.show(e, [
          { label: '编辑', icon: '✏️', onClick: () => editFeature(feat.dataset.id) },
          { sep: true },
          { label: '删除', icon: '🗑', danger: true, onClick: () => deleteFeature(feat.dataset.id) }
        ]);
      } else if (moduleEl) {
        ContextMenu.show(e, [
          { label: '编辑模块', icon: '✏️', onClick: () => editModule(moduleEl.dataset.id) },
          { label: moduleEl.classList.contains('collapsed') ? '展开' : '折叠', icon: '▾', onClick: () => toggleCollapse(moduleEl.dataset.id) },
          { sep: true },
          { label: '删除模块', icon: '🗑', danger: true, onClick: () => deleteModule(moduleEl.dataset.id) }
        ]);
      }
    });
  }

  function bindDrag(root) {
    // Drag modules among themselves (whole card drag via header)
    DragDrop.bind({
      container: root,
      itemSelector: '.module-card[data-id]',
      containerSelector: '.module-grid',
      handleSelector: '.module-header',
      axis: 'y',
      onDrop: ({ itemId, toIndex }) => {
        Store.update(s => {
          const arr = [...s.modules].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
          const i = arr.findIndex(m => m.id === itemId);
          if (i < 0) return;
          const [m] = arr.splice(i, 1);
          arr.splice(toIndex, 0, m);
          arr.forEach((mm, idx) => mm.order = idx);
        });
        render();
      }
    });

    // Drag features inside a module body (and across modules)
    DragDrop.bind({
      container: root,
      itemSelector: '.feat-row',
      containerSelector: '.module-body',
      axis: 'y',
      onDrop: ({ itemId, toContainer, toIndex }) => {
        const targetModuleId = toContainer.closest('.module-card').dataset.id;
        Store.update(s => {
          let movingFeat = null;
          let fromMod = null;
          let origIdx = -1;
          for (const m of s.modules) {
            const idx = m.features.findIndex(f => f.id === itemId);
            if (idx > -1) {
              origIdx = idx;
              movingFeat = m.features.splice(idx, 1)[0];
              fromMod = m;
              break;
            }
          }
          if (!movingFeat) return;
          const target = s.modules.find(m => m.id === targetModuleId);
          if (!target) {
            // restore at original position
            if (fromMod) fromMod.features.splice(Math.max(0, origIdx), 0, movingFeat);
            return;
          }
          target.features.splice(Math.max(0, Math.min(toIndex, target.features.length)), 0, movingFeat);
        });
        render();
      }
    });
  }

  function toggleCollapse(id) {
    Store.update(s => {
      if (!s._uiCollapsed) s._uiCollapsed = { modules: {} };
      if (!s._uiCollapsed.modules) s._uiCollapsed.modules = {};
      s._uiCollapsed.modules[id] = !s._uiCollapsed.modules[id];
    });
    render();
  }

  /* ─── CRUD ─── */

  function editModule(id) {
    const isNew = !id;
    const state = Store.get();
    const m = isNew
      ? { id: Store.newId('mod'), icon: '📦', iconBg: ICON_BG_PALETTE.indigo, title: '', meta: '', progress: 0, progressColor: 'var(--plan)', features: [], order: state.modules.length }
      : { ...state.modules.find(x => x.id === id) };
    if (!m) return;

    Modal.open({
      icon: m.icon || '📦', title: isNew ? '新增模块' : '编辑模块', size: 'lg',
      bodyHTML: `
        <div class="form-row form-row-2col">
          <div>
            <label class="form-label">图标</label>
            <input class="form-input" id="f-icon" maxlength="4" value="${escapeHTML(m.icon)}">
          </div>
          <div>
            <label class="form-label">图标底色</label>
            <select class="form-select" id="f-iconBg">
              ${Object.entries(ICON_BG_PALETTE).map(([k, v]) => `<option value="${v}" ${m.iconBg === v ? 'selected' : ''}>${k}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <label class="form-label">模块名</label>
          <input class="form-input" id="f-title" value="${escapeHTML(m.title)}" placeholder="例如：地图页">
        </div>
        <div class="form-row">
          <label class="form-label">副标题（可选）</label>
          <input class="form-input" id="f-meta" value="${escapeHTML(m.meta || '')}" placeholder="例如：底部 Tab 1 · 默认页">
        </div>
        <div class="form-row form-row-2col">
          <div>
            <label class="form-label">进度 % (留空自动算)</label>
            <input class="form-input" id="f-progress" type="number" min="0" max="100" value="${m.progress != null ? m.progress : ''}" placeholder="留空">
          </div>
          <div>
            <label class="form-label">进度条颜色</label>
            <select class="form-select" id="f-progressColor">
              <option value="var(--done)" ${m.progressColor === 'var(--done)' ? 'selected' : ''}>绿（完成）</option>
              <option value="var(--wip)"  ${m.progressColor === 'var(--wip)'  ? 'selected' : ''}>橙（进行中）</option>
              <option value="var(--p4)"   ${m.progressColor === 'var(--p4)'   ? 'selected' : ''}>橘（NZ化）</option>
              <option value="var(--plan)" ${m.progressColor === 'var(--plan)' ? 'selected' : ''}>蓝（计划）</option>
            </select>
          </div>
        </div>
      `,
      buttons: [
        ...(isNew ? [] : [{ label: '删除', variant: 'danger', close: false, onClick: () => {
          deleteModule(id);
          Modal.close();
        }}]),
        { label: '取消' },
        { label: isNew ? '新增' : '保存', variant: 'primary', onClick: el => {
            const progressVal = el.querySelector('#f-progress').value;
            const data = {
              ...m,
              icon: el.querySelector('#f-icon').value.trim() || '📦',
              iconBg: el.querySelector('#f-iconBg').value,
              title: el.querySelector('#f-title').value.trim(),
              meta: el.querySelector('#f-meta').value.trim(),
              progress: progressVal === '' ? null : Math.max(0, Math.min(100, +progressVal)),
              progressColor: el.querySelector('#f-progressColor').value
            };
            if (!data.title) { Toast.error('模块名不能为空'); return false; }
            Store.update(s => {
              if (isNew) s.modules.push(data);
              else {
                const i = s.modules.findIndex(x => x.id === id);
                if (i > -1) s.modules[i] = { ...s.modules[i], ...data };
              }
            });
            render();
            Toast.success(isNew ? '已新增' : '已保存');
        } }
      ]
    });
  }

  async function deleteModule(id) {
    const m = Store.get().modules.find(x => x.id === id);
    if (!m) return;
    const ok = await Modal.confirm({
      title: '删除模块',
      message: `"${m.title}" 包含 ${m.features.length} 个功能点。删除后不可恢复。`,
      confirmLabel: '删除', danger: true, icon: '🗑'
    });
    if (!ok) return;
    Store.update(s => {
      s.modules = s.modules.filter(x => x.id !== id);
    });
    render();
    Toast.success('已删除');
  }

  function editFeature(id, moduleId) {
    const isNew = !id;
    const state = Store.get();
    let f = null, parentMod = null;
    if (isNew) {
      parentMod = state.modules.find(m => m.id === moduleId);
      f = { id: Store.newId('f'), title: '', status: 'planned' };
    } else {
      for (const m of state.modules) {
        const found = m.features.find(x => x.id === id);
        if (found) { f = { ...found }; parentMod = m; break; }
      }
    }
    if (!f || !parentMod) return;

    Modal.open({
      icon: '🔧', title: isNew ? '新增功能点' : '编辑功能点',
      sub: `所属模块：${parentMod.title}`,
      bodyHTML: `
        <div class="form-row">
          <label class="form-label">功能描述</label>
          <input class="form-input" id="f-title" value="${escapeHTML(f.title)}" placeholder="例如：Mapbox 真实地图渲染">
        </div>
        <div class="form-row">
          <label class="form-label">所属模块</label>
          <select class="form-select" id="f-module">
            ${state.modules.map(m => `<option value="${m.id}" ${parentMod.id === m.id ? 'selected' : ''}>${escapeHTML(m.icon || '')} ${escapeHTML(m.title)}</option>`).join('')}
          </select>
        </div>
        <div class="form-row">
          <label class="form-label">状态</label>
          <div class="status-pick" id="f-status">
            ${['done','wip','p4','planned','blocked'].map(s => `
              <div class="status-opt ${f.status === s ? 'active' : ''}" data-status="${s}">${STATUS_LABELS[s]}</div>
            `).join('')}
          </div>
        </div>
      `,
      buttons: [
        ...(isNew ? [] : [{ label: '删除', variant: 'danger', close: false, onClick: () => {
          deleteFeature(id);
          Modal.close();
        }}]),
        { label: '取消' },
        { label: isNew ? '新增' : '保存', variant: 'primary', onClick: el => {
            const title = el.querySelector('#f-title').value.trim();
            const targetModuleId = el.querySelector('#f-module').value;
            const status = el.querySelector('#f-status .status-opt.active')?.dataset.status || 'planned';
            if (!title) { Toast.error('描述不能为空'); return false; }

            Store.update(s => {
              const updated = { ...f, title, status };
              if (isNew) {
                const m = s.modules.find(x => x.id === targetModuleId);
                if (m) m.features.push(updated);
              } else {
                // find old module + remove
                for (const m of s.modules) {
                  const i = m.features.findIndex(x => x.id === id);
                  if (i > -1) {
                    if (m.id === targetModuleId) {
                      m.features[i] = updated;
                      return;
                    } else {
                      m.features.splice(i, 1);
                      const t = s.modules.find(x => x.id === targetModuleId);
                      if (t) t.features.push(updated);
                      return;
                    }
                  }
                }
              }
            });
            render();
            Toast.success(isNew ? '已新增' : '已保存');
        } }
      ],
      onMount: el => {
        const picker = el.querySelector('#f-status');
        picker.addEventListener('click', e => {
          const opt = e.target.closest('.status-opt');
          if (!opt) return;
          picker.querySelectorAll('.status-opt').forEach(o => o.classList.remove('active'));
          opt.classList.add('active');
        });
      }
    });
  }

  async function deleteFeature(id) {
    let feat = null;
    for (const m of Store.get().modules) {
      const f = m.features.find(x => x.id === id);
      if (f) { feat = f; break; }
    }
    if (!feat) return;
    const ok = await Modal.confirm({
      title: '删除功能点',
      message: `确定删除 "${feat.title}"？`,
      confirmLabel: '删除', danger: true, icon: '🗑'
    });
    if (!ok) return;
    Store.update(s => {
      s.modules.forEach(m => {
        m.features = m.features.filter(x => x.id !== id);
      });
    });
    render();
    Toast.success('已删除');
  }

  return { render };
})();

window.ViewModules = ViewModules;
