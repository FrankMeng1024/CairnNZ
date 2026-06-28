/**
 * CairnPinV10 — v383 pin component, source-of-truth for v10 design.
 *
 * Used in 3 contexts:
 *   1. CairnPinsLayer (Memory map) via <Mapbox.Image> sprite host (SymbolLayer path)
 *   2. CairnPinsLayer fallback (PointAnnotation path on web)
 *   3. MarkerDetailScreen hero map (single pin)
 *
 * Layout: matches docs/ux/mark-tier-explorations/round2-family4-1-v10.html
 *   - parent: width × (height = coreSize + crestH + 6 padding) relative positioning
 *   - crest: position:absolute, top: -2 (overlaps top of core by 6px), zIndex: 3
 *   - core: marginTop: 8 (room for crest overlap from above)
 *
 * Size variants:
 *   - size="memory" → core 44, total ~60 high (matches v10 HTML)
 *   - size="detail" → core 32, total ~44 high (smaller for hero map context)
 *
 * v383 fix vs v382 (per docs/plan/v383-exp-b0-report.md):
 *   - No shadow on core (was shadowRadius=7 → flooded core border with halo,
 *     causing user's "皇冠在 圆没了"). All glow is now on crest only via filter.
 *   - borderWidth 3 → 4 + inner dark ring for high-contrast border.
 *   - crest uses absolute top:-2 to overlap core (was 2px gap → crown felt
 *     detached from circle).
 *   - iOS: SVG <feDropShadow> filter on crest for v10-faithful glow.
 *   - Android: doubled crest (larger halo underlay + main crest) since
 *     react-native-svg filters are unreliable on Android.
 *   - Cross-platform: dark inner border + outer dark "stage" View ensures
 *     border reads against any map background, including dark mode.
 *
 * Tier resolution lives in CairnPinsLayer.tsx (resolveTier export).
 */

import React from 'react';
import { View } from 'react-native';
import Svg, { Path, Circle, Ellipse, Rect } from 'react-native-svg';
import type { Tier } from './pinTier';

// ─── Palette (mirrors v10 HTML) ────────────────────────────────────────────
const TIER_GOLD = '#ffd460';
const TIER_GREEN = '#8fcb5d';
const TIER_SILVER = '#e0e6ec';
const TIER_GLOW_GOLD = 'rgba(255,212,96,0.85)';
const TIER_GLOW_GREEN = 'rgba(143,203,93,0.75)';
const TIER_GLOW_SILVER = 'rgba(196,204,214,0.6)';
const DARK_BORDER = '#1a1612';
const DARK_STAGE = 'rgba(20,16,10,0.55)';

const TYPE_ENAMEL: Record<string, { fill: string; dark: string }> = {
  danger: { fill: '#c84a3a', dark: '#7a2818' },
  junction: { fill: '#c8841c', dark: '#6e4a0a' },
  water: { fill: '#3d7fb8', dark: '#1a4870' },
  hut: { fill: '#9a6228', dark: '#5a3614' },
  cairn: { fill: '#b0966c', dark: '#6a5530' },
};

// ─── Sizes ─────────────────────────────────────────────────────────────────
const SIZES = {
  memory: { core: 44, crestW: 20, crestH: 16, crestOverlap: 6, glyph: 22 },
  detail: { core: 32, crestW: 15, crestH: 12, crestOverlap: 4, glyph: 16 },
} as const;
export type PinSize = keyof typeof SIZES;

function computeFrame(size: PinSize) {
  const s = SIZES[size];
  const width = Math.max(s.core, s.crestW) + 8; // padding for crest glow bleed
  // crest sits at top: -2, overlaps core by `crestOverlap` px.
  // Visible height = (crest visible above core: crestH - crestOverlap) + core
  const visibleHeight = (s.crestH - s.crestOverlap) + s.core + 4;
  return { ...s, width, height: visibleHeight };
}

// ─── Crest SVG paths (1:1 from v10 HTML) ──────────────────────────────────
function CrestPaths({ tier, colour }: { tier: Tier; colour: string }) {
  if (tier === 'self') {
    // Crown — 5 points + base band
    return (
      <>
        <Path d="M9 1.5 L11.5 4.5 L14.5 1.5 L15.5 8 L2.5 8 L3.5 1.5 L6.5 4.5 Z" fill={colour} />
        <Path d="M 2 9 L16 9 L16 10.5 L2 10.5 Z" fill={colour} />
      </>
    );
  }
  if (tier === 'friend') {
    // 8-point compass star
    return <Path d="M9 1 L10.2 6 L15 7 L10.2 8 L9 13 L7.8 8 L3 7 L7.8 6 Z" fill={colour} />;
  }
  // Public — P-6 offset footprints
  return (
    <>
      <Ellipse cx="5" cy="5" rx="1.8" ry="2.6" fill={colour} />
      <Circle cx="5" cy="2" r="0.7" fill={colour} />
      <Circle cx="3.3" cy="2.6" r="0.5" fill={colour} />
      <Ellipse cx="13" cy="9" rx="1.8" ry="2.6" fill={colour} />
      <Circle cx="13" cy="6" r="0.7" fill={colour} />
      <Circle cx="14.7" cy="6.6" r="0.5" fill={colour} />
    </>
  );
}

