/**
 * TrimSlider — double-handled slider for trimming a route's head and tail.
 *
 * Sprint 67 v236. Pure client-side: each handle controls a fraction in
 * [0..1] of the matched polyline's arc length. No API calls.
 *
 * Touch model uses absolute pageX (minus the track's measured pageX origin)
 * so the handle tracks the user's finger, not its initial offset.
 */

import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, PanResponder, LayoutChangeEvent } from 'react-native';
import { Colors, Spacing, FontSize } from '../tokens';

const TRIM_MIN_FRACTION = 0.05;

export interface TrimSliderProps {
  trimStartFrac: number;
  trimEndFrac: number;
  onTrimStartChange: (frac: number) => void;
  onTrimEndChange: (frac: number) => void;
  totalLengthM?: number;
}

const HANDLE_W = 28;
const TRACK_H = 44;

export function TrimSlider({
  trimStartFrac,
  trimEndFrac,
  onTrimStartChange,
  onTrimEndChange,
  totalLengthM,
}: TrimSliderProps): React.JSX.Element {
  const [trackW, setTrackW] = useState(0);
  const trackRef = useRef<View | null>(null);
  const trackPageXRef = useRef<number>(0);
  const [localStart, setLocalStart] = useState(trimStartFrac);
  const [localEnd, setLocalEnd] = useState(trimEndFrac);
  const draggingHandleRef = useRef<'start' | 'end' | null>(null);

  React.useEffect(() => {
    if (draggingHandleRef.current === null) {
      setLocalStart(trimStartFrac);
      setLocalEnd(trimEndFrac);
    }
  }, [trimStartFrac, trimEndFrac]);

  const measureTrack = () => {
    if (!trackRef.current) return;
    (trackRef.current as any).measureInWindow((x: number, _y: number, w: number) => {
      trackPageXRef.current = x;
      if (w > 0 && w !== trackW) setTrackW(w);
    });
  };
  const onTrackLayout = (e: LayoutChangeEvent) => {
    setTrackW(e.nativeEvent.layout.width);
    measureTrack();
  };

  const fracFromPageX = (pageX: number): number => {
    if (trackW <= 0) return 0;
    const usable = trackW - HANDLE_W;
    if (usable <= 0) return 0;
    const localX = pageX - trackPageXRef.current;
    return Math.max(0, Math.min(1, (localX - HANDLE_W / 2) / usable));
  };

  const localStartRef = useRef(localStart);
  const localEndRef = useRef(localEnd);
  React.useEffect(() => { localStartRef.current = localStart; }, [localStart]);
  React.useEffect(() => { localEndRef.current = localEnd; }, [localEnd]);

  // Track which fraction the handle started at when the gesture began —
  // we apply gestureState.dx (delta in screen pixels) on top, which is
  // RN's most reliable gesture metric (works on iOS + Android, doesn't
  // depend on nativeEvent.pageX which is driver-specific).
  const grantStartFracRef = useRef(0);
  const grantEndFracRef = useRef(0);

  const startResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        draggingHandleRef.current = 'start';
        grantStartFracRef.current = localStartRef.current;
      },
      onPanResponderMove: (_e, gestureState) => {
        const usable = Math.max(1, trackW - HANDLE_W);
        const deltaFrac = gestureState.dx / usable;
        const f = Math.max(0, Math.min(1, grantStartFracRef.current + deltaFrac));
        setLocalStart(Math.min(f, localEndRef.current - TRIM_MIN_FRACTION));
      },
      onPanResponderRelease: () => {
        draggingHandleRef.current = null;
        onTrimStartChange(localStartRef.current);
      },
      onPanResponderTerminate: () => {
        draggingHandleRef.current = null;
        onTrimStartChange(localStartRef.current);
      },
    }),
  ).current;

  const endResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        draggingHandleRef.current = 'end';
        grantEndFracRef.current = localEndRef.current;
      },
      onPanResponderMove: (_e, gestureState) => {
        const usable = Math.max(1, trackW - HANDLE_W);
        const deltaFrac = gestureState.dx / usable;
        const f = Math.max(0, Math.min(1, grantEndFracRef.current + deltaFrac));
        setLocalEnd(Math.max(f, localStartRef.current + TRIM_MIN_FRACTION));
      },
      onPanResponderRelease: () => {
        draggingHandleRef.current = null;
        onTrimEndChange(localEndRef.current);
      },
      onPanResponderTerminate: () => {
        draggingHandleRef.current = null;
        onTrimEndChange(localEndRef.current);
      },
    }),
  ).current;

  const usable = Math.max(0, trackW - HANDLE_W);
  const startX = localStart * usable;
  const endX = localEnd * usable;

  return (
    <View style={styles.container}>
      <View ref={trackRef} style={styles.trackRow} onLayout={onTrackLayout}>
        <View style={styles.trackBg} />
        <View
          style={[
            styles.trackFill,
            { left: startX + HANDLE_W / 2, width: Math.max(0, endX - startX) },
          ]}
        />
        <View
          style={[styles.handle, styles.handleStart, { left: startX }]}
          {...startResponder.panHandlers}
        />
        <View
          style={[styles.handle, styles.handleEnd, { left: endX }]}
          {...endResponder.panHandlers}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 4,
  },
  trackRow: {
    height: TRACK_H,
    justifyContent: 'center',
    position: 'relative',
  },
  trackBg: {
    position: 'absolute',
    left: HANDLE_W / 2,
    right: HANDLE_W / 2,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.border,
  },
  trackFill: {
    position: 'absolute',
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.primary,
  },
  handle: {
    position: 'absolute',
    width: HANDLE_W,
    height: HANDLE_W,
    borderRadius: HANDLE_W / 2,
    borderWidth: 3,
    borderColor: Colors.surface,
    top: (TRACK_H - HANDLE_W) / 2,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
  },
  handleStart: {
    backgroundColor: Colors.success,
  },
  handleEnd: {
    backgroundColor: Colors.danger,
  },
});
