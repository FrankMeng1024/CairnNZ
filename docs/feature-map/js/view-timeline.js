/* ════════════════════════════════════════════════════════════
   view-timeline.js — Page 4: Timeline (Kanban-like phases)
   ──────────────────────────────────────────────────────────── */

const ViewTimeline = (() => {

  const COLOR_OPTIONS = [
    { v: 'var(--done)', label: '绿（完成）' },
    { v: 'var(--wip)',  label: '橙（进行中）' },
    { v: 'var(--p4)',   label: '橘（NZ化）' },
    { v: 'var(--plan)', label: '蓝（计划）' },
    { v: 'var(--sub)',  label: '灰（远期）' }
  ];

  function render() {
    const root = document.getElementById('view-timeline');
    if (!root) return;
    const phases = [...Store.get().timeline].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    root.innerHTML = `
      <div class="timeline" id="tl-root">
        ${phases.map(p => phaseColumn(p)).join('')}
        <button class="tl-phase" data-action="add-phase"
          style="display:flex;align-items:center;justify-content:center;background:transparent;border-style:dashed;color:var(--sub);font-size:13px;cursor:pointer;min-height:240px">
          + 新增阶段
        </button>
      </div>
    `;

    bindEvents(root);
    bindDrag(root);
  }

  function phaseColumn(p) {
    return `
      <div class="tl-phase" data-id="${p.id}" data-kind="phase" data-faded="${!!p.faded}">
        <div class="tl-actions">
          <button class="card-icon-btn" data-action="edit-phase" data-id="${p.id}" data-tip="编辑阶段">✏️</button>
          <button class="card-icon-btn danger" data-action="delete-phase" data-id="${p.id}" data-tip="删除阶段">✕</button>
        </div>
        <div class="tl-header">
          <div class="tl-phase-name" style="color:${p.color || 'var(--text)'}">${escapeHTML(p.name)}</div>
          <div class="tl-progress-track"><div class="tl-progress-fill" style="width:${p.progress || 0}%;background:${p.color || 'var(--plan)'}"></div></div>
          <div class="tl-sprint">${escapeHTML(p.sprint || '')}</div>
        </div>
        <div class="tl-items" data-phase-id="${p.id}">
          ${p.items.map(it => itemCard(it)).join('')}
          <button class="tl-add" data-action="add-item" data-phase-id="${p.id}">+ 新增条目</button>
        </div>
      </div>
    `;
  }

  function itemCard(it) {
    return `
      <div class="tl-item" data-id="${it.id}" data-kind="item">
        <div class="tl-item-dot" style="background:${it.dotColor || 'var(--sub)'}"></div>
        <div class="tl-item-body">
          <div class="tl-item-text">${escapeHTML(it.text)}</div>
          ${it.sub ? `<div class="tl-item-sub">${escapeHTML(it.sub)}</div>` : ''}
        </div>
        <div class="tl-item-actions">
          <button class="card-icon-btn" data-action="edit-item" data-id="${it.id}" data-tip="编辑">✏️</button>
          <button class="card-icon-btn danger" data-action="delete-item" data-id="${it.id}" data-tip="删除">✕</button>
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
      const phaseId = btn.dataset.phaseId;

      if (action === 'add-phase')    return editPhase(null);
      if (action === 'edit-phase')   return editPhase(id);
      if (action === 'delete-phase') return deletePhase(id);
      if (action === 'add-item')     return editItem(null, phaseId);
      if (action === 'edit-item')    return editItem(id);
      if (action === 'delete-item')  return deleteItem(id);
    });

    root.addEventListener('dblclick', e => {
      const item = e.target.closest('.tl-item');
      const phaseHeader = e.target.closest('.tl-header');
      const phaseEl = e.target.closest('.tl-phase[data-id]');
      if (item) editItem(item.dataset.id);
      else if (phaseHeader && phaseEl) editPhase(phaseEl.dataset.id);
    });

    root.addEventListener('contextmenu', e => {
      const item = e.target.closest('.tl-item');
      const phaseEl = e.target.closest('.tl-phase[data-id]');
      if (item) {
        ContextMenu.show(e, [
          { label: '编辑', icon: '✏️', onClick: () => editItem(item.dataset.id) },
          { sep: true },
          { label: '删除', icon: '🗑', danger: true, onClick: () => deleteItem(item.dataset.id) }
        ]);
      } else if (phaseEl) {
        ContextMenu.show(e, [
          { label: '编辑阶段', icon: '✏️', onClick: () => editPhase(phaseEl.dataset.id) },
          { sep: true },
          { label: '删除阶段', icon: '🗑', danger: true, onClick: () => deletePhase(phaseEl.dataset.id) }
        ]);
      }
    });
  }

  function bindDrag(root) {
    // phase reorder (horizontal)
    DragDrop.bind({
      container: root,
      itemSelector: '.tl-phase[data-id]',
      containerSelector: '.timeline',
      handleSelector: '.tl-header',
      axis: 'x',
      onDrop: ({ itemId, toIndex }) => {
        Store.update(s => {
          const arr = [...s.timeline].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
          const i = arr.findIndex(p => p.id === itemId);
          if (i < 0) return;
          const [p] = arr.splice(i, 1);
          arr.splice(toIndex, 0, p);
          arr.forEach((pp, idx) => pp.order = idx);
        });
        render();
      }
    });

    // item drag (vertical, cross-phase allowed)
    DragDrop.bind({
      container: root,
      itemSelector: '.tl-item',
      containerSelector: '.tl-items',
      axis: 'y',
      onDrop: ({ itemId, toContainer, toIndex }) => {
        const targetPhaseId = toContainer.dataset.phaseId;
        Store.update(s => {
          let movingItem = null;
          for (const p of s.timeline) {
            const i = p.items.findIndex(x => x.id === itemId);
            if (i > -1) { movingItem = p.items.splice(i, 1)[0]; break; }
          }
          if (!movingItem) return;
          const target = s.timeline.find(p => p.id === targetPhaseId);
          if (!target) return;
          target.items.splice(Math.max(0, Math.min(toIndex, target.items.length)), 0, movingItem);
        });
        render();
      }
    });
  }

  /* ─── CRUD ─── */

  function editPhase(id) {
    const isNew = !id;
    const state = Store.get();
    const p = isNew
      ? { id: Store.newId('tl'), name: '', color: 'var(--plan)', sprint: '', progress: 0, faded: false, items: [], order: state.timeline.length }
      : { ...state.timeline.find(x => x.id === id) };
    if (!p) return;

    Modal.open({
      icon: '📅', title: isNew ? '新增阶段' : '编辑阶段', size: 'lg',
      bodyHTML: `
        <div class="form-row">
          <label class="form-label">阶段名称</label>
          <input class="form-input" id="f-name" value="${escapeHTML(p.name)}" placeholder="例如：📅 Phase 5">
        </div>
        <div class="form-row form-row-2col">
          <div>
            <label class="form-label">主色</label>
            <select class="form-select" id="f-color">
              ${COLOR_OPTIONS.map(o => `<option value="${o.v}" ${p.color === o.v ? 'selected' : ''}>${o.label}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="form-label">进度 %</label>
            <input class="form-input" id="f-progress" type="number" min="0" max="100" value="${p.progress || 0}">
          </div>
        </div>
        <div class="form-row">
          <label class="form-label">Sprint 描述</label>
          <input class="form-input" id="f-sprint" value="${escapeHTML(p.sprint || '')}" placeholder="例如：Sprint 59-60 · 计划中">
        </div>
        <div class="form-row">
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text2);cursor:pointer">
            <input type="checkbox" id="f-faded" ${p.faded ? 'checked' : ''}>
            <span>淡化显示（远期未确定的阶段）</span>
          </label>
        </div>
      `,
      buttons: [
        ...(isNew ? [] : [{ label: '删除', variant: 'danger', close: false, onClick: () => {
          deletePhase(id);
          Modal.close();
        }}]),
        { label: '取消' },
        { label: isNew ? '新增' : '保存', variant: 'primary', onClick: el => {
            const data = {
              ...p,
              name:    el.querySelector('#f-name').value.trim(),
              color:   el.querySelector('#f-color').value,
              progress: Math.max(0, Math.min(100, +el.querySelector('#f-progress').value || 0)),
              sprint:  el.querySelector('#f-sprint').value.trim(),
              faded:   el.querySelector('#f-faded').checked
            };
            if (!data.name) { Toast.error('阶段名不能为空'); return false; }
            Store.update(s => {
              if (isNew) s.timeline.push(data);
              else {
                const i = s.timeline.findIndex(x => x.id === id);
                if (i > -1) s.timeline[i] = { ...s.timeline[i], ...data };
              }
            });
            render();
            Toast.success(isNew ? '已新增' : '已保存');
        } }
      ]
    });
  }

  async function deletePhase(id) {
    const p = Store.get().timeline.find(x => x.id === id);
    if (!p) return;
    const ok = await Modal.confirm({
      title: '删除阶段',
      message: `"${p.name}" 包含 ${p.items.length} 个条目。删除后不可恢复。`,
      confirmLabel: '删除', danger: true, icon: '🗑'
    });
    if (!ok) return;
    Store.update(s => {
      s.timeline = s.timeline.filter(x => x.id !== id);
    });
    render();
    Toast.success('已删除');
  }

  function editItem(id, phaseId) {
    const isNew = !id;
    const state = Store.get();
    let it = null, parentPhase = null;
    if (isNew) {
      parentPhase = state.timeline.find(p => p.id === phaseId);
      it = { id: Store.newId('it'), text: '', sub: '', dotColor: parentPhase?.color || 'var(--plan)' };
    } else {
      for (const p of state.timeline) {
        const found = p.items.find(x => x.id === id);
        if (found) { it = { ...found }; parentPhase = p; break; }
      }
    }
    if (!it || !parentPhase) return;

    Modal.open({
      icon: '🔖', title: isNew ? '新增条目' : '编辑条目',
      sub: `所属阶段：${parentPhase.name}`,
      bodyHTML: `
        <div class="form-row">
          <label class="form-label">条目内容</label>
          <input class="form-input" id="f-text" value="${escapeHTML(it.text)}" placeholder="例如：E-012 字体 Inter">
        </div>
        <div class="form-row">
          <label class="form-label">副标题（可选）</label>
          <input class="form-input" id="f-sub" value="${escapeHTML(it.sub || '')}" placeholder="例如：Sprint 55 · 替代 iOS SF">
        </div>
        <div class="form-row form-row-2col">
          <div>
            <label class="form-label">所属阶段</label>
            <select class="form-select" id="f-phase">
              ${state.timeline.map(p => `<option value="${p.id}" ${parentPhase.id === p.id ? 'selected' : ''}>${escapeHTML(p.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="form-label">小圆点颜色</label>
            <select class="form-select" id="f-dot">
              ${COLOR_OPTIONS.map(o => `<option value="${o.v}" ${it.dotColor === o.v ? 'selected' : ''}>${o.label}</option>`).join('')}
            </select>
          </div>
        </div>
      `,
      buttons: [
        ...(isNew ? [] : [{ label: '删除', variant: 'danger', close: false, onClick: () => {
          deleteItem(id);
          Modal.close();
        }}]),
        { label: '取消' },
        { label: isNew ? '新增' : '保存', variant: 'primary', onClick: el => {
            const text = el.querySelector('#f-text').value.trim();
            const sub  = el.querySelector('#f-sub').value.trim();
            const targetPhaseId = el.querySelector('#f-phase').value;
            const dotColor = el.querySelector('#f-dot').value;
            if (!text) { Toast.error('内容不能为空'); return false; }
            Store.update(s => {
              const updated = { ...it, text, sub, dotColor };
              if (isNew) {
                const p = s.timeline.find(x => x.id === targetPhaseId);
                if (p) p.items.push(updated);
              } else {
                for (const p of s.timeline) {
                  const i = p.items.findIndex(x => x.id === id);
                  if (i > -1) {
                    if (p.id === targetPhaseId) {
                      p.items[i] = updated;
                      return;
                    } else {
                      p.items.splice(i, 1);
                      const t = s.timeline.find(x => x.id === targetPhaseId);
                      if (t) t.items.push(updated);
                      return;
                    }
                  }
                }
              }
            });
            render();
            Toast.success(isNew ? '已新增' : '已保存');
        } }
      ]
    });
  }

  async function deleteItem(id) {
    let item = null;
    for (const p of Store.get().timeline) {
      const it = p.items.find(x => x.id === id);
      if (it) { item = it; break; }
    }
    if (!item) return;
    const ok = await Modal.confirm({
      title: '删除条目',
      message: `确定删除 "${item.text}"？`,
      confirmLabel: '删除', danger: true, icon: '🗑'
    });
    if (!ok) return;
    Store.update(s => {
      s.timeline.forEach(p => {
        p.items = p.items.filter(x => x.id !== id);
      });
    });
    render();
    Toast.success('已删除');
  }

  return { render };
})();

window.ViewTimeline = ViewTimeline;
