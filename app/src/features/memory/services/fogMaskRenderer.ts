/**
 * fogMaskRenderer — v331 Skia-rendered fog mask PNG.
 *
 * Output: a 1024×1024 PNG written to expo-file-system cacheDirectory.
 *   - Cleared cells: fully transparent (lets the underlying L1 fog floor /
 *     basemap show through)
 *   - Cream halo: opaque cream rim around the cleared cluster's edge
 *   - Everywhere else inside the bbox: fully transparent (L1 fog floor
 *     handles this area)
 *
 * The mask is rendered into a single PNG, not per-tile. rnmapbox 10.3.1 does
 * not expose Mapbox's CanvasSource, so per-tile (Fog of World style) isn't
 * available. The single-image approach covers a padded square (default 3km
 * half-side = 6km square) around the user. The L1 layer covers the rest of
 * the world.
 *
 * Skia API choices (per spike review):
 *   - Surface.Make (CPU-backed) instead of MakeOffscreen — works on JS thread
 *     without a runOnUI worklet wrapper.
 *   - encodeToBase64 returns string directly (no Hermes Buffer roundtrip).
 *   - expo-file-system MUST be imported from '/legacy' subpath; default
 *     import throws at runtime on SDK 54.
 *
 * Performance budget (per spike): ~60-120ms per mask render, debounced 500ms.
 * Sized 1024×1024 with 6km bbox → 5.86 m/px → each 25m H3 cell is ~4.3 px.
 *
 * Cleanup:
 *   - On startup: clear all fog-rev*.png files in cacheDirectory
 *   - After successful mask swap: delete previous revision file after 800ms
 *     (longer than the 300ms rasterOpacityTransition to avoid race)
 *   - Cancellation: if a new render starts before the previous finishes,
 *     the previous request's result is discarded (token-based).
 */

import { computeBboxCorners, Quad } from './fogFloorGeometry';
import type { VisitedCell } from '../store/useH3VisitedStore';
import { log } from '../../../services/appLog';

// Lazy Skia + FileSystem imports (web fallback friendly, EAS prebuild safe)
type FsModule = typeof import('expo-file-system/legacy');
type SkiaModule = typeof import('@shopify/react-native-skia');

let FS: FsModule | null = null;
let fsAttempted = false;
function getFs(): FsModule | null {
  if (FS) return FS;
  if (fsAttempted) return null;
  fsAttempted = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    FS = require('expo-file-system/legacy');
    return FS;
  } catch (e) {
    log('fog.mask_fs_load_error', { error: String((e as Error)?.message ?? e) });
    return null;
  }
}

let SK: SkiaModule | null = null;
let skAttempted = false;
function getSkia(): SkiaModule | null {
  if (SK) return SK;
  if (skAttempted) return null;
  skAttempted = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    SK = require('@shopify/react-native-skia');
    return SK;
  } catch (e) {
    log('fog.mask_skia_load_error', { error: String((e as Error)?.message ?? e) });
    return null;
  }
}

// Constants
const MASK_SIZE = 1024;
const DEFAULT_PADDING_M = 3000; // half-side of bbox → 6km square
const FOG_RES_METERS = 25;

const CREAM_R = 247;
const CREAM_G = 242;
const CREAM_B = 229;
const CREAM_ALPHA = 0.55;

const BLUR_SIGMA = 5;

export interface RenderInput {
  centerLat: number;
  centerLng: number;
  /** Half-side of bbox in meters. Default 3000 → 6km square. */
  paddingMeters?: number;
  /** Map of visited cells from useH3VisitedStore. Keys: "11:ix:iy". */
  cells: Map<string, VisitedCell>;
  /** Monotonic revision identifier (used in filename). */
  revision: number;
}

export interface RenderResult {
  /** file:// URI to the saved PNG, suitable for ImageSource.url */
  uri: string;
  /** Four geographic corners of the bbox for ImageSource.coordinates */
  corners: Quad;
  /** Build time in ms */
  buildMs: number;
  /** Pixel size of the mask (square) */
  size: number;
  /** Padding meters used */
  paddingMeters: number;
  /** Revision used */
  revision: number;
  /** Number of cells drawn */
  cellsDrawn: number;
}

