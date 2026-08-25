# CairnNZ Visual DNA

**Status:** APPROVED — GATE 0 LOCKED
**Established:** 2026-08-24
**Applies to:** all future CairnNZ visual design, asset generation, UI refinement, and visual QA

## Authority and use

Future visual work must begin here. This document defines the system that screens and assets derive from; it must not be reverse-engineered anew from whichever screenshot was generated most recently.

When this document conflicts with older visual claims in `VISUAL_SYSTEM.md`, `VISUAL_MIGRATION_STATE.md`, or `VISUAL_NORTH_STAR_LOCK.md`, this document governs future visual work after Gate 0 approval. Those older files remain evidence of earlier decisions and implementation history. Product behavior, accessibility, platform constraints, and explicitly approved later system-level decisions still take precedence.

The governing direction is:

> **Visual DNA → product role → screen/state expression → production asset → rendered mobile QA.**

Never reverse that sequence into “latest screenshot → newly inferred visual system.”

## Product meaning

CairnNZ is an exploration and memory product before it is a fitness tracker. Its experiential order is:

1. World and exploration
2. Personal memory and accumulated journey
3. Quiet human traces and friends
4. Activity record
5. GPS and map operations
6. Settings and maintenance

Home creates desire. Memory proves that movement mattered. Friends makes the world feel quietly inhabited. Activity, Trails, and maps help the user act precisely inside that same product world.

## Visual north star

> **A modern, premium, believable New Zealand world that places the user inside living outdoor environments and makes movement feel inviting, consequential, and quietly connected to other people.**

The visual method is:

**Believable environmental realism**
plus
**editorial atmospheric direction**
plus
**subtle exploration-world authorship**.

The first impression should be real. The second should be refined and intentionally art-directed. Over time, routes, revealed terrain, memories, cairns, and human traces should make the world feel personally meaningful. AI may be a production method; obvious AI rendering must never become the visible style.

---

# Level 1 — Locked Core DNA

These principles are system-level. They do not drift between screens, weather states, Day/Night, or future features unless an explicitly approved system-level decision changes them and records that change in `CAIRNNZ_VISUAL_DNA_CHANGELOG.md`.

## 1. Presence

The user should feel physically situated in the product world, not detached from it.

- Scenic viewpoints use a human-height, forward-facing relationship when the screen represents being outdoors.
- Terrain recedes away from the user rather than pushing toward the camera.
- Maps and utility screens create presence through geographic clarity, scale, responsive materials, and traces—not by forcing scenic imagery behind them.
- Avoid drone views, scenic overlooks, high downward pitch, and compositions that turn the user into a spectator.

**System test:** Does the screen make the user feel “I am here,” rather than “I am looking at this”?

## 2. Forward exploration

The product should imply somewhere worth going.

- Scenic space opens from near environment to broader midground and a legible destination.
- Trails, routes, revealed terrain, water edges, vegetation openings, and perspective may carry the movement axis.
- Forward movement may be implied; it need not be a literal uninterrupted path.
- Avoid blocked destinations, narrow slits between heavy terrain, game-like quest lines, and paths manufactured around UI coordinates.

**System test:** Can the eye travel naturally into the experience?

## 3. Living New Zealand

New Zealand identity comes from ecologically and geographically believable combinations of:

- Mountains and terrain scale
- Water and moisture
- Healthy land
- Native or native-like vegetation structure
- Track character
- Geology and mineral materials
- Clean, changeable atmosphere
- Natural daylight

New Zealand is not synonymous with barren high-country. Treeless terrain can be authentic, but the primary product world must still communicate ecological life, walkability, and emotional invitation at phone scale.

Avoid generic European alpine meadows, Swiss postcard peaks, North American pine wilderness, Australian dry scrub, tropical fantasy, and tourism-symbol shortcuts.

## 4. Quietly alive

The world contains life without behaving like game scenery.

- Biological vitality must survive at 390×844 through large and medium ecological forms, not microscopic texture alone.
- Environmental motion, when used, is low-amplitude, asynchronous, and secondary to the static image.
- Human presence is communicated through routes, marks, cairns, revealed terrain, and quiet traces—not crowds, feeds, status theater, or gamified collectibles.

