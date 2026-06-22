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

// v303 四轮 subagent #2 fix (Critical #5): 3 次连续失败才 persist 'legacy'。
// 单次失败可能是 Mapbox 还没真正跑过帧(用户没移动地图)的假阴 — 不能因为
// 一次假阴就把用户永久踢出 SDF。
const MAX_CONSECUTIVE_FALLBACKS = 3;
// 8s 比 5s 给 Mapbox 更长时间真正调一次 render()。
const PIPELINE_PING_DELAY_MS = 8000;

/**
 * Side-effect hook: attach / update the native fog layer based on the
 * memory store's unlock points + chosen mode. Returns nothing — pure
 * effect. Caller renders an `<FogLayer />` only when mode === 'legacy'.
 */
export function useMemoryFogControl({ mapViewRef, mode }: Props) {
  // Subscribe to geometry version so any unlock causes re-upload.
  const geometryVersion = useMemoryStore((s) => s.geometryVersion);
  const attachedRef = useRef(false);
  // v303 四轮 fix: capture last good node 给 unmount cleanup 用 — 那时
  // mapViewRef.current 可能已经 null。
  const lastNodeRef = useRef<number | null>(null);
  // v303 四轮 fix Critical #5: in-memory fallback 计数,3 次失败才 persist。
  const fallbackAttemptsRef = useRef(0);
  // v303 四轮 fix Serious: session-only 标记,本次 session 已经判定 native
  // 不行,effect 直接走 detach 路径不再 re-attach。下次 app 启动重置。
  const sessionGiveUpRef = useRef(false);

  // iOS only — Android 没 autolink 这个原生 module。
  const supported = Platform.OS === 'ios';
  const isNativeMode = (mode === 'sdf-soft' || mode === 'sdf-sharp' || mode === 'off') && !sessionGiveUpRef.current;

  // Helper: 累计 fallback,达阈值才 persist。
  const tryFallbackToLegacy = (reason: string, extra: Record<string, any>) => {
    fallbackAttemptsRef.current += 1;
    const attempts = fallbackAttemptsRef.current;
    log('memory.fog_native_fallback_candidate', { reason, attempts, ...extra });
    if (attempts >= MAX_CONSECUTIVE_FALLBACKS) {
      log('memory.fog_native_auto_fallback_to_legacy', { reason, attempts, ...extra });
      useMemorySettingsStore.getState().set('fogMode', 'legacy');
      fallbackAttemptsRef.current = 0; // reset 以防再次循环
    } else {
      // session-only:本次先停 SDF,不 persist。用户重新点 pill 会重试。
      sessionGiveUpRef.current = true;
    }
  };

  // Helper: pipeline 准备就绪检查 — 如果 !ready,先 kick Mapbox 重画再 ping
  // 一次,过滤"Mapbox 没主动 redraw 导致 renderFrameCount=0"的假阴。
  const checkPipelineWithKick = async (node: number, m: FogRenderMode) => {
    try {
      const status = await Fog.isPipelineReady(node);
      log('memory.fog_native_pipeline_ping', { ...status, mode: m } as any);
      if (status?.ready) {
        fallbackAttemptsRef.current = 0; // 成功 → 重置失败计数
        return;
      }
      // 假阴 kick:Mapbox 在用户没动作时不主动 redraw。我们通过 setRipple
      // 一次 toggle 强制下一帧重画(setRipple 改 uniform 仅 noop 也算
      // dirty)。然后 2s 后再 ping 一次。
      try {
        await Fog.setRipple(node, true);
        await Fog.setRipple(node, false);
      } catch {/* ignore — best-effort kick */}
      await new Promise((r) => setTimeout(r, 2000));
      const status2 = await Fog.isPipelineReady(node);
      log('memory.fog_native_pipeline_ping_retry', { ...status2, mode: m } as any);
      if (status2?.ready) {
        fallbackAttemptsRef.current = 0;
        return;
      }
      tryFallbackToLegacy('pipeline_not_ready_after_kick', {
        libSource: status2?.libSource,
        err: status2?.pipelineError,
        pipelineBuilt: (status2 as any)?.pipelineBuilt,
        renderFrameCount: status2?.renderFrameCount,
      });
    } catch (e: any) {
      log('memory.fog_native_pipeline_ping_error', { msg: String(e?.message ?? e).slice(0, 200) });
    }
  };

  useEffect(() => {
    if (!supported) return;
    // v303 subagent fix B3: detach the native Metal layer when switching
    // back to legacy. Without this, Metal keeps drawing on top of the
    // legacy polygon → double fog visible.
    if (!isNativeMode) {
      if (attachedRef.current) {
        const node = lastNodeRef.current ?? findNodeHandle(mapViewRef.current);
        if (node != null) {
          // v303 四轮 fix Serious: await removeFogLayer 完成才设 attachedRef
          // = false,否则 sdf→legacy→sdf 50ms 内连点会让 add/remove 在
          // native 端打架。
          (async () => {
            try {
              await Fog.removeFogLayer(node);
              log('memory.fog_native_detached_on_mode_change');
            } catch (e: any) {
              log('memory.fog_native_remove_error', {
                where: 'mode_change',
                msg: String(e?.message ?? e).slice(0, 500),
              });
            } finally {
              attachedRef.current = false;
            }
          })();
        } else {
          attachedRef.current = false;
        }
      }
      return;
    }
    const node = findNodeHandle(mapViewRef.current);
    log('memory.fog_native_handle_resolved', { node, hasRef: !!mapViewRef.current, mode });
    if (node == null) {
      log('memory.fog_native_no_handle', { mode });
      return;
    }
    lastNodeRef.current = node;
    let cancelled = false;
    let pingTimer: ReturnType<typeof setTimeout> | null = null;
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
            // v303 四轮 fix Critical #5: attach 失败也走计数器路径,不是
            // 立刻 persist。冷启动 race(expo-modules-core registry 还
            // 没 ready)是常见 transient 故障。
            tryFallbackToLegacy('attach_failed', { msg });
            return;
          }
          if (cancelled) return;
          log('memory.fog_native_attached', { reactTag: node, mode });
        }
        if (cancelled) return;
        // v303 四轮 fix Nitpick #1: mode === 'off' ? 'off' : mode 是冗余
        // (isNativeMode 已 filter 'legacy'),直接传 mode。
        try {
          await Fog.setMode(node, mode as 'off' | 'sdf-soft' | 'sdf-sharp');
          log('memory.fog_native_setmode_ok', { mode });
        } catch (e: any) {
          log('memory.fog_native_setmode_error', { mode, msg: String(e?.message ?? e).slice(0, 500) });
          return;
        }
        if (cancelled) return;
        // Upload current circle set.
        // v303 四轮 subagent #2 fix (Critical #6): slice(-256) 取最新 unlock。
        const allPoints = useMemoryStore.getState().points;
        const points = allPoints.length > 256 ? allPoints.slice(-256) : allPoints;
        const circles = points.map((p) => ({
          lat: p.lat,
          lng: p.lng,
          radius: UnlockConfig.radiusMeters,
          bornAt: p.ts ?? 0,
        }));
        try {
          await Fog.updateCircles(node, circles);
        } catch (e: any) {
          log('memory.fog_native_circles_error', { count: circles.length, msg: String(e?.message ?? e).slice(0, 500) });
          return;
        }
        if (cancelled) return;
        log('memory.fog_native_circles_uploaded', { count: circles.length });

        // v303 四轮 fix Critical #5: 8s 给 Mapbox 真的 render 时间;ping
        // 不 ready 时先 kick 一次 (setRipple toggle)再 2s 后 retry。
        pingTimer = setTimeout(() => {
          if (cancelled) return;
          void checkPipelineWithKick(node, mode);
        }, PIPELINE_PING_DELAY_MS);
      } catch (e: any) {
        log('memory.fog_native_error', { msg: String(e?.message ?? e).slice(0, 500) });
        // Reset attached flag on failure so next attempt re-tries.
        attachedRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
      if (pingTimer != null) {
        clearTimeout(pingTimer);
        pingTimer = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, geometryVersion, isNativeMode, supported]);

  // Detach on full unmount.
  useEffect(() => {
    return () => {
      if (!attachedRef.current) return;
      // v303 四轮 fix Critical #3: 用 lastNodeRef,unmount 时 mapViewRef
      // 可能已经 null。
      const node = lastNodeRef.current;
      if (node == null) {
        attachedRef.current = false;
        return;
      }
      Fog.removeFogLayer(node).catch((e: any) => {
        log('memory.fog_native_remove_error', { where: 'unmount', msg: String(e?.message ?? e).slice(0, 200) });
      });
      attachedRef.current = false;
      log('memory.fog_native_detached');
    };
  }, []);
}
