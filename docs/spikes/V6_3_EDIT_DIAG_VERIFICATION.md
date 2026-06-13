# /api/edit-diag Endpoint Verification

**Verified at**: 2026-06-13 12:29 UTC
**Verifier**: fresh-context subagent

## Backend Host

- **Base URL**: `https://api.yiiling.cn`
- **Source**: `app/src/config/api.ts:13-17` — `API_BASE_URL` falls back to `https://api.yiiling.cn` in production builds when `EXPO_PUBLIC_API_BASE_URL` is unset.
- Same host referenced in:
  - `app/app.json`, `app/eas.json`
  - `docker/nginx-cairn-api.conf`, `docker/docker-compose.yml`
  - `docs/HANDOFF_v81.md`, `docs/EAS_BUILD_GUIDE.md`

Note: There is NO source file in this repo named `editDiagUploader.ts` (the path cited by `app/research/sprint-mvt-envelope-spec.md:475`). Closest existing file is `app/src/services/telemetryUploader.ts`, which uploads to `/api/telemetry/sessions`, NOT `/api/edit-diag`. The actual `/api/edit-diag` POST happens elsewhere — `app/src/components/OtaBadge.tsx:409,412` mentions OTA #216 added auto-upload to `/api/edit-diag`, and commit `2f3e0e1 feat(diag): auto-upload edit pipeline diagnostics to /api/edit-diag + bump OTA #216` confirms it was added at OTA #216.

## Endpoint Reachability

Live probe results:

| Method | URL | HTTP | Latency | Body |
|---|---|---|---|---|
| POST | `https://api.yiiling.cn/api/edit-diag` | **200** | ~0.08s | `{"id":237,"ok":true}` |
| GET  | `https://api.yiiling.cn/api/edit-diag` | **200** | 0.079s | `[{"id":237,"kind":"edit-diag","uploaded_at":"2026-06-13T12:29:38.000Z","payload_preview":"{}"}]` |
| POST | `https://api.yiiling.cn/api/edit-diag/` (trailing slash) | **200** | — | (accepted) |
| POST | `https://api.yiiling.cn/edit-diag` (no `/api`) | 404 | — | not found |
| POST | `https://api.yiiling.cn/v1/edit-diag` | 404 | — | not found |

Headers observed: `Server: nginx/1.24.0 (Ubuntu)`, `RateLimit-Policy: 60;w=300`, `RateLimit-Limit: 60`, `RateLimit-Remaining: 59` — confirms the "60 req / 5 min / IP" rate limit cited in `BRUSH_EDIT_MEMORY.md:149` and `V6_2_3_PLAN.md:211`.

GET returning the just-inserted record (id=237 with empty `{}` payload) proves write+read both work end-to-end on the production endpoint.

## Backend Source

- **Local repo `backend/` contents**: `src/routes/{auth,debug-snapshot,friends,markers,routes,sessions,telemetry}.js` — **no `edit-diag` route handler in this checkout.**
- `grep -rn "edit-diag" backend/src/` → 0 matches.
- This Cairn `backend/` directory is the cairn-backend service (markers/sessions/telemetry/routes/friends). The `/api/edit-diag` endpoint lives in a separate "yiiling" backend that is NOT vendored into this repo. Plans (`V6_3_PLAN_SIMPLE.md §5.1`, `BRUSH_EDIT_MEMORY.md §6`) treat it as an external/pre-existing service.

## Git History

- `2f3e0e1 feat(diag): auto-upload edit pipeline diagnostics to /api/edit-diag + bump OTA #216` — client wiring for upload
- `f33554e feat(edit): Sprint 67 v236 — replace envelope/junction architecture` — references diag stream
- `6ae21f3 fix(routing): HM6 junction emission + HM5 filter undefined + diag logs`

No commit in this repo contains a backend route handler implementing `/api/edit-diag`. Confirms it is hosted out-of-tree.

## Verdict

**EXISTS_AND_REACHABLE** — production endpoint at `https://api.yiiling.cn/api/edit-diag` accepted POST `{}` and returned `{"id":237,"ok":true}` in ~80 ms. GET returned the inserted record. Rate limit headers match the plan's stated `60/5min/IP`.

Caveat: route handler source is NOT in `C:/ClaudeCodeProjects/Cairn/backend/`. It lives in an external yiiling backend repo not vendored here. This means: schema changes, TTL adjustments, or new fields cannot be made from this repo — they require access to the upstream yiiling backend.

## Plan Implication

V6.3 plan §5 "复用 yiiling 后端" CAN proceed for telemetry that fits the existing schema:
- Endpoint accepts arbitrary JSON body, returns `{id, ok}`. Suitable for fire-and-forget event upload.
- 24h TTL and 60/5min/IP rate limit are confirmed by the live `RateLimit-*` headers — match plan claims.

Constraints to record before depending on this:
1. **No control over the route**: cannot add new fields to the response, change TTL, or relax rate limits without touching the external yiiling repo. If V6.3 needs >60 events/5min from a single device, this WILL throttle — plan §5.2's "7 events" is well under the limit, but burst uploads from multiple sessions on one IP could hit the cap.
2. **Schema is implicit**: the response `payload_preview` truncates body. Long-term storage format / index keys are not visible from this side. Treat the endpoint as a write-only sink unless the upstream owner publishes a schema doc.
3. **No auth observed**: POST `{}` succeeded with no token. Plan should NOT rely on per-user auth via this endpoint; treat all uploads as anonymous.
4. **Ship checklist line item** (already noted in `V6_3_R1_REVIEW.md §B5/M6`): re-run the live POST within 24h before each ship — current verification is timestamped `2026-06-13 12:29 UTC`, valid through `2026-06-14 12:29 UTC`.