**System test:** Does the place feel alive before it feels animated or decorated?

## 5. Natural premium

Premium quality comes from composition, ecology, light, atmospheric depth, material behavior, typography, precision, and restraint in focal elements.

Premium does **not** mean:

- Muted everything
- Dark everything
- Desaturated ecology
- Empty scenery
- Opaque luxury surfaces
- Black/gold treatment
- Glossy glassmorphism
- Cinematic spectacle

Life, desire, weather readability, and physical presence must never be sacrificed to manufacture “premium.”

## 6. Weather without discouragement

Weather changes how exploration feels, not whether it feels worthwhile.

- Sunny is bright and energizing, not merely high exposure.
- Cloudy is soft, dimensional, and fresh—not gray and dead.
- Rain is wet, alive, and atmospheric—not a storm warning or depression filter.
- Snow is crisp, spatial, and reflective—not lifeless white or blue-black.
- Night is calm, layered, and navigable—not near-black or dark green recoloring.

Authenticity remains important. The system does not pretend all conditions are Sunny; it finds the attractive, truthful qualities inherent in each condition.

## 7. Real environment, not tourism poster

The world should feel experienced rather than staged.

- Prefer asymmetric spatial rhythm, imperfect shorelines, natural track behavior, ecological transitions, and continuation beyond the frame.
- Avoid centered mountain + centered water + perfect path compositions.
- Avoid giant hero peaks, mirrored water, excessive HDR, magical rays, perfect cloud placement, and generic adventure-advertising polish.
- Beauty must remain physically believable and reachable.

## 8. New Zealand identity without cliché

Use ecology, geology, water, track surface, atmosphere, and light. Do not use flags, kiwi symbols, giant silver fern motifs, decorative Māori patterns, Hobbit/LOTR styling, or other tourist shorthand to announce place identity.

Respectful cultural specificity requires real product and cultural decisions; it must not be improvised as decoration.

## 9. Environmental UI

The interface exists inside the world. The environment is not wallpaper behind pale cards, and the UI does not erase the environment.

- Compose imagery and interface zones together.
- Use natural negative space, controlled local luminance, environmental tint, restrained translucency, fine borders, and localized blur or scrims where needed.
- Preserve stable readability, hit areas, accessibility, and functional hierarchy.
- Scenic materials may reveal the environment; utility surfaces may be denser. Transparency itself is not the goal—environmental integration is.
- Avoid opaque scenic slabs, pale milky blocks floating over photographs, and indiscriminate glass effects.

## 10. Memory and quiet human traces

Movement gradually changes the meaning of the world.

- Personal routes, revealed terrain, repeated journeys, memories, and cairns accumulate consequence.
- Other people’s traces remain quieter and slightly more mysterious than personal traces.
- Cairns are evidence of presence, not generic pins, mascots, prizes, or quest markers.
- Social expression stays low-noise and asynchronous; CairnNZ must not become a conventional social network.

## 11. Modern restraint and mature craft

The product is modern, precise, calm, and emotionally warm without becoming cute, rustic, retro, game-like, or generic SaaS.

- Typography is editorially composed but operationally clear.
- Icons are mature, compact, and optically consistent.
- Controls may have large touch targets without visually oversized glyphs.
- Illustration is permitted where a product role benefits from it, but must retain believable material, light, and maturity.

## 12. Static completeness

Every screen and environment must be visually complete without motion. Animation, network content, map tiles, and high-end device capabilities are enhancements, never prerequisites for core readability or visual quality.

---

# Level 2 — Derived System Rules

The Locked Core DNA remains constant. Its visual expression adapts to the product role below.

## Auth — threshold

**Primary role:** enter CairnNZ calmly and credibly.

Auth contributes believable realism, atmospheric softness, restrained exposure, natural color, quiet interaction zones, and comfortable UI/background integration. It is a useful compatibility reference, not the universal master composition. Auth does not need to carry the full memory/trace system and currently requires no Day/Night variant.

