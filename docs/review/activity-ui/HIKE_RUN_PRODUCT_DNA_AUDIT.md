# Hike / Run Product-DNA Audit

**Audit date:** 2026-09-12

**Implementation boundary:** presentation only; Activity tracking, GPS authority, Stationary V2, O50 Final, matching, Memory, background providers, persistence, sync, and recovery semantics are frozen.

**Verdict before this audit's implementation:** **CONVERGED FOUNDATION, TARGETED CORRECTION REQUIRED.** The current screens already share a strong recording shell, but Hike's information priority, activity pictograms, user-facing GPS phrases, and inconsistent Finish intent still weaken the intended product DNA.

## Authority and evidence

Read in full:

- `docs/CAIRNNZ_VISUAL_DNA.md`
- `docs/CAIRNNZ_VISUAL_DNA_CHANGELOG.md`
- `docs/CAIRNNZ_VISUAL_ROADMAP.md`
- `docs/VISUAL_SYSTEM.md`
- `docs/VISUAL_MIGRATION_STATE.md`
- `docs/VISUAL_ASSET_MANIFEST.json`
- `docs/VISUAL_NORTH_STAR_LOCK.md`
- `docs/operations/ACTIVITY_VERIFICATION.md`
- the active theme/component sources and the active Home, Friends, Auth, Hike, Run, map, recovery, permission, and completion implementations
- the locked boards under `docs/qa/visual-north-star/`, `docs/qa/visual-migration/final/`, and `docs/qa/corrective-runtime-2026-08-22/`

`CairnNZ_Project_Authority.md`, named in the brief, does not exist in this repository. No claim below is attributed to it. The approved `CAIRNNZ_VISUAL_DNA.md` explicitly governs when older visual records differ.

Fresh Expo Web evidence at 390×844 is under the ignored local artifact path `docs/review/activity-ui/before/`. Reference captures are under `before/references/`. The baseline Activity script produced 25 screenshots, 25/25 non-collision checks, successful Hike and Run Pause → Resume and Finish → Cancel interactions, Reduce Motion enabled, and zero runtime errors. Historical migration screenshots are context only; they are not treated as the current UI.

## Recovered Cairn Product DNA

Cairn is a modern, calm New Zealand exploration-and-memory product. It places the user in a believable living world, makes movement feel inviting and consequential, and reveals other people through quiet traces rather than feeds or status theatre. Its experiential order is world → exploration → memory → shared presence → activity record → precise map/GPS operation.

What makes the product recognisably Cairn:

- **Presence and forward movement:** Home puts the user at human height; map-led surfaces achieve the same “I am here” quality through geographic clarity, route trace, scale, and responsive controls.
- **Living New Zealand:** ecology, geology, water, track character, moisture, broad soft light, and atmospheric depth establish place without tourist symbols.
- **Environmental UI:** UI and environment are composed as one hierarchy. Scenic glass preserves place; denser utility material protects operational information. Transparency is a means, never a style target.
- **Natural premium restraint:** quality comes from believable light, material behaviour, typography, precision, and controlled focal points—not black luxury, heavy glass, saturated green slabs, or card proliferation.
- **Quiet consequence:** routes, explored terrain, memories, and cairns are evidence of a journey. They are not rewards, quests, or engagement metrics.
- **Modern precision:** compact pictograms, large-enough hit targets, tabular-feeling numerals, calm labels, fine borders, and restrained animation make the product usable without turning it into a generic SaaS or sports dashboard.
- **One material family across illumination:** Day is breathable mineral field light; Sunset retains warm living daylight; Night is moonlit cool mineral quiet. Geometry and semantic hierarchy do not change between them.

Cairn is not a generic fitness tracker, a social feed, a gamified map, a Strava clone, an Apple Fitness clone, or a set of page-specific skins.

## Why the frozen/reference surfaces feel related

### Typography

Home uses generous narrative scale and breathing room; Friends compresses the same grounded type into a list workflow; Auth centres a clear brand threshold. Across them, headings are controlled rather than oversized, secondary copy sits one visible value step below primary copy, and labels avoid ornamental “outdoor” typography. Inter is the precise base. Metrics use compact, stable numerals rather than motivational display type.

### Spacing and density

