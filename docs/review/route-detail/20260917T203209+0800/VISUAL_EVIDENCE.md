# Revision-02 visual and interaction evidence

The offline board is `visual/index.html`; the composite board is `visual/images/board-route-revision-02.jpg`.

## Current-source captures

| Evidence | Surface | Theme / viewport | What it proves |
|---|---|---|---|
| `ROUTE-R02-VIS-001` | Route Detail, long name, two metrics | Day / 390×844 | Raw vertex count absent; `Use Route`; current layout |
| `ROUTE-R02-VIS-002` | Same | Sunset / 390×844 | Affected contrast/composition |
| `ROUTE-R02-VIS-003` | Same | Night / 390×844 | Affected contrast/composition |
| `ROUTE-R02-VIS-004` | Hike/Run chooser opened by actual `Use Route` handler | Day / 390×844 | Label matches chooser behavior |
| `ROUTE-R02-VIS-005` | Delete confirmation/cancel path | Day / 390×844 | Deliberate destructive affordance; rendered dialog is not used alone as mutation proof |
| `ROUTE-R02-VIS-006` | Detail stress | Night / 375×667 | Web constraint and long-name behavior only |

The fixture additionally performs actual Delete Cancel and Delete Confirm handlers. Confirm receives an unstructured client-endpoint 404, uses the known numeric Route ID, removes the disposable Route, reloads, and verifies no resurrection while synthetic Activity, Cairn, and Memory sentinels remain. All 13 assertions passed; runtime errors were empty. See `visual/capture-results.json`.

## Isolation and renderer boundary

- Fresh Playwright browser context.
- Synthetic identity, Routes, Activity, Cairn, Memory, and coordinates.
- Every `/api` read/write intercepted; external requests blocked; telemetry disabled.
- Renderer: Expo Web / React Native DOM with native map services unavailable.
- No actual Web Mapbox or native RN Mapbox is claimed.
- No native gesture, haptic, keyboard, physical small-screen, OTA/device-loading, field, or owner-acceptance proof is claimed.

The original revision-01 visual evidence remains preserved. These current-source captures supplement it; they do not silently replace its provenance or expand unproved end-to-end claims.