## Home — invitation

**Primary role:** make the user want to go outside.

- Home may carry the strongest full-screen environmental presence.
- The user should feel human-height presence, a natural way forward, living ecology, open distance, and desirable weather.
- The landscape and fixed interface must read as one authored composition.
- Actions, activity information, and navigation remain stable and readable without terminating the scenery.
- The complete 390×844 production composition is the authority, not the isolated background.

### Home success hierarchy

Readability, accessibility, usable touch targets, correct navigation behavior, functional state clarity, safety-critical interaction, and approved product behavior are **hard constraints**. They are not lower-priority visual trade-offs. A visually desirable Home fails automatically if it compromises any of them.

The hierarchy below ranks visual success only after those functional constraints are satisfied. “UI integration” appearing seventh does not permit scenery to weaken usability, accessibility, state clarity, navigation, safety, or behavior.

1. Desire to go outside
2. Living environment
3. Forward exploration
4. New Zealand identity
5. Believable realism
6. Premium execution
7. UI integration
8. Technical polish

Technical refinement cannot compensate for failure in the first three levels.

## Weather — experiential transformation

Weather changes light, atmosphere, moisture, material response, ecological behavior, and emotional cadence while preserving exploration desire. Weather is not a global color grade and must not replace the Home geography.

See “Home canonical world” and “Eight Home states” below.

## Day and Night — one world under different illumination

Day and Night preserve product identity, component geometry, icon geometry, spatial hierarchy, terrain, and core content. They may transform:

- Environmental illumination and sky
- Luminance distribution
- Surface density and translucency
- Edge highlights, borders, and shadows
- Accent luminosity and semantic contrast
- Reflections and atmospheric depth

Day is not simply cream surfaces. Night is not simply green surfaces. Scenic, utility, map-led, and transient screens express the same time system differently according to their role.

## Memory — consequential exploration

**Primary role:** prove that going outside mattered.

- Geography remains precise and operational.
- Explored terrain gains clarity, material richness, and personal priority.
- Unexplored terrain remains geographically understandable but unresolved.
- Personal routes and repeated journeys accumulate visible history.
- Cairns and other people’s traces are evidence, not collectible pins.
- Avoid fantasy fog-of-war, neon reveal effects, game HUDs, vintage cartography, and copying Home scenery onto the map.

Memory should become a flagship derivation from the DNA. Its final visual language is not yet fully locked.

## Friends — quiet human presence

**Primary role:** show that other people have passed through the same world.

- Do not present Friends as a social feed or high-frequency network.
- Use an environmental threshold, atmospheric transition, trace motifs, calm density-capable content surfaces, and warm human detail.
- Populated states must remain usable with realistic list density and varied names.
- Empty states may be more atmospheric, but should not become cute mascot scenes.
- Friends does not need a full Home-style scenic background. Its final derivation remains open to future validation.

## Activity, Hiking, and Running — operational movement

**Primary role:** support safe, legible recording and navigation.

- Map, route, status, metrics, GPS state, and primary controls take precedence over environmental impact.
- Use the shared typography, mature icon character, materials, Day/Night logic, and trace language.
- Operational states must remain readable in sunlight, low light, motion, and stress.
- Outdoor-important controls may receive larger hit targets; the entire interface must not become visually oversized.
- Do not place Home scenery behind Mapbox-led workflows.

## Trails — route and record utility

**Primary role:** browse and manage routes, activities, flags, and records.

- Information hierarchy, filters, lists, tabs, and empty/loading states dominate.
- Use restrained environmental cues or illustrations only where they aid meaning.
- Preserve the shared materials, spacing rhythm, icon maturity, and Day/Night system.
- Do not compete with content using a cinematic background.

## Settings — maintenance inside the same product

**Primary role:** calm, precise configuration.

- Inherit typography, materials, colors, icon maturity, control scale, spacing, and Day/Night relationships.
- Settings does not require a full scenic identity.
- Surface hierarchy and form clarity outrank atmosphere.
- Avoid generic SaaS drift, unrelated greens, and decorative scenery that reduces scanability.

