# v383 Plan-Final — Attack Review (Reviewer #3, adversarial)

**Role**: 进攻方. Mission: find at least 3 NEW high-severity holes in `v383-plan-final.md` that Reviews #1 and #2 did not catch (or that plan-final claimed to address but actually did not).
**Files audited**: plan-final, review-1, review-2, `mock_via_real_api.py`, `CairnPinsLayer.tsx`, `mapboxAdapter.ts`, `app/assets/` directory listing.
**Method**: 8 attacks below. Verdict at bottom.

---

## ATTACK 1 — SymbolLayer + Images sprite atlas requires NATIVE Mapbox SDK behavior; plan §C ships it via OTA. **OTA cannot register new sprite images that don't exist in the previous JS bundle's `<Images>` mount, but it CAN deliver new PNG bytes — UNLESS `mapboxAdapter.ts` was never updated to export `SymbolLayer` and `Images`. It hasn't been.** This is the killer.

- **触发条件**: Plan §C1/C3 says "migrate to SymbolLayer + Images sprite atlas via OTA". I just read `app/src/features/memory/services/mapboxAdapter.ts` lines 12-22: the `MapboxAdapter` interface exports only `{ MapView, Camera, PointAnnotation, UserLocation, LineLayer, FillLayer, ShapeSource, CircleLayer }`. **`SymbolLayer` and `Images` are NOT in the adapter type.** When the v383 OTA JS bundle ships and tries `Mapbox.SymbolLayer` and `Mapbox.Images`, they resolve to `undefined`. React will render `<undefined />` which on RN throws `TypeError: Element type is invalid: expected a string or a class/function but got: undefined.` Memory map crashes on mount.

  This is recoverable in JS (just add the two fields to the adapter — they exist on the native side, `@rnmapbox/maps` does export them). BUT — and this is the kill shot — even if the JS adapter is updated, **the underlying `@rnmapbox/maps` native module must have been built with SymbolLayer + Images support**. v382 production binary was built with whatever version of `@rnmapbox/maps` the last `eas build` used. If that version is < ~8.0 (older builds), SymbolLayer JS bridge exists in JS but the native side may have stale registrations.

  Even assuming the native side is fine: **PNG assets imported via `require('./pin-self-cairn.png')` in a NEW file added by OTA — does Hermes/Metro resolve those at OTA load time?** EAS Update only ships the JS bundle + assetmap. Static image assets (PNG) referenced by `require()` are bundled at build time. If `app/assets/mark-pins/v10/pin-*.png` was NEVER in the v382 build's assetmap (the directory literally does not exist today — I just ran `ls`, it returned 6 entries: ar/, fonts/, adaptive-icon.png, favicon.png, icon.png, splash-icon.png — **no mark-pins folder at all**), then OTA cannot ship them. PNG assets must be in the native binary.

- **后果**: User pulls v383 OTA. App boots. Memory map mounts → crash (undefined component). Or: app boots, Memory map mounts, SymbolLayer renders, but every sprite is missing because `require('./pin-self-cairn.png')` resolves to `null` (Metro asset registry has no v383-prefixed entries) → user sees a Memory map with zero pins. Worse than v382. **And it requires `eas build` to fix — which user has永禁.**

- **plan 为什么没防住**:
  - Plan §C3 says "Commit PNGs to git (~285KB total)" — but committing PNGs to git is necessary, not sufficient. The PNGs must be in the **app binary's asset registry at native build time**. Plan never says "this requires an eas build to ship sprites the first time, then OTA can update them via new filenames thereafter."
  - Plan §0 fact-checked backend endpoints but did NOT fact-check `mapboxAdapter.ts` to confirm `SymbolLayer` + `Images` are exported.
  - Review #2 §6 (sprite bake) flagged sprite generation, `onImageMissing` wiring, individual PNGs vs atlas — but never asked the fundamental question: "do new PNG assets ship via OTA at all?" The answer is NO for first-time addition.
  - User's memory note `feedback_no_push_no_build.md` says "eas build 永远禁" — but the plan implicitly requires one.

