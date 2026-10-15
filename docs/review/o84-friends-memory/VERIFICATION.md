# O84 verification record

All commands ran on macOS / Node `v24.11.1`; backend integration used a fresh
disposable MySQL 8.0.36 Docker container and local API. Evidence artifacts are
packaged in the final ZIP rather than committed to deploy-bearing Git.

## Results

- Friends/Memory/O84 marker: **8 suites, 42 tests passed**.
- Friend content/account-local authorization: **4 suites, 56 tests passed**.
- O83 Route: **14 suites, 191 tests passed** (Draw, Point continuity,
  multi-stroke/replay, repeated geometry, editing, save/reopen, provider/retry,
  offline store and camera/display contracts).
- Cairn/Activity/Memory cross-feature: **15 suites, 150 tests passed**. Jest
  emitted an open-handle warning after success; exit code remained zero.
- Backend authorization/projection: **16 Node tests passed** plus syntax checks.
- Isolated multi-account API/database harness: **PASS**; migration 047 forward,
  rollback and forward reapply all passed.
- Mobile Expo Web visual QA: **19 assertions passed**, no page/runtime console
  errors, 15 current screenshots at 360/390/430 widths across themes.
- `git diff --check`: passed.
- Full `tsc --noEmit`: exit 2 with **159 existing repository errors** (missing
  Playwright declarations, Activity-test typing, generated preview icon keys,
  Turf export typing, etc.); filter over every O84 changed file: **0 errors**.

## Authorization-to-render measurements

- New exploration delay: 1,800 seconds.
- Authorized owner A cells: before delay 0, after delay 5.
- Authorized owner C cells: before delay 0, after delay 5.
- Distinct projection SHA-256 values are recorded in `backend/result.json`.
- Unauthorized third account received zero projections; revocation listed both
  source IDs; revoking one source retained the other five cells; deselection
  returned zero selected projections.
- Production geometry boundary: 10 authorized cells → 90 friend-source
  polygons; viewer Mine evidence: 7 points; Fog source: one complement shape.
- Actual WebGL layer at the two offscreen regions: Wellington
  `renderedFeatures=4`, Queenstown `renderedFeatures=1`; source queries returned
  four features in each camera view. Selection camera delta was zero.

## Memory performance

- 2,041 distinct accepted points: cold geometry 9,913.2 ms; maximum cooperative
  slice 48 ms.
- One-point incremental update: 230.0 ms; 9 tiles / 9 groups rebuilt; Fog
  compose 4.1 ms; action acknowledgement 8.9 ms.
- Combined 2,001 Mine points + 2,000 friend cells: 15,345.2 ms; maximum slice
  63 ms; rejected friend cells 0.
- 10,000-point diagnostic: 47,869.2 ms; maximum slice 61 ms; event-loop delay
  max 69.0 ms; retained sample loss 0.
- 240-point live sequence: reconciliation batches 177–362 ms; final one-point
  update 48 ms / display estimate 168 ms; maximum synchronous slice 31 ms.

These are synthetic/local geometry measurements, not native iPhone frame
timings, cold production-history timings or proof of OS work after force quit.
