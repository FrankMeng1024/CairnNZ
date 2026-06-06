/* ════════════════════════════════════════════════════════════
   dragdrop.js — Pointer Events drag/drop with insert indicator
   ──────────────────────────────────────────────────────────── */

const DragDrop = (() => {

  /**
   * Make a container draggable-friendly.
   *
   * @param {object} opts
   * @param {HTMLElement} opts.container - the parent that holds draggable children
   * @param {string} opts.itemSelector   - selector for draggable items inside container
   * @param {string} opts.containerSelector - selector to identify "valid drop containers" (cross-container drag)
   * @param {string} [opts.handleSelector]  - if set, drag only starts on this child element
   * @param {string} [opts.axis]            - 'x' | 'y' (default 'y')
   * @param {(payload)=>void} opts.onDrop  - called with { itemId, fromContainerId, toContainerId, toIndex, itemEl }
   * @param {(itemEl)=>string} [opts.getItemId]
   * @param {(containerEl)=>string} [opts.getContainerId]
   * @param {(itemEl)=>string} [opts.getGhostText] - text for floating ghost
   * @param {boolean} [opts.allowReorder=true]
   * @param {boolean} [opts.allowCrossContainer=true]
   */
  function bind(opts) {
    const {
      container,
      itemSelector,
      containerSelector,
      handleSelector,
      axis = 'y',
      onDrop,
      getItemId      = el => el.dataset.id,
      getContainerId = el => el.id || el.dataset.id,
      getGhostText   = el => el.querySelector('.card-title, .feat-text, .tl-item-text')?.textContent || el.textContent.slice(0, 40),
      allowReorder = true,
      allowCrossContainer = true,
      indicatorClass = 'drop-indicator'
    } = opts;

    let active = null; // { itemEl, ghost, startX, startY, fromContainer, indicatorEl, currentContainer, currentIndex }
    let pointerDownInfo = null;
    let rafId = null;          // requestAnimationFrame handle for throttling
    let pendingMove = null;    // last pointermove coords waiting for RAF
    let containerRects = null; // cached rects, rebuilt once per drag

    container.addEventListener('pointerdown', onPointerDown);

    function onPointerDown(e) {
      if (e.button !== 0) return; // primary only
      const itemEl = e.target.closest(itemSelector);
      if (!itemEl || !container.contains(itemEl)) return;

      // ignore if click on action button
      if (e.target.closest('.card-icon-btn, .feat-actions, .tl-item-actions, .modal, button, input, textarea, select, .module-toggle')) return;

      // optional handle constraint
      if (handleSelector) {
        const handle = e.target.closest(handleSelector);
        if (!handle) return;
      }

      pointerDownInfo = {
        itemEl,
        startX: e.clientX,
        startY: e.clientY,
        pointerId: e.pointerId,
        fired: false
      };

      // capture early so we get pointermove/up
      try { itemEl.setPointerCapture(e.pointerId); } catch(_) {}

      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup',   onPointerUp,   { once: true });
      document.addEventListener('pointercancel', onPointerCancel, { once: true });
      document.addEventListener('keydown', onKeyDown);
    }

    function onPointerMove(e) {
      if (!pointerDownInfo) return;

      // start threshold (checked immediately, before RAF)
      if (!active) {
        const dx = Math.abs(e.clientX - pointerDownInfo.startX);
        const dy = Math.abs(e.clientY - pointerDownInfo.startY);
        if (dx < 5 && dy < 5) return;

        startDrag(pointerDownInfo.itemEl, e);
        if (!active) return;
      }

      // Throttle via RAF — only process one move per animation frame
      pendingMove = { x: e.clientX, y: e.clientY };
      if (rafId === null) {
        rafId = requestAnimationFrame(processPendingMove);
      }
    }

    function processPendingMove() {
      rafId = null;
      if (!active || !pendingMove) return;
      const { x, y } = pendingMove;
      pendingMove = null;

      // move ghost — anchor at the original grab offset so the cursor stays where the user pressed down
      const ox = active.ghost._offsetX ?? 0;
      const oy = active.ghost._offsetY ?? 0;
      active.ghost.style.left = (x - ox) + 'px';
      active.ghost.style.top  = (y - oy) + 'px';

      // find drop target using cached rects
      updateDropTarget(x, y);

      // auto-scroll
      autoScroll(x, y);
    }

    function startDrag(itemEl, e) {
      const fromContainer = itemEl.closest(containerSelector);
      const rect = itemEl.getBoundingClientRect();
      itemEl.classList.add('dragging');

      // Use a true clone of the item as ghost — visually identical, follows cursor under the same offset
      const ghost = itemEl.cloneNode(true);
      ghost.classList.remove('dragging');
      ghost.classList.add('drag-ghost');
      ghost.style.position = 'fixed';
      ghost.style.pointerEvents = 'none';
      ghost.style.zIndex = '9999';
      ghost.style.width  = rect.width  + 'px';
      ghost.style.height = rect.height + 'px';
      ghost.style.left = rect.left + 'px';
      ghost.style.top  = rect.top  + 'px';
      // Cache offset so the ghost stays anchored where the user grabbed it
      ghost._offsetX = e.clientX - rect.left;
      ghost._offsetY = e.clientY - rect.top;
      document.body.appendChild(ghost);

      // Cache container rects once at drag start — avoids repeated getBoundingClientRect on every move
      const els = Array.from(document.querySelectorAll(containerSelector))
        .filter(c => container.contains(c) || c === container);
      containerRects = els.map(c => ({ el: c, rect: c.getBoundingClientRect() }));

      active = { itemEl, ghost, fromContainer, currentContainer: null, currentIndex: -1, indicatorEl: null };
      document.body.style.cursor = 'grabbing';
    }

    function updateDropTarget(x, y) {
      // Use cached rects — O(n) without DOM queries
      let target = null;
      for (const { el, rect } of (containerRects || [])) {
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          target = el;
          break;
        }
      }

      if (!target) {
        clearIndicator();
        active.currentContainer = null;
        active.currentIndex = -1;
        return;
      }
      if (!allowCrossContainer && target !== active.fromContainer) {
        clearIndicator();
        active.currentContainer = null;
        return;
      }

      // find insert index by scanning items
      const siblings = Array.from(target.querySelectorAll(`:scope > ${itemSelector}, :scope ${itemSelector}`))
        .filter(el => el.parentNode === target && el !== active.itemEl);

      let insertBefore = null;
      let insertIndex = siblings.length;

      for (let i = 0; i < siblings.length; i++) {
        const sib = siblings[i];
        const r = sib.getBoundingClientRect();
        const mid = axis === 'y' ? (r.top + r.height / 2) : (r.left + r.width / 2);
        const cursor = axis === 'y' ? y : x;
        if (cursor < mid) {
          insertBefore = sib;
          insertIndex = i;
          break;
        }
      }

      // place indicator
      placeIndicator(target, insertBefore, axis);
      active.currentContainer = target;
      active.currentIndex = insertIndex;
      active.insertBefore = insertBefore;
    }

    function placeIndicator(target, beforeEl, axis) {
      clearIndicator();
      const ind = document.createElement('div');
      ind.className = indicatorClass;
      if (axis === 'x') {
        ind.style.width = '2px';
        ind.style.height = 'auto';
        ind.style.alignSelf = 'stretch';
        ind.style.margin = '0 -3px';
      }
      if (beforeEl) {
        target.insertBefore(ind, beforeEl);
      } else {
        // insert after last item but before any "add" button placeholder
        const addBtn = target.querySelector('.sm-col-add, .module-body-add, .tl-add');
        if (addBtn) {
          target.insertBefore(ind, addBtn);
        } else {
          target.appendChild(ind);
        }
      }
      active.indicatorEl = ind;
    }

    function clearIndicator() {
      if (active && active.indicatorEl) {
        active.indicatorEl.remove();
        active.indicatorEl = null;
      }
    }

    function clearAllIndicators() {
      clearIndicator();
      // clean up any strays (only called on drop/cancel, not every frame)
      document.querySelectorAll('.' + indicatorClass).forEach(el => el.remove());
    }

    function autoScroll(x, y) {
      const margin = 60;
      const speed = 12;
      // vertical
      if (y < margin) window.scrollBy(0, -speed);
      else if (y > window.innerHeight - margin) window.scrollBy(0, speed);
      // horizontal — find scrollable parent
      let p = document.elementFromPoint(x, y);
      while (p && p !== document.body) {
        const cs = getComputedStyle(p);
        if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && p.scrollWidth > p.clientWidth) {
          if (x < margin) p.scrollBy(-speed, 0);
          else if (x > window.innerWidth - margin) p.scrollBy(speed, 0);
          break;
        }
        p = p.parentElement;
      }
    }

    function onPointerUp(e) {
      cleanup();
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      pendingMove = null;
      containerRects = null;
      if (!active) {
        pointerDownInfo = null;
        return;
      }

      const a = active;
      const wasDropped = a.currentContainer && (allowReorder || a.currentContainer !== a.fromContainer);

      if (wasDropped) {
        const itemId = getItemId(a.itemEl);
        const fromId = getContainerId(a.fromContainer);
        const toId   = getContainerId(a.currentContainer);
        let toIndex  = a.currentIndex;

        // adjust index if moving within same container and original position was before insert point
        if (a.fromContainer === a.currentContainer) {
          const sibs = Array.from(a.fromContainer.querySelectorAll(`:scope > ${itemSelector}, :scope ${itemSelector}`))
            .filter(el => el.parentNode === a.fromContainer);
          const origIdx = sibs.indexOf(a.itemEl);
          if (origIdx > -1 && origIdx < toIndex) toIndex--;
        }

        try {
          onDrop({
            itemId,
            fromContainerId: fromId,
            toContainerId: toId,
            toIndex,
            itemEl: a.itemEl,
            fromContainer: a.fromContainer,
            toContainer: a.currentContainer
          });
        } catch (err) {
          console.error('[DragDrop] onDrop error:', err);
        }
      }

      a.itemEl.classList.remove('dragging');
      a.ghost.remove();
      clearAllIndicators();
      active = null;
      pointerDownInfo = null;
      document.body.style.cursor = '';
    }

    function onPointerCancel() { cancelDrag(); }
    function onKeyDown(e) {
      if (e.key === 'Escape') cancelDrag();
    }

    function cancelDrag() {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      pendingMove = null;
      containerRects = null;
      if (active) {
        active.itemEl.classList.remove('dragging');
        active.ghost.remove();
        clearAllIndicators();
        active = null;
      }
      pointerDownInfo = null;
      cleanup();
      document.body.style.cursor = '';
    }

    function cleanup() {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('keydown', onKeyDown);
    }

    return { destroy: () => container.removeEventListener('pointerdown', onPointerDown) };
  }

  return { bind };
})();

window.DragDrop = DragDrop;
