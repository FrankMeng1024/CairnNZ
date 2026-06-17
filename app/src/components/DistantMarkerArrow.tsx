/**
 * DistantMarkerArrow.tsx — v0.2.4 Branch B (RN UI)
 *
 * 远场箭头引导:用户跟着箭头走近 mark。
 * - 距离 >30m: 屏幕边缘箭头 + 距离文字
 * - 距离 30-15m: 箭头脉动 + 触觉震动
 * - 距离 <15m: 隐藏箭头(交给 Unity AR 显示 cairn 实化)
 *
 * Reviewer 修订:
 *   R-B7 触觉震动渐强 light → medium → heavy
 *   R-B6 文案情感化(放在 GuidanceCopy.ts)
 *   箭头方向 5Hz EMA α=0.3 平滑(防 GPS/罗盘抖动)
 *
 * 数据来源:
 *   - useMarkerStore: marker list with lat/lng
 *   - useGpsStore (or props): user lat/lng/heading
 *   - 距离用 Haversine,方向用 bearing
 *
 * 性能:每 200ms 更新一次,不每帧
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

export type Marker = {
  id: string;
  lat: number;
  lng: number;
  type: string;
};

export type UserPos = {
  lat: number;
  lng: number;
  heading?: number;  // degrees, 0=North, 90=East
};

interface Props {
  marker: Marker | null;
  user: UserPos | null;
  /**
   * Distance threshold above which we render the arrow.
   * Below this, the cairn should be visible in AR and we hide the arrow.
   */
  visibleAboveMeters?: number;
  /**
   * Hide arrow when distance below this (cairn is implementing in AR).
   */
  hideBelowMeters?: number;
}

// ---- Geo math ----
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // meters
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const toDeg = (x: number) => (x * 180) / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  let b = (toDeg(Math.atan2(y, x)) + 360) % 360;
  return b;
}

// EMA smoothing for angle (handles 360° wrap)
function emaAngle(prev: number, target: number, alpha: number): number {
  let delta = target - prev;
  if (delta > 180) delta -= 360;
  else if (delta < -180) delta += 360;
  return (prev + alpha * delta + 360) % 360;
}

// ---- Component ----
export function DistantMarkerArrow({
  marker,
  user,
  // v0.2.5 OTA — show direction arrow much sooner. Original 15m only
  // helped for far hikes; users plant cairns 1-10m apart indoors and
  // were left with no indicator when the cairn was off-screen but only
  // a few meters away. 3m floor lets the AR overlay take over once the
  // user is right next to the cairn (Unity 3D model becomes visible).
  visibleAboveMeters = 3,
  hideBelowMeters = 3,
}: Props) {
  const [distance, setDistance] = useState<number | null>(null);
  const [arrowAngle, setArrowAngle] = useState(0); // 0..360, relative to user heading
  const lastBearingRef = useRef<number>(0);
  const lastHapticDistanceBucketRef = useRef<number>(0);
  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!marker || !user) {
      setDistance(null);
      return;
    }
    const update = () => {
      const d = haversine(user.lat, user.lng, marker.lat, marker.lng);
      setDistance(d);

      const targetBearing = bearing(user.lat, user.lng, marker.lat, marker.lng);
      const headingFix = user.heading ?? 0;
      // Relative angle = where mark is, minus where user is facing
      let relTarget = (targetBearing - headingFix + 360) % 360;
      const smoothed = emaAngle(lastBearingRef.current, relTarget, 0.3);
      lastBearingRef.current = smoothed;
      setArrowAngle(smoothed);

      // Haptic on distance halving (R-B7 渐强 pattern)
      const bucket = d > 30 ? 0 : d > 15 ? 1 : d > 7 ? 2 : 3;
      if (bucket !== lastHapticDistanceBucketRef.current && bucket > lastHapticDistanceBucketRef.current) {
        const styles = [
          Haptics.ImpactFeedbackStyle.Light,
          Haptics.ImpactFeedbackStyle.Medium,
          Haptics.ImpactFeedbackStyle.Heavy,
        ];
        const idx = Math.min(bucket - 1, styles.length - 1);
        if (idx >= 0) Haptics.impactAsync(styles[idx]).catch(() => {});
        lastHapticDistanceBucketRef.current = bucket;
      }
    };
    update();
    const id = setInterval(update, 200); // 5 Hz
    return () => clearInterval(id);
  }, [marker, user]);

  // Pulse animation when within 30m
  useEffect(() => {
    if (distance !== null && distance < 30) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 0,
            duration: 600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ).start();
    } else {
      pulseAnim.setValue(0);
    }
  }, [distance, pulseAnim]);

  if (distance === null) return null;
  if (distance < hideBelowMeters) return null;
  if (distance > 500) return null; // far OOB hidden

  const distLabel =
    distance > 1000
      ? `${(distance / 1000).toFixed(1)} km`
      : `${Math.round(distance)} m`;

  const pulseScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1.0, 1.18],
  });
  const pulseOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.85, 1.0],
  });

  return (
    <View pointerEvents="none" style={styles.container}>
      <Animated.View
        style={[
          styles.arrowWrap,
          {
            transform: [
              { rotate: `${arrowAngle}deg` },
              { scale: pulseScale as any },
            ],
            opacity: pulseOpacity,
          },
        ]}
      >
        <View style={styles.arrow}>
          <Text style={styles.arrowGlyph}>↑</Text>
        </View>
      </Animated.View>
      <Text style={styles.distance}>{distLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: '20%',
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowWrap: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrow: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  arrowGlyph: {
    color: '#fff',
    fontSize: 56,
    lineHeight: 56,
    fontWeight: '300',
  },
  distance: {
    marginTop: 8,
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});

export default DistantMarkerArrow;
