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
  /** Radius (meters) around each GPS point that becomes "explored". */
  radiusMeters: 25,

  /**
   * Speed gate — readings above this are presumed to be vehicle / transit
   * and should not unlock fog (avoids drive-by/scrolling exploits).
   */
  maxSpeedKmh: 35,

  /**
   * Initial reveal on first app open (so the user doesn't see a blank
   * black map and bounce). Centered on the user's first valid GPS fix.
   */
  initialRevealRadiusMeters: 500,

  /**
   * Minimum accuracy (meters) for a GPS reading to be admitted to the
   * unlock engine. Bad signal is dropped rather than over-extending fog
   * with garbage data.
   */
  minGpsAccuracyMeters: 30,
} as const;

// ── Tile encoding (storage granularity) ────────────────────────────────
export const TileConfig = {
  /**
   * Web Mercator zoom level used for the unlock bitmap. Each tile at
   * zoom 17 is roughly 30m on a side at the equator — matches our
   * unlock radius granularity. Sub-tile precision is encoded as a
   * 128×128 bitmap inside each tile.
   */
  zoom: 17,

  /** Sub-tile bitmap dimension (128 = ~0.23m precision per cell). */
  subgridSize: 128,
} as const;

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

/**
 * Fog rendering tuning. Lives next to UnlockConfig because the two are
 * intimately tied (hole radius = unlock radius), but separated so the
 * VISUAL aspects (vertex count, padding, cull tightness) can be tweaked
 * without touching the SEMANTIC unlock policy (radius, accuracy gate).
 */
export const FogConfig = {
  /** Polygon vertex count per circular hole. Higher = smoother edges.
   *  v302: investigated 32→64 (subagent perf review) but reverted —
   *  600 points × 64 verts doubles turf.union cost (300ms→600ms),
   *  worsening the user's "memory 打开慢" complaint. Smooth edges
   *  is a polish item, open speed is a red-line. Defer to v303 when
   *  fogBuilder is rewritten with a non-union approach (deck.gl mask
   *  or SDF shader) where vertex count is decoupled from open time.
   */
  circleVertices: 32,
  /**
   * Cull-threshold multiplier: when two visited points are closer than
   * `radiusMeters * cullThresholdFactor` we drop the second one — the
   * first point's hole already covers it. 0.5 = keep ~50% overlap for
   * smooth boundaries between adjacent circles.
   */
  cullThresholdFactor: 0.5,
  /**
   * Outer-ring padding multiplier. The fog outer ring is built from the
   * map's visible bounds expanded by this factor on each side.
   *
   * IMPORTANT: mapbox-gl-js silently SKIPS rendering polygons whose
   * vertices project too far outside the viewport (~8000+ pixels). A
   * naive "huge polygon" approach (e.g. world bounds, or 5x viewport)
   * causes the fog to never paint. 0.5x keeps corners within ~640
   * pixels of the screen edge — covers small pans, stays renderable.
   *
   * Verified via Playwright web spike: pad=5 silently fails, pad=0.5
   * works. Re-verify on native if changing.
   *
   * v302: investigated 0.5→2 to fix the "zoom out shows fog ring
   * edge" complaint, but subagent perf review flagged risk of silent-
   * skip at MIN_ZOOM=14. Reverted. Proper fix requires zoom-aware
   * padFactor (compute per-frame) — defer to v303.
   */
  outerRingPadFactor: 0.5,
  /**
   * Debounce window (ms) between map-pan-triggered fog rebuilds. We do
   * NOT rebuild on every frame — only after the camera idles. Helps
   * keep main-thread JS work bounded.
   */
  rebuildDebounceMs: 150,
} as const;

// ── Visual tokens (sepia / Topo50 palette) ─────────────────────────────
export const MemoryColors = {
  cream: '#f7f2e5',
  sepia: '#b5823d',
  sepiaDeep: '#5b4628',
  // v302 N5: softer, less heavy fog. The previous 0.78 alpha read as
  // a brown wall; 0.62 keeps the "I haven't been here" feeling but
  // lets the underlying map peek through. Color shifted slightly
  // warmer / darker so the cleared map (cream) pops more on contrast.
  fogOverlay: 'rgba(50, 35, 20, 0.62)',
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

// ── Friend share rules ────────────────────────────────────────────────
export const ShareConfig = {
  /**
   * Default master switch when a friendship is created. Friends are
   * not auto-shared — explicit opt-in keeps memory private by default.
   */
  defaultMasterSwitch: false,

  /**
   * Default per-activity inclusion when master switch is on. Activities
   * get shared unless the user opts out at completion time.
   */
  defaultPerActivityInclude: true,
} as const;

export type MemoryConfigBundle = {
  unlock: typeof UnlockConfig;
  tile: typeof TileConfig;
  mystery: typeof MysteryVisibilityConfig;
  preview: typeof MysteryPreviewConfig;
  share: typeof ShareConfig;
  colors: typeof MemoryColors;
};

/**
 * Single accessor — components import this rather than the named consts
 * so future per-user / OTA overrides can swap implementations without
 * touching call sites.
 */
export function getMemoryConfig(): MemoryConfigBundle {
  return {
    unlock: UnlockConfig,
    tile: TileConfig,
    mystery: MysteryVisibilityConfig,
    preview: MysteryPreviewConfig,
    share: ShareConfig,
    colors: MemoryColors,
  };
}
