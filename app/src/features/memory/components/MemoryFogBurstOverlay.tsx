/**
 * MemoryFogBurstOverlay — Skia 解锁扩散动画 overlay。
 *
 * 视觉效果(产品需求 "2D 游戏丝滑解锁感"):
 *   用户走一步 → 用户脚下出现暖米色光圈 → 0.8s 内从 0 扩散到 25m
 *   半径 → 同时颜色从不透明渐变到透明 → 自然融入底下已更新的 fog。
 *
 * 数据流:
 *   useMemoryStore.recentUnlocks (lat/lng/ts) →
 *   getPointInView 拿屏幕坐标 cache →
 *   Skia Canvas 每帧画 (cached_x, cached_y, age)
 *
 * 跟 v303 native fog 协同:
 *   - native fog 跑在底下(Mapbox CustomLayerHost),不画 burst
 *   - 本组件在 Mapbox 上面 absoluteFill 画 burst
 *   - 7/1 native build 上线后保留本组件,接口不变(recentUnlocks)
 *
 * 性能:
 *   - useFrameCallback 60fps,只画 < 8 个圆(0.8s × 慢走 8 步)
 *   - getPointInView 只在 unlock push 那一刻调用一次,cache 后只读
 *   - Skia 渲染独立线程(react-native-skia 2.x 默认)
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMemoryStore } from '../store/useMemoryStore';

// v303 OTA: Skia 是 native module。当前 production build 里带 skia 2.2.12
// (来自 Cairn 最早 scaffold)。但生产里如果 skia native binary 出问题,
// 不能让 import 把整个 memory 屏幕崩掉。lazy require + try/catch 降级:
// 失败时本组件返回 null,memo 屏幕正常显示 fog 不显示 burst 动画。
let SkiaModule: { Canvas: any; Circle: any; Group: any } | null = null;
let skiaLoadError: Error | null = null;
function tryLoadSkia() {
  if (SkiaModule || skiaLoadError) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@shopify/react-native-skia');
    SkiaModule = { Canvas: mod.Canvas, Circle: mod.Circle, Group: mod.Group };
  } catch (e: any) {
    skiaLoadError = e instanceof Error ? e : new Error(String(e));
  }
}

interface Props {
  /** Ref to the @rnmapbox/maps MapView — used to project lat/lng → screen px. */
  mapViewRef: React.RefObject<any>;
}

interface CachedBurst {
  lat: number;
  lng: number;
  ts: number;        // bornAt epoch ms (跟 v303 native 一致)
  x: number | null;  // screen px, null 表示还没 project 完
  y: number | null;
}

const BURST_DURATION_MS = 800;    // 一次 burst 总时长
const BURST_MAX_RADIUS_PX = 60;   // 屏幕像素最大半径(25m @ zoom 16 大概这个数量级,
                                  // 不精确没关系 — 这是视觉效果,不是几何门)
const BURST_START_OPACITY = 0.55;

export function MemoryFogBurstOverlay({ mapViewRef }: Props) {
  // v303 OTA: Skia 失败时下面所有 hook 仍正常调用(rules-of-hooks),
  // 只是 render 返回 null。
  tryLoadSkia();
  // 订阅 recentUnlocks(只在 length 变化时 re-render,避免每帧)
  const recentUnlocks = useMemoryStore((s) => s.recentUnlocks);
  // cache 每个 burst 的 screen px,key by ts(ts 在 store 里唯一)
  const cacheRef = useRef<Map<number, CachedBurst>>(new Map());
  // 强制 re-render 触发帧动画的 tick
  const [tick, setTick] = useState(0);

  // 1. 新 unlock 进来 → 立刻调用 mapView.getPointInView 拿屏幕坐标
  useEffect(() => {
    const map = mapViewRef.current;
    if (!map || typeof map.getPointInView !== 'function') return;
    const cache = cacheRef.current;
    // 清理已经过期的 cache entries
    const now = Date.now();
    for (const [ts, entry] of cache) {
      if (now - entry.ts > BURST_DURATION_MS + 200) cache.delete(ts);
    }
    // 新 entries 异步 project
    for (const u of recentUnlocks) {
      if (cache.has(u.ts)) continue;
      const entry: CachedBurst = { ...u, x: null, y: null };
      cache.set(u.ts, entry);
      // getPointInView 返回 Promise<[x, y]>(rnmapbox 11+)
      Promise.resolve(map.getPointInView([u.lng, u.lat])).then((pt: any) => {
        if (Array.isArray(pt) && pt.length === 2) {
          entry.x = pt[0];
          entry.y = pt[1];
        }
      }).catch(() => { /* mapview unmounted or projection failed — drop */ });
    }
  }, [recentUnlocks, mapViewRef]);

  // 3. 计算当前帧每个 burst 的 (x, y, radius, opacity)
  const visible = useMemo(() => {
    const now = Date.now();
    const out: Array<{ key: number; x: number; y: number; radius: number; opacity: number }> = [];
    for (const entry of cacheRef.current.values()) {
      if (entry.x == null || entry.y == null) continue;
      const age = now - entry.ts;
      if (age < 0 || age > BURST_DURATION_MS) continue;
      const t = age / BURST_DURATION_MS; // 0..1
      // ease-out 扩散:r = max * (1 - (1-t)^2)
      const radius = BURST_MAX_RADIUS_PX * (1 - (1 - t) * (1 - t));
      // 透明度:开头一段 ramp up,后段 fade out;近似 sin(pi*t) 但简化:
      const opacity = BURST_START_OPACITY * (1 - t);
      out.push({ key: entry.ts, x: entry.x, y: entry.y, radius, opacity });
    }
    return out;
    // tick 是为了每帧 recompute;recentUnlocks 触发 cache add
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, recentUnlocks]);

  // 2. 动画 tick — visible 非空时 16ms 一帧 setTick;空时停。
  // 关键:不能用 cacheRef.size 作为 stop 判定(useRef 不上报 React)。
  // 这里把 visible.length 暴露给 effect closure via ref,每帧检查空 → 停。
  const visibleCountRef = useRef(0);
  visibleCountRef.current = visible.length;
  useEffect(() => {
    if (recentUnlocks.length === 0) return;
    let raf: any;
    const loop = () => {
      setTick((t) => (t + 1) % 1_000_000);
      if (visibleCountRef.current === 0 && cacheRef.current.size === 0) return;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [recentUnlocks.length]);

  if (visible.length === 0) return null;
  if (!SkiaModule) return null;
  const { Canvas, Circle, Group } = SkiaModule;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Canvas style={StyleSheet.absoluteFill}>
        <Group>
          {visible.map((b) => (
            // 双层圆:外层柔光淡米色 + 内层亮一点的核
            <React.Fragment key={b.key}>
              <Circle
                cx={b.x}
                cy={b.y}
                r={b.radius}
                color={`rgba(247, 232, 195, ${b.opacity})`}
              />
              <Circle
                cx={b.x}
                cy={b.y}
                r={b.radius * 0.55}
                color={`rgba(255, 245, 220, ${b.opacity * 0.6})`}
              />
            </React.Fragment>
          ))}
        </Group>
      </Canvas>
    </View>
  );
}
