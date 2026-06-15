/**
 * unityCairnSpawn — RN → Unity bridge utilities for spawning cairns in AR.
 *
 * Phase 2 wiring of UnityAROverlay's previously-stub `cairns: []`. Unity side
 * receivers (CairnBridge.OnSpawnStrand / OnClearAll) are already in the
 * shipped framework binary (verified by inspecting global-metadata.dat in the
 * production IPA). All wiring here is RN-only → ships via OTA.
 *
 * Coordinate conversion contract:
 *   Unity / ARKit GravityAndHeading axes
 *     +X = East
 *     +Y = up (gravity-aligned)
 *     -Z = North
 *   GPS → ARKit local world space, given an arkitOrigin (the lat/lng/alt
 *   that ARKit anchored at session start):
 *     dN = (markerLat  - origin.lat) * 111_000                              // metres North
 *     dE = (markerLng  - origin.lng) * 111_000 * cos(origin.lat * π/180)    // metres East
 *     x  =  dE
 *     z  = -dN
 *   This is the inverse of ARScreen.handlePlantCairn's lat/lng compute,
 *   keeping plant→render perfectly round-tripping (cairn renders exactly
 *   where the user aimed).
 *
 *   y is the cairn's vertical position. Use the detected ground plane y
 *   when available (so cairns sit on the floor, not float at camera eye
 *   level); fall back to 0 if no plane yet.
 */

import type { MarkerType } from '../config/markerTypes';
// v0.2.4 Phase 3 — debugLogger 把 v22-PHASE3-* breadcrumb 推到 telemetry pipeline
// (console.log 不进 telemetry,subagent#2 BLOCKER fix)
import { debugLogger } from './debugLogger';

/**
 * Wire-format expected by Unity's CairnBridge.SpawnRequest:
 *   { id, type, x, y, z, r, g, b, scrollSpeed, bloomBoost }
 * Verified against UnityARLib/Assets/Scripts/CairnBridge.cs.
 *
 * v186: `type` field added. Unity's CairnTypePresets uses the type to
 * look up the per-type baseline (color, scroll, bloom, fresnel, halo,
 * particles); RN-supplied fields override individual baselines. Pass
 * the marker's MarkerType string ('danger' | 'junction' | 'water' |
 * 'hut' | 'cairn').
 */
export interface UnitySpawnRequest {
  id: string;
  type: string;    // v186 — see CairnTypePresets.cs
  x: number;
  y: number;
  z: number;
  r: number;       // 0..1 — overrides type preset color when > 0
  g: number;
  b: number;
  scrollSpeed: number;
  bloomBoost: number;
  note?: string;   // v187 — optional ≤30-char user mark text rendered above the cairn
  // v0.2.4 Part 2 B2 修(用户铁律 "plant 在哪 cairn 永远在哪"):
  // tier='A' = ARKit world XYZ 已是当前 session ARKit world frame 真坐标
  //   → Unity 端禁止再叠加 sessionOffset (会让 cairn 飘 2-5m 或堆出发点)
  // tier='B' = GPS+geoToArkitWorld 反算的近似坐标
  //   → Unity 端必须叠加 sessionOffset 补偿 arOrigin 漂移
  tier: 'A' | 'B';
}

/**
 * Marker type → strand colour. v186 values match Unity's CairnTypePresets
 * — keep the two in sync. Per-type identity colors are MORE saturated
 * than the v185 map-pin colors because additive shader output looks
 * washed-out without high saturation.
 *
 * Returned as 0..1 floats for Unity's MaterialPropertyBlock _BaseColor.
 *
 * Hex literals are inlined (rather than imported from tokens.ts) to keep
 * this helper independent of the React component tree. RN can still
 * choose to override per-spawn — Unity's preset is the baseline,
 * `data.r/g/b > 0` overrides.
 */
