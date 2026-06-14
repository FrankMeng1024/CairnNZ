# R2 Fix Review — sub#A (Independent)

Scope: 6 fixes vs 铁律 "plant 在哪 cairn 永远在哪". Source files all confirmed read.

---

## R2.2 — FloorPlaneValidator 5-class reject expansion
**Verdict**: PASS (with 1 CONCERN)
**Bug 真解决?**: Yes — `kRejectMask` (FloorPlaneValidator.cs:83-92) now contains all 9 non-floor classes (Couch/WallArt/DoorFrame/WindowFrame/InvisibleWallFace 新增). Bitwise mask check at L93 will reject any plane with any of these flags. Pre-fix code (only Table/Seat/WallFace/Ceiling) would have silently accepted a sofa as floor.
**Regression?**: 
- L70 `lidar_not_floor_and_too_small` rule still runs BEFORE the reject mask. A LiDAR-classified `Couch` with area ≥1m² will pass L70 (because `!isFloor && area<1.0` is false) and then hit the mask → still rejected. OK.
- Non-LiDAR (lidar=false) skips the L67 block and goes straight to mask. If `plane.classifications` is `None` on non-LiDAR, mask=0 → passes. OK (matches existing behavior).
**漏的边界 case**:
1. **Mixed classifications**: ARKit can return e.g. `Floor | Table` (a covered table near floor). Current `(plane.classifications & kRejectMask) != 0` rejects ANY overlap → a Floor-classified plane that also has Table flag = rejected. Is this intended? PASS for "焊死在地面" but may cause Tier-A reject loop if ARKit ambiguity classifies a real floor plus Other. Worth a Debug.Log of the actual classification value when rejected for QA-trace.
2. **`PlaneClassifications.Other` not in mask** — neither rejected nor explicitly accepted. On non-LiDAR `Other` will pass everything (relies on area+angle). Fine.
3. The mask is `const` — if ARFoundation upgrades and renames an enum value, build break. Acceptable; flagging only because v0.2.4 is on AR Foundation 6.

---

## R2.3 — GPS accuracy 室内 fallback (3-tier)
**Verdict**: CONCERN
**Bug 真解决?**: Partially — ARScreen.tsx:508-513 splits acc into ≤10 / 10-25 / >25. `isLowAccuracy` flag is computed at L513 BUT it is **only emitted into a breadcrumb at L533**. It is **NOT propagated** into `setArOriginIfMissing()` payload (L527-531) — the store entry has no lowAccuracy field. Downstream `unityCairnSpawn.ts` cannot read what is not stored.
**Regression?**:
- Old behavior: acc>10 → never lock origin. New: acc 10-25 → lock origin. So users in marginal GPS WILL now write a degraded origin into persistent store. If the lowAccuracy flag does not actually gate Tier-A (because it is never persisted), all post-fix Tier-B GPS reverse-projection will use a noisy origin → cairn drift INCREASES vs pre-fix for marginal-accuracy users.
- 50m staleness gate (L520) means a low-acc origin can persist up to 50m of walking. Compounding error.
**漏的边界 case**:
1. `isLowAccuracy` flag never reaches `useMarkerStore.arOrigin` shape → claim "Tier-A only spawn" cannot be enforced. **Need to confirm the marker store schema actually has the field, or this fix is half-wired.** sub#B should grep the store + unityCairnSpawn for `lowAccuracy`/`isLowAccuracy`.
2. Race: `lastCoord` may update between the L508 acc read and the L527 setIfMissing. If accuracy degrades inside that microtask, the locked origin records a stale "good" acc that no longer holds.
3. acc==null branch: `lastCoord.accuracy ?? 999` rejects null → never locks. OK on iOS but Android sometimes emits 0; not handled.

---

