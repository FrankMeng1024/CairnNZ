# v383 Mock Diff Review — Reviewer A

**Date**: 2026-06-28
**Reviewer**: A (cold, independent of reviewer B)
**Files reviewed**:
- `backend/scripts/seed/mock_via_real_api.py` (648 lines, full new script)
- `backend/scripts/seed/data/v383-jingan-buildings.geojson` (437 polygons, lat 31.2215..31.2355, lng 121.4273..121.4407 — meets `>50` assertion ✓)
- `docs/plan/v383-plan-final2.md` (§A0-A8 mock data plan)
- `backend/scripts/seed/output/v383/*-preview.json` + `*.geojson` (8 uids, dry-run OK)
- Cross-ref: `app/src/services/routing/snapTrack.ts` (production Map Matching)
- Cross-ref: `backend/src/routes/memory.js` (POST /points contract)

---

## Verdict

**NEEDS_FIX** — 3 High issues, 4 Medium issues. Script is **fundamentally sound** (dry-run 8/8 passes, ALLOWED_UIDS guarding well-designed, wipe order verified non-conflicting). But there are several real correctness/operational gaps that must be fixed before `--execute` runs against production.

Do **NOT** ship `--execute` until at least the 3 High issues are resolved.

---

## High severity (must fix before --execute)

### H1 — `output/v383/` is NOT gitignored and will pollute commits with mock previews

**Evidence**:
- `git status backend/scripts/seed/output/` → "Untracked files: backend/scripts/seed/output/" (16 files: `19-preview.json`, `19.geojson`, ..., `27-preview.json`, `27.geojson`)
- `.gitignore` (read in full) — has `docs/qa/`, `docs/ux/`, `docs/virtual-user/`, `dist/`, `build/`, but NO entry for `backend/scripts/seed/output/`
- Plan §A6 says "--dry-run mandatory before --execute" but never says where output lives or whether it should be tracked

**Why it matters**: every developer running `git add -A` will commit 16 files of mock preview data into history. Worse, the GeoJSON files contain the exact walking loop coordinates — these are public anyway (in `WALKING_LOOPS` dict in the script), but the **commit noise** turns every mock run into a git diff.

**Question 7 (your list) confirmed real**: gitignore missed it.

**Fix required**: add to `.gitignore`:
```
/backend/scripts/seed/output/
```
OR (preferred for forensic) commit the file as `output/v383/baseline/` with explicit checkin, then add `output/v383/*.json` `output/v383/*.geojson` to gitignore for re-runs. Decide before --execute.

---

### H2 — authLimiter bump (5000) is never automatically restored to production (10)

**Evidence**:
- `mock_via_real_api.py:368-372` — on 429, prints instructions to bump authLimiter to `max: 5000` and re-run.
- `mock_via_real_api.py` — no `--restore-authlimiter` flag, no atexit hook, no post-run instructions to put it back.
- Plan §A0.2 / `v383-plan-final2.md:81-93` — only describes the bump path. Nothing about restoration.
- Production default per plan §0 fact-check: `max: 10`. Leaving at 5000 means **500× more login attempts allowed forever**, which materially weakens credential-stuffing protection.

**Why it matters** (question 8 confirmed real): after a successful `--execute`, the script exits cleanly and the operator forgets. Next week production has `max: 5000` and an attacker enjoys 500 login attempts per IP per window.

**Fix required**:
1. After successful `--execute`, print loud final reminder:
   ```
   ⚠️  authLimiter is still at max:5000.
   Restore to production value (max:10) now:
     ssh root@122.51.174.118 'docker exec cairn-backend sed -i "s|max: [0-9]\+|max: 10|" /app/src/routes/auth.js && docker restart cairn-backend'
   ```
2. Better: have the bump procedure auto-set a `.authlimiter-bumped` sentinel on the box, and a cron/check that complains after 1 hour.
3. Plan §A0 should explicitly list "restore authLimiter to 10" as a post-mock checklist item with verification command.

---

### H3 — `mapbox_matching()` uses fixed `radius=10` per coord, but production `snapTrack.ts` uses **per-coord variable** radiuses clamped to `[10, 40]`

