/**
 * CairnPinV10 — v386 rewrite. Single source of truth, matches v10 HTML
 * spec exactly (docs/ux/mark-tier-explorations/round2-family4-1-v10.html
 * lines 32-71).
 *
 * v386 fixes vs v385:
 *   1. Crest no longer position:absolute with negative top — that crashed
 *      against PointAnnotation iOS frame-clipping (children outside host
 *      UIView CGRect get cut, no matter the parent style). Now crest is
 *      in normal flex flow with marginBottom:-6 to overlap core, AND the
 *      whole pin View has extra top padding so crest renders fully inside
 *      the host frame.
 *   2. v10 visual fidelity bumped: core gets multi-layer Shadow + inset
 *      bezel + radial gradient approximation (single tier ring + dark
 *      inner hairline give the "metal coin" look without true CSS
 *      box-shadow inset which RN doesn't support).
 *   3. Zoom-responsive scaling via reanimated useSharedValue<zoom>
 *      hooked into MemoryMap's MapView.onCameraChanged. Parent
 *      <Animated.View> applies transform:[{scale: f(zoom)}].
 *
 * size variants:
 *   - "memory": core 44 (v10 spec)
 *   - "detail": core 32 (smaller for hero map context)
 */

import React from 'react';
import { View } from 'react-native';
import Svg, { Path, Circle, Ellipse, Rect, G } from 'react-native-svg';
import type { Tier } from './pinTier';
import { useMapZoom } from './useMapZoom';

// ─── Palette (mirrors v10 HTML lines 59-61) ────────────────────────────────
const TIER_GOLD = '#ffd460';
const TIER_GREEN = '#8fcb5d';
const TIER_SILVER = '#e0e6ec';
const TIER_GLOW_GOLD = 'rgba(255,212,96,0.70)';
const TIER_GLOW_GREEN = 'rgba(143,203,93,0.60)';
const TIER_GLOW_SILVER = 'rgba(196,204,214,0.30)';
const DARK_BORDER = '#1a1612';

const TYPE_ENAMEL: Record<string, { fill: string; dark: string }> = {
  danger: { fill: '#c84a3a', dark: '#7a2818' },
  junction: { fill: '#c8841c', dark: '#6e4a0a' },
  water: { fill: '#3d7fb8', dark: '#1a4870' },
  hut: { fill: '#9a6228', dark: '#5a3614' },
  cairn: { fill: '#b0966c', dark: '#6a5530' },
};

// ─── Sizes (v10 HTML: core 44, crest 20×16, pin 52×60) ─────────────────────
// v387b: crestOverlap = 0 (crest sits directly above core, no negative margin).
// Previous overlap caused crest to render BEHIND core in RN's z order in some
// PointAnnotation host views (no native CSS z-index) — user saw "no crown" on
// Flag detail. Visual seam between crest and core is handled by the curved
// crown-base path instead of geometric overlap.
const SIZES = {
  memory: { core: 44, crestW: 20, crestH: 16, crestOverlap: 0, glyph: 22, border: 3 },
  detail: { core: 32, crestW: 15, crestH: 12, crestOverlap: 0, glyph: 16, border: 2.5 },
} as const;
export type PinSize = keyof typeof SIZES;

// v387: scale derived from current zoom. PointAnnotation's host view
// auto-sizes to the child View's measured frame on iOS, so by setting
// width/height/border/glyph as scaled px values (not via RN transform
// which iOS PointAnnotation silently ignores) we get true visible
// re-sizing across pinches.
function scaleForZoom(z: number): number {
  // z=11 → 0.35, z=13 → 0.55, z=15 → 0.78, z=17 → 1.0, z=19 → 1.15
  if (z <= 11) return 0.35;
  if (z >= 19) return 1.15;
  if (z < 17) return 0.35 + (z - 11) * (1.0 - 0.35) / (17 - 11);
  return 1.0 + (z - 17) * (1.15 - 1.0) / (19 - 17);
}

