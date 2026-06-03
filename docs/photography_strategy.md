# Photography Strategy — Cairn

**PRD3 E-019 deliverable.** This document records *why* Cairn ships v1
without hero photography, and the conditions under which photography is
introduced.

---

## Why no photos in v1

The PRD3 audit (5.5/10) flagged "zero photography" as the most visible
weakness against AllTrails / Komoot. The temptation is to fill the gap
with stock photography. The audit explicitly rejects that path:

- **Stock photos read as Patagonia / global brand**, not as a NZ-native
  app made by people who actually walked these tracks. The audit calls
  this the "Patagonia stock-look" trap.
- **Photo licensing is expensive and ongoing** — Unsplash-as-default
  works for blogs but not for an app where the same image will appear
  on thousands of installs without provenance.
- **Tourism NZ photo libraries** require partnership agreements (good,
  but not a v1 path) and DOC's image bank is restricted to specific
  conservation-comms uses.
- **Wrong photos kill credibility faster than no photos.** A stock
  "rocky mountain hike" header on a Tongariro track screams "this app
  doesn't know NZ".

The decision: **ship v1 without hero photos**. Use original SVG
illustrations (E-019) for empty states. Keep the data model
photo-ready so we can add real images later without a migration.

---

## What's in place now (v1)

### Data model — forward-compatible

`Route` carries optional photo fields (`app/src/store/useRouteStore.ts`):

```ts
heroPhotoUrl?: string;   // single header image
photoCredit?: string;    // required when heroPhotoUrl is set
```

`Marker` carries an optional photo array (`app/src/store/useMarkerStore.ts`):

```ts
photoUrls?: string[];    // user-attached, displayed inline in detail sheet
```

Backend tables (when added in v1.1) will mirror these names.

### Original SVG illustrations

Three illustrations in `app/src/components/Illustrations/`:

- `EmptyRoutes` — distant ridge + winding sepia track + cairn at the foot
- `EmptyMarkers` — bird's-eye of a track with the first flag descending
- `EmptyFriends` — two cairns flanking a soft dashed track

Style rules (Natural Warm palette):
- Line + 2-3 colour partial fill, never photorealistic
- No LOTR / Middle-earth tropes (no swords, no rings, no oversized fantasy)
- No NZ koru / kowhaiwhai / tukutuku patterns (cultural appropriation risk)
- Cairn signature stones recur — three asymmetric ovals stacked

These ship with the app. They are the *intended look* of empty states,
not a placeholder.

---

## When photography enters (v1.1+)

### Stage 1 — User-attached photos (probably v1.1)

The first photos in the app should come from the people walking the
tracks. This is the asynchronous-trail-companion ethos in PRD3 E-017.

Plan:
- Marker detail sheet gets a "Add photo" button
- Photos uploaded to backend, stored in S3-equivalent
- Auto-EXIF strip + downscale (2048px max edge, JPEG q80)
- Photos render inline in the marker detail sheet
- One row of thumbnails on Route detail showing recent user photos
  along that route

Why first: licensing-free, attribution baked in (the user took it),
authentic, and it trains the system on what real Cairn photos look
like before we negotiate any partnership.

### Stage 2 — Curated track headers (v2.0+)

Once we have a body of user content and a baseline aesthetic, then we
can pursue:

- **DOC partnership** — official Great Walk imagery with clear use
  rights. DOC has a public-interest pathway for NZ-purpose apps that
  promote responsible recreation.
- **Tourism NZ** — broader NZ landscape library, also partnership-based.
- **Direct commissions** — pay 1–2 NZ photographers (Lowe / Brightwell
  level) for a curated set of Great Walk hero shots. Most expensive
  path, highest quality fit, exclusive use for Cairn.

Photo credit is **always visible** under the hero image. No silent use.

### What we never do

- Stock libraries (Unsplash, Pexels, Shutterstock, Adobe Stock)
- AI-generated landscapes
- Tourist holiday snaps without permission
- Photos that show people identifiably without release
- Drone photography in National Parks (CAA + DOC restrictions)

---

## Style guide — when photos arrive

When photographs do enter the product, they must read as NZ:

| Quality | Why |
|---|---|
| **Natural light, NZ palette** | Tussock golds, beech reds, glacier blues, basalt greys. Not desaturated "moody adventure" filters, not warm-orange Instagram presets. |
| **Wide landscape, person small** | Track itself is the subject. People should appear at human scale within the landscape, not posing. |
| **Specific NZ flora / geology** | Beech canopy, tussock fields, schist, greenstone river, alpine herb fields. Generic mountain photos read as Patagonia. |
| **Weather honesty** | Cloud, rain, mist are NZ. Bluebird-only photo sets read as marketing fiction. Include some moody shots. |
| **No summit-flag triumph poses** | Anti-pattern from Komoot/Strava. Cairn's voice is quiet and asynchronous. |
| **No drones in National Parks** | CAA + DOC rules. Wide shots only from accessible viewpoints. |

---

## Implementation checklist for v1.1 photo introduction

When the time comes:

- [ ] Backend: add `route_photos` and `marker_photos` tables
- [ ] Backend: photo upload endpoint with EXIF strip + size limit (5MB pre-process, 800KB post)
- [ ] Backend: S3-compatible storage (Tencent COS or AWS S3) with signed URLs
- [ ] App: photo picker integration (`expo-image-picker`)
- [ ] App: thumbnail rendering in Route / Marker sheets
- [ ] App: full-screen photo viewer with credit footer
- [ ] Legal: photo upload TOS (user grants display rights, retains ownership)
- [ ] Legal: no-faces-without-release reminder in upload UI
- [ ] DOC partnership reach-out (if pursuing curated tracks)

---

## Reference

- PRD3 § E-019 — primary source
- `docs/research/NZ_USER_AND_COMPETITOR_REFERENCE.md` § F — competitive imagery analysis
- `docs/cultural-consultation.md` (E-014, in progress) — for Te Reo place name attribution rules that apply equally to photography of culturally significant sites (Ngāi Tahu / iwi consultation for sacred mountains)
