# MASTER BUG SHEET — Cairn AR v0.2.3 Plan (v4)
**Date**: 2026-06-11
**Iteration**: v4 (3 rounds adversarial subagent review applied — Round 3 PASS)
**Status**: ✅ Ready for execution. 6 v3 issues resolved.

---

## v3 → v4 changes (after Round 3 review)

| Round 3 finding | v4 resolution |
|---|---|
| Time estimate self-contradicts (160-210h vs 175-260h) | **Truth = 175-260h. BLOCKER-8 row updated. User original 6-day claim was 6× under.** |
| Count says "17" v2 items but table has 18 | **Recounted: 18 (9 BLOCKER + 9 V2-CONFLICT)** |
| No Q1-Q10 → task mapping | **Added Q-to-Stage matrix (next section)** |
| Round 1 traceability lost | **Added v1→v2→v3→v4 summary** |
| Stage 4 → 5 half-state undocumented | **Added explicit AC: A4-merged in Stage 4 reads schemaVersion ITSELF in init guard; if schemaVersion=0 detected pre-Stage-5-merge, A4-merged refuses to restore (returns COLD_INIT, button disabled) — defers cleanly until A8 ships in Stage 5** |
| FSM matrix incomplete (ARMED/FROZEN edges) | **Expanded matrix below** |

---

## Q1-Q10 → Stage Mapping (NEW v4)

| Q | Requirement | Stages delivering | Verification step |
|---|---|---|---|
| Q1 | 阵图 + 光带 + 3D 文字 | Stage 8 (A0+C1+C2+B1+B2+B3a) + Stage 9 (C3+C4) | Pre-EAS step 7, 8, 10 |
| Q2 | 完全贴地 | Stage 3 (A1) + Stage 8 (A2) + Stage 8 Y-stacking matrix | Pre-EAS step 4, 26 |
| Q3 | 6-10 random ribbons + S-curve + gif review | Stage 8 (B1+B2+B3a) | Pre-EAS step 8 (gif), 29 (user YES) |
| Q4 | 永久世界坐标 | Stage 4 (A4-merged) + Stage 5 (A8 migration preserves arOrigin) | Pre-EAS step 4, 5 |
| Q5 | 同 session 完全相同 / 跨 session 轻微 GPS | Stage 4 (A4-merged state machine COLD_INIT→PERSISTED→GPS_LOCKED) | Pre-EAS step 4 |
| Q6 | 删除头顶白色 type icon | Stage 8 (C1 delete AttachTypeChip) + Stage 11 (H2 delete TypeChipShader) | Pre-EAS step 7 |
| Q7 | 平放不漂移 | Stage 7 (A7 with isCeremonyActive) | Pre-EAS step (manual flat-phone test, not in 31-list — added below) |
| Q8 | 删除 OTA 参数板 | Stage 15 (E1) | Pre-EAS step 21 (grep OTAControlPanel) |
| Q9 | 跳过点赞/Report | Out-of-scope | n/a |
| Q10 | 1 秒种植序列 | Stage 8 (D1+D2+D3) | Pre-EAS step 9 |

**Pre-EAS step ADDED v4** (32nd):
- 31. [ ] **Q7 manual test**: place phone flat on table for 30s after planting cairn → cairn position must not drift >2cm in screen view

---

## v1→v2→v3→v4 traceability summary (NEW v4)

**Round 1 (v1→v2)**: 13 BLOCKING + 17 WARN + 18 missed risks
- All 13 BLOCKING resolved in v2 (v2 changes table line 11-37 in this doc precursor)
- All 17 WARN absorbed via merge/atomic decisions
- All 18 missed risks integrated into v2 risk register R8-R20

**Round 2 (v2→v3)**: 9 NEW BLOCKERS + 9 V2-CONFLICTS = 18 items
- All 18 resolved in v3 (v2→v3 changes table top of v3 doc)

**Round 3 (v3→v4)**: 6 issues (1 critical, 5 docs)
- All 6 resolved in v4 (this section)