## Utility, modal, sheet, dialog, and form screens

- Standard surfaces organize persistent content.
- Elevated surfaces establish temporary hierarchy.
- Scrims create focus without making the app feel blacked out.
- Fields, validation, disabled states, errors, loading, confirmations, and recovery states use shared semantic roles in both Day and Night.
- Functional state must be obvious through more than color alone.
- Transient UI should feel like the same material family as its parent screen, at a higher elevation—not a separate theme.

## Empty, loading, error, offline, and recovery states

- Preserve product role and emotional tone while explaining the state plainly.
- Empty states should indicate what can happen next without inventing decorative product features.
- Loading states should retain spatial stability and avoid blank flashes.
- Errors and offline states should remain calm but unmistakable; never bury severity in atmospheric styling.
- Recovery and permission states prioritize safety, clarity, and actionability over scenic expression.

## Navigation

- Navigation should feel integrated with its environment and screen role.
- Scenic navigation uses stable, restrained environmental material with visible depth; it must not terminate scenery as an opaque slab.
- Utility navigation may be denser and more neutral.
- Icon identity and label hierarchy remain stable across Day/Night.
- Navigation visibility and structure are product-behavior decisions. Visual work must preserve the currently approved behavior unless a product-level Gate explicitly authorizes a change.
- Visual design must not hide, add, relocate, or reinterpret navigation or screen hierarchy merely to improve composition. The DNA governs how navigation looks and integrates visually; it does not independently decide whether navigation exists on a screen.

## Iconography

The target character is mature modern wayfinding with cartographic/humanist detail:

- Compact, precise, calm, and optically balanced
- Mostly outline where appropriate, with purposeful small fills
- Refined terminals, controlled asymmetry, and meaningful negative space
- Same geometry across Day/Night; semantic contrast changes
- Active states add information or a restrained field, not only thicker/greener strokes
- Familiar operational symbols remain conventional where clarity matters

**Status:** final functional icon system is open. Gate 1 and Gate 2 sheets are evidence, not a final lock. Do not default automatically to Lucide, another generic library, or raw raster generation.

## Materials

Use three distinct roles:

1. **Scenic material:** integrates controls with environmental screens while preserving place and depth.
2. **Standard surface:** organizes persistent cards, lists, fields, and sections.
3. **Elevated surface:** creates clear temporary hierarchy for sheets, modals, dialogs, and critical overlays.

These roles may share color ancestry but are not one opacity token. Final numeric tokens—especially Night—remain open until rendered cross-screen validation.

## Typography

- Maintain a modern, restrained, precise, editorially composed character.
- Narrative/exploration statements use breathing room and controlled scale.
- Metrics and data use compact hierarchy and stable numeral alignment.
- Section labels and navigation remain quiet, readable, and consistent.
- Avoid rustic “atlas” typography, retro display faces, game styling, excessive boldness, oversized SaaS headings, and decorative identity theater.
- The final font stack and detailed scale may evolve only through a cross-screen system decision.

## Motion

**Primary philosophy:** Do not make Home feel animated. Make the world feel quietly alive.

For the currently approved **Sunny** motion concept, the provisional short-term perceptual hierarchy is:

**Water > cloud > vegetation.**

This hierarchy is not automatically inherited by Cloudy, Rainy, Snowy, or Night. Each weather/time state must derive and validate its own restrained motion behavior in the relevant Home Gate. Rain might conceptually emphasize moisture and water response; Snow might emphasize atmosphere, sparse snow movement, and stillness; Night might require less movement. These are examples only, not locks. Weather-specific motion remains open.

- Motion begins on the first visible frame; no delayed static hold.
- Within roughly 1–2 seconds, the user should subconsciously perceive environmental life without focusing on the animation technique.
- Water may use continuous micro-variation, restrained reflection change, or tiny ripple behavior.
- Clouds may drift slowly and continuously with natural, non-repetitive change.
- Vegetation responds irregularly, occasionally, and at very low amplitude in selected exposed areas.
- Channels must not share timing or loops.

