/* ════════════════════════════════════════════════════════════
   view-planning.js — Page 3: Release × Sprint Planning Board
   ──────────────────────────────────────────────────────────────
   Page 3 has its own independent planning structure (state.planning),
   decoupled from state.timeline used by page 1/2.
   - Phase 1 starts at Sprint 60.
   - Phase rows: Phase 1 / Release 1.0 / Phase 2 / Release 2.0 / Phase 3 / Phase 4
   - Each row has 6 slots with editable labels (Sprint 60-65 / Hotfix 1.0.1-1.0.6).
   - Cards reference story.cards (edits sync back to page 2).
   ──────────────────────────────────────────────────────────── */

const ViewPlanning = (() => {

  const SLOTS_PER_ROW = 6;
  const STATUS_LABELS = {
    done: '完成', wip: '进行中', planned: '计划中', p4: '第4阶段', blocked: '阻塞'
  };

  let _cardDragDestroy = null;
  let _rowDragDestroy = null;
  let _showCompleted = localStorage.getItem('cairn-planning-show-completed') !== 'false';

  /* ─── Default planning structure (created on first visit) ─── */

  function defaultPlanningStructure() {
    return {
      releases: [
        {
          id: 'plr-p1', name: 'Phase 1', sub: '主线交付 · Sprint 60 起',
          color: 'var(--done)', kind: 'phase', order: 0,
          slotLabels: ['Sprint 60', 'Sprint 61', 'Sprint 62', 'Sprint 63', 'Sprint 64', 'Sprint 65']
        },
        {
          id: 'plr-r10', name: 'Release 1.0', sub: 'v1.0 修复批',
          color: 'var(--wip)', kind: 'release', order: 1,
          slotLabels: ['Hotfix 1.0.1', 'Hotfix 1.0.2', 'Hotfix 1.0.3', 'Hotfix 1.0.4', 'Hotfix 1.0.5', 'Hotfix 1.0.6']
        },
        {
          id: 'plr-p2', name: 'Phase 2', sub: '主线推进',
          color: 'var(--p4)', kind: 'phase', order: 2,
          slotLabels: ['Sprint 66', 'Sprint 67', 'Sprint 68', 'Sprint 69', 'Sprint 70', 'Sprint 71']
        },
        {
          id: 'plr-r20', name: 'Release 2.0', sub: 'v2.0 修复批',
          color: 'var(--wip)', kind: 'release', order: 3,
          slotLabels: ['Hotfix 2.0.1', 'Hotfix 2.0.2', 'Hotfix 2.0.3', 'Hotfix 2.0.4', 'Hotfix 2.0.5', 'Hotfix 2.0.6']
        },
        {
          id: 'plr-p3', name: 'Phase 3', sub: '远期规划',
          color: 'var(--plan)', kind: 'phase', order: 4,
          slotLabels: ['Sprint 72', 'Sprint 73', 'Sprint 74', 'Sprint 75', 'Sprint 76', 'Sprint 77']
        },
        {
          id: 'plr-p4', name: 'Phase 4', sub: 'v1.0 后 · 待评估',
          color: 'var(--sub)', kind: 'phase', order: 5,
          slotLabels: ['Sprint 78', 'Sprint 79', 'Sprint 80', 'Sprint 81', 'Sprint 82', 'Sprint 83']
        }
      ]
    };
  }

  /* ─── Status → planning release mapping (per user instruction) ─── */

  function autoAssignReleaseId(card) {
    // User's rule: "已经完成的都放在 phase1 里"
    if (card.status === 'done') return 'plr-p1';

    // Hard exceptions for known long-tail or release-1.0 phase items
    const exceptions = {
      'c-flag-ar2':    'plr-r10',  // Unity 重做（hotfix 性质）
      'c-sos-1':       'plr-p2',   // SOS 进 Phase 2 (NZ 化主推)
      'c-sos-contact': 'plr-p2',
      'c-sos-send':    'plr-p2',
      'c-sos-plan':    'plr-p2',
      'c-flag-voice':  'plr-p3',
      'c-flag-6th':    'plr-p3',
      'c-rec-edit':    'plr-p3',
      'c-rec-gpx':     'plr-p3',
      'c-fr-realtime': 'plr-p4',
      'c-set-personal':'plr-p4',
      'c-res-bg':      'plr-p4',
      'c-hike-watch':  'plr-p4'
    };
    if (exceptions[card.id]) return exceptions[card.id];

    switch (card.status) {
      case 'wip':     return 'plr-r10'; // 进行中 → v1.0 hotfix
      case 'p4':      return 'plr-p2';  // NZ 化 → Phase 2
      case 'planned': return 'plr-p3';  // 计划中 → Phase 3
      case 'blocked': return null;      // inbox
      default:        return null;
    }
  }

  function autoAssignAll(state) {
    const byRelease = {};
    state.story.cards.forEach(c => {
      if (c.planning && c.planning.releaseId !== undefined) return; // user already placed
      const rid = autoAssignReleaseId(c);
      if (!byRelease[rid]) byRelease[rid] = [];
      byRelease[rid].push(c);
    });

    Object.keys(byRelease).forEach(rid => {
      const cards = byRelease[rid];
      if (rid === 'null' || rid === null) {
        cards.forEach((c, i) => {
          c.planning = { releaseId: null, sprintIdx: null, planOrder: i };
        });
        return;
      }

      // Sort: starred first, then wip > p4 > planned > done > blocked
      const sorted = [...cards].sort((a, b) => {
        if ((b.starred ? 1 : 0) !== (a.starred ? 1 : 0)) return (b.starred ? 1 : 0) - (a.starred ? 1 : 0);
        const statusRank = { wip: 0, p4: 1, planned: 2, done: 3, blocked: 4 };
        const sr = (statusRank[a.status] ?? 5) - (statusRank[b.status] ?? 5);
        if (sr !== 0) return sr;
        return (a.activityId || '').localeCompare(b.activityId || '');
      });

      const perSlot = Math.max(1, Math.ceil(sorted.length / SLOTS_PER_ROW));
      sorted.forEach((c, i) => {
        const sprintIdx = Math.min(SLOTS_PER_ROW - 1, Math.floor(i / perSlot));
        const planOrder = i % perSlot;
        c.planning = { releaseId: rid, sprintIdx, planOrder };
      });
    });
  }

  function ensureInitialized(state) {
    let dirty = false;
    const isFirstVisit = !state.planning || !state.planning.releases || !Array.isArray(state.planning.releases) || state.planning.releases.length === 0;

    if (isFirstVisit) {
      // First visit: create default phase/release rows + auto-assign all cards by status
      Store.update(s => {
        s.planning = defaultPlanningStructure();
        autoAssignAll(s);
      }, { silent: true });
      return true;
    }

    // Subsequent visits: any card without `planning` is a NEW card added on page 2
    // Per user spec: send new/unrecognized cards to inbox (未分配), don't auto-assign by status.
    const newCards = state.story.cards.filter(c => !c.planning);
    if (newCards.length > 0) {
      Store.update(s => {
        const inboxPeers = s.story.cards
          .filter(c => c.planning && c.planning.releaseId == null)
          .sort((a, b) => (a.planning?.planOrder ?? 0) - (b.planning?.planOrder ?? 0));
        let nextOrder = inboxPeers.length;
        s.story.cards.forEach(c => {
          if (!c.planning) {
            c.planning = { releaseId: null, sprintIdx: null, planOrder: nextOrder++ };
          }
        });
      }, { silent: true });
      dirty = true;
    }
    return dirty;
  }

  /* ─── Render ─── */

  function render() {
    const root = document.getElementById('view-planning');
    if (!root) return;

    ensureInitialized(Store.get());

    const state = Store.get();
    const { cards } = state.story;
    const releases = [...state.planning.releases].sort((a, b) => a.order - b.order);

    let inbox = cards.filter(c => !c.planning || c.planning.releaseId == null);
    inbox = [...inbox].sort((a, b) => (a.planning?.planOrder ?? 0) - (b.planning?.planOrder ?? 0));

    let html = `
      <div class="pl-board">
        <div class="pl-toolbar">
          <div class="pl-toolbar-left">
            <span class="pl-toolbar-label">发布排期 · ${releases.length} 个 Release / Phase × ${SLOTS_PER_ROW} 槽位</span>
            <span class="pl-toolbar-hint">拖拽卡片排进槽位 · 拖拽 ⋮⋮ 调换行顺序 · 编辑模式下双击 phase 名 / 槽位标签可改名 · 双击卡片编辑（联动故事地图）</span>
          </div>
          <div class="pl-toolbar-right">
            <label class="pl-toggle" data-tip="${_showCompleted ? '隐藏已完成卡片' : '显示已完成卡片'}">
              <input type="checkbox" id="pl-show-completed" ${_showCompleted ? 'checked' : ''}>
              <span>显示已完成</span>
            </label>
          </div>
        </div>

        <div class="pl-inbox-row" data-kind="inbox-row">
          <div class="pl-row-label pl-inbox-label">
            <div class="pl-inbox-title">📥 未分配</div>
            <div class="pl-inbox-sub">待排期 · ${inbox.length}</div>
          </div>
          <div class="pl-inbox-cells" id="pl-inbox" data-release-id="" data-sprint-idx="-1">
            ${inbox.length === 0
              ? `<div class="pl-empty-hint">所有卡片已分配 · 拖拽卡片到此处可移回未分配</div>`
              : inbox.map(c => renderCard(c, state)).join('')
            }
          </div>
        </div>

        <div class="pl-releases" id="pl-releases">
          ${releases.map(r => renderReleaseRow(r, cards, state)).join('')}
        </div>
      </div>
    `;

    root.innerHTML = html;
    bindEvents(root);
    bindDrag(root);
    applyShowCompleted();
  }

  function renderReleaseRow(release, cards, state) {
    const releaseCards = cards.filter(c => c.planning && c.planning.releaseId === release.id);
    const isEmpty = releaseCards.length === 0;
    const cardCount = releaseCards.length;

    let slotsHtml = '';
    for (let i = 0; i < SLOTS_PER_ROW; i++) {
      const slotCards = releaseCards
        .filter(c => c.planning.sprintIdx === i)
        .sort((a, b) => (a.planning.planOrder ?? 0) - (b.planning.planOrder ?? 0));
      const slotLabel = (release.slotLabels && release.slotLabels[i]) || `槽位 ${i + 1}`;
      slotsHtml += `
        <div class="pl-slot" data-release-id="${release.id}" data-sprint-idx="${i}">
          <div class="pl-slot-header">
            <span class="pl-slot-label" data-action="edit-slot-label" data-release-id="${release.id}" data-slot-idx="${i}" data-tip="编辑模式下双击改名">${escapeHTML(slotLabel)}</span>
            <span class="pl-slot-count">${slotCards.length || '0'}</span>
          </div>
          <div class="pl-slot-body">
            ${slotCards.length === 0
              ? `<div class="pl-slot-empty">＋</div>`
              : slotCards.map(c => renderCard(c, state)).join('')
            }
          </div>
        </div>
      `;
    }

    return `
      <div class="pl-row ${isEmpty ? 'pl-row--empty' : ''}" data-release-id="${release.id}" data-kind="release-row">
        <div class="pl-row-label">
          <div class="pl-row-handle" data-tip="拖拽调整顺序">⋮⋮</div>
          <div class="pl-row-name" data-action="edit-release-name" data-release-id="${release.id}" data-tip="编辑模式下双击改名">${escapeHTML(release.name)}</div>
          <div class="pl-row-sprint" data-action="edit-release-sub" data-release-id="${release.id}" data-tip="编辑模式下双击改副标题">${escapeHTML(release.sub || (release.sub === '' ? '点击添加副标题' : ''))}</div>
          <div class="pl-row-card-count">${cardCount} 张卡片${isEmpty ? ' · 空 · 可拖卡进来' : ''}</div>
        </div>
        <div class="pl-row-cells">${slotsHtml}</div>
      </div>
    `;
  }

  function renderCard(c, state) {
    const activity = state.story.activities.find(a => a.id === c.activityId);
    const icon = activity ? activity.icon : '📌';
    return `
      <div class="card pl-card ${c.starred ? 'card-starred' : ''}" data-status="${c.status}" data-id="${c.id}" data-kind="card">
        <div class="card-status"></div>
        <div class="pl-card-icon">${icon}</div>
        <div class="card-title">${escapeHTML(c.title)}</div>
        ${c.sub ? `<div class="card-sub">${escapeHTML(c.sub)}</div>` : ''}
        <div class="card-actions">
          <button class="card-icon-btn" data-action="edit-card" data-id="${c.id}" data-tip="编辑（联动故事地图）">✏️</button>
        </div>
      </div>
    `;
  }

  /* ─── Events ─── */

  function bindEvents(root) {
    root.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      const toggle = e.target.closest('#pl-show-completed');

      if (toggle) {
        _showCompleted = toggle.checked;
        localStorage.setItem('cairn-planning-show-completed', _showCompleted);
        applyShowCompleted();
        return;
      }

      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'edit-card') return editCardLinked(btn.dataset.id);
    });

    root.addEventListener('dblclick', e => {
      const card = e.target.closest('.pl-card');
      const releaseName = e.target.closest('[data-action="edit-release-name"]');
      const releaseSub  = e.target.closest('[data-action="edit-release-sub"]');
      const slotLabel   = e.target.closest('[data-action="edit-slot-label"]');
      if (card) return editCardLinked(card.dataset.id);
      if (releaseName) return editReleaseName(releaseName.dataset.releaseId);
      if (releaseSub)  return editReleaseSub(releaseSub.dataset.releaseId);
      if (slotLabel) return editSlotLabel(slotLabel.dataset.releaseId, parseInt(slotLabel.dataset.slotIdx, 10));
    });

    root.addEventListener('contextmenu', e => {
      const card = e.target.closest('.pl-card');
      const releaseRow = e.target.closest('.pl-row');
      if (card) {
        ContextMenu.show(e, [
          { label: '编辑（联动故事地图）', icon: '✏️', onClick: () => editCardLinked(card.dataset.id) },
          { label: '快速改状态', icon: '🎯', onClick: () => quickStatusMenu(card.dataset.id) },
          { sep: true },
          { label: '移到未分配', icon: '📥', onClick: () => moveToInbox(card.dataset.id) },
          { sep: true },
          { label: '删除请到故事地图', icon: '🗑', onClick: () => Toast.info('删除卡片请到故事地图') }
        ]);
      } else if (releaseRow) {
        ContextMenu.show(e, [
          { label: '改名', icon: '✏️', onClick: () => editReleaseName(releaseRow.dataset.releaseId) },
          { label: '编辑副标题', icon: '📝', onClick: () => editReleaseSub(releaseRow.dataset.releaseId) }
        ]);
      }
    });
  }

  /* ─── Drag & Drop ─── */

  function bindDrag(root) {
    if (_cardDragDestroy) { _cardDragDestroy.destroy?.(); _cardDragDestroy = null; }
    if (_rowDragDestroy)  { _rowDragDestroy.destroy?.();  _rowDragDestroy = null; }

    _cardDragDestroy = DragDrop.bind({
      container: root,
      itemSelector: '.pl-card',
      containerSelector: '.pl-slot-body, .pl-inbox-cells',
      axis: 'y',
      onDrop: ({ itemId, toContainer, toIndex }) => {
        const isInbox = toContainer.classList.contains('pl-inbox-cells');
        let releaseId, sprintIdx;
        if (isInbox) {
          releaseId = null;
          sprintIdx = null;
        } else {
          const slot = toContainer.closest('.pl-slot');
          releaseId = slot.dataset.releaseId;
          sprintIdx = parseInt(slot.dataset.sprintIdx, 10);
        }
        Store.update(s => {
          const card = s.story.cards.find(c => c.id === itemId);
          if (!card) return;
          if (!card.planning) card.planning = {};
          card.planning.releaseId = releaseId;
          card.planning.sprintIdx = sprintIdx;
          const peers = s.story.cards
            .filter(c => c.id !== itemId
              && (c.planning?.releaseId ?? null) === (releaseId ?? null)
              && (c.planning?.sprintIdx ?? null) === (sprintIdx ?? null))
            .sort((a, b) => (a.planning?.planOrder ?? 0) - (b.planning?.planOrder ?? 0));
          peers.splice(toIndex, 0, card);
          peers.forEach((c, i) => {
            if (!c.planning) c.planning = {};
            c.planning.planOrder = i;
          });
        });
        render();
        const slot = !isInbox ? Store.get().planning.releases.find(r => r.id === releaseId) : null;
        const slotLabel = slot && slot.slotLabels && slot.slotLabels[sprintIdx]
          ? slot.slotLabels[sprintIdx]
          : `槽位 ${sprintIdx + 1}`;
        Toast.success(isInbox ? '已移到未分配' : `已移到 ${slotLabel}`);
      }
    });

    const releasesContainer = root.querySelector('#pl-releases');
    if (releasesContainer) {
      _rowDragDestroy = DragDrop.bind({
        container: releasesContainer,
        itemSelector: '.pl-row',
        containerSelector: '#pl-releases',
        handleSelector: '.pl-row-handle',
        axis: 'y',
        getItemId: el => el.dataset.releaseId,
        onDrop: ({ itemId, toIndex }) => {
          Store.update(s => {
            const arr = s.planning.releases;
            const idx = arr.findIndex(r => r.id === itemId);
            if (idx < 0) return;
            const [item] = arr.splice(idx, 1);
            arr.splice(toIndex, 0, item);
            arr.forEach((r, i) => r.order = i);
          });
          render();
          Toast.success('顺序已调整');
        }
      });
    }
  }

  /* ─── Edit handlers ─── */

  async function editReleaseName(id) {
    const r = Store.get().planning.releases.find(x => x.id === id);
    if (!r) return;
    const newName = await Modal.prompt({
      title: '编辑名称', label: 'Phase / Release 名称', initial: r.name, icon: '✏️'
    });
    if (newName == null) return;
    Store.update(s => {
      const t = s.planning.releases.find(x => x.id === id);
      if (t) t.name = newName;
    });
    render();
    Toast.success('已保存');
  }

  async function editReleaseSub(id) {
    const r = Store.get().planning.releases.find(x => x.id === id);
    if (!r) return;
    const v = await Modal.prompt({
      title: '编辑副标题', label: '副标题（可选）', initial: r.sub || '', icon: '📝'
    });
    if (v == null) return;
    Store.update(s => {
      const t = s.planning.releases.find(x => x.id === id);
      if (t) t.sub = v;
    });
    render();
    Toast.success('已保存');
  }

  async function editSlotLabel(releaseId, slotIdx) {
    const r = Store.get().planning.releases.find(x => x.id === releaseId);
    if (!r) return;
    const cur = (r.slotLabels && r.slotLabels[slotIdx]) || `槽位 ${slotIdx + 1}`;
    const v = await Modal.prompt({
      title: '编辑槽位标签', label: `${r.name} · 第 ${slotIdx + 1} 个槽位`, initial: cur, icon: '🏷'
    });
    if (v == null) return;
    Store.update(s => {
      const t = s.planning.releases.find(x => x.id === releaseId);
      if (!t) return;
      if (!Array.isArray(t.slotLabels)) t.slotLabels = [];
      while (t.slotLabels.length < SLOTS_PER_ROW) t.slotLabels.push('');
      t.slotLabels[slotIdx] = v;
    });
    render();
    Toast.success('已保存');
  }

  function editCardLinked(id) {
    const state = Store.get();
    const c = state.story.cards.find(x => x.id === id);
    if (!c) return;

    const acts = state.story.activities;
    const phs  = [...state.story.phases].sort((a, b) => a.order - b.order);

    Modal.open({
      icon: '🗂', title: '编辑故事卡（联动故事地图）', size: 'lg',
      bodyHTML: `
        <div class="form-row">
          <label class="form-label">标题</label>
          <input class="form-input" id="f-title" value="${escapeHTML(c.title)}">
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
            <label class="form-label">所属阶段（故事地图）</label>
            <select class="form-select" id="f-phase">
              ${phs.map(p => `<option value="${p.id}" ${c.phaseId === p.id ? 'selected' : ''}>${escapeHTML(p.label)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <label class="form-label" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
            <span>状态</span>
            <label style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:400;color:var(--sub);cursor:pointer">
              <input type="checkbox" id="f-starred" ${c.starred ? 'checked' : ''}> ★ 优先标记
            </label>
          </label>
          <div class="status-pick" id="f-status">
            ${['done','wip','p4','planned','blocked'].map(s => `
              <div class="status-opt ${c.status === s ? 'active' : ''}" data-status="${s}">${STATUS_LABELS[s]}</div>
            `).join('')}
          </div>
        </div>
        <div class="form-help" style="font-size:11px;color:var(--sub);margin-top:8px;padding:8px 10px;background:var(--surface2);border-radius:6px">
          💡 此处的修改会同步到「故事地图」。删除卡片请到故事地图操作。
        </div>
      `,
      buttons: [
        { label: '取消' },
        { label: '保存', variant: 'primary', onClick: el => {
            const title = el.querySelector('#f-title').value.trim();
            const sub   = el.querySelector('#f-sub').value.trim();
            const activityId = el.querySelector('#f-activity').value;
            const phaseId    = el.querySelector('#f-phase').value;
            const status     = el.querySelector('#f-status .status-opt.active')?.dataset.status || 'planned';
            const starred    = el.querySelector('#f-starred').checked;
            if (!title) { Toast.error('标题不能为空'); return false; }
            Store.update(s => {
              const i = s.story.cards.findIndex(x => x.id === id);
              if (i > -1) {
                s.story.cards[i] = { ...s.story.cards[i], title, sub, activityId, phaseId, status, starred };
              }
            });
            render();
            Toast.success('已保存（同步到故事地图）');
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
        <div class="form-help" style="margin-top:10px">点击即可保存（同步到故事地图）</div>
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

  function moveToInbox(id) {
    Store.update(s => {
      const card = s.story.cards.find(c => c.id === id);
      if (!card) return;
      if (!card.planning) card.planning = {};
      card.planning.releaseId = null;
      card.planning.sprintIdx = null;
      const peers = s.story.cards
        .filter(c => c.id !== id && (!c.planning || c.planning.releaseId == null))
        .sort((a, b) => (a.planning?.planOrder ?? 0) - (b.planning?.planOrder ?? 0));
      peers.unshift(card);
      peers.forEach((c, i) => {
        if (!c.planning) c.planning = {};
        c.planning.planOrder = i;
      });
    });
    render();
    Toast.success('已移到未分配');
  }

  function applyShowCompleted() {
    const root = document.getElementById('view-planning');
    if (!root) return;
    root.classList.toggle('pl-hide-completed', !_showCompleted);
  }

  return { render };
})();

window.ViewPlanning = ViewPlanning;
