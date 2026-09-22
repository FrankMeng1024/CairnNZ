# Hike / Run native Mapbox UI

Date: 2026-09-13

Verdict: **READY FOR NATIVE VISUAL REVIEW — ACTUAL MAP STYLE VALIDATED, NATIVE SDK FRAME STILL REQUIRED**

## Scope and safety boundary

This is a presentation pass over the existing Activity Product-DNA implementation. Hike and Run remain one instrument and one tracking engine. No route point, canonical point, acceptance rule, distance, Memory rule, GPS precision setting, or Final geometry was changed to improve contrast.

The installed native package is `@rnmapbox/maps` 10.3.1. Actual map judgment did not use the blank Expo Web native-map fallback. A separate reproducible browser capture rendered Mapbox Standard over public Kepler Track geometry at mobile size, while Expo Web validated the complete surrounding Hike/Run chrome and interactions.

## Issues found

- The route used one flat app color and a light surface casing across every map theme.
- Night's Mapbox Standard lighting materially dimmed custom route layers; color values that looked adequate on a flat canvas became weak over the real basemap.
- The default blue Mapbox user puck was not clearly distinct from Run blue or other map symbols.
- The puck could lose the visual stack to route/marker layers.
- Activity ornament offsets were tied to an old top-control layout, putting legal UI into competition with Activity controls.
- Point-of-interest density competed with the operational route.
- Activity loading/offline cards used fixed light colors and did not belong to Sunset/Night.
- Hike recreated a mapped point array on each render, defeating the confirmed route's incremental identity path and rebuilding stable projection work.

## Map style changes

Activity keeps the shared Mapbox Standard family and shared Day/Sunset/Night light presets. It does not introduce separate Hike and Run basemaps. The Activity-specific configuration suppresses POI labels while retaining place, road, pedestrian/trail, transit and road-shield context. Existing theme tokens continue to control the basemap preset.

This yields a quieter instrument surface without stripping away navigation context. Parks/forest, water, roads, labels and terrain remain Mapbox-native rather than redrawn as a Cairn imitation.