- **修补建议** (one of):
  1. **Generate sprites at runtime, not bundle-time**: drive Skia or react-native-svg to render the 19 v10 designs into in-memory PNG byte buffers at app launch (in a side-effect), call `Mapbox.Images.addImage(name, base64DataUri)` programmatically. This ships via OTA because all code is JS. Performance hit: ~100-200ms cold-start cost (per Review #2 §9.6 estimate). **This is the correct OTA-compatible path.**
  2. **Use `iconImage` with base64 data URI directly** at the SymbolLayer style level. rnmapbox 10.x `<Images>` accepts `{ 'pin-self-cairn': { uri: 'data:image/png;base64,...' } }` — Skia renders this at runtime, no asset registry needed.
  3. **Acknowledge that v383 cannot ship sprites via OTA and defer Section C entirely**. Section B (PointAnnotation fix) + Section A (mock) ship via OTA. Section C waits for v384 + an eas build.

  Plan-final must pick one. Currently it picks (impossible).

  **Cross-reference for fix #1/#2**: also resolves Review #2 §6 (a)-(e) ambiguity around bake trigger / git treatment / cross-platform rasterization in one shot. Bake at runtime once, byte-identical across iOS/Android because Skia is the same engine on both. No Chromium version pinning needed.

---

## ATTACK 2 — Mock data ts removal breaks production client `snapTrack.ts` on the existing v382 install **before** the v383 OTA reaches every user.

- **触发条件**: Plan §A2 removes `ts` field from `route_points` to "align mock with 9163's no-ts shape". Mock script runs against `https://api.yiiling.cn` production. Once mock data is written, ANY v382 client that opens one of accounts 1-3, 5-9's hike replays the session via `app/src/services/sessionReplay*` or via `snapTrack.ts`. **The user installs of v382 in the wild — including the user's own phone, factory test devices, and any beta tester — have NOT received the v383 OTA yet.**

  Plan §F risk row "9163 has no ts but client-side replay assumes ts" rates this Med/Med and says "Audit `app/src/services/sessionReplay*` (out of scope here) — if it crashes on no-ts, client patch is independent track." This is **wrong sequencing** — the mock is written to production DB FIRST, which means v382 (still in the field) loads ts-less data, BEFORE v383 ships a no-ts-tolerant client. If v382's replay code does `session.route_points[0].ts` and crashes on `undefined`, every v382 client that hits these accounts crashes — and the user can't force the OTA upgrade timing precisely. There's a window of broken client state.

  v382 mock previously DID write ts. The plan's premise — "9163 has no ts so it's fine to drop" — is only true if no v382 client code reads ts from sessions. That's not audited.

- **后果**: User opens app on a phone still on v382 build, picks account 1 (Alice), opens session replay, crash on `Cannot read property 'ts' of undefined`. Or speed calculations divide by zero/NaN if ts arithmetic is done downstream. The user's "real hike" mock has now made the production app strictly worse than before.

- **plan 为什么没防住**:
  - Plan §F explicitly defers the client audit ("out of scope here"). This is exactly the kind of "we'll come back to it" that gets bitten in production.
  - Plan §0 fact-checked the backend (`POST /api/sessions` accepts ts-less arrays) but not the client (does `sessionReplay.ts` tolerate ts-less arrays?).
  - Plan never names the v382-still-in-field-during-rollout window as a risk.

- **修补建议**:
  1. **Before mock runs**, audit `app/src/services/sessionReplay.ts` + every `route_points[*].ts` reference in `app/src/`. If any code reads `.ts` without `?? 0` or `?? Date.now()`, fix that **on v382 first** via a hotfix OTA, get it out to users, wait for adoption to settle (~3 days for OTA reach), THEN run mock.
  2. **OR** keep writing synthetic `ts` to mock data (linear interp is fine, real-world replay doesn't care if ts has 6s spacing vs 20s, both work). The plan's "remove ts to match 9163" is aesthetic purity that buys nothing. 9163 has no ts because it's a back-session predating the current schema — that's not "the right shape", it's a quirk.
  3. **OR** add a synthetic `ts` only at write-time in the mock so DB is consistent. Plan-final A2 over-corrects.

---

## ATTACK 3 — Plan §A0 preflight uses `authLimiter` probe via "test-login with throwaway invalid creds" to read `RateLimit-Limit` header. This probe **counts against the rate limit it's trying to measure**. If limit is already exhausted, the probe fails the same way real logins fail, and the script aborts without ever knowing why. Self-deadlock.

- **触发条件**: Plan §A0.2: "log current `windowMs, max` of `/api/auth/login` (probe via test-login with throwaway invalid creds; observe `RateLimit-Limit` header). If `< 100`, abort with instruction". If the operator runs the script after the limiter has already been consumed (e.g. backend container just got restarted resetting authLimiter to its default of ~5/15min, then the operator's IP made a few attempts during debugging) — the **preflight probe is itself the request that 429s**. `RateLimit-Limit` header is still returned on a 429, but the script has no path for "probe got 429 → cannot tell if it's because limit is 5 (real config) or because we already used our 5 (transient)". 

  Worse, the script then continues to login 8 real accounts × N retries — each one adding to the count. Even if the script gets `RateLimit-Limit: 5000` (matching the bumped-for-mock value), the 8 logins consume 8 slots, but the probe consumed the 9th slot's worth of telemetry. Edge cases get expensive.

  Second sub-attack: which **endpoint** does the probe hit? `/api/auth/login` is the authLimiter-protected one. Plan §A0.2 says "probe via test-login with throwaway invalid creds." Invalid creds on `/api/auth/login` will return 401, not 429 — but the 401 ALSO counts against the limiter (express-rate-limit default `skipFailedRequests: false`). So the probe both consumes a slot AND doesn't return the headers reliably (some rate-limit middleware variants only set headers on success).

- **后果**: Operator runs `python mock_via_real_api.py --dry-run`. Preflight probe hits limiter. Script aborts with confusing "limit < 100" message. Operator bumps the backend authLimiter. Re-runs. Still aborts because the backend container restart didn't actually happen / the new limit isn't applied / the operator hit `/api/auth/login` 100 times yesterday and is still in the window. 30 minutes of "why does my own preflight check say no" debugging.

- **plan 为什么没防住**:
  - Plan §A0.2 says "see `feedback_mock_data_quality_rules.md`" for the bump procedure but doesn't include the procedure inline. If that file isn't fully synced or the operator doesn't read it, the bump may not happen.
  - The probe-counts-against-limit problem is the same class of bug as v335 (delete before dry-run) — using the thing you're trying to measure as the measurement instrument.

- **修补建议**:
  1. Don't probe via `/api/auth/login`. Probe via an **unauthenticated** endpoint that the backend can expose for this purpose, e.g. `GET /api/admin/rate-limit-status` (returns `{ login_remaining: N, login_window_ms: M }` to authenticated admin or service-token requests).
  2. Or: skip the probe entirely. Run the script. If first login 429s, the script's existing error path should print "authLimiter is too tight — bump it per [procedure]." Don't try to predict — react to actual failure.
  3. Or: use a **service token** that bypasses authLimiter (express-rate-limit `skip` predicate on `req.headers['x-service-token']`). Same idea as Review #1 §5.1's admin endpoint.

---

## ATTACK 4 — `shapely` + Overpass for building-intersection check (§A7) silently fails on Windows network policies / Great Firewall, and the script has no fallback. The "geometric gate" is theater on Windows main agent.

- **触发条件**: Plan §A7 says "Query Overpass API for `building` polygons in bbox of mock polylines (one-time)" then "compute polyline ∩ buildings via `shapely.intersects`". 
  - Overpass API public endpoints: `overpass-api.de`, `overpass.kumi.systems`, `lz4.overpass-api.de`. All are .de/.systems domains served from European data centers.
  - From a Chinese network (the operator's machine, since they're testing 静安区 routes), Overpass endpoints have **highly variable latency** and intermittent timeouts. The Great Firewall doesn't block them but bandwidth shaping makes 30s+ requests common.
  - `shapely` on Windows pip-installs fine in 2025 but `GEOS` shared library binding has had issues with Python 3.12+ on Windows historically (`shapely.errors.GEOSException` on import). Plan doesn't specify Python version or platform; assumes both work without verification.

  Most likely failure mode: Overpass query times out OR returns 429 OR returns empty result (operator's bbox not yet indexed). The plan says "Mock script aborts if any uid has crossings > 0" — what does it do when crossings are **unknown** (Overpass returned nothing)? Plan doesn't specify. Default behavior of `requests.get(timeout=30).json()['elements']` with empty `elements` is `len(buildings) == 0` → all polylines have 0 intersections → **all uids pass the gate even when they all cross 50 buildings**. Silent pass.

- **后果**: Operator runs script with `--dry-run`. Overpass times out. `crossings.json` written with `[]` for every uid. 4-eye review: "looks good, zero crossings, ship it." 8 polylines actually cut through residential towers. Same `穿楼` bug as v382, but now with a "verified by shapely" rubber stamp making everyone more confident the gate worked.

- **plan 为什么没防住**:
  - Plan §A7 lists shapely + Overpass as if they're commodity infrastructure. They're not — they're external services with their own failure modes.
  - Plan §F risk register row "shapely/Overpass setup adds Python deps" rates L=Low — but this isn't about install difficulty, it's about runtime availability.
  - Plan doesn't define what "crossings = unknown" means or how to distinguish from "crossings = 0".

- **修补建议**:
  1. Add explicit Overpass health check before per-uid query: `overpass_test_bbox = bbox_of(WALKING_LOOPS[19])`, request building polygons in that small bbox, **assert non-empty result** (static Shanghai 静安 area has dozens of buildings — empty is impossible). If assertion fails: HARD STOP with "Overpass unreachable or returned empty; cannot verify route quality. Run a `shapely` regression test using `tests/fixtures/static_buildings_jingan.geojson` (committed to repo) instead."
  2. **Better**: commit a static GeoJSON of all buildings in the bbox enclosing the 8 walking loops to `tasks/jira/sprintN-evidence/v383-buildings.geojson`. Mock script loads this file, never calls Overpass at runtime. Reproducible, network-independent, can be version-controlled and reviewed. The "buildings might change over a month" risk is minimal for a 2-week mock validation window — 静安区 buildings are stable.
  3. Add explicit pre-check: `if not buildings_polygon_count_over_threshold: raise SystemExit("building data not loaded")`.

---

## ATTACK 5 — Plan §B0 root-cause experiment runs on iOS simulator (Expo dev client) per plan §E "Integration on iOS dev client" — but the user's REPORTED bug is on a real device, post-OTA, running the production binary. Simulator + dev client uses a completely different `@rnmapbox/maps` build path than production. Experiment results don't transfer.

- **触发条件**: Plan §B0 step 1: "Add temporary diagnostic build to `CairnPinsLayer.tsx`... Render a single test marker at known location, screenshot iOS native at 3x." Main agent is on Windows, **can't run iOS simulator** (xcrun simctl is macOS-only). User has to run B0. Plan §E item 7 says "Integration on iOS dev client + Android dev client (Expo dev client, NOT eas build)."

  Issues:
  1. **Expo dev client !== production binary**: dev client uses Hermes JS in debug mode, has different React DevTools instrumentation, may use different `@rnmapbox/maps` linking (yarn link / pod cache states vary). A bug that reproduces in production may not reproduce in dev client.
  2. **Simulator graphics stack !== device GPU**: iOS Simulator renders through macOS's Metal-on-software fallback for Mapbox tiles. PointAnnotation clipping behavior on simulator has historically differed from device (rnmapbox issue #2381 about hover-only-on-simulator). So B0 might show "no clipping in sim" → conclude "shadow bleed" → ship a fix that doesn't address device clipping.
  3. **User runs B0 themselves**: plan §E says user is doing this. But user's testing time is scarce (memory note: "用户人肉测试时间稀缺"). B0 is a 30-min experiment. If results are ambiguous (some on/some off), it might need 2-3 iterations of user real-device runs.
  4. **B0 doesn't define "if results are ambiguous"**: decision tree only handles 3 clean outcomes (all match expected → shadow; size=0 → layout; native screenshot missing → clipping). What about "measured sizes match expected AND native screenshot shows core present AND user STILL says they can't see it"? Could be perception (border too thin to register on 5'8" phone at arm's length under bright sun). No path for this.

- **后果**: B0 runs on simulator, says "shadow bleed". Plan §B1 picks shadow-reduction branch. Ships OTA. Real device: core still missing. v384 cycle restarts.

- **plan 为什么没防住**:
  - Plan §E item 7 commits to Expo dev client only (no eas build). This means B0 inherits the same constraint — there's no path to test on production binary.
  - Plan §B0 conflates "iOS native at 3x" with "production binary" — they're not the same.
  - Plan §D3 gate 3 says "Expo dev client screenshots (not eas build) at 3 viewports" — same conflation.

- **修补建议**:
  1. Plan §B0 must explicitly state: **the experiment is on Expo dev client + iOS simulator (main agent's only option since user can't always be running B0)**. Findings establish a **hypothesis**, not a conclusion. Before plan §B code lands, the hypothesis must be validated against **user's real device on the same v382 production binary** by deploying a temporary debug-log-injecting OTA. If the v382 production cannot be debug-logged (it can — `appLog` events are already wired and reach the server) THEN look at the actual values that arrive.
  2. **Lower-cost path**: ship a v383-experimental OTA that ONLY adds `onLayout` logs to `CairnPinsLayer.tsx` (no behavior changes). User runs prod binary, real device, normal usage. Logs flow to backend. Main agent reads logs the next day. Decision tree runs from real data. ZERO simulator dependency, zero user testing time burned (uses normal usage), and `feedback_review_loop_dynamic.md` is satisfied (runtime check against aliyun logs).
  3. Add "if ambiguous" branch: ship debug OTA with toggleable layout variations, A/B by user setting, user tries each, files which one works.

---

## ATTACK 6 — Plan §D3 gate "v382 baseline diff" (gate #5) requires running the v383 D3 gates against the **v382 bundle** for regression measurement. But v382 has SymbolLayer code? No, v382 has PointAnnotation. Running "Zoom scaling" gate against v382 will fail (because v382 has no zoom scaling). Plan says "v383 must pass v382-fails AND not regress on v382-passes" — circular: every v383 fix is "passing a v382 fail", so the gate is meaningless.

- **触发条件**: Plan §D3 gate #5: "Run same gates on v382 bundle, document fail set. v383 must pass v382-fails AND not regress on v382-passes."

  - Gate 4 ("Zoom scaling") on v382: v382 has no SymbolLayer, just PointAnnotation. iconSize doesn't apply. Will trivially fail — but this is by design, not a regression target. v383's "passing this gate" is the whole point.
  - Gate 2 ("v10 sprite fidelity") on v382: v382 has no sprites at all. Will trivially fail (no PNG to compare against).
  - Gate 6 ("Memory wipe verification") on v382: same — v382 mock didn't wipe memory; gate fails by definition.

  So gates 2, 4, 6 are by-construction-fail on v382, by-construction-pass on v383. **Gate #5 reduces to "gates 1 + 3 must not regress"** — which is fine but only 2 actual regression-eligible gates. Plan presents this as a 6-axis comparison but only 2 axes are valid.

  Sub-attack: "v382 must pass any gate v383 passes" — but v382 was the broken state. The premise is wrong direction. Regression means "what v382 did right that v383 might break." Plan wording inverts this.

- **后果**: Operator runs gate #5. Documents that v382 fails 4/6 gates. v383 passes 6/6. "100% improvement!" — but in reality only 2 of those 6 are meaningful comparisons. Decision to ship is made on inflated confidence.

- **plan 为什么没防住**:
  - Plan inherited gate #5 from Review #2 §9.10 ("No v382 baseline measurement"). But Review #2 was asking for a different thing: measure v382 against the SAME gates as v383 to establish baseline. Plan-final translated this into "v382 must pass v382-passes AND v383 must pass those + new gates" — wording got tangled.

- **修补建议**:
  1. Restate gate #5 as: "For each gate, classify as (a) **new gate** (v382 not applicable), (b) **regression gate** (v382 has functionality this gate checks). Only (b) gates count for regression. v383 must not regress on (b)." 
  2. Identify which gates are (b): probably gate 1 (mock route reality — v382 has mock data, v383 has mock data; can compare quality), gate 3 (iOS native pin render — v382 has pins, v383 has pins; compare crest+core visibility), and a subset of gate 6 (memory wipe — v382 mock didn't wipe, but other memory tests could compare). Gates 2, 4 are new gates only.
  3. Add a separate "no-regression check" subsection that explicitly lists each (b) gate and the v382 pass criteria.

---

## ATTACK 7 — Plan never explicitly addresses user's "mock 我们不需要 routes" instruction. Plan §A talks about sessions, memory, markers. `routes` table (separate from session.route_points) — what's there for ALLOWED_UIDS today, and does mock script touch it?

- **触发条件**: User original instruction includes "mock 我们不需要 routes". Plan §A0/A1/A2/A3 mention sessions (which contain route_points as a column), memory_points, markers. No mention of a `routes` table.

  Two interpretations:
  1. **User means session.route_points are not needed**: contradicted by plan §A1's whole strategy of generating snapped polylines for `route_points`. Wrong reading.
  2. **User means a separate `routes` table is not needed** (which would be the v376-era "planned route" / "trail" feature): plan acknowledges this implicitly by not seeding any. But existing routes for ALLOWED_UIDS in production DB — does mock wipe them? Plan §A3 wipe step only deletes sessions + markers + memory_points. Old `routes` table entries for uids 19, 20, 21, 23, 24, 25, 26, 27 from prior mock runs (if such mocks ever wrote to routes) **stay in DB**.

  Sub-attack: if `routes` table has stale entries from v378/v381 mock runs, and v383 ships with no routes-table wipe, the user opens app on account 1, sees the v381 mock's "planned route" overlay on top of the v383 new walking session. Visual confusion: two overlapping trails per user, one from old data.

- **后果**: User picks account 1 on v383 OTA. Sees Alice's new daily loop. Also sees a phantom v381 planned-route trail. "为什么有两条线?" 

- **plan 为什么没防住**:
  - Plan §0 fact-checked sessions, memory, markers. Did NOT query DB for `routes` table state.
  - Plan §A3 wipe is incomplete.
  - User's instruction "mock 我们不需要 routes" was never explicitly disambiguated.

- **修补建议**:
  1. Plan §A0.6: query Aliyun DB before mock runs — `SELECT user_id, COUNT(*) FROM routes WHERE user_id IN (19,20,21,23,24,25,26,27) GROUP BY user_id`. Report count to user. If count > 0, ask user: "Should mock wipe these too? Or are they real planned routes you want kept?"
  2. If wipe needed: add `DELETE /api/routes` (if endpoint exists) or `DELETE FROM routes WHERE user_id = ?` SQL (if no endpoint) to wipe step.
  3. **Or** — confirm with user that "mock 我们不需要 routes" means "don't create routes, leave existing alone." Then plan §A3 is fine but should explicitly note "routes table untouched per user instruction."

---

## ATTACK 8 — Plan §D1 "sub#3 defend / sub#4 attack" adversarial review's tie-break rule is missing. What if sub#3 (defend) and sub#4 (attack) both come back legitimate but contradictory?

- **触发条件**: Plan §D1: "sub#3 prompt: 'Defend this plan — find the 3 strongest reasons it's correct.' sub#4 prompt: 'Attack this plan — find the 3 most likely failure modes that this plan does NOT address.' sub#3 + sub#4 outputs synthesized. Any new Blocker → revise plan. Iterate."

  - Sub#3 outputs: "Plan is correct because A, B, C are well-justified."
  - Sub#4 outputs: "Plan has gaps X, Y, Z that are Blocker-class."
  - Plan-final says: "Any new Blocker → revise plan." But who decides if sub#4's X, Y, Z are real Blockers vs sub#4 fabricating to fulfill "find 3 problems"?
  - The forcing function ("find AT LEAST 3 problems") is well-known to produce false positives — subagent will manufacture issues to meet the count. Without an evaluation step, every D1 round produces 3 "Blockers" that may or may not be real.

  Sub-attack: Plan §D1 says "Iterate." How many iterations? When does it converge? If every adversarial round produces 3 new "Blockers" and we revise the plan to address them, we're playing whack-a-mole forever. Memory note `feedback_review_loop_premise_check.md` explicitly warns against review-loop anchoring — same risk here.

- **后果**: Plan-final review (this round) produces N new findings. Plan-final2 written. New sub#3 + sub#4 produce M new findings, some of which are sub#4 inventing problems to meet quota. Plan-final3 written. Repeat. Sprint stalls indefinitely.

- **plan 为什么没防住**:
  - Plan §D1 leaves termination criteria undefined.
  - Plan §D1 doesn't have an arbitration step (e.g., main agent + user judges each sub#4 finding before promoting to "Blocker").

- **修补建议**:
  1. Plan §D1 termination: "Maximum 2 adversarial rounds. After round 2, remaining sub#4 findings are demoted to backlog risks, not Blockers."
  2. Arbitration: "Each sub#4 finding requires main agent to confirm reproducibility against current files. Findings that don't reference a specific file/line are dropped."
  3. **OR** explicitly state: "sub#4 must cite a specific plan §X line and a contradicting fact from a code file. Pure abstract concerns (e.g. 'might fail in production') without code citation are dropped."

---

## Summary attack matrix

| # | Attack | Severity | Plan §ref | Net effect |
|---|--------|----------|-----------|------------|
| 1 | OTA cannot ship new PNG assets; mapboxAdapter missing SymbolLayer/Images | **Blocker** | C1, C3, E | v383 OTA crashes Memory map OR ships invisible pins |
| 2 | ts removal breaks v382 clients in field during rollout window | **High** | A2, F | Crashes on v382 phones replaying mock session |
| 3 | authLimiter preflight probe consumes the limit it's measuring | High | A0.2 | Operator deadlock, 30min debug |
| 4 | shapely + Overpass silently passes when Overpass times out | High | A7 | Building-intersection gate is theater |
| 5 | B0 experiment on simulator/dev client doesn't represent production binary | High | B0, E, D3 | Wrong root cause locked in, fix doesn't apply on device |
| 6 | D3 gate #5 v382 baseline diff is by-construction circular for 4/6 gates | Med | D3 | Inflated confidence at ship |
| 7 | `routes` table state never queried/wiped, user instruction ambiguous | Med | A3, A0 | Visual confusion (phantom v381 trails) post-OTA |
| 8 | D1 adversarial review has no termination / arbitration | Med | D1, E | Sprint stalls in review loop |

**Blocker count: 1 (Attack 1).**
**High count: 4 (Attacks 2, 3, 4, 5).**
**Medium count: 3 (Attacks 6, 7, 8).**

---

## Verdict

**NEEDS_REWRITE**

Attack 1 alone is fatal: the entire Section C strategy (SymbolLayer + sprite atlas) is currently incompatible with OTA-only delivery, and `mapboxAdapter.ts` has not been audited for the required exports. Either:
- Section C must be reworked to ship sprites at runtime (Skia / base64 / addImage programmatic) — significant rewrite of C2, C3, C5
- OR Section C must be deferred to v384 (requires `eas build` to ship sprites) and v383 ships only Sections A + B

The user's "永远不 eas build" constraint plus "pins must be visible + zoom scale" requirements are in tension. Plan-final pretends this tension doesn't exist. It must be resolved before any code lands.

Attacks 2 + 5 are independent High risks that each could ship a worse-than-v382 experience.

Before promoting to APPROVED:
1. **Resolve Attack 1**: pick OTA-compatible sprite delivery (recommend Skia-rendered runtime sprites) OR defer Section C.
2. **Resolve Attack 2**: audit `sessionReplay.ts` for ts dependency; either pre-hotfix v382 or keep synthetic ts in mock.
3. **Resolve Attack 5**: replace simulator-based B0 with log-injecting debug OTA that captures real-device measurements.
4. **Fix Attacks 3, 4 inline**: change probe endpoint, commit static buildings GeoJSON.
5. **Fix Attack 7 inline**: query routes table state, confirm user intent.
6. **Add termination criteria** for Attacks 6, 8 wording.

Once these land, re-review.