## R2.4 — CrossSessionGroundSnap nearest-XZ per-cairn
**Verdict**: PASS
**Bug 真解决?**: Yes — CrossSessionGroundSnap.cs:96-106 collects validPlanes within maxDist; L128-135 inner loop picks min XZ-distance plane per-cairn. Old area-largest behavior is gone. Single-plane case: `validPlanes.Count==1` → that plane is always nearest. Correct degeneracy.
**Regression?**:
- O(N×M) cost where N=cairns, M=planes. Both small (<20) → negligible.
- "inView" guard (L143-147) still applied; OK.
- Y-snap based on `nearestPlane.center.y` — but center.y is the plane CENTER, not the projected XZ point on the plane. If the cairn is at edge of a sloped (within 20° angle gate) plane, snapping to center.y can introduce a small Y offset.
**漏的边界 case**:
1. **XZ-tied planes**: two planes equidistant in XZ, one above one below. Loop returns whichever iterates first (FIFO, undefined). Could ping-pong across sessions if plane discovery order changes.
2. **Stair landing**: cairn at top of step, big plane at bottom 30cm below within maxDist=8m. Both pass FloorPlaneValidator (both horizontal-up). Nearest XZ may be the lower one → cairn snaps DOWN through floor. minDeltaY gates only at 0.10m so 0.30m absolutely triggers.
3. `_coroutineRunning=false` reset path on the **early return at L107-111** is correct. But the `validPlanes` enumeration uses `planeMgr.trackables` which is a struct enumerable — if planes get destroyed mid-loop the foreach can NRE. Pass 1 caches into List, OK; Pass 2 (cairn loop) reads `validPlanes` not the live trackables → safe.

---

## R2.5 — MultiSpawner Tier-A bypass
**Verdict**: PASS (with sub-system parity CONCERN)
**Bug 真解决?**: Yes — MultiSpawner.cs:231 `mxIsTierA = data.tier == "A"`; L232-233 conditionally adds sessionOffset only when not Tier-A. Matches PortalSpawnerV199 same-session ARKit-direct invariant.
**Regression?**:
- String-equality on `data.tier == "A"` — case sensitive. If RN side ever sends `"a"` or `"tier-a"`, falls through to Tier-B branch and re-introduces drift. No enum/whitelist guard.
- The downstream `mxRaycast.Raycast` at L254 uses `mxSpawnX/Z` which now correctly excludes session offset for Tier-A. OK — anchor will be on the right plane.
**漏的边界 case**:
1. **`data.tier` undefined / null / empty string** → mxIsTierA=false → adds sessionOffset to coords that may already be ARKit-native. Need to confirm `data.tier` is REQUIRED in RN→Unity bridge schema. If missing, an ARKit-native point gets shifted by GPS-drift offset = exactly the bug this fix purports to kill. sub#B please grep CairnSpawnData / `tier` in JSON contract.
2. PortalSpawnerV199.cs:568 region — review notes call out a similar Tier-A bypass there. Need cross-check that BOTH spawners agree on the same `data.tier` field name and casing. Drift between them = 50% bug rate.
3. If `CairnBridge._sessionOffsetX/Z` is set non-zero AFTER spawn time (re-locked origin), Tier-B cairns spawned before re-lock are mis-shifted; Tier-A unaffected. Acceptable but should be in telemetry.

---

## R2.6 — PendingAnchorRetry lidar runtime detect
**Verdict**: PASS
**Bug 真解决?**: Yes — PendingAnchorRetry.cs:91-93 now does `FindFirstObjectByType<ARMeshManager>` + null + enabled + subsystem.running checks, mirroring PortalSpawnerV199.cs:251.
**Regression?**:
- `FindFirstObjectByType` is per-frame in this retry loop (called per raycast hit attempt inside a coroutine that retries until `_deadline`). On a phone with many hit candidates this is mildly expensive but bounded.
- Now LiDAR devices will use the Floor-classification branch in FloorPlaneValidator (lidar=true → L67-74). This means a LiDAR plane with classification!=Floor and area<1m² gets rejected where pre-fix it might have passed area+angle gates. **Behavior tightened — could cause MORE plant retries to fail on LiDAR** until a larger plane is found. Not a bug but a UX change.
**漏的边界 case**:
1. **ARMeshManager exists but mesh subsystem has not started yet** (early ArReady). `subsystem.running==false` → lidar=false → falls back to non-LiDAR validator path even on LiDAR phone. First few seconds after ArReady, retry loop will mistake a Pro/Max for a non-LiDAR device. Acceptable race but worth a one-line breadcrumb.
2. `FindFirstObjectByType` allocates and is not cached. Could cache to a local field once-per-coroutine.
3. If ARMeshManager exists but is `enabled==false` (user toggled off), validator runs as non-LiDAR → fine.

