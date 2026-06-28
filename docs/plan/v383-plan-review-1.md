# v383 Plan — Section A Independent Review (Reviewer #1)

**Scope**: Section A only (A1 root-cause matrix + A2 fix proposals + A3 Playwright review).
**Reviewer context**: did not participate in v383 planning; reads cold against the current `mock_via_real_api.py`.
**Method**: 7-axis adversarial review per user's prompt. No reference to other reviews.

---

## 1. A2.1 — Profile choice (walking vs cycling fallback)

### 1.1 [High] "Future, we'll deal with it" is not a plan for the very first failure mode

A2.1 commits to `walking` for all 8 accounts and adds a header rule "profile=cycling for urban accounts where walking edges return NoSegment; profile=walking otherwise. Default walking. Log the choice."

But the rule is documentation-only — A2.5 (Directions API switch) and the script flow in `mock_via_real_api.py` (`map_match()`, lines 188-216) currently have **no automatic fallback path**. The plan says "log the choice" but no code path implements profile selection per uid. If Alice fails on `walking` on the second pre-OTA dry-run, the operator has to hand-edit the script, re-run, re-shoot Playwright — burning an entire 4-eye cycle.

**Severity**: High. The "future, we'll deal with it" gap turns into wasted Playwright cycles.

**Fix**:
- A2.5 must specify: each Directions call wraps a `try walking → on no-route → retry cycling → log fallback uid=… profile=cycling reason=NoSegment`.
- Persist the chosen profile per uid into `output/v383/<uid>.geojson` properties so re-runs and review screenshots remain reproducible.
- Risk register row "Mapbox Directions returns no walking route between waypoints" (line 230) already foreshadows this — but it's listed as L=Low. For Shanghai 静安 service alleys it's L=Medium and should be the default expectation, not an edge case.

### 1.2 [Medium] Walking edges aren't fully OSM-mapped in Shanghai 静安

Many of Alice's waypoints sit on `service` roads (`万春街`, lines 67-68 of mock script). Mapbox walking profile in mainland China derives from OpenStreetMap + commercial partners; OSM `highway=service` coverage in 静安 is patchy. Even on the centreline of `service`, Mapbox may return `NoRoute` because the edge isn't classified walking-permitted.

**Fix**: pre-validate every anchor with `/v4/mapbox.mapbox-streets-v8/tilequery/{lon},{lat}.json?layers=road&radius=0` before submitting to Directions. If the nearest road feature has `class IN (service, footway, path, pedestrian)` continue; else flag the anchor for relocation. Add as required step in A2 sequence.

---

## 2. A2.5 — Directions API switch

### 2.1 [Blocker] Loop concatenation timestamp seam

A2.5 says: "If loop required, call Directions again from destination back to start via a different waypoint. Concatenate."

The current `post_session()` (lines 295-323) builds ts with one global `start_ms + k * ts_step`. If you naively concat polyline1 + polyline2, the duplicate point at the seam either:
- Gets two identical timestamps (back-to-back) → backend POST /api/sessions may reject or dedupe, OR
- Causes the polyline path to appear to "pause" at the junction (no movement for one ts_step) — which v382 client snapTrack-style consumers would treat as a GPS stall, possibly triggering session split logic.