// Crest renderer with cross-platform glow.
//
// v383 review B2: react-native-svg 15.x does NOT support <feDropShadow> on
// either iOS or Android (silently no-op). The original v10 HTML uses CSS
// drop-shadow filters which are not portable to react-native-svg. We approximate
// with a "doubled crest" — a slightly larger halo underlay in the glow colour
// behind the main crest. Not pixel-identical to v10 HTML but works identically
// on iOS + Android.
function CrestWithGlow({
  tier, colour, glow, width, height,
}: { tier: Tier; colour: string; glow: string; width: number; height: number }) {
  // Halo: rendered at +2px each side, glow colour, 65% opacity. Sits behind.
  const haloPad = 2;
  return (
    <View style={{ width, height }}>
      <View style={{
        position: 'absolute',
        left: -haloPad,
        top: -haloPad,
        width: width + haloPad * 2,
        height: height + haloPad * 2,
        opacity: 0.7,
      }}>
        <Svg width={width + haloPad * 2} height={height + haloPad * 2} viewBox="0 0 18 14">
          <CrestPaths tier={tier} colour={glow} />
        </Svg>
      </View>
      <View style={{ position: 'absolute', left: 0, top: 0 }}>
        <Svg width={width} height={height} viewBox="0 0 18 14">
          <CrestPaths tier={tier} colour={colour} />
        </Svg>
      </View>
    </View>
  );
}

// ─── Type glyphs (1:1 from v10 HTML) ──────────────────────────────────────
const GLYPH_FILL = '#fff8e0';
function TypeGlyph({ type, darkColour }: { type: string; darkColour: string }) {
  if (type === 'danger') {
    return (
      <>
        <Path
          d="M11.13 2.95 a2 2 0 0 1 1.74 0 l 8.5 15.05 a2 2 0 0 1 -1.74 3 H3.37 a2 2 0 0 1 -1.74 -3 Z"
          fill={GLYPH_FILL}
        />
        <Rect x="11.1" y="9" width="1.8" height="6" rx="0.9" fill={darkColour} />
        <Circle cx="12" cy="17.5" r="1.1" fill={darkColour} />
      </>
    );
  }
  if (type === 'junction') {
    return (
      <>
        <Path d="M12 21 L12 13" stroke={GLYPH_FILL} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <Path d="M12 13 L6 7" stroke={GLYPH_FILL} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <Path d="M12 13 L18 7" stroke={GLYPH_FILL} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <Path d="M6 7 L6 10 M6 7 L9 7" stroke={GLYPH_FILL} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <Path d="M18 7 L18 10 M18 7 L15 7" stroke={GLYPH_FILL} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </>
    );
  }
  if (type === 'water') {
    return (
      <>
        <Path
          d="M12 2.5 C 12 2.5, 5 11, 5 15.5 a 7 7 0 0 0 14 0 C 19 11, 12 2.5, 12 2.5 Z"
          fill={GLYPH_FILL}
        />
        <Ellipse cx="9" cy="13" rx="1.6" ry="2.6" fill="rgba(255,255,255,0.45)" />
      </>
    );
  }
  if (type === 'hut') {
    return (
      <>
        <Rect x="16.5" y="3.5" width="2.2" height="4" rx="0.3" fill={GLYPH_FILL} />
        <Path d="M12 3 L21 11.5 L3 11.5 Z" fill={GLYPH_FILL} />
        <Rect x="5" y="10.5" width="14" height="9" rx="0.5" fill={GLYPH_FILL} />
        <Rect x="10.5" y="14" width="3" height="5.5" rx="0.4" fill={darkColour} />
        <Rect x="6.8" y="13.5" width="2.5" height="2.5" rx="0.3" fill={darkColour} />
      </>
    );
  }
  // cairn — 3 stacked ellipses
  return (
    <>
      <Ellipse cx="12" cy="20" rx="7.5" ry="2.4" fill={GLYPH_FILL} />
      <Path d="M 4.5 20 a 7.5 2.4 0 0 0 15 0" fill="rgba(20,16,10,0.30)" />
      <Ellipse cx="11" cy="14" rx="5.5" ry="2.0" fill={GLYPH_FILL} />
      <Path d="M 5.5 14 a 5.5 2 0 0 0 11 0" fill="rgba(20,16,10,0.30)" />
      <Ellipse cx="13.5" cy="8.5" rx="3.4" ry="1.7" fill={GLYPH_FILL} />
      <Path d="M 10.1 8.5 a 3.4 1.7 0 0 0 6.8 0" fill="rgba(20,16,10,0.30)" />
    </>
  );
}

// ─── Public Pin Components ─────────────────────────────────────────────────

export interface CairnPinV10Props {
  tier: Tier;
  type: string;
  size?: PinSize;
}

