# O88 targeted correctness and visual closure

Date: 2026-10-21 (Asia/Shanghai)

## Outcome

The independently reproducible O88 correctness defects are repaired on the
isolated Cairn branch. The candidate also closes the bounded Cairn visual work,
passes real Expo Web journeys against isolated MySQL/API authority, renders
genuine hosted Mapbox, and includes a genuinely realtime-paced simulated
pedestrian input run.

This is a reviewable engineering candidate, not a release. The overall verdict
is **HOLD — native device, integration, field and Owner authorization pending**.
No merge, rebase, push, deployment, production/shared seed, EAS Build, OTA,
TestFlight action, runtime/build version change, or Home O-marker increment was
performed.

## Exact identities

- Branch: `codex/cairn-encounter-experience-20261020`
- Reviewed parent: `cfcf19d8ffea3c98cbef117154b6c91f321e0f2f`
- Corrected source checkpoints:
  - `9abcb42` — targeted correctness repairs
  - `f4f04a1` — bounded visual and journey closure
  - `eec4ce0eeb31bcbe2bf7357525016372123f55a3` — Plant discard/relaunch closure
- Original common fork: `79b99a2b4b48f99658d4dc7cc564579d50603486`
- Latest Hike authority observed read-only at delivery:
  `3ffe7078fdb46384dd312182b15ff4ddda8cc98c`
- Existing Home marker remains `O87`; this HOLD candidate is not a validated,
  human-publishable OTA and therefore does not advance it.

## Confirmed corrections

- Plant drafts now use exact owner/origin/Activity identity, serialize competing
  writes, gate editing until hydration resolves, offer explicit standalone
  resume/discard, retain the intended place, and normalize numeric/string API
  owner IDs. First-entry Cancel/Back discards the exact empty session; Adjust
  Cancel/Back restores the prior editor, audience and place.
- Push delivery validates ticket cardinality and identity, retries unresolved
  device targets without resending accepted targets, bounds headers and body,
  records bounded receipt attempts and prevents unresolved receipts from
  starving later work.
- Every map selection and relevant authority boundary invalidates older async
  selection work, so the latest single/cluster/back/account/theme intent wins.
- Shanghai fixture mutation derives the actual MySQL target from server UUID
  and database allowlisting. Approval binds target, manifest, exact reader and
  creator cohorts, expiry and cleanup scope; changed plans require new approval.
- Notification opening has durable bounded retry UI, exact acquired revision
  targeting, account/navigation fences, and foreground-visible frame
  acknowledgement. Headless delivery has bounded body/callback retry.
- Publication/edit language distinguishes impossible, conditional, pending,
  approved, rejected, suspended and withdrawn states.
- Cairn reading/management hierarchy, encounter provenance and 44 pt actions,
  small-text semantics, Home scenic contrast, Settings wrapping, Web
  Day/Sunset/Night maps, Web symbol images and cluster-number contrast were
  improved without replacing the locked visual system.

## Final verification summary

- Focused Plant lifecycle: **19/19**.
- Activity change gate after the final source change: **418/418**.
- Full app Jest authority: **246/246 suites**, **2,409 passed**, 4 skipped,
  0 failed, 2 snapshots. Jest wrote a successful JSON result but retained known
  async handles; the idle runner was stopped after the completed result.
- Backend Node tests after the final checkpoint: **198/198**.
- Real isolated MySQL Memory/Friends/API harness: **35/35**, including 1,005
  found + 1,005 left pagination; 60-Cairn cold p50/p95 2,613.6/2,717.4 ms and
  warm p50/p95 67.3/79.9 ms.
- Connected loaded Expo Web + real auth/API/MySQL journey: **7/7**, 11 captures,
  zero runtime errors; exact Plant, approval, encounter, Open/read/Thanks,
  Library/history, edit v2, withdrawal, retained v1 and offline reconstruction.
  This run predates only the final Plant initial-discard/owner-ID canonicalization
  delta; those final paths are covered by 19/19 focused tests and the 22-state
  browser reload run. An exact-final disposable rerun was attempted, but MySQL
  failed before initialization because Docker's local-volume store was full.
- Core loaded UI: **22 states**, Day/Sunset/Night at 360/390/430, zero runtime
  errors, 36 completed genuine Mapbox resources, no network/render failures.
  Two Mapbox requests canceled by the deliberate browser reload are reported
  separately as `ERR_ABORTED`, not hidden.
- Map density: **24/24** captures, 210 completed hosted Mapbox resources,
  zero failures; exact-overlap click opened the exact eight-item sheet and
  distributed-60 click expanded 11.8 → 11.964968 with no content sheet.
- Realtime simulated pedestrian input: **182.124 s wall time**, 1,000 ms median
  provider gap, 8/8 assertions, zero runtime errors, real provider/acceptance
  pipeline and hosted Mapbox. It is explicitly not physical travel/native GPS.
- TypeScript: parent and final candidate both produce the same 159 diagnostics
  across the same 15 files. Normalized outputs are byte-identical SHA-256
  `b15c0d9be737e85e40e9b53885c2dc19d79a21212169425c2a3a4093febd67f0`;
  no changed O88 file introduces a diagnostic.

## Release gates

| Gate | Verdict | Boundary |
|---|---|---|
| Deterministic correctness | PASS WITH EVIDENCE | Source replay, focused tests, full app/backend regressions |
| Web experience | PASS FOR BOUNDED CAIRN SCOPE | Real production screens and real Mapbox Web; not a whole-app global audit |
| Isolated auth/API/DB | PASS WITH EVIDENCE | Disposable MySQL and local accounts only |
| Provider push | PASS THROUGH SERVER ACCEPTANCE/RECEIPT MODEL | No real production push or physical OS display/open proof |
| Native device | PENDING | Real GPS, locked/background/force-quit, haptics, VoiceOver, Dynamic Type, keyboard and native Mapbox |
| Hike/Run integration | PENDING OWNER AUTHORIZATION | 11 direct collision files plus semantic Activity/Fog/background overlap |
| Shanghai/production field | PENDING OWNER AUTHORIZATION | No shared/production data mutation or field walk |
| Publication | HOLD | No build, OTA, TestFlight, deploy or O-marker change |

## Package guide

- `R01_R12_LEDGER.md` is the finding-by-finding closure authority.
- `Q01_Q20_DISPOSITIONS.md` reopens the old labels and records the final
  evidence-bounded disposition.
- `ENGINEERING_EVIDENCE.md` indexes tests, DB, typecheck, performance and
  source material.
- `VISUAL_EVIDENCE.md` indexes real UI, Mapbox and journey captures separately.
- `INTEGRATION_AND_NATIVE.md` records exact overlap, ordered future integration
  steps and the minimal native checklist.

Generated screenshots and videos remain outside deploy-bearing Git. The compact
handoff ZIP contains selected evidence, complete changed source files, the
review-parent patch, hashes and scan results; `/tmp` working directories are not
release artifacts.
