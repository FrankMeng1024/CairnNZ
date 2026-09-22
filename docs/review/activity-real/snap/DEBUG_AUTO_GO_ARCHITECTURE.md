# Debug Auto-Go architecture

Status: read-only source archaeology, 2026-09-11.

## Verdict

Auto-Go looks perfectly road-attached because it asks Mapbox Directions for a complete **walking route before motion starts**, stores that route as a bounded waypoint queue, and synthesizes positions directly along each waypoint edge. It does not dynamically map-match unknown joystick/GPS positions.

```text
tester chooses destination
  → Mapbox Directions /mapbox/walking
  → full GeoJSON route geometry
  → bounded ordered waypoint queue
  → 1 Hz simulator clock
  → interpolate exactly toward next known waypoint
  → synthetic sample enters ordinary Activity sink
  → simulator canonical/display route
```

## Exact source trace

1. `ActivitySimulatorPanel.handleMapPress` chooses the current accepted/simulator position as origin and calls `fetchSimulatorWalkingRoute` (`ActivitySimulatorPanel.tsx:329-350`). A separate explicitly selected straight-line mode bypasses Directions (`:320-326`).
2. `fetchSimulatorWalkingRoute` calls `https://api.mapbox.com/directions/v5/mapbox/walking/...` with `alternatives=false`, `geometries=geojson`, `overview=full`, and `steps=false` (`simulatorWalkingRoute.ts:32-78`). It validates and bounds the returned route geometry. This creates no product Route record.
3. The panel puts every returned geometry vertex in `replaceWaypoints` (`ActivitySimulatorPanel.tsx:347-355`).
4. The simulator ticks at 1 Hz (`activitySimulatorEngine.ts:7,74-78`). With Auto-Go active and no joystick magnitude it advances at the configured walking speed (`:296-299`). It aims at the first known waypoint, lands on or geodesically advances toward it, shifts the queue on arrival, and repeats (`:303-323`).
5. The resulting synthetic position is emitted through the simulator Activity sink (`:329-390` and `emitSample` below that block). It is already on the requested Directions geometry.
6. Manual joystick motion is fundamentally different: when Auto-Go is inactive it applies the joystick bearing using `destinationPoint`; no route lookup or Map Matching occurs (`:325-327`).

## Direct answers

- Route requested first: **yes**.
- Full road geometry known before movement: **yes**.
- Synthetic positions generated on that geometry: **yes**.
- Interpolation along known route: **yes**.
- Dynamic map-match of joystick positions: **no**.
- Road adherence predetermined: **yes**.
- Profile: **Mapbox Directions walking**.
- Main reason it looks perfect: **clean synthetic evidence is generated from the road route itself**.

## What transfers to real GPS

Reusable ideas are ordered network geometry, walking-profile candidates, explicit confidence/availability state, bounded queues, and clean transitions when a candidate is acquired or lost.

What does not transfer is the central assumption. Auto-Go knows the destination and chosen route; real Hike/Run receives uncertain observations and must infer whether the user is on any mapped path at all. Treating the Directions route as truth for real GPS would fail crossings, internal paths, grass, switchbacks, and spontaneous changes of mind.

## Navigation SDK check

The app has `@rnmapbox/maps` 10.3.1 only. No Mapbox Navigation SDK dependency or provider ownership exists. Mapbox Navigation free-drive is a driving-oriented design reference, not a drop-in walking solution. Adding it would be a native dependency/build and provider-ownership change.

## Recommendation

Do not reuse Auto-Go as the live tracker. Keep it as deterministic Debug evidence generation. For real tracking, canonical GPS remains authoritative; any future road assistance should begin as optional presentation-only evidence and disengage before crossings/off-network transitions.

## Sources

- Current Cairn source: `app/src/features/activitySimulator/simulatorWalkingRoute.ts`
- Current Cairn source: `app/src/features/activitySimulator/ActivitySimulatorPanel.tsx`
- Current Cairn source: `app/src/features/activitySimulator/activitySimulatorEngine.ts`
- [Mapbox Directions API](https://docs.mapbox.com/api/navigation/directions/)
- [Mapbox Navigation iOS free-drive UI](https://docs.mapbox.com/ios/navigation/v3/guides/free-drive/user-interface/)
