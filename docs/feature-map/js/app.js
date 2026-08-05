/* ════════════════════════════════════════════════════════════
   app.js — Main controller (tabs + toolbar + init)
   ──────────────────────────────────────────────────────────── */

const App = (() => {
  const VIEWS = {
    'view-overview': () => ViewOverview.render(),
    'view-story':    () => ViewStory.render(),
    'view-planning': () => ViewPlanning.render(),
    'view-research': () => {}, // static iframe, no render needed
    'view-flows':    () => {}  // static iframe (flows/index.html), no render needed
  };

  let currentView = 'view-overview';
  const activeFilters = new Set();

  function init() {
    Store.init(DEFAULT_DATA);
    document.body.dataset.view = currentView;
    bindTabs();
    bindToolbar();
    bindLegendFilter();
    applyTheme();
    initTooltip();
    renderCurrentView();
  }

  function initTooltip() {
    const el = document.createElement('div');
    el.id = 'js-tooltip';
    document.body.appendChild(el);

    let showTimer = null;

    document.addEventListener('mouseover', e => {
      const target = e.target.closest('[data-tip]');
      if (!target) return;
      clearTimeout(showTimer);
      showTimer = setTimeout(() => {
        el.textContent = target.dataset.tip;
        el.classList.add('visible');
      }, 120);
    });

    document.addEventListener('mousemove', e => {
      if (!el.classList.contains('visible')) return;
      const x = e.clientX;
      const y = e.clientY;
      const tw = el.offsetWidth;
      const th = el.offsetHeight;
      // prefer above cursor, clamp to viewport
      const top = Math.max(4, y - th - 10);
      const left = Math.min(window.innerWidth - tw - 8, Math.max(4, x - tw / 2));
      el.style.left = left + 'px';
      el.style.top  = top + 'px';
    });

    document.addEventListener('mouseout', e => {
      const target = e.target.closest('[data-tip]');
      if (!target) return;
      clearTimeout(showTimer);
      el.classList.remove('visible');
    });
  }

  function bindTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => switchTo(tab.dataset.view));
    });
  }

  function switchTo(viewId, filterStatus) {
    if (!VIEWS[viewId]) return;
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.toggle('active', t.dataset.view === viewId);
    });
    document.querySelectorAll('.view').forEach(v => {
      v.classList.toggle('active', v.id === viewId);
    });
    currentView = viewId;
    document.body.dataset.view = viewId;
    VIEWS[viewId]();
    // If a filter status was requested, activate it
    if (filterStatus) {
      if (activeFilters.size > 0) activeFilters.clear();
      activeFilters.add(filterStatus);
      updateLegendUI();
      applyFilter();
    } else {
      applyFilter();
    }
    // Update scroll hint for story map
    const hint = document.getElementById('story-scroll-hint');
    if (hint) hint.classList.toggle('visible', false);
    if (viewId === 'view-story') updateScrollHint();
  }

  function renderCurrentView() {
    const fn = VIEWS[currentView];
    if (fn) fn();
  }

  function bindLegendFilter() {
    document.querySelectorAll('.legend-item[data-filter]').forEach(item => {
      item.addEventListener('click', () => {
        const status = item.dataset.filter;
        if (activeFilters.has(status)) {
          activeFilters.delete(status);
        } else {
          activeFilters.add(status);
        }
        updateLegendUI();
        applyFilter();
      });
    });
    const clearBtn = document.getElementById('legendClear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        activeFilters.clear();
        updateLegendUI();
        applyFilter();
      });
    }
  }

  function updateLegendUI() {
    const hasFilter = activeFilters.size > 0;
    document.body.classList.toggle('has-filter', hasFilter);
    document.querySelectorAll('.legend-item[data-filter]').forEach(item => {
      const active = activeFilters.has(item.dataset.filter);
      item.classList.toggle('active', active);
      item.classList.toggle('filter-inactive', hasFilter && !active);
    });
  }

  function applyFilter() {
    const hasFilter = activeFilters.size > 0;
    document.querySelectorAll('.card[data-status]').forEach(card => {
      card.classList.toggle('filter-hidden', hasFilter && !activeFilters.has(card.dataset.status));
    });
    // Reset story map scroll so left rail is always visible after filter change
    const storyView = document.getElementById('view-story');
    if (storyView) storyView.scrollLeft = 0;
  }

  let _scrollHintAbort = null;

  function updateScrollHint() {
    const storyView = document.getElementById('view-story');
    const hint = document.getElementById('story-scroll-hint');
    if (!storyView || !hint) return;
    // Cancel previous scroll listener before re-binding
    if (_scrollHintAbort) { _scrollHintAbort.abort(); }
    _scrollHintAbort = new AbortController();
    const signal = _scrollHintAbort.signal;
    // Click to scroll one column width
    hint.onclick = () => {
      storyView.scrollBy({ left: 220, behavior: 'smooth' });
    };
    // Double rAF ensures layout is complete after display:none→block transition
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const updateState = () => {
        const hasOverflow = storyView.scrollWidth > storyView.clientWidth + 4;
        const atEnd = storyView.scrollLeft + storyView.clientWidth >= storyView.scrollWidth - 20;
        const show = hasOverflow && !atEnd;
        hint.classList.toggle('visible', show);
        storyView.classList.toggle('scroll-end', !hasOverflow || atEnd);
      };
      updateState();
      // Pulse on first show
      const hasOverflow = storyView.scrollWidth > storyView.clientWidth + 4;
      if (hasOverflow) {
        hint.classList.add('pulse');
        hint.addEventListener('animationend', () => hint.classList.remove('pulse'), { once: true });
      }
      storyView.addEventListener('scroll', updateState, { passive: true, signal });
    }));
  }

  let editMode = false;

  function bindToolbar() {
    document.querySelectorAll('[data-toolbar]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.toolbar;
        if (action === 'help') return showHelp();
        if (action === 'edit-mode') return toggleEditMode();
        if (action === 'theme') return toggleTheme();
      });
    });
  }

  let lightMode = localStorage.getItem('cairn-theme') === 'light';

  const MOON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" fill="currentColor"/></svg>`;
  const SUN_SVG  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="5" fill="currentColor"/><line x1="12" y1="1" x2="12" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="21" x2="12" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="1" y1="12" x2="3" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="21" y1="12" x2="23" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

  function applyTheme() {
    document.body.classList.toggle('light-mode', lightMode);
    const btn = document.getElementById('themeBtn');
    if (btn) btn.innerHTML = lightMode ? MOON_SVG : SUN_SVG;
  }

  function toggleTheme() {
    lightMode = !lightMode;
    localStorage.setItem('cairn-theme', lightMode ? 'light' : 'dark');
    applyTheme();
    Toast.success(lightMode ? '已切换为白天模式' : '已切换为夜间模式');
  }

  function toggleEditMode() {
    editMode = !editMode;
    document.body.classList.toggle('edit-mode', editMode);
    const btn = document.getElementById('editModeBtn');
    if (btn) {
      btn.classList.toggle('active', editMode);
      btn.textContent = editMode ? '✎ 退出编辑' : '✎ 编辑';
    }
    Toast.success(editMode ? '已进入编辑模式' : '已退出编辑模式');
  }

  function showHelp() {
    Modal.open({
      icon: '❓', title: '使用帮助', size: 'lg',
      bodyHTML: `
        <div style="font-size:13px;line-height:1.7;color:var(--text2)">
          <h3 style="font-size:14px;color:var(--text);margin-bottom:6px">🎯 3 个视图</h3>
          <ul style="padding-left:20px;margin-bottom:14px">
            <li><strong>产品概览</strong>：项目介绍、用户画像、设计原则、进度统计</li>
            <li><strong>故事地图</strong>：用户活动 × 阶段的二维矩阵，看每个活动各阶段都在做什么</li>
            <li><strong>发布排期</strong>：把故事卡片排进 Release × Sprint 网格，调整每个 Sprint 要做什么</li>
          </ul>

          <h3 style="font-size:14px;color:var(--text);margin-bottom:6px">✏️ 编辑</h3>
          <ul style="padding-left:20px;margin-bottom:14px">
            <li>点击右上角 <strong>编辑</strong> 按钮进入编辑模式，显示所有编辑控件</li>
            <li><strong>双击</strong>任何卡片/原则/画像 → 打开编辑弹窗</li>
            <li><strong>右键</strong>任何卡片 → 上下文菜单（编辑/删除/快速改状态）</li>
            <li>每个区块都有 <strong>+ 新增</strong> 按钮</li>
          </ul>

          <h3 style="font-size:14px;color:var(--text);margin-bottom:6px">🖐 拖拽</h3>
          <ul style="padding-left:20px;margin-bottom:14px">
            <li>故事地图：拖拽卡片到任意活动列 + 阶段（自动改状态）</li>
            <li>发布排期：拖拽卡片到不同 Sprint 槽 / 调整 Release 整行顺序</li>
            <li>拖拽中按 <kbd>ESC</kbd> 取消</li>
          </ul>

          <h3 style="font-size:14px;color:var(--text);margin-bottom:6px">💾 数据</h3>
          <ul style="padding-left:20px">
            <li>所有修改自动保存到 <strong>data.js</strong>，刷新后永久保留</li>
            <li>直接编辑 <code>js/data.js</code> 也可以修改数据</li>
          </ul>
        </div>
      `,
      buttons: [{ label: '关闭', variant: 'primary' }]
    });
  }

  return { init, switchTo };
})();

window.App = App;

/* boot when DOM ready */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', App.init);
} else {
  App.init();
}