Prohibited by default:

- Camera movement, pan, zoom, or Ken Burns effects
- Strong parallax or layered wallpaper motion
- Full-screen animated-wallpaper feeling
- Obvious synchronized loops
- Entire-tree or field-wide swaying
- Explicit bird animation as ambient life
- Full-screen video as the default architecture
- Motion required for readability or emotional completeness

If motion reduces calmness, premium quality, battery life, or clarity, static wins.

## Power and performance

CairnNZ is an outdoor mobile app. GPS, Mapbox, networking, and high screen brightness already consume power. Ambient motion must remain lightweight.

Preferred future architecture:

> **Static canonical background + small isolated motion layers.**

Requirements:

- Render the static canonical asset immediately.
- Pause motion when Home is not visible or the app backgrounds.
- Respect Reduce Motion.
- Consider Low Power Mode handling when technically practical.
- Run and decode only the active weather’s motion layers.
- Do not keep every weather animation resident.
- Avoid unnecessary full-screen redraw, heavy blur/shader stacks, and unconditional 60fps work.
- Benchmark decode time, memory, frame pacing, battery impact, and transition behavior before production lock.
- Preserve the static asset as the deterministic fallback on slow or constrained devices.

Motion is optional enhancement. If its cost is disproportionate or static looks more premium, static wins.

---

# Level 3 — Instance Variables

DNA is fixed; expression can change. The following may vary when the product role and canonical-world constraints permit:

- Exact mountain silhouette, height rhythm, and geology
- Water type: lake, river, inlet, bay, stream, or no water where appropriate
- Tree species impression, placement, grouping, and framing
- Trail location, curvature, width, surface, and visibility
- Vegetation distribution and ecological transitions
- Cloud configuration and sky pattern
- Rain intensity, mist, wetness, and water behavior
- Snow depth, distribution, and exposed life
- Exact decorative ecology and non-focal wildlife evidence
- Amount of scenery and atmospheric intensity by screen
- Screen-specific negative space and environmental framing
- Surface density and information density
- Illustration intensity
- Map dominance and operational emphasis
- Exact crop for supported device classes, provided the intended composition survives

Changing an instance variable must not weaken presence, forward exploration, living ecology, NZ specificity, desirability, functional hierarchy, or the applicable canonical-world rule.

---

# Current Sunny — First Successful Approved Proof

The current strongest Sunny is the first successful approved proof of this Visual DNA:

- Native proof: `app/assets/home/prototypes/final-nz-world-sunny/refinement-3/sunny-refinement-3-native.png` (851×1848)
- Delivery preview: `app/assets/home/prototypes/final-nz-world-sunny/refinement-3/sunny-refinement-3-delivery.jpg` (1170×2532)
- Complete Home UI proof: `docs/qa/visual-north-star/sunny-world-reauthor/refinement-3/static-home-390x844.png`
- Standalone motion QA: `docs/qa/visual-north-star/sunny-world-reauthor/refinement-3/micro-motion-preview.html`

It demonstrates:

- Human-height presence and a forward-facing relationship
- A natural trail leading toward an open destination
- A mountain–water–green-land relationship without dominant barren high-country
- Healthy biological vitality that survives at phone size
- Visible trees and native-like bush structure without a forest wall
- Bright Sunny daylight and comfortable warm/cool balance
- Believable New Zealand character without literal symbols
- Strong walkability and desirability
- Environmental coexistence with the current fixed Home UI

It remains a **proof**, not the DNA itself and not yet a production integration decision. Other screens inherit its principles; they must not copy its exact lake, mountains, tree, trail, or composition. Home weather/time variants are the exception: once Gate A1 approves Sunny as the production canonical Home geography, they must preserve same-world continuity.

---

# Home Canonical World

The eight Home states must feel like the same CairnNZ world experiencing different conditions—not eight unrelated New Zealand wallpapers.

Preserve where practical:

- Camera height, lens relationship, and viewing direction
- Major terrain and world opening
- Trail geometry and movement axis
- Main water body and shoreline logic
- Major tree and vegetation groups
- Mountain structure and environmental scale
- Fixed interface quiet zones and production crop