**Total review iterations**: 3 rounds + this final.
**Total findings consumed**: 13 + 17 + 18 + 18 + 6 = **72 distinct issues**.

---

## Time Estimate (v4 LOCKED, single source of truth)

**Truth**: **175-260h coding/verification + external = 28-40 calendar days**

User originally said "6 days". Subagent review escalated to 4-6 weeks. v4 honest framing:
- Best case: 22 working days = ~4.5 calendar weeks
- Worst case: 32 working days = ~6.5 calendar weeks

If user wants faster, **must drop scope** (e.g. defer C3 3D-style text → next sprint).

---

## v2 → v3 changes (RECOUNTED to 18, was '17' typo)

| ID | Round 2 finding | v3 resolution |
|---|---|---|
| BLOCKER-1 | A8 wipes arOrigin → all cairns shift | **Rewrote A8: preserve arOrigin, only stamp schemaVersion=2; if cairns absent / arOrigin null, derive new arOrigin from cairn cluster centroid** |
| BLOCKER-2 | A1↔A4 inter-FSM contract undefined | **Added FSM contract matrix at end of plan** |
| BLOCKER-3 | v0.2.2 IPA artifact may not exist for migration test | **Replace with synthetic fixture: write old-schema arOrigin to MMKV via test harness, then upgrade** |
| BLOCKER-4 | TestFlight cohort audit not in checklist | **Added Pre-EAS step 0a: ASC TestFlight tester device audit** |
| BLOCKER-5 | FPS measurement instrumentation undefined | **Added [v22-FRAME-TIMING] tag (sampled 1Hz) + Xcode Instruments capture procedure** |
| BLOCKER-6 | A3/Task#103 native plugin ghosted | **Reconciled: A3 ARKitSessionInit IS shipped in v0.2.2 binary (telemetry confirms worldAlignActual=GravityAndHeading); Task#103 closed as completed** |
| BLOCKER-7 | No production rollback plan | **Added OTA kill-switch: PortalRingEnabled / WispEmissionEnabled / PlantCeremonyEnabled / NewGroundResolverEnabled defaults true, can flip false via OTA to revert visuals to v0.2.2 baseline** |
| BLOCKER-8 | Time estimate inconsistency | **v4 LOCKED**: 175-260h total (95-130 coding + 35-50 verification + 30-50 external + 8-12 hotfix + 4-12 gif iter + 3-5 review). User original "6 days" was 6× under. |
| BLOCKER-9 | A11 fallback ships unverified | **Added `[v22-A11-FALLBACK-ENGAGED]` FAIL_LOUD tag for first-week monitoring; documented as "ship-untested, telemetry-monitored, hotfix-on-failure"** |
| V2-CONFLICT-1 | A2 in both Stage 3 and Stage 8 | **A2 ONLY in Stage 8 (single-source-of-truth); Stage 3 = A1 alone, with explicit AC "if A2 not yet merged, PortalSpawner still overrides — known half-state, lasts only between Stage 3 merge and Stage 8 merge"** |
| V2-CONFLICT-2 | A8 vs A4-merged boot race | **Boot order locked: (1) MMKV read schemaVersion → (2) A8 migration if needed → (3) A4-merged restore from migrated arOrigin → (4) UI mount** |
| V2-CONFLICT-3 | A9 PERSISTED state semantics | **Locked: PERSISTED = arOriginLocked=true (Plant button enabled). GPS_LOCKED = arOriginLocked=true (Plant button enabled). COLD_INIT/INVALIDATED = arOriginLocked=false (Plant button disabled). User on cold start with persisted arOrigin → button immediately enabled (no 1-3s wait); only fresh install or post-100m walk gets the wait.** |
| V2-CONFLICT-4 | A10/A1d clarity | **Locked: A10 is sub-task of A1, single PR, single AC ("PlayMode test with A11 simulator input passes")** |
| V2-CONFLICT-5 | D3 ordering | **Moved D3 from Stage 13 → Stage 8 (folded into PortalSpawnerV199 BIG PR as last commit)** |
| V2-CONFLICT-6 | H2 vs H4 stage reversal | **Reordered: H4 (Stage 10) BEFORE H2 (Stage 11). H2 tunes against post-bloom-removed baseline.** |
| V2-CONFLICT-7 | H1 Ring* grep pattern collision | **Enumerated explicit deletion list (NOT grep pattern): RingThickness, RingDashCount, RingDashSpeed, RingInnerPulseHz, RingEdgeSoftness — NEW PortalRing* keys safe** |
| V2-CONFLICT-8 | A7 isCeremonyActive flag race | **Stage 7 A7 includes adding `isCeremonyActive=false` stub field to PortalSpawnerV199 (forward-compat); Stage 8 D2 actually toggles it** |
| V2-CONFLICT-9 | C3 BillboardYaw assumption | **Pre-Stage 9 grep verification: confirm BillboardYaw component exists; if not, Stage 9 adds it (~1h)** |

