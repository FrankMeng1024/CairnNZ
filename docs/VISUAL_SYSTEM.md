# CairnNZ Visual System

## Direction

Primary Visual Anchor: `app/assets/home/home-bg-sunny-day-semantic-v2-master.png`.

Auth (`app/assets/auth/landing-hero.jpg`) is the locked quality and art-direction calibration anchor. Its visual DNA is believable editorial realism, broad soft daylight, layered atmospheric haze, restrained sage/forest/stone color, controlled saturation and highlights, fine natural texture, quiet interaction zones, and optimistic calm. CairnNZ visual assets combine natural atmospheric realism, restrained editorial/field-journal detail, and optimistic outdoor energy. Functional UI stays clean, modern, restrained, and product-focused.

CairnNZ is a bright, misty New Zealand outdoor world: fresh air, landscape depth, calm exploration, restrained premium finish. Evolve this world; do not pursue novelty at the expense of continuity. A visual candidate must improve the complete rendered screen, not merely look attractive alone.

Preserve `app/assets/auth/landing-hero.jpg`, the Friends day/night backgrounds, and the Add Friend bird/arch concept. Keep all original artwork for rollback. The no-regression rule is simple: if a rendered candidate is not clearly better than baseline, revert the candidate.

## Two axes

- Weather selects Home scenery only: Sunny, Cloudy, Rainy, Snowy.
- Day/Night selects functional UI tokens only. `Rainy Night = rainy-night scenery + NIGHT tokens`.
- Day and Night are two expressions of the same CairnNZ product. Cloudy and Rainy must remain inviting, dimensional, and exploration-positive.
- Mapbox activity screens use Mapbox plus DAY or NIGHT tokens; never Home scenery.

Canonical tokens live in `app/src/components/tokens.ts`; `app/src/hooks/useVisualTheme.ts` is the component entry point. Weather selection and Home delivery live in `app/src/utils/homeBackground.ts`.

## Composition

Home keeps its existing layout. Scenic detail must yield beneath greeting, metrics, primary actions, cards, tabs, and navigation. Compose in this order: scenery → systematic atmospheric/readability layer → functional UI. Prefer sky, mist, depth, and low-detail terrain under content; do not solve readability by blacking out the landscape.

The eight Home assets share one exact landscape world, composition, focal logic, and generation lineage. Derive future weather or lighting variants from the semantic Primary Visual Anchor—not as independent scenes or color grades—retain the mobile cover crop, and validate at 390×844 and 430×932. Cloudy and Rainy require genuine luminous atmosphere, believable moisture/material cues, and an inviting exposure in the underlying image. Settings reuses this world with stronger veil and surface opacity.

## Product families

- Auth: locked scenic background; shared buttons, fields, surfaces, and vector icons around it.
- Friends: warmer human-connection branch of the same natural product. Keep the bird/arch identity, believable natural light/materials, and restrained editorial warmth; avoid smooth cartoon/game rendering. Friends intentionally hides its four-button bottom navigation while all other screens retain existing navigation.
- Hiking, Running, Memory: Mapbox-first. Controls, metrics, status chips, markers, confirmations, panels, and sheets use semantic tokens; scenic Home images never sit behind maps.
- Trails and detail flows: shared background, elevated surfaces, tabs/chips, list hierarchy, empty/loading states, and semantic controls.

## Components

Primary actions are rounded spruce fills with `onPrimary`; quiet actions use `surface`/`surfaceElevated` plus `border`. Cards and lists use restrained translucency, one-pixel semantic borders, consistent rounded corners, and low elevation. Tabs use a shared container with a solid active segment. Popups, sheets, and modals use `surfaceElevated`, semantic scrims, a shared handle/border, and the same action hierarchy. Avoid excessive glass effects.

Functional icons use `app/src/components/Icon.tsx` (Lucide geometry), approximately 1.9–2.0 stroke weight, and semantic `iconActive`/`iconInactive` colors. Do not create separate Day/Night PNG icon sets. Raster artwork is reserved for scenery and illustration.

## Asset production

Never overwrite or delete a source asset. Derived Home delivery files are 1170×2532 JPEGs. Use semantic image generation/editing when objects, light, atmosphere, materials, or rendering language must materially change; deterministic tools are only for resize, crop, compression, and minor finishing afterward. Reusable cutouts require real alpha, clean edges, and checks on both light and dark backgrounds.

Before meaningful visual changes, inspect `docs/VISUAL_MIGRATION_STATE.md`, `docs/VISUAL_ASSET_MANIFEST.json`, the final boards under `docs/qa/visual-migration/final/`, and the matched corrective runtime evidence under `docs/qa/corrective-runtime-2026-08-22/`. Do not casually redesign layout, component order, the visual anchor, Auth, Friends, or Add Friend.
