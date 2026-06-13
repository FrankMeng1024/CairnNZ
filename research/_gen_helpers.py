PAINCARD_HELPERS = '''
  // ─────── pain-card helpers ───────
  function paincardHTML(pc) {
    const frames = pc.frames || [];
    return `
      <article class="pain-card pain-card-collapsible" data-id="${pc.id}" data-kind="paincard">
        <div class="pain-card-actions">
          <button class="card-icon-btn" data-action="edit-paincard" data-id="${pc.id}" data-tip="编辑">✏️</button>
          <button class="card-icon-btn danger" data-action="delete-paincard" data-id="${pc.id}" data-tip="删除">✕</button>
        </div>
        <header class="pain-card-summary">
          <div class="pain-card-meta">${escapeHTML(pc.meta || '')} — ${escapeHTML(pc.tagline || '')}</div>
          <span class="pain-card-toggle">悬停看完整故事 ↓</span>
        </header>
        <div class="pain-card-expand">
          <div class="pain-strip pain-strip-4">
            ${frames.map((f, i) => `
              <figure class="pain-frame">
                ${svgFor(pc.id, i)}
                <div class="pain-frame-title">${escapeHTML(f.title || '')}</div>
                <figcaption class="pain-frame-cap">${escapeHTML(f.text || '')}</figcaption>
              </figure>
            `).join('')}
          </div>
        </div>
      </article>
    `;
  }

  function svgFor(cardId, frameIdx) {
    const art = PAIN_ART[cardId];
    if (!art || !art[frameIdx]) {
      return '<svg viewBox="0 0 320 240" class="pain-svg"><rect width="320" height="240" fill="var(--surface2)"/></svg>';
    }
    return art[frameIdx];
  }

'''

with open('C:/ClaudeCodeProjects/Cairn/research/_paincard_helpers.js', 'w', encoding='utf-8') as f:
    f.write(PAINCARD_HELPERS)
print('OK')
