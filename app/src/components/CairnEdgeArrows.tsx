/**
 * CairnEdgeArrows — ARKit-driven directional indicators for off-screen cairns.
 *
 * Why: the compass dial uses expo-location's magnetic heading, which is
 * subject to local magnetic interference, calibration drift, and uses
 * magnetic-north (not true-north). When ARKit renders cairns at
 * worldAlignment="GravityAndHeading", the visual position can be tens of
 * degrees off from where the dial points — so the dial isn't trustworthy.
 *
 * This component instead uses the same camera transform ARKit uses to
 * render the cairns. Math:
 *   1. Camera position + forward vector come from onCameraTransformUpdate
 *   2. For each cairn (in ARKit world space), compute the vector from
 *      camera to cairn
 *   3. Project onto camera's forward / right plane to get a screen-relative
 *      angle. If angle is within FOV/2, the cairn is on-screen → don't
 *      show an arrow (the cairn itself is visible). Otherwise, render an
 *      edge arrow at the angle.
 *   4. Distance is the 3D length of the camera→cairn vector.
 *
 * The arrow is pinned to the screen edge nearest to the cairn direction.
 * Distance label ("12m" / "1.3km") sits next to it.
 */
import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { Icon } from './Icon';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ARKit camera horizontal FOV is ~63° on iPhone main rear camera.
// Match the constant used in ARScreen for projection math.
const CAMERA_FOV_DEG = 65;
const HALF_FOV_RAD = ((CAMERA_FOV_DEG / 2) * Math.PI) / 180;

const TYPE_COLORS: Record<string, string> = {
  danger: '#ff5a3a',
  scenic: '#3ad8a4',
  supply: '#6ac8f0',
  junction: '#f0a838',
};

interface CairnWorldPos {
  id: string;
  type: string;
  x: number; y: number; z: number;
  dist: number;
}

interface Props {
  /** Latest ARKit camera transform from ViroAROverlay's onArFrame. */
  camera: { position: [number, number, number]; forward: [number, number, number] } | null;
  /** Cairn world positions (from ViroAROverlay's onArFrame). */
  cairns: CairnWorldPos[];
}

export function CairnEdgeArrows({ camera, cairns }: Props) {
  if (!camera || cairns.length === 0) return null;

  // Camera right = world up cross forward. Assumes ARKit world up = (0,1,0)
  // which is true for worldAlignment Gravity / GravityAndHeading.
  const fx = camera.forward[0], fy = camera.forward[1], fz = camera.forward[2];
  // ARKit is a right-handed coord system; "right" = forward × up.
  // forward × up = (fx,fy,fz) × (0,1,0) = (-fz, 0, fx)
  // Earlier (v64) we used (fz, 0, -fx) which was up × forward — that
  // points LEFT, not right. Symptom: plant ahead, turn right → cairn
  // appears as a left-edge arrow instead of right-edge. Fixed in v66.
  const rx = -fz, rz = fx;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      {cairns.map((c) => {
        // Vector from camera to cairn (world space)
        const dx = c.x - camera.position[0];
        const dy = c.y - camera.position[1];
        const dz = c.z - camera.position[2];

        // 3D distance (real space)
        const dist3D = Math.hypot(dx, dy, dz);
        if (dist3D < 0.01) return null;

        // Project to camera-horizontal plane: forward component, right component
        // (ignore vertical for arrow placement; vertical handled separately)
        const fwdComp = dx * fx + dy * fy + dz * fz;          // signed forward
        const rightComp = dx * rx + dz * rz;                  // signed right (no y component since right has y=0)

        // Horizontal distance for FOV check
        const horizDist = Math.hypot(fwdComp, rightComp);
        if (horizDist < 0.01) return null;

        // Angle from camera forward axis, signed: positive = right, negative = left
        const angleRad = Math.atan2(rightComp, fwdComp);

        // On-screen check: cairn is visible if it's in front and within FOV
        const inFront = fwdComp > 0;
        const onScreen = inFront && Math.abs(angleRad) <= HALF_FOV_RAD;

        // v70: cap edge-arrow rendering at 300m. Beyond that, the cairn is
        // too far to be useful as a navigation cue and clutters the UI.
        if (dist3D > 300) return null;

        if (onScreen) {
          // On-screen: show only distance label (the 3D sphere is the cairn
          // itself). Project angle to screen X, anchor below screen centre.
          const screenX = SCREEN_W / 2 + (angleRad / HALF_FOV_RAD) * (SCREEN_W / 2);
          const color = TYPE_COLORS[c.type] || '#fff';
          return (
            <View
              key={c.id}
              style={[
                styles.distChip,
                {
                  left: screenX - 32,
                  top: SCREEN_H * 0.55,
                  borderColor: color,
                },
              ]}
            >
              <Text style={[styles.distText, { color }]}>{formatDist(dist3D)}</Text>
            </View>
          );
        }

        // v70.1: Off-screen edge arrow — direction-only.
        //
        // Multiple cairns on the same side stack vertically by their actual
        // bearing angle (so two cairns "to my left" but slightly different
        // angles appear as TWO arrows at different screen heights, not one
        // overlapping the other). Closer cairns also render LARGER (size
        // shrinks logarithmically with distance) so the near one is the
        // most prominent of the cluster.
        const onLeft = inFront ? angleRad < 0 : rightComp < 0;
        const color = TYPE_COLORS[c.type] || '#fff';
        // Distance scale: 0m → 1.4x size, 300m → 0.6x. Reads as near-bigger.
        const distFactor = Math.max(0.6, 1.4 - dist3D / 300 * 0.8);
        // Vertical position from absolute angle (0° forward = top of stack,
        // ±180° behind = bottom). Maps |angle| ∈ [HALF_FOV..π] to screen
        // y ∈ [0.30..0.75]. Cairns nearly behind = near bottom; just-out-
        // of-frame = near top.
        const absAngle = Math.abs(angleRad);
        const angleNorm = Math.min(1, Math.max(0, (absAngle - HALF_FOV_RAD) / (Math.PI - HALF_FOV_RAD)));
        const arrowY = SCREEN_H * (0.30 + 0.45 * angleNorm);
        const baseSize = 36;
        const size = Math.round(baseSize * distFactor);
        return (
          <View
            key={c.id}
            style={[
              styles.edgeArrow,
              {
                top: arrowY - size / 2,
                [onLeft ? 'left' : 'right']: 10,
                borderColor: color,
                width: size,
                height: size,
                borderRadius: size / 2,
              },
            ]}
          >
            <Icon
              name={onLeft ? 'ChevronLeft' : 'ChevronRight'}
              size={Math.round(22 * distFactor)}
              color={color}
              strokeWidth={3}
            />
          </View>
        );
      })}
    </View>
  );
}

function formatDist(m: number): string {
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

const styles = StyleSheet.create({
  edgeArrow: {
    position: 'absolute',
    // width/height/borderRadius set inline (vary by distance — bigger when closer)
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderWidth: 1.5,
  },
  edgeDist: {
    fontSize: 10,
    fontWeight: '700',
  },
  distChip: {
    position: 'absolute',
    width: 64, height: 22,
    borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderWidth: 1,
  },
  distText: {
    fontSize: 11,
    fontWeight: '700',
  },
});
