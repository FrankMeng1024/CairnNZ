# CairnNZ Visual North Star Lock — Gate 1

STATUS: LOCKED FOR GATE 2  
CHAMPION: Candidate B

## Locked visual DNA

- **North star:** a modern, premium, believable New Zealand exploration world where movement creates memory, routes, cairns, personal history, and quiet traces of other people.
- **Environmental character:** believable realism first; restrained editorial atmosphere second. Natural texture, fresh air, asymmetric place-specific composition, controlled color, and useful quiet zones. AI may produce assets but must not be visible as a style.
- **Canonical Home world:** Candidate B — asymmetric high-country lake, off-axis trail, discovered foreground cairn, schist/tussock material, calm sky, and preserved interface zones. Day and Night are the exact same physical place.
- **Home composition:** environment and UI are authored together. Local atmosphere and translucent scenic materials establish hierarchy; no wallpaper-plus-opaque-card composition. Scenery remains perceptible through bottom navigation.
- **Memory:** explored terrain gains clarity and a restrained personal trace; unexplored terrain stays geographically legible under a cool mineral veil. Cairns are evidence, not collectible pins. Avoid fantasy fog, neon, HUD language, and vintage cartography.
- **Friends:** quiet human presence, not a social network. Use a restrained environmental threshold that resolves into a calm, density-capable content canvas; continuity comes through atmosphere, typography, trace motifs, and materials rather than a full scenic wallpaper.
- **Typography:** Inter remains the precise base. Narrative statements use spacious composition and controlled scale; data uses compact, tabular-feeling hierarchy. Avoid rustic, retro, game, and generic oversized SaaS typography.
- **Icon DNA:** modern precision wayfinding plus cartographic/humanist curvature. Compact outline geometry, controlled asymmetry, refined terminals, useful negative space, and small semantic fills for active states. Day/Night preserve geometry.
- **Day/Night:** one product at two environmental times. Night changes light, luminance, material density, edge highlights, and semantic contrast—not icon identity or component geometry. Charcoal, slate, cool mineral, and desaturated blue-green are foundations; green is an accent.
- **Materials:** scenic glass preserves environmental presence; standard surfaces organize content; elevated surfaces establish temporary hierarchy. These are distinct roles, not one opacity token. Avoid opaque green slabs and generic bright glassmorphism.
- **Exploration/trace:** routes, revealed terrain, cairns, and shared traces should accumulate meaning quietly. Never turn them into quests, collectibles, or social metrics.
- **Control scale:** default visuals are compact and refined; hit areas may be larger than visible glyphs. Future Outdoor Mode may selectively enlarge operational controls only.

## Prohibited patterns

Generic perfect valleys, centered postcard symmetry, HDR, orange/teal grading, fantasy night, black/gold luxury, green-everything Night, opaque scenic navigation slabs, glossy AI art, mobile-game HUDs, parchment/sepia atlas skins, decorative contour lines, oversized controls, mixed generic icon families, and scenery copied indiscriminately across utility screens.

## Adaptive expression

By screen, Gate 2 may vary scenery amount, atmosphere intensity, surface density, information density, illustration intensity, operational emphasis, and map dominance. Future screens must extend this DNA; they do not need identical backgrounds, opacity, or visual intensity.

## Champion references

- Home Day asset: `app/assets/home/gate1/home-world-b-day-master.png`
- Home Night asset: `app/assets/home/gate1/home-world-b-night-master.png`
- Home Day proof: `docs/qa/visual-north-star/gate1/champion/home-day.png`
- Home Night proof: `docs/qa/visual-north-star/gate1/champion/home-night.png`
- Memory proof: `docs/qa/visual-north-star/gate1/champion/memory.png`
- Friends populated proof: `docs/qa/visual-north-star/gate1/champion/friends-populated.png`
- Core icon direction: `docs/qa/visual-north-star/gate1/champion/icon-direction.png`
- Coherence board: `docs/qa/visual-north-star/gate1/champion/coherence-board.png`
- Current Auth threshold reference: `docs/qa/visual-north-star/gate1/baseline/auth-current.png`

Current Auth is compatible as the calm threshold into this world, but it is a reference—not the master template.

## Gate 2 extension — weather, connection, field controls

- **Weather lineage:** Cloudy, Rainy, and Snowy Day are environmental transformations of the Gate-1 Candidate B world. Exact geography, trail/cairn identity, interface quiet zones, and visual axis stay fixed; weather changes light, atmosphere, moisture, and material response only.
- **Weather champions:** `app/assets/home/gate2/home-world-a-cloudy-day-master.png`, `app/assets/home/gate2/home-world-b-rainy-day-master.png`, and `app/assets/home/gate2/home-world-a-snowy-day-master.png` with matching `*-3x.jpg` delivery assets.
- **Friends empty:** quiet connection is expressed with a restrained shared-trace line and compact human mark at the environmental-to-content threshold—never a cute hero illustration or generic empty card.
- **Add Friend:** the bird/arch concept is locked as a sharp, realistic pīwakawaka moment in the CairnNZ high-country world. Day/Night use `app/assets/friends/hero/gate2/add-friend-world-a-{day,night}-master.png`; Night’s sheet material is cool mineral charcoal, not a spruce slab.
- **Functional icons:** `app/src/components/CairnIcon.tsx` is the Gate-2 core direction: mature trail-navigation pictograms, familiar operational silhouettes, restrained CairnNZ route/cairn details, compact optical weight, and identical Day/Night geometry. Avoid abstract squiggles, cute character gestures, raw AI raster icons, and generic-library substitution.
- **Gate-2 proof:** `docs/qa/visual-north-star/gate2/champion/coherence-board.png`.

Current Auth remains compatible and unchanged.
