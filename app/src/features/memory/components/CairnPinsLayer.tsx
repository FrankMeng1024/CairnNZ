/**
 * CairnPinsLayer — renders cairn pins on the Memory map (v379 redesign).
 *
 * v379 design (from docs/ux/mark-tier-explorations/round2-family4-1-v10.html):
 *   Each pin = outer ring (tier colour) + core (type colour) + crest (tier symbol).
 *
 *   Self    → gold rim, gold crown crest
 *   Friend  → green rim, green 8-point compass star crest
 *   Public  → silver rim, silver P-6 footprints crest (no glow)
 *
 *   Core uses desaturated mineral colours (sealing-wax red, amber honey,
 *   lapis, terracotta, bone) so the rim wins contrast. 5 marker types:
 *   danger / junction / water / hut / cairn (logo glyph).
 *
 * Tier resolution per marker:
 *   - tier='self'   when marker is in viewer's own store (useMarkerStore)
 *   - tier='friend' when permission='group' or 'friend' and authorId != self
 *   - tier='public' when permission='public' and authorId != self
 *
 * Fog-of-war states unchanged from prior version:
 *   1. Cairn in explored cell → render full pin with tier+type
 *   2. Else if within MysteryVisibilityConfig.mysteryMaxDistanceMeters → mystery (?)
 *   3. Else → don't render
 *
 * Strangers (public marks visible by proximity but outside fog) get the
 * blurred treatment via strangerMarks prop — same path as before.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Circle, Ellipse, Rect, Line } from 'react-native-svg';
import { getMapbox } from '../services/mapboxAdapter';
import { useMemoryStore } from '../store/useMemoryStore';
import { useMarkerStore, Marker, type MarkerPermission } from '../../../store/useMarkerStore';
import { MemoryColors, MysteryVisibilityConfig } from '../config/memoryConfig';
import { haversineM } from '../../../utils/geo';
import { MysteryCairnSheet } from './MysteryCairnSheet';
import { RevealedCairnSheet } from './RevealedCairnSheet';

// ─── Tier + type colour palette (mirror v10 HTML) ──────────────────────────
const TIER_GOLD = '#ffd460';
const TIER_GREEN = '#8fcb5d';
const TIER_SILVER = '#e0e6ec';
const TIER_GLOW_GOLD = 'rgba(255,212,96,0.65)';
const TIER_GLOW_GREEN = 'rgba(143,203,93,0.55)';
const TIER_GLOW_SILVER = 'rgba(196,204,214,0.00)';   // public has no glow

const TYPE_ENAMEL: Record<string, { fill: string; dark: string }> = {
  danger:   { fill: '#c84a3a', dark: '#7a2818' },
  junction: { fill: '#c8841c', dark: '#6e4a0a' },
  water:    { fill: '#3d7fb8', dark: '#1a4870' },
  hut:      { fill: '#9a6228', dark: '#5a3614' },
  cairn:    { fill: '#b0966c', dark: '#6a5530' },
  // legacy `free` fallback (v105 deleted but old DB rows may still exist)
  free:     { fill: '#9a8a76', dark: '#5a4d3a' },
};

type Tier = 'self' | 'friend' | 'public';

function resolveTier(marker: Marker, selfAuthorIds: Set<string>): Tier {
  // authorId === 'server' means "own marker after backend hydrate" pre-v300;
  // newer markers carry a real user_id string. Either way, if the marker
  // sits in the viewer's own marker store, it's self.
  if (selfAuthorIds.has(marker.id)) return 'self';
  // Otherwise infer from permission. Legacy `group` means friend-tier.
  const perm = marker.permission as MarkerPermission;
  if (perm === 'public') return 'public';
  if (perm === 'group' || (perm as string) === 'friend') return 'friend';
  // Fallback: personal markers that aren't in own store shouldn't happen;
  // treat as friend (safe default — anything not own is "someone else").
  return 'friend';
}

interface Props {
  markers: Marker[];
  centerLat: number;
  centerLng: number;
  strangerMarks?: Marker[];
}

interface Classified {
  marker: Marker;
  tier: Tier;
  isExplored: boolean;
  distanceM: number;
}

type Selection =
  | { kind: 'none' }
  | { kind: 'mystery'; marker: Marker; tier: Tier }
  | { kind: 'revealed'; marker: Marker; tier: Tier };

export function CairnPinsLayer({ markers, centerLat, centerLng, strangerMarks }: Props) {
  const isExplored = useMemoryStore((s) => s.isExplored);
  const geometryVersion = useMemoryStore((s) => s.geometryVersion);
  // own markers — by id set, so tier classification doesn't need authorId match
  const ownIds = useMemoryStoreOwnIdsShim();
  const Mapbox = getMapbox();
  const [selection, setSelection] = useState<Selection>({ kind: 'none' });

  const classified = useMemo<Classified[]>(
    () => markers.map((m) => ({
      marker: m,
      tier: resolveTier(m, ownIds),
      isExplored: isExplored(m.lat, m.lng),
      distanceM: haversineM(
        { lat: centerLat, lng: centerLng },
        { lat: m.lat, lng: m.lng }
      ),
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [markers, centerLat, centerLng, geometryVersion, ownIds]
  );

  const visible = useMemo(
    () => classified.filter(({ isExplored: explored, distanceM }) => {
      if (explored) return true;
      return distanceM <= MysteryVisibilityConfig.mysteryMaxDistanceMeters;
    }),
    [classified]
  );

  if (!Mapbox.available) return null;
  const { PointAnnotation } = Mapbox;

  return (
    <>
      {visible.map(({ marker, tier, isExplored: explored }) => (
        <PointAnnotation
          key={marker.id}
          id={`cairn-${marker.id}`}
          coordinate={[marker.lng, marker.lat]}
          onSelected={() => setSelection(
            explored
              ? { kind: 'revealed', marker, tier }
              : { kind: 'mystery', marker, tier }
          )}
        >
          {explored ? (
            <CairnPin tier={tier} type={marker.type} />
          ) : (
            <MysteryPin tier={tier} />
          )}
        </PointAnnotation>
      ))}
      {(strangerMarks ?? []).filter((m) => {
        if (isExplored(m.lat, m.lng)) return false;
        const d = haversineM({ lat: centerLat, lng: centerLng }, { lat: m.lat, lng: m.lng });
        return d <= MysteryVisibilityConfig.mysteryMaxDistanceMeters;
      }).map((m) => (
        <PointAnnotation
          key={`stranger-${m.id}`}
          id={`stranger-${m.id}`}
          coordinate={[m.lng, m.lat]}
        >
          <StrangerBlurredPin />
        </PointAnnotation>
      ))}
      {selection.kind === 'mystery' && (
        <MysteryCairnSheet
          marker={selection.marker}
          userLat={centerLat}
          userLng={centerLng}
          onClose={() => setSelection({ kind: 'none' })}
        />
      )}
      {selection.kind === 'revealed' && (
        <RevealedCairnSheet
          marker={selection.marker}
          onClose={() => setSelection({ kind: 'none' })}
        />
      )}
    </>
  );
}

// ─── Tier helper (hook) ────────────────────────────────────────────────────
// Returns a Set of marker IDs that the viewer authored (i.e. live in own
// markers store). Used to short-circuit tier resolution without needing to
// compare authorId to current user (which is itself fragile after server
// hydrate echoes user_id = 'server' string).
function useMemoryStoreOwnIdsShim(): Set<string> {
  const ownMarkers = useMarkerStore((s) => s.markers);
  return useMemo(() => new Set(ownMarkers.map((m) => m.id)), [ownMarkers]);
}

// ─── PIN COMPONENTS ────────────────────────────────────────────────────────

const PIN_SIZE = 52;
const CORE_SIZE = 44;
const CREST_W = 20;
const CREST_H = 16;
const CREST_TOP_OFFSET = -2;

interface PinCommon { tier: Tier; }

function CairnPin({ tier, type }: PinCommon & { type: string }) {
  const enamel = TYPE_ENAMEL[type] || TYPE_ENAMEL.cairn;
  const tierColour = tier === 'self' ? TIER_GOLD : tier === 'friend' ? TIER_GREEN : TIER_SILVER;
  const tierGlow = tier === 'self' ? TIER_GLOW_GOLD : tier === 'friend' ? TIER_GLOW_GREEN : TIER_GLOW_SILVER;

  return (
    <View style={{ width: PIN_SIZE, height: 60, alignItems: 'center' }}>
      {/* Crest sitting -2px above core */}
      <View style={{ position: 'absolute', top: CREST_TOP_OFFSET, zIndex: 3 }}>
        <Svg width={CREST_W} height={CREST_H} viewBox="0 0 18 14">
          <Crest tier={tier} colour={tierColour} />
        </Svg>
      </View>
      {/* Core medallion */}
      <View
        style={{
          marginTop: 8,
          width: CORE_SIZE,
          height: CORE_SIZE,
          borderRadius: CORE_SIZE / 2,
          borderWidth: 3,
          borderColor: tierColour,
          backgroundColor: enamel.fill,
          alignItems: 'center',
          justifyContent: 'center',
          // dark casting-seam (1.5px equivalent via inner ring shadow approximation)
          shadowColor: tierGlow,
          shadowOpacity: tier === 'public' ? 0.4 : 0.8,
          shadowRadius: 7,
          shadowOffset: { width: 0, height: 0 },
          elevation: 4,
          overflow: 'hidden',
        }}
      >
        <Svg width={22} height={22} viewBox="0 0 24 24">
          <TypeGlyph type={type} darkColour={enamel.dark} />
        </Svg>
      </View>
    </View>
  );
}

