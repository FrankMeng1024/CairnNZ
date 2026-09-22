# Visual and interaction evidence

## Scope

- 16 current-source candidate captures.
- Day, Sunset, and Night.
- `390×844`, `375×667`, and `430×932` browser viewports.
- Four offline-readable boards and `visual/index.html`.
- Before references are attributable pre-card audit captures and are labeled historical current-source captures, not accepted candidate authority.

## Real-handler scenarios

- A: Activity Detail -> Save as Route -> editor -> Save -> canonical Route Detail -> Home -> Trails -> same Route Detail.
- B: Route Detail -> existing editor -> Apply -> Save -> same Route Detail.
- C: Route Detail -> Hike -> matching pre-start page.
- D: Route Detail -> Run -> matching pre-start page.
- E: Route Detail -> editor -> isolated PUT 503 -> retained draft -> retry -> accepted Detail.

The initial synthetic Activity was injected to reach the bounded flow, but the listed transitions use actual application handlers. Forced Route fixtures are separately labeled for local/pending Gap, legacy origin, and viewport stress states.

## Isolation

- Fresh Playwright browser context.
- Synthetic identity and coordinates.
- API reads/writes intercepted by the fixture harness.
- External requests blocked.
- Telemetry disabled.
- No production data read or mutated.

## Evidence boundary

Map services were intentionally blocked. These images prove current Expo Web/React Native DOM composition and the map-unavailable fallback; they do not prove actual Web Mapbox, native RN Mapbox, gestures, haptics, keyboard behavior, native small-screen layout, device loading, real field behavior, or owner acceptance. A scaled/clipped phone shell is not counted as native validation.

Canonical details and per-capture labels are in `visual/capture-results.json`.