// ─── Cancellation token ──────────────────────────────────────────────────
// If a new render starts while the previous is in flight (encode + write),
// the previous one is invalidated. The previous render's result is still
// returned but the caller can compare the token to know it's stale.

let currentToken = 0;

// ─── Cleanup ─────────────────────────────────────────────────────────────

const FILE_PREFIX = 'fog-rev';
const FILE_EXT = '.png';

export async function clearAllMasks(): Promise<void> {
  const fs = getFs();
  if (!fs?.cacheDirectory) return;
  try {
    const entries = await fs.readDirectoryAsync(fs.cacheDirectory);
    const targets = entries.filter(
      (n) => n.startsWith(FILE_PREFIX) && n.endsWith(FILE_EXT),
    );
    await Promise.all(
      targets.map((n) =>
        fs.deleteAsync(`${fs.cacheDirectory}${n}`, { idempotent: true }).catch(() => {}),
      ),
    );
    log('fog.mask_startup_cleanup', { deleted: targets.length });
  } catch (e) {
    log('fog.mask_cleanup_error', { error: String((e as Error)?.message ?? e) });
  }
}

async function deletePrevious(prevPath: string): Promise<void> {
  const fs = getFs();
  if (!fs) return;
  try {
    await fs.deleteAsync(prevPath, { idempotent: true });
  } catch {
    // Best-effort cleanup; never throw
  }
}

// ─── Cell decode ─────────────────────────────────────────────────────────

interface Decoded {
  ix: number;
  iy: number;
}

function decodeCell(cellID: string): Decoded | null {
  const parts = cellID.split(':');
  if (parts.length !== 3) return null;
  const res = parseInt(parts[0], 10);
  const ix = parseInt(parts[1], 10);
  const iy = parseInt(parts[2], 10);
  if (res !== 11 || !isFinite(ix) || !isFinite(iy)) return null;
  return { ix, iy };
}

// ─── Main render ─────────────────────────────────────────────────────────

/**
 * Render a fog mask PNG to cacheDirectory. Returns the uri + bbox corners.
 *
 * Throws if Skia or expo-file-system are unavailable. Caller should catch
 * and fall back to a no-fog state.
 */
