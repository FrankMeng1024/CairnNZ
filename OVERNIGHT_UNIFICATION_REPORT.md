# O63 JSON-Driven Systemic Unification Report

Generated: 2026-09-25T02:09:40+08:00

## Outcome

The O63 client source candidate is implemented and locally verified. The production backend contains the required Public walking-discovery code, but Public remains deliberately disabled and unreachable. No OTA was published and no native build was created or submitted.

The owner authority was treated as immutable input:

- File: `/Users/mzm/Desktop/Cairn_Owner_Test_State.json`
- SHA-256: `2156cb5d45724f1565e5415a88c1d5d58cabb3d4ac2d48d08fb2a00d0032aa4b`
- `updatedAt`: `1790260498004`
- `lastCase`: `CAIRN06`
- Existing owner update: O62 on runtime `0.2.6-o61`

The separate machine-readable retest delta is `OWNER_RETEST_PATCH.json`. It does not rewrite or claim acceptance in the owner's result file.

## Candidate identity

- Client source commit: `9a0b3f6d4b17d4f2b471195b865e8fa2453f755d`
- Client source tree: `de0cd6eb0c25cab8f4d91345a9e37d63b990c8f4`
- `app` subtree: `7d8b5932f8597722141375e03410aa3f7aff3a10`
- Backend commit: `6854161c4f8cdf93379e81231d85d5e66deeec86`
- Candidate marker: O63, incremented exactly once from O62
- App version: `0.2.6` (unchanged)
- Runtime version: `0.2.6-o61` (unchanged)

## Implemented product changes

### Activity ownership and Home truth

- Hike and Run now share an explicit activity-screen ownership guard. Mode is selected only while idle; opening the wrong sibling for an active session redirects to the actual owner rather than inheriting its state.
- Home reports `Recording` or `Paused` from real session state. Merely leaving the activity screen no longer invents a pause or a “Paused Hike” title.
- Activity screens no longer tear down the app-owned network monitor.

### Auth resume and keyboard behavior

- Continue with Email executes synchronously after foreground resume instead of depending on a dropped animation callback.
- The auth root has a single transition owner; competing Auth-to-Home replacements were removed.
- Reset-password inputs are controlled and preserve existing text/caret edits. Forgot/reset flows use keyboard avoidance, scrollable content, and keyboard-safe taps/actions.
- OTP handling retains full-code paste and platform AutoFill support. The transition trace showed no blank frame or Auth/Home overlap.

### Offline recovery

- Marker and Activity outboxes are driven by an app-owned network subscription and drain on online, foreground, and hydration events.
- Retries are automatic, exponential, and bounded. Cold relaunch no longer requires manual refresh to resume queued work.

### Cairn and Memory contract

- Plant carries an explicit context: standalone or an exact activity ID/generation/mode. Activity Plant Back returns directly to the activity; location adjustment remains a separate action.
- A REAL standalone Cairn records one Personal Memory witness only after durable Cairn commit and only from a frozen GPS fix with accepted accuracy (20 m or better).
- Simulator Cairns are explicitly local QA data. They require debug plus simulator mode, never enter a server outbox, are hidden outside QA, and remain locally editable/deletable. Simulator paths and Memory use simulator coordinates and update before Finish.
- The simulator start focus ring is restored. Obsolete 1 m/5 m experiments and duplicate weather controls were removed.

### Shared caller migration

| Shared contract | Migrated live callers |
|---|---|
| Activity ownership | Hike, Run, Home active-session card |
| Cairn identity/audience | Marker Detail, Hiking/Run renderers, Memory pins, Map History, All Cairns |
| Delete confirmation | Marker Detail and Memory Cairn deletion |
| Plant context | Home, Hike, Run, preview/fallback entry paths |
| Offline drain ownership | Cairn outbox, Activity outbox, app foreground/online lifecycle |

`CairnIdentityLine` now separates authorship from audience with text as well as icons. `CairnDeleteDialog` provides the canonical close/keep/destructive hierarchy. Memory pin actions open the actual Cairn in every renderer branch. All Cairns filters by real audience, sorts by `createdAt`, and no longer rewrites planted time as “today” after an edit.

### Home, Privacy, and Help

- The Last Hike card is one coherent tap target without a nested Open button.
- Country resolution uses a versioned cache with an English fallback.
- Home uses the locked visual family with a new softened sunny-day canonical image. The bitmap was generated with the image-generation workflow and then integrated through the visual manifest; the underlying exact image-model name was not exposed, so no unsupported model attribution is made.
- The existing Cairn-native Privacy and Help/About redesign was preserved and revalidated.

### Public walking discovery

- The client checks accepted REAL walking points, then requests server verification against the exact activity ID/source/generation. It does not create a second route writer.
- Hike and Run surface the same nearby Public Cairn card before Finish; opening detail does not stop recording.
- The backend verifies active sessions from incremental `route_points` and finalized sessions from the canonical completed route.
- Every Public API route requires authentication and exact numeric allowlisting behind the global gate.