Plus: A0+Pebble+ShadowBlob explicit Y-stacking matrix added.

---

## Y-STACKING MATRIX (NEW v3, prevents z-fight)

All Y values relative to finalY (= GroundYResolver locked Y on real floor):

| Layer | Y offset | Notes |
|---|---|---|
| Floor (ARKit ground) | 0.0000 | reference |
| ContactShadow blob | +0.0005 | invisible disk on floor |
| PortalRing | +0.0010 | 阵图地面圆环, contains type SDF center |
| Pebble base (cairn type only) | +0.0020 | bottom of Pebble_L touches here |
| Pebble center stack | (composed by halfHeights, see code) | |
| 3D-style billboard text | +1.0000 (OTA tunable, was 1.3) | user note display |

`PortalRingShader` material + `ShadowBlobShader` material + `PebbleShader` material all use depth write off OR explicit ZWrite Off + ZTest LEqual to prevent z-fight at sub-mm offsets.

---

## A1 ⇄ A4 FSM CONTRACT MATRIX (NEW v3)

Two state machines coordinate via `arOriginLocked` boolean emitted via `onStatus`.

**A1 (Unity GroundYResolver) states**: UNLOCKED, ARMED, LOCKED, FROZEN
**A4-merged (RN useTrackingStore) states**: COLD_INIT, PERSISTED, GPS_LOCKED, INVALIDATED_BY_DISTANCE

`arOriginLocked` definition: A4 in {PERSISTED, GPS_LOCKED} = true; else false.

**Cross-FSM events (FULL 16-cell matrix, v4)**:

A1 transitions × A4 states:

| A4 state | A1 UNLOCKED→ARMED | A1 ARMED→LOCKED | A1 ARMED→UNLOCKED (lost) | A1 LOCKED→UNLOCKED | A1 LOCKED→FROZEN | A1 FROZEN→UNLOCKED |
|---|---|---|---|---|---|---|
| COLD_INIT | A1 progress ignored | A1 ignored, A4 still bootstrapping | A1 ignored | n/a (no LOCKED in COLD_INIT context) | n/a | n/a |
| PERSISTED | Plant button stays enabled (PERSISTED holds) | A4 transitions to GPS_LOCKED on first GPS | Plant button disabled briefly (0.5s debounce) | Plant button stays enabled (PERSISTED holds — local arOrigin still valid) | Plant button stays enabled | Plant button stays enabled |
| GPS_LOCKED | normal | normal operation | Plant button disabled (0.5s debounce) | Plant button disabled (0.5s debounce) | Plant button disabled until LOCKED resumed | Plant button disabled until LOCKED resumed |
| INVALIDATED | Plant button DISABLED (waits for LOCKED + new arOrigin) | bulk respawn waits for A1 LOCKED | DISABLED | DISABLED (in re-search) | DISABLED | DISABLED |

**Plant button enable rule (v4 final)**: enabled iff (`arOriginLocked == true`) AND (A1 state == LOCKED) AND (no transition in last 0.5s).