**Evidence — production reality**:
- `app/src/services/routing/snapTrack.ts:302-307`:
  ```ts
  const radiuses = chunk
    .map((p) => {
      const acc = typeof p.accuracy === 'number' ? p.accuracy : 15;
      return Math.round(Math.max(ACC_RADIUS_MIN, Math.min(ACC_RADIUS_MAX, acc)));
    })
    .join(';');
  ```
- Constants `ACC_RADIUS_MIN = 10`, `ACC_RADIUS_MAX = 40` (snapTrack.ts:125-126).
- The radius is **derived from each raw point's `accuracy` field** — typical real GPS accuracy values are 4-15m indoors-edge, 15-30m under canopy, 30-50m in canyons. Production therefore mostly uses `15-25` not `10`.
- Per `ACC_LOST_M = 20` (snapTrack.ts:124): points with accuracy > 20 are tagged `LOST` and **never sent to Mapbox at all** — they get raw-densify-only.

**Evidence — mock**:
- `mock_via_real_api.py:188-198` — `radius=10` hardcoded for all coords (8 hand-picked waypoints, no accuracy data).
- Tier 2 (line 330) widens to `radius=25`, but only on tier-1 failure.

**Why it matters** (question 3 confirmed real): the mock claims "production-faithful" (script docstring line 8, plan-final2 §A1) but the radius distribution is fundamentally different:
- Production: median radius ≈ 15-20, with LOST-run fallback for >20.
- Mock: every point r=10, no LOST concept, no chunking (CHUNK_SIZE=80 in prod).

The visual effect is real: r=10 is **strictly tighter** than typical prod, so mock matchings will look "cleaner than real" on the same OSM. Demo data will appear unrealistically perfect.

Also missing: `tidy=true` is the same ✓, but no chunking (>100 coord cap) — mock waypoints are tiny (3-12 coords) so this never trips, but the docstring is misleading.

**Fix required**:
1. Drop the "production-faithful" claim from the docstring and plan, OR
2. Make r vary per-coord: pick a random accuracy in [10, 25] per waypoint to simulate real spread, OR
3. Make tier-1 default `radius=15` (median real production value) and tier-2 `radius=25`. r=10 is too tight for "faithful" — it's actually stricter than production for most points.

Strong preference: option (3). r=10 is what `ACC_RADIUS_MIN` clamps to, not what production typically uses.

---

## Medium severity (must fix before merge, not necessarily before --execute)

### M1 — `post_session()` drops MOCK_REVISION tag — forensic identification impossible after mass mock runs

**Evidence**: `mock_via_real_api.py:471-479` — body has `type/start_time/end_time/distance_m/duration_s/name/route_points`. Name is `f"{name} — daily loop"` (line 618). **No `MOCK_REVISION = "v383"` anywhere in the POST body**.

Plan-final2 doesn't explicitly mention MOCK_REVISION but the user's question #16 raised it: "plan §A6 要求 MOCK_REVISION 字段以便 forensic. 漏了." (I cannot find §A6 explicitly requiring it in the plan-final2 file, but the operational case is real.)

**Why it matters**: production DB will end up with sessions tagged "Alice — daily loop" indistinguishable from any real Alice session in the future. If anyone manually creates a session with a similar name, the wipe step won't know which to delete, and forensic "did v383 mock touch this row?" becomes a guess.

**Fix required**: append `[mock-v383]` to session name OR add a notes/meta field, e.g.:
```python
"name": f"{name} — daily loop [mock-v383]",
```
Then update wipe to optionally filter by name pattern as a safety net, AND queryable filter for forensic.

---

### M2 — `post_memory_points()` writes 80+ points with `ts = now_ms + k` (1ms apart) — implausible cluster

**Evidence**:
- `mock_via_real_api.py:495-504` — `now_ms = int(time.time() * 1000)`, then `ts: now_ms + k` for `k = 0..N-1`.
- Alice has 81 snapped points → 81 memory_points with ts spanning **80ms total**. That's a "user walked 1846m in 80ms" implication.
- Backend `memory.js:65-70` accepts integer ts in `(0, now+24h]` — passes validation, no error.
- Comment line 491-493 says "fog clearing is spatial, not temporal, so all-same-ts is fine."

