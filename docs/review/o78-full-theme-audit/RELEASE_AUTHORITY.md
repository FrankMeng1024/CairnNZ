# O78 full-app three-theme audit authority

## Scope

O78 is a presentation-only repair layered on the O77 Routes closure. It keeps
Route geometry, Activity truth, GPS/WAL, Memory/Fog geometry, friend privacy,
and backend contracts unchanged.

The production screen inventory is derived from `RootNavigator`, nested
Settings pages, Trails/Routes modes, Route editor tools, Activity states,
Memory states, Cairn detail/creation states, Friends surfaces, and the Auth
state machine. Development-only preview screens are inventoried separately in
the external review artifact and are not production OTA surfaces.

## Root causes repaired

1. `HikingMap` and `MapHistoryScreen` unconditionally excluded Web even though
   Cairn already had a real `react-map-gl`/Mapbox GL adapter. Hike, Run,
   Activity Detail, and saved/received Route Detail therefore rendered an
   unavailable or flat fallback in loaded Web QA. These consumers now select
   the Web adapter while native continues to use `@rnmapbox/maps`.
2. The Web adapter exposed `MarkerView` as a no-op, hiding view-annotation
   Cairn pins. It now uses the real Mapbox GL `Marker` primitive.
3. The Web camera contract lacked `fitBounds`, so the first genuine
   Activity/Route detail render crashed during camera fitting. The adapter now
   implements the same ordered north-east/south-west and padding contract used
   by RNMapbox.
4. The first Web clustering bridge forwarded absent cluster/filter properties
   as explicit `undefined` values. Mapbox GL rejected otherwise valid Fog and
   line sources/layers. Optional properties are now omitted, and Web-only
   Mapbox GL v2 drops the native Standard `lineEmissiveStrength` paint key.
5. Acquired Cairn clusters used fixed green/white colors and the Web bridge did
   not forward cluster filters. Clusters now resolve semantic theme tokens and
   render through real clustered Mapbox sources in all three themes.
6. `MapHistoryScreen` omitted `sharedDeliveryId` from its object-detail gate,
   redirecting valid Received Route snapshots back to Trails. Received Route
   detail now enters the normal content-sized Route detail and real map path.
7. Sunset Settings combined dark semantic copy with a legacy Night-like slate
   material. Settings now uses an illuminated warm Sunset material, semantic
   foreground copy, and shared theme surfaces for text outline contrast.
8. Privacy, Help, and Content Review inherited a top-only safe area plus
   duplicated ad-hoc hero spacing. They now use the same top-and-bottom safe
   area and subpage scroll inset contract.

## Verification authority

- Real Web maps are valid only when the Mapbox GL instance is connected,
  `isStyleLoaded()` is true, viewport tiles are loaded, and every expected
  source/layer is registered. The external artifact records
  sources, layers, camera, renderer, and the full screenshot for each accepted
  map state.
- Web Mapbox evidence is not native iPhone evidence. Native style-import,
  gestures, view annotations, and transition timing remain Owner-device spot
  checks because Xcode Simulator is not installed in this environment.
- Generated screenshots, contact sheets, and capture logs live in the external
  ZIP, not on the deploy-bearing branch.
- The known Memory 10,000-point performance HOLD is unchanged.

## Release boundary

No backend, schema, native plugin, runtime, or build-version change is required.
This change is compatible with iOS Build 65 and runtime `0.2.6-o66` as an OTA
JavaScript/assets update. `eas build` is forbidden.
