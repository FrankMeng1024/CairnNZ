# Stage 4 Code Review — LngLat alt extension
**Verdict**: PASS

## Spec compliance
- §2.1 LngLat.alt?: number | null — declared as optional union, JSDoc clearly documents producers/consumers and null semantics. PASS.
- §2.2 lerp (PolylineSampler:50-61) — both alt → interpolated number; partial → null; both undefined → out.alt left unset (undefined). PASS.
- §2.2 lerpLocal (useRouteEditStore:237-251) — identical three-state logic to lerp. PASS.
- flattenGeometry (PolylineSampler:101-107) — readCoord requires `typeof === 'number' && Number.isFinite()`, correctly rejecting NaN/Infinity/undefined. PASS.
- spliceMatched dedupe (useRouteEditStore:976-987) — when two points are co-located (≤0.5m) and survivor lacks alt while dropped point carries alt, survivor is upgraded via spread (`{ ...prev, alt: out[i].alt }`). PASS.

## Anti-cheating
- Hardcode: no new magic numbers introduced for alt logic.
- TODO/FIXME: none added.
- Silent fail: no try-catch wrapping alt logic.
- @ts-ignore / any: none. Clean optional typing.
- Scope creep: changes are surgical — only lerp, lerpLocal, readCoord, dedupe block, and the LngLat type touched. No unrelated refactors.

## Back-compat
Old call sites passing `{ lng, lat }` continue to work: alt is optional, downstream haversine/projection/RDP/CR-spline math reads only lng/lat. Catmull-Rom output (line 540) emits `{lng, lat}` without alt — acceptable since alt is optional, and this is the smoothing fallback path.

Minor observation (non-blocking): `isPointAcceptableEndpoint` and `nearestOriginalIdx` consume LngLat unchanged — no contract break.

## Test rigor
11 tests cover:
- densify: both-alt interpolation, no-alt pass-through, partial→null
- flattenGeometry: 3D LineString, 2D omit, NaN/Infinity rejection, MultiLineString mixed
- flattenGeometryToParts: alt across parts
- applyTrimFraction: full retention, interpolated boundary numeric, partial→null

All three alt states (number / null / undefined) covered. GeoJSON 2D vs 3D both tested. Partial-knowledge non-fabrication explicitly asserted. AsyncStorage stub correctly placed before imports.

Gap (minor, non-blocking): no direct unit test for the spliceMatched dedupe alt-upgrade path. Plan note acknowledges this is integration-tested in stage 5.

## Recommendation
PASS — proceed to Stage 5. The dedupe alt-upgrade is the only piece without a dedicated unit test; flag for stage 5 integration coverage.