**Why it matters** (question 13): the comment justifies it but it's **provably wrong as a model of reality**:
- Real session ts span (e.g. 9163 session): minutes to hours.
- Mock writes a 80ms cluster.
- Any future feature that uses `ts` for sequencing, replay, or pace analysis (and one already exists: `MapHistoryScreen.tsx:706-715` falls back to `Date.parse(p.timestamp)` for ts on replay) will see mock data as a 80ms teleport.
- Worse: deterministic-cid path uses `(user_id, ts, lat, lng)` as hash input (`memory.js:79`). Two re-runs of `--execute` within the same millisecond would collide cids and INSERT-ON-DUPLICATE would no-op — silent data loss on a fast re-run.

**Fix required**: space ts across the actual `duration_s` of the session:
```python
# session duration is computed in post_session as max(60, int(dist_m * 0.75))
step_ms = duration_s * 1000 // max(1, len(route_points)-1)
points = [{"lat": p["lat"], "lng": p["lng"],
           "ts": start_ts_ms + k * step_ms,
           "cid": uuid.uuid4().hex[:36]}
          for k, p in enumerate(chunk)]
```
And use the **session's start_time** as base, not wall-clock `now`. Otherwise post-3-days-ago session has memory_points with ts of today.

---

### M3 — Mock route shape is NOT "completely identical" to 9163 — 9163 has `alt`, mock has none

**Evidence**:
- Plan-final2 §A2 / line 67: "9163 has no ts/timestamp/t field on points (confirmed in plan-final §0)" — yes for ts, **but says nothing about alt**.
- Plan-final2 line 192: "drop ts AND alt fields from mock route points (match 9163: `[{lat, lng}, ...]`)" — claims 9163 also lacks alt.
- The user's question #12 explicitly challenges this: "9163 vs mock 形状真的'完全一致'吗? 没 alt 而 9163 有 alt 等于 'mock 简单于真实' 还是 'mock 形状错'?"

I cannot verify 9163's actual schema from the script alone, but `MapHistoryScreen.tsx:706-715` normalises with `alt: p.alt ?? null` — meaning the client **expects alt may exist**. If 9163 has alt on its route_points and mock omits it, then mock is "simpler than real" not "identical".

**Why it matters**: any future client code that branches on `alt != null` (e.g. 3D elevation profile, climb rate analysis) will behave differently for mock vs real users. The plan-final2 claim "completely identical" is unverifiable from the script — needs DB-side confirmation.

**Fix required**:
1. Before --execute, run SQL on aliyun: `SELECT route_points FROM sessions WHERE id IN (... 9163's session ids ...) LIMIT 1` and verify whether `alt` exists in the JSON column.
2. If 9163 has `alt`, then mock should also have `alt: null` per point (not omit the key), to truly match shape.
3. Update plan-final2 line 192 with the verified answer, not the assumption.

---

### M4 — `wipe_user_data()` runs `GET /api/sessions /routes /markers` even in `--dry-run` mode

**Evidence**: `mock_via_real_api.py:408-438` — http_get for all three lists, then conditional on `dry_run` for the DELETE. The GETs always run.

User question #15: "wipe_user_data 在 --dry-run mode 也调 GET /api/sessions/routes/markers — 这正常吗?"

**Assessment**: this is actually **correct behavior**, not a bug, because dry-run output needs to know "how many would be deleted" to give the operator a useful preview. The print statement at line 598 shows counts based on these GETs.

BUT — there's a **real subtle problem**: in dry-run mode the script still consumes API quota (auth-rate-limited at 5000/window after the bump, otherwise prod limit 10). With 8 accounts × 3 GETs = 24 reads, not a quota issue normally, but on a flaky network the dry-run can fail differently from --execute, leading to "dry-run looked OK but execute hit different state."

**Fix required**: add a `--no-state-read` flag for fully offline dry-run, OR document explicitly that dry-run touches /me + 3 GET endpoints per uid. Plan §A6 should clarify this side-effect of dry-run.

---

## Lower-severity / informational

### I1 — `detect_backtrack()` heuristic uses dot < -0.95, three-point window — undetectable U-turns at obtuse angles

**Evidence**: `mock_via_real_api.py:231-247`. Dot < -0.95 corresponds to angle > ~168° (cos(168°) ≈ -0.978, cos(160°) ≈ -0.94). So a 160° turn — which a human would absolutely call "turning back" — passes.

Question 4 raised this. The plan accepts up to 1 backtrack anyway (line 318 `MAX_BACKTRACKS = 1`), so a partial U-turn slipping through is by design tolerable. But for visualization, a 160° fold-back will produce visible "the line goes back on itself" without triggering the gate.

