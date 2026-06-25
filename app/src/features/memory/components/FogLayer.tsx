/**
 * FogLayer — v331 hybrid raster fog (Fog-of-World style).
 *
 * Architecture (see _spike/v331-pc/v331_plan_v2.md + global_fog_architecture.md):
 *
 *   L1 = ShapeSource + FillLayer over "world rect minus one circle around user"
 *        GeoJSON Polygon. 38 vertices total. Provides global fog at all zooms.
 *        Earcut-safe because the geometry has only one outer ring + one inner ring,
 *        well below the 1000+-inner-ring threshold that triggers the v325-v330 bug.
 *
 *   L2 = ImageSource + RasterLayer of a Skia-rendered PNG. The PNG paints fog
 *        color over the bbox area, punches visited cells transparent, and adds
 *        a cream halo around them. Bbox is centered on user (6km square default).
 *        L1's hole radius (4.2km) is slightly smaller than L2's bbox half-side
 *        (3km) so L2 covers the L1 hole completely — no visible seam.
 *
 *   L3 = MemoryFogBurstOverlay (existing component, golden ring on cell reveal).
 *
 * Why this works where v325-v330 didn't:
 *   - v325-v330 fed Mapbox a polygon with hundreds of inner rings (one per H3
 *     cell or per row-run). Mapbox geojson-vt+earcut has a known unfixed bug
 *     with such polygons (mapbox-gl-js#7023, 7+ yrs open). At zoom-out the
 *     polygon developed self-intersections and rendering collapsed.
 *   - v331 keeps geometry SIMPLE (38 verts total) and offloads per-cell
 *     detail to a raster image — which has zero of those bugs.
 *
 * Spike validation:
 *   - F1: confirmed old polygon path breaks at z≤12 on PC mapbox-gl-js
 *   - F3v2: PNG with blur+halo renders cleanly z=8..18
 *   - F4: world-minus-circle (38 verts) renders cleanly z=2..18
 *
 * Triggers:
 *   - cellVersion bump (new cell visited) → debounced 500ms → re-render mask
 *   - User position changes substantially (>500m from previous mask center) →
 *     re-render mask with new center
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useMemorySettingsStore } from '../store/useMemorySettingsStore';
import { useH3VisitedStore } from '../store/useH3VisitedStore';
import { getMapbox } from '../services/mapboxAdapter';
import {
  worldRectMinusCircle,
  Quad,
} from '../services/fogFloorGeometry';
import { renderMask, scheduleStaleCleanup, clearAllMasks, RenderResult } from '../services/fogMaskRenderer';
import { log } from '../../../services/appLog';
import type { FogBounds } from '../services/globalFogBuilder';

// Re-export type for back-compat with MemoryMap import expectations.
// MemoryMap historically imported FogBounds from FogLayer or its services;
// keep the canonical export at globalFogBuilder (v331 keeps that file as
// a type-only module even though the polygon builder itself is unused).
export type { FogBounds };

interface Props {
  /** Current map center (camera target). Drives L1 hole anchor + L2 bbox center. */
  userCenter?: { lat: number; lng: number } | null;
  /** Legacy props (kept for back-compat; ignored). */
  bounds?: FogBounds | null;
  zoom?: number;
}

const FLOOR_RADIUS_M = 2800; // L1 hole radius — MUST be < MASK_PADDING_M so L2 covers it at all cardinal directions
const MASK_PADDING_M = 3000; // L2 bbox half-side
const FLOOR_SEGMENTS = 32;
const MASK_RECENTER_DISTANCE_M = 500; // re-render if user has moved this far

// Monotonic revision counter — avoids Date.now() collisions on rapid bumps
// (reviewer #1 BLOCKER fix)
let revisionCounter = 0;

// Debounce window for cell bumps. Initial reveal bulk-imports 1281 cells in
// one cellVersion bump, but later GPS walks can produce ~1 bump per 5-20s.
const RENDER_DEBOUNCE_MS = 500;

// One-time startup cleanup of stale mask files.
let startupCleanupDone = false;

function distanceMeters(
  lat1: number, lng1: number, lat2: number, lng2: number,
): number {
  const M_PER_DEG_LAT = 111320;
  const cosLat = Math.cos(((lat1 + lat2) / 2 * Math.PI) / 180);
  const dy = (lat2 - lat1) * M_PER_DEG_LAT;
  const dx = (lng2 - lng1) * M_PER_DEG_LAT * Math.max(cosLat, 1e-6);
  return Math.sqrt(dx * dx + dy * dy);
}