The references use an 8/12/16/20/24/32 rhythm, stable horizontal edges, and deliberate quiet zones. Density changes with the product role: Home breathes, Friends can grow into a list, Auth creates a calm entry point. Empty space is functional composition, not unfinished space.

### Surface ladder

The frozen continuity is deeper than colour:

`environment/page → record/content surface → elevated card → sheet/modal → active control`

- Home lets scenic material reveal place and uses few functional clusters.
- Friends transitions from environment into efficient record surfaces; rows do not become independent decorative cards.
- Auth uses controlled opaque actions over a quiet scenic threshold.
- Temporary sheets/modals are materially thicker and more elevated than their parent screen.
- Active controls are the highest-interaction layer, not automatically the largest or brightest object.

### Materials and shape language

Scenic material, standard content material, and elevated transient material are distinct roles. Fine borders and restrained shadows separate layers. `RadiusRole.card`/`button`/`sheet` keep geometry compact. Pills are reserved for status or bounded choices; full layouts are not made from capsules. This prevents card-grid, giant-radius, pill-everything, and glass-everything drift.

### Colour and icon language

The palette is mineral/forest/stone with controlled saturation. Green is a Cairn action cue, not every surface. Blue remains a narrow, existing Running identifier. Warning and destructive colour are state semantics, not persistent decoration. Core navigation/action identity uses compact `CairnIcon` geometry; conventional operational actions can remain conventional when clarity matters.

### Environment and motion

Auth supplies believable natural realism, broad soft light, fine texture, depth, restrained palette, and quiet UI zones. It is an atmospheric reference, not an Activity layout. Home has the strongest environment; Friends uses a quieter threshold; Activity uses Mapbox. Motion is state-driven and restrained. Reduce Motion and static completeness are hard requirements.

## Shared component and token inventory

| UI role | Current shared component/token | Frozen/reference use | Hike current use | Run current use | Action |
| --- | --- | --- | --- | --- | --- |
| Three-theme semantics | `useVisualTheme`, `VisualThemeTokens` | Home/Friends/shared transients | Yes | Yes | KEEP |
| Spacing/type/radius/shadow | `Spacing`, `FontSize`, `RadiusRole`, `Shadow` | Broad shared use | Shared chrome | Shared chrome | KEEP |
| Scenic/standard/elevated material | semantic theme surface tokens; `GlassPanel` where environment benefits | Home/Friends/Auth-adjacent | Direct map overlay tokens | Direct map overlay tokens | KEEP; do not force GlassPanel |
| Activity top status | `ActivityTopChrome` | Activity-only shared role | Yes | Yes | EXTEND GENERICALLY |
| Ranked metrics | `ActivityTopChrome` metric contract | Activity-only shared role | Yes | Yes | KEEP contract; change Hike content priority |
| Pre-start route/readiness | `ActivityStartDock` | Activity-only shared role | Yes | Yes | KEEP; remove engineering copy |
| Lifecycle action tray | `ActivityControlDock` | Activity-only shared role | Yes | Yes | KEEP; remove engineering copy |
| Recenter | `ActivityRecenterButton` | Shared map-role geometry | Yes | Yes | KEEP |
| Activity mode pictogram | currently generic `Icon` (`Mountain`, `Footprints`) | Home uses Cairn pictograms | Generic | Generic | ADOPT `CairnIcon` |
| General operational icons | `Icon` | Shared utilities/transients | Yes | Yes | KEEP |
| Primary button | `PrimaryButton`/`AppButton` | Shared non-Activity actions | Local within Activity dock | Local within Activity dock | NO CHANGE; dock owns its stateful layout |
| Back | `BackButton`; Activity top has embedded equivalent | Shared screens | Embedded shared Activity role | Embedded shared Activity role | KEEP |
| Route picker | local sheet implementations | Similar role, duplicated | Local | Local | P2 REFACTOR INTO SHARED; not required for this minimal pass |
| Permission denial | `PermissionDeniedModal` | Shared transient family | Yes | Yes | KEEP |
| Too short | `TooShortSheet` | Shared transient family | Yes | Yes | KEEP |
| Unfinished recovery | `UnfinishedRecoveryModal` | Shared transient family | Yes | Yes | KEEP |
| Hike finish | `StopSummarySheet` | Activity elevated role | Yes | No | SIMPLIFY within existing host; keep trace summary |
| Run finish | local save-name sheet | Activity elevated role | No | Yes | ALIGN finish-intent language and layering; keep mode-specific content |
| Activity Detail destination | shared navigation contract | Trails/History family | Yes | Yes | KEEP |
| Map shell/trace/readiness | `HikingMap` with activity variant | Map-led product family | Yes | Yes | KEEP; no tracking/map-authority change |

