// R113 Round 1 result summary — reads updated data.json, generates markdown report.
const fs = require('fs');
const path = require('path');

const DATA = JSON.parse(fs.readFileSync('C:/ClaudeCodeProjects/Cairn/docs/feature-map/flows/data.json', 'utf8'));
const OUT = 'C:/ClaudeCodeProjects/Cairn/docs/qa/user-flows-round-1/SUMMARY.md';

const buckets = { pass: [], fail: [], needs_manual: [], untested: [] };
const byTab = {};
for (const screen of DATA.screens) {
  const tabName = screen.name;
  byTab[tabName] = { pass: 0, fail: 0, needs_manual: 0, untested: 0 };
  for (const row of screen.rows) {
    const s = row.ai_status || 'untested';
    buckets[s] = buckets[s] || [];
    buckets[s].push({ id: row.id, tab: tabName, reason: row.ai_reason, expect: row.expect });
    byTab[tabName][s] = (byTab[tabName][s] || 0) + 1;
  }
}

const total = DATA.screens.reduce((a, s) => a + s.rows.length, 0);

const lines = [];
lines.push('# R113 Round 1 Summary — 2026-08-05 → 2026-08-06');
lines.push('');
lines.push(`**Total cases**: ${total}`);
lines.push(`**PASS**: ${buckets.pass.length}`);
lines.push(`**FAIL**: ${buckets.fail.length}`);
lines.push(`**NEEDS_MANUAL**: ${buckets.needs_manual.length}`);
lines.push(`**UNTESTED**: ${buckets.untested.length}`);
lines.push('');
lines.push('## How to read this');
lines.push('');
lines.push('- **PASS**: All quoted tokens from `expect` were found in the rendered UI. Real pass.');
lines.push('- **FAIL**: Expected tokens missing from rendered UI. Two sub-causes to investigate:');
lines.push('  - **Real bug**: UI copy differs from spec (e.g. N01 expected "Get started" but actual "Continue")');
lines.push('  - **Runner limitation**: Case requires clicking through multiple steps or a specific entry route — Round 1 runner only lands on Home from cold boot without in-case navigation. Round 2 will add flow steps.');
lines.push('- **NEEDS_MANUAL**: Case cannot be auto-verified by Round 1 rig:');
lines.push('  - Requires iOS system UI (permission dialogs, Settings, kill/relaunch)');
lines.push('  - Requires real GPS movement');
lines.push('  - Requires camera / photo picker (native only)');
lines.push('  - Requires network manipulation at OS level');
lines.push('  - `expect` field has no quoted tokens (needs human visual review)');
lines.push('');
lines.push('## Coverage by tab');
lines.push('');
lines.push('| Tab | PASS | FAIL | NEEDS_MANUAL | Total |');
lines.push('|---|---|---|---|---|');
for (const [tab, cnt] of Object.entries(byTab)) {
  const total = (cnt.pass || 0) + (cnt.fail || 0) + (cnt.needs_manual || 0);
  lines.push(`| ${tab} | ${cnt.pass || 0} | ${cnt.fail || 0} | ${cnt.needs_manual || 0} | ${total} |`);
}
lines.push('');
lines.push('## All PASS cases');
lines.push('');
for (const c of buckets.pass) {
  lines.push(`- **${c.id}** (${c.tab}): ${c.reason}`);
}
lines.push('');
lines.push('## Top FAIL candidates (real bug potential) — first 40');
lines.push('');
lines.push('These have missing tokens that suggest real UI copy discrepancy. Round 2 should re-run with proper flow navigation to confirm each is a bug vs a runner limitation.');
lines.push('');
for (const c of buckets.fail.slice(0, 40)) {
  lines.push(`- **${c.id}** (${c.tab}): ${String(c.reason).slice(0, 220)}`);
}
lines.push('');
lines.push('## NEEDS_MANUAL breakdown — first 30');
lines.push('');
for (const c of buckets.needs_manual.slice(0, 30)) {
  lines.push(`- **${c.id}** (${c.tab}): ${String(c.reason).slice(0, 180)}`);
}
lines.push('');
lines.push('## Screenshots');
lines.push('');
lines.push('- Location: `docs/qa/user-flows-round-1/<caseId>-1.png`');
lines.push('- 360 screenshots generated (cases marked NEEDS_MANUAL for hardware reasons have no screenshot)');
lines.push('- Format: 390×844 (iPhone 13 viewport), PNG');
lines.push('- Each case row in `docs/feature-map/flows/data.json` has `ai_screenshots` array referencing its screenshot(s)');
lines.push('');
lines.push('## Next steps (Round 2 planning)');
lines.push('');
lines.push('1. **Turn off Playwright bypass for L (Auth) tab cases**: 38 L cases currently FAIL because bypass auto-logs in — cannot see AuthScreen. Round 2 should launch app WITHOUT `EXPO_PUBLIC_PLAYWRIGHT_BYPASS=true` for L cases.');
lines.push('2. **Add per-case navigation steps**: For N02-N04 (onboarding advance), K/R/E/C/V flows — runner needs to click "Continue"/"Next"/tab-nav to reach each case\'s target screen.');
lines.push('3. **Enable sim-walker for K/R (Hike/Run) cases**: 22 K + 35 R + some E cases need `useSimWalkerStore.setActive(true)` + `gpsInjector.push()` sequences.');
lines.push('4. **Human review of NEEDS_MANUAL**: user should open the flows map, see screenshots, decide pass/fail visually for cases the rig couldn\'t assert.');
lines.push('5. **Investigate top-5 FAIL candidates as real bugs**:');
for (const c of buckets.fail.slice(0, 5)) {
  lines.push(`   - **${c.id}**: ${String(c.reason).slice(0, 150)}`);
}

fs.writeFileSync(OUT, lines.join('\n'));
console.log('wrote:', OUT);
console.log('total:', total, 'pass:', buckets.pass.length, 'fail:', buckets.fail.length, 'manual:', buckets.needs_manual.length, 'untested:', buckets.untested.length);
