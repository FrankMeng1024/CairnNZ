/* ════════════════════════════════════════════════════════════
   view-overview.js — Page 1: Product Overview
   ──────────────────────────────────────────────────────────── */

const ViewOverview = (() => {

  function compute(state) {
    // counts
    const cards = state.story.cards;
    const counts = { done: 0, wip: 0, p4: 0, planned: 0, blocked: 0 };
    cards.forEach(c => { if (counts[c.status] != null) counts[c.status]++; });
    const total = cards.length;
    const donePct = total ? Math.round(counts.done / total * 100) : 0;

    const moduleCount = state.modules.length;
    const featureCount = state.modules.reduce((sum, m) => sum + m.features.length, 0);
    const featureDone  = state.modules.reduce(
      (sum, m) => sum + m.features.filter(f => f.status === 'done').length, 0
    );
    const featDonePct = featureCount ? Math.round(featureDone / featureCount * 100) : 0;

    const phaseCount = state.timeline.length;
    const phaseInProgress = state.timeline.filter(p => p.progress > 0 && p.progress < 100).length;

    return {
      counts, total, donePct,
      moduleCount, featureCount, featureDone, featDonePct,
      phaseCount, phaseInProgress
    };
  }

  function render() {
    const root = document.getElementById('view-overview');
    if (!root) return;
    const state = Store.get();
    const stats = compute(state);
    const ov = state.overview;

    const hiw = ov.howItWorks || [];

    const doneTotal = stats.counts.done + stats.counts.wip + stats.counts.p4 + stats.counts.planned + stats.counts.blocked;

    root.innerHTML = `
      <div class="ov-grid">

        <!-- Hero -->
        <section class="ov-hero" data-edit-target="hero">
          <button class="card-icon-btn ov-hero-edit" data-action="edit-hero" data-tip="编辑产品介绍">✏️</button>
          <div class="ov-hero-layout">
            <div class="ov-hero-left">
              <div class="ov-hero-eyebrow">产品概览</div>
              <h1 class="ov-hero-title">${escapeHTML(ov.tagline)}</h1>
              <div class="ov-hero-sub">${escapeHTML(ov.subtitle)}</div>
              ${ov.description ? `<div class="ov-hero-desc">${escapeHTML(ov.description)}</div>` : ''}
              <div class="ov-hero-meta">
                <span class="ov-hero-meta-chip"><img src="assets/icon.svg" alt="" class="chip-logo"> Cairn for NZ</span>
                <span class="ov-hero-meta-chip">Sprint 55–56 进行中</span>
                <span class="ov-hero-meta-chip">${stats.phaseCount} 个阶段</span>
              </div>
            </div>
            <div class="ov-stats">
              <div class="stat" data-tone="done" data-filter-status="done" data-tip="点击筛选故事地图" ${stats.counts.done === 0 ? 'data-zero="true"' : ''}>
                <div class="stat-label">已完成</div>
                <div class="stat-value">${stats.counts.done}</div>
                <div class="stat-bar"><div class="stat-bar-fill" style="width:${doneTotal ? Math.round(stats.counts.done/doneTotal*100) : 0}%;background:var(--done)"></div></div>
                <div class="stat-sub">${doneTotal ? Math.round(stats.counts.done/doneTotal*100) : 0}%</div>
              </div>
              <div class="stat" data-tone="wip" data-filter-status="wip" data-tip="点击筛选故事地图" ${stats.counts.wip === 0 ? 'data-zero="true"' : ''}>
                <div class="stat-label">进行中</div>
                <div class="stat-value">${stats.counts.wip}</div>
                <div class="stat-bar"><div class="stat-bar-fill" style="width:${doneTotal ? Math.round(stats.counts.wip/doneTotal*100) : 0}%;background:var(--wip)"></div></div>
                <div class="stat-sub">${doneTotal ? Math.round(stats.counts.wip/doneTotal*100) : 0}%</div>
              </div>
              <div class="stat" data-tone="p4" data-filter-status="p4" data-tip="点击筛选故事地图" ${stats.counts.p4 === 0 ? 'data-zero="true"' : ''}>
                <div class="stat-label">准备进行</div>
                <div class="stat-value">${stats.counts.p4}</div>
                <div class="stat-bar"><div class="stat-bar-fill" style="width:${doneTotal ? Math.round(stats.counts.p4/doneTotal*100) : 0}%;background:var(--p4)"></div></div>
                <div class="stat-sub">${doneTotal ? Math.round(stats.counts.p4/doneTotal*100) : 0}%</div>
              </div>
              <div class="stat" data-tone="plan" data-filter-status="planned" data-tip="点击筛选故事地图" ${stats.counts.planned === 0 ? 'data-zero="true"' : ''}>
                <div class="stat-label">计划中</div>
                <div class="stat-value">${stats.counts.planned}</div>
                <div class="stat-bar"><div class="stat-bar-fill" style="width:${doneTotal ? Math.round(stats.counts.planned/doneTotal*100) : 0}%;background:var(--plan)"></div></div>
                <div class="stat-sub">${doneTotal ? Math.round(stats.counts.planned/doneTotal*100) : 0}%</div>
              </div>
            </div>
          </div>
        </section>

        <!-- How It Works -->
        ${hiw.length ? `
        <div class="ov-section-head">
          <div class="ov-section-title">怎么用</div>
        </div>
        <div class="ov-hiw">
          ${hiw.map((s, i) => `
            <div class="hiw-step">
              <div class="hiw-connector ${i === hiw.length - 1 ? 'hiw-connector--last' : ''}"></div>
              <div class="hiw-icon">${s.icon}</div>
              <div class="hiw-body">
                <div class="hiw-step-num">${s.step}</div>
                <div class="hiw-title">${escapeHTML(s.title)}</div>
                <div class="hiw-desc">${escapeHTML(s.desc)}</div>
              </div>
            </div>
          `).join('')}
        </div>` : ''}

        <!-- Personas -->
        <div class="ov-section-head">
          <div class="ov-section-title">用户画像</div>
          <button class="ov-section-action" data-action="add-persona">+ 新增画像</button>
        </div>
        <div class="ov-personas" id="ov-personas-grid">
          ${ov.personas.map(p => personaCard(p)).join('')}
        </div>

        <!-- Principles -->
        <div class="ov-section-head">
          <div class="ov-section-title">核心理念</div>
          <button class="ov-section-action" data-action="add-principle">+ 新增原则</button>
        </div>
        <div class="ov-principles" id="ov-principles-grid">
          ${ov.principles.map(p => principleCard(p)).join('')}
        </div>

      </div>
    `;

    bindEvents(root);
    bindDrag();
  }

  function personaCard(p) {
    return `
      <div class="persona" data-id="${p.id}" data-kind="persona">
        <div class="persona-actions">
          <button class="card-icon-btn" data-action="edit-persona" data-id="${p.id}" data-tip="编辑">✏️</button>
          <button class="card-icon-btn danger" data-action="delete-persona" data-id="${p.id}" data-tip="删除">✕</button>
        </div>
        <div class="persona-head">
          <div class="persona-emoji">${p.emoji || '👤'}</div>
          <div>
            <div class="persona-name">${escapeHTML(p.name)}</div>
            <div class="persona-role">${escapeHTML(p.role || '')}</div>
          </div>
        </div>
        <div class="persona-section">
          <div class="persona-label">使用场景</div>
          <div class="persona-text">${escapeHTML(p.scenario || '')}</div>
        </div>
        <div class="persona-section">
          <div class="persona-label">核心痛点</div>
          <div class="persona-text">${escapeHTML(p.painpoint || '')}</div>
        </div>
        ${p.wants ? `
        <div class="persona-section">
          <div class="persona-label">期望</div>
          <div class="persona-text">${escapeHTML(p.wants)}</div>
        </div>` : ''}
      </div>
    `;
  }

  function principleCard(p) {
    return `
      <div class="principle" data-id="${p.id}" data-kind="principle">
        <div class="principle-actions">
          <button class="card-icon-btn" data-action="edit-principle" data-id="${p.id}" data-tip="编辑">✏️</button>
          <button class="card-icon-btn danger" data-action="delete-principle" data-id="${p.id}" data-tip="删除">✕</button>
        </div>
        <div class="principle-head">
          <span class="principle-icon">${p.icon || '🔷'}</span>
          <span class="principle-title">${escapeHTML(p.title)}</span>
        </div>
        <div class="principle-desc">${escapeHTML(p.desc || '')}</div>
      </div>
    `;
  }

  function bindEvents(root) {
    root.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      const statTile = e.target.closest('.stat[data-filter-status]');

      // Stat tile click → switch to story map with filter
      if (statTile && !btn) {
        const status = statTile.dataset.filterStatus;
        App.switchTo('view-story', status);
        return;
      }

      if (!btn) {
        return;
      }
      const action = btn.dataset.action;
      const id = btn.dataset.id;

      if (action === 'edit-hero')        return editHero();
      if (action === 'add-persona')      return editPersona(null);
      if (action === 'edit-persona')     return editPersona(id);
      if (action === 'delete-persona')   return deletePersona(id);
      if (action === 'add-principle')    return editPrinciple(null);
      if (action === 'edit-principle')   return editPrinciple(id);
      if (action === 'delete-principle') return deletePrinciple(id);
    });

    // double-click to edit
    root.addEventListener('dblclick', e => {
      const persona = e.target.closest('.persona');
      const principle = e.target.closest('.principle');
      const hero = e.target.closest('.ov-hero');
      if (persona) editPersona(persona.dataset.id);
      else if (principle) editPrinciple(principle.dataset.id);
      else if (hero) editHero();
    });

    // right-click context menu
    root.addEventListener('contextmenu', e => {
      const persona = e.target.closest('.persona');
      const principle = e.target.closest('.principle');
      if (persona) {
        ContextMenu.show(e, [
          { label: '编辑', icon: '✏️', onClick: () => editPersona(persona.dataset.id) },
          { sep: true },
          { label: '删除', icon: '🗑', danger: true, onClick: () => deletePersona(persona.dataset.id) }
        ]);
      } else if (principle) {
        ContextMenu.show(e, [
          { label: '编辑', icon: '✏️', onClick: () => editPrinciple(principle.dataset.id) },
          { sep: true },
          { label: '删除', icon: '🗑', danger: true, onClick: () => deletePrinciple(principle.dataset.id) }
        ]);
      }
    });
  }

  function bindDrag() {
    const personasGrid = document.getElementById('ov-personas-grid');
    const principlesGrid = document.getElementById('ov-principles-grid');

    if (personasGrid) {
      DragDrop.bind({
        container: personasGrid,
        itemSelector: '.persona',
        containerSelector: '.ov-personas',
        axis: 'x',
        onDrop: ({ itemId, toIndex }) => {
          Store.update(s => {
            const arr = s.overview.personas;
            const idx = arr.findIndex(p => p.id === itemId);
            if (idx < 0) return;
            const [item] = arr.splice(idx, 1);
            arr.splice(toIndex, 0, item);
          });
          render();
          Toast.success('已重新排序');
        }
      });
    }

    if (principlesGrid) {
      DragDrop.bind({
        container: principlesGrid,
        itemSelector: '.principle',
        containerSelector: '.ov-principles',
        axis: 'x',
        onDrop: ({ itemId, toIndex }) => {
          Store.update(s => {
            const arr = s.overview.principles;
            const idx = arr.findIndex(p => p.id === itemId);
            if (idx < 0) return;
            const [item] = arr.splice(idx, 1);
            arr.splice(toIndex, 0, item);
          });
          render();
          Toast.success('已重新排序');
        }
      });
    }
  }

  function editHero() {
    const ov = Store.get().overview;
    Modal.open({
      icon: '✏️', title: '编辑产品介绍', size: 'lg',
      bodyHTML: `
        <div class="form-row">
          <label class="form-label">产品名 / Logo文字</label>
          <input class="form-input" id="f-tagline" value="${escapeHTML(ov.tagline)}">
        </div>
        <div class="form-row">
          <label class="form-label">一句话定位</label>
          <input class="form-input" id="f-subtitle" value="${escapeHTML(ov.subtitle)}">
        </div>
        <div class="form-row">
          <label class="form-label">详细介绍</label>
          <textarea class="form-textarea" id="f-desc" rows="4">${escapeHTML(ov.description)}</textarea>
        </div>
      `,
      buttons: [
        { label: '取消' },
        { label: '保存', variant: 'primary', onClick: el => {
            const tagline  = el.querySelector('#f-tagline').value.trim();
            const subtitle = el.querySelector('#f-subtitle').value.trim();
            const desc     = el.querySelector('#f-desc').value.trim();
            if (!tagline || !subtitle) {
              Toast.error('产品名和定位不能为空');
              return false;
            }
            Store.update(s => {
              s.overview.tagline = tagline;
              s.overview.subtitle = subtitle;
              s.overview.description = desc;
            });
            render();
            Toast.success('已保存');
        } }
      ]
    });
  }

  function editPersona(id) {
    const isNew = !id;
    const ov = Store.get().overview;
    const p = isNew
      ? { id: Store.newId('p'), emoji: '👤', name: '', role: '', scenario: '', painpoint: '', wants: '', accent: '--persona-a' }
      : { ...ov.personas.find(x => x.id === id) };
    if (!p) return;

    const accents = [
      { v: '--persona-a', label: '青' },
      { v: '--persona-b', label: '紫' },
      { v: '--persona-c', label: '绿' }
    ];

    Modal.open({
      icon: p.emoji || '👤',
      title: isNew ? '新增用户画像' : '编辑用户画像',
      size: 'lg',
      bodyHTML: `
        <div class="form-row form-row-2col">
          <div>
            <label class="form-label">表情</label>
            <input class="form-input" id="f-emoji" maxlength="4" value="${escapeHTML(p.emoji)}">
          </div>
          <div>
            <label class="form-label">主题色</label>
            <select class="form-select" id="f-accent">
              ${accents.map(a => `<option value="${a.v}" ${p.accent === a.v ? 'selected' : ''}>${a.label}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-row form-row-2col">
          <div>
            <label class="form-label">名字</label>
            <input class="form-input" id="f-name" value="${escapeHTML(p.name)}" placeholder="例如：Alex">
          </div>
          <div>
            <label class="form-label">身份 / 角色</label>
            <input class="form-input" id="f-role" value="${escapeHTML(p.role)}" placeholder="例如：NZ 本地 tramper">
          </div>
        </div>
        <div class="form-row">
          <label class="form-label">使用场景</label>
          <textarea class="form-textarea" id="f-scenario" rows="2">${escapeHTML(p.scenario)}</textarea>
        </div>
        <div class="form-row">
          <label class="form-label">核心痛点</label>
          <textarea class="form-textarea" id="f-painpoint" rows="2">${escapeHTML(p.painpoint)}</textarea>
        </div>
        <div class="form-row">
          <label class="form-label">期望（可选）</label>
          <textarea class="form-textarea" id="f-wants" rows="2">${escapeHTML(p.wants || '')}</textarea>
        </div>
      `,
      buttons: [
        ...(isNew ? [] : [{ label: '删除', variant: 'danger', close: false, onClick: () => {
          deletePersona(id);
          Modal.close();
        }}]),
        { label: '取消' },
        { label: isNew ? '新增' : '保存', variant: 'primary', onClick: el => {
            const data = {
              ...p,
              emoji: el.querySelector('#f-emoji').value.trim() || '👤',
              accent: el.querySelector('#f-accent').value,
              name: el.querySelector('#f-name').value.trim(),
              role: el.querySelector('#f-role').value.trim(),
              scenario: el.querySelector('#f-scenario').value.trim(),
              painpoint: el.querySelector('#f-painpoint').value.trim(),
              wants: el.querySelector('#f-wants').value.trim()
            };
            if (!data.name) {
              Toast.error('名字不能为空');
              return false;
            }
            Store.update(s => {
              if (isNew) s.overview.personas.push(data);
              else {
                const i = s.overview.personas.findIndex(x => x.id === id);
                if (i > -1) s.overview.personas[i] = data;
              }
            });
            render();
            Toast.success(isNew ? '已新增' : '已保存');
        } }
      ]
    });
  }

  async function deletePersona(id) {
    const p = Store.get().overview.personas.find(x => x.id === id);
    if (!p) return;
    const ok = await Modal.confirm({
      title: '删除用户画像',
      message: `确定删除 "${p.name}"？此操作不可撤销。`,
      confirmLabel: '删除', danger: true, icon: '🗑'
    });
    if (!ok) return;
    Store.update(s => {
      s.overview.personas = s.overview.personas.filter(x => x.id !== id);
    });
    render();
    Toast.success('已删除');
  }

  function editPrinciple(id) {
    const isNew = !id;
    const ov = Store.get().overview;
    const p = isNew
      ? { id: Store.newId('pr'), icon: '🔷', title: '', desc: '' }
      : { ...ov.principles.find(x => x.id === id) };
    if (!p) return;

    Modal.open({
      icon: p.icon || '🔷',
      title: isNew ? '新增设计原则' : '编辑设计原则',
      bodyHTML: `
        <div class="form-row form-row-2col">
          <div>
            <label class="form-label">图标</label>
            <input class="form-input" id="f-icon" maxlength="4" value="${escapeHTML(p.icon)}">
          </div>
          <div>
            <label class="form-label">标题</label>
            <input class="form-input" id="f-title" value="${escapeHTML(p.title)}" placeholder="例如：安全第一">
          </div>
        </div>
        <div class="form-row">
          <label class="form-label">描述</label>
          <textarea class="form-textarea" id="f-desc" rows="3">${escapeHTML(p.desc)}</textarea>
        </div>
      `,
      buttons: [
        ...(isNew ? [] : [{ label: '删除', variant: 'danger', close: false, onClick: () => {
          deletePrinciple(id);
          Modal.close();
        }}]),
        { label: '取消' },
        { label: isNew ? '新增' : '保存', variant: 'primary', onClick: el => {
            const data = {
              ...p,
              icon:  el.querySelector('#f-icon').value.trim() || '🔷',
              title: el.querySelector('#f-title').value.trim(),
              desc:  el.querySelector('#f-desc').value.trim()
            };
            if (!data.title) {
              Toast.error('标题不能为空');
              return false;
            }
            Store.update(s => {
              if (isNew) s.overview.principles.push(data);
              else {
                const i = s.overview.principles.findIndex(x => x.id === id);
                if (i > -1) s.overview.principles[i] = data;
              }
            });
            render();
            Toast.success(isNew ? '已新增' : '已保存');
        } }
      ]
    });
  }

  async function deletePrinciple(id) {
    const p = Store.get().overview.principles.find(x => x.id === id);
    if (!p) return;
    const ok = await Modal.confirm({
      title: '删除设计原则',
      message: `确定删除 "${p.title}"？`,
      confirmLabel: '删除', danger: true, icon: '🗑'
    });
    if (!ok) return;
    Store.update(s => {
      s.overview.principles = s.overview.principles.filter(x => x.id !== id);
    });
    render();
    Toast.success('已删除');
  }

  return { render };
})();

window.ViewOverview = ViewOverview;