**Recommendation**: change threshold to dot < -0.85 (≈148°+) for tighter detection. OR document in plan-final2 §A1 that "near-U-turns with angle ∈ [150°, 168°] are not detected by this heuristic — visually inspect the GeoJSON output."

### I2 — `MAX_CROSSINGS = 1` on OSM building polygons in Jing'an — accepts walking through 1 building

**Evidence**: `mock_via_real_api.py:318`. Comment justifies as "OSM building polygons can include walkable service alleys / arcades — false positives expected."

Question 5: "OSM building polygon 在静安区精度多少米?" OSM Jing'an buildings are typically extruded from satellite trace + manual edit; precision usually ±2-5m for the polygon edge. So a true edge-graze of 1-2m **is** a likely false positive, and MAX_CROSSINGS=1 is defensible.

However, the dry-run preview JSONs all show `crossings=0` already (verified all 8). So `MAX_CROSSINGS=1` was never exercised on this run. If a future tweak to WALKING_LOOPS produces `crossings=1`, the script will silently accept it without a print/warning. **Recommend**: when `crossings == 1`, print a one-line warning "accepted with 1 crossing — visually verify". Plan-final2 §A7 says "HARD STOP if any crossings > 0" — this **contradicts** the script which allows up to 1. Plan vs implementation mismatch.

### I3 — Buildings bbox `[31.222, 31.235] x [121.428, 121.440]` is correct for waypoints, but **snapped polylines may leave bbox**

**Evidence**:
- Plan-final2 line 108: bbox `[31.222, 121.428, 31.235, 121.440]`.
- Buildings file actual bbox (Python check): lat `31.2215 .. 31.2355`, lng `121.4273 .. 121.4407`. Matches.
- Waypoints (verified from script lines 75-109): all lat ∈ [31.22725, 31.23304] and lng ∈ [121.43152, 121.43729]. **Bob's waypoint 31.22725 / 121.43641 — within bbox**.
- But Mapbox matching can snap to a nearby road outside the input convex hull. Particularly for Bob's east-arc and Eve's south-crescent, mapbox can snap south of 31.227 if the closest road is.

Question 6 confirmed: yes, snapped polylines theoretically can exit the building-coverage bbox. **In practice**, the dry-run results show no warnings, and the snapped distances are short, so likely all stayed within bbox. But there's no assertion to confirm.

**Recommend**: after `mapbox_matching()` returns, assert `min(lat) >= 31.222 - 0.001 and max(lat) <= 31.235 + 0.001 and ... [lng bounds]`. If snapped polyline exits bbox, the 穿楼 check is incomplete and should warn loudly. Currently silent.

### I4 — `ALLOWED_UIDS` and `EXPECTED_UID` exposed in committed public script

**Evidence**: `mock_via_real_api.py:56, 70`. `ALLOWED_UIDS = {19, 20, 21, 23, 24, 25, 26, 27}` and `EXPECTED_UID = {"1": 19, ...}`.

Question 11 raised. Mapbox token is properly env-var'd ✓ (line 46). But the **uid → email mapping is hardcoded**: 1@1.com = uid 19, 2@2.com = uid 20, etc. This is **not a secret** in the cryptographic sense — these are test accounts — but it does reveal internal uid schema.

**Risk**: low. The accounts are throwaway demo accounts (passwords are also "1", "2", ..., "9" — line 59-66). The real concern would be if an attacker gained 1@1.com / password "1" they could now know they're uid 19, but they already have a valid token from logging in. No incremental risk.

**Recommend**: nothing urgent. Worth a comment in the script that "demo accounts are public — production users start at uid >= 28". Or document in plan that this is intentional.

### I5 — `verify_uid_allowed()` runs AFTER login(), so a wrong-credentials run still consumes authLimiter

**Evidence**: `mock_via_real_api.py:587-594`. Login (line 587) burns one authLimiter slot regardless of uid. /me check (line 591) is post-login.

Question 14 confirmed. If someone runs the script with 9163's credentials in place of 1@1.com, the flow is:
1. login(token, …) → 200, returns uid 22's token (consumes 1 authLimiter slot)
2. verify_uid_allowed → uid 22 not in ALLOWED_UIDS → sys.exit(3) ✓ (safe abort)

