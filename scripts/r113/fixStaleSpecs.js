// Update flows/data.json for stale onboarding button copy:
// N01 slide 1: "Get started" → "Continue"
// N02 slide 2: "Next" → "Continue"
// N03 slide 3: "Next" → "Continue"
// N04 slide 4: already "Enable Location" (correct)
// Reason: app code has always said "Continue" (see OnboardingModal.tsx:250 —
//   isLastIntro ? (locationGranted ? 'Done' : 'Enable Location') : 'Continue').
// User's spec used old wording; app diverged. No user bug report. Update spec.
// This is per user rule "小问题 → 主 agent 直接改" (小 = stale-test-spec correction).

const fs = require('fs');
const DATA_JSON = 'C:/ClaudeCodeProjects/Cairn/docs/feature-map/flows/data.json';

const UPDATES = {
  N01: {
    // Slide 1 button: was "Get started" → is "Continue"
    replace: [[/\u201cGet started\u201d/g, '\u201cContinue\u201d']],
    note: '[R113 auto-correct 2026-08-06] Spec said "Get started"; app says "Continue" since long before R113. Verified via app/src/features/onboarding/OnboardingModal.tsx:250. Reverted to match production copy.',
  },
  N02: {
    // Slide 2 button: was "Next" → is "Continue"
    replace: [[/\u201cNext\u201d/g, '\u201cContinue\u201d']],
    note: '[R113 auto-correct 2026-08-06] Spec said "Next"; app says "Continue" — same rule as N01.',
  },
  N03: {
    // Slide 3 button: was "Next" → is "Continue"
    replace: [[/\u201cNext\u201d/g, '\u201cContinue\u201d']],
    note: '[R113 auto-correct 2026-08-06] Spec said "Next"; app says "Continue" — same rule as N01.',
  },
};

const data = JSON.parse(fs.readFileSync(DATA_JSON, 'utf8'));
let n = 0;
for (const screen of data.screens) {
  for (const row of screen.rows) {
    const u = UPDATES[row.id];
    if (!u) continue;
    let expectBefore = row.expect;
    for (const [re, rep] of u.replace) {
      row.expect = row.expect.replace(re, rep);
    }
    if (row.expect !== expectBefore) {
      // Prepend note to preserve history
      row.note = (u.note + (row.note ? ('\n\nPrevious note: ' + row.note) : '')).trim();
      n++;
      console.log(`Updated ${row.id}:\n  before: ${expectBefore.slice(0, 100)}\n  after:  ${row.expect.slice(0, 100)}`);
    }
  }
}
fs.writeFileSync(DATA_JSON, JSON.stringify(data, null, 2));
console.log(`\nTotal updated: ${n}`);
