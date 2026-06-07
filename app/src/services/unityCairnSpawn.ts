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
 *   { id, x, y, z, r, g, b, scrollSpeed, bloomBoost }
 * Verified against UnityARLib/Assets/Scripts/CairnBridge.cs:584.
 */
export interface UnitySpawnRequest {
  id: string;
  x: number;
  y: number;
  z: number;
  r: number;       // 0..1
  g: number;       // 0..1
  b: number;       // 0..1
  scrollSpeed: number;
  bloomBoost: number;
}

/**
 * Marker type → strand colour. Hex sourced from src/components/tokens.ts so
 * AR rendering matches map pin colours. Returned as 0..1 floats — the format
 * Unity's MaterialPropertyBlock _BaseColor expects.
 *
 * Hex literals are inlined (rather than imported from tokens.ts) to keep this
 * helper independent of the React component tree — callable from anywhere
 * including non-React contexts (e.g. background tasks). If tokens.ts changes
 * the source-of-truth colours, update both.
 */
export function markerTypeToColor(type: MarkerType | string): { r: number; g: number; b: number } {
  // Hex from tokens.ts. Keep in sync if those change.
  const HEX: Record<string, string> = {
    danger:   '#c53d2e',  // Colors.danger
    junction: '#F26522',  // Colors.docOrange
    water:    '#2e8c3a',  // Colors.success
    hut:      '#b5823d',  // Colors.trail (sepia)
    cairn:    '#b5823d',  // Colors.trail (sepia)
  };
  const hex = HEX[type] ?? HEX.cairn;
  // #RRGGBB → floats. parseInt with substring + bitshift is the cheap
  // path; we only run this once per spawn so legibility wins.
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return { r, g, b };
}

/**
 * Per-type strand visual personality. Danger glows hot, water flows fast,
 * cairns ambient. Values feed Unity's _ScrollSpeed / _BloomBoost shader
 * uniforms (see MultiSpawner.SpawnStrand reading data.scrollSpeed/bloomBoost).
 *
 * scrollSpeed=0 means "use shader default". bloomBoost=0 means "use default".
 */
export function markerTypeToShaderParams(type: MarkerType | string): {
  scrollSpeed: number;
  bloomBoost: number;
} {
  switch (type) {
    case 'danger':   return { scrollSpeed: 1.5, bloomBoost: 1.4 };
    case 'junction': return { scrollSpeed: 1.2, bloomBoost: 1.2 };
    case 'water':    return { scrollSpeed: 1.8, bloomBoost: 1.0 };
    case 'hut':      return { scrollSpeed: 0.5, bloomBoost: 0.9 };
    case 'cairn':
    default:         return { scrollSpeed: 0.8, bloomBoost: 1.0 };
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