## Shared Activity product contract

Hike and Run are modes of one Activity system. They already share:

- exclusive Ready → Starting → Tracking → Paused → Finishing/Recovery presentation;
- the same tracking-store authority and state adapter;
- one native map owner across pre-start and recording;
- ranked stats and a lifecycle action tray;
- GPS/readiness vocabulary and sustained health presentation;
- permission, too-short, unfinished-recovery, completion destination, and Activity Detail concepts;
- route trace casing, gap isolation, recenter behaviour, and three-theme map chrome.

They should share material, spacing, type, control geometry, sheet hierarchy, and lifecycle behaviour. They should differ through information priority:

- **Hike:** route/world first; distance travelled is the lead journey measure, with active time and elevation gain supporting it. Full Plant remains an intentional exploration action.
- **Run:** movement first; live pace is the lead measure, with distance and active time supporting it. Quick Cairn remains the current mode-specific capture action.

## Current Hike audit

### One-second hierarchy

1. **What must be understood:** recording state, where the user is/has gone, the accumulated journey, and whether location is healthy enough to continue.
2. **Primary visual object:** the map/trace environment. On Web the truthful fallback replaces the unavailable native map.
3. **Primary action:** Pause while recording; Resume while paused; Start before recording.
4. **Secondary:** Plant and Finish; recenter appears only after follow is broken.
5. **Competition:** two separate top surfaces, a bottom dock, status chips, and fallback card. The current shared pass is restrained, but Hike's large Active Time competes with its exploration purpose.

### Product fit

- **Feels like Cairn:** calm map-first composition, forest/mineral materials, fine borders, restrained controls, safe neutral Finish, three-theme continuity, explicit paused boundary, and truthful map fallback.
- **Generic map/GPS residue:** generic Mountain glyph and engineering phrases such as “route truth,” “accepted GPS,” and “GPS evidence.”
- **Generic fitness residue:** Active Time is the largest live number. That prioritises duration over the journey through place and makes Hike read more like a workout timer.
- **Material hierarchy:** largely correct. Header/metrics/dock are standard-to-elevated map chrome, with modal/sheet transients above them. No inappropriate Auth scenery is used.
- **Locally invented components:** route picker and completion hosts remain local. They are visually compatible but structurally duplicated.
- **Over-carded:** historical Hike was under-authored; current Hike is not a card grid. The fallback plus three chrome groups is the upper acceptable limit. Adding more metric cards would break the ladder.
- **Over-pillified:** GPS status is a legitimate pill. Primary actions use compact buttons, not pills. No P0 issue.
- **Typography:** metric numeral treatment is strong; 9px uppercase eyebrows are dense but acceptable for the operational role. The incorrect issue is semantic priority, not font styling.
- **Spacing/radius/material:** consistent with tokens. Twenty-four-pixel local dock radii are softer than `RadiusRole.panel` and should eventually be tokenised, but are not the main disconnect.
- **Debug leakage:** Simulator UI is gated behind Debug; normal screenshots show none. Engineering vocabulary leaks even with Debug off and is a P0 copy problem.
- **Redundancy:** mode repeats in the top identity, icon, route eyebrow, and Start label; the route eyebrow should describe the row role (`ROUTE`) rather than repeat `HIKE`.
- **Visual weight:** metrics take 86px and the dock 81px; combined top chrome is about 107px. This leaves roughly 436px between the top and bottom bounds at 390×844, keeping the map dominant.
- **Glanceability:** large primary number and stable secondary row work in motion. Distance should occupy the primary slot for Hike.

### Hike lifecycle/state findings

