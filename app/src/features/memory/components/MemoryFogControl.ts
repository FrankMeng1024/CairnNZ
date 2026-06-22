/**
 * MemoryFogControl — wires the native CairnFogLayer module to the
 * @rnmapbox/maps MapView and exposes a debug pill (3-mode toggle)
 * for on-device A/B-ing during v303 ship.
 *
 * Modes:
 *   - "legacy" — uses the existing FogLayer (polygon-with-holes,
 *                pre-v303). Slower, harder edges, but proven path.
 *   - "sdf-soft" — native Metal SDF with smoothstep soft edge.
 *   - "sdf-sharp" — native Metal SDF with feather=0 (hard cut).
 *   - "off" — no fog rendered (debug: see the underlying map cleanly).
 *
 * The user picks on real device. Whichever mode they choose, the
 * persisted setting (memoryFogMode in app settings) controls future
 * launches. Default "legacy" until they switch — so a broken native
 * module doesn't break Memory entirely.
 */

import { useEffect, useMemo, useRef } from 'react';
import { findNodeHandle, Platform } from 'react-native';
import * as Fog from '../../../../modules/cairn-fog-layer/src';
import { useMemoryStore } from '../store/useMemoryStore';
import { useMemorySettingsStore } from '../store/useMemorySettingsStore';
import { UnlockConfig } from '../config/memoryConfig';
import { log } from '../../../services/appLog';

export type FogRenderMode = 'legacy' | 'off' | 'sdf-soft' | 'sdf-sharp';

interface Props {
  /** A ref pointing to the @rnmapbox/maps MapView (the native view).
   *  We resolve to a reactTag via findNodeHandle. */
  mapViewRef: React.RefObject<any>;
  /** Current render mode from app settings (or local debug toggle). */
  mode: FogRenderMode;
}

/**
 * Side-effect hook: attach / update the native fog layer based on the
 * memory store's unlock points + chosen mode. Returns nothing — pure
 * effect. Caller renders an `<FogLayer />` only when mode === 'legacy'.
 */
export function useMemoryFogControl({ mapViewRef, mode }: Props) {
  // Subscribe to geometry version so any unlock causes re-upload.
  const geometryVersion = useMemoryStore((s) => s.geometryVersion);
  const attachedRef = useRef(false);

  // iOS only — Android stub will accept calls but render nothing.
  // We still call through so Android isn't silently broken.
  const supported = Platform.OS === 'ios';
  const isNativeMode = mode === 'sdf-soft' || mode === 'sdf-sharp' || mode === 'off';

  useEffect(() => {
    if (!supported) return;
    // v303 subagent fix B3: detach the native Metal layer when switching
    // back to legacy. Without this, Metal keeps drawing on top of the
    // legacy polygon → double fog visible.
    if (!isNativeMode) {
      if (attachedRef.current) {
        const node = findNodeHandle(mapViewRef.current);
        if (node != null) {
          Fog.removeFogLayer(node).catch((e: any) => {
            log('memory.fog_native_remove_error', {
              where: 'mode_change',
              msg: String(e?.message ?? e).slice(0, 500),
            });
          });
          log('memory.fog_native_detached_on_mode_change');
        }
        attachedRef.current = false;
      }
      return;
    }
    const node = findNodeHandle(mapViewRef.current);
    log('memory.fog_native_handle_resolved', { node, hasRef: !!mapViewRef.current, mode });
    if (node == null) {
      log('memory.fog_native_no_handle', { mode });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        if (!attachedRef.current) {
          // Set flag BEFORE await so rapid mode toggles don't re-enter
          // addFogLayer (subagent fix: race in attachedRef).
          attachedRef.current = true;
          try {
            await Fog.addFogLayer(node);
          } catch (e: any) {
            attachedRef.current = false;
            const msg = String(e?.message ?? e).slice(0, 500);
            log('memory.fog_native_add_error', { msg });
            // v303 二轮 subagent #2 critical fix: auto-fallback to
            // legacy on attach failure. Otherwise the user sees a
            // clean map with no fog at all and no indication anything
            // is wrong. setSetting persists, so next launch also
            // stays on legacy until the user explicitly tries SDF.
            log('memory.fog_native_auto_fallback_to_legacy', { reason: 'attach_failed' });
            useMemorySettingsStore.getState().set('fogMode', 'legacy');
            return;
          }
          if (cancelled) return;
          log('memory.fog_native_attached', { reactTag: node, mode });
          // v303 subagent #3 fix: pipeline-ready ping. Mapbox calls
          // renderingWillStart on the render thread AFTER our promise
          // resolved — silent shader/pipeline failures wouldn't surface.
          // Ping 1.2s later, log the status so server-side debug can
          // catch the failure without device log.
          setTimeout(() => {
            if (cancelled) return;
            Fog.isPipelineReady(node).then((status) => {
              log('memory.fog_native_pipeline_ping', status as any);
              // v303 二轮 subagent #2: if pipeline didn't actually
              // build (silent Swift failure), auto-fallback to legacy
              // so user sees fog.
              if (!status?.ready) {
                log('memory.fog_native_auto_fallback_to_legacy', {
                  reason: 'pipeline_not_ready',
                  libSource: status?.libSource,
                  err: status?.pipelineError,
                });
                useMemorySettingsStore.getState().set('fogMode', 'legacy');
              }
            }).catch((e: any) => {
              log('memory.fog_native_pipeline_ping_error', { msg: String(e?.message ?? e).slice(0, 200) });
            });
          }, 1200);
        }
        if (cancelled) return;
        try {
          await Fog.setMode(node, mode === 'off' ? 'off' : mode);
        } catch (e: any) {
          log('memory.fog_native_setmode_error', { mode, msg: String(e?.message ?? e).slice(0, 500) });
          return;
        }
        if (cancelled) return;
        // Upload current circle set.
        const points = useMemoryStore.getState().points;
        const circles = points.slice(0, 256).map((p) => ({
          lat: p.lat,
          lng: p.lng,
          radius: UnlockConfig.radiusMeters,
          bornAt: p.t ?? 0,
        }));
        try {
          await Fog.updateCircles(node, circles);
        } catch (e: any) {
          log('memory.fog_native_circles_error', { count: circles.length, msg: String(e?.message ?? e).slice(0, 500) });
          return;
        }
        if (cancelled) return;
        log('memory.fog_native_circles_uploaded', { count: circles.length });
      } catch (e: any) {
        log('memory.fog_native_error', { msg: String(e?.message ?? e).slice(0, 500) });
        // Reset attached flag on failure so next attempt re-tries.
        attachedRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, geometryVersion, isNativeMode, supported]);

  // Detach on full unmount.
  useEffect(() => {
    return () => {
      if (!attachedRef.current) return;
      const node = findNodeHandle(mapViewRef.current);
      if (node == null) return;
      Fog.removeFogLayer(node).catch((e: any) => {
        log('memory.fog_native_remove_error', { where: 'unmount', msg: String(e?.message ?? e).slice(0, 200) });
      });
      attachedRef.current = false;
      log('memory.fog_native_detached');
    };
  }, [mapViewRef]);
}