## Verification evidence

### Automated

- `cd app && npm run verify:changed`: PASS, Activity CORE `500/500`.
- Focused final contract suite: PASS, 9 suites and `61/61` tests.
- Backend Public policy/unit suite: PASS, `13/13` tests.
- Memory scale suite: PASS, `6/6` tests.
- Scoped TypeScript compilation passed. Repo-wide TypeScript remains outside this change because of pre-existing debt.
- `git diff --check` passed.

Activity CORE distribution: continuity 35, cadence 5, background 29, gap 14, elevation 5, matching 42, telemetry 38, integration 107, memory-gap 5, journal-recovery 35, memory 26, offline-sync 36, simulator-shared 56, server 23, static 44.

### Memory performance

Same Intel Mac, FogLayer/Turf fixture:

| Scenario | O63 | Checked reference | Delta |
|---|---:|---:|---:|
| 2,001-point cold rebuild | 12,516.96 ms | 15,582.51 ms | 19.7% faster |
| 40-point incremental update | 254.67 ms | 276.22 ms | 7.8% faster |
| 2,001 self + 2,000 friend cells | 23,568.13 ms | 20,261.95 ms | 16.3% slower |
| 10,000-point diagnostic | 59,195.34 ms | 76,841.15 ms | 23.0% faster |

The mixed self/friend case is an acknowledged regression but remains below the frozen 60 s budget. The fixture is synthetic: it does not prove the owner's populated native Mapbox/device timing. The owner's reported approximately 15-second restoration therefore remains a required native retest.

### Expo Web at mobile size

- Hike/Run matrix: 36 captures, 34 layout checks, pause/resume exactly once on each mode, zero runtime errors.
- Plant: activity and standalone, day and night; 4 captures, zero runtime errors.
- Auth-to-Home timed trace at -1/0/16/33/66/120/250/500 ms: no blank, no simultaneous Auth/Home, Home owned the route from commit, zero runtime errors.
- Settings, Home, Privacy, Help, activity, and Plant visuals were inspected at mobile size.
- Reproducible generated outputs were kept outside deploy-bearing Git at `/Users/mzm/Desktop/CairnNZ_O63_QA_20260925`.

A final screenshot is not being treated as transition proof; the timed trace is the transition evidence. Web results are not being presented as native owner acceptance.

### iOS bundle export

- Hermes export directory: `/tmp/cairnnz-ios-export-final.LWztnY`
- Bundle: `_expo/static/js/ios/index-6ff5a5edab9198d376894ebad73757d0.hbc`
- Bundle SHA-256: `e351481f6d4f7da7e3369ac6b2efe29a1c325bbbcd99f2d6c53615865b924045`
- Metadata SHA-256: `869eb7fd0dfd51093f3c7849bff8bbb8df738639e44847b6bd0d293abb01c629`
- Sunny asset SHA-256 in source and export: `2f34b8a8547415b4ef6e0bdb2a59a027e47598462dc71b7cc552ea5e4ba4cba5`

This is an export validation only. It is not a native build or submission.

## Backend deployment and Public status

The backend-only commit was pushed and deployed with the canonical production procedure. Post-deploy evidence:

- Production Git HEAD: `6854161c4f8cdf93379e81231d85d5e66deeec86`
- Container image: `sha256:0b1ef0ee1251e33396e9c2dac6ef248c453b5997f31fab0a62214ecdffda3dbd`
- Health: application and database OK
- Migrations: zero new; last migration 043
- Unauthenticated `/api/public-cairns/capabilities`: 401 as required
- `publicPilotEnabled=false`; allowlist count 0

The full disposable Docker/MySQL integration harness could not execute because the local Docker daemon did not become available. This was diagnosed as an environment failure and was not retried to manufacture a green result. Deployment was safe because the new code is unreachable while the gate is off.

Public is **not ready to activate**. It needs two explicit numeric accounts, including an isolated second actor; native positive and negative walking tests; viewer/report/moderation proof; and the unavailable live MySQL harness coverage. The normal owner OTA can be published while Public remains gated off.

## Owner acceptance still required

- Real-device Hike/Run ownership, pause truth, lock-screen/background behavior, and native GPS telemetry.
- Native keyboard, caret, paste, AutoFill, and foreground-resume behavior.
- Native Mapbox transition/flicker and populated Memory timing.
- Offline-to-online recovery across process death.
- CAIRN10's explicit simulator-versus-personal-memory contract.
- Reinstall behavior: iOS Keychain-backed session persistence is currently intentional. Changing this to force sign-in after reinstall requires an owner product decision; O63 does not silently change the security/session contract.
- END01: completed Activities remain view-only. The prior “resume a historical Activity” test is invalid and should be replaced, not marked as a repair acceptance.

Local PASS means candidate evidence only. Every item in `OWNER_RETEST_PATCH.json` retains `ownerDevice: pending`.

## Final disposition

`OWNER_OTA_CANDIDATE_READY_PUBLIC_BLOCKED`