export function FogLayer({ userCenter }: Props) {
  const Mapbox = getMapbox();
  const useH3Fog = useMemorySettingsStore((s) => s.useH3Fog);
  const cellVersion = useH3VisitedStore((s) => s.cellVersion);

  // Track current mask + last mask-center for re-center decisions
  const [mask, setMask] = useState<RenderResult | null>(null);
  const lastCenterRef = useRef<{ lat: number; lng: number } | null>(null);
  const renderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousUriRef = useRef<string | null>(null);
  // Reviewer #1 MAJOR fixes: isMounted guard + pending cleanup timers
  const isMountedRef = useRef(true);
  const cleanupTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // L1 geometry — depends on userCenter only (not cellVersion)
  const fogFloor = useMemo(() => {
    if (!userCenter) return null;
    return worldRectMinusCircle(
      userCenter.lat,
      userCenter.lng,
      FLOOR_RADIUS_M,
      FLOOR_SEGMENTS,
    );
  }, [userCenter?.lat, userCenter?.lng]);

  // Startup: clear stale mask files once per app session
  useEffect(() => {
    if (startupCleanupDone) return;
    startupCleanupDone = true;
    void clearAllMasks();
  }, []);

  // Debounced renderer
  const scheduleRender = useCallback(
    (lat: number, lng: number, reason: string) => {
      if (renderTimerRef.current) clearTimeout(renderTimerRef.current);
      renderTimerRef.current = setTimeout(async () => {
        if (!isMountedRef.current) return;
        const cells = useH3VisitedStore.getState().cells;
        log('fog.mask_render_start', {
          reason,
          cell_count: cells.size,
          center_lat: lat,
          center_lng: lng,
        });
        try {
          // Monotonic revision avoids Date.now() collision (reviewer #1 fix)
          const rev = ++revisionCounter;
          const result = await renderMask({
            centerLat: lat,
            centerLng: lng,
            paddingMeters: MASK_PADDING_M,
            cells,
            revision: rev,
          });
          // isMounted guard (reviewer #1 MAJOR fix)
          if (!isMountedRef.current) return;
          // schedule old file cleanup with cancellable timer
          const previousUri = previousUriRef.current;
          previousUriRef.current = result.uri;
          setMask(result);
          lastCenterRef.current = { lat, lng };
          if (previousUri) {
            const timer = setTimeout(() => {
              cleanupTimersRef.current.delete(timer);
              scheduleStaleCleanup(previousUri, 0);
            }, 800);
            cleanupTimersRef.current.add(timer);
          }
        } catch (e: any) {
          // 'render_cancelled' is benign; everything else is a real error
          if (e?.message !== 'render_cancelled') {
            log('fog.mask_render_error', { error: String(e?.message ?? e) });
          }
        }
      }, RENDER_DEBOUNCE_MS);
    },
    [],
  );

  // Trigger: cellVersion bump OR substantial pan
  useEffect(() => {
    if (!useH3Fog) return;
    if (!userCenter) return;

    const last = lastCenterRef.current;
    if (!last) {
      scheduleRender(userCenter.lat, userCenter.lng, 'first');
      return;
    }

    const dist = distanceMeters(last.lat, last.lng, userCenter.lat, userCenter.lng);
    const shouldRecenter = dist > MASK_RECENTER_DISTANCE_M;

    if (shouldRecenter) {
      scheduleRender(userCenter.lat, userCenter.lng, 'recenter');
    } else {
      // Re-render in place to reflect new cells
      scheduleRender(last.lat, last.lng, 'cell_version');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellVersion, userCenter?.lat, userCenter?.lng, useH3Fog]);

  // Cleanup timer on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (renderTimerRef.current) clearTimeout(renderTimerRef.current);
      // Cancel all pending stale-cleanup timers (reviewer #1 fix)
      for (const t of cleanupTimersRef.current) clearTimeout(t);
      cleanupTimersRef.current.clear();
    };
  }, []);

  // Reviewer #1 MAJOR fix: iOS may purge cacheDirectory while app is in
  // background. On resume, re-render the mask in place so we have a fresh
  // file regardless of whether the old one survived.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && lastCenterRef.current && useH3Fog) {
        scheduleRender(lastCenterRef.current.lat, lastCenterRef.current.lng, 'app_resume');
      }
    });
    return () => sub.remove();
  }, [scheduleRender, useH3Fog]);

  if (!useH3Fog) return null;
  if (!Mapbox.available || !fogFloor) return null;

  const { ShapeSource, FillLayer, ImageSource, RasterLayer } = Mapbox as any;

  return (
    <>
      {/* L1 — global fog floor (world rect minus circle around user) */}
      <ShapeSource id="memory-fog-floor-src" shape={fogFloor}>
        <FillLayer
          id="memory-fog-floor"
          style={{
            fillColor: 'rgba(58, 42, 24, 0.66)',
            fillOpacity: 1,
            fillAntialias: true,
          }}
        />
      </ShapeSource>

      {/* L2 — local Skia raster (per-cell precision + cream halo) */}
      {mask && ImageSource && RasterLayer && (
        <ImageSource
          id="memory-fog-mask-src"
          url={mask.uri}
          coordinates={[
            mask.corners.nw,
            mask.corners.ne,
            mask.corners.se,
            mask.corners.sw,
          ]}
        >
          <RasterLayer
            id="memory-fog-mask"
            style={{
              rasterOpacity: 1,
              rasterOpacityTransition: { duration: 300, delay: 0 },
            }}
          />
        </ImageSource>
      )}
    </>
  );
}