Transform by condition:

- Light direction, luminance, and shadow softness
- Sky, clouds, and atmospheric depth
- Wetness, reflection, rain, mist, and water behavior
- Foliage response and surface saturation
- Snow coverage and surface transformation
- Temperature perception and night illumination

Semantic generation/editing must preserve geography. Color grading alone is not a weather transformation; unrelated scene generation is not a family.

# Weather System

**Hard rule: weather should change experience, not remove exploration desire.** Every condition must remain worth opening the app to see. This does not mean making every state Sunny; it means using the truthful attractive qualities of each condition—diffuse softness, wet ecological richness, reflective snow clarity, or calm night depth—without erasing geography, life, or the wish to explore.

## Eight Home states

### 1. Sunny Day — desire

Bright, living, fresh, and highly desirable. Clear late-morning or early-afternoon daylight, visible sunlit environmental planes, healthy green land, comfortable sky, and open distance. No requirement for an in-frame sun disk.

### 2. Cloudy Day — calm freshness

Soft diffuse daylight, dimensional layered cloud, alive greens, clear geography, and breathable depth. Cloud does not mean dark; the world should feel calm and walkable.

### 3. Rainy Day — wet life

Visible rain or moisture, richer plants, wet stone and track material, changing water, low cloud, and atmospheric depth. Avoid storm-warning drama, muddy darkness, or gray depression.

### 4. Snowy Day — crisp transformation

Bright, reflective, spatial, and exploratory. Snow transforms surfaces while preserving terrain depth, vegetation evidence, track logic, and environmental life. Avoid flat white, dull gray, or lifeless blue treatment.

### 5. Sunny Night — clear calm

The same clear world after sunset: readable terrain, calm sky, water and trail continuity, cool mineral atmosphere, restrained natural highlights, and inviting depth. No fantasy moonlight or near-black luxury treatment.

### 6. Cloudy Night — soft layered night

Slate and blue-gray atmospheric light, softened distance, readable terrain, and navigable spatial layers. Cloud cover may reduce contrast without erasing the world.

### 7. Rainy Night — reflective atmosphere

Wet reflection, surface response, rain/mist depth, and quiet environmental luminosity make the world visually interesting. Avoid black storm imagery, opaque green UI, or lost geography.

### 8. Snowy Night — reflected visibility

Snow naturally lifts ambient visibility and separates terrain. Preserve quiet clarity, trail and mountain depth, and restrained cool-neutral color. Avoid dead blue-black snow or fantasy glow.

---

# Night System

**Hard rule: Night is not a dark filter.** It is the same physical world under different illumination.

Night must preserve terrain readability, water, tree silhouettes, trail logic, atmospheric depth, and distant layers. Its material foundation should draw from charcoal, slate, cool mineral neutral, and restrained blue-green. Sage and green identify CairnNZ as accents; they do not become every background, card, panel, navigation surface, sheet, or modal.

Use layered material density, controlled transparency, fine edge highlights, readable neutral text, restrained accents, and environmental visibility. Avoid deep-green overlays, black slabs, green-everything UI, neon, black/gold luxury, and environment disappearance.

Exact Night token values and cross-screen material density remain open until Gate A3/A4 and later system validation.

---

# Lessons from Rejected Directions

Rejected work is evidence. Do not erase or cosmetically reinterpret these failures.