export function markerTypeToColor(type: MarkerType | string): { r: number; g: number; b: number } {
  // v186 DS palette — must match CairnTypePresets.cs colors.
  const HEX: Record<string, string> = {
    danger:   '#FF2A1A',
    junction: '#FFB347',
    water:    '#5AE6FF',
    hut:      '#D4A06B',
    cairn:    '#E8C896',
  };
  const hex = HEX[type] ?? HEX.cairn;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return { r, g, b };
}

/**
 * Per-type strand shader params. v186 values match CairnTypePresets.cs.
 * These are the BASELINES Unity uses; sending 0 from RN means "use
 * Unity's preset", non-zero overrides individual fields.
 */
export function markerTypeToShaderParams(type: MarkerType | string): {
  scrollSpeed: number;
  bloomBoost: number;
} {
  switch (type) {
    case 'danger':   return { scrollSpeed: 1.6, bloomBoost: 3.5 };
    case 'junction': return { scrollSpeed: 0.7, bloomBoost: 3.0 };
    case 'water':    return { scrollSpeed: 0.45, bloomBoost: 2.2 };
    case 'hut':      return { scrollSpeed: 0.35, bloomBoost: 2.0 };
    case 'cairn':
    default:         return { scrollSpeed: 0.6, bloomBoost: 2.5 };
  }
}

/**
 * Convert a marker GPS lat/lng to ARKit world-space (x, z) given the ARKit
 * session's anchored GPS origin. y is supplied separately (use ground plane
 * if available).
 *
 * Returns null if origin is missing — caller should defer the spawn until
 * ARKit reports an origin via ArFrame.
 */
export function geoToArkitWorld(
  markerLat: number,
  markerLng: number,
  origin: { lat: number; lng: number } | null,
): { x: number; z: number } | null {
  if (!origin) return null;
  const dN = (markerLat - origin.lat) * 111_000;
  const dE = (markerLng - origin.lng) * 111_000 * Math.cos(origin.lat * Math.PI / 180);
  // GravityAndHeading: +X = East, -Z = North → z = -dN
  return { x: dE, z: -dN };
}

/**
 * Build a SpawnRequest payload for a marker. Returns null if the marker
 * cannot be positioned yet (no AR origin). Caller should retry once
 * ArFrame populates origin.
 *
 * v186: includes `type` field — Unity uses it for CairnTypePresets
 * lookup. RN's r/g/b fields override the preset color when > 0.
 */
/**
 * Build a SpawnRequest payload for a marker. Returns null if the marker
 * cannot be positioned yet (no AR origin). Caller should retry once
 * ArFrame populates origin.
 *
 * v186: includes `type` field — Unity uses it for CairnTypePresets
 * lookup. RN's r/g/b fields override the preset color when > 0.
 *
 * v0.2.4 Part 2 A2.3: Tier-A 优先 ARKit XYZ
 * - 用户原话:"AR plant 的 mark 没用 arkit 的世界坐标 用的是 GPS 所以每次打开都飘逸"
 * - 若 marker 有 arkitX/Y/Z + arOriginLat/Lng,且当前 origin 跟 plant-time origin
 *   偏差 < ARKIT_XYZ_TIER_A_MAX_DELTA_M(默认 5m),直接用持久化 ARKit XYZ
 * - 否则 fallback geoToArkitWorld GPS 路径(行为同旧 v0.2.3)
 * - 5m 阈值理由:典型 ARKit world frame cross-session drift ≤ 2-3m,5m 给余量。
 *   超过 5m 表示用户重新 GPS lock 或 ARSession 重启,持久化的 ARKit XYZ 不再可信。
 */
const ARKIT_XYZ_TIER_A_MAX_DELTA_M = 5.0;
// v0.2.4 R2.3 fix: 当 origin 是低 GPS accuracy (10-25m) 锁的,GPS 反算
// 误差被放大,Tier-A 阈值必须收紧。原 5m 阈值是基于 normal accuracy GPS
// (±3-8m) 推算;低精度时 (±18m) 同 5m 阈值会让一个 origin 误差 18m 的
// 锁覆盖 5m 内的 cairn → cairn 走 Tier-A ARKit XYZ 路径但 ARKit XYZ 自己
// 也可能因低精度 GPS 锁错而错位。收紧到 2m,逼用户走更近的位置 / 重锁 origin。
const ARKIT_XYZ_TIER_A_MAX_DELTA_M_LOW_ACC = 2.0;

