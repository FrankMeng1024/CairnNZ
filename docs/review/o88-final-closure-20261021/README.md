# Cairn O88 final quality closure

Date: 2026-10-21 (Asia/Shanghai)

## Candidate identity

- `VERIFIED` isolated branch: `codex/cairn-encounter-experience-20261020`
- `VERIFIED` recovered branch checkpoint: `56e2c648addced775956005bcc7748f6a5fbaf1a`
- `VERIFIED` recovered source parent: `eec4ce0eeb31bcbe2bf7357525016372123f55a3`
- `VERIFIED` first resumable implementation checkpoint: `8f888847d011086f3416429f40784c192995c6f2`
- `VERIFIED` exact-final executable-source checkpoint: `f00576f416bfe78be7c6aa2802861bcd90804a9e`
- `VERIFIED` exact-final source/dependency fingerprint: `da3bf29ed08a81542c489093418ab162ef95a30b0a4a0523ea1aabca47f7e0fc` over 989 app/backend source, script, manifest and lock files
- `VERIFIED` no merge, rebase, cherry-pick, push, deploy, production fixture mutation, EAS Build, OTA, TestFlight or version/`O<number>` marker change was performed.

The requested `Cairn_O88_Final_Edge_Closure_Codex_EN_20261021.md` was not present in Downloads. The complete owner contract in the active request, the targeted closure contract, and the independent probe/review evidence that were present were used. The worktree was clean at recovery; no newer uncommitted Cairn work needed reconstruction.

## F01 — draft ownership and delayed writes

Status: `VERIFIED`

The reproduced failure was a late asynchronous save rejection from editor session A writing recovery data after a newer session B had already become authoritative and closed. Session authority is now monotonic per draft key. Releasing a session no longer erases the authority fence, and persistence/removal requires the exact latest session.

This preserves both sides of the contract:

- a stale session cannot overwrite or delete a newer session's draft after B closes;
- a delayed unmount from the latest legitimate session can still persist recovery data;
- a fresh process can reclaim an interrupted draft;
- account, Activity and location identity remain part of the draft boundary;
- discard, successful commit and location-transition cases retain their existing semantics.

Evidence: full app regression 246/246 suites, 2,412 passed, 4 intentional skips, 0 failed; focused Plant regression 25/25; Activity full gate 2,603/2,607 with the same four skips. The full Jest process required `--forceExit` and reported known open handles; this is recorded rather than hidden.

## F02 — Shanghai fixture cleanup authority

Status: `VERIFIED`

Activation and cleanup are separate authorities. Cleanup now requires its own exact target, batch, plan and time-bounded grant. A renewed cleanup-only grant can remove an expired batch even when activation approval has expired; it cannot create, update or reactivate content. Production cleanup has an independent production gate.

The isolated MySQL rehearsal passed 16/16 checks covering read-only planning, exact application, idempotent retry, cohort-expansion denial, partial apply recovery, revision transition, expired activation denial, expired-batch cleanup, partial cleanup retry, unrelated-row survival and zero live fixture markers after cleanup.

Evidence directory: `/Users/mzm/Downloads/Cairn_O88_Final_Closure_20261021/shanghai-rehearsal-exact`

No production fixture was applied or cleaned.

## F03 — final connected correctness

Status: `VERIFIED` for isolated real auth/API/MySQL; `BLOCKED` only where native hardware is required.

The exact-final connected browser journey passed 7/7 with three real isolated accounts:

1. login and `/auth/me` identity;
2. normal Plant submission into real API/MySQL pending review;
3. protected operator approval of the exact revision;
4. post-publication Activity evidence, one acquisition and one exact presentation group;
5. normal Memory Open, read and Thanks;
6. owner v2 update and normal Withdraw;
7. retained acquired v1 still readable after source deletion and in offline reconstruction.

Database end state contained exactly one acquisition, open, Thanks and presentation record, plus one retained revision.

During exact MySQL pagination, a concrete new defect was reproduced: under a Shanghai process timezone, a UTC-decoded MySQL `DATETIME` was re-serialized with local getters. Cursor `00:00:00.002` became `08:00:00.002`, repeatedly selecting page one. The route now serializes UTC components in a dedicated tested cursor module, and both direct-MySQL harnesses use the API's `timezone: 'Z'` boundary.

