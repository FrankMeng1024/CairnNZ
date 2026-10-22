# Visual and interaction evidence index

This is the bounded O88 Cairn closure review, not the separate exhaustive
whole-app global audit. Every listed image is an actual rendered application
screen. Map conclusions use genuine hosted Mapbox, not fallback maps, synthetic
static mockups or screenshot-only substitutes.

## Core loaded application — 22 states

Authority: `core-ui/RESULTS.json`, `MAPBOX_PROVENANCE.json` and selected PNGs.

- Actual Expo Web production screens at 360×780, 390×844 and 430×932.
- Day, Sunset and Night appearances.
- 49 client requests, zero runtime errors.
- 39 Mapbox requests; 36 completed; zero failed. Two requests deliberately
  canceled by the browser-reload proof are separately counted, not suppressed.
- Covered interactions/states:
  - Activity Plant Only me/Friends/Public;
  - Adjust→GPS Cancel and Adjust→pin Back with exact editor retention;
  - Public pending success through the real client handler;
  - owner detail, edit/new version and withdraw confirmation;
  - Library I left/I found, exact found page/history and Archive completion;
  - encounter, Later and Open exact revision;
  - first-entry Cancel/reopen with no empty draft;
  - browser interruption, explicit resume and exact words/place restoration.

Human review found the authoritative stable frames clean. The earlier
transparent withdrawal screenshot was a React Native Web modal fade midpoint;
the harness now waits for the stable presentation frame, and that superseded
frame is intentionally excluded from the package.

## Genuine Mapbox density matrix — 24/24

Authority: `mapbox-density/RESULTS.json` and 24 PNGs.

- 8 scenario/zoom combinations × Day/Sunset/Night = 24 captures.
- 229 requested, 210 completed, zero failed Mapbox resources; zero runtime
  errors.
- Day uses hosted Outdoors; Sunset uses the bundled genuine Mapbox-vector
  style; Night uses hosted Navigation Night.
- Web image registration renders the canonical Cairn glyph family.
- Cluster text uses appearance-specific foreground/fill semantics and is
  readable at normal phone scale.
- Physical rendered overlap-8 click opened the exact eight-item group sheet.
- Physical rendered distributed-60 click expanded zoom 11.8 → 11.964968 and
  opened no content sheet.

## Connected real API/DB application — 11 frames

Authority: `connected-ui/RESULTS.json` and selected PNGs.

The screenshots correspond to actual isolated MySQL records and real client
handlers: save, detail, retained encounter, exact revision, Thanks, Library,
history, edit v2, stable withdrawal confirmation, retained v1 and offline
reconstruction. The database trace and screenshot filenames share the same
marker/publication/acquisition/presentation identities.

## Realtime pedestrian simulation

Authority: `realtime-walk/RESULTS.json`, frozen diary and focused video.

- 182.124 seconds wall time; median provider gap 1,000 ms.
- 8/8 assertions true; zero runtime errors; 27 successful hosted Mapbox
  resources, zero failed.
- Actual production simulator timer/provider and acceptance pipeline; normal,
  poor, lost and reacquired signal states; lost samples did not enter raw input.
- Diary SHA-256:
  `1acf222e761913964eafc370528335bc979b7113a9cf564fd1a31d1f4282293f`.
- This is deliberately simulated realtime input, not a physical walk or native
  GPS claim.

## Visual judgments and remaining native boundaries

- Plant retains Cairn’s cream/forest note-first identity, avoids autofocus and
  preserves audience/place truth through cancellation and restart.
- Found detail now keeps the note/version context primary; Archive and Remove
  are balanced secondary actions with distinct consequences.
- Withdraw confirmation uses compact copy and balanced actions without erasing
  retention truth.
- Encounter Friends/Public/mixed provenance uses labels and shape as well as
  color; Open/Later meet the 44 pt target.
- Semantic muted text and Settings long identity wrapping are corrected across
  the three appearances; Home keeps its canonical artwork with controlled text
  support.
- Reduced Motion code paths and finite/nonblocking Web transitions are covered.

Not verified: iPhone keyboard compression, Dynamic Type, VoiceOver reading
order, haptics, native status/permission sheets, native Mapbox Standard presets,
native transition feel and thermal/battery behavior. These are not converted
into PASS from Web screenshots.
