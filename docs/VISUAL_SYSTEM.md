# CairnNZ Visual System

## Direction

Brand color authority: the complete current production Home rendered at 390×844 in Day, Sunset, and Night. The three current Sunny runtime assets remain unchanged; the UI/material relationship, not an external palette, anchors shared-system calibration.

Auth (`app/assets/auth/landing-hero.jpg`) is the locked quality and art-direction calibration anchor. Its visual DNA is believable editorial realism, broad soft daylight, layered atmospheric haze, restrained sage/forest/stone color, controlled saturation and highlights, fine natural texture, quiet interaction zones, and optimistic calm. CairnNZ visual assets combine natural atmospheric realism, restrained editorial/field-journal detail, and optimistic outdoor energy. Functional UI stays clean, modern, restrained, and product-focused.

CairnNZ is a bright, misty New Zealand outdoor world: fresh air, landscape depth, calm exploration, restrained premium finish. Evolve this world; do not pursue novelty at the expense of continuity. A visual candidate must improve the complete rendered screen, not merely look attractive alone.

Preserve `app/assets/auth/landing-hero.jpg`, the Friends day/night backgrounds, and the Add Friend bird/arch concept. Keep all original artwork for rollback. The no-regression rule is simple: if a rendered candidate is not clearly better than baseline, revert the candidate.

## Two axes

- Weather selects Home scenery only: Sunny, Cloudy, Rainy, Snowy.
- Day/Sunset/Night selects functional UI material relationships. `Rainy Sunset = rainy-sunset scenery + SUNSET material`; `Rainy Night = rainy-night scenery + NIGHT material`.
- Day, Sunset, and Night are three equal expressions of the same CairnNZ product. Sunset is independent—not modified Night—and retains visibly living daylight. Cloudy and Rainy remain inviting, dimensional, and exploration-positive in all three states.
- Mapbox activity screens use Mapbox plus DAY, SUNSET, or NIGHT semantics; never Home scenery.

Canonical shared tokens live in `app/src/components/tokens.ts`; `app/src/hooks/useVisualTheme.ts` is the component entry point. Weather selection and Home delivery live in `app/src/utils/homeBackground.ts`. Phase B-1 calibrates the shared Day/Sunset/Night surface ladder against the accepted Home authority; Home remains independently regression-locked. The rendered relationship matrix and interaction rules in `CAIRNNZ_VISUAL_DNA.md` govern later screen composition migrations.

## Composition

Home keeps its existing layout. Scenic detail must yield beneath greeting, metrics, primary actions, cards, tabs, and navigation. Compose in this order: scenery → systematic atmospheric/readability layer → functional UI. Prefer sky, mist, depth, and low-detail terrain under content; do not solve readability by blacking out the landscape.

The twelve Home assets share one landscape family, composition intent, and focal logic. Derive future weather or lighting variants from the locked Home family—not as independent scenes or color grades—retain the mobile cover crop, and validate at 390×844 and 430×932. Cloudy and Rainy require genuine luminous atmosphere, believable moisture/material cues, and an inviting exposure in the underlying image. Settings reuses this world with stronger veil and surface opacity.

## Product families

- Auth: locked scenic background; shared buttons, fields, surfaces, and vector icons around it.
- Friends: warmer human-connection branch of the same natural product. Keep the bird/arch identity, believable natural light/materials, and restrained editorial warmth; avoid smooth cartoon/game rendering. Friends intentionally hides its four-button bottom navigation while all other screens retain existing navigation.
- Hiking, Running, Memory: Mapbox-first. Controls, metrics, status chips, markers, confirmations, panels, and sheets use semantic tokens; scenic Home images never sit behind maps.
- Trails and detail flows: shared background, elevated surfaces, tabs/chips, list hierarchy, empty/loading states, and semantic controls.

## Components

Primary actions use `PrimaryButton`; quiet actions use the relevant standard/elevated semantic material plus a fine border. `ContentSurface` governs only record/elevated material and leaves domain-row composition to screens. `SegmentedControl` uses one shared track whose active and inactive choices remain visibly related. `TextField`, `BottomSheetFrame`, and `ModalCard` own their semantic material levels; `DismissButton` and `BackButton` own neutral functional icon contrast while callers own top-right/top-left placement. Every family follows the three-state rendered relationships in `CAIRNNZ_VISUAL_DNA.md`; avoid excessive glass effects.

Functional icons use the established production geometry and semantic active/inactive colors. Geometry stays fixed across Day/Sunset/Night; only environmental contrast relationships change. Do not create separate time-state PNG icon sets. Raster artwork is reserved for scenery and illustration.

## Asset production

Never overwrite or delete a source asset. Derived Home delivery files are 1170×2532 JPEGs. Use semantic image generation/editing when objects, light, atmosphere, materials, or rendering language must materially change; deterministic tools are only for resize, crop, compression, and minor finishing afterward. Reusable cutouts require real alpha, clean edges, and checks on both light and dark backgrounds.

Before meaningful visual changes, inspect `docs/VISUAL_MIGRATION_STATE.md`, `docs/VISUAL_ASSET_MANIFEST.json`, the final boards under `docs/qa/visual-migration/final/`, and the matched corrective runtime evidence under `docs/qa/corrective-runtime-2026-08-22/`. Do not casually redesign layout, component order, the visual anchor, Auth, Friends, or Add Friend.