export async function renderMask(input: RenderInput): Promise<RenderResult> {
  const t0 = Date.now();

  const skia = getSkia();
  const fs = getFs();
  if (!skia) throw new Error('Skia module not available');
  if (!fs?.cacheDirectory) throw new Error('expo-file-system not available');

  const myToken = ++currentToken;
  const padding = input.paddingMeters ?? DEFAULT_PADDING_M;
  const halfSide = padding;
  const fullSide = halfSide * 2;
  const scaleMPerPx = fullSide / MASK_SIZE; // meters per pixel

  // Helper to convert local meters (relative to centerLat/centerLng) → pixel
  // local x_m = (lng - centerLng) * METERS_PER_DEG_LAT * cosLat
  // local y_m = (lat - centerLat) * METERS_PER_DEG_LAT
  // px_x = MASK_SIZE/2 + x_m / scaleMPerPx
  // px_y = MASK_SIZE/2 - y_m / scaleMPerPx (PIL Y goes down)

  // For cells, we know their geo position via the cellID "11:ix:iy":
  //   south_m_global = iy * 25
  //   north_m_global = (iy + 1) * 25
  //   But we work in LOCAL meters relative to (centerLat, centerLng).
  //   The cell's center in absolute lat = (iy + 0.5) * dLat where dLat = 25/111320.
  //   The cell's center in absolute lng = ix * (25 / (111320 * cos(anchorLat))) ...
  //   This matches h3Pure.latLngToCell.
  //
  // For mask rendering we want each cell's bbox in pixel coords. Compute via:
  const M_PER_DEG_LAT = 111_320;
  const dLat = FOG_RES_METERS / M_PER_DEG_LAT;
  const cosCenter = Math.max(Math.cos((input.centerLat * Math.PI) / 180), 1e-6);

  // Allocate CPU surface
  const surface = skia.Skia.Surface.Make(MASK_SIZE, MASK_SIZE);
  if (!surface) {
    throw new Error(`Skia.Surface.Make returned null at ${MASK_SIZE}×${MASK_SIZE}`);
  }
  const canvas = surface.getCanvas();

  // ─── PASS 1: punch cells onto an alpha-only "mask" canvas ─────────────
  // We use two passes:
  //   Pass A: render the cleared-area mask (cells = opaque, rest = transparent)
  //           into the surface, then blur it for soft edges.
  //   Pass B: derive the cream halo from the gradient (edge of mask) and
  //           draw it back on top of the (cleared) surface.
  //
  // Since we only need the FINAL composite (cream halo where edges are,
  // transparent elsewhere), the simplest single-pass approach is:
  //
  // 1. Draw all cells as opaque WHITE rectangles → "clear mask"
  // 2. Blur the white mask
  // 3. Use the blurred mask itself as the cream halo source via:
  //    - take its alpha gradient (subtract a wider blur to isolate edges)
  //    - colorize cream
  //    - draw on top
  // 4. Finally, set the cleared interior back to transparent
  //
  // Implementation: we'll do this with one surface + saveLayer/blur tricks.

  // For v331 ship: a simpler but visually equivalent approach:
  //   - canvas starts fully transparent
  //   - For each cell, draw a small cream rectangle with low alpha
  //     (this places "ghost" markers on cell centers)
  //   - Blur the whole surface so the cream marks smear out to overlapping halos
  //   - The result naturally produces a halo-like glow without explicit gradient math
  //
  // BUT this doesn't match Fog of World's "halo on the boundary, transparent inside".
  // It produces "warm glow inside cleared area" which is a different aesthetic.
  //
  // For first ship: use the simpler "warm glow inside" — easy to tune, fast, no
  // gradient math. If user wants strict Fog-of-World boundary halo, we tune in v332.

  // ─── Actual render code ───────────────────────────────────────────────
  // CORRECTED ALGORITHM (v331.1 after 2-subagent code review):
  //
  // Step 1: Fill entire surface with fog color (matches L1 floor)
  // Step 2: For each cell, draw a soft-edged transparent "hole" directly on
  //         the surface using BlendMode.DstOut + MaskFilter blur.
  //         DstOut erases destination alpha based on source coverage.
  //         The MaskFilter blur softens the source rectangle's edges, so
  //         the erase has feathered edges. This DOES reach the parent surface
  //         (unlike Clear-inside-saveLayer which only operates on the layer).
  // Step 3: Cream halo — render onto a SEPARATE surface, blur, subtract,
  //         colorize. Implement as a second pass on the main surface using
  //         a similar MaskFilter+DstOver trick but with cream paint.
  //
  // Geometry constraint: cells are decoded once, not twice (avoids 2562
  // string splits + 2x trig).

  const { Skia, BlendMode, ImageFormat, TileMode } = skia;

  // Helper: setColor accepting an rgb hex + alpha float, more reliable than
  // CSS rgba string parsing (which is inconsistent across Skia versions).
  // v344 DIAGNOSTIC: replace sepia fog with magenta so we can tell whether
  // Mapbox iOS actually loaded the data:image/png;base64 URI. After v343
  // shipped data URI fix, telemetry confirms Skia rendered cells_drawn=387
  // PNGs successfully, but no Mapbox-side load confirmation exists.
  // If user sees magenta anywhere on the map after this OTA → data URI is
  // loaded by Mapbox (v343 architecture works). If user sees no magenta →
  // data URI is silently rejected by Mapbox iOS, we need a different
  // transport (e.g. local HTTP server via EAS build).
  // Revert to sepia in v345 once confirmed.
  const fogColor = Skia.Color('#FF00FF');
  const creamColor = Skia.Color(`#${CREAM_R.toString(16).padStart(2, '0')}${CREAM_G.toString(16).padStart(2, '0')}${CREAM_B.toString(16).padStart(2, '0')}`);

  // Step 1: fill entire surface with fog color
  const fogPaint = Skia.Paint();
  fogPaint.setColor(fogColor);
  fogPaint.setAlphaf(0.66);
  canvas.drawRect(Skia.XYWHRect(0, 0, MASK_SIZE, MASK_SIZE), fogPaint);

  // Pre-decode all cells into pixel rects (single pass, no duplicate work)
  interface CellRect { x: number; y: number; w: number; h: number; }
  const cellRects: CellRect[] = [];
  for (const cid of input.cells.keys()) {
    const dec = decodeCell(cid);
    if (!dec) continue;
    const cellSouthLat = dec.iy * dLat;
    const cellNorthLat = (dec.iy + 1) * dLat;
    const anchorLat = (dec.iy + 0.5) * dLat;
    const cosAnchor = Math.max(Math.cos((anchorLat * Math.PI) / 180), 1e-6);
    const dLng = FOG_RES_METERS / (M_PER_DEG_LAT * cosAnchor);
    const cellWestLng = dec.ix * dLng;
    const cellEastLng = (dec.ix + 1) * dLng;
    const wMeters = (cellWestLng - input.centerLng) * M_PER_DEG_LAT * cosCenter;
    const eMeters = (cellEastLng - input.centerLng) * M_PER_DEG_LAT * cosCenter;
    const sMeters = (cellSouthLat - input.centerLat) * M_PER_DEG_LAT;
    const nMeters = (cellNorthLat - input.centerLat) * M_PER_DEG_LAT;
    const px_w = MASK_SIZE / 2 + wMeters / scaleMPerPx;
    const px_e = MASK_SIZE / 2 + eMeters / scaleMPerPx;
    const px_n = MASK_SIZE / 2 - nMeters / scaleMPerPx;
    const px_s = MASK_SIZE / 2 - sMeters / scaleMPerPx;
    if (px_e < -10 || px_w > MASK_SIZE + 10 || px_s < -10 || px_n > MASK_SIZE + 10) continue;
    cellRects.push({
      x: px_w,
      y: px_n,
      w: Math.max(1, px_e - px_w),
      h: Math.max(1, px_s - px_n),
    });
  }
  const cellsDrawn = cellRects.length;

  // Step 2: punch transparent holes using BlendMode.DstOut
  //   DstOut: result = dst * (1 - srcAlpha). Where we draw, destination
  //   alpha is reduced. This DOES erase pixels on the surface directly,
  //   unlike BlendMode.Clear inside saveLayer (which only operates on
  //   a fresh transparent layer that then composites back as SrcOver no-op).
  //
  //   Apply Gaussian blur via MaskFilter so each cell's "punch" has
  //   feathered edges. MaskFilter affects the source coverage *before*
  //   blend mode applies, so the soft erase actually feathers the alpha
  //   reduction.
  const punchPaint = Skia.Paint();
  punchPaint.setBlendMode(BlendMode.DstOut);
  punchPaint.setColor(Skia.Color('#FFFFFF'));
  punchPaint.setAlphaf(1.0);
  const punchBlur = Skia.MaskFilter.MakeBlur(skia.BlurStyle.Normal, BLUR_SIGMA, true);
  punchPaint.setMaskFilter(punchBlur);

  for (const r of cellRects) {
    canvas.drawRect(Skia.XYWHRect(r.x, r.y, r.w, r.h), punchPaint);
  }

  // Step 3: cream halo at the cleared/fog boundary
  //   We want a rim of cream around the cleared cluster, fading outward
  //   into the fog. Approach:
  //   - Draw cream rectangles WITH a wider MaskFilter blur (sigma 1.6x).
  //   - Use BlendMode.SrcOver (default) so cream pixels are added on top
  //     of whatever is there (fog if not punched, transparent if punched).
  //   - Inset the cream rect by ~30% of cell width so the cream "bleed"
  //     mostly appears at the boundary edge (where cells border non-cells),
  //     not in the deep interior of large contiguous clusters.
  //
  //   This is NOT a strict differential-blur boundary halo (which would
  //   require a separate offscreen mask surface). It's a "cream tinted
  //   feather at cell edges" — visually similar enough for v331; iterate
  //   in v332 with a true offscreen-mask approach if user wants stricter
  //   Fog-of-World look.
  const haloPaint = Skia.Paint();
  haloPaint.setColor(creamColor);
  haloPaint.setAlphaf(CREAM_ALPHA * 0.4); // gentle, so dense interiors don't go solid cream
  const haloBlur = Skia.MaskFilter.MakeBlur(skia.BlurStyle.Normal, BLUR_SIGMA * 1.8, true);
  haloPaint.setMaskFilter(haloBlur);

  for (const r of cellRects) {
    const insetX = r.w * 0.15;
    const insetY = r.h * 0.15;
    const rectX = r.x + insetX;
    const rectY = r.y + insetY;
    const rectW = Math.max(0.5, r.w - insetX * 2);
    const rectH = Math.max(0.5, r.h - insetY * 2);
    canvas.drawRect(Skia.XYWHRect(rectX, rectY, rectW, rectH), haloPaint);
  }

  // Snapshot + encode
  const image = surface.makeImageSnapshot();
  const base64 = image.encodeToBase64(ImageFormat.PNG, 100);

  if (myToken !== currentToken) {
    // Cancelled by newer render
    throw new Error('render_cancelled');
  }

  // v343 fix: use data:image/png;base64 inline instead of writing PNG to
  // expo-file-system cacheDirectory and passing file:// URL to Mapbox.
  //
  // Root cause (proven via v342 diagnostic OTA): rnmapbox iOS forwards
  // mask.uri verbatim to Mapbox iOS SDK 11.20.1 ImageSource.url. With
  // file:// scheme the SDK enqueues the load but silently fails (no JS
  // error, no native log) — see rnmapbox/maps#1457 (open 5 years, unfixed).
  // Skia rendered the PNG correctly (cells_drawn=387 confirmed in
  // telemetry) but Mapbox never painted it, so L1 fog fully covered
  // the entire bbox → user saw all-black.
  //
  // Data URI bypasses the iOS URL loader pipeline entirely (Mapbox decodes
  // inline). Both @rnmapbox/maps src/components/Images.tsx _isUrlOrPath
  // and Mapbox iOS SDK explicitly whitelist data: scheme.
  //
  // Cost: ~1.3 MB base64 string per 1024×1024 PNG. At 500ms RENDER_DEBOUNCE
  // this is well within Hermes string budget. Net I/O is *lower* than
  // before because writeAsStringAsync is gone.

  const corners = computeBboxCorners(input.centerLat, input.centerLng, padding);
  const buildMs = Date.now() - t0;

  log('fog.mask_rendered', {
    revision: input.revision,
    cells_drawn: cellsDrawn,
    build_ms: buildMs,
    padding_m: padding,
    size: MASK_SIZE,
  });

  return {
    uri: `data:image/png;base64,${base64}`,
    corners,
    buildMs,
    size: MASK_SIZE,
    paddingMeters: padding,
    revision: input.revision,
    cellsDrawn,
  };
}

/**
 * Schedule cleanup of a previous-revision file after the rasterOpacityTransition
 * fade window. Call this AFTER setting the new ImageSource.url.
 */
export function scheduleStaleCleanup(prevUri: string | null, delayMs: number = 800): void {
  if (!prevUri) return;
  // v343: data: URIs have no filesystem footprint — nothing to clean.
  // Only file:// URIs (from pre-v343 builds left on disk) need delete.
  if (prevUri.startsWith('data:')) return;
  setTimeout(() => {
    const path = prevUri.replace(/^file:\/\//, '');
    void deletePrevious(path);
  }, delayMs);
}