export function CairnPinV10({ tier, type, size = 'memory' }: CairnPinV10Props) {
  const f = computeFrame(size);
  const enamel = TYPE_ENAMEL[type] || TYPE_ENAMEL.cairn;
  const tierColour = tier === 'self' ? TIER_GOLD : tier === 'friend' ? TIER_GREEN : TIER_SILVER;
  const tierGlow = tier === 'self' ? TIER_GLOW_GOLD : tier === 'friend' ? TIER_GLOW_GREEN : TIER_GLOW_SILVER;

  // Crest centred horizontally over core. Core sits below with overlap.
  const crestLeft = (f.width - f.crestW) / 2;
  const coreLeft = (f.width - f.core) / 2;
  // Crest top: -2 means visual top sits 2px above core's top, but absolute
  // within the parent box. crestVisibleAboveCore = crestH - crestOverlap.
  const crestTop = 0;
  // Core sits below crest's non-overlapping portion
  const coreTop = f.crestH - f.crestOverlap;

  return (
    <View style={{ width: f.width, height: f.height, position: 'relative' }}>
      {/* Crest — absolute, behind core in source order but above via zIndex */}
      <View
        style={{
          position: 'absolute',
          left: crestLeft,
          top: crestTop,
          width: f.crestW,
          height: f.crestH,
          zIndex: 3,
        }}
      >
        <CrestWithGlow
          tier={tier}
          colour={tierColour}
          glow={tierGlow}
          width={f.crestW}
          height={f.crestH}
        />
      </View>

      {/* Outer dark "stage" — provides high-contrast backing for the tier ring.
          Renders 1px larger than core so a sliver of dark shows even when
          tier ring sits flush against a map background of similar hue. */}
      <View
        style={{
          position: 'absolute',
          left: coreLeft - 1,
          top: coreTop - 1,
          width: f.core + 2,
          height: f.core + 2,
          borderRadius: (f.core + 2) / 2,
          backgroundColor: DARK_STAGE,
          zIndex: 1,
        }}
      />

      {/* Core medallion — tier ring + enamel fill + glyph */}
      <View
        style={{
          position: 'absolute',
          left: coreLeft,
          top: coreTop,
          width: f.core,
          height: f.core,
          borderRadius: f.core / 2,
          borderWidth: 4,
          borderColor: tierColour,
          backgroundColor: enamel.fill,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          zIndex: 2,
          // NO shadow — was shadowRadius=7 in v382, caused gold halo to bleed
          // over the gold border, erasing the visible circle edge.
        }}
      >
        {/* Inner dark hairline — gives the tier ring a defined inner edge */}
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: f.core - 8,
            height: f.core - 8,
            margin: 4,
            borderRadius: (f.core - 8) / 2,
            borderWidth: 1,
            borderColor: DARK_BORDER,
            opacity: 0.4,
          }}
        />
        <Svg width={f.glyph} height={f.glyph} viewBox="0 0 24 24">
          <TypeGlyph type={type} darkColour={enamel.dark} />
        </Svg>
      </View>
    </View>
  );
}

export interface MysteryPinV10Props {
  tier: Tier;
  size?: PinSize;
}

export function MysteryPinV10({ tier, size = 'memory' }: MysteryPinV10Props) {
  const f = computeFrame(size);
  const tierColour = tier === 'self' ? TIER_GOLD : tier === 'friend' ? TIER_GREEN : TIER_SILVER;
  const tierGlow = tier === 'self' ? TIER_GLOW_GOLD : tier === 'friend' ? TIER_GLOW_GREEN : TIER_GLOW_SILVER;
  const crestLeft = (f.width - f.crestW) / 2;
  const coreLeft = (f.width - f.core) / 2;
  const coreTop = f.crestH - f.crestOverlap;

  return (
    <View style={{ width: f.width, height: f.height, position: 'relative' }}>
      <View
        style={{
          position: 'absolute',
          left: crestLeft,
          top: 0,
          width: f.crestW,
          height: f.crestH,
          zIndex: 3,
        }}
      >
        <CrestWithGlow tier={tier} colour={tierColour} glow={tierGlow} width={f.crestW} height={f.crestH} />
      </View>
      <View
        style={{
          position: 'absolute',
          left: coreLeft,
          top: coreTop,
          width: f.core,
          height: f.core,
          borderRadius: f.core / 2,
          borderWidth: 2,
          borderStyle: 'dashed',
          borderColor: tierColour,
          backgroundColor: 'rgba(40,32,20,0.6)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Mystery "?" */}
        <View style={{ width: f.glyph, height: f.glyph, alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={f.glyph} height={f.glyph} viewBox="0 0 24 24">
            <Path
              d="M9 8 Q9 5 12 5 Q15 5 15 8 Q15 10 13 11 Q12 12 12 14"
              stroke={tierColour}
              strokeWidth="2.4"
              strokeLinecap="round"
              fill="none"
            />
            <Circle cx="12" cy="18" r="1.2" fill={tierColour} />
          </Svg>
        </View>
      </View>
    </View>
  );
}

export function StrangerBlurredPinV10() {
  return (
    <View
      style={{
        width: 26,
        height: 26,
        borderRadius: 13,
        backgroundColor: 'rgba(180,170,160,0.55)',
        borderWidth: 1.5,
        borderColor: 'rgba(140,126,114,0.65)',
        opacity: 0.7,
      }}
    />
  );
}
