# UI DNA and shared dependencies

## Authority and image review

The audit inspected `docs/VISUAL_SYSTEM.md`, `docs/VISUAL_MIGRATION_STATE.md`, `docs/VISUAL_ASSET_MANIFEST.json`, `docs/CAIRNNZ_VISUAL_DNA.md`, the north-star lock, canonical Home/Friends/Auth boards, prior detail-convergence boards, and current Trails/Settings boards. The accepted anchor is the locked Home Day/Sunset/Night family plus Auth art quality—not a generic redesign invitation. Memory’s final visual language remains open.

Open `visual/index.html` offline. Its 41 full-resolution captures use existing components and synthetic fixtures. The three boards are:

- `visual/images/board-activity-day-sunset-night.jpg`
- `visual/images/board-library-detail-editor.jpg`
- `visual/images/board-cairn-memory-settings.jpg`

## Concrete observations

- Hike/Run chrome is coherent across themes, but the Web capture says **Map unavailable**. This proves surrounding layout only. It cannot judge route/puck/basemap/Mapbox legal-control quality.
- The representative 320×568 Hike Web capture clips the top chrome and lower Start control. This is a small-Web-layout risk, not proof of a native iPhone defect; the 430×932 Settings capture remains fully readable.
- Trails’ Activities/Routes segmented structure, density, and theme contrast align well with the current DNA. That is not acceptance of full-history retrieval or its Details.
- Activity/Route Detail use a consistent map-plus-bottom-sheet composition and are reasonably aligned, but their Web line renderer is a fallback, not native Mapbox. Route Detail exposes a no-op Layers control.
- Route Editor shares the family but renders **Map unavailable** on Web and exposes a no-op gear. The bottom panel is usable, though it is not the canonical Route Detail destination.
- Plant is strongly tokenized and consistent. Own Cairn Detail is visually more divergent: large pale/blank map area, local detail system, and exact-coordinate display. It must be reviewed independently from Plant.
- Memory remained on **Opening your map** in all three captures after one runtime error. The underlying Web Mapbox canvas exists, but these images prove only the current loading state. Native Standard v3 is not represented: Web substitutes outdoors-v12.
- Settings is the strongest scoped non-reference page: canonical surfaces, scenic backgrounds, fields, segmented Appearance, and destructive hierarchy align across Day/Sunset/Night. Deployed behavior still disagrees with UI copy.
- Literal-color scan (not a defect count): Hike 24, Run 24, MapHistory 26, Route Editor 1, Marker Detail 6, Memory 12; Trails/Plant/Settings 0. Many are legacy/semantic/local styles, so future work must inspect usage before replacing them.

## Shared-role mapping

| UI role | Canonical component/token | Current implementation | Local divergence | Affected pages | Proposed keep/replace/extend |
|---|---|---|---|---|---|
| Scenic theme state | useVisualTheme + useScenicTimeState + tokens.ts | All scoped pages consume theme; maps vary by renderer. | Web adapter replaces native Standard v3 with outdoors-v12. | All pages, Memory/Plant/Cairn maps | KEEP; document renderer boundaries. |
| Recording chrome | ActivityRecordingChrome | Hike and Run share top metrics/status and bottom docks. | Mode-specific labels/metrics are expected; native map unproven. | Hike, Run | KEEP; review on iPhone before edits. |
| Back navigation | BackButton | Used across main/detail/editor pages. | Post-create Route stack makes Back return Home. | Route Editor, Route Detail | KEEP component; fix journey only after decision. |
| Primary/secondary/destructive actions | PrimaryButton and semantic theme tokens | Settings/Plant use canonical components; details mix local TouchableOpacity styles. | MapHistory has 26 literal hex occurrences; Hike/Run each 24; Memory 12; Marker Detail 6. | Hike, Run, Activity/Route Detail, Cairn Detail, Memory | EXTEND/REPLACE only per approved page slice; inspect semantic use, not raw count alone. |
| Content surfaces/sheets | ContentSurface + ModalCard/material tokens | Trails/Settings strong; Details use local bottom-panel systems. | Own Cairn Detail and Memory read as different generations. | Activity Detail, Route Detail, Own Cairn Detail, Memory | SHARED_VISUAL_FIX only after page acceptance criteria. |
| Fields | TextField and accepted field tokens | Settings canonical; Route/Plant/Detail include local TextInput styling. | Cross-page focus/error/keyboard evidence incomplete. | Plant, Route Editor, Details, Settings | REUSE/EXTEND narrowly. |
| Segmented controls | shared visual tokens and page-local controls | Trails tabs and Settings appearance are clear in three themes. | Memory scope is over map and loading state obscures review. | Trails, Settings, Memory | KEEP accepted patterns; review Memory separately. |
| Map renderer | Native RNMapbox; mapboxAdapter only for Web QA where supported | Hike/Run native area blank on Web; Activity/Route use TrackPolyline fallback; Editor says Map unavailable; Plant/Cairn/Memory use real Web adapter. | No one Web capture category proves native integration. | All map pages | KEEP renderer truth labels; require native evidence for acceptance. |
| Status/error/retry | semantic status tokens + real executor | Activity state surface strong; Route mutation feedback and Memory loading are incomplete. | Some states lack worker or surfaced error. | Activity Detail, Route Detail, Memory | NARROW prerequisite per page. |
| Accepted art anchors | Locked Home family + Auth background + manifest assets | Settings uses scenic background; detail pages largely flat/map-led. | No permission to invent a new visual direction. | Any future shared visual change including Home/Friends/Auth | KEEP locked assets and regression-check references. |

## Cross-page dependency rules

- Changes to `tokens.ts`, `useVisualTheme`, `BackButton`, `PrimaryButton`, `ContentSurface`, map-style selection, or icon semantics can affect accepted Home/Friends/Auth even if those files are untouched.
- Hike/Run shared chrome should be corrected once, while mode-specific metric priorities remain local.
- Detail convergence should not become a global rewrite. Page-specific action/data defects are prerequisites; shared visual extraction follows only when two or more approved pages need the same role.
- No Web renderer category is upgraded to native evidence. No blank map or visible token is called Mapbox quality proof.
