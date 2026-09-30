#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const argument = name => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const root = path.resolve(argument('--root') || '_review/Cairn_SnapLab_Final_Review');
const output = path.resolve(argument('--output') || path.join(root, 'SNAP_TEST_ATLAS.html'));
const evidenceRoots = (argument('--evidence') || '_working/web-smoke-hike,_working/web-smoke')
  .split(',')
  .map(value => path.resolve(root, value.trim()));

const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');
const relative = file => path.relative(path.dirname(output), file).split(path.sep).join('/');

const cards = [];
for (const evidenceRoot of evidenceRoots) {
  const resultPath = path.join(evidenceRoot, 'RESULT.json');
  const snapshotPath = path.join(evidenceRoot, 'QA_ACTIVITY_SNAPSHOTS.json');
  if (!fs.existsSync(resultPath) || !fs.existsSync(snapshotPath)) continue;
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  const snapshots = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  for (const journey of result.results ?? []) {
    const prefix = journey.mode === 'running' ? 'run' : 'hike';
    const snapshot = snapshots.find(value => value.activityId === journey.activityId) ?? null;
    const screenshots = fs.existsSync(path.join(evidenceRoot, 'screenshots'))
      ? fs.readdirSync(path.join(evidenceRoot, 'screenshots'))
        .filter(name => name.startsWith(`${prefix}-`) && name.endsWith('.png'))
        .sort()
        .map(name => path.join(evidenceRoot, 'screenshots', name))
      : [];
    cards.push({
      platform: result.platform ?? 'UNKNOWN',
      mode: journey.mode,
      activityId: journey.activityId,
      caseId: snapshot?.context?.caseId ?? 'manual-replay',
      profileId: snapshot?.context?.profileId ?? 'interactive',
      networkCondition: snapshot?.context?.networkCondition ?? 'offline',
      selectedSource: journey.selectedSource ?? 'unknown',
      selectedFingerprint: journey.selectedFingerprint ?? null,
      routeSnapshotCount: journey.routeSnapshotCount ?? 0,
      screenshotPaths: screenshots,
      resultPath,
      snapshotPath,
      result: 'PASS_IN_DECLARED_SCOPE',
    });
  }
}

const cardHtml = cards.map((card, index) => `
  <article class="card" data-mode="${escapeHtml(card.mode)}" data-result="${card.result}" data-evidence="actual-app">
    <header><span>${escapeHtml(card.mode.toUpperCase())}</span><strong>${escapeHtml(card.caseId)}</strong></header>
    <p>${escapeHtml(card.platform)} · ${escapeHtml(card.profileId)} · ${escapeHtml(card.networkCondition)}</p>
    <dl>
      <div><dt>QA Activity</dt><dd>${escapeHtml(card.activityId)}</dd></div>
      <div><dt>Selected</dt><dd>${escapeHtml(card.selectedSource)} · ${escapeHtml(card.selectedFingerprint)}</dd></div>
      <div><dt>QA Route snapshots</dt><dd>${card.routeSnapshotCount}</dd></div>
    </dl>
    <div class="strip">${card.screenshotPaths.map((image, imageIndex) => `
      <a href="${escapeHtml(relative(image))}" title="Open full resolution"><img loading="lazy" src="${escapeHtml(relative(image))}" alt="${escapeHtml(card.mode)} actual app checkpoint ${imageIndex + 1}"></a>
    `).join('')}</div>
    <p class="links"><a href="${escapeHtml(relative(card.resultPath))}">Run receipt</a> · <a href="${escapeHtml(relative(card.snapshotPath))}">QA Activity snapshot</a></p>
  </article>
`).join('');

const missingMatrix = cards.length < 48;
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cairn Snap Lab — offline test atlas</title>
<style>
:root{color-scheme:light;--ink:#203126;--muted:#66736a;--paper:#f6f3e9;--card:#fffdf7;--line:#d9d7ca;--green:#365d42;--amber:#8a5a14}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.45 system-ui,-apple-system,sans-serif}main{max-width:1440px;margin:auto;padding:28px}h1{font:650 30px/1.1 Georgia,serif;margin:0 0 6px}.sub{color:var(--muted);max-width:850px}.notice{border:1px solid #ddbd78;background:#fff5db;padding:12px 14px;border-radius:12px;color:#5e4311;margin:18px 0}.filters{display:flex;gap:10px;margin:18px 0}.filters select{padding:8px;border:1px solid var(--line);border-radius:8px;background:white}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(480px,1fr));gap:18px}.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:15px;box-shadow:0 6px 24px #2031260b}.card header{display:flex;gap:12px;align-items:center}.card header span{font-size:11px;letter-spacing:.12em;color:var(--green)}.card header strong{font-size:18px}.card p{color:var(--muted)}dl{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}dl div{border-top:1px solid var(--line);padding-top:7px;min-width:0}dt{font-size:11px;color:var(--muted)}dd{margin:2px 0;overflow:hidden;text-overflow:ellipsis}a{color:var(--green)}.strip{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:12px}.strip a{aspect-ratio:390/844;background:#252525;border-radius:7px;overflow:hidden}.strip img{width:100%;height:100%;object-fit:contain;display:block}.links{font-size:12px}.empty{padding:30px;border:1px dashed var(--line);border-radius:12px}@media(max-width:620px){main{padding:16px}.grid{grid-template-columns:1fr}.strip{grid-template-columns:repeat(3,1fr)}dl{grid-template-columns:1fr}}
</style></head><body><main>
<h1>Cairn Snap Lab</h1><p class="sub">Offline evidence atlas. Every image below is an <strong>EXPO_WEB_ACTUAL_APP</strong> capture from the normal recording, Finish, Activity Detail, cold-reopen, and QA Route-snapshot flow. It is not native verification.</p>
${missingMatrix ? '<div class="notice"><strong>Incomplete acceptance atlas — NOT A RELEASE VERDICT.</strong> The authoritative contracts/CASE_MATRIX.json and audit/OPEN_EVIDENCE_AUDIT.json were not present in the supplied filesystem. The required 48 primary UI journeys and 96 secondary logical journeys were not invented or silently replaced.</div>' : ''}
<div class="filters"><label>Mode <select id="mode"><option value="all">All</option><option value="hiking">Hike</option><option value="running">Run</option></select></label><label>Evidence <select id="evidence"><option value="all">All</option><option value="actual-app">Actual app</option></select></label></div>
<section class="grid" id="grid">${cardHtml || '<p class="empty">No completed evidence records were found.</p>'}</section>
<script>for(const id of ['mode','evidence'])document.getElementById(id).addEventListener('change',()=>{const m=document.getElementById('mode').value,e=document.getElementById('evidence').value;for(const card of document.querySelectorAll('.card'))card.hidden=!((m==='all'||card.dataset.mode===m)&&(e==='all'||card.dataset.evidence===e));});</script>
</main></body></html>`;

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, html);
process.stdout.write(`${JSON.stringify({ output, cardCount: cards.length, matrixComplete: !missingMatrix }, null, 2)}\n`);