| State | Current behaviour | Audit |
| --- | --- | --- |
| Fresh start | Map, compact top identity, route/readiness dock, Start | Correct composition; copy too internal |
| Recording | Map, ranked metrics, Pause/Plant/Finish | Correct actions; wrong lead metric; engineering hint |
| Long recording | Stable fixed-height numerals and tabular figures | Contract is sound; needs long-value QA |
| Paused | Amber border/status; Resume primary; Finish remains neutral | Clear and safe; no Start leakage |
| Sustained location issue | status + one short notice | Correct escalation concept; copy should avoid “accepted”/internal authority words |
| Background return | store-derived state reconstructs chrome | Presentation correctly follows shared authority; native continuity remains outside this visual task |
| Finish intent | Finish opens a large celebratory summary before persistence | Safe as a non-destructive first step, but “Complete”, the scenic hero, feedback card, and Share action overstate an intent state and drift toward generic fitness celebration |

**Hike verdict:** it is already a precise shared Activity shell, but its lead metric and vocabulary still make it feel like a fitness timer layered over a map rather than Cairn's exploration instrument.

## Current Run audit

### Independent one-second hierarchy

1. **What must be understood:** current pace, recording/paused state, distance/time context, and location health.
2. **Primary visual object:** pace while moving, embedded in a map-led environment.
3. **Primary action:** Pause/Resume; Start pre-recording.
4. **Secondary:** Quick Cairn, Finish, conditional recenter.
5. **Competition:** the blue identifier is controlled, but it appears in the mode icon, primary action, and cairn cue. It remains an accent rather than a full skin.

### Run-specific questions

- **Is pace prioritised?** Yes. It is the only 30px primary metric and sits first in the ranked strip.
- **Movement hierarchy:** correct. Pace → distance → active time supports a quick glance.
- **Quick glance:** good at 390×844 and 360×640. Units stay subordinate and numbers are tabular.
- **Map role:** the map remains the environment, not wallpaper; chrome leaves a large central operating area. Web fallback cannot certify native trail/label contrast.
- **Performance without sports-dashboard drift:** mostly successful. There are no rings, zones, calories, badges, splits, or motivational colour theatrics.
- **Too little shared with Hike?** No. Structure/material/state behaviour are common.
- **Too much shared?** No. Pace priority, follow-first behaviour, blue activity identifier, and Quick Cairn are meaningful differences.
- **Meaningful differences:** pace priority, follow/movement emphasis, and capture action.
- **Accidental divergence:** local route picker and save-name sheet implementation; generic Footprints glyph rather than the Cairn running pictogram.
- **Engineering leakage:** “GPS evidence” in the shared recording hint and “accepted GPS” in sustained-loss copy.
- **Action safety:** Finish is neutral and opens a naming intent surface. Paused Resume is dominant. However, the local save sheet does not clearly name the intent as Finish, and the still-mounted action dock can compete beneath it during the transition.

**Run verdict:** pace is appropriately primary and Run avoids a generic sports dashboard. Its largest family-consistency gaps are shared icon/copy issues rather than its performance hierarchy.

## Cross-product audit

| Dimension | Home | Friends | Auth | Hike current | Run current |
| --- | --- | --- | --- | --- | --- |
| Typography | Narrative, spacious | Compact list hierarchy | Centred threshold | Compact metric hierarchy; wrong semantic lead | Compact metric hierarchy; pace lead correct |
| Spacing | Large scenic breathing room | Density-capable rhythm | Broad quiet centre | Dense but token-related | Dense but token-related |
| Material | Scenic glass + few clusters | Scenic threshold → records | Opaque actions over scenery | Utility map overlay | Same utility map overlay |
| Radii | Controlled panels/buttons | Efficient records/tabs | Compact action geometry | Mostly shared; docks use local 24 | Same |
| Surface hierarchy | Environment stays visible | Page → records → modal | Environment → actions | Map → chrome → sheets | Map → chrome → sheets |
| Icon language | `CairnIcon` core | Cairn/shared operational icons | Brand mark + conventional providers | Generic mode glyph; shared operational icons | Generic mode glyph; shared operational icons |
| Active control | Restrained forest action | Tonal selected tab/action | Forest primary | Forest primary | Existing blue identifier |
| Density | Low | Medium | Low | Operational medium-high | Operational medium-high |
| Primary CTA | Enter an Activity/world | Add friend when needed | Continue/sign in | Start/Pause/Resume | Start/Pause/Resume |
| Secondary CTA | Other product actions | Requests/profile/add | Alternative providers | Plant/Finish/recenter | Cairn/Finish/recenter |
| Environment | Strong scenic invitation | Quiet human landscape | Atmospheric threshold | Mapbox geography | Mapbox geography |
| Information hierarchy | Place → invitation → action | people → requests | identity → entry | time currently outranks journey | pace → journey context |
| Motion | Quiet environmental potential | restrained state transitions | restrained | state-driven only | state-driven only |
| Colour | natural field/forest | mineral + restrained warmth | restrained natural | forest/mineral | mineral + blue activity accent |
| Empty/quiet space | Authored scenic zones | landscape/content capacity | central atmospheric quiet | useful map area | useful map area |

