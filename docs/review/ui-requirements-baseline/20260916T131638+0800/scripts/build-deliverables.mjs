#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const runDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(runDir, '../../../..');
const runId = path.basename(runDir);
const priorDir = path.join(repoRoot, 'docs/review/product-system-v1-audit');
const capturePath = path.join(runDir, 'visual/capture-results.json');
const capture = JSON.parse(fs.readFileSync(capturePath, 'utf8'));

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const hashFile = file => sha256(fs.readFileSync(file));
const rel = file => path.relative(repoRoot, file).replaceAll(path.sep, '/');
const write = (file, value) => fs.writeFileSync(path.join(runDir, file), value.endsWith('\n') ? value : `${value}\n`);
const iso = capture.captured_at;

function command(args) {
  return execFileSync(args[0], args.slice(1), { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const [headers, ...body] = rows.filter(parts => parts.some(value => value !== ''));
  return body.map(parts => Object.fromEntries(headers.map((header, index) => [header, parts[index] ?? ''])));
}

const priorCapabilities = parseCsv(fs.readFileSync(path.join(priorDir, 'CAPABILITY_MATRIX.csv'), 'utf8'));

const inspectedFiles = [
  '/Users/mzm/Desktop/CAIRN_REQUIREMENTS_UI_BASELINE_AUDIT_PROMPT_EN.md',
  path.join(repoRoot, 'AGENTS.md'),
  path.join(repoRoot, 'docs/VISUAL_SYSTEM.md'),
  path.join(repoRoot, 'docs/VISUAL_MIGRATION_STATE.md'),
  path.join(repoRoot, 'docs/VISUAL_ASSET_MANIFEST.json'),
  path.join(repoRoot, 'docs/CAIRNNZ_VISUAL_DNA.md'),
  path.join(repoRoot, 'docs/VISUAL_NORTH_STAR_LOCK.md'),
  path.join(repoRoot, 'app/App.tsx'),
  path.join(repoRoot, 'app/src/navigation/RootNavigator.tsx'),
  path.join(repoRoot, 'app/src/screens/HikingScreen.tsx'),
  path.join(repoRoot, 'app/src/screens/RunningScreen.tsx'),
  path.join(repoRoot, 'app/src/screens/RoutesScreen.tsx'),
  path.join(repoRoot, 'app/src/screens/MapHistoryScreen.tsx'),
  path.join(repoRoot, 'app/src/screens/RouteEditorScreen.tsx'),
  path.join(repoRoot, 'app/src/screens/PlantScreen.tsx'),
  path.join(repoRoot, 'app/src/screens/MarkerDetailScreen.tsx'),
  path.join(repoRoot, 'app/src/features/memory/screens/MemoryScreen.tsx'),
  path.join(repoRoot, 'app/src/features/memory/components/MemoryMap.tsx'),
  path.join(repoRoot, 'app/src/features/memory/components/CairnPinsLayer.tsx'),
  path.join(repoRoot, 'app/src/screens/SettingsScreen.tsx'),
  path.join(repoRoot, 'app/src/components/activity/ActivityRecordingChrome.tsx'),
  path.join(repoRoot, 'app/src/components/tokens.ts'),
  path.join(repoRoot, 'app/src/hooks/useVisualTheme.ts'),
  path.join(repoRoot, 'app/src/hooks/useScenicTimeState.ts'),
  path.join(repoRoot, 'app/src/store/useTrackingStore.ts'),
  path.join(repoRoot, 'app/src/store/useRouteStore.ts'),
  path.join(repoRoot, 'app/src/store/useMarkerStore.ts'),
  path.join(repoRoot, 'app/src/features/memory/services/mapboxAdapter.ts'),
  path.join(repoRoot, 'app/eas.json'),
  path.join(repoRoot, 'backend/src/routes/account.js'),
  path.join(repoRoot, 'backend/src/routes/memory-subscriptions.js'),
  '/Users/mzm/Desktop/Cairn_Blueprint_Review/00_README.md',
  '/Users/mzm/Desktop/Cairn_Blueprint_Review/01_PRODUCT_SUPPLEMENT_v0.9.1.md',
  '/Users/mzm/Desktop/Cairn_Blueprint_Review/03_NZ_BETA_RESEARCH_BRIEF.md',
  '/Users/mzm/Desktop/Cairn_Blueprint_Review/CAIRN_PRODUCT_SYSTEM_BLUEPRINT_v0.9.md',
  path.join(repoRoot, 'docs/qa/visual-migration/final/product-unity-board.jpg'),
  path.join(repoRoot, 'docs/qa/visual-migration/final/day-night-board.jpg'),
  path.join(repoRoot, 'docs/qa/visual-migration/final/weather-board.jpg'),
  path.join(repoRoot, 'docs/review/global-visual-audit-2026-09-04/runtime-overview/cross-page-system-review-board.jpg'),
  path.join(repoRoot, 'docs/review/global-visual-audit-2026-09-04/runtime-details/centralized-detail-convergence-board.jpg'),
  path.join(repoRoot, 'app/_review/trails-personal-library/trails-after-themes-and-states.jpg'),
  path.join(repoRoot, 'app/_review/settings-product-dna/settings-product-dna-board.jpg'),
].filter(fs.existsSync);

const sourceInventory = inspectedFiles.map(file => ({
  evidence_id: `SRC-${String(inspectedFiles.indexOf(file) + 1).padStart(3, '0')}`,
  path: file.startsWith(repoRoot) ? rel(file) : file,
  sha256: hashFile(file),
  read_scope: 'FULL_OR_RELEVANT_SECTIONS_AS_RECORDED_IN_AUDIT',
}));

const missingMaterials = [
  { path: 'CairnNZ_Project_Authority.md', status: 'NOT_FOUND_IN_BOUNDED_SEARCH', effect: 'No replacement authority was inferred.' },
  { path: '/Users/mzm/Desktop/Cairn_v1_0_Handoff/', status: 'MISSING', effect: 'Optional context only; audit continued.' },
  { path: '/Users/mzm/Desktop/CAIRN_PAGE_LED_EXECUTION_PLAN_v1.1.md', status: 'MISSING', effect: 'Optional context only; audit continued.' },
  { path: '/Users/mzm/Desktop/CAIRN_PRODUCT_SYSTEM_BLUEPRINT_v0.9.md', status: 'MISSING_AT_NAMED_ROOT', effect: 'A copy inside Cairn_Blueprint_Review was inspected as candidate design.' },
];

const dimensions = (overrides = {}) => ({
  current_source: 'YES',
  user_reachability: 'PARTIAL',
  automated_proof: 'PARTIAL',
  deployed_match: 'UNKNOWN',
  device_loaded: 'UNKNOWN',
  real_field_validation: 'UNKNOWN',
  visual_evidence_level: 'EXISTING_COMPONENT_WITH_FIXTURE',
  dna_alignment: 'PARTIAL',
  user_acceptance: 'NOT_CONFIRMED',
  user_acceptance_source: 'No explicit page-level acceptance evidence found.',
  known_open_issues: [],
  test_scope_limitations: ['Fixture/source proof is not deployed, native-device, field, or user-acceptance proof.'],
  ...overrides,
});

function req(config) {
  return {
    requirement_id: config.id,
    parent_capability_ids: config.parents,
    user_need: config.need,
    requirement: config.requirement ?? config.need,
    decision_status: config.decisionStatus,
    decision_source: {
      classification: config.classification,
      reference: config.source,
      note: config.sourceNote ?? '',
    },
    primary_page_or_shared_owner: config.owner,
    secondary_affected_pages: config.secondary ?? [],
    current_behavior: config.current,
    gap_type: config.gap,
    proposed_disposition: config.disposition,
    evidence_dimensions: dimensions(config.evidence),
    dependencies: config.dependencies ?? [],
    dependency_classification: config.dependencyClass ?? 'REUSE_EXISTING',
    candidate_slice: config.slice,
    acceptance_criteria: config.criteria,
    evidence_ids: config.evidenceIds ?? [],
    open_question: config.question ?? null,
  };
}

const requirements = [
  req({ id: 'RQ-REL-001', parents: ['REL-01'], need: 'The owner can identify the exact client candidate before reviewing it.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'AUDIT_RECOMMENDATION', source: 'Full task §15 and §16', owner: 'Shared release identity', secondary: ['Settings', 'Home', 'Hike', 'Run'], current: 'Home contains O56 and Settings exposes app/build versions, but ordinary UI does not expose the Expo update ID; publication does not prove device loading.', gap: 'INSUFFICIENT_EVIDENCE', disposition: 'CURRENT_SLICE', slice: 'CARD-01 — first iPhone Hike/Run evidence review', criteria: ['Record O56, app 0.2.6, build 56, and where possible the installed Expo update ID before testing.'], evidence: { current_source: 'YES', user_reachability: 'YES', automated_proof: 'PARTIAL', deployed_match: 'YES', visual_evidence_level: 'SOURCE_ONLY', dna_alignment: 'MATCH' }, evidenceIds: ['DEP-001', 'SRC-002'] }),
  req({ id: 'RQ-AUTH-001', parents: ['AUTH-01'], need: 'Home, Friends, and Auth remain bounded accepted visual references and ordinary entry foundations.', decisionStatus: 'ACCEPTED_CURRENT_CONTRACT', classification: 'ACCEPTED_AUTHORITY', source: 'Full task §4 and docs/VISUAL_SYSTEM.md', owner: 'Auth/Home/Friends', current: 'Normal auth gate and Home entries exist; these pages were used as reference only.', gap: 'KEEP_ACCEPTED_REFERENCE', disposition: 'KEEP_NO_CHANGE', slice: 'Shared regression guard only', criteria: ['Future shared changes do not regress accepted Home/Friends/Auth rendering or entry paths.'], evidence: { user_reachability: 'YES', deployed_match: 'PARTIAL', dna_alignment: 'MATCH', user_acceptance: 'PARTIAL', user_acceptance_source: 'Accepted reference scope only; not a new whole-page pass.' }, evidenceIds: ['SRC-003', 'SRC-006'] }),
  req({ id: 'RQ-ACT-001', parents: ['ACT-01'], need: 'A hiker can start, pause, resume, finish, and durably save a truthful Activity.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'EXPLICIT_USER_DECISION', source: 'Full task §4 and §15', owner: 'Hike', secondary: ['Activity Detail', 'Trails', 'Memory'], current: 'Shared Activity stack, WAL/recovery, offline save, and visible recording chrome are present; current native/device/NZ field outcome is unverified.', gap: 'DEVICE_ACCEPTANCE_GAP', disposition: 'CURRENT_SLICE', slice: 'CARD-01 — first iPhone Hike/Run evidence review', criteria: ['On the identified iPhone build, start/pause/resume/finish remain operable in Day/Sunset/Night and Activity Detail opens after finish.'], evidence: { user_reachability: 'YES', automated_proof: 'YES', deployed_match: 'PARTIAL', real_field_validation: 'PARTIAL', visual_evidence_level: 'EXISTING_COMPONENT_WITH_FIXTURE', dna_alignment: 'PARTIAL', user_acceptance: 'PARTIAL', user_acceptance_source: 'Latest owner feedback says Hike/Run have not all been accepted.' }, evidenceIds: ['TEST-001', 'VIS-001', 'VIS-002', 'HIST-001'] }),
  req({ id: 'RQ-ACT-002', parents: ['ACT-02'], need: 'A runner can start, pause, resume, finish, and durably save a truthful Activity with Run-appropriate priorities.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'EXPLICIT_USER_DECISION', source: 'Full task §4 and §15', owner: 'Run', secondary: ['Activity Detail', 'Trails', 'Memory'], current: 'Run shares the Activity stack and prioritizes live pace/distance/time; current native startup pace and field truth remain unverified.', gap: 'DEVICE_ACCEPTANCE_GAP', disposition: 'CURRENT_SLICE', slice: 'CARD-01 — first iPhone Hike/Run evidence review', criteria: ['On the identified iPhone build, startup pace is not misleading, controls remain operable, and finish reaches the same Activity Detail contract.'], evidence: { user_reachability: 'YES', automated_proof: 'YES', deployed_match: 'PARTIAL', real_field_validation: 'PARTIAL', user_acceptance: 'PARTIAL', user_acceptance_source: 'Latest owner feedback says Hike/Run have not all been accepted.' }, evidenceIds: ['TEST-001', 'VIS-003', 'VIS-004', 'HIST-001'] }),
  req({ id: 'RQ-ACT-003', parents: ['ACT-01', 'ACT-02'], need: 'Hike and Run share consistent lifecycle semantics while retaining different information priorities.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'EXPLICIT_USER_DECISION', source: 'Full task §4', owner: 'Shared ActivityRecordingChrome/lifecycle', secondary: ['Hike', 'Run'], current: 'Both screens use ActivityRecordingChrome and shared tracking state; fixture captures show the common ready/recording dock.', gap: 'ACCEPTANCE_NOT_CONFIRMED', disposition: 'CURRENT_SLICE', slice: 'CARD-01 — first iPhone Hike/Run evidence review', criteria: ['Pause/Resume/Finish semantics match across both modes; Hike and Run metric priorities remain distinct.'], evidence: { user_reachability: 'YES', automated_proof: 'YES', dna_alignment: 'MATCH', user_acceptance: 'PARTIAL', user_acceptance_source: 'Shared behavior exists but current physical interaction is not accepted.' }, evidenceIds: ['TEST-001', 'VIS-001', 'VIS-003'] }),
  req({ id: 'RQ-ACT-004', parents: ['ACT-01', 'ACT-02'], need: 'Opening Finish and then cancelling preserves the exact prior lifecycle; paused remains paused.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'EXPLICIT_USER_DECISION', source: 'Full task §4 historical field symptoms', owner: 'Shared Activity finish intent', secondary: ['Hike', 'Run'], current: 'Regular finish confirmation snapshots state and cancel preserves it in source/tests. The too-short Continue path explicitly resumes a paused Activity, which is a separate inconsistency.', gap: 'IMPLEMENTATION_DEFECT', disposition: 'CURRENT_SLICE', slice: 'CARD-01 review; future repair only if reproduced/confirmed', criteria: ['Tracking→Finish→Cancel remains tracking.', 'Paused→Finish→Cancel remains paused.', 'Too-short Continue behavior is explicitly reviewed rather than assumed correct.'], evidence: { automated_proof: 'YES', user_acceptance: 'NOT_CONFIRMED', known_open_issues: ['TooShortSheet Continue calls resume when the Activity was paused.'] }, evidenceIds: ['TEST-001', 'SRC-010', 'SRC-011'] }),
  req({ id: 'RQ-ACT-005', parents: ['ACT-01', 'ACT-02'], need: 'Repeated Resume cannot duplicate work, and GPS recovery never locks Back or Finish.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'EXPLICIT_USER_DECISION', source: 'Full task §4 historical field symptoms', owner: 'Shared Activity lifecycle', secondary: ['Hike', 'Run'], current: 'Single-flight/epoch guards and focused tests exist; physical recovery and background behavior are not current-device proven.', gap: 'DEVICE_AND_FIELD_EVIDENCE_GAP', disposition: 'CURRENT_SLICE', slice: 'CARD-01 — first iPhone Hike/Run evidence review', criteria: ['Rapid repeated Resume produces one recovery transition.', 'Back and Finish remain available during degraded/recovering states.', 'Timer and subsequent movement recover together.'], evidence: { automated_proof: 'YES', real_field_validation: 'PARTIAL', known_open_issues: ['Historical bad run/wrong2 symptoms require current device verification.'] }, evidenceIds: ['TEST-001', 'HIST-001'] }),
  req({ id: 'RQ-ACT-006', parents: ['ACT-01', 'ACT-02', 'MEM-01', 'DIAG-01'], need: 'Raw, Canonical, Live, Final, display, planned, friend, and simulated geometry never masquerade as one another.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'EXPLICIT_USER_DECISION', source: 'Full task §4 and §13', owner: 'Shared Activity truth contract', secondary: ['Memory', 'Route Editor', 'Activity Detail', 'Diagnostics'], current: 'Source distinguishes several layers and simulator provider state, but Memory evidence provenance is not persisted per point and Route provenance is lost on server round-trip.', gap: 'SHARED_DATA_CONTRACT_GAP', disposition: 'LATER_SLICE', slice: 'Activity truth/data-contract slice after page acceptance', criteria: ['Every displayed geometry has an explicit source role.', 'Simulation cannot be counted as real exploration.', 'Persisted records preserve required provenance.'], evidence: { current_source: 'PARTIAL', user_reachability: 'PARTIAL', automated_proof: 'YES', deployed_match: 'PARTIAL', visual_evidence_level: 'SOURCE_ONLY' }, dependencies: ['Persisted provenance design', 'Existing activity contract tests'], dependencyClass: 'PRODUCT_DECISION_REQUIRED', evidenceIds: ['TEST-001', 'SRC-025', 'SRC-026'] }),
  req({ id: 'RQ-ACT-007', parents: ['ACT-01', 'ACT-02', 'ROUTE-02'], need: 'Final/Snap can remove noise but never invent traversal across a true GPS Gap.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'EXPLICIT_USER_DECISION', source: 'Full task §4', owner: 'Final geometry pipeline', secondary: ['Activity Detail', 'Route Editor'], current: 'Gap-aware source/tests exist; there is no proven durable reconnect worker that survives relaunch and long offline periods.', gap: 'STATE_WITHOUT_DURABLE_WORKER', disposition: 'LATER_SLICE', slice: 'Activity Detail truth/recovery slice', criteria: ['A true Gap remains visible until an explicit Route-only reconnect.', 'Any later enhancement executor is durable and truthfully described.'], evidence: { automated_proof: 'YES', deployed_match: 'PARTIAL', real_field_validation: 'PARTIAL', visual_evidence_level: 'SOURCE_ONLY' }, dependencies: ['Durable work/executor decision'], dependencyClass: 'NARROW_PREREQUISITE', evidenceIds: ['TEST-001', 'DEP-002'] }),
  req({ id: 'RQ-ACT-008', parents: ['ACT-01', 'ACT-02', 'MAP-01'], need: 'Historical wrong2, something run, bad run, Sunset/Night, and attribution-collision symptoms retain a current evidence boundary.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'EXPLICIT_USER_DECISION', source: 'Full task §4 historical field symptoms', owner: 'Hike/Run review', current: 'Source/test mitigations exist and a historical native Run screenshot shows a functioning map and controls, but the symptoms were not reproduced or cleared on the current identified candidate.', gap: 'INSUFFICIENT_CURRENT_DEVICE_EVIDENCE', disposition: 'CURRENT_SLICE', slice: 'CARD-01 — first iPhone Hike/Run evidence review', criteria: ['Return current Day/Sunset/Night screenshots and exact version identity.', 'Record whether each symptom reproduces without declaring old reports false.'], evidence: { current_source: 'PARTIAL', automated_proof: 'PARTIAL', real_field_validation: 'PARTIAL', visual_evidence_level: 'HISTORICAL_SCREENSHOT', known_open_issues: ['Six Desktop/54 images appear to be historical urban Run captures; five are near-duplicates and none proves current O56/NZ behavior.'] }, evidenceIds: ['HIST-001', 'VIS-001'] }),
  req({ id: 'RQ-ACTD-001', parents: ['ACT-03'], need: 'A finished or historical Activity opens one truthful Activity Detail with route state, sync state, and Cairns.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'EXPLICIT_USER_DECISION', source: 'Full task §3, §8, and §9', owner: 'Activity Detail (MapHistory object branch)', secondary: ['Hike', 'Run', 'Trails'], current: 'Normal finish and Trails rows navigate by Activity/client ID to MapHistory. Source and Expo Web fallback visuals exist; native/device/user acceptance does not.', gap: 'PAGE_ACCEPTANCE_AND_NATIVE_EVIDENCE_GAP', disposition: 'LATER_SLICE', slice: 'Page sequence 2 — Activity Detail', criteria: ['Newly finished and historical rows resolve to the same detail contract.', 'Native route/Cairn/map legal controls do not collide.', 'Truth and sync states match actual durability.'], evidence: { user_reachability: 'YES', deployed_match: 'PARTIAL', visual_evidence_level: 'EXISTING_COMPONENT_WITH_FIXTURE', dna_alignment: 'PARTIAL' }, evidenceIds: ['VIS-019', 'VIS-026', 'VIS-033', 'SRC-013'] }),
  req({ id: 'RQ-ACTD-002', parents: ['ACT-03'], need: 'Back from Activity Detail returns predictably to the originating journey without object-family confusion.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'AUDIT_RECOMMENDATION', source: 'Full task §9 required journeys', owner: 'Activity Detail navigation', secondary: ['Trails', 'Hike', 'Run'], current: 'Both finish and Trails target MapHistory; direct fixture routing proves component presence only.', gap: 'NAVIGATION_ACCEPTANCE_GAP', disposition: 'LATER_SLICE', slice: 'Page sequence 2 — Activity Detail', criteria: ['Finish landing and Trails row landing are equivalent.', 'Back returns to expected prior page in both journeys.'], evidence: { user_reachability: 'YES', automated_proof: 'PARTIAL', visual_evidence_level: 'SOURCE_ONLY' }, evidenceIds: ['SRC-013', 'SRC-012'] }),
  req({ id: 'RQ-ACTD-003', parents: ['ACT-03', 'ROUTE-02'], need: 'Activity Detail distinguishes local save, server sync, final refinement, and Route readiness without unsupported promises.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'EXPLICIT_USER_DECISION', source: 'Full task §4 and §13', owner: 'Activity Detail state surface', current: 'A state surface exists and tests cover labels; no durable reconnect Final worker is proven.', gap: 'STATE_WITHOUT_DURABLE_WORKER', disposition: 'LATER_SLICE', slice: 'Page sequence 2 — Activity Detail', criteria: ['Every state label maps to a real executor or user action.', 'Retry is real where displayed.', 'No promise of automatic enhancement without durable work.'], evidence: { current_source: 'PARTIAL', user_reachability: 'YES', automated_proof: 'YES', deployed_match: 'PARTIAL' }, dependencies: ['Final worker truth decision'], dependencyClass: 'PRODUCT_DECISION_REQUIRED', evidenceIds: ['TEST-001', 'VIS-019'] }),
  req({ id: 'RQ-TRAIL-001', parents: ['ROUTE-01', 'ACT-03', 'CAIRN-03'], need: 'Trails keeps the accepted Activities/Routes primary structure without Mine/Friends tiers or an equal Cairns tab.', decisionStatus: 'ACCEPTED_CURRENT_CONTRACT', classification: 'ACCEPTED_AUTHORITY', source: 'Full task §4 explicit core boundaries', owner: 'Trails', current: 'Current screen has Activities and Routes tabs only. All Cairns is not present.', gap: 'KEEP_ACCEPTED_IA', disposition: 'KEEP_NO_CHANGE', slice: 'Regression guard for later Trails integration', criteria: ['Activities/Routes remains the primary Trails structure.', 'All Cairns, if approved, is not silently added as an equal Trails tab.'], evidence: { user_reachability: 'YES', automated_proof: 'YES', deployed_match: 'PARTIAL', visual_evidence_level: 'EXISTING_COMPONENT_WITH_FIXTURE', dna_alignment: 'MATCH', user_acceptance: 'PARTIAL', user_acceptance_source: 'Only the IA structure is explicitly accepted; the whole page is not.' }, evidenceIds: ['TEST-001', 'VIS-013', 'VIS-014'] }),
  req({ id: 'RQ-TRAIL-002', parents: ['ROUTE-01', 'ACT-03'], need: 'Activity and Route search covers the intended full history, not merely the currently loaded subset.', decisionStatus: 'UNRESOLVED', classification: 'AUDIT_RECOMMENDATION', source: 'Full task §13', owner: 'Trails retrieval/search', current: 'Search filters arrays already in memory. Session storage caps locally at 500; route/session APIs do not prove pagination. A 300-item test proves grouping/virtualization only.', gap: 'RETRIEVAL_COMPLETENESS_GAP', disposition: 'NEEDS_PRODUCT_DECISION', slice: 'Page sequence 5 — Trails integration', criteria: ['Define retained history and pagination.', 'Search explicitly states local vs server scope.', 'Large-list proof includes retrieval, not only rendering.'], evidence: { current_source: 'PARTIAL', user_reachability: 'YES', automated_proof: 'PARTIAL', visual_evidence_level: 'EXISTING_COMPONENT_WITH_FIXTURE' }, dependencies: ['History retention/product decision', 'Paginated API if full history required'], dependencyClass: 'PRODUCT_DECISION_REQUIRED', evidenceIds: ['TEST-001', 'VIS-013'] }),
  req({ id: 'RQ-TRAIL-003', parents: ['ACT-03', 'ROUTE-01'], need: 'Trails rows and post-create flows reach the same canonical Activity/Route Details.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'AUDIT_RECOMMENDATION', source: 'Full task §9', owner: 'Trails/detail integration', secondary: ['Activity Detail', 'Route Detail', 'Route Editor'], current: 'Trails rows reach MapHistory details. Save as Route resets to RouteEditor view mode rather than the canonical Route Detail branch.', gap: 'INCONSISTENT_DESTINATION', disposition: 'LATER_SLICE', slice: 'Page sequence 5 after Route work', criteria: ['Every object family has one canonical detail contract.', 'Create/reopen/list journeys converge.', 'Back destinations are explicit.'], evidence: { user_reachability: 'PARTIAL', automated_proof: 'PARTIAL', dna_alignment: 'PARTIAL' }, evidenceIds: ['SRC-012', 'SRC-013', 'SRC-014'] }),
  req({ id: 'RQ-ROUTE-001', parents: ['ROUTE-01'], need: 'A user can list, search, open, rename, delete, and use their Route with honest failure feedback.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'IMPLEMENTATION_FACT', source: 'Current RoutesScreen/MapHistory source; full task §8', owner: 'Route Detail', secondary: ['Trails', 'Route Editor', 'Hike', 'Run'], current: 'Normal Trails row reachability exists. Rename is not awaited/caught; delete navigates back immediately while async work continues. Direct unknown IDs have no targeted load/not-found state.', gap: 'IMPLEMENTATION_DEFECT', disposition: 'LATER_SLICE', slice: 'Page sequence 4 — Route Detail/Editor/Use', criteria: ['Rename/delete failure remains visible and recoverable.', 'Direct/stale IDs show loading/not-found.', 'Successful mutation persists across reopen.'], evidence: { user_reachability: 'YES', automated_proof: 'PARTIAL', deployed_match: 'PARTIAL', visual_evidence_level: 'EXISTING_COMPONENT_WITH_FIXTURE', dna_alignment: 'PARTIAL' }, evidenceIds: ['VIS-020', 'SRC-013'] }),
  req({ id: 'RQ-ROUTE-002', parents: ['ROUTE-02'], need: 'A finalized Activity can create a new Route without changing the original Activity.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'EXPLICIT_USER_DECISION', source: 'Full task §4 and §9', owner: 'Activity Detail → Route Editor', secondary: ['Route Detail', 'Trails'], current: 'Save as Route creates a transient draft, editor changes the draft, and outer Save persists. After new Save, navigation lands in RouteEditor view mode, not canonical Route Detail.', gap: 'INCONSISTENT_DESTINATION', disposition: 'LATER_SLICE', slice: 'Page sequence 4 — Route Detail/Editor/Use', criteria: ['Original Activity remains immutable.', 'New Route persists and reopens.', 'Successful creation lands on the agreed canonical Route Detail.'], evidence: { user_reachability: 'YES', automated_proof: 'YES', deployed_match: 'UNKNOWN', dna_alignment: 'PARTIAL' }, evidenceIds: ['TEST-001', 'SRC-014'] }),
  req({ id: 'RQ-ROUTE-003', parents: ['ROUTE-03'], need: 'Route origin, version, and walked/planned segment distinctions survive server round-trip and fresh-device reopen.', decisionStatus: 'CANDIDATE_AWAITING_DECISION', classification: 'CANDIDATE_DESIGN', source: 'Full task §4 future requirements; Cairn Blueprint v0.9 Route sections', owner: 'Route data contract', secondary: ['Route Editor', 'Route Detail', 'Activity Detail'], current: 'Local route extras include originalPoints/segments, but backend persistence retains points/waypoints/distance/elevation/permission without durable provenance/version/walked-planned semantics.', gap: 'BACKEND_SCHEMA_GAP', disposition: 'NEEDS_PRODUCT_DECISION', slice: 'Prerequisite decision before relaxing Route editing limits', criteria: ['Approved semantics are explicit.', 'Required provenance survives server/export/fresh device.', 'Edited geometry is not presented as wholly walked.'], evidence: { current_source: 'PARTIAL', user_reachability: 'NO', automated_proof: 'PARTIAL', deployed_match: 'NO', device_loaded: 'NO', real_field_validation: 'NO', visual_evidence_level: 'SOURCE_ONLY' }, dependencies: ['Product decision', 'Schema/API change later'], dependencyClass: 'PRODUCT_DECISION_REQUIRED', evidenceIds: ['DEP-003', 'SRC-027'] }),
  req({ id: 'RQ-ROUTE-004', parents: ['ROUTE-04'], need: 'Use for Hike/Run truthfully distinguishes a displayed reference line from active following/voice guidance.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'IMPLEMENTATION_FACT', source: 'Current source plus full task §5 and §13', owner: 'Route Detail → Hike/Run handoff', current: 'Use selects routeId and shows a pre-start reference line. setFollowingRoute has no normal production caller; useRouteFollowing remains dormant.', gap: 'MISSING_WIRING_OR_COPY_SCOPE', disposition: 'KEEP_NO_CHANGE', slice: 'Keep current map-reference promise; active following is later decision', criteria: ['Current copy does not imply active turn-by-turn following.', 'Any future active following has a normal caller and field proof.'], evidence: { current_source: 'YES', user_reachability: 'PARTIAL', automated_proof: 'YES', deployed_match: 'PARTIAL', visual_evidence_level: 'EXISTING_COMPONENT_WITH_FIXTURE', dna_alignment: 'PARTIAL' }, evidenceIds: ['SRC-027', 'TEST-001'] }),
  req({ id: 'RQ-ROUTE-005', parents: ['ROUTE-01', 'ROUTE-02'], need: 'Route Editor Save/Cancel/Delete/Edit have durable, truthful outcomes and visible errors.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'AUDIT_RECOMMENDATION', source: 'Full task §9 action trace', owner: 'Route Editor', secondary: ['Route Detail', 'Trails'], current: 'View/edit modes and two-stage draft/save exist. Web map is unavailable; gear has a TODO handler; delete has no catch; outer Save creates/updates.', gap: 'IMPLEMENTATION_DEFECT', disposition: 'LATER_SLICE', slice: 'Page sequence 4 — Route Detail/Editor/Use', criteria: ['Save/Cancel semantics are unambiguous.', 'Delete/save failures remain on screen with retry.', 'No visible no-op control.'], evidence: { user_reachability: 'YES', automated_proof: 'PARTIAL', visual_evidence_level: 'EXISTING_COMPONENT_WITH_FIXTURE', dna_alignment: 'PARTIAL', known_open_issues: ['Gear control is a no-op TODO.', 'Web renderer shows Map unavailable.'] }, evidenceIds: ['VIS-021', 'VIS-028', 'VIS-035', 'SRC-014'] }),
  req({ id: 'RQ-ROUTE-006', parents: ['ROUTE-02', 'ROUTE-03'], need: 'Explicit reconnect or true-Gap edits affect only the new Route, never silently rewrite the Activity.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'EXPLICIT_USER_DECISION', source: 'Full task §4 and §9', owner: 'Route Editor truth boundary', secondary: ['Activity Detail'], current: 'Editor works on a Route draft and the Activity remains separate; persisted segment provenance is incomplete.', gap: 'PARTIAL_DATA_CONTRACT', disposition: 'LATER_SLICE', slice: 'Page sequence 4 — Route Editor', criteria: ['Activity geometry remains unchanged.', 'Reconnect is explicit and Route-only.', 'Fresh-device reopen preserves the distinction.'], evidence: { current_source: 'PARTIAL', user_reachability: 'YES', automated_proof: 'YES', deployed_match: 'NO' }, dependencies: ['RQ-ROUTE-003'], dependencyClass: 'NARROW_PREREQUISITE', evidenceIds: ['TEST-001', 'SRC-014'] }),
  req({ id: 'RQ-ROUTE-007', parents: ['ROUTE-05'], need: 'Friend Route view/copy/reference/revoke semantics are decided before exposing existing lower-layer data.', decisionStatus: 'CANDIDATE_AWAITING_DECISION', classification: 'CANDIDATE_DESIGN', source: 'Full task §4 future requirements', owner: 'Friends/Route future domain', secondary: ['Trails', 'Route Detail'], current: 'Circle Route API and dormant loader exist; there is no normal UI or approved copy/reference/revoke contract.', gap: 'HANDLER_WITHOUT_NORMAL_CONSUMER', disposition: 'LATER_SLICE', slice: 'Later Friends/Route sharing scope', criteria: ['Ownership and revocation semantics are approved.', 'Normal UI is explicit.', 'Copy/reference never mutates the source owner Route.'], evidence: { current_source: 'PARTIAL', user_reachability: 'NO', automated_proof: 'PARTIAL', deployed_match: 'PARTIAL', visual_evidence_level: 'SOURCE_ONLY' }, dependencyClass: 'PRODUCT_DECISION_REQUIRED', evidenceIds: ['DEP-004'] }),
  req({ id: 'RQ-CAIRN-001', parents: ['CAIRN-01'], need: 'Full Plant creates one stable, private-by-default Cairn with optional content and later recovery after local failure.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'EXPLICIT_USER_DECISION', source: 'Full task §4; Plant config R114/O24 source decision', owner: 'Plant', secondary: ['Own Cairn Detail', 'Memory', 'Activity Detail'], current: 'Standalone GPS→pin→content and active-Hike compose exist. Content is optional; default is Just me; failed draft rehydrates. Title is encoded inside note with U+001E because backend lacks a title field.', gap: 'SCHEMA_DEBT_AND_DEVICE_EVIDENCE_GAP', disposition: 'KEEP_NO_CHANGE', slice: 'Preserve current Plant; title schema may be a later narrow prerequisite', criteria: ['Successful Plant resolves to the same Cairn identity/detail.', 'Private default remains.', 'Failed local commit is visible and recoverable.'], evidence: { user_reachability: 'YES', automated_proof: 'YES', deployed_match: 'PARTIAL', visual_evidence_level: 'EXISTING_COMPONENT_WITH_FIXTURE', dna_alignment: 'MATCH' }, evidenceIds: ['TEST-001', 'VIS-022', 'VIS-029', 'VIS-036', 'SRC-015'] }),
  req({ id: 'RQ-CAIRN-002', parents: ['CAIRN-01', 'ACT-02'], need: 'Quick Cairn uses the most recent trustworthy Activity position, creates no fabricated success, and links to the Activity.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'EXPLICIT_USER_DECISION', source: 'Full task §4 and §9', owner: 'Run Quick Cairn', secondary: ['Activity Detail', 'Memory', 'Own Cairn Detail'], current: 'Run uses a fresh accepted point no older than 30 seconds, optional empty content, local durable marker, and activity provenance. It does not navigate to Detail.', gap: 'RETRIEVAL_DISCOVERABILITY_GAP', disposition: 'KEEP_NO_CHANGE', slice: 'Preserve recording flow; All Cairns later closes retrieval', criteria: ['Stale/missing fix blocks Quick Cairn.', 'Stable identity and Activity link persist.', 'Later edit/delete is reachable through an approved retrieval path.'], evidence: { user_reachability: 'YES', automated_proof: 'YES', deployed_match: 'PARTIAL', visual_evidence_level: 'SOURCE_ONLY' }, dependencies: ['RQ-CAIRN-006'], dependencyClass: 'LATER_DOMAIN_WORK', evidenceIds: ['SRC-011', 'SRC-028'] }),
  req({ id: 'RQ-CAIRN-003', parents: ['CAIRN-01', 'CAIRN-02'], need: 'Quick/Plant/map/list/Activity entries resolve to one stable Cairn identity without delete resurrection.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'EXPLICIT_USER_DECISION', source: 'Full task §4 and §13', owner: 'Shared Cairn identity', secondary: ['Plant', 'Run', 'Activity Detail', 'Memory', 'All Cairns'], current: 'clientCairnId/localId ack identity and tombstones exist. Naming is packed in note. Circle/public projections remain separate stores and do not converge on normal Detail.', gap: 'PARTIAL_SHARED_IDENTITY_CONTRACT', disposition: 'LATER_SLICE', slice: 'Page sequence 3 — Own Cairn Detail and All Cairns', criteria: ['All entry surfaces resolve the same stable ID.', 'Delete tombstones prevent resurrection.', 'Pending/synced naming is consistent.'], evidence: { current_source: 'PARTIAL', user_reachability: 'PARTIAL', automated_proof: 'YES', deployed_match: 'PARTIAL' }, evidenceIds: ['TEST-001', 'SRC-028'] }),
  req({ id: 'RQ-CAIRN-004', parents: ['CAIRN-02'], need: 'An owner can open, edit, and delete their Cairn with explicit offline/online boundaries.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'IMPLEMENTATION_FACT', source: 'Current MarkerDetailScreen and full task §8', owner: 'Own Cairn Detail', secondary: ['Plant', 'Memory', 'Activity Detail'], current: 'Successful full Plant normally replaces to MarkerDetail. Own local pending objects can edit/delete locally; synced edit/delete require network. Expo Web fixture shows Day/Sunset/Night but no native acceptance.', gap: 'PAGE_ACCEPTANCE_GAP', disposition: 'LATER_SLICE', slice: 'Page sequence 3 — Own Cairn Detail and All Cairns', criteria: ['Plant→Detail and retrieval→Detail converge.', 'Offline boundary is visible.', 'Edit/delete persist and failures are recoverable.'], evidence: { user_reachability: 'YES', automated_proof: 'PARTIAL', deployed_match: 'PARTIAL', visual_evidence_level: 'REAL_WEB_MAPBOX', dna_alignment: 'DIVERGENT' }, evidenceIds: ['VIS-023', 'VIS-030', 'VIS-037', 'SRC-016'] }),
  req({ id: 'RQ-CAIRN-005', parents: ['CAIRN-01', 'CAIRN-02'], need: 'Pending-create edits, synced edits, and synced deletes are described as distinct contracts.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'AUDIT_RECOMMENDATION', source: 'Full task §13', owner: 'Cairn persistence boundary', secondary: ['Plant', 'Own Cairn Detail', 'All Cairns'], current: 'Create is durable local/outbox; pending local object is mutable; synced edit/delete are online calls with tombstone protection.', gap: 'COPY_AND_ACCEPTANCE_GAP', disposition: 'LATER_SLICE', slice: 'Page sequence 3 — Cairn details', criteria: ['UI does not call all mutations offline-first.', 'Each state has accurate feedback and retry semantics.'], evidence: { user_reachability: 'PARTIAL', automated_proof: 'YES', visual_evidence_level: 'SOURCE_ONLY' }, evidenceIds: ['TEST-001', 'SRC-028'] }),
  req({ id: 'RQ-CAIRN-006', parents: ['CAIRN-03'], need: 'A personal All Cairns entry supports recency, search, later editing, and honest offline mutation boundaries.', decisionStatus: 'CANDIDATE_AWAITING_DECISION', classification: 'CANDIDATE_DESIGN', source: 'Full task §4 future requirements and §8', owner: 'All Cairns', secondary: ['Home or agreed personal-library entry', 'Own Cairn Detail', 'Memory'], current: 'No All Cairns page/tab/normal entry exists. Own marker cache and APIs do not constitute a reachable index.', gap: 'UNIMPLEMENTED_CANDIDATE_REQUIREMENT', disposition: 'NEEDS_PRODUCT_DECISION', slice: 'Page sequence 3 — Own Cairn Detail and All Cairns', criteria: ['Entry location is explicitly approved without reopening accepted Trails IA.', 'List/search/reopen scope is explicit.', 'Pending/synced mutation boundaries are shown.'], evidence: { current_source: 'NO', user_reachability: 'NO', automated_proof: 'NO', deployed_match: 'NO', device_loaded: 'NO', real_field_validation: 'NO', visual_evidence_level: 'NO_EVIDENCE', dna_alignment: 'UNVERIFIED' }, dependencyClass: 'PRODUCT_DECISION_REQUIRED', evidenceIds: ['SRC-012', 'DEP-005'] }),
  req({ id: 'RQ-CAIRN-007', parents: ['CAIRN-04', 'CAIRN-05'], need: 'A friend/public Cairn can reach an approved non-owner Detail without implying encounter or exposing implicit visitor location/time.', decisionStatus: 'CANDIDATE_AWAITING_DECISION', classification: 'CANDIDATE_DESIGN', source: 'Full task §4 future requirements', owner: 'Non-owner Cairn Detail', secondary: ['Memory', 'Friends', 'Public discovery'], current: 'Detail components and non-owner sheet forms exist, but Memory receives own markers only; circle markers are not rendered; public pins are blurred/unpressable; full MarkerDetail only resolves own store objects.', gap: 'HANDLER_WITHOUT_NORMAL_CONSUMER', disposition: 'NEEDS_PRODUCT_DECISION', slice: 'Later Friends/Public after authorization containment', criteria: ['Normal entry is defined.', 'Presence/open/Thanks are distinct.', 'No author notification of implicit visitor location/time by default.'], evidence: { current_source: 'PARTIAL', user_reachability: 'NO', automated_proof: 'PARTIAL', deployed_match: 'PARTIAL', real_field_validation: 'NO', visual_evidence_level: 'SOURCE_ONLY', dna_alignment: 'UNVERIFIED' }, dependencies: ['RQ-MEM-005', 'RQ-ENC-001', 'RQ-MOD-001'], dependencyClass: 'PRODUCT_DECISION_REQUIRED', evidenceIds: ['SRC-016', 'SRC-019', 'SRC-020'] }),
  req({ id: 'RQ-CAIRN-008', parents: ['CAIRN-05', 'MOD-01'], need: 'Like/report/hide/Block actions are reachable only with real persistence, moderation, and privacy semantics.', decisionStatus: 'CANDIDATE_AWAITING_DECISION', classification: 'CANDIDATE_DESIGN', source: 'Full task §4 future requirements', owner: 'Non-owner Cairn Detail/interactions', secondary: ['Memory', 'Moderation'], current: 'Services/endpoints exist but have no normal non-owner consumer. Hide in CairnPinsLayer closes the sheet without persisting hide.', gap: 'VISIBLE_OR_LOWER_LAYER_NO_OP', disposition: 'LATER_SLICE', slice: 'Later Public/Moderation scope', criteria: ['Every visible interaction has a durable handler.', 'Report enters an owned moderation workflow.', 'Hide/Block effects and reversibility are explicit.'], evidence: { current_source: 'PARTIAL', user_reachability: 'NO', automated_proof: 'PARTIAL', deployed_match: 'PARTIAL', visual_evidence_level: 'SOURCE_ONLY' }, dependencies: ['Moderation operating model'], dependencyClass: 'LATER_DOMAIN_WORK', evidenceIds: ['DEP-006', 'SRC-020'] }),
  req({ id: 'RQ-MEM-001', parents: ['MEM-01'], need: 'Personal Memory reveals only accepted personal evidence and never invents movement.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'EXPLICIT_USER_DECISION', source: 'Full task §4', owner: 'Personal Memory', secondary: ['Activity', 'Foreground exploration'], current: 'Personal points and evidence-bounded fog exist. Persisted source provenance is incomplete; current Web capture remained in loading UI after one runtime error.', gap: 'DATA_PROVENANCE_AND_RUNTIME_EVIDENCE_GAP', disposition: 'LATER_SLICE', slice: 'Page sequence 6 — Personal Memory', criteria: ['Only accepted personal evidence clears personal fog.', 'Source identity persists.', 'Map failure/loading states recover truthfully.'], evidence: { user_reachability: 'YES', automated_proof: 'YES', deployed_match: 'PARTIAL', visual_evidence_level: 'REAL_WEB_MAPBOX', dna_alignment: 'DIVERGENT', known_open_issues: ['Audit Web runtime raised one undefined-index error and showed Opening your map in all three themes.'] }, evidenceIds: ['VIS-024', 'VIS-031', 'VIS-038', 'TEST-001'] }),
  req({ id: 'RQ-MEM-002', parents: ['MEM-02'], need: 'Passive foreground exploration is explicitly enabled and distinguishable from Activity and simulation evidence.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'IMPLEMENTATION_FACT', source: 'Current source and prior capability audit', owner: 'Memory foreground exploration', secondary: ['Settings', 'Diagnostics'], current: 'A setting and foreground recorder exist; simulator-derived passive points are not durably distinguishable after persistence.', gap: 'PROVENANCE_GAP', disposition: 'LATER_SLICE', slice: 'Page sequence 6 — Personal Memory', criteria: ['User control is explicit.', 'Simulated and real provenance remain distinguishable.', 'Battery/permission behavior is device-tested.'], evidence: { current_source: 'YES', automated_proof: 'PARTIAL', deployed_match: 'PARTIAL', real_field_validation: 'UNKNOWN', visual_evidence_level: 'SOURCE_ONLY' }, evidenceIds: ['DEP-007'] }),
  req({ id: 'RQ-MEM-003', parents: ['MEM-03'], need: 'Personal Memory reset is explicit and truthful without implying Activity/Cairn deletion.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'IMPLEMENTATION_FACT', source: 'Current Settings source and full task §4', owner: 'Settings Privacy & Data', secondary: ['Memory'], current: 'A destructive flow exists; it was not invoked. Remote purge requires server and local clear follows.', gap: 'DEVICE_AND_DEPLOYED_E2E_GAP', disposition: 'LATER_SLICE', slice: 'Page sequence 6/Settings contract verification', criteria: ['Copy scopes reset to Memory only.', 'Server/local outcome and failure recovery are tested in isolation.', 'Ordinary production accounts are not used for audit testing.'], evidence: { user_reachability: 'YES', automated_proof: 'YES', deployed_match: 'PARTIAL', visual_evidence_level: 'SOURCE_ONLY', dna_alignment: 'MATCH' }, evidenceIds: ['TEST-001', 'SRC-021'] }),
  req({ id: 'RQ-MEM-004', parents: ['MEM-04'], need: 'Viewer friend selection, single-friend focus, source separation, and overlap provenance are understandable.', decisionStatus: 'CANDIDATE_AWAITING_DECISION', classification: 'CANDIDATE_DESIGN', source: 'Full task §4 future requirements', owner: 'Memory friend layer', secondary: ['Friends'], current: 'Mine/Friends scope, picker, subscriptions, and friend fog union exist. Circle Cairn markers are not consumed. Friend cache is RAM-only and authorization is unsafe.', gap: 'SECURITY_AND_PRODUCT_DECISION_GAP', disposition: 'LATER_SLICE', slice: 'Page sequence 7 after P0 containment', criteria: ['Mine and friend sources are visually distinct.', 'Single-friend/union behavior is approved.', 'Overlap retains provenance.', 'Authorization is enforced at query time.'], evidence: { current_source: 'YES', user_reachability: 'YES', automated_proof: 'PARTIAL', deployed_match: 'YES', visual_evidence_level: 'SOURCE_ONLY', dna_alignment: 'DIVERGENT', known_open_issues: ['Known production authorization P0 retained from prior audit.'] }, dependencies: ['RQ-MEM-005', 'RQ-SEC-001'], dependencyClass: 'NARROW_PREREQUISITE', evidenceIds: ['DEP-008', 'SRC-018'] }),
  req({ id: 'RQ-MEM-005', parents: ['MEM-05', 'MEM-06', 'MEM-07'], need: 'Owner grant and viewer selection are separate, and revoke/unfriend/block/delete immediately remove access.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'AUDIT_RECOMMENDATION', source: 'Prior fact audit MEM-05..07; full task §4', owner: 'Friends/Memory authorization', secondary: ['Memory', 'Backend'], current: 'Viewer subscription exists without owner grant. Production trigger was absent and /circle/fog lacked the needed authorization check at prior verification; unfriend/block did not revoke and RAM cache had no remote invalidation.', gap: 'KNOWN_PRODUCTION_SECURITY_P0', disposition: 'LATER_SLICE', slice: 'Separately approved narrow security containment before any sharing pilot', criteria: ['Server requires current friendship plus owner grant.', 'Cap is server enforced.', 'Unfriend/block/delete revoke transactionally.', 'Open/cache reads cannot retain revoked access.'], evidence: { current_source: 'PARTIAL', user_reachability: 'PARTIAL', automated_proof: 'PARTIAL', deployed_match: 'NO', real_field_validation: 'NO', visual_evidence_level: 'SOURCE_ONLY', dna_alignment: 'UNVERIFIED', known_open_issues: ['Do not retest against real users. Prior finding timestamp retained.'] }, dependencies: ['Corrective migration', 'Request and query authorization', 'Cache invalidation'], dependencyClass: 'NARROW_PREREQUISITE', evidenceIds: ['DEP-008'] }),
  req({ id: 'RQ-MEM-006', parents: ['MEM-04', 'ENC-01'], need: 'Friend-visible regions never count as personal exploration, and a Cairn inside friend fog is not automatically an encounter.', decisionStatus: 'CANDIDATE_AWAITING_DECISION', classification: 'CANDIDATE_DESIGN', source: 'Full task §4 future requirements', owner: 'Memory/Encounter boundary', secondary: ['Friends', 'Public Cairns'], current: 'Friend fog is a separate display union, but no Encounter domain exists and normal non-owner Cairn entry is disconnected.', gap: 'UNIMPLEMENTED_DOMAIN_BOUNDARY', disposition: 'LATER_SLICE', slice: 'Later Friends/Encounter scope', criteria: ['Personal completion metrics exclude friend fog.', 'Encounter requires separately approved eligibility/presentation evidence.'], evidence: { current_source: 'PARTIAL', user_reachability: 'PARTIAL', automated_proof: 'PARTIAL', deployed_match: 'PARTIAL', visual_evidence_level: 'SOURCE_ONLY' }, dependencies: ['RQ-ENC-001'], dependencyClass: 'LATER_DOMAIN_WORK', evidenceIds: ['DEP-009'] }),
  req({ id: 'RQ-MEM-007', parents: ['MEM-01', 'CAIRN-02', 'CAIRN-04'], need: 'Personal Memory can reopen an own Cairn, while friend/public Detail reachability is represented truthfully.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'AUDIT_RECOMMENDATION', source: 'Full task §9', owner: 'Memory → Cairn Detail', current: 'MemoryMap receives own markers and can open the own sheet/detail family. circleMarkers are not supplied; public pins are blurred/unpressable.', gap: 'PARTIAL_INTEGRATION', disposition: 'LATER_SLICE', slice: 'Page sequence 3 then 6', criteria: ['Own Cairn opens one canonical Detail.', 'Non-owner state is not implied until normally reachable.'], evidence: { user_reachability: 'PARTIAL', automated_proof: 'PARTIAL', visual_evidence_level: 'REAL_WEB_MAPBOX', dna_alignment: 'DIVERGENT' }, evidenceIds: ['SRC-018', 'SRC-019', 'SRC-020'] }),
  req({ id: 'RQ-MEM-008', parents: ['MEM-01', 'ENC-01'], need: 'Place/time revisiting, repeated visits, small groups, notifications, offline encounters, and NZ extensions receive explicit later dispositions.', decisionStatus: 'CANDIDATE_AWAITING_DECISION', classification: 'CANDIDATE_DESIGN', source: 'Full task §4 future requirements', owner: 'Memory future domain', current: 'These are not one current accepted implementation contract.', gap: 'UNIMPLEMENTED_CANDIDATE_REQUIREMENTS', disposition: 'LATER_SLICE', slice: 'Later Memory/Encounter/NZ discovery, not M0', criteria: ['Each concept receives a separate approved job, privacy boundary, and evidence plan before build.'], evidence: { current_source: 'NO', user_reachability: 'NO', automated_proof: 'NO', deployed_match: 'NO', device_loaded: 'NO', real_field_validation: 'NO', visual_evidence_level: 'NO_EVIDENCE', dna_alignment: 'UNVERIFIED' }, dependencyClass: 'PRODUCT_DECISION_REQUIRED', evidenceIds: ['SRC-006'] }),
  req({ id: 'RQ-FRI-001', parents: ['FRI-01'], need: 'Friend request/list/profile/block remains the accepted bounded social entry without leaking Memory authority.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'IMPLEMENTATION_FACT', source: 'Prior capability audit FRI-01 and full task §3', owner: 'Friends', secondary: ['Memory'], current: 'Core friend UI/API exists; device privacy regression proof is unknown. Friends is an accepted DNA reference, not acceptance of Memory authorization.', gap: 'DEVICE_AND_PRIVACY_EVIDENCE_GAP', disposition: 'KEEP_NO_CHANGE', slice: 'Preserve until later authorization slice', criteria: ['Core friend flow does not regress.', 'Friend status alone never grants Memory access without approved owner authority.'], evidence: { user_reachability: 'YES', deployed_match: 'PARTIAL', dna_alignment: 'MATCH', user_acceptance: 'PARTIAL', user_acceptance_source: 'Visual reference accepted; whole privacy contract not accepted.' }, evidenceIds: ['DEP-010', 'SRC-003'] }),
  req({ id: 'RQ-SOC-001', parents: ['AUTH-01', 'FRI-01', 'CAIRN-04'], need: 'Self, Friends, and Public are equally legitimate, low-interruption asynchronous value paths—not a feed, marketplace, or leaderboard.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'EXPLICIT_USER_DECISION', source: 'Full task §4 explicit core boundaries', owner: 'Shared product model', secondary: ['Home', 'Friends', 'Memory', 'Cairns'], current: 'Personal flows dominate current reachability; friend/public implementations are incomplete and no feed/leaderboard was found.', gap: 'FUTURE_BALANCE_NOT_IMPLEMENTATION_AUTHORIZATION', disposition: 'KEEP_NO_CHANGE', slice: 'Guardrail across later scopes', criteria: ['No future page turns Public into searchable engagement feed by default.', 'Each path retains its own privacy and retrieval model.'], evidence: { current_source: 'PARTIAL', user_reachability: 'PARTIAL', automated_proof: 'PARTIAL', visual_evidence_level: 'SOURCE_ONLY' }, evidenceIds: ['SRC-006'] }),
  req({ id: 'RQ-MOD-001', parents: ['MOD-01'], need: 'Reports have an owned moderation queue, disposition, SLA, and appeal path before public operations expand.', decisionStatus: 'CANDIDATE_AWAITING_DECISION', classification: 'CANDIDATE_DESIGN', source: 'Full task §4 future requirements', owner: 'Moderation future domain', current: 'Report counters/auto-hide threshold exist; no moderation operations surface or owner was found.', gap: 'UNIMPLEMENTED_CANDIDATE_REQUIREMENT', disposition: 'LATER_SLICE', slice: 'Later Public/Moderation scope', criteria: ['Named operational owner and tooling exist.', 'Disposition and appeal are auditable.', 'Auto-hide is not called moderation completion.'], evidence: { current_source: 'NO', user_reachability: 'NO', automated_proof: 'NO', deployed_match: 'NO', device_loaded: 'NO', real_field_validation: 'NO', visual_evidence_level: 'NO_EVIDENCE' }, dependencyClass: 'PRODUCT_DECISION_REQUIRED', evidenceIds: ['DEP-011'] }),
  req({ id: 'RQ-ENC-001', parents: ['ENC-01'], need: 'Eligibility, presence, presentation, opening, saving, Thanks, and author notification are distinct privacy events.', decisionStatus: 'CANDIDATE_AWAITING_DECISION', classification: 'CANDIDATE_DESIGN', source: 'Full task §4 future requirements', owner: 'Encounter future domain', secondary: ['Memory', 'Public Cairn Detail'], current: 'No Encounter schema/API exists. Fog proximity and pins are not proof of presentation/opening.', gap: 'UNIMPLEMENTED_CANDIDATE_REQUIREMENT', disposition: 'LATER_SLICE', slice: 'Later Encounter/Public scope', criteria: ['Events and retention are defined.', 'Implicit visitor location/time is not disclosed by default.', 'Offline reconciliation is explicit.'], evidence: { current_source: 'NO', user_reachability: 'NO', automated_proof: 'NO', deployed_match: 'NO', device_loaded: 'NO', real_field_validation: 'NO', visual_evidence_level: 'NO_EVIDENCE' }, dependencyClass: 'PRODUCT_DECISION_REQUIRED', evidenceIds: ['DEP-012'] }),
  req({ id: 'RQ-SET-001', parents: ['SET-01', 'SET-02', 'SET-03'], need: 'Settings provides a coherent root for Account, Preferences, Privacy & Data, and Help & About.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'IMPLEMENTATION_FACT', source: 'Current Settings source and full task §8', owner: 'Settings', current: 'Four-group root and secondary pages exist and use shared visual components. Expo Web fixture shows strong theme alignment; dangerous actions were not invoked.', gap: 'DEPLOYED_CONTRACT_AND_USER_ACCEPTANCE_GAP', disposition: 'KEEP_NO_CHANGE', slice: 'Preserve UI; repair deployment contracts separately', criteria: ['Four-group structure remains clear.', 'Dangerous actions require confirmation and truthful server outcomes.', 'No visual shared change regresses Home/Friends/Auth.'], evidence: { user_reachability: 'YES', automated_proof: 'YES', deployed_match: 'PARTIAL', visual_evidence_level: 'EXISTING_COMPONENT_WITH_FIXTURE', dna_alignment: 'MATCH' }, evidenceIds: ['VIS-025', 'VIS-032', 'VIS-039', 'VIS-041', 'TEST-001'] }),
  req({ id: 'RQ-SET-002', parents: ['MAP-01'], need: 'Appearance Auto/Day/Sunset/Night, units, and haptics have real consumers across pages and overlays.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'IMPLEMENTATION_FACT', source: 'Current Settings/useScenicTimeState source; full task §9', owner: 'Settings/shared theme', secondary: ['All scoped pages'], current: 'Appearance drives shared themes; units/haptics have consumers. Web map adapter substitutes outdoors-v12 for native Standard v3, so renderer parity is not implied.', gap: 'CROSS_RENDERER_ACCEPTANCE_GAP', disposition: 'KEEP_NO_CHANGE', slice: 'CARD-01 reviews priority pages; later page reviews retain regression checks', criteria: ['Day/Sunset/Night remain distinguishable.', 'Selected/unselected controls remain legible.', 'Unit/haptic changes affect documented consumers.'], evidence: { user_reachability: 'YES', automated_proof: 'PARTIAL', deployed_match: 'PARTIAL', visual_evidence_level: 'EXISTING_COMPONENT_WITH_FIXTURE', dna_alignment: 'PARTIAL' }, evidenceIds: ['VIS-001', 'VIS-013', 'VIS-025', 'SRC-024'] }),
  req({ id: 'RQ-SET-003', parents: ['SET-01'], need: 'Feedback submission truthfully acknowledges or retries against the deployed service.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'IMPLEMENTATION_FACT', source: 'Prior capability SET-01; full task §5', owner: 'Settings Help & About', current: 'Client UI/service and local migration 035 exist; production endpoint/table were absent in prior verification. Audit did not submit feedback.', gap: 'KNOWN_PRODUCTION_RELEASE_CONTRACT_P0', disposition: 'LATER_SLICE', slice: 'Separately approved release-contract containment', criteria: ['Approved migration/backend deploy exists.', 'Device success/failure is verified in isolation.', 'Displayed acknowledgement matches server durability.'], evidence: { current_source: 'YES', user_reachability: 'YES', automated_proof: 'YES', deployed_match: 'NO', real_field_validation: 'NO', visual_evidence_level: 'SOURCE_ONLY' }, dependencies: ['Backend migration 035 and route deployment'], dependencyClass: 'NARROW_PREREQUISITE', evidenceIds: ['DEP-013'] }),
  req({ id: 'RQ-SET-004', parents: ['SET-02'], need: 'Export request/status/download includes the approved data contract and truthful expiry/failure behavior.', decisionStatus: 'UNRESOLVED', classification: 'IMPLEMENTATION_FACT', source: 'Prior capability SET-02; full task §5', owner: 'Settings Privacy & Data', current: 'Client and backend versions differ; current export list omits geometry. Audit performed only intercepted GET and triggered no export job.', gap: 'DEPLOYMENT_AND_PRODUCT_CONTRACT_GAP', disposition: 'NEEDS_PRODUCT_DECISION', slice: 'Later Settings/release contract slice', criteria: ['Export contents are approved.', 'Deployed API matches client.', 'Privacy/expiry/download are device-tested in isolation.'], evidence: { current_source: 'YES', user_reachability: 'YES', automated_proof: 'PARTIAL', deployed_match: 'PARTIAL', real_field_validation: 'NO', visual_evidence_level: 'SOURCE_ONLY' }, dependencies: ['Export content/privacy decision'], dependencyClass: 'PRODUCT_DECISION_REQUIRED', evidenceIds: ['DEP-014'] }),
  req({ id: 'RQ-SET-005', parents: ['SET-03'], need: 'Account deletion/restoration copy matches deployed timing and actual restore/sweep behavior.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'IMPLEMENTATION_FACT', source: 'Prior capability SET-03; full task §5', owner: 'Settings Account/Auth', current: 'O56 says seven-day restore; production previously used five minutes. Audit did not trigger deletion.', gap: 'KNOWN_PRODUCTION_RELEASE_CONTRACT_P0', disposition: 'LATER_SLICE', slice: 'Separately approved release-contract containment', criteria: ['Approved timing is explicit.', 'Client, backend, cron, and policy match.', 'Restore/sweep are tested in isolation.'], evidence: { current_source: 'YES', user_reachability: 'YES', automated_proof: 'YES', deployed_match: 'NO', real_field_validation: 'NO', visual_evidence_level: 'SOURCE_ONLY' }, dependencies: ['Approved deletion contract', 'Backend deployment'], dependencyClass: 'NARROW_PREREQUISITE', evidenceIds: ['DEP-015'] }),
  req({ id: 'RQ-PAY-001', parents: ['PAY-01'], need: 'Paid benefits, purchase, restore, testing, and promotion are approved and operational before commercial release.', decisionStatus: 'CANDIDATE_AWAITING_DECISION', classification: 'CANDIDATE_DESIGN', source: 'Full task §4 future requirements', owner: 'Payments future domain', current: 'SDK exists but O56 lacks the key and App Store/RevenueCat configuration is unknown. No purchase was attempted.', gap: 'EXTERNAL_CONFIGURATION_AND_PRODUCT_DECISION_GAP', disposition: 'LATER_SLICE', slice: 'Later commercial scope', criteria: ['Benefit/pricing is approved.', 'Store/offering/key are verified.', 'Purchase/restore is sandbox-tested.'], evidence: { current_source: 'YES', user_reachability: 'PARTIAL', automated_proof: 'PARTIAL', deployed_match: 'NO', device_loaded: 'UNKNOWN', real_field_validation: 'NO', visual_evidence_level: 'SOURCE_ONLY' }, dependencyClass: 'LATER_DOMAIN_WORK', evidenceIds: ['DEP-016'] }),
  req({ id: 'RQ-PAY-002', parents: ['PAY-02'], need: 'Paid entitlement enforcement is server-authoritative and recoverable.', decisionStatus: 'CANDIDATE_AWAITING_DECISION', classification: 'CANDIDATE_DESIGN', source: 'Prior capability PAY-02', owner: 'Payments backend future domain', current: 'No webhook/event/entitlement schema exists; purchase cannot change server Memory limits.', gap: 'UNIMPLEMENTED_CANDIDATE_REQUIREMENT', disposition: 'LATER_SLICE', slice: 'Later commercial scope', criteria: ['Signed idempotent lifecycle ingestion exists.', 'Server enforcement and recovery are tested.'], evidence: { current_source: 'NO', user_reachability: 'NO', automated_proof: 'NO', deployed_match: 'NO', device_loaded: 'NO', real_field_validation: 'NO', visual_evidence_level: 'NO_EVIDENCE' }, dependencyClass: 'LATER_DOMAIN_WORK', evidenceIds: ['DEP-017'] }),
  req({ id: 'RQ-MAP-001', parents: ['MAP-01', 'ACT-01', 'ACT-02'], need: 'Hike/Run map, route, puck, legal controls, metrics, and bottom dock are distinguishable in Day/Sunset/Night on the actual iPhone renderer.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'EXPLICIT_USER_DECISION', source: 'Full task §10, §11, and §15', owner: 'Hike/Run native map presentation', secondary: ['Activity Detail', 'Memory'], current: 'Expo Web Hike/Run shows Map unavailable and validates surrounding chrome only. Historical phone images show native Mapbox, but not current O56/NZ. Native attribution collision is unverified.', gap: 'NATIVE_VISUAL_EVIDENCE_GAP', disposition: 'CURRENT_SLICE', slice: 'CARD-01 — first iPhone Hike/Run evidence review', criteria: ['Actual native map/route/puck remain readable in all appearances.', 'Mapbox logo/info do not collide with core actions.', 'Small/large device risks are recorded.'], evidence: { user_reachability: 'YES', automated_proof: 'PARTIAL', deployed_match: 'PARTIAL', visual_evidence_level: 'HISTORICAL_SCREENSHOT', dna_alignment: 'PARTIAL' }, evidenceIds: ['VIS-001', 'HIST-001'] }),
  req({ id: 'RQ-MAP-002', parents: ['MAP-01'], need: 'NZ warmup/offline map support states its real coverage, size, controls, and degradation.', decisionStatus: 'UNRESOLVED', classification: 'CANDIDATE_DESIGN', source: 'Prior capability MAP-01; full task §4 future requirements', owner: 'Maps/NZ future domain', current: 'Automatic rough bbox zoom 5–10 warmup exists without user control/status; account/device pack evidence is unknown.', gap: 'DEVICE_AND_PRODUCT_DECISION_GAP', disposition: 'LATER_SLICE', slice: 'Later NZ/offline scope', criteria: ['Coverage/size/status are measurable.', 'Offline copy matches actual tiles and legal constraints.', 'NZ device validation exists.'], evidence: { user_reachability: 'YES', automated_proof: 'PARTIAL', deployed_match: 'PARTIAL', real_field_validation: 'PARTIAL', visual_evidence_level: 'SOURCE_ONLY' }, dependencyClass: 'PRODUCT_DECISION_REQUIRED', evidenceIds: ['DEP-018'] }),
  req({ id: 'RQ-DIAG-001', parents: ['DIAG-01'], need: 'Debug/Clean/Raw evidence is reachable only in intended builds and cannot be confused with real field proof.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'AUDIT_RECOMMENDATION', source: 'Full task §5, §13, and §15', owner: 'Diagnostics/build gating', secondary: ['Hike', 'Run'], current: 'Debug route is build/debug gated; normal Settings has no entry. O55 tool access on the owner installed app is unknown. Audit observed automatic /api/edit-diag POST attempts even with debug disabled, all intercepted.', gap: 'BUILD_GATE_AND_SIDE_EFFECT_EVIDENCE_GAP', disposition: 'LATER_SLICE', slice: 'Device review only if entry is genuinely present; otherwise BLOCKED_BY_BUILD_GATE', criteria: ['Exact build gate is recorded.', 'Clean and Raw modes use actual UI names.', 'Telemetry consent/retention is explicit.', 'Simulation claims remain bounded.'], evidence: { current_source: 'PARTIAL', user_reachability: 'PARTIAL', automated_proof: 'PARTIAL', deployed_match: 'PARTIAL', visual_evidence_level: 'SOURCE_ONLY', known_open_issues: [`${capture.blocked_writes.length} edit-diag POST attempts were safely blocked during this capture run.`] }, dependencies: ['Installed build identity'], dependencyClass: 'NARROW_PREREQUISITE', evidenceIds: ['RUNTIME-001', 'DEP-019'] }),
  req({ id: 'RQ-REL-002', parents: ['REL-02'], need: 'External beta availability is proven by App Store Connect group/review/install evidence, not an EAS build alone.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'AUDIT_RECOMMENDATION', source: 'Prior capability REL-02; full task §5', owner: 'App Store Connect owner', current: 'Dashboard evidence is unavailable; no claim of TestFlight availability or device install is made.', gap: 'EXTERNAL_DASHBOARD_EVIDENCE_GAP', disposition: 'LATER_SLICE', slice: 'Owner release verification', criteria: ['Redacted build/group/review and tester install evidence exists.'], evidence: { current_source: 'UNKNOWN', user_reachability: 'UNKNOWN', automated_proof: 'NO', deployed_match: 'UNKNOWN', device_loaded: 'UNKNOWN', real_field_validation: 'NO', visual_evidence_level: 'NO_EVIDENCE' }, dependencyClass: 'LATER_DOMAIN_WORK', evidenceIds: ['DEP-020'] }),
  req({ id: 'RQ-SEC-001', parents: ['MEM-05', 'MEM-07'], need: 'Known friend-fog authorization exposure is contained before sharing pilot or friend Memory review.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'AUDIT_RECOMMENDATION', source: 'Prior fact audit SUMMARY/HANDOFF, retained without live retest', owner: 'Backend authorization', secondary: ['Memory', 'Friends'], current: 'Prior evidence found arbitrary-user subscription/cap bypass and /circle/fog authorization gaps in production. No real-user vulnerability test was performed in this audit.', gap: 'KNOWN_PRODUCTION_SECURITY_P0', disposition: 'LATER_SLICE', slice: 'Separately approved narrow containment, not CARD-01', criteria: ['Corrective migration is present and applied.', 'Request and query checks enforce current authorized relationship.', 'Revoke/block/delete purge access and cache.', 'Isolated regression proof exists.'], evidence: { current_source: 'PARTIAL', user_reachability: 'PARTIAL', automated_proof: 'PARTIAL', deployed_match: 'NO', real_field_validation: 'NO', visual_evidence_level: 'SOURCE_ONLY' }, dependencies: ['Explicit approval for backend containment/deploy'], dependencyClass: 'NARROW_PREREQUISITE', evidenceIds: ['DEP-008'] }),
  req({ id: 'RQ-OFFLINE-001', parents: ['CAIRN-01', 'ROUTE-02', 'ACT-03'], need: 'Local save, server sync, refinement, and usability remain independent states with truthful recovery.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'EXPLICIT_USER_DECISION', source: 'Full task §4 and §13', owner: 'Shared offline/status contract', secondary: ['Activity Detail', 'Route Detail', 'Cairn Detail'], current: 'Stores distinguish several states, but page copy and real executors are uneven; route usability and final refinement can be conflated.', gap: 'SHARED_STATUS_CONTRACT_GAP', disposition: 'LATER_SLICE', slice: 'Resolve page-by-page, starting Activity Detail', criteria: ['Each label maps to persistence and an executor.', 'Failure/retry states are reachable.', 'Usability is not inferred from local save alone.'], evidence: { current_source: 'PARTIAL', user_reachability: 'PARTIAL', automated_proof: 'YES', deployed_match: 'PARTIAL', visual_evidence_level: 'EXISTING_COMPONENT_WITH_FIXTURE', dna_alignment: 'PARTIAL' }, dependencyClass: 'SHARED_VISUAL_FIX', evidenceIds: ['TEST-001', 'VIS-019'] }),
  req({ id: 'RQ-FINAL-001', parents: ['ACT-03', 'ROUTE-02'], need: 'Any Refining/later enhancement state has a real durable executor that survives relaunch/offline, or the UI states that no automatic work exists.', decisionStatus: 'CONFIRMED_REQUIREMENT', classification: 'AUDIT_RECOMMENDATION', source: 'Full task §5 and §13', owner: 'Activity finalization worker', secondary: ['Activity Detail', 'Route Editor'], current: 'One-off post-Finish work and state enums exist; no durable reconnect Final worker was proven.', gap: 'STATE_WITHOUT_WORKER', disposition: 'LATER_SLICE', slice: 'Activity Detail truth slice', criteria: ['Executor ownership/persistence is explicit.', 'Relaunch/offline recovery is tested.', 'Retry invokes real work.'], evidence: { current_source: 'PARTIAL', user_reachability: 'PARTIAL', automated_proof: 'PARTIAL', deployed_match: 'PARTIAL', visual_evidence_level: 'SOURCE_ONLY' }, dependencyClass: 'NARROW_PREREQUISITE', evidenceIds: ['DEP-002'] }),
];

const parentChildren = new Map();
for (const requirement of requirements) {
  for (const parent of requirement.parent_capability_ids) {
    if (!parentChildren.has(parent)) parentChildren.set(parent, []);
    parentChildren.get(parent).push(requirement.requirement_id);
  }
}

const capabilityDispositions = {
  'REL-01': 'CURRENT_SLICE', 'AUTH-01': 'KEEP_NO_CHANGE', 'ACT-01': 'CURRENT_SLICE', 'ACT-02': 'CURRENT_SLICE', 'ACT-03': 'LATER_SLICE',
  'MEM-01': 'LATER_SLICE', 'MEM-02': 'LATER_SLICE', 'MEM-03': 'LATER_SLICE', 'MEM-04': 'LATER_SLICE', 'MEM-05': 'LATER_SLICE', 'MEM-06': 'LATER_SLICE', 'MEM-07': 'LATER_SLICE',
  'FRI-01': 'KEEP_NO_CHANGE', 'CAIRN-01': 'KEEP_NO_CHANGE', 'CAIRN-02': 'LATER_SLICE', 'CAIRN-03': 'NEEDS_PRODUCT_DECISION', 'CAIRN-04': 'NEEDS_PRODUCT_DECISION', 'CAIRN-05': 'LATER_SLICE',
  'MOD-01': 'LATER_SLICE', 'ENC-01': 'LATER_SLICE', 'ROUTE-01': 'LATER_SLICE', 'ROUTE-02': 'LATER_SLICE', 'ROUTE-03': 'NEEDS_PRODUCT_DECISION', 'ROUTE-04': 'KEEP_NO_CHANGE', 'ROUTE-05': 'LATER_SLICE',
  'SET-01': 'LATER_SLICE', 'SET-02': 'NEEDS_PRODUCT_DECISION', 'SET-03': 'LATER_SLICE', 'PAY-01': 'LATER_SLICE', 'PAY-02': 'LATER_SLICE', 'MAP-01': 'CURRENT_SLICE', 'DIAG-01': 'LATER_SLICE', 'REL-02': 'LATER_SLICE',
};

const capabilityCrosswalk = priorCapabilities.map(capability => ({
  capability_id: capability.capability_id,
  surface: capability.surface,
  capability: capability.capability,
  prior_dimensions: {
    current_source: capability.current_source,
    user_reachability: capability.user_reachability,
    automated_proof: capability.automated_proof,
    deployed_match: capability.deployed_match,
    device_loaded: capability.device_loaded,
    real_field_validation: capability.real_field_validation,
  },
  current_disposition: capabilityDispositions[capability.capability_id] ?? 'UNALLOCATED',
  child_requirement_ids: parentChildren.get(capability.capability_id) ?? [],
  drift_note: ({
    'REL-01': 'Current dirty working tree cannot be attributed to the published O56 bundle; ordinary UI still lacks update ID.',
    'ACT-03': 'Fresh Day/Sunset/Night fixture captures added; native/user acceptance remains unknown.',
    'CAIRN-03': 'Confirmed absent from current Trails normal IA and navigation.',
    'CAIRN-04': 'Confirmed public pins remain blurred/unpressable and circle markers are not consumed by Memory.',
    'CAIRN-05': 'Confirmed source services/forms but no normal non-owner consumer; hide UI remains no-op.',
    'ROUTE-01': 'Confirmed Route rename/delete failure feedback and direct-ID loading gaps.',
    'ROUTE-02': 'Confirmed post-create landing is RouteEditor view, not canonical Route Detail.',
    'ROUTE-04': 'Confirmed normal Use remains pre-start map reference, not active following.',
    'DIAG-01': 'Capture observed automatic edit-diag POST attempts even with debug disabled; all intercepted.',
  })[capability.capability_id] ?? 'No material fact-audit status change claimed; page evidence/disposition added.',
}));

if (capabilityCrosswalk.length !== 33) throw new Error(`Expected 33 prior capabilities, got ${capabilityCrosswalk.length}`);
const uncovered = capabilityCrosswalk.filter(row => row.child_requirement_ids.length === 0 || row.current_disposition === 'UNALLOCATED');
if (uncovered.length) throw new Error(`Uncovered capability IDs: ${uncovered.map(row => row.capability_id).join(', ')}`);

const pages = [
  { page_id: 'PAGE-HIKE', page: 'Hike', primary_job: 'Record a hiking Activity truthfully.', secondary_job: 'Choose/show a Route reference, place a full Cairn, recover unfinished work.', owns: ['ACT-01', 'RQ-ACT-003', 'RQ-ACT-004', 'RQ-MAP-001'], must_not_own: ['Route provenance decisions', 'Memory friend authorization', 'Final acceptance of Activity Detail'], maturity: 'SOURCE_MATURE / NATIVE_AND_USER_ACCEPTANCE_UNVERIFIED', gaps: ['Native map/theme proof', 'Current field recovery proof', 'Too-short paused Continue inconsistency', 'Expo Web 320×568 capture clips top/bottom chrome'], future_direction: 'Review current candidate first; preserve shared lifecycle.', component_paths: ['app/src/screens/HikingScreen.tsx', 'app/src/screens/HikingMap.tsx', 'app/src/components/activity/ActivityRecordingChrome.tsx'], normal_navigation: ['Home → Hiking'], incoming_ids: ['optional routeId'], stores_apis: ['useTrackingStore', 'useRouteStore', '/api/sessions', '/api/markers'], gates: ['Simulator/debug capability is separate and build gated'], theme_source: 'useVisualTheme/useScenicTimeState', tests: ['activity operational/route/UI contract suites'], image_evidence: ['VIS-001', 'VIS-002', 'VIS-005', 'VIS-006', 'VIS-009', 'VIS-010', 'VIS-040'], entry_classification: 'NORMAL_USER' },
  { page_id: 'PAGE-RUN', page: 'Run', primary_job: 'Record a running Activity with trustworthy pace/distance/time.', secondary_job: 'Choose/show a Route reference and create Quick Cairn.', owns: ['ACT-02', 'RQ-CAIRN-002', 'RQ-MAP-001'], must_not_own: ['All Cairns retrieval', 'Active following unless explicitly wired', 'Public sharing policy'], maturity: 'SOURCE_MATURE / NATIVE_AND_USER_ACCEPTANCE_UNVERIFIED', gaps: ['Startup pace/current field proof', 'Native themes/legal-control proof', 'Quick Cairn later retrieval'], future_direction: 'Review current candidate first; preserve shared lifecycle.', component_paths: ['app/src/screens/RunningScreen.tsx', 'app/src/screens/HikingMap.tsx', 'app/src/components/activity/ActivityRecordingChrome.tsx'], normal_navigation: ['Home → Running'], incoming_ids: ['optional routeId'], stores_apis: ['useTrackingStore', 'useMarkerStore', 'useRouteStore', '/api/sessions', '/api/markers'], gates: ['Simulator/debug capability is separate and build gated'], theme_source: 'useVisualTheme/useScenicTimeState', tests: ['activity operational/route/UI contract suites'], image_evidence: ['VIS-003', 'VIS-004', 'VIS-007', 'VIS-008', 'VIS-011', 'VIS-012', 'HIST-001'], entry_classification: 'NORMAL_USER' },
  { page_id: 'PAGE-TRAILS', page: 'Trails', primary_job: 'Personal Activities/Routes library.', secondary_job: 'Search/filter loaded objects and open their Details.', owns: ['ACT-03', 'ROUTE-01', 'RQ-TRAIL-001'], must_not_own: ['Equal Cairns tab', 'Mine/Friends tier', 'Friend Route contract without approval'], maturity: 'INTEGRATED_LIST / COMPLETENESS_AND_ACCEPTANCE_PARTIAL', gaps: ['Search/pagination covers loaded subset only', 'No All Cairns', 'Downstream details not accepted'], future_direction: 'Keep accepted Activities/Routes IA; revisit integration after Detail slices.', component_paths: ['app/src/screens/RoutesScreen.tsx'], normal_navigation: ['Home → Trails', 'MapHistory without ID redirects → Trails'], incoming_ids: ['initialTab activities|routes'], stores_apis: ['useSessionStore', 'useRouteStore', '/api/sessions', '/api/routes'], gates: ['none'], theme_source: 'useVisualTheme', tests: ['trailsLibrary', 'trailsScreenContracts'], image_evidence: ['VIS-013', 'VIS-014', 'VIS-015', 'VIS-016', 'VIS-017', 'VIS-018'], entry_classification: 'NORMAL_USER' },
  { page_id: 'PAGE-ACTIVITY-DETAIL', page: 'Activity Detail', primary_job: 'Review one finalized Activity and its truth/sync/Route state.', secondary_job: 'Rename/delete and Save as Route.', owns: ['ACT-03', 'ROUTE-02'], must_not_own: ['All Cairns', 'Route planning provenance', 'Automatic refinement without worker'], maturity: 'NORMALLY_REACHABLE / PARTIAL_DNA / NOT_ACCEPTED', gaps: ['Web fallback only in audit', 'Native detail proof', 'Durable refinement truth'], future_direction: 'Next page after Hike/Run review.', component_paths: ['app/src/screens/MapHistoryScreen.tsx (object branch)'], normal_navigation: ['Hike/Run Finish → MapHistory(sessionId)', 'Trails Activity row → MapHistory(sessionId)'], incoming_ids: ['sessionId/clientActivityId'], stores_apis: ['useSessionStore', 'useMarkerStore', 'useRouteStore', '/api/sessions/:id'], gates: ['none'], theme_source: 'useVisualTheme', tests: ['activityRouteState', 'completed Activity/source contract tests'], image_evidence: ['VIS-019', 'VIS-026', 'VIS-033'], entry_classification: 'NORMAL_USER' },
  { page_id: 'PAGE-ROUTE-DETAIL', page: 'Route Detail', primary_job: 'Review one saved Route and choose Edit/Use.', secondary_job: 'Rename/delete Route.', owns: ['ROUTE-01', 'ROUTE-04'], must_not_own: ['Claim active following when only reference line exists', 'Rewrite source Activity'], maturity: 'NORMALLY_REACHABLE / ERROR_HANDLING_PARTIAL / NOT_ACCEPTED', gaps: ['Layers no-op', 'Rename/delete failure feedback', 'Unknown ID loading/not-found', 'Native renderer proof'], future_direction: 'Review with Editor and Use journey after Own Cairn/All Cairns slice.', component_paths: ['app/src/screens/MapHistoryScreen.tsx (route object branch)'], normal_navigation: ['Trails Route row → MapHistory(routeId)'], incoming_ids: ['routeId'], stores_apis: ['useRouteStore', '/api/routes/:id'], gates: ['none'], theme_source: 'useVisualTheme', tests: ['route store/offline and UI source contracts'], image_evidence: ['VIS-020', 'VIS-027', 'VIS-034'], entry_classification: 'NORMAL_USER' },
  { page_id: 'PAGE-ROUTE-EDITOR', page: 'Route Editor', primary_job: 'Edit and save a Route draft.', secondary_job: 'Create Route from Activity and change personal/friend visibility.', owns: ['ROUTE-02', 'RQ-ROUTE-005', 'RQ-ROUTE-006'], must_not_own: ['Mutate source Activity', 'Claim server provenance that is local only'], maturity: 'NORMALLY_REACHABLE / WEB_MAP_FALLBACK / PARTIAL_FAILURE_HANDLING', gaps: ['Gear no-op', 'Delete failure catch', 'Post-create landing mismatch', 'Server provenance loss'], future_direction: 'Bounded Route Detail/Editor/Use slice.', component_paths: ['app/src/screens/RouteEditorScreen.tsx', 'app/src/store/useRouteEditStore.ts'], normal_navigation: ['Route Detail → Edit', 'Activity Detail → Save as Route'], incoming_ids: ['routeId', 'sourceActivityId/draft ID'], stores_apis: ['useRouteStore', 'useRouteEditStore', '/api/routes'], gates: ['editModeEnabled', 'debug QA telemetry branch'], theme_source: 'useVisualTheme', tests: ['route edit/store/offline tests'], image_evidence: ['VIS-021', 'VIS-028', 'VIS-035'], entry_classification: 'NORMAL_USER' },
  { page_id: 'PAGE-PLANT', page: 'Plant / Quick Cairn', primary_job: 'Create a durable Cairn from a trustworthy location.', secondary_job: 'Optionally add title/body/voice/visibility; link to active Activity.', owns: ['CAIRN-01', 'RQ-CAIRN-001', 'RQ-CAIRN-002'], must_not_own: ['All Cairns retrieval', 'Public moderation policy'], maturity: 'FULL_PLANT_REACHABLE / QUICK_ACTION_REACHABLE / DEVICE_DURABILITY_UNVERIFIED', gaps: ['Title-in-note schema debt', 'Quick Cairn retrieval after creation', 'No current reconnect device proof'], future_direction: 'Preserve current creation; converge on canonical Detail/retrieval.', component_paths: ['app/src/screens/PlantScreen.tsx', 'app/src/screens/RunningScreen.tsx'], normal_navigation: ['Home → Plant', 'Hike → Cairn → Plant', 'Run → Cairn (Quick)'], incoming_ids: ['active tracking session implied'], stores_apis: ['useMarkerStore', 'useTrackingStore', 'offlineMarkers', '/api/markers'], gates: ['Public option hidden'], theme_source: 'useVisualTheme', tests: ['plantTitleBody', 'marker fast-ack/tombstone contracts'], image_evidence: ['VIS-022', 'VIS-029', 'VIS-036'], entry_classification: 'NORMAL_USER' },
  { page_id: 'PAGE-OWN-CAIRN', page: 'Own Cairn Detail', primary_job: 'Review/edit/delete one own Cairn.', secondary_job: 'Show origin/time/permission/map.', owns: ['CAIRN-02', 'RQ-CAIRN-004', 'RQ-CAIRN-005'], must_not_own: ['Non-owner moderation without reachable identity', 'All Cairns index'], maturity: 'REACHABLE_AFTER_FULL_PLANT / PARTIAL_DNA / NOT_ACCEPTED', gaps: ['No normal personal index', 'Native map/device proof', 'Potential exact-coordinate presentation'], future_direction: 'Review with All Cairns product decision.', component_paths: ['app/src/screens/MarkerDetailScreen.tsx'], normal_navigation: ['Successful full Plant → MarkerDetail(markerId)', 'Own marker sheet → full Detail'], incoming_ids: ['markerId/localId'], stores_apis: ['useMarkerStore', '/api/markers/:id'], gates: ['owner and sync state controls edit/delete availability'], theme_source: 'useVisualTheme', tests: ['marker tombstone/fast-ack tests'], image_evidence: ['VIS-023', 'VIS-030', 'VIS-037'], entry_classification: 'NORMAL_USER' },
  { page_id: 'PAGE-NONOWNER-CAIRN', page: 'Non-owner Cairn Detail', primary_job: 'Future safe friend/public Cairn review and explicit interactions.', secondary_job: 'Like/report/hide/Thanks under approved privacy semantics.', owns: ['CAIRN-04', 'CAIRN-05'], must_not_own: ['Implicit encounter inference', 'Visitor location disclosure'], maturity: 'SOURCE_COMPONENTS_ONLY / NORMAL_ENTRY_UNREACHABLE', gaps: ['circleMarkers disconnected', 'public markers unpressable', 'full screen resolves own store only', 'hide no-op'], future_direction: 'Do not build until authorization/privacy/moderation decisions.', component_paths: ['app/src/features/memory/components/CairnPinsLayer.tsx', 'MarkDetailSheet components', 'app/src/screens/MarkerDetailScreen.tsx'], normal_navigation: [], incoming_ids: ['No normal supported non-owner ID path'], stores_apis: ['circleMarkers/publicMarkers', 'markerInteractionService'], gates: ['public pins deliberately unpressable'], theme_source: 'useVisualTheme', tests: ['lower-layer interaction tests only'], image_evidence: [], entry_classification: 'UNREACHABLE' },
  { page_id: 'PAGE-ALL-CAIRNS', page: 'All Cairns', primary_job: 'Future personal Cairn retrieval/index.', secondary_job: 'Recency/search/reopen/edit/delete boundaries.', owns: ['CAIRN-03'], must_not_own: ['Reopen accepted Trails IA without decision'], maturity: 'MISSING', gaps: ['No screen', 'No normal entry', 'No visual evidence'], future_direction: 'Needs product decision; do not fabricate/build in audit.', component_paths: [], normal_navigation: [], incoming_ids: [], stores_apis: ['Lower-level own marker cache/API only'], gates: [], theme_source: 'none', tests: [], image_evidence: [], entry_classification: 'UNREACHABLE' },
  { page_id: 'PAGE-MEMORY', page: 'Memory', primary_job: 'View personal explored evidence.', secondary_job: 'Switch friend display scope, choose friends, revisit own Cairns, inspect place hierarchy.', owns: ['MEM-01', 'MEM-02', 'MEM-04'], must_not_own: ['Count friend fog as personal', 'Infer Encounter', 'Bypass owner grant'], maturity: 'NORMAL_ENTRY / FEATURE_RICH_SOURCE / DIVERGENT_VISUAL_AND_SECURITY_BOUNDARY', gaps: ['Known friend auth P0', 'circle markers disconnected', 'Web loading/runtime error', 'Final visual language open'], future_direction: 'Personal Memory page slice before Friends sharing layer.', component_paths: ['app/src/features/memory/screens/MemoryScreen.tsx', 'MemoryMap.tsx', 'FogLayer.tsx'], normal_navigation: ['Home → Memory'], incoming_ids: [], stores_apis: ['useMemoryStore', 'useFriendMemoryStore', 'useMemorySubscriptionsStore', '/api/memory/points', '/api/circle/fog'], gates: ['paid friend selection cap', 'foreground exploration setting'], theme_source: 'useVisualTheme plus map adapter', tests: ['memory evidence/settings/sync tests'], image_evidence: ['VIS-024', 'VIS-031', 'VIS-038'], entry_classification: 'NORMAL_USER' },
  { page_id: 'PAGE-SETTINGS', page: 'Settings', primary_job: 'Manage account, preferences, privacy/data, and help/about.', secondary_job: 'Expose version/build and destructive account/data contracts.', owns: ['MEM-03', 'SET-01', 'SET-02', 'SET-03'], must_not_own: ['Internal Debug in normal production UI', 'Claim backend contracts not deployed'], maturity: 'STRONG_SOURCE_DNA / DEPLOYMENT_CONTRACT_MISMATCH', gaps: ['Feedback endpoint absent in production', 'Deletion timing mismatch', 'Export content/version mismatch', 'No update ID'], future_direction: 'Preserve UI; separate release-contract containment.', component_paths: ['app/src/screens/SettingsScreen.tsx'], normal_navigation: ['Home → Settings'], incoming_ids: [], stores_apis: ['useSettingsStore', 'authService', '/api/auth/me', '/api/account/*', '/api/memory/*'], gates: ['Debug intentionally not exposed'], theme_source: 'useVisualTheme/useScenicTimeState', tests: ['settingsProductConvergence', 'settingsServerActions'], image_evidence: ['VIS-025', 'VIS-032', 'VIS-039', 'VIS-041'], entry_classification: 'NORMAL_USER' },
  { page_id: 'PAGE-DNA-REF', page: 'Home / Friends / Auth references', primary_job: 'Provide accepted navigation and visual-family anchors.', secondary_job: 'Regression reference for shared changes.', owns: ['AUTH-01', 'FRI-01'], must_not_own: ['This audit’s unresolved detail-page decisions'], maturity: 'BOUNDED_ACCEPTED_REFERENCE', gaps: ['Not re-audited comprehensively'], future_direction: 'Keep no change; regression-check shared dependencies.', component_paths: ['HomeScreen', 'FriendsScreen', 'AuthScreen'], normal_navigation: ['Auth gate', 'Home actions'], incoming_ids: [], stores_apis: ['useAppStore', 'useFriendStore'], gates: ['Auth gate'], theme_source: 'canonical visual family', tests: ['existing visual authority artifacts'], image_evidence: ['REF-001'], entry_classification: 'NORMAL_USER' },
];

const actionFlows = [
  { action_id: 'ACTN-001', page: 'Hike/Run', entry: 'Ready screen Start', conditions: 'location available; optional Route selection', handler: 'startTracking with single-flight/epoch guards', change: 'idle→starting→tracking and WAL/session ownership', persistence: 'local journal plus session API/outbox', feedback: 'transition/status and errors in recording chrome', destination: 'same recording page', issue: 'Native/field behavior unverified.' },
  { action_id: 'ACTN-002', page: 'Hike/Run', entry: 'Pause / Resume', conditions: 'tracking / paused', handler: 'pauseTracking / resumeTracking', change: 'lifecycle and timers/location work', persistence: 'tracking journal/context', feedback: 'button/status/transition labels', destination: 'same page', issue: 'Rapid Resume protected in source/tests; physical recovery unknown.' },
  { action_id: 'ACTN-003', page: 'Hike/Run', entry: 'Finish', conditions: 'tracking/paused/recovering; eligibility varies', handler: 'open intent snapshot; confirm later stopTracking', change: 'none until confirm; then finalizes Activity', persistence: 'local completed Activity and server sync', feedback: 'confirmation/too-short sheet and failure states', destination: 'Activity Detail on success', issue: 'Too-short Continue resumes paused state.' },
  { action_id: 'ACTN-004', page: 'Hike/Run', entry: 'Finish sheet Cancel', conditions: 'intent open', handler: 'dismiss sheet', change: 'restores prior captured lifecycle', persistence: 'none', feedback: 'returns to prior chrome', destination: 'same page', issue: 'Regular path covered; current device unverified.' },
  { action_id: 'ACTN-005', page: 'Hike', entry: 'Cairn', conditions: 'fresh accepted Activity fix', handler: 'navigate Plant', change: 'none until Plant Cairn', persistence: 'Plant outbox only on confirmation', feedback: 'compose screen', destination: 'returns to Activity after successful create', issue: 'Audit did not confirm create.' },
  { action_id: 'ACTN-006', page: 'Run', entry: 'Cairn', conditions: 'fresh accepted fix ≤30s', handler: 'addMarker + linkMarker', change: 'creates private empty Cairn linked to Activity', persistence: 'durable local entity/outbox', feedback: 'success/error toast', destination: 'same Run page', issue: 'No immediate Detail/retrieval path.' },
  { action_id: 'ACTN-007', page: 'Trails', entry: 'Activities / Routes tabs', conditions: 'always', handler: 'local tab state', change: 'view only', persistence: 'none', feedback: 'segmented selected state', destination: 'same page', issue: 'Accepted IA; no Cairns tab.' },
  { action_id: 'ACTN-008', page: 'Trails', entry: 'Search/filter', conditions: 'loaded arrays', handler: 'client filter/mode selection', change: 'view only', persistence: 'none', feedback: 'filtered list/no results', destination: 'same page', issue: 'Loaded subset only; no pagination proof.' },
  { action_id: 'ACTN-009', page: 'Trails', entry: 'Activity/Route row', conditions: 'row present', handler: 'navigate MapHistory with sessionId/routeId', change: 'navigation', persistence: 'none', feedback: 'Detail page', destination: 'canonical current MapHistory branch', issue: 'Normal reachability YES.' },
  { action_id: 'ACTN-010', page: 'Activity Detail', entry: 'Rename', conditions: 'own Activity', handler: 'await update with feedback', change: 'Activity name', persistence: 'local/server according to store', feedback: 'error retained', destination: 'same detail', issue: 'Device/deployed proof partial.' },
  { action_id: 'ACTN-011', page: 'Activity Detail', entry: 'Delete', conditions: 'own Activity and confirmation', handler: 'await delete', change: 'removes Activity', persistence: 'local/server', feedback: 'failure remains; success resets Trails', destination: 'Trails', issue: 'Not invoked in audit.' },
  { action_id: 'ACTN-012', page: 'Activity Detail', entry: 'Save as Route / Review route', conditions: 'route readiness state', handler: 'create transient editor draft', change: 'new Route draft only', persistence: 'not server until outer Save', feedback: 'Route Editor', destination: 'Route Editor', issue: 'Successful new Save remains in editor view, not canonical Route Detail.' },
  { action_id: 'ACTN-013', page: 'Route Detail', entry: 'Layers', conditions: 'visible', handler: 'none/TODO', change: 'none', persistence: 'none', feedback: 'none', destination: 'same page', issue: 'Visible UI without handler.' },
  { action_id: 'ACTN-014', page: 'Route Detail', entry: 'Rename', conditions: 'own Route', handler: 'updateRoute invoked without await/catch', change: 'optimistic/store mutation', persistence: 'route store/API', feedback: 'no screen-level failure feedback', destination: 'same detail', issue: 'Swallowed/unrepresented failure.' },
  { action_id: 'ACTN-015', page: 'Route Detail', entry: 'Delete', conditions: 'second tap confirmation', handler: 'deleteRoute fired, then goBack immediately', change: 'store/API deletion or rollback', persistence: 'route store/API', feedback: 'no failure feedback after navigation', destination: 'back immediately', issue: 'Async failure hidden.' },
  { action_id: 'ACTN-016', page: 'Route Detail', entry: 'Use for a Hike/Run', conditions: 'Route present; detail loaded if necessary', handler: 'navigate Hike/Run with routeId', change: 'pre-start reference selection', persistence: 'none beyond store availability', feedback: 'Route selected · shown on the map for guidance', destination: 'Hike/Run pre-start', issue: 'Does not call setFollowingRoute; not active following.' },
  { action_id: 'ACTN-017', page: 'Route Editor', entry: 'Edit / inner Save / Cancel', conditions: 'existing/draft Route', handler: 'useRouteEditStore session', change: 'in-memory/persisted local edit draft', persistence: 'draft session; outer Save required for Route', feedback: 'edit overlays/warnings', destination: 'view mode or prior screen', issue: 'Web map unavailable; native proof missing.' },
  { action_id: 'ACTN-018', page: 'Route Editor', entry: 'Outer Save', conditions: 'name and valid points', handler: 'create/update Route', change: 'durable local outbox/server Route', persistence: 'route cache/outbox/API', feedback: 'saving/alert errors', destination: 'existing goes back; new resets Home→RouteEditor(view)', issue: 'New Route landing diverges from canonical Detail.' },
  { action_id: 'ACTN-019', page: 'Route Editor', entry: 'Gear', conditions: 'edit mode', handler: 'empty TODO callback', change: 'none', persistence: 'none', feedback: 'none', destination: 'same page', issue: 'Visible no-op.' },
  { action_id: 'ACTN-020', page: 'Plant', entry: 'Confirm spot', conditions: 'standalone pin and GPS sample', handler: 'advance to content', change: 'local draft step', persistence: 'draft only on failed create', feedback: 'compose screen', destination: 'same Plant flow', issue: 'Web/native map boundary differs.' },
  { action_id: 'ACTN-021', page: 'Plant', entry: 'Plant Cairn', conditions: 'valid location; content optional', handler: 'addMarker', change: 'stable pending own Cairn', persistence: 'owner-scoped entity/outbox', feedback: 'alert on failure', destination: 'MarkerDetail standalone; Activity when launched from Activity', issue: 'Not invoked in audit.' },
  { action_id: 'ACTN-022', page: 'Own Cairn Detail', entry: 'Edit / Save', conditions: 'owner; synced requires online', handler: 'update marker/local entity', change: 'note/type/permission', persistence: 'pending local vs synced API differ', feedback: 'editing availability/catch', destination: 'same detail', issue: 'Title is encoded inside note.' },
  { action_id: 'ACTN-023', page: 'Own Cairn Detail', entry: 'Delete', conditions: 'owner; synced requires online', handler: 'delete marker/tombstone', change: 'removes/hides object', persistence: 'local tombstone and/or API', feedback: 'availability/error', destination: 'back', issue: 'Not invoked in audit.' },
  { action_id: 'ACTN-024', page: 'Memory', entry: 'Mine / Friends', conditions: 'screen ready; friends subject to subscription/paywall', handler: 'local scope state', change: 'view projection only', persistence: 'scope reset to Mine on focus', feedback: 'segmented state/map fog', destination: 'same page', issue: 'Friend authorization unsafe; circle Cairns absent.' },
  { action_id: 'ACTN-025', page: 'Memory', entry: 'Own Cairn pin', conditions: 'own marker supplied', handler: 'open MarkDetailSheet/full detail path', change: 'view only until actions', persistence: 'none', feedback: 'sheet/detail', destination: 'own detail family', issue: 'Non-owner data not normally supplied.' },
  { action_id: 'ACTN-026', page: 'Memory', entry: 'Public blurred pin', conditions: 'outside explored fog/public bbox', handler: 'deliberately not pressable', change: 'none', persistence: 'none', feedback: 'blurred presence only', destination: 'none', issue: 'Does not prove non-owner Detail.' },
  { action_id: 'ACTN-027', page: 'Memory non-owner sheet', entry: 'Hide from my map', conditions: 'sheet somehow opened with non-owner fixture', handler: 'close only', change: 'none', persistence: 'none', feedback: 'sheet closes', destination: 'Memory', issue: 'No-op pending implementation.' },
  { action_id: 'ACTN-028', page: 'Settings', entry: 'Appearance / Units / Haptics', conditions: 'root visible', handler: 'saveAll/updateSetting', change: 'persisted local preference', persistence: 'local storage', feedback: 'immediate UI selection/theme', destination: 'same page', issue: 'Map renderer parity not implied.' },
  { action_id: 'ACTN-029', page: 'Settings', entry: 'Export request', conditions: 'privacy page and network', handler: 'POST export then poll status', change: 'server job', persistence: 'backend job', feedback: 'queued/ready/failed/download', destination: 'same page/external download', issue: 'Not invoked; deployed contract/content partial.' },
  { action_id: 'ACTN-030', page: 'Settings', entry: 'Delete Memory / Delete account', conditions: 'destructive confirmation', handler: 'server mutation then local state changes', change: 'irreversible/scheduled destructive state', persistence: 'server authority plus local clear', feedback: 'confirmation/error/auth flow', destination: 'Memory state or Auth', issue: 'Not invoked; account timing mismatch.' },
  { action_id: 'ACTN-031', page: 'Settings', entry: 'Send feedback', conditions: 'valid message/network', handler: 'POST /api/account/feedback', change: 'feedback record', persistence: 'server', feedback: 'ack/retry', destination: 'same page', issue: 'Not invoked; production endpoint absent in prior evidence.' },
  { action_id: 'ACTN-032', page: 'Shared navigation', entry: 'Back', conditions: 'stack entry', handler: 'navigation goBack', change: 'navigation only', persistence: 'none', feedback: 'prior page', destination: 'origin-dependent', issue: 'Post-create Route reset makes Back go Home rather than Route Detail.' },
];

const findings = [
  { finding_id: 'F-001', severity: 'P0', classification: 'KNOWN_PRODUCTION_SECURITY_P0', problem: 'Friend Memory subscriptions/fog were not server-authorized against owner grant/current relationship in prior production evidence.', prerequisites: 'Production backend as verified by prior audit; no live retest here.', evidence_available: ['DEP-008'], evidence_missing: ['New isolated deployment proof'], affected: ['Memory', 'Friends', 'Backend'], blocks: { internal_personal_ui_review: false, real_recording: false, sharing_pilot: true, external_release: true }, recommendation: 'Separately approve narrow authorization/migration/query/cache containment; do not test real users.' },
  { finding_id: 'F-002', severity: 'P0', classification: 'DEPLOYMENT_MISMATCH', problem: 'O56 feedback and seven-day deletion promises do not match the previously verified production backend.', prerequisites: 'Published O56/source vs prior backend identity.', evidence_available: ['DEP-013', 'DEP-015'], evidence_missing: ['Approved deployment and device E2E'], affected: ['Settings', 'Auth', 'Release'], blocks: { internal_personal_ui_review: false, real_recording: false, sharing_pilot: true, external_release: true }, recommendation: 'Separate approved release-contract containment; no deployment authorized by this audit.' },
  { finding_id: 'F-003', severity: 'HIGH', classification: 'UNIMPLEMENTED_CANDIDATE_REQUIREMENT', problem: 'All Cairns is absent and not normally reachable.', prerequisites: 'Current navigation and Trails source.', evidence_available: ['SRC-012', 'DEP-005'], evidence_missing: ['Approved entry/IA'], affected: ['All Cairns', 'Own Cairn Detail', 'Quick Cairn retrieval'], blocks: { internal_personal_ui_review: false, real_recording: false, sharing_pilot: false, external_release: false }, recommendation: 'Make an explicit page/entry decision in page sequence 3; do not add an equal Trails tab by default.' },
  { finding_id: 'F-004', severity: 'HIGH', classification: 'MISSING_WIRING', problem: 'Non-owner Cairn Detail forms/services exist but no normal friend/public Cairn can reach them.', prerequisites: 'Current store projections/navigation.', evidence_available: ['SRC-016', 'SRC-018', 'SRC-020'], evidence_missing: ['Approved privacy/encounter/moderation behavior'], affected: ['Memory', 'Non-owner Cairn Detail'], blocks: { internal_personal_ui_review: false, real_recording: false, sharing_pilot: true, external_release: true }, recommendation: 'Keep unreachable until authorization and product decisions are approved.' },
  { finding_id: 'F-005', severity: 'HIGH', classification: 'IMPLEMENTATION_DEFECT', problem: 'Paused → too-short Finish → Continue resumes instead of preserving paused state.', prerequisites: 'Paused Activity below eligibility threshold.', evidence_available: ['SRC-010', 'SRC-011'], evidence_missing: ['Current iPhone reproduction/user choice'], affected: ['Hike', 'Run'], blocks: { internal_personal_ui_review: true, real_recording: false, sharing_pilot: false, external_release: false }, recommendation: 'Review in CARD-01; repair only in a separately approved bounded slice.' },
  { finding_id: 'F-006', severity: 'HIGH', classification: 'INSUFFICIENT_EVIDENCE', problem: 'Hike/Run native Mapbox integration, attribution hitboxes, current O56 loading, and current NZ field behavior remain unverified.', prerequisites: 'Physical iPhone candidate.', evidence_available: ['VIS-001', 'HIST-001'], evidence_missing: ['Current native screenshots/recording'], affected: ['Hike', 'Run'], blocks: { internal_personal_ui_review: true, real_recording: true, sharing_pilot: false, external_release: true }, recommendation: 'Run the small iPhone checklist before code changes.' },
  { finding_id: 'F-007', severity: 'MEDIUM', classification: 'VISIBLE_NO_OP', problem: 'Route Detail Layers and Route Editor gear controls have no implemented action.', prerequisites: 'Open Route Detail/Editor.', evidence_available: ['SRC-013', 'SRC-014'], evidence_missing: ['Approved intended jobs'], affected: ['Route Detail', 'Route Editor'], blocks: { internal_personal_ui_review: true, real_recording: false, sharing_pilot: false, external_release: false }, recommendation: 'In Route slice, either wire an approved job or remove only after explicit decision.' },
  { finding_id: 'F-008', severity: 'HIGH', classification: 'IMPLEMENTATION_DEFECT', problem: 'Route rename/delete async failures are not surfaced reliably; delete navigates away immediately.', prerequisites: 'Server/offline failure.', evidence_available: ['SRC-013'], evidence_missing: ['Runtime failure capture'], affected: ['Route Detail'], blocks: { internal_personal_ui_review: true, real_recording: false, sharing_pilot: false, external_release: false }, recommendation: 'Bounded error-handling correction in Route slice.' },
  { finding_id: 'F-009', severity: 'MEDIUM', classification: 'NAVIGATION_INCONSISTENCY', problem: 'Save as Route completes into RouteEditor view with Back to Home, not canonical Route Detail.', prerequisites: 'Activity Detail Save as Route.', evidence_available: ['SRC-014'], evidence_missing: ['Explicit owner choice'], affected: ['Activity Detail', 'Route Editor', 'Route Detail'], blocks: { internal_personal_ui_review: true, real_recording: false, sharing_pilot: false, external_release: false }, recommendation: 'Decide canonical post-create landing in Route slice.' },
  { finding_id: 'F-010', severity: 'HIGH', classification: 'DATA_CONTRACT_GAP', problem: 'Route provenance/version/walked-planned distinctions do not survive server round-trip.', prerequisites: 'Edit/save/reopen on another device.', evidence_available: ['DEP-003'], evidence_missing: ['Approved schema semantics'], affected: ['Route Editor', 'Route Detail', 'Activity Detail'], blocks: { internal_personal_ui_review: false, real_recording: false, sharing_pilot: true, external_release: true }, recommendation: 'Product/schema decision before relaxing edit semantics.' },
  { finding_id: 'F-011', severity: 'MEDIUM', classification: 'RETRIEVAL_COMPLETENESS_GAP', problem: 'Trails search and 300-item tests cover loaded arrays, not full server history/pagination.', prerequisites: 'History beyond loaded/cache subset.', evidence_available: ['TEST-001', 'SRC-012'], evidence_missing: ['Retention/pagination requirement'], affected: ['Trails'], blocks: { internal_personal_ui_review: false, real_recording: false, sharing_pilot: false, external_release: false }, recommendation: 'Decide full-history scope in later Trails integration.' },
  { finding_id: 'F-012', severity: 'MEDIUM', classification: 'STATE_WITHOUT_WORKER', problem: 'No durable reconnect Final enhancement worker was proven despite refinement/readiness states.', prerequisites: 'Unfinished final geometry after relaunch/offline.', evidence_available: ['DEP-002'], evidence_missing: ['Durable executor proof'], affected: ['Activity Detail', 'Route creation'], blocks: { internal_personal_ui_review: true, real_recording: false, sharing_pilot: false, external_release: true }, recommendation: 'Align UI promises with real executor in Activity Detail slice.' },
  { finding_id: 'F-013', severity: 'MEDIUM', classification: 'SCHEMA_DEBT', problem: 'Plant title/body is encoded into one note field using U+001E.', prerequisites: 'Create/edit/sync/export Cairn with title.', evidence_available: ['TEST-001', 'SRC-015'], evidence_missing: ['Approved durable schema'], affected: ['Plant', 'Cairn Detail', 'Exports'], blocks: { internal_personal_ui_review: false, real_recording: false, sharing_pilot: false, external_release: false }, recommendation: 'Keep current UI; treat schema as later prerequisite, not audit implementation.' },
  { finding_id: 'F-014', severity: 'HIGH', classification: 'VISUAL_INTEGRATION_GAP', problem: 'Memory current Web capture remained on loading overlay and raised one runtime undefined-index error; final Memory visual language is explicitly open.', prerequisites: 'Synthetic Memory fixture on Expo Web.', evidence_available: ['VIS-024', 'VIS-031', 'VIS-038', 'RUNTIME-001', 'SRC-003'], evidence_missing: ['Native current map-ready state'], affected: ['Memory'], blocks: { internal_personal_ui_review: true, real_recording: false, sharing_pilot: true, external_release: true }, recommendation: 'Treat captures as loading-state evidence only; review Personal Memory later.' },
  { finding_id: 'F-015', severity: 'HIGH', classification: 'STARTUP_SIDE_EFFECT', problem: `A preview/dev runtime points at production and screen review attempted ${capture.blocked_writes.length} edit-diag telemetry POSTs; interception was essential.`, prerequisites: 'Fixture navigation with debug false.', evidence_available: ['RUNTIME-001'], evidence_missing: ['Production telemetry policy/retention review'], affected: ['App startup', 'Diagnostics', 'All pages'], blocks: { internal_personal_ui_review: false, real_recording: false, sharing_pilot: false, external_release: true }, recommendation: 'Future automated review must keep a write-deny interceptor; do not call preview isolated.' },
  { finding_id: 'F-016', severity: 'MEDIUM', classification: 'VISUAL_INTEGRATION_GAP', problem: 'Detail pages remain mixed: Trails/Settings are strongly tokenized, Activity/Route Details are partial, Own Cairn Detail is divergent, and Memory final language is open.', prerequisites: 'Day/Sunset/Night fixture comparison.', evidence_available: ['VIS-BOARD-001', 'VIS-BOARD-002'], evidence_missing: ['Explicit owner acceptance/native states'], affected: ['Activity Detail', 'Route Detail', 'Route Editor', 'Own Cairn Detail', 'Memory'], blocks: { internal_personal_ui_review: true, real_recording: false, sharing_pilot: false, external_release: false }, recommendation: 'Review page-by-page; do not perform a global redesign.' },
  { finding_id: 'F-017', severity: 'MEDIUM', classification: 'SOURCE_DIVERGENCE_RISK', problem: 'Current local source is a 321-entry dirty tree and cannot be equated with the published O56 bundle merely because HEAD matches.', prerequisites: 'Current repo state.', evidence_available: ['GIT-001', 'DEP-001'], evidence_missing: ['Bundle-to-file attestation'], affected: ['All pages', 'Release identity'], blocks: { internal_personal_ui_review: false, real_recording: false, sharing_pilot: false, external_release: true }, recommendation: 'Identify the installed candidate before review; avoid deployment claims from local source.' },
  { finding_id: 'F-018', severity: 'HIGH', classification: 'EXTERNAL_CONFIGURATION_GAP', problem: 'Purchases/entitlement and TestFlight availability remain nonoperational or unknown.', prerequisites: 'App Store/RevenueCat dashboards.', evidence_available: ['DEP-016', 'DEP-020'], evidence_missing: ['Dashboard/store/tester evidence'], affected: ['Payments', 'External beta'], blocks: { internal_personal_ui_review: false, real_recording: false, sharing_pilot: false, external_release: true }, recommendation: 'Retain as later owner-check scope; do not test purchases now.' },
  { finding_id: 'F-019', severity: 'MEDIUM', classification: 'VISUAL_LAYOUT_RISK', problem: 'The representative 320×568 Expo Web Hike capture clips the top chrome and lower Start control at viewport edges.', prerequisites: 'Hike Ready, Sunset, Expo Web 320×568.', evidence_available: ['VIS-040'], evidence_missing: ['Supported native small-iPhone reproduction'], affected: ['Hike', 'Run shared chrome'], blocks: { internal_personal_ui_review: true, real_recording: false, sharing_pilot: false, external_release: false }, recommendation: 'Treat as a Web/small-size risk, not a native defect conclusion; include a small physical device in CARD-01 if available.' },
];

const sharedRoleMap = [
  { role: 'Scenic theme state', canonical: 'useVisualTheme + useScenicTimeState + tokens.ts', current: 'All scoped pages consume theme; maps vary by renderer.', divergence: 'Web adapter replaces native Standard v3 with outdoors-v12.', affected: ['All pages', 'Memory/Plant/Cairn maps'], proposal: 'KEEP; document renderer boundaries.' },
  { role: 'Recording chrome', canonical: 'ActivityRecordingChrome', current: 'Hike and Run share top metrics/status and bottom docks.', divergence: 'Mode-specific labels/metrics are expected; native map unproven.', affected: ['Hike', 'Run'], proposal: 'KEEP; review on iPhone before edits.' },
  { role: 'Back navigation', canonical: 'BackButton', current: 'Used across main/detail/editor pages.', divergence: 'Post-create Route stack makes Back return Home.', affected: ['Route Editor', 'Route Detail'], proposal: 'KEEP component; fix journey only after decision.' },
  { role: 'Primary/secondary/destructive actions', canonical: 'PrimaryButton and semantic theme tokens', current: 'Settings/Plant use canonical components; details mix local TouchableOpacity styles.', divergence: 'MapHistory has 26 literal hex occurrences; Hike/Run each 24; Memory 12; Marker Detail 6.', affected: ['Hike', 'Run', 'Activity/Route Detail', 'Cairn Detail', 'Memory'], proposal: 'EXTEND/REPLACE only per approved page slice; inspect semantic use, not raw count alone.' },
  { role: 'Content surfaces/sheets', canonical: 'ContentSurface + ModalCard/material tokens', current: 'Trails/Settings strong; Details use local bottom-panel systems.', divergence: 'Own Cairn Detail and Memory read as different generations.', affected: ['Activity Detail', 'Route Detail', 'Own Cairn Detail', 'Memory'], proposal: 'SHARED_VISUAL_FIX only after page acceptance criteria.' },
  { role: 'Fields', canonical: 'TextField and accepted field tokens', current: 'Settings canonical; Route/Plant/Detail include local TextInput styling.', divergence: 'Cross-page focus/error/keyboard evidence incomplete.', affected: ['Plant', 'Route Editor', 'Details', 'Settings'], proposal: 'REUSE/EXTEND narrowly.' },
  { role: 'Segmented controls', canonical: 'shared visual tokens and page-local controls', current: 'Trails tabs and Settings appearance are clear in three themes.', divergence: 'Memory scope is over map and loading state obscures review.', affected: ['Trails', 'Settings', 'Memory'], proposal: 'KEEP accepted patterns; review Memory separately.' },
  { role: 'Map renderer', canonical: 'Native RNMapbox; mapboxAdapter only for Web QA where supported', current: 'Hike/Run native area blank on Web; Activity/Route use TrackPolyline fallback; Editor says Map unavailable; Plant/Cairn/Memory use real Web adapter.', divergence: 'No one Web capture category proves native integration.', affected: ['All map pages'], proposal: 'KEEP renderer truth labels; require native evidence for acceptance.' },
  { role: 'Status/error/retry', canonical: 'semantic status tokens + real executor', current: 'Activity state surface strong; Route mutation feedback and Memory loading are incomplete.', divergence: 'Some states lack worker or surfaced error.', affected: ['Activity Detail', 'Route Detail', 'Memory'], proposal: 'NARROW prerequisite per page.' },
  { role: 'Accepted art anchors', canonical: 'Locked Home family + Auth background + manifest assets', current: 'Settings uses scenic background; detail pages largely flat/map-led.', divergence: 'No permission to invent a new visual direction.', affected: ['Any future shared visual change including Home/Friends/Auth'], proposal: 'KEEP locked assets and regression-check references.' },
];

const priorAuditArtifacts = [
  '00_DEPLOYED_BASELINE.md', '01_MEMORY_FRIENDS_PERMISSIONS.md', '02_CAIRN_ENCOUNTERS_ROUTE_TRUST.md',
  '03_APPLE_BILLING_AND_UNIT_ECONOMICS.md', '04_NZ_BETA_RELEASE_READINESS.md',
  '05_CAPABILITY_MATRIX_AND_DEPENDENCIES.md', 'CAPABILITY_MATRIX.csv', 'SUMMARY.md', 'HANDOFF.json',
].map(name => ({ path: `docs/review/product-system-v1-audit/${name}`, sha256: hashFile(path.join(priorDir, name)), accounted_for: true }));

const evidence = [
  { evidence_id: 'GIT-001', type: 'git_baseline', description: 'Start HEAD/status fingerprints.', detail: { head: '12fa1cd0ef599e53a81cd30537ce761c5e2150ce', branch: 'master', origin_master: '12fa1cd0ef599e53a81cd30537ce761c5e2150ce', porcelain_entries: 321, staged: 0, unstaged_modified: 101, unstaged_deleted: 1, untracked: 219, sorted_status_sha256: '7168e85b85b374b5e399e0d718d30e60a3df1946ed7039f5b054c72917b109d6', binary_diff_sha256: '1f87436ac61fcdcec4cf4680196a03ad4cacfee9f7ca5f527955a7e2cdb3cb35' } },
  { evidence_id: 'DEP-001', type: 'prior_deployment', description: 'Inherited client identity.', detail: { app_version: '0.2.6', runtime_version: '0.2.6', native_build: '56', marker: 'O56', update_group: '9b3a3dcc-03b6-4300-a97b-317ee0a7441b', update_id: '01a09c0e-993b-759b-95e8-084f1f45238f', ota_bundle_sha256: 'b210b673…', device_loaded: 'UNKNOWN', evidence_date: '2026-09-15/16 prior audit' } },
  { evidence_id: 'DEP-002', type: 'prior_audit', description: 'No durable reconnect Final enhancement worker proven.', detail: { source: '02_CAIRN_ENCOUNTERS_ROUTE_TRUST.md / capability matrix' } },
  { evidence_id: 'DEP-003', type: 'prior_audit', description: 'Route provenance/version not durable server data.', detail: { capability: 'ROUTE-03' } },
  { evidence_id: 'DEP-004', type: 'prior_audit', description: 'Friend Route lower layer without normal consumer.', detail: { capability: 'ROUTE-05' } },
  { evidence_id: 'DEP-005', type: 'source_and_prior_audit', description: 'All Cairns missing.', detail: { capability: 'CAIRN-03' } },
  { evidence_id: 'DEP-006', type: 'source_and_prior_audit', description: 'Cairn interactions lower layer unreachable.', detail: { capability: 'CAIRN-05' } },
  { evidence_id: 'DEP-007', type: 'prior_audit', description: 'Passive Memory provenance gap.', detail: { capability: 'MEM-02' } },
  { evidence_id: 'DEP-008', type: 'prior_production_evidence', description: 'Friend-fog authorization P0 retained without live retest.', detail: { capabilities: ['MEM-05', 'MEM-06', 'MEM-07'], evidence_date: '2026-09-15/16', live_retest_this_run: false } },
  { evidence_id: 'DEP-009', type: 'prior_audit', description: 'No Encounter domain.', detail: { capability: 'ENC-01' } },
  { evidence_id: 'DEP-010', type: 'prior_audit', description: 'Friends core partial deployed/device evidence.', detail: { capability: 'FRI-01' } },
  { evidence_id: 'DEP-011', type: 'prior_audit', description: 'No moderation operations.', detail: { capability: 'MOD-01' } },
  { evidence_id: 'DEP-012', type: 'prior_audit', description: 'No encounter lifecycle.', detail: { capability: 'ENC-01' } },
  { evidence_id: 'DEP-013', type: 'prior_production_evidence', description: 'Feedback client present, production endpoint/table absent.', detail: { capability: 'SET-01' } },
  { evidence_id: 'DEP-014', type: 'prior_production_evidence', description: 'Export client/backend mismatch and geometry omission.', detail: { capability: 'SET-02' } },
  { evidence_id: 'DEP-015', type: 'prior_production_evidence', description: 'Seven-day client copy vs five-minute production deletion.', detail: { capability: 'SET-03' } },
  { evidence_id: 'DEP-016', type: 'prior_release_evidence', description: 'RevenueCat SDK present; O56 key/config not operational.', detail: { capability: 'PAY-01' } },
  { evidence_id: 'DEP-017', type: 'prior_audit', description: 'No server entitlement authority.', detail: { capability: 'PAY-02' } },
  { evidence_id: 'DEP-018', type: 'prior_audit', description: 'Mapbox token/warmup partial; device pack proof missing.', detail: { capability: 'MAP-01' } },
  { evidence_id: 'DEP-019', type: 'source_and_prior_audit', description: 'Diagnostics build/debug gated; installed access unknown.', detail: { capability: 'DIAG-01' } },
  { evidence_id: 'DEP-020', type: 'external_unknown', description: 'App Store Connect/TestFlight dashboard unavailable.', detail: { capability: 'REL-02' } },
  { evidence_id: 'TEST-001', type: 'focused_automated_test', description: '12 focused suites / 116 tests passed.', detail: { command: 'cd app && npm test -- --runInBand <12 listed suites>', suites: 12, tests: 116, snapshots: 0, result: 'PASS', limitation: 'Several suites are source-string or in-memory contract tests; no native/device/deployed proof.', warning: 'Jest reported unknown setupFilesAfterFramework option.' } },
  { evidence_id: 'RUNTIME-001', type: 'isolated_expo_web_capture', description: 'Fresh-context fixture capture with all product API writes denied.', detail: { captures: capture.captures.length, boards: capture.boards.length, blocked_edit_diag_posts: capture.blocked_writes.length, runtime_errors: capture.runtime_errors, no_product_write_reached_production: true } },
  { evidence_id: 'HIST-001', type: 'historical_phone_screenshots', description: 'Six /Desktop/54 WebP files inspected as historical leads.', detail: { files: ['1789287526805-m943ae7em8.webp', '1789287526813-ac9hdcp1lai.webp', '1789287526813-ac9hdcp1lai (1).webp', '1789287526813-ac9hdcp1lai (2).webp', '1789287526813-ac9hdcp1lai (3).webp', '1789287526820-rxgvc2qlgep.webp'], observation: 'Run/native Mapbox-looking urban recording; five near-duplicates; Chinese street labels; current O56/NZ identity not established.', packaged: false, exclusion_reason: 'Unredacted private-looking map context; not necessary current evidence.' } },
  { evidence_id: 'REF-001', type: 'visual_authority', description: 'Accepted/frozen visual reference boards and docs inspected.', detail: { files: ['docs/qa/visual-migration/final/product-unity-board.jpg', 'docs/qa/visual-migration/final/day-night-board.jpg', 'docs/qa/visual-migration/final/weather-board.jpg', 'docs/VISUAL_SYSTEM.md', 'docs/CAIRNNZ_VISUAL_DNA.md'] } },
  { evidence_id: 'VIS-BOARD-001', type: 'visual_board', description: 'Trails/detail/editor Day/Sunset/Night board.', detail: { path: 'visual/images/board-library-detail-editor.jpg' } },
  { evidence_id: 'VIS-BOARD-002', type: 'visual_board', description: 'Plant/Cairn/Memory/Settings Day/Sunset/Night board.', detail: { path: 'visual/images/board-cairn-memory-settings.jpg' } },
  ...sourceInventory,
  ...capture.captures.map(item => ({ evidence_id: item.evidence_id, type: 'visual_capture', description: `${item.page} / ${item.state} / ${item.theme}`, detail: item })),
];

const decisionChanges = [
  { change_id: 'DC-001', previous_requirement: 'Earlier Trails/Cairn-list review artifacts and forced flags tab implied a Cairn list inside Trails.', new_proposal: 'Keep accepted Trails Activities/Routes IA; decide a separate All Cairns entry.', reason: 'Current source and latest explicit boundary reject an equal Cairns tab.', approval_evidence: 'Full task §4 accepts Activities/Routes primary structure. The separate All Cairns entry remains unapproved.' },
  { change_id: 'DC-002', previous_requirement: 'Route Use could be read as active following/voice guidance because lower-layer hook/tests exist.', new_proposal: 'Treat current Use as pre-start map reference only; active following is later scope.', reason: 'No normal setFollowingRoute caller exists.', approval_evidence: 'Implementation fact only; future active-following product decision remains unapproved.' },
  { change_id: 'DC-003', previous_requirement: 'A redesigned creation/recording page could be interpreted as completing its Detail family.', new_proposal: 'Audit Activity, Route, Editor, and Cairn Detail independently.', reason: 'Latest owner feedback explicitly rejects that inference.', approval_evidence: 'Full task §3 explicit latest owner feedback.' },
];

const proposedCard = {
  card_id: 'CARD-01',
  status: 'AWAITING_USER_APPROVAL',
  title: 'First iPhone Hike/Run evidence review — no code changes',
  user_job_and_objective: 'Confirm whether the exact installed candidate’s Hike and Run recording controls and native map presentation are usable before selecting a repair slice.',
  already_satisfied_to_preserve: ['Shared lifecycle/store/WAL/recovery architecture', 'Hike/Run common chrome with distinct metric priorities', 'Finish intent snapshot and regular Cancel preservation', 'Private, stable Activity-linked Cairn creation contracts'],
  allowed_future_scope: ['Run the checklist in 04_FIRST_IPHONE_REVIEW.md', 'Return exact version identity and bounded screenshots/observations', 'Classify any reproduced issue as control, map/visual, deployment identity, or field behavior'],
  prohibited_future_scope: ['No source changes', 'No OTA/backend deployment', 'No global visual redesign', 'No Memory/friend/public/payment/destructive production testing'],
  dependencies: ['Installed iPhone candidate with O marker/app/build identity', 'Safe location permission and a short personal test route', 'Debug tests only if the entry genuinely exists'],
  user_acceptance_criteria: ['Day/Sunset/Night controls, route, puck, and legal controls are distinguishable.', 'Recording/Paused Finish→Cancel preserves state; Pause/Resume feedback, timer, and movement recover together.', 'Finish opens the current Activity Detail and Back/Trails reach the same object.', 'Returned evidence includes exact version details and minimum screenshots.', 'Any Debug result is labeled simulation evidence, not native background/NZ field proof.'],
  automated_vs_device_boundary: 'Existing 12-suite/116-test proof and Expo Web captures cover source contracts/chrome only. Native RNMapbox, real Core Location, installed OTA, and owner acceptance require the iPhone.',
  risk_and_rollback: 'Low risk because this card changes nothing. Stop the test if version identity is wrong, controls lock, location permission is absent, or safety conditions are unsuitable.',
  reasoning_recommendation: 'Use High for a straightforward evidence review; XHigh only if returned evidence shows cross-layer lifecycle/map/deployment contradictions requiring forensic analysis.',
  product_choices_requiring_confirmation: ['Whether the paused too-short Continue behavior should remain paused.', 'Whether any reproduced issue warrants a controls slice or a visual/map slice first.', 'Whether the current Activity Detail is sufficient as a review landing, not final design acceptance.'],
};

const register = {
  schema_version: '1.0.0',
  audit_id: runId,
  generated_at: iso,
  language: 'English',
  audit_scope: 'READ_ONLY_REQUIREMENTS_PAGE_UI_ACCEPTANCE_BASELINE',
  verdict: 'AUDIT_COMPLETE_PRODUCT_NOT_COMPLETE',
  authority: {
    task_file: '/Users/mzm/Desktop/CAIRN_REQUIREMENTS_UI_BASELINE_AUDIT_PROMPT_EN.md',
    task_file_sha256: hashFile('/Users/mzm/Desktop/CAIRN_REQUIREMENTS_UI_BASELINE_AUDIT_PROMPT_EN.md'),
    supersedes_for_this_audit: 'Earlier Chinese version',
    project_authority_file: 'NOT_FOUND',
    candidate_blueprints_are_authority: false,
  },
  git_baseline: evidence[0].detail,
  deployment_baseline: {
    inherited_from_prior_audit: true,
    client: evidence[1].detail,
    backend: { commit: '6c8e623…', image: 'sha256:b7b0…', deployed_schema_ledger: '034', local_unapplied_for_production: '035', live_reverified_this_run: false },
    profiles: 'development/preview/production share https://api.yiiling.cn except a dev-simulator localhost fallback; preview is not isolated',
    current_source_attributable_to_ota: 'UNKNOWN_DIRTY_WORKTREE',
  },
  prior_audit_artifacts: priorAuditArtifacts,
  missing_materials: missingMaterials,
  source_inventory: sourceInventory,
  requirements,
  capability_crosswalk: capabilityCrosswalk,
  decision_changes: decisionChanges,
  pages,
  action_flows: actionFlows,
  findings,
  shared_role_map: sharedRoleMap,
  evidence,
  visual_capture_summary: {
    count: capture.captures.length,
    themes: ['day', 'sunset', 'night'],
    viewports: [...new Set(capture.captures.map(item => item.viewport))],
    capture_type: 'EXISTING_COMPONENT_WITH_FIXTURE',
    renderer_boundaries: ['Expo Web native-map blank/substitute', 'Expo Web TrackPolyline fallback', 'Expo Web Map unavailable fallback', 'Real Web Mapbox adapter'],
    boards: capture.boards,
    runtime_limitations: capture.runtime_errors,
    prevented_product_writes: capture.blocked_writes.length,
  },
  capture_plan: {
    prepared_before_runtime: true,
    priority_matrix: 'Hike/Run Ready+Recording and scoped pages in Day/Sunset/Night at 390×844',
    representative_sizes: ['Hike Ready Sunset at 320×568', 'Settings Root Night at 430×932'],
    renderer_labels_required: true,
    isolation: 'Fresh context, synthetic fixtures, all Cairn API reads intercepted and writes denied',
    prohibited_actions: ['Activity start/finish', 'Plant confirmation', 'feedback submit', 'export request', 'Memory reset', 'account deletion', 'purchase', 'real friend-location access'],
  },
  focused_test_summary: evidence.find(item => item.evidence_id === 'TEST-001').detail,
  proposed_next_task_card: proposedCard,
  open_decisions: requirements.filter(item => ['NEEDS_PRODUCT_DECISION'].includes(item.proposed_disposition)).map(item => item.requirement_id),
  unallocated_requirements: requirements.filter(item => item.proposed_disposition === 'UNALLOCATED').map(item => item.requirement_id),
  coverage_checks: {
    prior_capability_count: capabilityCrosswalk.length,
    requirement_count: requirements.length,
    page_count: pages.length,
    finding_count: findings.length,
    all_capabilities_crosswalked: capabilityCrosswalk.length === 33 && uncovered.length === 0,
    all_requirements_have_owner_and_disposition: requirements.every(item => item.primary_page_or_shared_owner && item.proposed_disposition),
    exactly_one_proposed_task_card: true,
    all_cairns_reachability: 'UNREACHABLE_MISSING',
    nonowner_cairn_detail_reachability: 'UNREACHABLE_NORMAL_USER_SOURCE_COMPONENTS_ONLY',
    user_accepted_page_count: 0,
  },
  audit_only_proof: {
    product_source_modified_by_audit: false,
    existing_tests_or_snapshots_modified: false,
    dependencies_or_configuration_modified: false,
    marker_or_version_modified: false,
    backend_or_deployment_modified: false,
    destructive_or_commercial_actions_executed: false,
    product_api_writes_reached_production: false,
    note: 'Final unrelated-worktree comparison is recorded in VALIDATION.json.',
  },
};

write('REQUIREMENTS_REGISTER.json', JSON.stringify(register, null, 2));

function csvCell(value) {
  const text = Array.isArray(value) ? value.join('|') : value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
const csvHeaders = [
  'requirement_id', 'parent_capability_ids', 'user_need', 'decision_status', 'decision_classification', 'decision_source',
  'primary_page_or_shared_owner', 'secondary_affected_pages', 'current_behavior', 'gap_type', 'proposed_disposition',
  'current_source', 'user_reachability', 'automated_proof', 'deployed_match', 'device_loaded', 'real_field_validation',
  'visual_evidence_level', 'dna_alignment', 'user_acceptance', 'user_acceptance_source', 'dependencies',
  'dependency_classification', 'candidate_slice', 'acceptance_criteria', 'evidence_ids', 'known_open_issues', 'test_scope_limitations', 'open_question',
];
const csvRows = requirements.map(item => ({
  ...item,
  parent_capability_ids: item.parent_capability_ids,
  decision_classification: item.decision_source.classification,
  decision_source: item.decision_source.reference,
  current_source: item.evidence_dimensions.current_source,
  user_reachability: item.evidence_dimensions.user_reachability,
  automated_proof: item.evidence_dimensions.automated_proof,
  deployed_match: item.evidence_dimensions.deployed_match,
  device_loaded: item.evidence_dimensions.device_loaded,
  real_field_validation: item.evidence_dimensions.real_field_validation,
  visual_evidence_level: item.evidence_dimensions.visual_evidence_level,
  dna_alignment: item.evidence_dimensions.dna_alignment,
  user_acceptance: item.evidence_dimensions.user_acceptance,
  user_acceptance_source: item.evidence_dimensions.user_acceptance_source,
  known_open_issues: item.evidence_dimensions.known_open_issues,
  test_scope_limitations: item.evidence_dimensions.test_scope_limitations,
}));
write('REQUIREMENTS_REGISTER.csv', [csvHeaders.join(','), ...csvRows.map(row => csvHeaders.map(key => csvCell(row[key])).join(','))].join('\n'));

const sourceFingerprintByPage = Object.fromEntries(pages.map(page => {
  const files = page.component_paths.map(value => path.join(repoRoot, value.split(' (')[0])).filter(fs.existsSync);
  const aggregate = sha256(files.sort().map(file => `${rel(file)}:${hashFile(file)}`).join('\n'));
  return [page.page.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), aggregate];
}));
const pageSourceMap = {
  hike: 'hike', run: 'run', trails: 'trails', 'activity-detail': 'activity-detail', 'route-detail': 'route-detail',
  'route-editor': 'route-editor', plant: 'plant-quick-cairn', 'own-cairn-detail': 'own-cairn-detail', memory: 'memory', settings: 'settings',
};
const manifestCaptures = capture.captures.map(item => ({
  capture_id: item.evidence_id,
  page: item.page,
  theme: item.theme,
  viewport: item.viewport,
  ui_state: item.state,
  entry_type: item.entry_mode,
  renderer: item.renderer,
  data_source: item.data,
  source_fingerprint: sourceFingerprintByPage[pageSourceMap[item.page]] ?? sha256(JSON.stringify(sourceInventory)),
  app_runtime_ota_backend_identity: {
    captured_code: `HEAD 12fa1cd dirty current source; not attributable to deployed O56`,
    app: '0.2.6', runtime: '0.2.6', marker_in_source: 'O56', installed_ota: 'UNKNOWN', backend_match: 'NOT_USED_API_FIXTURES',
  },
  capture_time: capture.captured_at,
  mock_or_fixture_boundaries: item.fixture_boundary,
  what_this_proves: `The current existing ${item.page} component renders this ${item.state} chrome/state on Expo Web at ${item.viewport} under ${item.theme} with synthetic fixtures.`,
  what_this_does_not_prove: item.notes.concat(['Normal navigation unless separately sourced.', 'Deployed/native/device/field quality.', 'Explicit user acceptance.']),
  relative_file: item.file,
}));
const visualManifest = {
  schema_version: 1,
  audit_id: runId,
  offline_readable: true,
  privacy: { synthetic_only: true, historical_private_looking_images_excluded: true, secrets_or_tokens_included: false },
  isolation: capture.isolation,
  runtime_limitations: capture.runtime_errors,
  prevented_requests: { product_api_writes: capture.blocked_writes.length, unique_target: 'POST api.yiiling.cn/api/edit-diag' },
  captures: manifestCaptures,
  boards: capture.boards.map((file, index) => ({ board_id: `BOARD-${index + 1}`, relative_file: file })),
  missing_pages: [
    { page: 'All Cairns', reachability: 'UNREACHABLE', reason: 'No current page/normal entry; no fabricated screenshot.' },
    { page: 'Non-owner Cairn Detail', reachability: 'UNREACHABLE_NORMAL_USER', reason: 'Source components only; no fabricated successful workflow.' },
  ],
};
write('visual/manifest.json', JSON.stringify(visualManifest, null, 2));

const htmlCards = manifestCaptures.map(item => `<article class="card" data-page="${item.page}" data-theme="${item.theme}"><a href="${item.relative_file}"><img loading="lazy" src="${item.relative_file}" alt="${item.page}, ${item.ui_state}, ${item.theme}"></a><div class="meta"><h3>${item.page} · ${item.ui_state} · ${item.theme}</h3><p><b>${item.renderer}</b> · ${item.entry_type} · ${item.data_source}</p><p>${item.what_this_proves}</p><details><summary>Evidence limits</summary><ul>${item.what_this_does_not_prove.map(value => `<li>${value}</li>`).join('')}</ul></details><code>${item.capture_id}</code></div></article>`).join('\n');
write('visual/index.html', `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cairn UI Requirements Audit ${runId}</title>
<style>body{margin:0;background:#17201d;color:#f2efe7;font:15px/1.5 system-ui,-apple-system,sans-serif}header,main{max-width:1280px;margin:auto;padding:24px}h1{font-size:28px}.notice{background:#2a3632;border:1px solid #53645d;border-radius:14px;padding:16px;margin:16px 0}.warn{border-color:#b58a47}.boards{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}.boards img{width:100%;border-radius:12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px}.card{background:#222d29;border:1px solid #3c4b45;border-radius:14px;overflow:hidden}.card img{display:block;width:100%;height:auto;background:#111}.meta{padding:14px}.meta h3{margin:0 0 8px;font-size:16px}.meta p{color:#c8d0cc}.meta code{color:#b8d9c9}a{color:#c8ebdb}li{margin:4px 0}</style></head><body>
<header><h1>Cairn requirements / page baseline visual board</h1><p>Run ${runId} · ${capture.captures.length} full-resolution Expo Web captures · synthetic fixtures · Day / Sunset / Night · 320×568 / 390×844 / 430×932.</p>
<div class="notice warn"><b>Evidence boundary:</b> forced test routes prove existing component rendering, not normal navigation, native Mapbox, deployment, device loading, field quality, or user acceptance. All product API writes were denied. The app attempted ${capture.blocked_writes.length} edit-diag POSTs, all blocked. Memory produced one Web runtime error and remained in its loading state.</div>
<div class="notice"><b>Absent, not mocked:</b> All Cairns has no current page/normal entry. Non-owner Cairn Detail has source components but no normal friend/public entry. No success screenshot was fabricated.</div></header>
<main><h2>Composite review boards</h2><section class="boards">${capture.boards.map(file => `<a href="${file}"><img src="${file}" alt="Composite review board"></a>`).join('')}</section>
<h2>Full-resolution captures</h2><section class="grid">${htmlCards}</section></main></body></html>`);

const capabilityTable = capabilityCrosswalk.map(row => `| ${row.capability_id} | ${row.surface} | ${row.current_disposition} | ${row.child_requirement_ids.join(', ')} | ${row.drift_note} |`).join('\n');
const pageTable = pages.map(page => `| ${page.page} | ${page.entry_classification} | ${page.maturity} | ${page.gaps.join('; ')} |`).join('\n');
const findingTable = findings.map(item => `| ${item.finding_id} | ${item.severity} | ${item.classification} | ${item.problem} |`).join('\n');
const reqSummary = Object.entries(requirements.reduce((acc, item) => { acc[item.proposed_disposition] = (acc[item.proposed_disposition] ?? 0) + 1; return acc; }, {})).map(([key, value]) => `- ${key}: ${value}`).join('\n');

write('00_REVIEW_SUMMARY.md', `# Cairn requirements / page baseline audit review summary

Audit run: \`${runId}\`  
Verdict: **The audit is complete; the product is not complete and no scoped page receives a new user-acceptance PASS.**

## What this audit adds

- One authoritative ${requirements.length}-record requirements register derived into CSV, with every original 33 capability IDs crosswalked.
- Page/flow baselines for Hike, Run, Trails, Activity Detail, Route Detail, Route Editor, Plant/Quick Cairn, Own Cairn Detail, Memory, and Settings.
- An explicit reachability result: **All Cairns is missing/unreachable; non-owner Cairn Detail is source-present but normally unreachable.**
- ${capture.captures.length} full-resolution Day/Sunset/Night Expo Web fixture captures (390×844 main matrix plus representative 320×568 and 430×932) and three offline boards, each labeled by renderer and fixture boundary.
- Focused verification: 12 suites / 116 tests passed. Several are source-string or in-memory contracts; they do not establish native/deployed/device/field/user acceptance.
- Exactly one next card: **CARD-01 first iPhone Hike/Run evidence review, with no code changes.**

## P0 risks remain separate from page review

1. **Friend-fog authorization:** prior production evidence found arbitrary-user/cap/query/revoke exposure. It was not retested against real users. Sharing pilot/external release remain blocked until separately approved containment is deployed and isolated proof exists.
2. **Release truth:** O56 advertises feedback and seven-day account restoration while the previously verified production backend lacked feedback and used a five-minute deletion schedule. No backend change/deploy is authorized here.

These do not prevent safe personal UI review, but they must stay visible and must not be conflated with CARD-01.

## Current page verdicts

| Page | Reachability | Current maturity | Important gaps |
|---|---|---|---|
${pageTable}

Hike/Run have substantial shared lifecycle/offline work and coherent chrome, but Expo Web only proves surrounding chrome; the native map, current installed O56, current NZ field behavior, and owner acceptance are unknown. Trails’ Activities/Routes IA is explicitly retained, but search is limited to loaded data and downstream Details remain unaccepted. Activity and Route Details are normally reachable, yet error handling, renderer proof, final-worker truth, and visual integration remain incomplete. Full Plant and Own Cairn Detail are reachable; Quick Cairn is durable but lacks a strong later-retrieval surface. Memory’s personal/friend implementation is broad but its final visual language is open, the friend authorization P0 remains, circle Cairns are disconnected, and this Web run showed only the loading state after one runtime error. Settings is visually aligned, while its deployed contracts are not.

## Requirements allocation

${reqSummary}

No requirement is \`UNALLOCATED\`. Candidate inclusion is not approval: All Cairns entry, non-owner Detail/privacy, Route provenance, full-history retrieval, export contents, Memory social semantics, Encounter, Moderation, payments, and NZ/offline expansion still require later decisions.

## Runtime safety and limitation

The capture used a fresh browser profile, synthetic identity/coordinates, intercepted read fixtures, and a write-deny policy. No product API write reached production. The app nevertheless attempted **${capture.blocked_writes.length} POSTs to \`/api/edit-diag\`**, all blocked. This demonstrates why a preview build pointing at production is not isolated. Historical \`/Desktop/54\` phone images were inspected only as leads and excluded from the archive because they contain private-looking urban map context and do not establish current O56/NZ identity.

## First recommendation

Approve or reject **CARD-01** in \`03_PAGE_LED_SLICE_PLAN.md\`: a small, no-code iPhone Hike/Run evidence review using \`04_FIRST_IPHONE_REVIEW.md\`. Do not select a visual or control implementation slice until the exact device candidate and native symptoms are known.
`);

const pageSections = pages.map(page => `## ${page.page}

1. **Primary job:** ${page.primary_job}
2. **Secondary job:** ${page.secondary_job}
3. **Owns:** ${page.owns.join(', ')}
4. **Must not own:** ${page.must_not_own.join('; ')}
5. **Current maturity:** ${page.maturity}
6. **Important gaps:** ${page.gaps.join('; ')}
7. **Future direction:** ${page.future_direction}

- Components: ${page.component_paths.length ? page.component_paths.map(value => `\`${value}\``).join(', ') : 'none'}
- Normal path: ${page.normal_navigation.length ? page.normal_navigation.join('; ') : 'none'}
- Entry class: \`${page.entry_classification}\`
- Incoming IDs: ${page.incoming_ids.length ? page.incoming_ids.join(', ') : 'none'}
- Stores/APIs: ${page.stores_apis.join(', ')}
- Gates: ${page.gates.length ? page.gates.join('; ') : 'none'}
- Theme: ${page.theme_source}
- Tests: ${page.tests.length ? page.tests.join('; ') : 'none'}
- Image evidence: ${page.image_evidence.length ? page.image_evidence.join(', ') : 'none'}
`).join('\n');

const actionsByPage = actionFlows.reduce((acc, item) => { (acc[item.page] ??= []).push(item); return acc; }, {});
const actionSections = Object.entries(actionsByPage).map(([pageName, items]) => `### ${pageName}

| Action | Conditions → handler | Change / persistence | Feedback / destination | Gap |
|---|---|---|---|---|
${items.map(item => `| ${item.entry} | ${item.conditions} → ${item.handler} | ${item.change}; ${item.persistence} | ${item.feedback}; ${item.destination} | ${item.issue} |`).join('\n')}`).join('\n\n');

write('01_PAGE_AND_FLOW_BASELINE.md', `# Page and action-flow baseline

This report describes current source and bounded runtime evidence. A forced route is never counted as normal reachability. Destructive actions were source-traced but not invoked.

## Reachability headline

- **All Cairns:** \`UNREACHABLE\` / missing. Own marker storage and old forced \`initialTab: flags\` scripts do not constitute a page.
- **Non-owner Cairn Detail:** \`UNREACHABLE\` for a normal user. Forms/services are source-present, but Memory supplies own markers only, circle markers are disconnected, and public pins are unpressable.
- **Own Cairn Detail:** \`NORMAL_USER\` after successful full Plant and from own-marker surfaces.
- **Activity Detail and Route Detail:** \`NORMAL_USER\` from Trails; Activity Detail also follows successful Finish.

${pageSections}

# Action trace

${actionSections}

# Required journey conclusions

- **Hike/Run → Finish → Activity Detail → Back:** source-wired; regular Cancel preserves the prior snapshot; native/device journey remains unverified.
- **Paused → Finish → Cancel:** source/tests support preservation. **Paused → too-short Continue** resumes and is a bounded discrepancy.
- **Quick/Plant → retrieval/detail:** full Plant reaches Own Cairn Detail; Quick Cairn stays in Run and later retrieval is weak because All Cairns is absent.
- **Trails Activity → same Activity Detail:** yes by session/client Activity ID.
- **Activity → Save as Route → reopen:** new Route draft and persistence exist, but successful creation lands in RouteEditor view, not canonical Route Detail.
- **Route Detail → Edit/Use:** normal path exists; Use supplies a pre-start reference line, not active following.
- **Personal Memory → Cairn Detail:** own marker path exists. Friend/public path does not.
- **Appearance:** shared source applies Day/Sunset/Night, but each renderer must be judged separately.
`);

const roleRows = sharedRoleMap.map(item => `| ${item.role} | ${item.canonical} | ${item.current} | ${item.divergence} | ${item.affected.join(', ')} | ${item.proposal} |`).join('\n');
write('02_UI_DNA_AND_SHARED_DEPENDENCIES.md', `# UI DNA and shared dependencies

## Authority and image review

The audit inspected \`docs/VISUAL_SYSTEM.md\`, \`docs/VISUAL_MIGRATION_STATE.md\`, \`docs/VISUAL_ASSET_MANIFEST.json\`, \`docs/CAIRNNZ_VISUAL_DNA.md\`, the north-star lock, canonical Home/Friends/Auth boards, prior detail-convergence boards, and current Trails/Settings boards. The accepted anchor is the locked Home Day/Sunset/Night family plus Auth art quality—not a generic redesign invitation. Memory’s final visual language remains open.

Open \`visual/index.html\` offline. Its ${capture.captures.length} full-resolution captures use existing components and synthetic fixtures. The three boards are:

- \`visual/images/board-activity-day-sunset-night.jpg\`
- \`visual/images/board-library-detail-editor.jpg\`
- \`visual/images/board-cairn-memory-settings.jpg\`

## Concrete observations

- Hike/Run chrome is coherent across themes, but the Web capture says **Map unavailable**. This proves surrounding layout only. It cannot judge route/puck/basemap/Mapbox legal-control quality.
- The representative 320×568 Hike Web capture clips the top chrome and lower Start control. This is a small-Web-layout risk, not proof of a native iPhone defect; the 430×932 Settings capture remains fully readable.
- Trails’ Activities/Routes segmented structure, density, and theme contrast align well with the current DNA. That is not acceptance of full-history retrieval or its Details.
- Activity/Route Detail use a consistent map-plus-bottom-sheet composition and are reasonably aligned, but their Web line renderer is a fallback, not native Mapbox. Route Detail exposes a no-op Layers control.
- Route Editor shares the family but renders **Map unavailable** on Web and exposes a no-op gear. The bottom panel is usable, though it is not the canonical Route Detail destination.
- Plant is strongly tokenized and consistent. Own Cairn Detail is visually more divergent: large pale/blank map area, local detail system, and exact-coordinate display. It must be reviewed independently from Plant.
- Memory remained on **Opening your map** in all three captures after one runtime error. The underlying Web Mapbox canvas exists, but these images prove only the current loading state. Native Standard v3 is not represented: Web substitutes outdoors-v12.
- Settings is the strongest scoped non-reference page: canonical surfaces, scenic backgrounds, fields, segmented Appearance, and destructive hierarchy align across Day/Sunset/Night. Deployed behavior still disagrees with UI copy.
- Literal-color scan (not a defect count): Hike 24, Run 24, MapHistory 26, Route Editor 1, Marker Detail 6, Memory 12; Trails/Plant/Settings 0. Many are legacy/semantic/local styles, so future work must inspect usage before replacing them.

## Shared-role mapping

| UI role | Canonical component/token | Current implementation | Local divergence | Affected pages | Proposed keep/replace/extend |
|---|---|---|---|---|---|
${roleRows}

## Cross-page dependency rules

- Changes to \`tokens.ts\`, \`useVisualTheme\`, \`BackButton\`, \`PrimaryButton\`, \`ContentSurface\`, map-style selection, or icon semantics can affect accepted Home/Friends/Auth even if those files are untouched.
- Hike/Run shared chrome should be corrected once, while mode-specific metric priorities remain local.
- Detail convergence should not become a global rewrite. Page-specific action/data defects are prerequisites; shared visual extraction follows only when two or more approved pages need the same role.
- No Web renderer category is upgraded to native evidence. No blank map or visible token is called Mapbox quality proof.
`);

write('03_PAGE_LED_SLICE_PLAN.md', `# Page-led slice plan

This plan allocates requirements; it does not authorize implementation.

## Sequence and dependency guidance

0. Keep version identification in the immediate review and handle the known friend-authorization/release-contract P0s only through separately approved containment.
1. Review Hike/Run on the actual iPhone candidate before choosing control or visual changes.
2. Review Activity Detail truth, final-worker copy, native layout, and finish/list convergence.
3. Decide Own Cairn Detail plus the separate All Cairns entry; preserve accepted Trails Activities/Routes IA.
4. Review Route Detail, Editor, Save-as-Route landing, error handling, and Use-as-reference. Do not imply active following.
5. Perform Trails-to-detail integration after Details are resolved.
6. Review Personal Memory loading/truth/DNA.
7. Only after security containment, decide Friends authorization, sharing controls, and shared projections.
8. Encounter/Public, moderation, commercial, full planning, and NZ expansion remain later domains.

## Duplicate-work prevention

- Reuse ActivityRecordingChrome and existing lifecycle/store guards.
- Reuse the existing MapHistory object branches; do not create parallel Activity/Route Details without an explicit migration decision.
- Reuse clientCairnId/localId/tombstone identity; do not introduce a second Cairn identity.
- Keep Route and Activity independent; explicit Route edits never rewrite Activity.
- Keep Trails Activities/Routes. All Cairns requires a separately approved entry.
- Correct shared tokens/components only where an approved page need is demonstrated; regression-check Home/Friends/Auth.

## Exactly one proposed next task card

### ${proposedCard.card_id} — ${proposedCard.title}

**Status:** ${proposedCard.status}

**User job and objective:** ${proposedCard.user_job_and_objective}

**Already satisfied and must remain intact**

${proposedCard.already_satisfied_to_preserve.map(value => `- ${value}`).join('\n')}

**Allowed future scope**

${proposedCard.allowed_future_scope.map(value => `- ${value}`).join('\n')}

**Prohibited future scope**

${proposedCard.prohibited_future_scope.map(value => `- ${value}`).join('\n')}

**Minimum dependencies**

${proposedCard.dependencies.map(value => `- ${value}`).join('\n')}

**User acceptance criteria**

${proposedCard.user_acceptance_criteria.map((value, index) => `${index + 1}. ${value}`).join('\n')}

**Automated/device boundary:** ${proposedCard.automated_vs_device_boundary}

**Risk and rollback:** ${proposedCard.risk_and_rollback}

**Reasoning recommendation:** ${proposedCard.reasoning_recommendation}

**Product choices requiring confirmation**

${proposedCard.product_choices_requiring_confirmation.map(value => `- ${value}`).join('\n')}

## Unapproved decisions retained

${requirements.filter(item => item.proposed_disposition === 'NEEDS_PRODUCT_DECISION').map(item => `- \`${item.requirement_id}\`: ${item.user_need}`).join('\n')}

No requirement is UNALLOCATED. No recommendation marked LATER_SLICE or NEEDS_PRODUCT_DECISION is approval to build.
`);

write('04_FIRST_IPHONE_REVIEW.md', `# First iPhone review — Hike and Run only

This is one small review, not whole-app acceptance. Do not begin until the installed candidate is identified.

## Version prerequisite

1. On Home, retain a screenshot showing the existing **O56** marker.
2. In Settings → Help & About/About, retain app version **0.2.6** and build **56** if shown.
3. The ordinary UI does **not** expose the Expo update ID. If available from the owner’s existing EAS/update record, retain update ID \`01a09c0e-993b-759b-95e8-084f1f45238f\`; otherwise record \`UPDATE_ID_UNKNOWN\`.
4. If any displayed identity differs, stop and classify the review as \`BLOCKED_BY_VERSION_IDENTITY\`. Publication alone does not prove the phone loaded it.

Use a safe short route, adequate battery, normal permissions, and no sharing/public/destructive/commercial actions.

## Group 1 — Recording chrome and native map in three appearances

**Prerequisites:** identified build, safe outdoor/known location, Hike and Run available.  
**Steps:** For Hike and Run, inspect Ready then a short Recording state in Day, Sunset, and Night. Do not change global design settings mid-hazard. Check map, route reference if one is safely available, puck, metrics, GPS state, Mapbox logo/info, Back, Pause/Cairn/Finish.  
**Expected:** controls and selected/unselected states remain distinct; route/puck/basemap do not collapse; legal controls do not overlap core actions; Sunset/Night text remains legible.  
**Retain:** one full-screen Ready and one Recording screenshot per appearance/mode, plus version identity.  
**Proves:** current installed native composition. **Does not prove:** long-duration GPS, background behavior, NZ generalization, or user acceptance of Details.

## Group 2 — Pause/Resume and Finish→Cancel state truth

**Prerequisites:** one safely active Hike and Run with movement.  
**Steps:** Pause; open Finish; Cancel; verify still paused. Resume once, then tap Resume repeatedly only if the UI still permits it; observe one transition. Open Finish while recording; Cancel; verify recording continues. Move again and observe timer/location/route progress together. If a too-short sheet appears while paused, record whether **Continue** preserves paused or resumes—do not assume.  
**Expected:** regular Cancel preserves exact prior state; one Resume transition; Finish/Back stay available during recovery; time/location recover coherently.  
**Retain:** screenshots before Finish, in confirmation, after Cancel, and after subsequent movement; note timestamps and mode.  
**Proves:** current physical interaction/lifecycle presentation. **Does not prove:** source silence, background Core Location, long offline recovery, or every race.

## Group 3 — Clean Path and Raw GPS only if Debug is genuinely reachable

**Prerequisites:** a visible authorized Debug entry in this exact installed build. If absent, record \`BLOCKED_BY_BUILD_GATE\` and stop this group. Do not unlock it or search for a hidden gesture.  
**Steps:** Use the actual current UI mode names **Clean Path** and **Raw GPS**. Run one scenario in each mode separately; retain seed, observation timing, delivery timing, and mode. Include stationary-with-continuing-fixes and complete-source-silence as separate cases if the UI supports them.  
**Expected:** simulated provider is explicit; source observations, canonical acceptance, and UI state are not conflated.  
**Retain:** mode screen, seed/settings, and resulting diagnostic state.  
**Proves:** simulator/diagnostic contracts only. Frozen ground truth with continuing observations differs from stopping all simulator output. Stationary does not prove source health; no new canonical point does not prove source loss. Simulation cannot prove real Core Location background, low-battery, or NZ field behavior.

## Group 4 — Finish landing and bounded Trails check

**Prerequisites:** a short personal test Activity whose creation is acceptable to retain; do not delete production history.  
**Steps:** Finish normally. Confirm the current **Activity Detail** opens for that Activity. Review name, stats, route/sync/refinement language, Cairns, actions, and Back. Then Home → Trails → Activities → open the same Activity → Back. If a personal Route already safely exists, Trails → Routes → Detail → Back; do not delete/edit it.  
**Expected:** newly finished and historical entry reach the same Activity object/Detail; Back is predictable; existing promises match actual state.  
**Retain:** finish landing, Trails row, reopened Detail, and version identity.  
**Proves:** landing/navigation consistency on this candidate. **Does not prove:** Activity/Route Detail final design acceptance, durable final worker, mutation error handling, or full-history pagination.

## Current-state observations only

Memory and Activity/Route/Cairn Details are not final acceptance tasks in this first review. Do not treat seeing them as approval. Do not test real friend-location access, non-owner sharing, Memory reset, account deletion, purchases, feedback submission, export jobs, public reporting/hiding, or production mutations. Missing Debug/device/permission capability makes only the affected row UNVERIFIED; it does not invalidate the local audit.
`);

const handoff = {
  schema_version: 1,
  audit_id: runId,
  verdict: 'AUDIT_COMPLETE_PRODUCT_NOT_COMPLETE',
  primary_register: 'REQUIREMENTS_REGISTER.json',
  run_directory: runDir,
  desktop_archive: `/Users/mzm/Desktop/Cairn_UI_Requirements_Audit_${runId}.zip`,
  source_identity: register.git_baseline,
  deployment_identity: register.deployment_baseline,
  materials: { prior_audit_artifacts: priorAuditArtifacts, missing: missingMaterials },
  key_findings: findings.map(item => item.finding_id),
  unallocated_requirements: register.unallocated_requirements,
  proposed_next_card: { card_id: proposedCard.card_id, title: proposedCard.title, status: proposedCard.status, report: '03_PAGE_LED_SLICE_PLAN.md' },
  blocker_categories: {
    personal_ui_review: ['Current installed build identity', 'Physical iPhone/native Mapbox evidence'],
    sharing_pilot: ['F-001 friend-fog authorization', 'F-004 non-owner wiring/privacy'],
    external_release: ['F-001', 'F-002', 'F-006', 'F-010', 'F-012', 'F-014', 'F-015', 'F-017', 'F-018'],
    local_audit_completion: [],
  },
  artifacts: [
    '00_REVIEW_SUMMARY.md', 'REQUIREMENTS_REGISTER.json', 'REQUIREMENTS_REGISTER.csv',
    '01_PAGE_AND_FLOW_BASELINE.md', '02_UI_DNA_AND_SHARED_DEPENDENCIES.md',
    '03_PAGE_LED_SLICE_PLAN.md', '04_FIRST_IPHONE_REVIEW.md', 'HANDOFF.json',
    'visual/index.html', 'visual/manifest.json', 'visual/capture-results.json',
    'visual/images/board-activity-day-sunset-night.jpg', 'visual/images/board-library-detail-editor.jpg',
    'visual/images/board-cairn-memory-settings.jpg', 'VALIDATION.json',
    'scripts/capture-baseline.mjs', 'scripts/build-deliverables.mjs', 'scripts/validate-deliverables.mjs',
  ],
  visual: { screenshots: capture.captures.length, boards: capture.boards.length, historical_phone_images_packaged: 0, privacy_reason: 'Historical private-looking map context excluded.' },
  audit_only_proof: register.audit_only_proof,
  stop_condition: 'Await product review and explicit page-scope approval. No implementation/release authorized.',
};
write('HANDOFF.json', JSON.stringify(handoff, null, 2));

process.stdout.write(`${JSON.stringify({
  runId,
  requirements: requirements.length,
  capabilities: capabilityCrosswalk.length,
  pages: pages.length,
  actions: actionFlows.length,
  findings: findings.length,
  captures: manifestCaptures.length,
  outputs: handoff.artifacts.length,
}, null, 2)}\n`);
