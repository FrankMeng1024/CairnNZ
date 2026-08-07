/**
 * Memory Mode — feature configuration.
 *
 * Centralized tunables for the v0.2.6 Memory feature. NO hardcoded
 * constants in business logic — everything goes through this module
 * so we can adjust without grep-hunting and so future OTA hooks can
 * override per-platform.
 *
 * Naming: every constant is exported as a const object whose keys
 * describe both unit and intent. Resist the urge to inline numbers.
 *
 * v0.2.6 — initial scaffolding. Server-side OTA override not yet
 * wired; this file is the source of truth until then.
 */

// ── Unlock geometry ───────────────────────────────────────────────────
export const UnlockConfig = {
  /** Radius (meters) around each GPS point that becomes "explored".
   *  R114 (2026-08-07): 25 → 30. User feedback: 25m corridors are too
   *  narrow — walking around a large building or down a wide two-lane
   *  road leaves a black stripe in the middle you can't clear without
   *  physically walking through the middle. 30m matches typical
   *  building perimeters + wide road widths while still requiring
   *  actual on-foot traversal (not drive-by). Enlarging much beyond
   *  30m risks privacy leaks (rough position becomes obvious from
   *  reveal shape). */
  radiusMeters: 30,

  /**
   * Speed gate — readings above this are presumed to be vehicle / transit
   * and should not unlock fog (avoids drive-by/scrolling exploits).
   */
  maxSpeedKmh: 35,

  /**
   * Initial reveal on first app open (so the user doesn't see a blank
   * black map and bounce). Centered on the user's first valid GPS fix.
   * v332: dropped 500→200 per user feedback "初始稍微大点 但没那么大".
   * Walking-time reveal is still 25m per GPS point (radiusMeters above).
   */
  initialRevealRadiusMeters: 200,

  /**
   * Minimum accuracy (meters) for a GPS reading to be admitted to the
   * unlock engine. Bad signal is dropped rather than over-extending fog
   * with garbage data.
   */
  minGpsAccuracyMeters: 30,
} as const;

// v333: TileConfig deleted — was only consumed by tileEncoder.ts (removed).

// ── Mystery cairn visibility ──────────────────────────────────────────
export const MysteryVisibilityConfig = {
  /**
   * Map zoom range in which individual mystery (?) cairns are rendered.
   * Below minZoom they cluster into aggregate counts; above maxZoom
   * is fine-detail and we always show.
   */
  minZoomForIndividualMysteryCairn: 13,

  /**
   * Maximum reveal distance (meters) — strictly cap how far a mystery
   * cairn can be from the user's current location and still be visible.
   * Stops users from "world-scrolling" to discover everything.
   * Once unlocked (visited once), this cap no longer applies.
   */
  mysteryMaxDistanceMeters: 5000,
} as const;

// v333: FogConfig + MemoryConfigBundle + getMemoryConfig deleted.
// FogConfig was only consumed by services/fogBuilder.ts which was
// removed in v331. MemoryConfigBundle/getMemoryConfig aggregator had
// zero callers — every consumer imports named consts directly.

// ── Visual tokens (sepia / Topo50 palette) ─────────────────────────────
export const MemoryColors = {
  cream: '#f7f2e5',
  sepia: '#b5823d',
  sepiaDeep: '#5b4628',
  // v303 OTA 视觉调:62% → 58% 透一点,色温暖一点。塑料感主要来源是
  // 整片色块完全均匀 + 锐利边界 — 现在锐利边界靠 polygon-smooth 一轮
  // Chaikin 解决;透明度降一点让底图(Topo50)透出色调,色块感破掉。
  fogOverlay: 'rgba(58, 42, 24, 0.58)',
  // Soft edge color for the cleared/fog boundary — drawn as a thin
  // LineLayer on the hole rings to anti-alias the union outline.
  fogEdge: 'rgba(247, 242, 229, 0.55)',
  contour: 'rgba(181, 130, 61, 0.18)',
  userPath: '#d4a96a',
  userDot: '#4a8b3f',
  cairnSelf: '#b5823d',
  cairnFriend: '#6a8bd4',
  cairnPublic: '#8a7960',
  mysteryFog: 'rgba(74, 50, 30, 0.8)',
} as const;

// ── Mystery card preview (what the user sees BEFORE unlocking) ────────
export const MysteryPreviewConfig = {
  /** Show like count? */
  showLikeCount: true,
  /** Show how long ago it was planted? */
  showAgeRelative: true,
  /** Show distance + bearing arrow? */
  showDistanceBearing: true,
  /** Show title? — false for stranger-public, true for friends. */
  showTitleForFriends: true,
  showTitleForPublic: false,
} as const;

// O1 batch 37: ShareConfig removed — 0 external callers confirmed by grep audit.
