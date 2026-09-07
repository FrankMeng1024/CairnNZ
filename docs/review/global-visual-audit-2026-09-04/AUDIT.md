# CairnNZ global visual audit — 2026-09-04

Scope: current app UI around Home, Friends, Add Friend, Trails, Memory, Hiking, Running, Settings, route/cairn lists and details, and representative loading/modal/transient states. Mapbox tile design is excluded. This is an audit only; no production UI or artwork was changed.

## Executive finding

The app has a recognizable system, but it is strongest where environmental imagery and semantic surfaces are composed together (Home, Auth, Friends, Add Friend). It weakens when a feature becomes map-led or data-empty: the same few dark-green or pale-cream planes replace atmosphere, control hierarchy becomes denser, and manually styled sheets diverge from the shared material model. Day and Night are broadly coordinated; Sunset is the least resolved systemic state.

## Screen assessment

| Area | Alignment | Finding |
| --- | --- | --- |
| Auth | Strong reference | Clear scenic hierarchy, calm premium composition, confident primary actions. The compact recovery/status pill is visually more generic than the screen around it. |
| Home | Strong reference | Best integration of scenery, readable glass, typography, action hierarchy, and bottom navigation. Production action icons remain the unresolved piece; weather artwork was intentionally preserved. |
| Friends | Strong | The most coherent utility screen: scenic continuity, restrained two-tab control, readable cards, clear fixed Add Friend action. |
| Add Friend | Strong | The arched scenic header and elevated sheet feel authored and related to Friends. Sunset has weaker surface/background separation than Day and Night. |
| Settings | Mixed-positive | Information hierarchy and grouped cards are understandable, but the page is dense and contains many local colors/surfaces rather than one shared semantic implementation. |
| Hiking / Running | Mixed | Operational hierarchy is clear and the bottom action is easy to find. The large empty map fallback and independently styled lower trays make both screens feel more generic than Home/Friends. |
| Trails | Weak | Three primary tabs, a second Mine/Friends selector, search, filters, and sorting stack too many equal-weight controls. Empty and populated states feel flatter and more procedural than Friends. |
| Memory | Weak | Loading/empty treatment leaves most of the page as an undifferentiated plane. The small central mark does not carry enough authored identity or recovery guidance. |
| Activity / route detail | Weak | Large inactive map regions and bottom sheets with different proportions/actions make detail flows feel like legacy shells. |
| Cairn list / detail | Weakest nested flow | List controls inherit Trails' density. Cairn detail has a severe map/sheet split, weak visual continuity, and a different action/material language from Add Friend and the standard modal components. |

## System-coherent components

- `VisualThemeTokens` and `useVisualTheme` establish useful semantic Day/Sunset/Night roles.
- `SegmentedControl` is coherent in isolation; Friends demonstrates its clearest use.
- `BottomSheetFrame`, `ModalCard`, and `PrimaryButton` express the intended radius, surface, and action hierarchy when screens actually use them.
- Home's scenic/readable/elevated layering and bottom navigation establish the clearest material order.
- Friends cards and the Add Friend sheet show how utility content can retain environmental authorship without becoming decorative.

## Cross-screen inconsistencies

- Multiple manually constructed sheets coexist with the shared sheet/modal primitives, producing different corner radii, handles, scrims, spacing, and footer actions.
- Loading, empty, permission, unavailable-map, unfinished-session, and recovery surfaces do not read as one state family. Some are scenic and elevated; others are isolated white/dark blocks or small generic banners.
- Icon containers vary between bare line icons, white tiles, green circles, illustrated cards, and status chips without a consistent semantic reason.
- Activity selectors, tabs, filters, and chips often share similar visual weight, particularly in Trails.
- Destructive, secondary, and disabled actions vary in borders, fill opacity, and placement across route/activity/cairn details.
- `GlassPanel` retains legacy light/dark rgba defaults instead of the semantic material roles used by newer components.

## Tabs and navigation

Friends is the best tab reference: one compact two-choice control, one content hierarchy, and one persistent primary action. Trails should inherit this priority and proportion, but not blindly copy the information architecture. Its primary Activities/Routes/Cairns choice should remain dominant; Mine/Friends, search, filters, and sort should be lowered or progressively revealed so they stop competing as another navigation bar. Home bottom navigation is visually coherent; local feature controls should not mimic its weight.

## Day / Sunset / Night

- **Day:** most consistent. Warm mineral surfaces and dark forest typography generally survive across pages.
- **Night:** Home and Friends retain scenic blue/neutral depth, but Memory, Trails, activities, and details often collapse into broad green-black planes. This is coordinated at a token level but still reads as "green everywhere" in several feature screens.
- **Sunset:** least systemic. The current detail board shows many pages becoming a flat brown-gray blanket with reduced surface separation, while Friends retains environmental depth. Sunset is therefore behaving as page styling rather than one reliable material state.

## Hard-coded style and theme risks

- `SettingsScreen.tsx` derives some background state but still contains many inline legacy light/dark colors and does not consume `useVisualTheme` as its primary surface contract.
- `HikingScreen.tsx` and `RunningScreen.tsx` contain local operational palettes and manually styled trays/sheets.
- `MemoryScreen.tsx` retains pale local fallback surfaces.
- `MysteryCairnSheet.tsx` is a clear legacy outlier: hard-coded dark brown/rgba material and no shared theme hook.
- `MapHistoryScreen.tsx` has semantic overrides layered over numerous older style defaults, making drift likely.
- `GlassPanel.tsx` uses legacy generic rgba values, allowing otherwise migrated screens to reintroduce old material behavior.
- Some hard-coded values are legitimate status/avatar/map-overlay colors; the risk is local page surface, text, border, and scrim values that duplicate semantic token roles.

## Visual/material issues versus product-structure issues

**Visual/material:** surface color and opacity, radius/elevation/handle inconsistencies, icon-container variation, Sunset separation, Night green dominance, generic state illustrations, and mismatched destructive/secondary buttons.

**Product structure:** Trails' two-tier navigation plus filters, map-led detail screens with little useful fallback content, competing action hierarchy in route/activity/cairn details, and sparse loading states that provide neither next action nor meaningful context. Tokens alone will not solve these.

## Next implementation priorities

1. Normalize all detail/modal/transient frames onto `BottomSheetFrame` / `ModalCard` semantic roles, including scrim, handle, radius, and footer action hierarchy. High value, low behavior risk.
2. Remove page-local surface/text/border values from Settings, Hiking, Running, Memory, and Mystery Cairn in favor of `VisualThemeTokens`; keep status and Mapbox-specific colors explicit where appropriate.
3. Give Trails Friends-like control priority: one dominant primary tab row, visually subordinate scope/filter tools, and a shared empty/list card treatment. This includes a small product-structure decision.
4. Establish one shared loading/empty/permission/recovery state pattern that inherits the parent page's material and offers an explicit next step where one exists.
5. Converge Hiking and Running lower trays and route selectors without changing their activity logic.
6. Rework route/cairn/activity detail shells around a common elevated-sheet contract and intentional no-map fallback; do not redesign Mapbox internals.
7. Validate the above across Day/Sunset/Night together, with Sunset separation and neutral Night surfaces as explicit acceptance criteria.

## Runtime caveat

Fresh Expo Web captures were made at 390 × 844. The local session had no Mapbox access token and browser wake-lock permission was denied, so map areas display the app's unavailable/loading fallbacks. This is useful evidence for surrounding UI and recovery states; Mapbox internals are not scored.