---

## R2.7 — Track flicker 200ms downgrade debounce
**Verdict**: CONCERN
**Bug 真解决?**: Yes for the "5 flickers/sec" symptom — ARScreen.tsx:340-353 makes upgrade immediate, downgrade gated 200ms. Each new downgrade event clears the prior pending timer, so a burst of `limited`s results in ONE delayed apply 200ms after the LAST event.
**Regression?**:
- **Real ARKit limited→limited→tracking sequence**: upgrade clears the timer at L341-344 → trackRef.current set to 'tracking' synchronously. Good.
- **`tracking` → `none`** (camera covered): goes through downgrade timer → trackRef stays 'tracking' for 200ms after a true loss. Plant button stays enabled during a real tracking failure for up to 200ms. User can plant in that window → cairn lands at wrong pose. **This is a 铁律 violation surface area.** 200ms is short, but on a slow-tap user or auto-tap test, it is reachable.
- The `useEffect` cleanup runs on every `arFrame.track` change AND on unmount. Returning the cleanup at L354-359 will clear the timer when `arFrame.track` updates again — meaning if React re-runs the effect with the SAME value (e.g. parent re-render), the timer is cleared and re-armed. Result: a steady-state `limited` re-arming the timer indefinitely, never applying. **Possible permanent-stuck state if arFrame produces same-value updates frequently.** Needs a same-value guard.
**漏的边界 case**:
1. Same-value re-render permanently delays downgrade (above).
2. Initial mount with `arFrame.track==='limited'` → effect runs, sets 200ms timer, applies after 200ms. trackRef initial value (read elsewhere) reads stale 'limited' (state.track default at L329 is `'limited'`). OK only if trackRef initial value matches; need to confirm trackRef declaration.
3. **Plant during the 200ms grace window**: user rapidly plants exactly as `tracking→none` debounce fires → planted with trackRef still 'tracking' → cairn anchored to a frame ARKit considers untracked → drift. Mitigation: also gate plant on `next!=='tracking'` immediately, regardless of debounce. Currently not done.
4. Test harness for this is NOT in 36 PASS baseline (debounce is RN-only timing). Behavior is verified-by-eye only.

---

## Overall Verdict
**STOP — do NOT commit yet.** 4 of 6 PASS clean. 2 need follow-up before sign-off:

| Fix | Action |
|---|---|
| R2.2 | Add Debug.Log emitting actual `plane.classifications` on rejection — for QA tracing only. **Soft.** |
| R2.3 | **HARD blocker**: confirm `isLowAccuracy` is actually persisted into marker store and read by Tier-A spawn gate. Currently appears to be breadcrumb-only. If not wired, fix is half-done and regresses marginal-acc users vs pre-fix. |
| R2.4 | Add tie-breaker for equidistant XZ planes (prefer plane with smaller `|cairnY-planeY|`). **Soft, but stair scenario is real.** |
| R2.5 | Confirm `data.tier` is required field in RN→Unity contract; add fallback rejection (or assume Tier-B on missing) explicit. **Medium.** |
| R2.6 | Cache ARMeshManager lookup outside loop. **Soft perf.** |
| R2.7 | **HARD blocker**: same-value re-render timer-thrash. Add `if (next === trackRef.current) return;` guard at top of effect. Also: gate plant button on raw `arFrame.track` for non-tracking states, not the debounced ref. |

Sign-off blocked on R2.3 wiring + R2.7 guard. Other items can ship as follow-up Stories.

— sub#A