**Anti-thrash debounce**: 0.5s minimum between A1 state changes for Plant UI.

---

## Production Rollback Plan (NEW v3)

If v0.2.3 EAS ships and user reports massive regression:

**Tier 1 — OTA kill switches** (revert to v0.2.2 visual baseline without rebuild):
- `PortalRingEnabled = false` → revert to old wisp-only visual
- `WispEmissionEnabled = false` → no particles (silent fallback)
- `PlantCeremonyEnabled = false` → instant pop spawn
- `NewGroundResolverEnabled = false` → use legacy GroundYResolver code path (kept side-by-side as fallback for first 2 weeks)
- `A11FallbackEnabled = true/false` → toggle A11 path on/off

These flags default `true` (new system on). Pushing them `false` via `eas update` is the rollback.

**Tier 2 — App Store rollback**:
- v0.2.2 IPA archived as backup; if Tier 1 insufficient, request App Review expedited rollback to v0.2.2 binary
- Estimated 24-48h response from Apple

**Tier 3 — Migration unwind**:
- A8 schema migration is one-way (schemaVersion=2 written). If reverting to v0.2.2 IPA, A8 is no-op (v0.2.2 doesn't read schemaVersion). Cairns work because we preserved arOrigin (v3 fix).

---

## A8 v0.2.2 → v0.2.3 Migration (REWRITTEN v3)

**Goal**: Q4 invariant ("5 年后还在原位") MUST hold across upgrade.

**Logic**:
1. Cold start, after MMKV hydration:
2. Read `arOrigin.schemaVersion` (default 0 = legacy / fresh)
3. Switch:
   - `schemaVersion == 2`: already migrated, no-op
   - `schemaVersion == 0` AND `arOrigin == null`: fresh install, mark schemaVersion=2 + wait for GPS lock normally
   - `schemaVersion == 0` AND `arOrigin != null` AND `markers.length > 0`: legacy v0.2.2 user with cairns
     - **DO NOT WIPE arOrigin** (preserves cairn world coords)
     - Stamp `arOrigin.schemaVersion = 2`
     - Stamp `arOrigin.migrationTs = Date.now()`
     - Show one-time toast "Cairn positions preserved — verify next AR open"
     - Telemetry: `[v22-MIGRATION] from=v0.2.2 markers=N arOrigin=preserved`
   - `schemaVersion == 0` AND `arOrigin != null` AND `markers.length == 0`: edge case (orphan arOrigin)
     - Wipe arOrigin (no markers to displace), schemaVersion=2

**Verification (synthetic, no v0.2.2 IPA needed)**:
- Test harness: write old-schema arOrigin (no schemaVersion field) + 3 markers to MMKV
- Boot app → A8 runs → verify schemaVersion=2 stamped, arOrigin unchanged, markers visible at original world coords

---

## Pre-EAS Build Checklist (v3, 31 steps)

0a. [ ] **TestFlight cohort audit**: query App Store Connect for active testers' devices; confirm 100% support arkit (iPhone XS+) BEFORE I1 commit
1. [ ] H1: full repo grep for deleted OTA keys → 0 results
2. [ ] A1d/A10: A11 fallback path tested in Unity Editor with simulated low-end input + `[v22-A11-FALLBACK-ENGAGED]` FAIL_LOUD tag verified to fire
3. [ ] A1: Editor PlayMode unit tests pass (state machine transitions matrix from FSM Contract section)
4. [ ] A4-merged: physical force-quit + reopen test in 3 locations → cairn at saved position once, no flash
5. [ ] A8: synthetic fixture test (write old-schema MMKV → boot v0.2.3 → verify cairns preserved + schemaVersion=2 + toast shown)
6. [ ] A9: cold start with persisted arOrigin → button immediately enabled. Cold start fresh install → button greyed for 1-3s → enables when AR locks
7. [ ] A0+C1+C2: type icon visible at阵图 center for all 5 types, no white-blowout, no head-floating chip
8. [ ] B1+B2+B3a: gif captured on iPhone 11 + 13 + 15 Pro, **user Q3 visual confirmation YES**
9. [ ] D1+D2: 1 sec ceremony correct timing, no rise-from-below visible, isCeremonyActive flag observable in telemetry
10. [ ] C3: TMP text appears at t=0.7-1s, readable from 2m and 8m, no first-plant compile stutter, BillboardYaw verified working
11. [ ] C4: BuildScript exits non-zero if TMP font missing (test by renaming asset → run BuildIOS locally)
12. [ ] H2: 5 dead shaders deleted/animated as planned (PebbleShader+StoneBackplateShader+ShadowBlobShader keep+_Time; LightShaftShader+TypeChipShader+RibbonStrandShader deleted)
13. [ ] H3+H4: post-process baseline visually similar to v0.2.2 after rebalance (compare gifs)
14. [ ] F2b: FAIL_LOUD events appear in aliyun debug_snapshots after deliberate trigger (each of 7 conditions tested)
15. [ ] FPS: `[v22-FRAME-TIMING]` 1Hz sample shows ≥30 fps sustained for 60s with 5 cairns (verified via Xcode Instruments OR aliyun query for tag with fps<30 count)
16. [ ] grep `HorizontalDown` in UnityARLib/Assets/Scripts → 0 results
17. [ ] grep `Tier.C\|GetTierC\|AssumedHoldHeight` → 0 results
18. [ ] grep `'0.2.0'` in app/src → 0 results (除测试 fixture)
19. [ ] grep `SummonAnimation\|SummonEnabled` in PortalSpawnerV199.cs → 0 results in active code
20. [ ] grep `RibbonStrandShader\|HeroRibbon\|TypeChipShader\|LightShaftShader` → 0 results except in deleted commit
21. [ ] grep `OTAControlPanel` in app/src → 0 results
22. [ ] OtaBadge.tsx OTA_VERSION bump
23. [ ] app.json version 0.2.2 → 0.2.3
24. [ ] Local Unity Editor BuildIOS runs clean
25. [ ] Telemetry roundtrip: plant 5 cairns → kill app → check aliyun: each [v22-CAIRN-LIFECYCLE] phase logged
26. [ ] Z-stacking visual: no z-fight visible at any cairn from any angle (Stage 8 PR commit-by-commit observation)
27. [ ] Rollback drill: push OTA `PortalRingEnabled=false` → verify visual reverts to legacy → push back `true` → verify recover
28. [ ] FSM contract matrix: Plant button enable/disable behaves per matrix in 4 simulated A1/A4 states
29. [ ] **User Q3 gif review**: explicit YES before EAS build trigger
30. [ ] **User says "go EAS build"**: explicit confirmation per memory rule

---

## Implementation order (v3, 15 stages)

(All stages from v2 retained, with v3 adjustments noted)

### STAGE 1 — OTA cleanup foundation
**H1 + B4** — Delete enumerated OTA orphans
- Explicit deletion list: LightEstimate, AmbientLux, WispFadeNear, WispFadeFar, QualityTier, StatusTintHealthy, StatusTintSuspicious, StatusTintHidden, SeedColor, SeedScaleMul, SeedEnabled, RippleEnabled, RippleStrength, StarMoteEnabled, LanternEnabled, LODSwapDistance, HaloPulseAmp, HaloPulseHz, PebbleRimPower, PebbleSubsurface, HandshakeBeamDuration, HandshakeBeamPulseHz, AimConeRad, AimHoldMs, RingThickness, RingDashCount, RingDashSpeed, RingInnerPulseHz, RingEdgeSoftness, HeroRibbonHeight, HeroRibbonCount, HeroRibbonCurl, WispCurlStrength
- Time: 3-5h

### STAGE 2 — H8 boundary check
- Time: 1.5-2h

### STAGE 3 — A1 GroundYResolver (without A2; A2 moved to Stage 8)
- Time: 16-26h

### STAGE 4 — A4-merged arOrigin state machine
- **HALF-STATE GUARD (v4)**: A4 init reads `arOrigin.schemaVersion` FIRST. If schemaVersion < 2 (Stage 5 A8 not yet shipped or fresh install), A4 returns COLD_INIT immediately, Plant button disabled. Once A8 (Stage 5) stamps schemaVersion=2, A4 transitions normally on next session start.
- This prevents Stage 4-merged-but-Stage 5-not-yet half-state from corrupting persisted data.
- Time: 6-10h
- Verify A1↔A4 FSM contract matrix as written

### STAGE 5 — A8 migration (rewritten — preserves arOrigin)
- Time: 4-6h
- **NB: After Stage 5 ships, A4's HALF-STATE GUARD allows normal restore on next session.**

### STAGE 6 — A9 PlantSheet AR-locked gating + UnityAROverlay arOriginLocked emission
- PERSISTED state ALSO enables button (cold start with persisted arOrigin = no wait)
- Time: 1.5-2h

### STAGE 7 — A7 phone-flat protection
- Includes: ADD `isCeremonyActive=false` stub field to PortalSpawnerV199 for forward-compat
- Time: 2-3h

### STAGE 8 — PortalSpawnerV199 BIG ATOMIC PR (with strict commit order)
**Intra-PR commit order (SUBAGENT-VALIDATED)**:
1. A0: Add AttachPortalRing function (additive, compile-clean)
2. C2: Tune PortalRingShader SDF rendering (additive)
3. B1+B2+B3a: Wisp swap (delete WispShader bubble + RibbonStrandShader + HeroRibbon, add ParticleSystem AttachWispRibbons) — SINGLE COMMIT (delete+add atomic)
4. D1+D2: Ceremony swap (delete SummonAnimation + SummonThenAnchor, add PlantCeremony coroutine, set isCeremonyActive flag) — SINGLE COMMIT
5. C1: Delete head-floating AttachTypeChip (now A0 covers it via SDF)
6. A2: PortalSpawner sanity gate respect GroundYResolver
7. D3: Remove SummonEnabled OTA push from RN (`UnityAROverlay.tsx:467-505` grounded-defaults)
- Time: 22-34h
- Files: PortalSpawnerV199.cs (primary), PortalRingShader.shader (C2), Shaders/ deletes (B1+B3a), AttachPortalRing material setup (A0), UnityAROverlay.tsx (D3)
- Includes Y-stacking matrix verification per commit

### STAGE 9 — TMP fonts and pseudo-3D text
- Pre-stage: grep `BillboardYaw` to confirm component exists; if missing, add it (~1h)
- C4 + C3
- Time: 10-18h

### STAGE 10 — H4 Bloom unification (MOVED FROM Stage 11)
- H4 first because Stage 11 H2 needs post-bloom-removed baseline
- H3 (CairnVolumeProfile.asset YAML serialization fix) accompanies H4
- Time: 7-11h

### STAGE 11 — H2 5-shader prune (uses H4 baseline)
- Keep+animate: PebbleShader (specular shimmer), StoneBackplateShader (rim breath), ShadowBlobShader (cairn-synced pulse)
- Delete: LightShaftShader, TypeChipShader (already done in Stage 8 C1), RibbonStrandShader (already done in Stage 8 B3a)
- Time: 3-4h

### STAGE 12 — Telemetry
F1 + F2a + F2b + new `[v22-FRAME-TIMING]` (1Hz sample) + new `[v22-A11-FALLBACK-ENGAGED]` + new `[v22-MIGRATION]`
- Time: 2.5-3h

### STAGE 13 — RN UX polish (without D3, moved to Stage 8)
G1 + G3 + G5
- Time: 3-4h

### STAGE 14 — Native Info.plist
I1 + I5 + I6
- Pre-step: TestFlight cohort audit (Pre-EAS step 0a, line 159)
- Time: 1-1.5h (incl audit)

### STAGE 15 — Final cleanup
E1 + Pre-EAS 31-step checklist execution
- Time: 6-8h verification

---

## Time estimate (v3 LOCKED)

| Item | Hours |
|---|---|
| Coding (15 stages, subagent B realistic numbers) | 95-130 |
| Verification (device matrix, gif iter, telemetry roundtrips) | 35-50 |
| External overhead (CI Unity 15min × N + EAS 25min × N + TestFlight 5min × N + user Q3 gating) | 30-50 |
| Subagent review (additional rounds if needed) | 3-5 |
| EAS hotfix iterations (2 expected) | 8-12 |
| Gif iteration cycles | 4-12 |
| **TOTAL** | **175-260h** |
| **Calendar (8h/day)** | **22-32 working days, 28-40 calendar days** |

**Honest framing**: 4-6 weeks of focused work to ship v0.2.3 with high confidence. Plan v1 said 6 days. v3 says 4-6 weeks.

---

## Risk register (v3, 25 risks)

(R1-R20 from v2 retained, plus 5 new from Round 2)

| ID | Risk | Mitigation |
|---|---|---|
| R21 | A8 migration runs before A4 restore (race) | Boot order locked: schemaVersion read → A8 → A4 → UI |
| R22 | A1↔A4 FSM cross-state edges produce stuck Plant button | FSM contract matrix + 0.5s anti-thrash debounce |
| R23 | OTAControlPanel deletion breaks dev iteration during sprint | E1 moved to LAST step (Stage 15); panel available throughout build cycle |
| R24 | Stage 8 PortalSpawnerV199.cs intra-PR commits in wrong order break compile | Validated 7-step intra-PR commit order documented |
| R25 | A11 fallback ships untested on real A11 hardware | `[v22-A11-FALLBACK-ENGAGED]` first-week telemetry monitoring + immediate hotfix readiness |

---

## Unity Visual Test Method (LOCKED v4 — user mandate)

**RULE**: All Unity visual effects (Q1 阵图 / Q3 光带流动 / Q6 type icon / Q10 种植序列 / H2 shader / H3+H4 bloom / any shader change) MUST be verified by **Unity Editor real-camera screenshot/recording**, NOT Editor preview pane.

**Method**:
1. Open Unity Editor on the project
2. Open the AR scene (CairnAR.unity)
3. Hit Play → simulate AR session via XR Simulation
4. Position virtual camera in scene to view the cairn from real-world angles
5. Capture via screenshot tool OR Unity Recorder (for gif/video for Q3)
6. Save to `docs/visual-verify/stage-N-<feature>.png` (or .gif for animations)
7. Compare against Q1-Q10 acceptance per stage

**Why**: 
- ParticleSystem behavior and shader compile differ between Editor preview and actual runtime
- iOS Metal shader behavior approximated in Editor (better than nothing, faster than EAS roundtrip)
- gif review (Q3 acceptance) requires real animation capture

**Stages requiring Unity Editor real-camera verification**:
- Stage 8 (every commit): A0 ring, B1+B2+B3a wisp, D1+D2 ceremony, C1+C2 type icon
- Stage 9: C3 3D-style text
- Stage 10: H4 bloom rebalance
- Stage 11: H2 shader animations

Each stage's visual verification screenshot/gif **commits to** `docs/visual-verify/` before progressing to next stage.

---

## Definition of Done (LOCKED v3)

EAS build ships when ALL 31 Pre-EAS items ✅ AND user explicitly says "go EAS build".

EAS build is **successful** when user reports:
- ✅ "看起来对了 / cairn 在地上 / 不浮空"
- ✅ "光带飘起来很自然"
- ✅ "重开 cairn 在原位"
- ✅ "种植很流畅 / 没有升起来"
- ✅ "我自己看图也觉得对"

If regression: Tier 1 OTA kill switch first, Tier 2 hotfix EAS, Tier 3 v0.2.2 rollback.

