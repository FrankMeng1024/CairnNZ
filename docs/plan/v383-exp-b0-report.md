# v383-exp B0 Diagnostic Report

**Date**: 2026-06-28
**OTA tested**: v383-exp (logs only, no behavior change)
**Device**: iOS 26.5, real device (user's phone)
**Data source**: aliyun `edit_diagnostics`, `tag = 'v383.pin_*_layout'`

## Raw measurements (representative sample)

Captured for all 5 self-tier types (danger/junction/water/hut/cairn). Numbers identical across types.

| Element | Measured | Expected | Match |
|---|---|---|---|
| parent View | width=52 height=72 x=0 y=0 | 52 × 72 | ✅ exact |
| crest container | width=20 height=16 x=16 y=0 | 20 × 16 | ✅ exact |
| core View | width=44 height=44 x=4 y=18 | 44 × 44 | ✅ exact |

## Inferred geometry (per pin)

```
y=0 ─┬─────────────────────────────┐
     │  (16×0) crest 20×16         │ ← x=16..36, y=0..16
y=16 │                             │
     │   2px gap (marginBottom)    │
y=18 │                             │
     │  (4×18) core 44×44          │ ← x=4..48, y=18..62
y=62 │                             │
     │   10px bottom padding       │
y=72 └─────────────────────────────┘
```

- Parent width 52, crest centred at x=26 (16+20/2), core centred at x=26 (4+44/2). ✅
- Crest height + gap + core height = 16+2+44 = 62. Parent height 72 — 10px unused at bottom (acceptable, harmless).
- No element is outside parent bounds.
- No element has size 0.

## §B0 three-way branch decision

| Branch | Trigger | Status |
|---|---|---|
| 1. **iOS clip** | core measured size < 44 | **REJECTED** — measured exactly 44×44 |
| 2. **Layout bug** | parent or core size = 0 | **REJECTED** — all sizes exact |
| 3. **Visual hidden despite correct layout** (shadow bleed / z-order / contrast) | sizes match, but user can't see | **CONFIRMED** |

→ Section B fix path follows §B3 (platform-split contrast), **not §B1 (layout rewrite)**.

## Root cause hypothesis (visual, not layout)

User report: "Memory 我看到很多皇冠 但是他们的圆呢 没有了"

`CairnPin` core View CSS (lines 232-249 of CairnPinsLayer.tsx):
```js
{
  borderWidth: 3,
  borderColor: tierColour,            // self=gold #ffd460
  backgroundColor: enamel.fill,        // cairn type=#b0966c (sand-gold), water=blue, etc.
  shadowColor: tierGlow,               // self=rgba(255,212,96,0.65) (gold)
  shadowOpacity: 0.8,
  shadowRadius: 7,
  shadowOffset: { width: 0, height: 0 },
}
```

For SELF-tier markers:
- border = gold #ffd460
- shadow = gold rgba(255,212,96,0.65), 7px radius, 0.8 opacity, 0px offset
- Some cores (cairn type) have backgroundColor #b0966c — also gold-ish

**The 7px gold shadow bleeds OUTWARD from the 44×44 core in all directions, creating a fuzzy gold halo around the entire pin. Against the lightly-tinted Mapbox map background, this gold halo and the gold border are nearly the same colour.** The visual result:
- Crest (gold crown, sharp 20×16 SVG) is still readable as a distinct gold shape.
- Core border (3px gold ring) dissolves into the surrounding 7px gold halo — no perceptible edge.
- Core background (cairn=#b0966c sandy gold) similarly fades into the halo.

User's eye sees "crown floating above a vague gold blob, no defined circle". User reports "圆没了".

Verified by elimination — clipping ruled out (measurements), layout ruled out (measurements), z-order doesn't apply (crest and core have a 2px gap, no overlap conflict).

## v383 implementation implications

`CairnPinV10` rewrite should:

1. **Reduce shadow bleed**: drop `shadowRadius` from 7 to 2 (or remove shadow entirely on the core View — let the SVG drop-shadow on the crest provide the only glow).
2. **Strengthen border contrast against shadow**: thicken `borderWidth` from 3 to 4, OR add a dark inner border on the core (a 1px `borderColor: #1a1612` inside the gold). Border becomes visually anchored.
3. **Add a dark base layer behind the core** so the gold border has high-contrast backing regardless of map tint. E.g., wrap core in an outer 48×48 View with `backgroundColor: 'rgba(20,16,10,0.5)'` — provides a dark "stage" the gold border stands on.
4. **Apply v10 absolute layout** for crest tightly hugging core (top:-2 negative offset, 6px overlap) — currently 2px gap makes crest read as separate from core, contributing to "crown alone" perception.

Per plan-final2 §B3, this matches the platform-split path:
- iOS: SVG `<feDropShadow>` filter on crest provides intrinsic glow without polluting core's silhouette.
- Android: doubled-up crest fallback for the same effect.
- Cross-platform: thicker border + dark base layer (above) — works regardless of `react-native-svg` filter support.

## v383 still needs

- B0 diagnosis: **DONE** ✅ (this report)
- B-section code: NOT YET — implementation follows from this report.
- A-section mock rewrite: NOT YET.
- C-section SymbolLayer + zoom scaling: NOT YET.

Next step: implement Section B fix per the hypothesis above. Then resume Sections A + C in parallel tracks per plan-final2 §E.
