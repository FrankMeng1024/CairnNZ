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
  origin: { lat: number; lng: number } | null,
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
    if (originDeltaM <= ARKIT_XYZ_TIER_A_MAX_DELTA_M) {
      // A2.4 埋点:Tier-A 命中(用户原话"对账"用)
      console.log(`[v22-PLANT-ANCHOR-TIER-A] id=${marker.id} originDelta=${originDeltaM.toFixed(2)}m arkit=(${marker.arkitX.toFixed(2)},${marker.arkitY.toFixed(2)},${marker.arkitZ.toFixed(2)})`);
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
      };
    }
    // A2.4 埋点:origin delta 太大,Tier-A 拒绝
    console.log(`[v22-PLANT-ANCHOR-TIER-A-REJECT] id=${marker.id} originDelta=${originDeltaM.toFixed(2)}m > ${ARKIT_XYZ_TIER_A_MAX_DELTA_M}m → fallback Tier-B`);
    // origin delta 太大 → 持久化 ARKit XYZ 不再可信,fallback GPS
  }

  // Tier-B: GPS+geoToArkitWorld(原 v0.2.3 路径)
  const xz = geoToArkitWorld(marker.lat, marker.lng, origin);
  if (!xz) return null;
  // A2.4 埋点:Tier-B fallback(无 arkitXYZ 或 origin 漂移)
  const tierBReason = (marker.arkitX == null) ? 'no-arkit-xyz' : 'origin-delta-exceeded';
  console.log(`[v22-PLANT-ANCHOR-TIER-B] id=${marker.id} reason=${tierBReason} gps=(${marker.lat.toFixed(5)},${marker.lng.toFixed(5)}) xz=(${xz.x.toFixed(2)},${xz.z.toFixed(2)}) y=${(groundY ?? 0).toFixed(2)}`);
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
  };
}