Authlimiter slot burned is recoverable. **The actual risk** is: the script aborts before any wipe, so the rest of the 8 accounts in that --execute run are also skipped. Operator sees "STOP refusing to touch uid 22" and has to fix the email/password env and re-run. Annoying but safe. Not a bug.

**Recommend**: add early sanity check before any HTTP — `assert EXPECTED_UID[email] in ALLOWED_UIDS` per ACCOUNTS row, to catch config errors at startup rather than after login. (This is a 3rd guard layer.)

### I6 — `datetime.now(timezone.utc)` substitution looks clean — no residual `utcnow()`

**Evidence**: `grep -n "utcnow" mock_via_real_api.py` → 0 matches. The only `datetime.now` is at line 465 with `timezone.utc`. ✓

Question 9 verified clean.

### I7 — Wipe order sessions → routes → markers → memory is **safe** but not explicitly verified for FK constraints

**Evidence**: Question 2. The order is by-API not by-FK. Each endpoint deletes its own rows, and FK relationships between these tables aren't visible from the script. From `backend/src/routes/memory.js:184` the memory bulk delete is `DELETE FROM memory_points WHERE user_id = ?` — no FK to sessions.

Assessment: sessions and routes likely have no FK to each other in this codebase (Cairn historically uses session.id refs but with cascade deletes or app-layer cleanup). DELETE order doesn't matter at the API layer because each endpoint is its own transaction.

**Recommend**: nothing to fix. But add a one-line comment in `wipe_user_data` explaining "order is by visibility (sessions = top-level user view) not by FK — each DELETE is independent". This helps future maintainers.

---

## Summary table

| # | Severity | Issue | Cite | Must-fix before --execute? |
|---|----------|-------|------|----------------------------|
| H1 | High | `output/v383/` not gitignored | `.gitignore` (no entry), `git status` confirms 16 untracked | YES |
| H2 | High | authLimiter never auto-restored to 10 | `mock_via_real_api.py:368-372`, plan §A0.2 | YES |
| H3 | High | radius=10 fixed, prod uses per-coord 10..40 | `snapTrack.ts:302-307`, `mock_via_real_api.py:189` | YES |
| M1 | Medium | No MOCK_REVISION tag on sessions | `mock_via_real_api.py:471-479` | Before merge |
| M2 | Medium | memory_points ts clustered in 80ms | `mock_via_real_api.py:495-504`, `memory.js:79` | Before merge |
| M3 | Medium | mock omits alt; 9163 may have alt | plan §A2 line 192, unverified vs DB | Before merge |
| M4 | Medium | dry-run consumes API quota | `mock_via_real_api.py:408-438` | Document only |
| I1 | Info | backtrack heuristic misses 150-168° folds | `mock_via_real_api.py:231-247` | No |
| I2 | Info | MAX_CROSSINGS=1 contradicts plan "HARD STOP if >0" | `mock_via_real_api.py:318` vs plan-final2:118 | Plan or code align |
| I3 | Info | Snapped polyline may exit buildings bbox | `mock_via_real_api.py` (no assertion) | No |
| I4 | Info | ALLOWED_UIDS schema visible in script | `mock_via_real_api.py:56` | No |
| I5 | Info | verify_uid_allowed after login (3rd guard suggestion) | `mock_via_real_api.py:587-594` | No |
| I6 | Info | utcnow() residue check clean | grep -n | No |
| I7 | Info | Wipe order safe but undocumented | `mock_via_real_api.py:401-457` | No |

---

## Final Verdict

**NEEDS_FIX**

3 High issues (H1 gitignore, H2 authLimiter restore, H3 radius parameter divergence) are blockers for --execute. M1-M3 are forensic/correctness concerns that should be resolved before merging mock data to production DB to keep mock distinguishable, replay-correct, and shape-correct vs 9163.

Dry-run output (8/8 OK, all `crossings=0`, distances 0.34-2.10km) **is good evidence the snap pipeline produces sensible polylines**. The script's core algorithm — Matching tier 1 → tier 2 → Directions walking → cycling fallback — is well-designed and worked on every uid in this run.

The blocking issues are operational hygiene (H1, H2) and a faithfulness claim that doesn't hold (H3). Fix those three, optionally address M1-M3, then --execute is safe to proceed.
