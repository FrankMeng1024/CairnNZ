# Stage 6 Code Review — editDiagSender + telemetry wire
**Verdict**: PASS

## Spec compliance
- Queue cap 50: PASS (`MAX_QUEUE_SIZE = 50`, `queue.shift()` drops oldest at L112-114).
- Batch cap 10 per flush: PASS (`MAX_BATCH_SIZE = 10`, `queue.splice(0, MAX_BATCH_SIZE)` L133).
- Debounce 5s: PASS (`FLUSH_DEBOUNCE_MS = 5_000`, single-shot guard via `flushTimer !== null` L90).
- Key-event immediate flush: PASS (`KEY_EVENTS = ['brush_save_committed','brush_mapbox_error']`, cancels debounce + voids flush L117-119).
- AppState `background`/`inactive` immediate flush: PASS (L71-79); also covers iOS `inactive` — defensible superset.
- 429 → batch back to head: PASS (`queue.unshift(...batch)` L148).
- Non-429 failure → drop batch: PASS (no else-branch retry; falls through L150 comment).
- Network throw → silent drop: PASS (try-catch around fetch L151).
- POST `${API_BASE_URL}/api/edit-diag`: PASS (L25, L135). 3s AbortController timeout is a sensible addition not in spec but harmless.

## Anti-cheating
- Hardcode: none. All magic numbers exported as named constants (`MAX_QUEUE_SIZE`, `MAX_BATCH_SIZE`, `FLUSH_DEBOUNCE_MS`, `FLUSH_REQUEST_TIMEOUT_MS`, `EDIT_DIAG_PATH`).
- TODO/FIXME: none.
- Silent fail: narrow + intentional + commented (L150-152, L173 "ignore"). Telemetry is best-effort by design — correct.
- `@ts-ignore`/`any`: only `(global as any).fetch` in tests (jest mock convention) — acceptable. Source has zero `any`/`@ts-ignore`.
- 8 events: 7 wired + `brush_alt_dem_null` declared in `TelemetryKind` but intentionally unwired (Stage 8 / Terrain). Not a miss.
- `metric_value: number | null` + `threshold: number | null`: confirmed in all 5 `brush_gate_failure` sites; explicit `null` passed at L1571 for the rejected_too_long branch (R2v4 fix honored).

## Wire correctness
- `brush_preview_started`: L1512, fires once at runPreview entry — OK.
- `brush_gate_failure`: 5 sites covering G0, rejected_too_long (synthetic), G0_post_simplify, G0.5, G3 — all `continue` paths emit before continuing. Covers every gate failure branch.
- `brush_mapbox_attempt`: L1606, fires BEFORE `matchSegment` (L1611) — denominator accuracy preserved.
- `brush_mapbox_error`: 2 sites (catch L1618 + `!r.ok` L1631), both include `ms_to_error` from `mapboxT0`. Covers throw + structured-fail.
- `brush_preview_completed`: 2 sites (0-accepted L1709, success L1759) — both terminal paths emit. Early `state-changed` returns intentionally do not emit (preview was aborted, not completed).
- `brush_undo`: L1443 with `undo_stack_depth`.
- `brush_save_committed`: L1867 with `distance_m` + `has_alt`.

## Test rigor
Paths covered (11 tests):
- enqueue without immediate fetch (debounce defer)
- key event `brush_save_committed` immediate flush
- key event `brush_mapbox_error` immediate flush
- queue overflow drops oldest
- POST body shape (events array, kind/payload/timestamp_ms)
- 429 rebuffer at head
- non-429 (500) drops batch
- network throw silent drop
- empty-queue no-op
- concurrent flush inflight guard
- batch cap (25 enqueued → ≤10 sent, remainder queued)

Not directly tested (acceptable): AppState `background` listener (`AppState.addEventListener` would need jest mock; ensureAppStateListener gracefully no-ops in jsdom L68-70). Debounce timer fires (would need `jest.useFakeTimers`) — covered indirectly by "non-key event enqueues without immediate fetch".

192/192 prior tests passing as reported — no regression surface touched by this change.

## Recommendation
PASS — ship Stage 6. Optional follow-ups (non-blocking): add a fake-timer test for the 5s debounce path; mock AppState to assert background flush. Neither blocks Stage 7.
