# Real hike1 GPS quality correction

Date: 2026-09-24 (Asia/Shanghai)  
Product source fingerprint: `8c639ca8477215f341cf76704ac9e6bbc08c832797d3813eab11a31da941f057/676`

## Evidence authority

The exact production Activity named `hike1` was read from the yiiling Cairn database without mutation. It contains 131 raw observations, 98 accepted canonical points, and 27 persisted Base Final vertices over 245.878 seconds. The private export was held in a mode-0600 temporary file solely for analysis; its SHA-256 was `e06c255bffb68131f14ebc18cb3da03111c814872ed3f077d3db12433670921d`, and the temporary file was removed after de-identification. Exact coordinates are not committed. The checked-in fixture is translated to an arbitrary synthetic NZ origin and retains only the relevant relative geometry, cadence, accuracy, and accept/reject provenance.

Raw cadence was p50 1.000 s, p95 4.554 s, maximum 21.000 s. Horizontal accuracy was p50/p95 14.246 m. Native observations continued during the screen-off interval, including gaps of 9, 9, 21, and 19 seconds. Canonical continuity filtering rejected a stationary/slow cluster, producing an 87-second accepted-route gap even though raw provider evidence continued.

## Findings and corrections

1. **False Lost / Low Signal** — the previous 15-second freshness rule treated legitimate iOS background batching as source loss, while long canonical filtering could be described as weak signal. Background evidence now has a separately bounded 30-second freshness budget; foreground ownership handoff has a 12-second recovery grace; fresh continuity/candidate filtering remains telemetry rather than being mislabeled as weak GPS. True expiry still reports loss. The UI says `Restoring GPS` during the bounded takeover.
2. **Long mutable Live tail** — the former 36-point lookahead could reach across the real 87-second canonical gap. Live presentation is now bounded simultaneously to 10 points, 15 seconds, and 18 travelled metres, with two read-only context points and evidence-bounded display stabilization. On the exact hike1 evidence, the mutable change maximum moved from 100.001 s / 22.816 m to 3.001 s / 5.085 m (p95 remained 3.000 s and improved from 3.983 m to 3.271 m). Canonical evidence, metrics, Memory, and persistence are unchanged.
3. **Final sharp spike** — the stored Final exactly matched the previous offline Base Final, so network map matching did not create it. Around the visible defect, four raw fixes were rejected, then a short accepted lateral burst at roughly 14.2 m reported accuracy produced opposing sharp turns and rejoined the supported path. The old pause/turn protection retained it. Base Final now removes only a short, uncertainty-bounded opposing-turn detour with limited support and no true gap. On full hike1 it removed two transient bursts (maximum depth 5.503 m), reduced Base Final from 27 to 21 vertices, and retained the supported subsequent bend. Canonical/Memory truth remains immutable.

## Native boundary

No Core Location configuration changed. The current real Activity source already uses `BestForNavigation`, a 1 m foreground distance filter, Fitness background activity type, background indicator, and `pausesUpdatesAutomatically: false`. The retained screen-off raw observations prove the background task was operating. All product changes are JS/TS and OTA-safe for a compatible runtime.

## Regression coverage

- De-identified real hike1 cadence, accept/reject provenance, and final spike.
- Background batching, foreground recovery grace, sparse-cadence expiry, and fresh continuity filtering.
- Bounded causal mutation with a 100-second cadence discontinuity.
- Isolated one-point spike and short multi-point burst.
- Genuine 90-degree corner, diagonal road crossing, U-turn/repeated corridor, Z, switchback, nearby parallel path, stop/stationary cloud, and true signal gap.

Commands and results:

- `cd app && npx jest src/features/activity/__tests__/activityLocationHealth.test.ts src/features/activity/__tests__/causalLiveRoute.test.ts src/features/activity/__tests__/hike1Regression.test.ts src/services/routing/__tests__/pedestrianFinalRoute.test.ts --runInBand` — PASS, 50/50.
- `cd app && npm run verify:changed` — Activity CORE PASS, 469/469.
- `cd app && npx expo export --platform ios --output-dir <isolated-temp>` — PASS, Hermes iOS bundle `index-28391fcec5a15c3bab0692e8208aa7f2.hbc`.
- `git diff --check` — PASS.

Repository-wide `npx tsc --noEmit` is not a clean gate in the existing tree: it reports pre-existing missing Playwright types, generated preview icon-key errors, and older fixture shape errors outside this change. The diff-routed static gate passed 13/13. Physical screen-off/Low Power Mode retest remains required; local tests do not replace native telemetry.
