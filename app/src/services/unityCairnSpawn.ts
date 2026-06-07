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
export function buildSpawnRequest(
  marker: { id: string; type: string; lat: number; lng: number },
  origin: { lat: number; lng: number } | null,
  groundY: number | null,
): UnitySpawnRequest | null {
  const xz = geoToArkitWorld(marker.lat, marker.lng, origin);
  if (!xz) return null;
  const colour = markerTypeToColor(marker.type);
  const shader = markerTypeToShaderParams(marker.type);
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
  };
}