The plan does not specify:
- Whether to dedupe the seam coordinate.
- Whether to keep distance-proportional ts (A2.3 mentions "for v383, simple linear is fine" — that's the bug).
- What the backend's `route_points[*].ts` ordering constraint actually is.

**Severity**: Blocker for "look like a real hike". A single second of standstill at the seam plus identical lat/lng = visible kink in any timeline replay.

**Fix**:
- Mandate distance-proportional ts (A2.3 second bullet) — not "simple linear is fine."
- Dedupe seam: drop the first point of segment-2 (it equals last point of segment-1).
- Add assertion in `post_session()`: `assert all(rp[i+1]["ts"] > rp[i]["ts"] for i in range(len(rp)-1))` before POST.

### 2.2 [High] Mainland China Mapbox walking data completeness

Mapbox in mainland China is **not** straight OSM — it's served via the Mapbox China endpoint (`api.mapbox.cn` for some accounts) which uses partner data (4Map / 长地万方 historically), and walking profile coverage is materially worse than driving. A2.5 should specify which endpoint the script hits and confirm walking is supported.

In the current script (line 200), `https://api.mapbox.com/matching/v5/mapbox/walking/...` — that's the global endpoint, not the China endpoint. From a Shanghai network, this may route through Hong Kong with mainland walking data quality. Need to test before committing the whole plan to Directions.

**Severity**: High. If Mapbox global endpoint returns sparse/wrong walking geometry in 静安, the entire A2.5 switch produces worse-not-better results.

**Fix**:
- Add A2.5.0 pre-check: curl-test Directions API on Alice's start anchor + 200m east anchor. Inspect geometry. If geometry is sparse (< 1 vertex per 30m on a known walkable road) or returns motor_vehicle roads — A2.5 strategy must be revised.
- Document the endpoint in TECH_SPEC: `api.mapbox.com` vs `api.mapbox.cn`.

### 2.3 [Critical] Token in URL leak

Both current `map_match()` (line 202) and the proposed Directions call put `access_token=…` in the URL. URLs end up in:
- HTTP server access logs (Mapbox side — fine, theirs).
- Local backend logs if `mock_via_real_api.py` ever runs under a wrapper that logs subprocess args / outputs.
- Mapbox stats per-token usage page — non-sensitive.
- **`output/v383/<uid>.geojson`** if A3.1 stores the full request — would leak the token into a git-tracked artifact.

`MAPBOX_TOKEN` here can be either public scope (`pk.…`) or secret scope (`sk.…`):
- Public (`pk.…`): Directions API and Map Matching API are accessible from public tokens. Fine to use, but tokens are still rate-attributable to the account. If A3.1 commits the URL into git, public token spammable from anywhere.
- Secret (`sk.…`): if anyone set `MAPBOX_TOKEN` to a secret token (not impossible — script doesn't validate), leak is much worse.

**Severity**: Critical for token discipline. Low severity for the immediate v383 build, but easy to fix now.

**Fix**:
- `map_match()` and Directions call: send token via header `Authorization: Bearer <token>` if Mapbox supports it (Directions API does), OR strip token before logging/storing.
- Add explicit token-scope assertion: `assert MAPBOX_TOKEN.startswith("pk."), "use public token only"`.
- In A3.1 storage step, save **only** the geometry response, not the request URL.

### 2.4 [Medium] Why not Matching + tidy=true + radius=10 first, Directions as fallback?

Plan rejects Matching in favor of Directions outright. But Matching with `tidy=true` and per-coord `radiuses=10` is exactly what the production client uses in `snapTrack.ts:ACC_RADIUS_MIN` — using the same Matching code path on mock data means **the mock exercises the same code path as a real user's saved hike**, which is the user's stated bar ("mock 数据走真实 save hike 逻辑").

Directions API solves a different problem (intent-based routing). Switching to it makes the mock pipeline **diverge** from production client behavior. The user's flag was "和正常 hike 没区别" — Directions makes mock fancier than real hikes.

**Severity**: Medium philosophical. Recommend Matching with tightened params first; Directions only when Matching fails.

**Fix proposal**:
- A2.5 revised: **Matching first** with `tidy=true&radiuses=10;10;…;10`. Inspect output: if any segment doubles back on itself (forward + backward on the same edge) — Directions fallback for that uid. Per-uid choice logged.
- This also satisfies user's "real hike" framing better than universal Directions.
- Plan keeps Directions as the explicit escape hatch — good — but flips the default.

---

## 3. A2.4 — Memory wipe

### 3.1 [Blocker] No verification that DELETE /api/memory/points is actually wired

Plan asserts: `Backend has DELETE /api/memory/points. Mock adds one line: http_delete(f"{BACKEND}/api/memory/points", headers=h)`.

I cannot read `backend/src/routes/memory.js` (not in my scope), but A1's claim references `backend/src/routes/memory.js:180`. The risk:
- Endpoint may be **per-point** (`DELETE /api/memory/points/:id`) not **bulk** — wipe would silently no-op.
- Endpoint may require a confirmation body (`{"confirm": true}`) — wipe call returns 400, script logs the error and moves on (current `http_delete()` lines 165-174 returns `e.code, {}` silently, no print).
- Endpoint may only soft-delete (`deleted_at`) — points stay in DB and re-appear in subsequent `GET /api/memory/points` queries on client.
- Cascade: does it cascade to fog-tiles cache? If not, client's `useMemoryStore` keeps the fog cleared locally even after server wipe → user's "memory 没重置" complaint persists.

**Severity**: Blocker. Without verifying the endpoint behavior, A2.4 is "we hope it works."

**Fix**:
- Plan must include explicit step: read `backend/src/routes/memory.js` route handler implementation BEFORE writing the mock script line. Document endpoint method + body + return semantics in plan.
- Add post-wipe verification call: `GET /api/memory/points?limit=1 → expect 200 + empty`. Mock script bails if not empty.
- `http_delete()` currently swallows errors silently — that's the same bug pattern as v335 (memory note: "dev tool 删数据前必须 DRY-RUN"). Add `if status not in (200, 204): print(f"[err] DELETE memory failed: {status}"); raise SystemExit(2)`.

### 3.2 [High] Client-side stale cache is a separate problem from server wipe

User complaint: "Memory 我看到很多皇冠 但是他们的圆呢 没有了". A1 attributes this to **PointAnnotation clipping** (Section B territory), not mock data. But a parallel root cause: if mock wipes server but client `useMemoryStore` keeps stale fog-cleared tiles, the user sees old fog state with new pins on top — Memory map appears half-stale.

**Severity**: High — but it's a different code path from A2.4 (this is client persistence, not server data). Plan should explicitly call this out as "out of scope for Section A; tracked separately in Section B."

**Fix**:
- Add to plan: "After mock re-run, user must force-quit + relaunch app to clear `useMemoryStore` in-memory cache. If `useMemoryStore` uses AsyncStorage persistence, also clear that. Document the manual step in mock script's final printed instructions."
- Optional: add a backend-side cache-bust signal (e.g., bump a `memory_version` on user record after wipe, client refetches when version changes).

### 3.3 [Medium] Wipe deletes one user's data — script must guard 9163

Currently `wipe_user_data()` (lines 263-293) iterates the logged-in user's own sessions/markers — scoping is fine *because the JWT is per-user*. But the plan's A2.4 adds `DELETE /api/memory/points` — same scoping assumption applies, but what if the endpoint actually accepts an `?user_id=…` param and an admin token would wipe anyone? Unlikely, but the Risk Register row "DELETE cascades to 9163" (F. row 4) is rated VL=VeryLow. I think it's L=Low but worth a belt-and-braces ALLOWED_UIDS check at script entry, NOT just in the risk register.

**Severity**: Medium.

**Fix**:
- Add to mock script top-level main: `ALLOWED_UIDS = {19, 20, 21, 23, 24, 25, 26, 27}`. After login, query `GET /api/auth/me` (or whatever the user-info endpoint is), assert `response.user.id in ALLOWED_UIDS`. Hard exit otherwise.
- This is cited in Risk Register but not in A2 fix sequence — promote it.

---

## 4. A2.3 — Densify removal & ts realism

### 4.1 [Blocker] Backend ts strict-increase constraint unknown

Plan A2.3 says: "After removal, len shrinks ~80→~25, ts_step grows ~6s→~20s. Realistic enough." With distance-proportional ts (A2.3 second bullet), two short segments back-to-back can yield `ts[i+1] - ts[i] = 0` for path vertices spaced < (total_duration / total_distance × 0.5m). On Directions output where the API emits two coordinates ~1m apart at a sharp corner, this **will** happen.

I don't have visibility into `route_points` schema validation in backend. Possible behaviors:
- Strict increase enforced → POST 400.
- Equal-ts allowed → backend accepts → client replay shows two points at the same t → snapTrack-side dedup or NaN speed calc.

**Severity**: Blocker for "realistic mock". Even if backend accepts, downstream replay breaks.

**Fix**:
- Spec out the constraint. Add assertion in `post_session()` as recommended in 2.1.
- Distance-proportional ts MUST clamp: `ts[i+1] = max(ts[i] + 1, computed_ts)` so every step is ≥ 1ms apart.

### 4.2 [Medium] "20 s/pt is realistic" overstates the bar

A2.3 says: "ts_step grows from ~6 s/pt to ~20 s/pt. Realistic enough."

But real GPS on iOS during a walk = 1 Hz when active, sometimes more (Apple's CoreLocation auto-thins). The user's 9163 baseline session (cited in mock script line 56) — what's its actual ts spacing? Plan should reference 9163's ts distribution as the bar.

If 9163 has ~1-3 s/pt and mock has ~20 s/pt, mock looks **sparser** than real, which means replay animations stutter visibly. The argument "real hike doesn't have that many points" isn't supported by 9163.

**Severity**: Medium. The user's "real hike" bar is whatever 9163 looks like, not an abstract notion of realism.

**Fix**:
- Pre-step: compute 9163's actual `mean(ts_step)` and `p90(ts_step)`. If mock's post-densify-removal ts_step is materially sparser, **keep a lighter densify** with spacing matching 9163's geometry, OR upsample after Directions to match. Plan picks the wrong direction by removing densify entirely.
- The densifier is a chord problem at corners (A1 row 2). The fix is "densify with adaptive spacing — keep tighter spacing on straight segments, drop or move vertices near corners," not removal.

### 4.3 [Low] Distance-proportional ts is still wrong at stops

Real walking includes pauses (traffic lights, photos). Linear distance-proportional ts assumes constant speed. For "and 9163 was a real hike," the mock should optionally inject 2-5s of stalls at junctions. Not Blocker — but if the goal is "indistinguishable from real," this is a tell.

**Severity**: Low.

**Fix**: out of scope for v383, but log as backlog Story for v384.

---

## 5. A2.7 — Public marker SQL seed

### 5.1 [High] Direct SQL bypass of permission validation is exactly the wrong tool

Plan: "Seed Public marks via SQL `backend/scripts/seed/public_marks_v383.sql`. Mock script handles only Friend + Personal via API."

This is a category mistake on multiple axes:

1. **Sustainability**: any future backend addition of `markers` table columns (e.g. `moderation_status`, `created_via`, `audit_user_id`) requires updating the SQL seed in lockstep. The mock script will silently produce stale rows that don't match production schema.
2. **Trigger / constraint bypass**: if backend later adds a `BEFORE INSERT` trigger to enforce `permission='public' requires admin_review=true`, the SQL INSERT either errors out (loud) or bypasses (silent — depending on the trigger). Either way: divergence from production behavior. User's stated bar is "和正常 hike 没区别" — direct SQL is the opposite.
3. **No audit trail**: a Public mark made through the proper admin API path would have `created_by_admin_id`, IP, timestamp, etc. SQL-seeded ones are forensically distinct from real ones.
4. **The current `post_marker()` (line 359-365) already has a silent demote-to-group fallback**. The plan calls this out as "Stranger 1/2/3 + Carol currently produce Friend-tier marks, not Public." Solving by SQL is solving the symptom (Public not exposed via API) instead of the root cause (backend lacks an admin-or-bypass-token Public mark endpoint).

**Severity**: High. Violates the user's stated bar; creates schema drift risk.

**Fix**:
- Backend adds an admin endpoint: `POST /api/admin/markers` accepting a service token (env-supplied to mock script), bypassing the client-write rejection but going through the same validation pipeline + audit fields as future moderation flow.
- Mock script calls this endpoint with the service token for Public markers; Friend/Personal continue through the regular `/api/markers` path.
- No SQL seed file. Clean.
- If backend work is too much for v383 timeline: keep current "silent demote to group" behavior, document Public-tier gap as known limitation, ship Public marks in v384 with the admin endpoint.

### 5.2 [Medium] If SQL seed stays, schema-checked transactional

If the team insists on SQL seed for v383:
- Wrap in `BEGIN; … COMMIT;` with `SELECT 1 FROM markers WHERE id = …` checks.
- File header comment: "WARNING: this bypasses application-layer permission enforcement. Remove and replace with `POST /api/admin/markers` before v384."
- CI check: any backend migration touching `markers` table flags the seed file as out-of-date.

---

## 6. A3 — Playwright 4-eye review

### 6.1 [Blocker] "4-eye independent review" of identical PNGs is not 4 eyes

The plan says: "4 eyes (main + sub#1 + sub#2 + user) independently flag …"

LLM-as-image-reviewer for the same PNG → near-deterministic output. The two subagent reviewers, both Opus, looking at the same `mock-preview/v383/uid19-z16.png`, will:
- Anchor on the same salient features (the polyline color, the marker pins).
- Reach the same conclusion about "crosses building" because they're applying the same heuristic ("does the line traverse a polygonal feature with rooftop-grey fill?").
- Disagree only on edge cases — not on the bulk of judgments.

This is **not** independent review. It's two-coats-of-paint review. The user noticed this in the very prompt ("subagent 看图能力强吗?同一张 PNG 两个不同 subagent 大概率给出'几乎一样'的判断").

**Severity**: Blocker for the "4-eye gate" claim. If we ship saying "4 eyes approved" but it was effectively 2 eyes (main + user) plus 2 LLM rubber-stamps, that's the same review hygiene failure as v333's review-loop anchoring bias (memory note `feedback_review_loop_premise_check.md`).

**Fix**:
- **Adversarial framing**: subagent #1 prompt = "You are reviewing for the strongest argument that this polyline is GOOD." subagent #2 prompt = "You are reviewing for the strongest argument that this polyline is BAD — find at least 3 problems." This is the only way to break LLM mode-collapse on image judgment.
- **Different evidence per subagent**: don't show both subagents the same PNG set. Sub#1 gets z16 PNGs only; sub#2 gets z14 + a derived "overlay diff against 9163 baseline" PNG. Different evidence → different reasoning paths.
- **Quantitative criteria, not vibes**: each subagent must produce numeric outputs (estimated angle of any sharp turn, count of markers visible, distance from polyline to nearest building edge in pixels). Disagreements on numbers are detectable; disagreements on "looks fine" are not.

### 6.2 [Critical] "Polyline crosses building" is not visually detectable at z14

At Mapbox zoom 14, individual buildings render as ~3-5 pixels wide aggregate beige blobs. "Crosses building" detection at z14 is essentially impossible by human eye and worse for an LLM looking at a 1024-wide PNG.

A1 row 2 even notes this in the symptom ("chords cut buildings") — but A3 doesn't specify what zoom that detection happens at. Z16 is the minimum useful zoom; z18 better.

**Severity**: Critical. The whole review purpose is to catch "穿楼" — if the screenshots can't show it, the gate is theater.

**Fix**:
- Mandate z17 minimum for "crosses building" detection. Add a z19 spot-check for any suspicious segment.
- Or: ditch image-based detection entirely. Use OSM building polygons (`overpass-turbo` query for `building` polygons in the bbox) + a Python `shapely` intersection check between the snapped polyline and building polygons. Output: `output/v383/<uid>-building-crossings.json` with each crossing's lat/lng and OSM way id. THIS is independently verifiable by both subagents and the user.
- Image review then becomes "spot-check the flagged crossings," not "find them by eye."

### 6.3 [Medium] No retest-after-fix loop defined

A3 step 5: "any flag → reselect waypoints for that uid, repeat." How many iterations max? When do we escalate to "this uid can't be made to work, ship 7 of 8"? When does this loop start consuming days?

**Severity**: Medium.

**Fix**:
- Cap: 3 reselect iterations per uid. After 3 fails, escalate to user with "uid N waypoints don't snap cleanly, options: (a) different street, (b) shorter loop, (c) drop this account from mock."
- Time budget: 1 hour per uid. Beyond that, alert.

### 6.4 [Low] Where is the screenshot evidence directory

Plan says `docs/mock-review/v383/`. CLAUDE.md spec defines evidence directories as `docs/qa/sprintN-evidence/` and `docs/ux/sprintN-evidence/`. The mock review is closer to a QA artifact. Either:
- Use `docs/qa/sprintN-evidence/v383-mock-uidN-zM.png` per existing convention, OR
- Get an explicit exemption recorded in TECH_SPEC.

**Severity**: Low.

**Fix**: align with CLAUDE.md evidence-naming convention.

---

## 7. What A omits entirely

### 7.1 [Blocker] Production-DB pollution lifecycle

Plan runs the mock against `https://api.yiiling.cn` — **production**. Section A says nothing about:
- How to roll back mock data if the polylines turn out wrong AFTER OTA push. (The script `wipe_user_data()` exists but isn't documented as the rollback tool.)
- What happens to real-user data created on mock accounts in the interim. (Production user 19 might be Alice on someone's actual device.)
- Whether mock should run against staging first.

Memory note `feedback_dry_run_before_delete.md` (v335) explicitly demands DRY-RUN before destructive ops. A2.4's wipe step is destructive. Plan has no DRY-RUN mode.

**Severity**: Blocker. v335 was the precedent — we shouldn't repeat it.

**Fix**:
- Add `--dry-run` flag to `mock_via_real_api.py`. In dry-run: do all GET + Mapbox calls, write `output/v383/<uid>-preview.json` showing what WOULD be deleted and what WOULD be inserted, but execute zero DELETE/POST.
- Two-phase script: phase 1 dry-run + 4-eye review of preview JSON; phase 2 real execute. Same flag toggles.
- Document rollback in plan: how to restore. If "we can't restore," that's a hard stop until backup is wired.

### 7.2 [High] authLimiter rate-limit constraint not in plan

User's prompt note: "mock 脚本运行需要 backend authLimiter 临时放宽到 1000 (我刚才在生产环境改过), 没记入 plan".

This is a real operational dependency. If next run is from a fresh dev box or after a backend container restart resets the limiter, the script will fail at step 1 (login) on user 4-8 with 429s. No mention in plan = next operator burns 30 min figuring out why login fails.

**Severity**: High operational.

**Fix**:
- Add to plan A2.0 (preflight): "Verify `authLimiter` allows ≥ 100 attempts / 5 min from the calling IP. Current production setting: 6000 (matches edit-diag pattern, memory note `reference_edit_diag_ratelimit.md`). Restart the container resets — re-apply before running mock."
- Or better: switch login to a service-token path that bypasses authLimiter entirely. (Same fix pattern as 5.1.)

### 7.3 [Medium] Mapbox token scope unspecified

`MAPBOX_TOKEN` in script — what scopes does it need?
- Map Matching API: `styles:read` not required; default public scope works.
- Directions API: same — public token works.
- But: rate limits per public token = 60 req/min for free tier. Mock runs 8 accounts × (1 Directions for loop A + 1 Directions for loop B for loop closure + …). May get throttled.

`EXPO_PUBLIC_MAPBOX_TOKEN` is the client-side token — using it for server-side mock generation pollutes its usage stats and consumes the same per-minute quota the production app uses. Not strictly broken, but bad hygiene.

**Severity**: Medium.

**Fix**:
- Use a separate `MAPBOX_TOKEN_MOCK_SERVER` public token. Document in plan. Different rate-limit bucket.

### 7.4 [High] Reproducibility of snapped output

Plan A3.1 stores `<uid>.geojson` (snapped polyline). Good. But:
- Does NOT store the input waypoints (the WALKING_LOOPS dict from script).
- Does NOT store the Mapbox request URL or parameters.
- Does NOT store the Mapbox response timestamp/version.

If Mapbox updates their walking graph next month and Alice's loop now snaps differently, we can't diff against what was approved.

**Severity**: High for the audit trail.

**Fix**:
- A3.1 stores three artifacts per uid: `<uid>-input.json` (waypoints + profile + parameters), `<uid>-mapbox-response.json` (raw Mapbox response, **token stripped**), `<uid>-final.geojson` (polyline + markers, what gets used).
- Commit all three to git.
- Open question for plan: where to put this. `tasks/jira/sprintN-evidence/` or `backend/scripts/seed/output/v383/`?

### 7.5 [Medium] 9163 protection — concrete code

Plan F (Risk register) row 4: "Endpoint is per-authenticated-user. 9163 not in mock account list. Add explicit `ALLOWED_UIDS = {19,20,21,23,24,25,26,27}` check in mock script."

This is named in Section F but not in A2 fix sequence. Promoted-from-A would be:
- ALLOWED_UIDS asserted at the top of `main()`.
- After login, query user-info endpoint, assert uid in set.
- Same check at the top of `wipe_user_data()` as belt-and-braces.

**Severity**: Medium (low likelihood × catastrophic consequence — v335 grade incident).

**Fix**: explicitly move from Risk Register to A2.0 preflight step, with code-snippet level specification.

### 7.6 [Medium] Mock running concurrently with real users

If a real user is mid-hike on user 5 (LDY) when mock runs, `wipe_user_data(token, 23)` deletes the session they're actively recording. (Realistically these are factory test accounts — but unstated assumption.)

**Severity**: Medium for production hygiene.

**Fix**:
- Document: "ACCOUNTS 1-3, 5-9 are mock-only — no one should ever be logged in as them in production." If that's the policy, OK. Plan must say so.
- Optional: add a `last_login_at` check before wipe. If `< 5 min ago` → bail with warning.

### 7.7 [Low] Missing: how to validate Mapbox response geometry programmatically

Plan A3 relies entirely on visual review. But before Playwright shoot, the script itself should sanity-check the geometry:
- `len(coordinates) > 2`
- `total_distance ∈ [800, 3000]` (matches A2.5 criterion 4)
- `max_angle_change` < some threshold (no spikes)
- `vertex_spacing.median() < 30m`

Cheap to add. Catches obvious failures before Playwright burns cycles.

**Severity**: Low.

**Fix**: add `validate_geometry()` step after `map_match()` / Directions call.

---

## Verdict

**NEEDS_CHANGES**

Section A is structurally on the right track — root-cause matrix correctly identifies most symptoms, A2.4 fixes a real gap, the Directions-vs-Matching debate is worth having. But there are **4 Blockers** and several High items that must be resolved before code:

| # | Severity | Topic | Why Blocker |
|---|----------|-------|-------------|
| 2.1 | Blocker | Loop concat ts seam | Will produce visibly broken replays |
| 3.1 | Blocker | DELETE /api/memory/points unverified | "We hope it works" against production DB |
| 4.1 | Blocker | Backend ts strict-increase unknown | POST may 400, or replay breaks silently |
| 6.1 | Blocker | "4-eye review" is actually 2-eye | Same anchoring-bias failure mode as v333 |
| 6.2 | Critical | Z14 PNGs can't show "穿楼" | Gate is theater |
| 7.1 | Blocker | No DRY-RUN / rollback for prod-DB | v335 repeat risk |

**Recommended sequence before approving plan**:
1. Verify backend `DELETE /api/memory/points` and `route_points` ts constraint (read `backend/src/routes/memory.js` and `backend/src/routes/sessions.js`).
2. Reframe A3 with adversarial subagents + OSM building-polygon intersection check.
3. Add `--dry-run` mode to mock script + rollback plan.
4. Decide Matching-first-then-Directions (recommended) vs Directions-first.
5. Drop SQL seed; replace with admin endpoint OR document Public-tier gap as deferred.
6. Add A2.0 preflight section: authLimiter, token scope, ALLOWED_UIDS, geometry validation.

Once those land, re-review.