export function buildSpawnRequest(
  marker: {
    id: string;
    type: string;
    lat: number;
    lng: number;
    note?: string;
    arkitX?: number;
    arkitY?: number;
    arkitZ?: number;
    arOriginLat?: number;
    arOriginLng?: number;
  },
  origin: { lat: number; lng: number; lowAccuracy?: boolean } | null,
  groundY: number | null,
): UnitySpawnRequest | null {
  const colour = markerTypeToColor(marker.type);
  const shader = markerTypeToShaderParams(marker.type);
  const note = [...(marker.note ?? '')].slice(0, 30).join('');

  // v0.2.4 Part 2 A2.3 Tier-A: ARKit XYZ 直接用(同 origin)
  if (
    origin != null &&
    marker.arkitX != null && marker.arkitY != null && marker.arkitZ != null &&
    marker.arOriginLat != null && marker.arOriginLng != null
  ) {
    // 计算两个 origin 间的 XZ 距离(米),用 cosLat 近似
    const cosLat = Math.cos((origin.lat * Math.PI) / 180);
    const dN = (origin.lat - marker.arOriginLat) * 111_000;
    const dE = (origin.lng - marker.arOriginLng) * 111_000 * cosLat;
    const originDeltaM = Math.hypot(dN, dE);
    // v0.2.4 R2.3: 低精度 origin 收紧 Tier-A 阈值 (5→2m)
    const tierAMaxDelta = origin.lowAccuracy
      ? ARKIT_XYZ_TIER_A_MAX_DELTA_M_LOW_ACC
      : ARKIT_XYZ_TIER_A_MAX_DELTA_M;
    if (originDeltaM <= tierAMaxDelta) {
      // A2.4 埋点:Tier-A 命中(用户原话"对账"用)
      console.log(`[v22-PLANT-ANCHOR-TIER-A] id=${marker.id} originDelta=${originDeltaM.toFixed(2)}m thresh=${tierAMaxDelta}m lowAcc=${!!origin.lowAccuracy} arkit=(${marker.arkitX.toFixed(2)},${marker.arkitY.toFixed(2)},${marker.arkitZ.toFixed(2)})`);
      // v0.2.4 Phase 3 LOG: subagent#2 BLOCKER 检测 — origin 不变但 ARKit world frame
      // 重置时,Tier-A 错命中导致 cairn 用旧坐标在新 frame 飞天。emit 完整决策上下文
      // 真机回来对账,如果用户报飞天但 originDelta 一直 0,说明 ARKit relocalize 是根因。
      // ⚠️ subagent#2 BLOCKER fix: console.log 不进 telemetry pipeline,必须用 debugLogger.log 才上传
      debugLogger.log({
        event: 'breadcrumb',
        tag: 'v22-PHASE3-TIER-DECISION',
        ts: Date.now(),
        payload: {
          decision: 'A',
          marker_id: marker.id,
          origin_delta_m: parseFloat(originDeltaM.toFixed(3)),
          thresh_m: tierAMaxDelta,
          low_acc: !!origin.lowAccuracy,
          marker_origin_lat: marker.arOriginLat ?? null,
          marker_origin_lng: marker.arOriginLng ?? null,
          current_origin_lat: origin.lat,
          current_origin_lng: origin.lng,
          marker_arkit_x: parseFloat(marker.arkitX.toFixed(3)),
          marker_arkit_y: parseFloat(marker.arkitY.toFixed(3)),
          marker_arkit_z: parseFloat(marker.arkitZ.toFixed(3)),
          warn_arkit_frame_reset_if_relaunched: 1,
        },
      });
      return {
        id: marker.id,
        type: marker.type,
        x: marker.arkitX,
        y: marker.arkitY,
        z: marker.arkitZ,
        r: colour.r,
        g: colour.g,
        b: colour.b,
        scrollSpeed: shader.scrollSpeed,
        bloomBoost: shader.bloomBoost,
        note,
        tier: 'A',
      };
    }
    // A2.4 埋点:origin delta 太大,Tier-A 拒绝
    console.log(`[v22-PLANT-ANCHOR-TIER-A-REJECT] id=${marker.id} originDelta=${originDeltaM.toFixed(2)}m > ${tierAMaxDelta}m lowAcc=${!!origin.lowAccuracy} → fallback Tier-B`);
    // v0.2.4 Phase 3 LOG: Tier-A reject 完整决策上下文(via debugLogger 进 telemetry)
    debugLogger.log({
      event: 'breadcrumb',
      tag: 'v22-PHASE3-TIER-DECISION',
      ts: Date.now(),
      payload: {
        decision: 'B-from-A-reject',
        marker_id: marker.id,
        reason: 'originDeltaTooBig',
        origin_delta_m: parseFloat(originDeltaM.toFixed(3)),
        thresh_m: tierAMaxDelta,
        marker_origin_lat: marker.arOriginLat ?? null,
        marker_origin_lng: marker.arOriginLng ?? null,
        current_origin_lat: origin.lat,
        current_origin_lng: origin.lng,
      },
    });
    // origin delta 太大 → 持久化 ARKit XYZ 不再可信,fallback GPS
  }

  // Tier-B: GPS+geoToArkitWorld(原 v0.2.3 路径)
  const xz = geoToArkitWorld(marker.lat, marker.lng, origin);
  if (!xz) return null;
  // A2.4 埋点:Tier-B fallback(无 arkitXYZ 或 origin 漂移)
  // v0.2.4 Phase 3 LOG: subagent A BLOCKER fix — schema migration silent gap。
  // 老 marker (v0.2.3 之前 plant) 永走 Tier-B,'no-arkit-xyz' 进一步区分:
  //   legacy_no_origin: 老 schema 完全没 arkit*  字段
  //   no_arkit_xyz_partial: 部分字段缺(异常)
  let tierBReason: string;
  if (marker.arkitX == null && marker.arkitY == null && marker.arkitZ == null && marker.arOriginLat == null) {
    tierBReason = 'legacy_no_arkit_v023_or_earlier';
  } else if (marker.arkitX == null || marker.arkitY == null || marker.arkitZ == null) {
    tierBReason = 'partial_arkit_xyz_anomaly';
  } else {
    tierBReason = 'origin_delta_exceeded';
  }
  console.log(`[v22-PLANT-ANCHOR-TIER-B] id=${marker.id} reason=${tierBReason} gps=(${marker.lat.toFixed(5)},${marker.lng.toFixed(5)}) xz=(${xz.x.toFixed(2)},${xz.z.toFixed(2)}) y=${(groundY ?? 0).toFixed(2)}`);
  // v0.2.4 Phase 3 — Tier-B 也走 debugLogger.log 进 telemetry pipeline
  debugLogger.log({
    event: 'breadcrumb',
    tag: 'v22-PHASE3-TIER-DECISION',
    ts: Date.now(),
    payload: {
      decision: 'B',
      marker_id: marker.id,
      reason: tierBReason,
      gps_lat: marker.lat,
      gps_lng: marker.lng,
      x: parseFloat(xz.x.toFixed(3)),
      z: parseFloat(xz.z.toFixed(3)),
      y: parseFloat((groundY ?? 0).toFixed(3)),
      ground_y_null: groundY == null ? 1 : 0,
    },
  });
  return {
    id: marker.id,
    type: marker.type,
    x: xz.x,
    y: groundY ?? 0,
    z: xz.z,
    r: colour.r,
    g: colour.g,
    b: colour.b,
    scrollSpeed: shader.scrollSpeed,
    bloomBoost: shader.bloomBoost,
    note,
    tier: 'B',
  };
}