Exact departure points are therefore limited: generic activity pictograms, Hike's timer-first semantic hierarchy, engineering copy, and inconsistent finish-intent presentation. The Activity screens are allowed—and required—to be denser than Home/Auth.

## Activity visual role

> **Cairn Activity is the living field atlas in motion: a calm, precise instrument that keeps place, trace, and the next safe action clear.**

This keeps Hike exploration-first and Run movement-first without creating separate skins.

## Proposed shared structure

Keep the existing shared roles rather than introduce a parallel design system:

- `HikingMap` remains the shared map shell/trace authority with its Hike/Run activity variant.
- `ActivityTopChrome` remains navigation, identity, GPS state, and ranked metric host.
- `ActivityStartDock` remains route/readiness/start host.
- `ActivityControlDock` remains lifecycle/action hierarchy.
- `ActivityRecenterButton` remains conditional map-follow recovery.
- Existing permission, too-short, unfinished recovery, Stop Summary, and Run save intent surfaces retain their lifecycle consequences.

Minimal generic extensions:

1. Render Hike/Run identity through production `CairnIcon` pictograms in shared Activity chrome.
2. Make the route row label describe its role rather than repeat the mode.
3. Replace internal tracking vocabulary with calm, truthful user language.
4. Put Hike distance in the primary metric slot; preserve Run pace as primary.
5. Make Finish intent truthful and singular: remove pre-save celebration from Hike, name the Run intent explicitly, and suppress map chrome that can collide beneath either elevated surface.

No new Hike-only or Run-only visual primitive is justified.

## Prioritised findings

### P0 — product meaning / normal UX leakage

- Hike's largest live metric is Active Time, which contradicts its exploration/trace priority.
- Normal UI exposes “route truth,” “accepted GPS,” and “GPS evidence,” making implementation concepts part of the customer experience.
- Hike declares the activity “Complete” before the user confirms persistence; that is a state-truth mismatch.

### P1 — product-family coherence

- Shared Activity identity uses generic Mountain/Footprints glyphs while Home's canonical Hike/Run actions use `CairnIcon` pictograms.
- The pre-start route eyebrow repeats Hike/Run instead of explaining the interactive object.
- Hike Finish carries a giant scenic hero, feedback card, and Share action that compete with the one decision the user must make.
- Run Finish is framed as a naming task rather than a finish intent, and its underlying action dock remains visually active during the sheet transition.
- State-matrix QA does not yet capture Finish intent or deliberate long-value fixtures.

### P2 — later polish, intentionally not required for this pass

- Refactor duplicated route-picker sheet framing into a shared sheet role.
- Converge Hike Stop Summary and Run naming surface onto one shared elevated frame if a later pass can do so without flattening Hike's trace summary or changing lifecycle behaviour.
- Tokenise the 24px Activity dock radius if cross-screen evidence supports changing `RadiusRole`.
- Native field review remains necessary for Mapbox labels/trails, route casing, puck, recenter, sunlight, and touch reachability.

## Implementation direction and non-goals

Implement the five shared/content corrections above, extend the focused source-contract test, and extend reproducible Web QA to include long-value, degraded-location, and Finish-intent states. Preserve Home, Friends, Auth, all map/GPS/tracking code, Activity Detail, lifecycle state semantics, action consequences, and theme tokens.

Do not add scenery, fitness rings, extra metrics, saturated persistent danger, new confirmation layers, decorative motion, page-local colours, or a second Activity design system.
