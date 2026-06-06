/* ════════════════════════════════════════════════════════════
   view-story.js — Page 2: Story Map (swimlane)
   ──────────────────────────────────────────────────────────── */

const ViewStory = (() => {

  const STATUS_LABELS = {
    done: '完成', wip: '进行中', planned: '计划中', p4: '第4阶段', blocked: '阻塞'
  };

  let _dragDestroy = null;

  function render() {
    const root = document.getElementById('view-story');
    if (!root) return;
    const state = Store.get();
    const { activities, phases, cards } = state.story;

    // sort
    const sortedActivities = [...activities];
    const sortedPhases = [...phases].sort((a, b) => a.order - b.order);

    let html = `<div class="story-map">`;

    // activity row
    html += `
      <div class="sm-row sm-activity-row">
        <div class="sm-label" style="background:var(--canvas);font-size:10px;color:var(--sub2)">用户活动</div>
        <div class="sm-cells">
          ${sortedActivities.map(a => `
            <div class="sm-activity ${a.faded ? 'sm-activity--faded' : ''}" data-id="${a.id}" data-kind="activity">
              <div class="sm-activity-actions">
                <button class="card-icon-btn" data-action="edit-activity" data-id="${a.id}" data-tip="编辑">✏️</button>
                <button class="card-icon-btn danger" data-action="delete-activity" data-id="${a.id}" data-tip="删除列">✕</button>
              </div>
              <div class="sm-activity-icon">${a.icon || '📌'}</div>
              <div>${escapeHTML(a.name)}</div>
              <div class="sm-activity-sub">${escapeHTML(a.sub || '')}</div>
            </div>
          `).join('')}
        </div>
        <div class="sm-add-activity-btn" data-action="add-activity">
          <div style="font-size:20px;color:var(--sub2)">+</div>
          <div style="font-size:11px;color:var(--sub)">新增活动列</div>
        </div>
      </div>
    `;

    // phase rows
    sortedPhases.forEach(phase => {
      const phaseCards = cards.filter(c => c.phaseId === phase.id);
      const isRowEmpty = phaseCards.length === 0;

      html += `
        <div class="sm-row ${isRowEmpty ? 'sm-row--empty' : ''}" data-phase="${phase.status}" data-id="${phase.id}" data-kind="phase">
          <div class="sm-label">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px">
              <div>
                ${escapeHTML(phase.label)}
                <div class="sm-label-sub">${escapeHTML(phase.sprint || '')}</div>
              </div>
              <button class="card-icon-btn" data-action="edit-phase" data-id="${phase.id}" data-tip="编辑阶段" style="opacity:.7;flex-shrink:0;margin-top:1px">✏️</button>
            </div>
          </div>
          <div class="sm-cells sm-story-cells">
            ${isRowEmpty
              ? `<div class="sm-row--empty-state"><button class="sm-row--empty-state-btn" data-action="add-card-to-phase" data-phase-id="${phase.id}">+ 新增卡片到此阶段</button></div>${sortedActivities.map(act => `<div class="sm-col" id="col-${act.id}__${phase.id}" data-activity-id="${act.id}" data-phase-id="${phase.id}" style="min-width:230px;flex:1;padding:8px 10px;border-right:1px solid var(--border);display:none;"><button class="sm-col-empty-cta" data-action="add-card" data-activity-id="${act.id}" data-phase-id="${phase.id}">＋</button></div>`).join('')}`
              : sortedActivities.map(act => renderColumn(act, phase, cards)).join('')
            }
          </div>
        </div>
      `;
    });

    html += `</div>`;
    root.innerHTML = html;

    bindEvents(root);
    if (_dragDestroy) { _dragDestroy.destroy?.(); _dragDestroy = null; }
    _dragDestroy = bindDrag(root);
  }

  function renderColumn(activity, phase, cards) {
    const colId = `col-${activity.id}__${phase.id}`;
    const cardsInCol = cards
      .filter(c => c.activityId === activity.id && c.phaseId === phase.id)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    return `
      <div class="sm-col" id="${colId}" data-activity-id="${activity.id}" data-phase-id="${phase.id}">
        ${cardsInCol.length === 0 ? `<button class="sm-col-empty-cta" data-action="add-card" data-activity-id="${activity.id}" data-phase-id="${phase.id}">＋</button>` : ''}
        ${cardsInCol.map(c => renderCard(c)).join('')}
        ${cardsInCol.length > 0 ? `<button class="sm-col-add" data-action="add-card" data-activity-id="${activity.id}" data-phase-id="${phase.id}">+ 新增卡片</button>` : ''}
      </div>
    `;
  }

  function renderCard(c) {
    return `
      <div class="card ${c.starred ? 'card-starred' : ''}" data-status="${c.status}" data-id="${c.id}" data-kind="card">
        <div class="card-status"></div>
        <button class="card-star-btn ${c.starred ? 'active' : ''}" data-action="toggle-star" data-id="${c.id}" data-tip="${c.starred ? '取消优先标记' : '标记为优先'}">★</button>
        <div class="card-title">${escapeHTML(c.title)}</div>
        ${c.sub ? `<div class="card-sub">${escapeHTML(c.sub)}</div>` : ''}
        <div class="card-actions">
          <button class="card-icon-btn" data-action="edit-card" data-id="${c.id}" data-tip="编辑">✏️</button>
          <button class="card-icon-btn danger" data-action="delete-card" data-id="${c.id}" data-tip="删除">✕</button>
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

      if (action === 'add-activity')    return editActivity(null);
      if (action === 'edit-activity')   return editActivity(id);
      if (action === 'delete-activity') return deleteActivity(id);
      if (action === 'edit-phase')      return editPhase(id);
      if (action === 'add-card')        return editCard(null, btn.dataset.activityId, btn.dataset.phaseId);
      if (action === 'add-card-to-phase') {
        const state = Store.get();
        const firstAct = state.story.activities[0];
        return editCard(null, firstAct?.id, btn.dataset.phaseId);
      }
      if (action === 'edit-card')       return editCard(id);
      if (action === 'delete-card')     return deleteCard(id);
      if (action === 'toggle-star') {
        e.stopPropagation();
        Store.update(s => {
          const card = s.story.cards.find(c => c.id === id);
          if (card) card.starred = !card.starred;
        });
        // patch DOM in-place: no full re-render needed
        const cardEl = btn.closest('.card');
        const state = Store.get();
        const card = state.story.cards.find(c => c.id === id);
        if (cardEl && card) {
          cardEl.classList.toggle('card-starred', !!card.starred);
          btn.classList.toggle('active', !!card.starred);
          btn.dataset.tip = card.starred ? '取消优先标记' : '标记为优先';
        }
        return;
      }
    });

    root.addEventListener('dblclick', e => {
      const card = e.target.closest('.card');
      const activity = e.target.closest('.sm-activity[data-id]');
      if (card) editCard(card.dataset.id);
      else if (activity) editActivity(activity.dataset.id);
    });

    root.addEventListener('contextmenu', e => {
      const card = e.target.closest('.card');
      const activity = e.target.closest('.sm-activity[data-id]');
      const phase = e.target.closest('.sm-row[data-id]');
      if (card) {
        ContextMenu.show(e, [
          { label: '编辑', icon: '✏️', onClick: () => editCard(card.dataset.id) },
          { label: '快速改状态', icon: '🎯', onClick: () => quickStatusMenu(card.dataset.id) },
          { sep: true },
          { label: '删除', icon: '🗑', danger: true, onClick: () => deleteCard(card.dataset.id) }
        ]);
      } else if (activity && activity.dataset.id) {
        ContextMenu.show(e, [
          { label: '编辑列', icon: '✏️', onClick: () => editActivity(activity.dataset.id) },
          { sep: true },
          { label: '删除列', icon: '🗑', danger: true, onClick: () => deleteActivity(activity.dataset.id) }
        ]);
      } else if (phase) {
        ContextMenu.show(e, [
          { label: '编辑阶段', icon: '✏️', onClick: () => editPhase(phase.dataset.id) }
        ]);
      }
    });
  }

  function bindDrag(root) {
    return DragDrop.bind({
      container: root,
      itemSelector: '.card',
      containerSelector: '.sm-col',
      axis: 'y',
      onDrop: ({ itemId, toContainerId, toIndex, toContainer }) => {
        const activityId = toContainer.dataset.activityId;
        const phaseId    = toContainer.dataset.phaseId;
        Store.update(s => {
          const card = s.story.cards.find(c => c.id === itemId);
          if (!card) return;
          card.activityId = activityId;
          card.phaseId = phaseId;
          // status follows phase by default if user dragged to a different phase
          const phase = s.story.phases.find(p => p.id === phaseId);
          if (phase) card.status = phase.status;
          // re-order: rebuild order in target column
          const targetCol = s.story.cards
            .filter(c => c.activityId === activityId && c.phaseId === phaseId && c.id !== itemId)
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
          targetCol.splice(toIndex, 0, card);
          targetCol.forEach((c, i) => c.order = i);
        });
        render();
        Toast.success('已移动');
      }
    });
  }

  /* ─── CRUD ─── */

  function editCard(id, defaultActivityId, defaultPhaseId) {
    const isNew = !id;
    const state = Store.get();
    // For new cards, derive default status from the target phase
    const defaultStatus = isNew && defaultPhaseId
      ? (state.story.phases.find(p => p.id === defaultPhaseId)?.status || 'planned')
      : 'planned';
    const c = isNew
      ? { id: Store.newId('c'), title: '', sub: '', status: defaultStatus, activityId: defaultActivityId, phaseId: defaultPhaseId, order: 0 }
      : { ...state.story.cards.find(x => x.id === id) };
    if (!c) return;

    const acts = state.story.activities;
    const phs  = [...state.story.phases].sort((a, b) => a.order - b.order);

    Modal.open({
      icon: '🗂', title: isNew ? '新增故事卡' : '编辑故事卡', size: 'lg',
      bodyHTML: `
        <div class="form-row">
          <label class="form-label">标题</label>
          <input class="form-input" id="f-title" value="${escapeHTML(c.title)}" placeholder="例如：Mapbox 真实地图">
        </div>
        <div class="form-row">
          <label class="form-label">描述</label>
          <textarea class="form-textarea" id="f-sub" rows="2">${escapeHTML(c.sub || '')}</textarea>
        </div>
        <div class="form-row form-row-2col">
          <div>
            <label class="form-label">所属活动列</label>
            <select class="form-select" id="f-activity">
              ${acts.map(a => `<option value="${a.id}" ${c.activityId === a.id ? 'selected' : ''}>${escapeHTML(a.icon || '')} ${escapeHTML(a.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="form-label">所属阶段</label>
            <select class="form-select" id="f-phase">
              ${phs.map(p => `<option value="${p.id}" ${c.phaseId === p.id ? 'selected' : ''}>${escapeHTML(p.label)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <label class="form-label">状态</label>
          <div class="status-pick" id="f-status">
            ${['done','wip','p4','planned','blocked'].map(s => `
              <div class="status-opt ${c.status === s ? 'active' : ''}" data-status="${s}">${STATUS_LABELS[s]}</div>
            `).join('')}
          </div>
        </div>
      `,
      buttons: [
        ...(isNew ? [] : [{ label: '删除', variant: 'danger', close: false, onClick: () => {
          deleteCard(id);
          Modal.close();
        }}]),
        { label: '取消' },
        { label: isNew ? '新增' : '保存', variant: 'primary', onClick: el => {
            const title = el.querySelector('#f-title').value.trim();
            const sub   = el.querySelector('#f-sub').value.trim();
            const activityId = el.querySelector('#f-activity').value;
            const phaseId    = el.querySelector('#f-phase').value;
            const status     = el.querySelector('#f-status .status-opt.active')?.dataset.status || 'planned';
            if (!title) {
              Toast.error('标题不能为空');
              return false;
            }
            const movedColumn = !isNew && (() => {
              const orig = Store.get().story.cards.find(x => x.id === id);
              return orig && (orig.activityId !== activityId || orig.phaseId !== phaseId);
            })();
            Store.update(s => {
              if (isNew) {
                const ord = s.story.cards.filter(x => x.activityId === activityId && x.phaseId === phaseId).length;
                s.story.cards.push({ ...c, title, sub, activityId, phaseId, status, order: ord });
              } else {
                const i = s.story.cards.findIndex(x => x.id === id);
                if (i > -1) s.story.cards[i] = { ...s.story.cards[i], title, sub, activityId, phaseId, status };
              }
            });
            if (isNew || movedColumn) {
              render();
            } else {
              // patch card DOM in-place — no full re-render
              const cardEl = document.querySelector(`.card[data-id="${id}"]`);
              if (cardEl) {
                const updated = Store.get().story.cards.find(x => x.id === id);
                cardEl.dataset.status = status;
                cardEl.classList.toggle('card-starred', !!updated.starred);
                cardEl.querySelector('.card-title').textContent = title;
                const subEl = cardEl.querySelector('.card-sub');
                if (sub) {
                  if (subEl) subEl.textContent = sub;
                  else cardEl.querySelector('.card-actions').insertAdjacentHTML('beforebegin', `<div class="card-sub">${escapeHTML(sub)}</div>`);
                } else {
                  if (subEl) subEl.remove();
                }
              }
            }
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

  async function deleteCard(id) {
    const c = Store.get().story.cards.find(x => x.id === id);
    if (!c) return;
    const ok = await Modal.confirm({
      title: '删除故事卡',
      message: `确定删除 "${c.title}"？`,
      confirmLabel: '删除', danger: true, icon: '🗑'
    });
    if (!ok) return;
    Store.update(s => {
      s.story.cards = s.story.cards.filter(x => x.id !== id);
    });
    render();
    Toast.success('已删除');
  }

  function quickStatusMenu(id) {
    const c = Store.get().story.cards.find(x => x.id === id);
    if (!c) return;
    Modal.open({
      icon: '🎯', title: '快速修改状态', size: 'sm',
      bodyHTML: `
        <div class="status-pick" id="f-status">
          ${['done','wip','p4','planned','blocked'].map(s => `
            <div class="status-opt ${c.status === s ? 'active' : ''}" data-status="${s}">${STATUS_LABELS[s]}</div>
          `).join('')}
        </div>
        <div class="form-help" style="margin-top:10px">点击即可保存</div>
      `,
      onMount: el => {
        el.addEventListener('click', e => {
          const opt = e.target.closest('.status-opt');
          if (!opt) return;
          const s = opt.dataset.status;
          Store.update(state => {
            const card = state.story.cards.find(x => x.id === id);
            if (card) card.status = s;
          });
          render();
          Toast.success('状态已更新');
          Modal.close();
        });
      }
    });
  }

  function editActivity(id) {
    const isNew = !id;
    const state = Store.get();
    const a = isNew
      ? { id: Store.newId('act'), icon: '📌', name: '', sub: '' }
      : { ...state.story.activities.find(x => x.id === id) };
    if (!a) return;

    Modal.open({
      icon: a.icon || '📌', title: isNew ? '新增活动列' : '编辑活动列',
      bodyHTML: `
        <div class="form-row form-row-2col">
          <div>
            <label class="form-label">图标</label>
            <input class="form-input" id="f-icon" maxlength="4" value="${escapeHTML(a.icon)}">
          </div>
          <div>
            <label class="form-label">名称</label>
            <input class="form-input" id="f-name" value="${escapeHTML(a.name)}" placeholder="例如：查看地图">
          </div>
        </div>
        <div class="form-row">
          <label class="form-label">副标题（可选）</label>
          <input class="form-input" id="f-sub" value="${escapeHTML(a.sub || '')}" placeholder="例如：打开 App · 看周围情况">
        </div>
      `,
      buttons: [
        { label: '取消' },
        { label: isNew ? '新增' : '保存', variant: 'primary', onClick: el => {
            const data = {
              ...a,
              icon: el.querySelector('#f-icon').value.trim() || '📌',
              name: el.querySelector('#f-name').value.trim(),
              sub:  el.querySelector('#f-sub').value.trim()
            };
            if (!data.name) {
              Toast.error('名称不能为空');
              return false;
            }
            Store.update(s => {
              if (isNew) s.story.activities.push(data);
              else {
                const i = s.story.activities.findIndex(x => x.id === id);
                if (i > -1) s.story.activities[i] = data;
              }
            });
            render();
            Toast.success(isNew ? '已新增' : '已保存');
        } }
      ]
    });
  }

  async function deleteActivity(id) {
    const state = Store.get();
    const a = state.story.activities.find(x => x.id === id);
    if (!a) return;
    const cardCount = state.story.cards.filter(c => c.activityId === id).length;

    const ok = await Modal.confirm({
      title: '删除活动列',
      message: cardCount > 0
        ? `"${a.name}" 包含 ${cardCount} 张故事卡。删除会一并移除这些卡片，确定继续？`
        : `确定删除 "${a.name}"？`,
      confirmLabel: '删除', danger: true, icon: '🗑'
    });
    if (!ok) return;
    Store.update(s => {
      s.story.activities = s.story.activities.filter(x => x.id !== id);
      s.story.cards = s.story.cards.filter(c => c.activityId !== id);
    });
    render();
    Toast.success('已删除');
  }

  function editPhase(id) {
    const state = Store.get();
    const p = state.story.phases.find(x => x.id === id);
    if (!p) return;

    Modal.open({
      icon: '📋', title: '编辑阶段',
      bodyHTML: `
        <div class="form-row">
          <label class="form-label">阶段标签</label>
          <input class="form-input" id="f-label" value="${escapeHTML(p.label)}">
        </div>
        <div class="form-row">
          <label class="form-label">Sprint 描述</label>
          <input class="form-input" id="f-sprint" value="${escapeHTML(p.sprint || '')}">
        </div>
        <div class="form-row">
          <label class="form-label">状态颜色</label>
          <div class="status-pick" id="f-status">
            ${['done','wip','p4','planned','blocked'].map(s => `
              <div class="status-opt ${p.status === s ? 'active' : ''}" data-status="${s}">${STATUS_LABELS[s]}</div>
            `).join('')}
          </div>
        </div>
      `,
      buttons: [
        { label: '取消' },
        { label: '保存', variant: 'primary', onClick: el => {
            const label  = el.querySelector('#f-label').value.trim();
            const sprint = el.querySelector('#f-sprint').value.trim();
            const status = el.querySelector('#f-status .status-opt.active')?.dataset.status || p.status;
            if (!label) { Toast.error('标签不能为空'); return false; }
            Store.update(s => {
              const ph = s.story.phases.find(x => x.id === id);
              if (ph) { ph.label = label; ph.sprint = sprint; ph.status = status; }
            });
            render();
            Toast.success('已保存');
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

  return { render };
})();

window.ViewStory = ViewStory;
