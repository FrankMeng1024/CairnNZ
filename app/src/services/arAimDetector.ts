/**
 * arAimDetector — 3D cone aim detection for AR marker interaction
 * (per cinematic-ar-rebuild.md §F.1, V2.C1).
 *
 * Reuses the same camera transform RN already gets from UnityAROverlay
 * (camera.position, camera.forward). Returns whether a given cairn lies
 * inside a 3D cone of half-angle `coneHalfRad` around the camera's
 * forward axis. Full dot-product check — handles BOTH azimuth (yaw)
 * and pitch deviation. The 2D approach in CairnEdgeArrows is wrong for
 * aim because phone tilt is unconstrained.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface AimResult {
  /** True if cairn is inside cone AND in front of camera. */
  inCone: boolean;
  /** Angle in radians between camera forward and camera→cairn vector. */
  angleRad: number;
  /** 3D distance camera→cairn in meters. */
  dist: number;
}

/**
 * Returns whether the cairn lies inside a 3D cone of half-angle
 * `coneHalfRad` around the camera's forward axis.
 */
export function isInAimCone(
  camPos: Vec3,
  camFwd: Vec3,
  cairnPos: Vec3,
  coneHalfRad: number,
): AimResult {
  const dx = cairnPos.x - camPos.x;
  const dy = cairnPos.y - camPos.y;
  const dz = cairnPos.z - camPos.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-4) {
    return { inCone: false, angleRad: 0, dist };
  }
  const fLen = Math.hypot(camFwd.x, camFwd.y, camFwd.z);
  if (fLen < 1e-6) {
    return { inCone: false, angleRad: Math.PI, dist };
  }
  const fxN = camFwd.x / fLen;
  const fyN = camFwd.y / fLen;
  const fzN = camFwd.z / fLen;
  const txN = dx / dist;
  const tyN = dy / dist;
  const tzN = dz / dist;
  let cosA = fxN * txN + fyN * tyN + fzN * tzN;
  if (cosA > 1) cosA = 1;
  else if (cosA < -1) cosA = -1;
  const angleRad = Math.acos(cosA);
  // Behind-camera (cosA <= 0) is always out of cone since coneHalfRad < π/2
  // for any sensible aim cone.
  const inCone = cosA > 0 && angleRad <= coneHalfRad;
  return { inCone, angleRad, dist };
}

export interface CairnPos {
  id: string;
  x: number;
  y: number;
  z: number;
}

/**
 * Pick the best aimed marker from a list of cairns. Returns the one
 * with the smallest 3D distance among cairns that pass the cone test
 * AND the maxRangeM gate.
 */
export function detectAimedMarker(
  camera: { position: [number, number, number]; forward: [number, number, number] },
  cairns: CairnPos[],
  coneHalfRad: number,
  maxRangeM: number,
): { markerId: string | null; angleRad: number; dist: number } {
  if (!camera || !cairns || cairns.length === 0) {
    return { markerId: null, angleRad: Math.PI, dist: Infinity };
  }
  const cp: Vec3 = { x: camera.position[0], y: camera.position[1], z: camera.position[2] };
  const cf: Vec3 = { x: camera.forward[0], y: camera.forward[1], z: camera.forward[2] };
  let bestId: string | null = null;
  let bestDist = Infinity;
  let bestAngle = Math.PI;
  for (const c of cairns) {
    const cairnPos: Vec3 = { x: c.x, y: c.y, z: c.z };
    const r = isInAimCone(cp, cf, cairnPos, coneHalfRad);
    if (!r.inCone) continue;
    if (r.dist > maxRangeM) continue;
    if (r.dist < bestDist) {
      bestDist = r.dist;
      bestAngle = r.angleRad;
      bestId = c.id;
    }
  }
  return { markerId: bestId, angleRad: bestAngle, dist: bestDist };
}
