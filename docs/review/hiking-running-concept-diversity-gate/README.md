# CairnNZ Hiking + Running concept diversity gate

Review-only exploration of five fundamentally different semantic metaphors. This gate does not select a winner and does not change any application/runtime source.

## Review paths

- Concept directions: `docs/review/hiking-running-concept-diversity-gate/concept-directions-board.png`
- Actual Home size: `docs/review/hiking-running-concept-diversity-gate/home-size-board.png`
- Current Home context: `docs/review/hiking-running-concept-diversity-gate/home-context-board.png`
- Pre-drawing diversity audit: `docs/review/hiking-running-concept-diversity-gate/CONCEPT_BRIEF.md`
- Individual sources: `docs/review/hiking-running-concept-diversity-gate/icons/family-{a,b,c,d,e}/{hiking,running}.svg`

Editable SVG versions of all three boards sit beside the PNG files.

## Accepted context anchor

- Source: `docs/review/action-icon-reset-gate/icons/family-b/cairn.svg`
- SHA-256 before and after: `5429c91d5c810a1de2652e6eef8a1162f17b345b0b4ff973193ced60823ee1e1`
- Status: accepted B Cairn, byte-for-byte unchanged and shown only for scale, weight, and maturity context

## Family A — Field Signals

### Core metaphor

Physical movement infrastructure distinguishes a rugged trail blaze from athletics track markings.

### Hiking meaning

The triangular blaze on a planted post is a recognizable backcountry track cue, grounded by an uneven trail edge.

### Running meaning

Three lane curves and stagger marks point specifically to running as a measured track activity without depicting a person.

### Why this family is fundamentally different

It depicts infrastructure in the environment, not a movement trace, diagram, carried tool, or worn object.

- Semantic clarity: **Good**
- Small-size readability: **Good**
- CairnNZ fit: **Strong**
- Candid risk: the Hiking mark may read as a generic waymark outside an outdoor context, while Running skews toward track rather than all running.

## Family B — Ground Rhythm

### Core metaphor

Abstract contact marks record Hiking as weighted, irregular progress and Running as light, increasingly spaced cadence.

### Hiking meaning

Broad offset contacts climb like deliberate steps across uneven trail stones without becoming literal footprints.

### Running meaning

Thin contacts become lighter and farther apart, expressing quicker ground turnover without a route arrow or speed gimmick.

### Why this family is fundamentally different

It shows only residual ground contact; no field structure, motion chart, equipment, or footwear silhouette appears.

- Semantic clarity: **Fair**
- Small-size readability: **Good**
- CairnNZ fit: **Good**
- Candid risk: this is the most label-dependent direction and should be rejected if first-glance testing reads it only as abstract marks.

## Family C — Movement Profile

### Core metaphor

A compact motion profile expresses Hiking through stepped elevation gain and Running through continuous rebound cadence.

### Hiking meaning

The measured step-up profile terminates at a summit cue, framing Hiking as deliberate ascent rather than casual walking.

### Running meaning

Repeated smooth ballistic arcs describe light rebound and continuous cadence without anatomy or route geometry.

### Why this family is fundamentally different

It is diagrammatic notation for movement behavior, unlike physical signage, residual traces, literal tools, or worn objects.

- Semantic clarity: **Fair**
- Small-size readability: **Strong**
- CairnNZ fit: **Good**
- Candid risk: Hiking can read as stairs/elevation data and Running as generic rhythm; the family is clean but semantically abstract.

## Family D — Specialist Tools

### Core metaphor

One defining tool stands for each mode: planted trekking poles for Hiking and a split timer for Running.

### Hiking meaning

The planted pole pair signals deliberate backcountry travel and rough-ground stability.

### Running meaning

The split timer represents paced, active running and performance measurement without using fitness-health symbolism.

### Why this family is fundamentally different

It uses literal carried or operated tools; none of the other directions uses equipment as its semantic source.

- Semantic clarity: **Good**
- Small-size readability: **Strong**
- CairnNZ fit: **Strong**
- Candid risk: trekking poles can drift toward Nordic/skiing and the timer can describe timed activity generally.

## Family E — Worn Form

### Core metaphor

Purpose-built footwear communicates a grounded lugged hiking boot versus a low, light running shoe.

### Hiking meaning

The high collar, firm sole, and visible lugs communicate rugged trail use and grounded movement.

### Running meaning

The low upper, split sole, and lighter profile communicate faster performance movement.

### Why this family is fundamentally different

It is the sole worn-object and footwear-led family; the other four avoid shoes entirely.

- Semantic clarity: **Strong**
- Small-size readability: **Strong**
- CairnNZ fit: **Good**
- Candid risk: it is the most familiar/direct family but also the least conceptually distinctive and repeats the category overused in the rejected exploration.

## Pairwise diversity result

The ten pairwise checks were completed before drawing and are recorded in `CONCEPT_BRIEF.md`. The semantic sources remain orthogonal after the 29px inspection:

- A: built field infrastructure
- B: residual ground contact
- C: abstract movement notation
- D: specialist carried/operated tools
- E: worn footwear

No two families reduce to a shoe variant, footprint variant, decorated route, or mountain/trail variation.

## Hard acceptance test

1. Five families created: **YES**
2. Five genuinely different semantic ideas: **YES**
3. No more than one footwear-led family: **YES**
4. No human figures used: **YES**
5. Hiking/Running distinguishable inside each family: **YES**
6. Families visually and conceptually distinguishable: **YES**
7. Accepted B Cairn unchanged: **YES**
8. No production integration: **YES**

## Safety and validation

- Exactly ten individual candidate SVGs exist: five Hiking and five Running.
- Every source uses a 48 × 48 viewBox, `currentColor`, rounded terminals, and the CairnNZ 2.25px primary stroke.
- Every Home-size mark is rendered at exactly 29 × 29 CSS pixels.
- The Home context board is a static composite over existing real 390 × 844 Expo Web evidence, not a runtime screen or layout change.
- No human figure, silhouette, anatomy, character, heart/ECG, lightning, or pin appears.
- No shared UI, runtime icon mapping, Home layout, Home background, motion, or production file was changed by this workstream.
- No push or OTA publish was performed.