Mapbox Standard treats custom layers as lit 3D-scene content. The first real-map Night capture showed the route dimming badly. The final implementation supplies theme-specific `lineEmissiveStrength` and `circleEmissiveStrength`, and places Activity route/puck layers in the Standard `top` slot. This follows [Mapbox Standard style guidance](https://docs.mapbox.com/map-styles/guides/standard-styles/) and the [style layer specification](https://docs.mapbox.com/style-spec/reference/layers/).

## Route presentation

The route uses a calm two-layer line:

| Theme | Hike | Run | Casing | Width / casing |
|---|---|---|---|---:|
| Day | deep forest `#1F5B43` | mineral blue `#245F94` | warm cream `#FFF9ED` | 5.2 / 9.4 |
| Sunset | muted forest `#315B4B` | slate blue `#315F7C` | warm sand `#F5E4D3` | 5.2 / 9.4 |
| Night | pale fern `#B8D2A2` | pale sky `#86BCE4` | deep ink `#0B131E` | 5.4 / 9.8 |

The casing is not a glow. It is a compact contrast boundary that preserves visibility over bright roads, dark roads, parks, forest and water edges. Night gets slightly more width and full emissive strength, not neon saturation.

Static chunks and the continuous animated head use exactly the same presentation tokens. Approach geometry remains a distinct caution layer. Route geometry itself is untouched.

## Puck presentation

The real, paused and simulator positions now share one Cairn puck vocabulary:

- a restrained amber halo;
- a cream/light ring;
- a warm mineral core;
- `top` slot and post-route render order.

That makes “where I am now” instantly separate from both green Hike and blue Run without adopting generic fitness neon. `UserLocation` supports custom Mapbox-native layer children in the installed SDK; simulator/paused positions use the same three layer roles through a `ShapeSource`.

## Day, Sunset and Night results

Day:

- Forest Hike and mineral-blue Run remain legible over roads and green land cover.
- Warm casing belongs to Cairn's cream materials instead of reading as a bright white sticker.
- Amber position remains distinct at a route overlap.

Sunset:

- Route hues are muted to work with the warmer basemap and shared Sunset surfaces.
- Increased emissive strength prevents the line becoming muddy under Standard lighting.
- Legal/control chrome remains quiet and subordinate.

Night:

- Pale route cores plus deep-ink casing survive dark road/forest transitions.
- Full emissive strength fixes the failure seen in the first actual-map capture.
- The puck stays readable without a glowing blue default.

## Legal attribution and controls

Mapbox logo and attribution remain enabled. Activity places them together at the lower-left, 132 px above the recording dock. The position avoids Pause/Finish, the lower-right recenter/flag controls, and the safe-area edge. Map History and Plant's map adjustment also no longer disable required ornaments.

The native SDK continues to own tap behavior and accessibility for its legal controls; no custom fake attribution was introduced. [Mapbox's iOS Maps guide](https://docs.mapbox.com/ios/maps/guides/) was treated as the legal/UI authority. Final compliance and touch-target behavior still require a native device frame because the browser evidence uses Mapbox GL JS controls, not the RN native ornament implementation.

## Hike / Run consistency

Hike and Run use:

- the same basemap configuration;
- the same casing, width, puck and ornament rules;
- the same confirmed-route component and camera/control hierarchy;
- one shared Day/Sunset/Night presentation module.

Their only route difference is semantic emphasis: forest for Hike, mineral blue for Run. There is no separate map skin.

## Visual evidence

Actual map:

- [Day/Sunset/Night Hike/Run Mapbox board](../../../app/_review/overnight-map-ui/activity-mapbox-board.png)
- [actual-map capture script](../../../app/scripts/capture-activity-mapbox-qa.mjs)

The script loads Mapbox Standard GL JS 3.15 with public Kepler geometry and the same route/puck/ornament presentation at 390×844. Six frames were inspected. This is real basemap evidence, but not a native-RN SDK screenshot.

Full product chrome:

- [overnight Expo Activity board](../../../app/_review/overnight-expo-activity/activity-ui-day-board.png)
- [existing before Activity board](./before/activity-ui-day-board.png)
- [existing after Product-DNA family board](./after/product-family-review-board.png)
- reference frames: [Home](./before/references/home-day-390x844.png), [Friends](./before/references/friends-day-390x844.png), [Auth](./before/references/auth-390x844.png)

Expo generated 34 Day/Sunset/Night Hike/Run frames. It exercised 360×640, 390×844 and 430×932; all 34 layout checks and Hike/Run pause/resume interactions passed with zero runtime errors. The native map area is intentionally blank in those Expo Web frames; actual-map judgment comes from the separate Mapbox board.

## Tests

- `activityMapPresentation.test.ts`: all six palettes, widths, casing, puck separation, emissive values and ornament placement.
- `activityRecordingUiContracts.test.ts`: shared presentation, `top` slot, legal UI, custom puck and stable route identity contracts.
- `confirmedRoutePresentation.test.ts`: append-only incremental projection and segment behavior.
- Full focused convergence lane remained green after presentation changes.

## Tracking safety confirmation

- `BestForNavigation` and 1 m foreground/background precision intent are unchanged.
- Hike and Run still share one canonical engine and one Activity location authority.
- Route geometry and segment boundaries are unchanged.
- Presentation shuts down with the established Activity lifecycle rules.
- Passing the stable `liveTrackPoints` reference fixes projection efficiency only; it does not change point content or timing.

## Remaining native review

A native iPhone/simulator capture is still required for:

- RN Mapbox Standard layer slots/emissive rendering;
- native puck updates and z-order while moving;
- logo/attribution exact dimensions, tap behavior and accessibility;
- legal/control collisions on the smallest supported iPhone;
- Day/Sunset/Night on-device color management;
- terrain/topography behavior if the production style enables it.

No native simulator was available in this environment, so this report does not claim native visual validation.

HIKE / RUN NATIVE MAP UI READY FOR VISUAL REVIEW
