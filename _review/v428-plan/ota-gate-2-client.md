# OTA Gate #2 — Client Review

## Verdict
PASS_WITH_MINOR

## Critical (block OTA)
None. Three-state dots visually distinct (solid sepia / hollow sepia border 1.5 / grey #d5cdba), testID coverage complete (backdrop, panel, title, up-btn, row-*, legend, empty-banner), sim-walker gate defense-in-depth OK: `__DEV__ && debugMode && simWalkerActive`, all three needed; `useSimWalkerStore` is in-memory only (create() with no persist middleware — confirmed cold restart resets to false). `devFlags.ts` env-var gate removed, no leak surface. `HighlightRegionLayer` shape useMemo dep=[polygon] correct, `EMPTY_FC` Object.freeze prevents source churn. `isEmptyPolygon` null-safe (`!p || !p.features || len===0`). `normalizeSibling` v427 compat handles 'marked'/'walked'/'locked'/'explored'/unknown→locked — all 5 cases covered. Cache v2 key includes version prefix + drill suffix → v1 entries dormant (accepted TTL expiry). Empty banner trigger `explored_count===0 && here_state==='locked' && !data.parent` correct — only fires at world/continent root for zero-data users. `numberOfLines=3 + adjustsFontSizeToFit + minimumFontScale=0.75` applied to BOTH title (line 143-149) and rowName (line 228-237).

## Concerns
1. `invalidatePanelCache(regionId)` at line 209 removes key without v2 prefix — dead code path (won't hit any real key since fetchPanelData writes `hierarchy:panel:v2:...`). Not blocking, callers only use the batch branch which uses `startsWith('hierarchy:panel:')` (matches v2). Log as tech debt.
2. `MemoryScreen.tsx` line 852 gate `hierarchyOpen && hierarchyRegionId` — if `fetchDeepestRegion` returns null (ocean/unmapped coord), panel silently won't open despite `hierarchyOpen=true`. User taps Layers, nothing visible. Acceptable in prod (rare coord case) but worth toast.
3. Zoom interpolate 2→0.10, 4→0.25 skips z=3 (falls in linear ramp, fine). LineWidth at z<2 undefined by Mapbox interpolate (extrapolates 3px, safe).
4. `HierarchyPanel` `data.parent!` non-null assertion at line 155 — guarded by `data?.parent ?` above, safe.
5. `flyTokenRef` in MemoryScreen + `lastFlyTokenRef` in MemoryMap dedup — race-safe (single-threaded JS).

## Recommend proceed?
YES. Ship v428 OTA. File issues #1/#2 as backlog Medium.
