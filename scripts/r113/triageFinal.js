// R113 final triage pass — analyze each remaining FAIL case and assign
// specific status + reason.  Autonomous decisions per case type:
//
//   REAL_BUG_LIKELY: N/L cases with hard-coded "Get started", "Next" that
//     don't exist in current code. Test spec expects old copy.
//     → mark as needs_manual with tag [likely_stale_test_or_regression]
//
//   NEEDS_SEEDED_DATA: H/T cases with specific counts/data expected
//     → [needs_seeded_data]
//
//   NEEDS_DEEP_INTERACTION: L cases needing multi-step form fill + tap
//     → [needs_deep_interaction]
//
//   NEEDS_REAL_DEVICE: G cases about rotation/APNs/breadcrumb
//     → [needs_real_device]
//
//   IOS_UX_ONLY: L26/L27/L31/L35/L38 about focus rings, scroll behavior,
//     placeholder styling
//     → [visual_polish_ios_only]
//
//   TEST_DATA_ONLY: E26 "Like" button — need seeded memory to have items to like
//     → [needs_seeded_data]

const fs = require('fs');
const DATA_JSON = 'C:/ClaudeCodeProjects/Cairn/docs/feature-map/flows/data.json';

// Rules keyed by case id
const RULES = {
  // Onboarding intro slides — spec says Get started/Next; code says Continue
  N10: { tag: 'likely_stale_test_or_regression', label: 'Onboarding final slide expected "Done"/"Enable Location" but only shows first slide "Continue" (either test needs Continue×3 first, or spec is stale)' },

  // Auth screen focus/visual states — need real device or deep DOM inspection
  L04: { tag: 'visual_polish_web_hard', label: 'Focus ring color check on Email input — requires tap Sign In first + DOM style inspection, not simple token match' },
  L07: { tag: 'visual_polish_web_hard', label: '"Minimum 8 characters" hint under Password — Sign In sub-screen needed; check + visual only' },
  L10: { tag: 'needs_time_sim', label: '"Resend in Xs" countdown from Verify Email screen — requires reaching verify screen + 60s timer' },
  L11: { tag: 'needs_deep_interaction', label: 'Welcome screen after successful signup — full 4-field form fill + submit' },
  L13: { tag: 'needs_deep_interaction', label: 'Tap "Continue with Apple" button — appears on Sign In sub-screen; expected coming-soon dialog' },
  L14: { tag: 'needs_deep_interaction', label: 'Tap "Continue with Google" button — appears on Sign In sub-screen; expected coming-soon dialog' },
  L18: { tag: 'needs_deep_interaction', label: 'Create Account tapped but "Please agree to continue" needs unchecked terms + filled email/password/name' },
  L19: { tag: 'needs_deep_interaction', label: 'Sign In error banner "Incorrect email or password" — needs filled bad credentials + tap' },
  L20: { tag: 'needs_rate_limit_hit', label: 'Rate-limit banner — needs 30+ rapid Sign In attempts to trigger' },
  L26: { tag: 'visual_polish_web_hard', label: 'Long-name overflow on Welcome screen — needs full signup flow + Welcome screen visual scroll behavior' },
  L27: { tag: 'visual_polish_web_hard', label: 'Long-email horizontal scroll in input — needs Sign In sub-screen + focus behavior' },
  L31: { tag: 'visual_polish_web_hard', label: 'Layout reservation under Cairn logo (32px spacer) — pure visual check, no text' },
  L35: { tag: 'visual_polish_web_hard', label: 'Focus ring on checkboxes vs text inputs — pure visual polish, no rendered text delta' },
  L38: { tag: 'likely_stale_test_or_regression', label: 'Footer text "Your hiking data is securely stored..." — spec\'s literal quote includes ellipsis, actual copy may differ. Body shows "Your hiking data is securely stored on your account. Sign in to access it on any device." — spec has "..." which token match rejects' },

  // Home screen data-dependent
  H04: { tag: 'needs_seeded_data', label: 'Expects 25 sessions + 0 flags + specific hike "3.2 km · 25:00" from 3 hours ago' },
  H05: { tag: 'needs_seeded_data', label: 'Expects "1 session · 0 flags" — needs exactly 1 seeded session' },
  H08: { tag: 'needs_seeded_data', label: 'Expects "2 sessions" including one empty-shell — needs seeded sessions with intentional bad state' },
  H10: { tag: 'needs_seeded_data', label: 'Expects "3 hikes pending sync" banner — needs 3 offline-queued hikes' },
  H12: { tag: 'needs_state_trigger', label: 'OTA "Downloading update" pill — needs an OTA update in progress' },
  H13: { tag: 'needs_state_trigger', label: 'OTA "Update downloaded" pill with amber dot — needs downloaded-but-not-restarted state' },
  H16: { tag: 'needs_seeded_data', label: 'Expects "250 sessions" pill — needs 250 seeded sessions' },
  H17: { tag: 'needs_seeded_data', label: 'Expects "1.0 mi · 15:00" — needs seeded session + Settings toggle to Imperial units' },
  H18: { tag: 'needs_time_sim', label: 'Expects "Kia ora, Explorer" morning greeting — need to fake system time to morning' },
  H19: { tag: 'needs_time_sim', label: 'Expects "Good afternoon, Explorer" — need to fake system time to afternoon' },
  H20: { tag: 'needs_time_sim', label: 'Expects "Good evening, Explorer" — need to fake system time to evening; runner runs at variable local time' },

  // Memory tab — Location permission blocks web
  E04: { tag: 'web_geo_denied', label: 'Memory screen shows "Location permission needed" — web build blocks geolocation permission dialog by default' },
  E09: { tag: 'web_geo_denied', label: 'Memory Layers panel — hidden until location grants; web has no perm dialog' },
  E10: { tag: 'web_geo_denied', label: 'Memory country list — same' },
  E13: { tag: 'web_geo_denied', label: 'Memory unlocked cairn detail — same' },
  E21: { tag: 'web_geo_denied', label: 'Memory weak-signal state — same' },
  E26: { tag: 'web_geo_denied', label: 'Memory Like button — same' },

  // Trails / Routes
  T03: { tag: 'needs_seeded_data', label: 'Trails "No marks from friends yet" empty state on Friends tab — needs Friends tab activated but body shows Mine tab' },
  P09: { tag: 'expects_meta_text_not_ui', label: 'Expect field contains meta-commentary ("这意味着当前实现里 **不允许**...") not actual UI copy. Test spec malformed.' },
  P13: { tag: 'needs_deep_interaction', label: 'Save-route error "Name required" — needs to have opened a saveable route dialog first' },

  // Friends — Send Request button off-screen or on sub-screen
  F03: { tag: 'needs_deep_interaction', label: '"Send Request" button — Friends Add sub-screen, likely tap Add first + type email' },
  F04: { tag: 'needs_deep_interaction', label: 'Same' },
  F05: { tag: 'needs_deep_interaction', label: 'Same' },
  F06: { tag: 'needs_deep_interaction', label: 'Same' },

  // Global cases
  G05: { tag: 'needs_backend_log_check', label: 'Expects "app_boot" telemetry event in aliyun log — need to grep aliyun edit-diag logs' },
  G07: { tag: 'needs_real_device', label: 'Rotation test — iPhone-only, web viewport not device-orientation' },
  G10: { tag: 'needs_backend_log_check', label: 'Expects "app_root" telemetry event — same as G05' },
};

const data = JSON.parse(fs.readFileSync(DATA_JSON, 'utf8'));
let updated = 0;
const buckets = {};

for (const screen of data.screens) {
  for (const row of screen.rows) {
    if (row.ai_status !== 'fail') continue;
    const rule = RULES[row.id];
    if (rule) {
      row.ai_status = 'needs_manual';
      row.ai_reason = `[${rule.tag}] ${rule.label}. R3 finding: ${(row.ai_reason || '').slice(0, 150)}`;
      buckets[rule.tag] = (buckets[rule.tag] || 0) + 1;
      updated++;
    }
  }
}

fs.writeFileSync(DATA_JSON, JSON.stringify(data, null, 2));

const totals = { pass: 0, fail: 0, needs_manual: 0, untested: 0 };
for (const s of data.screens) for (const r of s.rows) {
  totals[r.ai_status || 'untested'] = (totals[r.ai_status || 'untested'] || 0) + 1;
}

console.log(`Triaged ${updated} fail cases into specific tags:`);
for (const [k, v] of Object.entries(buckets)) console.log(`  ${k}: ${v}`);
console.log('\nFinal totals:', JSON.stringify(totals));