| Failure | Why it failed | System lesson |
|---|---|---|
| Elevated or downward-looking camera | Produced an attractive overlook but made the user a spectator | Scenic Home presence begins near human eye height and faces forward |
| Alpine-basin composition | Enclosing ridges and heavy mountain mass made the world austere and observational | Home must open away from the user and prioritize a reachable living world |
| Terrain closing toward the viewer | Convex foreground/midground geometry visually pushed back at the user | Build a widening spatial corridor with a legible destination |
| Narrow distant opening | Suggested containment rather than continuation | Preserve broad distance and somewhere worth going |
| Dominant tawny/yellow high-country | Read as dry, seasonal, or semi-arid at phone scale | Use ecological balance; golden tussock is supporting variation, not the ground identity |
| Dead-looking tussock and repeated low vegetation | Technically contained plants but perceived as barren texture | Life must survive as recognizable large and medium forms at 390×844 |
| Dark blue Sunny sky | Made “Sunny” technically plausible but emotionally subdued | Sunny needs luminous sky and visible daylight response, not merely blue color |
| Global blue/cyan grading | Created cold fatigue and emotional distance | Let sky, water, and distance own cool color; keep vegetation, soil, rock, and shadows locally natural |
| Removing water to solve blue dominance | Reduced freshness, ecology, reflection, and destination value | Control color ownership instead of deleting life-giving elements |
| Removing trees to preserve openness | Produced visually bald or generic high-country | Use side framing and irregular groups; trees can add life and scale without becoming a wall |
| Tiny fern, moss, shrubs, or beech | Disappeared after mobile scaling and did not change the emotional read | Design ecological hierarchy for phone size, not native-resolution inspection |
| Muted/desaturated treated as premium | Produced dry, lifeless, emotionally weak worlds | Premium comes from craft and control, not deprivation of life or color |
| Technically walkable but emotionally undesirable scene | A readable path solved navigation but not desire | Judge walkability and desirability separately; Home must pass both |
| V1→V2→V3 local optimization | Camera, trail, texture, and glass improved while the emotional category stayed austere | Re-evaluate the whole environment type when local improvements do not change desire |
| Over-preserving rejected geography | Each revision inherited the original basin’s emotional weakness | Preserve DNA, not a failed composition |
| UI-first empty zones | Blank or controlled terrain weakened ecology and depth | Author natural quiet zones with atmosphere, frequency, and local material treatment |
| Deep-green Night recoloring | Read as an app theme rather than outdoors after sunset | Night foundations are neutral/mineral; green is an accent |
| Opaque Night/scenic surfaces | Hid the environment and flattened depth | Use distinct scenic, standard, and elevated material roles |
| Large or mound-like cairn | Collapsed into a cone, brown mound, or unintentionally comic silhouette | Cairns must use distinct slab geometry and phone-scale separation, or be omitted |
| Centered mountain + water + perfect trail | Approached a tourism poster rather than an inhabited world | Use asymmetry, imperfect transitions, and spatial continuation |
| Generic tourism advertising | Looked staged, implausibly perfect, and externally observed | Prefer reachable realism, ecological coherence, and human presence |
| Swiss, North American, or Australian drift | Lost specific New Zealand ecology, track, moisture, and terrain relationships | Build NZ identity through coherent local environmental cues, not generic mountains |
| Excessive wildlife or flowers | Turned life into decoration and increased postcard/AI risk | Biological life should come primarily from the ecosystem; focal additions must earn their place |
| AI-looking clouds | Repetition, smooth gradients, or painterly shapes exposed the production method | Require irregular scale, plausible illumination, and real atmospheric variation |
| Over-smoothed terrain and repetitive AI vegetation | High-resolution detail collapsed into synthetic cellular texture | Prioritize large/medium landform and ecological structure before microtexture |
| Strong camera or parallax motion | Produced game/wallpaper behavior and displaced the user | The camera stays still; only isolated environmental elements may move |
| Full-screen animated background | Threatened calm, battery, decode cost, and static completeness | Use a static canonical base with small optional motion layers |

### Historical interpretation

The early Gate 1/2 alpine-lake work produced valuable principles—same-world continuity, environmental UI, Memory consequence, quiet Friends presence, and Day/Night identity—but its Home geography is no longer a composition mandate. The later Sunny V1/V2/V3 and dry Living Valley results demonstrated that technical improvement and continuity can preserve an emotionally wrong environment. This is why the DNA now locks experiential properties rather than a rejected mountain silhouette.

---

# Mobile-First Evaluation

The reference viewport is **390×844**. Important visual judgments must use the complete mobile frame with safe areas, UI, navigation, and production crop.