function MysteryPin({ tier }: PinCommon) {
  const tierColour = tier === 'self' ? TIER_GOLD : tier === 'friend' ? TIER_GREEN : TIER_SILVER;
  return (
    <View style={{ width: PIN_SIZE, height: 60, alignItems: 'center' }}>
      <View style={{ position: 'absolute', top: CREST_TOP_OFFSET, zIndex: 3 }}>
        <Svg width={CREST_W} height={CREST_H} viewBox="0 0 18 14">
          <Crest tier={tier} colour={tierColour} />
        </Svg>
      </View>
      <View
        style={{
          marginTop: 8,
          width: CORE_SIZE,
          height: CORE_SIZE,
          borderRadius: CORE_SIZE / 2,
          borderWidth: 2,
          borderStyle: 'dashed',
          borderColor: tierColour,
          backgroundColor: MemoryColors.mysteryFog,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: tierColour, fontWeight: '700', fontSize: 18 }}>?</Text>
      </View>
    </View>
  );
}

// Crest SVG paths exactly mirror the v10 HTML demo
function Crest({ tier, colour }: { tier: Tier; colour: string }) {
  if (tier === 'self') {
    // Crown — 5 points + base band (v3 exact)
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
  // public — P-6 footprints (offset stride)
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

// 5 type glyphs, drawn in cream-white #fff8e0 (matches v10 enamel-on-bronze look)
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
  // cairn (logo) — 3 stacked ellipses with shadow arcs
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

// Stranger blurred pin — kept from v371 (faded grey dot outside fog)
function StrangerBlurredPin() {
  return (
    <View style={pinStyles.stranger} pointerEvents="none">
      <Text style={pinStyles.strangerIcon}>•</Text>
    </View>
  );
}

const pinStyles = StyleSheet.create({
  stranger: {
    width: 24, height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(140,126,114,0.6)',
    backgroundColor: 'rgba(180,170,160,0.55)',
    alignItems: 'center', justifyContent: 'center',
    opacity: 0.6,
  },
  strangerIcon: { color: 'rgba(80,72,64,0.7)', fontWeight: '700', fontSize: 16 },
});
