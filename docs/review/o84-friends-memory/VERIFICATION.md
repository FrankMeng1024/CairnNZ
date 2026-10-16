# O84 verification record

All commands ran on macOS / Node `v24.11.1`; backend integration used a fresh
disposable MySQL 8.0.36 Docker container and local API. Evidence artifacts are
packaged in the final ZIP rather than committed to deploy-bearing Git.

## Results

- Final UX closure: **5 suites, 24 tests passed** (natural picker states,
  active-only count badge, action-only Friend Detail and single-tap declined
  dismissal included).
- Final pre-OTA picker correction: **3 suites, 18 tests passed**; the initial
  subscriptions/source-list failure is visible, Retry succeeds without closing
  the picker, and a valid existing selection survives failure and recovery.
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
- Mobile Expo Web visual QA: **26 assertions passed**, no page/runtime console
  errors, 17 current screenshots at 360/390/430 widths across themes. The new
  390x844 failure capture visibly contains `Couldn't load friends` and Retry;
  recovery continues into the existing two-source real-Fog rendering proof.
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

## Production backend verification

- Backend-only `origin/master` integration:
  `f35f2b745d2c9d145a49a902c595d3611673bc35`; eight reviewed backend files
  matched the O84 client candidate byte-for-byte.
- Preflight: ledger 046, 14 request rows (13 accepted / 1 rejected), zero
  opposite-pending conflicts, self requests or orphan requests; backend and DB
  healthy; tracked production checkout clean.
- Verified pre-migration backup: 84,079,811 bytes, gzip-valid, mode 600,
  SHA-256 `33ae6643ff6a2b61acf5ce8dda99da91d756d84716344af55d934110f881ce9f`.
- Canonical deployment completed. Ledger 047 and every verifier postcondition
  passed; all 14 rows remained, every pair key is populated, and there are no
  duplicate active pairs.
- Production checkout and `origin/master` match the backend SHA; container and
  built image both use
  `sha256:08ce4ad4a5fb6464f51e329eddbbc02b044cd3fa52180985252305a76b208b18`.
  Local/external health passed; authenticated read-only Requests, Outbound,
  Grants, Sources and empty Projection calls returned 200; recent error-log
  count was zero.
- A mutable two-account production journey was deliberately not substituted
  with Public pilot smoke identities. Dedicated Owner test credentials remain
  required before OTA publication/device acceptance.