- Large and medium structure outrank microtexture.
- Trees, trail, biological life, weather, water, and depth must remain perceptible without zooming.
- Inspect native assets for quality, but never approve them without phone-scale evaluation.
- For Home, the complete UI composition is the final authority.
- A candidate that is beautiful in isolation but weaker behind the real UI fails.

## Visual success hierarchy by role

For Home, use the hierarchy listed above. For functional screens, usability, safety, state clarity, and operational precision may move above environmental impact. The Locked Core DNA still applies, but it must support rather than compete with the task.

Across all roles, distinguish:

- Technical compliance from perceptual success
- Walkability from desirability
- Weather recognition from emotional discouragement
- Realism from generic stock-image plausibility
- Premium restraint from lifelessness

---

# Mandatory Checklist for Future Visual Sessions

- [ ] Read `docs/CAIRNNZ_VISUAL_DNA.md`
- [ ] Identify the product role of this screen or state
- [ ] Identify which DNA rules are immutable
- [ ] Identify which instance variables may change
- [ ] Read relevant Gate decisions in `docs/CAIRNNZ_VISUAL_ROADMAP.md` and the changelog
- [ ] Do not infer the entire visual system from the latest screenshot
- [ ] Preserve known rejected-pattern lessons
- [ ] Evaluate at 390×844
- [ ] Check desirability, not only technical compliance
- [ ] Check New Zealand specificity without cliché
- [ ] Check environmental life at phone scale
- [ ] Check UI readability, product functionality, and state clarity
- [ ] Compare the complete screen, not only the isolated asset
- [ ] Record genuinely new approved system decisions in the changelog

---

# Open / Not Yet Fully Locked

Do not fake certainty on these topics:

- **Final functional icon system:** Gate 1/2 explorations exist, but the mature production family remains unapproved.
- **Exact Night material tokens:** foundation and prohibited patterns are locked; numerical colors, density, blur, border, and elevation await cross-screen proof.
- **Exact production motion implementation:** the standalone Refinement 3 HTML proves a perceptual idea, not a React Native architecture.
- **Battery and frame-rate budget:** benchmark targets, refresh cadence, decode cost, and Low Power Mode behavior remain provisional.
- **Weather-specific micro-motion:** only the Sunny hierarchy has been prototyped; other conditions require their own restrained behavior.
- **Final Home production integration:** Refinement 3 is the strongest proof, but Gate A1 has not occurred.
- **Final canonical eight-state assets:** same-world and emotional rules are locked; the family has not been derived from the new Sunny world.
- **Memory derivation:** product role and principles are locked; final visual design is open.
- **Friends derivation:** product role and principles are locked; final populated/empty architecture remains open to validation.
- **Cross-screen transition language:** continuity principles are known; exact transitions and motion remain open.
- **Detailed typography scale and font decision:** character is locked; full production scale is not.
- **Detailed scenic/standard/elevated tokens:** material roles are locked; exact values remain open.
- **Brand-grade cairn form:** failure conditions are known; a recurring production symbol is not yet approved.

Mark uncertain evidence **PROVISIONAL**. Do not convert one successful generated result into a system lock without cross-screen proof and explicit approval.

## Evidence base

This document was extracted from, and should be checked against:

- `docs/VISUAL_SYSTEM.md`
- `docs/VISUAL_MIGRATION_STATE.md`
- `docs/VISUAL_ASSET_MANIFEST.json`
- `docs/VISUAL_NORTH_STAR_LOCK.md`
- `docs/qa/visual-migration/final/`
- `docs/qa/corrective-runtime-2026-08-22/`
- `docs/qa/visual-north-star/gate1/`
- `docs/qa/visual-north-star/gate2/`
- `docs/qa/visual-north-star/sunny-v2/`
- `docs/qa/visual-north-star/sunny-v3/`
- `docs/qa/visual-north-star/sunny-world-reselection/`
- `docs/qa/visual-north-star/sunny-world-reauthor/`
- `app/assets/home/challengers/`
- `app/assets/home/prototypes/`

The changelog records why later evidence superseded earlier composition locks without erasing their useful system lessons.