function computeFrame(size: PinSize) {
  const s = SIZES[size];
  // v394: tighter frame than v389's 88×88 big square. Width = core + 4
  // (small padding for shadow bleed). Height = crestH + core (crest 直接在
  // core 上方,核心和皇冠紧贴). MarkerView anchor (0.5, 0.5) puts view
  // center == coordinate. We arrange so core's CENTER sits at view center;
  // crest sticks out via marginBottom: negative within a flex column.
  const width = s.core + 6; // shadow padding
  // Visible height: crestH (above core) + core. Anchor at (0.5, 0.5) = view
  // center; core center coincides with view center BY DESIGN: extra padding
  // above and below core equal. So pad = crestH + extra; height = crestH*2 + core
  // Wait — simpler: put core at view CENTER. Total view = core×3 in height
  // gives core enough margin top for crest, bottom for shadow, with core
  // visually anchored at the center → MarkerView anchor 0.5/0.5 = core center.
  const height = s.core + s.crestH * 2 + 4; // crest can sit above + symmetric pad below
  return { ...s, width, height };
}

// ─── Crest SVG paths (1:1 from v10 HTML, except self crown base is
// curved to hug the core circle's top edge — flat base v10 used had
// a visible seam against the round medallion below) ──────────────────
function CrestPaths({ tier, colour }: { tier: Tier; colour: string }) {
  if (tier === 'self') {
    return (
      <>
        {/* Crown spikes (unchanged from v10) */}
        <Path d="M9 1.5 L11.5 4.5 L14.5 1.5 L15.5 8 L2.5 8 L3.5 1.5 L6.5 4.5 Z" fill={colour} />
        {/* Crown base — concave bottom hugs core circle top.
            viewBox is 18×14; core (44px @ 1.0) maps to crest width 18.
            Bottom uses quadratic arc with downward curvature so the base
            appears to follow the medallion's circumference. */}
        <Path d="M 2 9 L16 9 L16 10.5 Q 9 12.3 2 10.5 Z" fill={colour} />
      </>
    );
  }
  if (tier === 'friend') {
    // 8-point compass star — symmetric, no base seam issue
    return <Path d="M9 1 L10.2 6 L15 7 L10.2 8 L9 13 L7.8 8 L3 7 L7.8 6 Z" fill={colour} />;
  }
  // Public footprints — already organic shapes, no seam
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

// Crest with halo glow approximating v10's CSS drop-shadow filter.
// Cross-platform doubled-up render: glow underlay + main on top.
// v390: collapsable=false on each layer so RN allocates explicit native
// CALayers — react-native-svg children get captured by PointAnnotation
// iOS offscreen rasteriser (which walks composited CALayers only).
function Crest({
  tier, colour, glow, width, height,
}: { tier: Tier; colour: string; glow: string; width: number; height: number }) {
  const pad = 2;
  return (
    <View
      style={{ width, height, position: 'relative', backgroundColor: 'rgba(0,0,0,0.001)' }}
      collapsable={false}
    >
      <View
        style={{ position: 'absolute', left: -pad, top: -pad, opacity: 0.7, backgroundColor: 'rgba(0,0,0,0.001)' }}
        collapsable={false}
      >
        <Svg width={width + pad * 2} height={height + pad * 2} viewBox="0 0 18 14">
          <CrestPaths tier={tier} colour={glow} />
        </Svg>
      </View>
      <View collapsable={false} style={{ backgroundColor: 'rgba(0,0,0,0.001)' }}>
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
        <Path d="M11.13 2.95 a2 2 0 0 1 1.74 0 l 8.5 15.05 a2 2 0 0 1 -1.74 3 H3.37 a2 2 0 0 1 -1.74 -3 Z" fill={GLYPH_FILL} />
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
        <Path d="M12 2.5 C 12 2.5, 5 11, 5 15.5 a 7 7 0 0 0 14 0 C 19 11, 12 2.5, 12 2.5 Z" fill={GLYPH_FILL} />
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
  // cairn (logo) — 3 stacked ellipses
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
  const baseFrame = computeFrame(size);
  const enamel = TYPE_ENAMEL[type] || TYPE_ENAMEL.cairn;
  const tierColour = tier === 'self' ? TIER_GOLD : tier === 'friend' ? TIER_GREEN : TIER_SILVER;
  const tierGlow = tier === 'self' ? TIER_GLOW_GOLD : tier === 'friend' ? TIER_GLOW_GREEN : TIER_GLOW_SILVER;

  // v394b: zoom scale via JS re-render (PointAnnotation/MarkerView ignore
  // RN transform on children; we change real px sizes).
  const zoom = useMapZoom();
  const s = scaleForZoom(zoom);
  const f = {
    width: baseFrame.width * s,
    height: baseFrame.height * s,
    core: baseFrame.core * s,
    crestW: baseFrame.crestW * s,
    crestH: baseFrame.crestH * s,
    crestOverlap: baseFrame.crestOverlap * s,
    glyph: baseFrame.glyph * s,
    border: Math.max(1, baseFrame.border * s),
  };

  // ── 全部画在一个 SVG 里 — crest + core + glyph 同一 SVG 坐标空间
  // 不再嵌套 View → 不存在两个独立的 native UIView 让 crest 跟 core
  // 视觉错位的可能。SVG viewBox 是统一坐标,内容数学上固定相对位置.
  //
  // 设计坐标 (viewBox base=100 单位):
  //   crest: cx=50, cy=20 (上方居中), w=30, h=22
  //   core:  cx=50, cy=58 (中间略下), r=24
  //   crest 底 (cy=31) 进入 core 顶 (cy=58-24=34) 上方 3 单位 → 视觉融合
  //
  // 实际渲染时 SVG 缩放到 f.width × f.height。core 圆心始终在
  // x=50/100*width, y=58/100*height. MarkerView anchor 0.5/0.5 让 view
  // center == coordinate; view center 是 (f.width/2, f.height/2). 我们
  // 把 core cy 也设到 height 中心 → core center == view center == coord.
  const vbW = 100;
  const vbH = 100;
  // core: cy at view center = 50 (so core center == view center)
  const coreCy = 50;
  const coreR = (f.core / f.width) * vbW / 2; // core radius in viewBox units
  // crest sits above core, bottom of crest overlaps top of core by ~3 units
  const crestVBw = (f.crestW / f.width) * vbW;
  const crestVBh = (f.crestH / f.height) * vbH;
  const crestTop = coreCy - coreR - crestVBh + 3; // 3 = overlap

  return (
    <View
      style={{
        width: f.width,
        height: f.height,
      }}
      pointerEvents="box-none"
    >
      <Svg width={f.width} height={f.height} viewBox={`0 0 ${vbW} ${vbH}`}>
        {/* Drop shadow on core via duplicated darker circle, slightly offset */}
        <Circle cx={50} cy={coreCy + 0.8} r={coreR} fill="rgba(0,0,0,0.45)" />
        {/* Core fill */}
        <Circle cx={50} cy={coreCy} r={coreR} fill={enamel.fill} />
        {/* Tier ring (border) */}
        <Circle
          cx={50} cy={coreCy} r={coreR - (f.border / f.width) * vbW / 2}
          fill="none" stroke={tierColour}
          strokeWidth={(f.border / f.width) * vbW}
        />
        {/* Inner dark hairline */}
        <Circle
          cx={50} cy={coreCy} r={coreR - (f.border / f.width) * vbW - 1}
          fill="none" stroke={DARK_BORDER}
          strokeWidth={0.5} strokeOpacity={0.55}
        />
        {/* Type glyph — translated and scaled to fit inside core */}
        {(() => {
          const glyphVBsize = (f.glyph / f.width) * vbW;
          const glyphX = 50 - glyphVBsize / 2;
          const glyphY = coreCy - glyphVBsize / 2;
          // SVG coordinate transform: translate + scale so 24-unit glyph
          // viewBox fits into glyphVBsize × glyphVBsize at (glyphX, glyphY)
          const k = glyphVBsize / 24;
          return (
            <G transform={`translate(${glyphX} ${glyphY}) scale(${k})`}>
              <TypeGlyph type={type} darkColour={enamel.dark} />
            </G>
          );
        })()}
        {/* Crest — drawn in same SVG above core */}
        {/* Halo (glow) layer, slightly larger underneath */}
        <G transform={`translate(${50 - crestVBw / 2 - 1} ${crestTop - 1}) scale(${(crestVBw + 2) / 18})`} opacity={0.7}>
          <CrestPaths tier={tier} colour={tierGlow} />
        </G>
        {/* Main crest layer */}
        <G transform={`translate(${50 - crestVBw / 2} ${crestTop}) scale(${crestVBw / 18})`}>
          <CrestPaths tier={tier} colour={tierColour} />
        </G>
      </Svg>
    </View>
  );
}

export interface MysteryPinV10Props {
  tier: Tier;
  size?: PinSize;
}

export function MysteryPinV10({ tier, size = 'memory' }: MysteryPinV10Props) {
  const baseFrame = computeFrame(size);
  const tierColour = tier === 'self' ? TIER_GOLD : tier === 'friend' ? TIER_GREEN : TIER_SILVER;
  const tierGlow = tier === 'self' ? TIER_GLOW_GOLD : tier === 'friend' ? TIER_GLOW_GREEN : TIER_GLOW_SILVER;

  const zoom = useMapZoom();
  const s = scaleForZoom(zoom);
  const f = {
    width: baseFrame.width * s,
    height: baseFrame.height * s,
    core: baseFrame.core * s,
    crestW: baseFrame.crestW * s,
    crestH: baseFrame.crestH * s,
  };

  const vbW = 100, vbH = 100, coreCy = 50;
  const coreR = (f.core / f.width) * vbW / 2;
  const crestVBw = (f.crestW / f.width) * vbW;
  const crestVBh = (f.crestH / f.height) * vbH;
  const crestTop = coreCy - coreR - crestVBh + 3;

  return (
    <View style={{ width: f.width, height: f.height }} pointerEvents="box-none">
      <Svg width={f.width} height={f.height} viewBox={`0 0 ${vbW} ${vbH}`}>
        {/* Mystery core (dashed via stroke-dasharray) */}
        <Circle cx={50} cy={coreCy} r={coreR} fill="rgba(40,32,20,0.6)" />
        <Circle
          cx={50} cy={coreCy} r={coreR}
          fill="none" stroke={tierColour}
          strokeWidth={1.5}
          strokeDasharray="3 2"
        />
        {/* Question mark */}
        {(() => {
          const k = (coreR * 0.85) / 12;
          return (
            <G transform={`translate(${50 - 12 * k} ${coreCy - 12 * k}) scale(${k})`}>
              <Path
                d="M9 8 Q9 5 12 5 Q15 5 15 8 Q15 10 13 11 Q12 12 12 14"
                stroke={tierColour} strokeWidth="2.4" strokeLinecap="round" fill="none"
              />
              <Circle cx="12" cy="18" r="1.2" fill={tierColour} />
            </G>
          );
        })()}
        {/* Crest above core, same SVG */}
        <G transform={`translate(${50 - crestVBw / 2 - 1} ${crestTop - 1}) scale(${(crestVBw + 2) / 18})`} opacity={0.7}>
          <CrestPaths tier={tier} colour={tierGlow} />
        </G>
        <G transform={`translate(${50 - crestVBw / 2} ${crestTop}) scale(${crestVBw / 18})`}>
          <CrestPaths tier={tier} colour={tierColour} />
        </G>
      </Svg>
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