Sealed exact-final results:

| Boundary | Result |
| --- | --- |
| Connected create → approve → acquire → read/Thanks → update/withdraw → retained revision | 7/7 PASS |
| Public API/MySQL | 21/21 PASS |
| Memory/Cairn API/MySQL | 35/35 PASS |
| Found and left keyset pagination | 1,005 + 1,005 unique rows |
| Personal/Friends API/MySQL | 26/26 PASS |
| Backend Node tests | 203/203 PASS |
| App Jest | 246/246 suites; 2,412 pass, 4 skip, 0 fail |
| Activity changed gate | PASS; 2,603 pass, 4 skip |
| TypeScript | 159 known baseline errors; 0 in changed O88 files |
| Backend dependency audit | 0 findings |
| App production-tree dependency audit | 0 critical, 26 high, 16 moderate |

The remaining app audit entries are transitive Expo/Metro/Jest/build-chain advisories. The safe lockfile update removed both critical findings. `npm audit --force` proposes unsupported SDK/toolchain changes and was deliberately not used. `npm ls --all` also records an existing peer conflict: native `@rnmapbox/maps` expects Mapbox GL 2.x while `react-map-gl` 8 declares Mapbox GL >=3.5. Real web rendering works in the evidence runs, but dependency alignment remains an integration-owner decision.

Exact-final evidence:

- `/Users/mzm/Downloads/Cairn_O88_Final_Closure_20261021/connected-ui-exact-final`
- `/Users/mzm/Downloads/Cairn_O88_Final_Closure_20261021/public-memory-sealed-final`
- `/Users/mzm/Downloads/Cairn_O88_Final_Closure_20261021/personal-friends-sealed-final`
- `/Users/mzm/Downloads/Cairn_O88_Final_Closure_20261021/app-regression/jest-results-exact-final.json`

## F04 — folded note, stone and motion

Status: `VERIFIED` on real rendered Expo Web; native-only aspects remain `BLOCKED`.

The approved visual family was retained. The note now has finite state-connected open/reveal/update and exit transitions. Save, Update, Withdraw, Close and Archive do not play a successful exit before durable acceptance. Failed Update retains the exact edits and visible paper. Open resolves the acquired exact revision. Reduce Motion resolves immediately without decorative movement. Short-note reading is content-first; management actions are secondary.

Real rendered evidence:

- 25 core UI states across day, sunset and night and 360×780, 390×844 and 430×932 mobile viewports;
- hosted Mapbox provenance: 39 requests, 38 finished, 0 failed, one expected reload abort, 0 UI/runtime errors;
- 24 density/theme/view cells plus real overlap-group and camera-expansion interactions; 213 Mapbox requests, 0 failures;
- a 103.539-second real-time simulated pedestrian journey over hosted Mapbox with B–F legs, signal-loss suppression and all waypoints reached;
- finite motion timings: Save 371 ms, failed Update retained for 1,632 ms, successful Update 1,030 ms including request/reveal, Withdraw 817 ms, Close 488 ms, Archive 700 ms, Open 1,345 ms, Reduce Motion close 329 ms.

Evidence directories:

- `/Users/mzm/Downloads/Cairn_O88_Final_Closure_20261021/core-ui-final`
- `/Users/mzm/Downloads/Cairn_O88_Final_Closure_20261021/mapbox-density-final`
- `/Users/mzm/Downloads/Cairn_O88_Final_Closure_20261021/realtime-walk-final`

## Unverified native boundaries

Status: `BLOCKED` by native hardware/device access, not claimed as passed.

- physical GPS and outdoor field accuracy;
- locked/background native telemetry and OS interruption recovery;
- native haptics;
- VoiceOver rotor/focus behavior;
- Dynamic Type at device accessibility sizes;
- native keyboard interaction and frame-time/FPS profiling.

## Integration verdict

`READY TO REQUEST CONTROLLED INTEGRATION` of the isolated O88 candidate.

This is not a beta-release authorization. Native hardware gates, the remaining supported-SDK dependency advisories, and the Mapbox peer-version decision remain release-owner gates. No release, deployment or integration operation was performed.

