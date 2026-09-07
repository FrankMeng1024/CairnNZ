# Activity P0 operational state contract

## Scope and authority

`useTrackingStore` remains the recording, GPS, persistence, background-task, and save authority. `deriveActivityOperationalState` is a pure presentation adapter; it is not another store and does not own activity data.

Hiking and Running remain separate production screens. They consume the same operational interpretation and may retain mode-specific composition. Activity and Route remain separate domain concepts:

`free Hike / Run -> Activity -> optional Route -> future Hike / Run -> new Activity`

This P0 pass does not activate route following or change that lifecycle.

## Exclusive operational states

| State | Authoritative input | Required presentation invariant |
|---|---|---|
| Ready | tracking `idle`, no recovery/error/summary | Start is available; active and paused trays are impossible. |
| Starting | tracking `requesting` | Start is locked immediately; initialization feedback is visible; a second start is rejected at the store boundary. |
| Tracking | tracking `tracking` | Live metrics and active controls are available; Start is impossible. |
| Paused | tracking `paused` | Resume/Finish are available; Start is impossible; recorded data remains preserved. |
| Finishing | `isFinishing` | Finish/save owns one exclusive pipeline; another Finish and Start are impossible. |
| Recovery | an unfinished mode-matched local recording exists while tracking is idle | Normal Start is blocked by the recovery surface until the user resumes or discards. |
| Stopped | a completed summary exists after tracking returns idle | Completion is presented once by the host screen. |
| Error | tracking idle with `startError` | No session is presented as active; Start remains retryable after the failure is explained. |

Precedence is: Finishing -> Starting -> Tracking -> Paused -> Recovery -> Stopped -> Error -> Ready. This prevents local screen state from overriding a live or persisted tracking session.

## Store-boundary lifecycle rules

- `startTracking()` synchronously changes `idle` to `requesting`. Any caller arriving after that transition receives `false` and cannot create another writer, remote session, timer family, or GPS subscription.
- Tracking is not entered until an actual foreground or background location source is active.
- Failed initialization cleans up subscriptions, timers, monitors, writer context, and any late remote-session shell, then returns to an error/retry state.
- `stopTracking()` synchronously sets `isFinishing`. A concurrent caller receives `false` and cannot save, flush Memory, or open completion twice.
- The too-short path releases the finish lock and preserves the live recording, matching the existing product behavior.
- Pause and resume accept only their valid source status and reject calls while finishing.
- A process-death recovery restores mode, points, timestamps, metrics, and writer identity as Paused, then establishes a real location source before entering Tracking.
- Cold recovery rebuilds app-state source switching, background draining, incremental backup, monitors, auto-pause, and token refresh. A failed source restart leaves the recording preserved as Paused.

## Background and foreground reconciliation

The tracking store is authoritative after focus, foreground, unlock, or hydration. Screen-local phase values cannot force Ready over Tracking/Paused. The active location source follows `AppState`: foreground watcher while active, background task while inactive/background when permission permits.

Physical-device validation is still required for CoreLocation continuity, iOS screen lock, background execution, and process-death restoration. Expo Web proves only the derived UI invariants and mode-isolated recovery routing.

## Map readiness contract

Both activity screens distinguish:

- loading: map exists but has not reported ready;
- ready: Mapbox reported successful load;
- unavailable: map module/load failed or is unavailable on the runtime;
- location unavailable: recording location dependency failed or permission was denied;
- offline/degraded: existing network/location state may continue a local recording, but this P0 pass does not redesign the visual treatment.

Running now exposes loading/unavailable feedback instead of silently presenting an ambiguous blank map. Visual convergence remains later work.

## Open global product questions

- Hiking Plant behavior: `GLOBAL PRODUCT AUDIT REQUIRED`.
- Running Cairn behavior: `GLOBAL PRODUCT AUDIT REQUIRED`.
- Activity-to-Route creation, selected Routes, and route-following UX: `GLOBAL PRODUCT AUDIT REQUIRED`.
- Activity History, Trails, Cairns, Memory, and Settings consequences: `GLOBAL PRODUCT AUDIT REQUIRED`.

Current production behavior is preserved for each of these areas. No P0 architecture depends on “Hiking = Full Plant” or “Running = Quick Cairn.”
