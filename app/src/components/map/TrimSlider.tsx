/**
 * TrimSlider — double-handled slider for trimming a route's head and tail.
 *
 * Sprint 67 v242. Pure client-side: each handle controls a fraction in
 * [0..1] of the matched polyline's arc length. No API calls.
 *
 * v242 gesture model — uses react-native-gesture-handler's Gesture.Pan()
 * which runs on the native UI thread and CANNOT be stolen by the Mapbox
 * MapView underneath (Mapbox uses native gesture handlers too, but
 * gesture-handler's discrete handlers + simultaneousWithExternalGesture
 * negotiation works correctly across both).
 *
 * The earlier 3 attempts using PanResponder (RN's JS-thread gesture
 * system) all lost touches to MapView. gesture-handler is the canonical
 * fix.
 */

import React, { useState } from 'react';
import { View, StyleSheet, LayoutChangeEvent, Platform } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { Colors } from '../tokens';

const TRIM_MIN_FRACTION = 0.05;

interface TrimSliderProps {
  trimStartFrac: number;
  trimEndFrac: number;
  onTrimStartChange: (frac: number) => void;
  onTrimEndChange: (frac: number) => void;
  /** v244: called once when the user starts a drag — store pushes undo. */
  onTrimDragBegin?: () => void;
  totalLengthM?: number;
}

const HANDLE_W = 28;
const TRACK_H = 44;
const HIT_SLOP = 16;

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Fine control close to pen-down, then one-to-one travel for larger trims. */
export function precisionTrimDeltaPx(translationX: number): number {
  const sign = Math.sign(translationX);
  const magnitude = Math.abs(translationX);
  return sign * (magnitude <= 32 ? magnitude * 0.5 : 16 + (magnitude - 32));
}

export function TrimSlider({
  trimStartFrac,
  trimEndFrac,
  onTrimStartChange,
  onTrimEndChange,
  onTrimDragBegin,
}: TrimSliderProps): React.JSX.Element {
  const [trackW, setTrackW] = useState(0);
  // Local fractions during drag (so visual updates 60fps without going
  // through the store on every frame). Released → onChange.
  const [localStart, setLocalStart] = useState(trimStartFrac);
  const [localEnd, setLocalEnd] = useState(trimEndFrac);
  const [isDragging, setIsDragging] = useState(false);

  // Sync from props when not actively dragging.
  React.useEffect(() => {
    if (!isDragging) {
      setLocalStart(trimStartFrac);
      setLocalEnd(trimEndFrac);
    }
  }, [trimStartFrac, trimEndFrac, isDragging]);

  const onTrackLayout = (e: LayoutChangeEvent) => {
    setTrackW(e.nativeEvent.layout.width);
  };

  // Build the gesture once per (trackW, localStart, localEnd) closure
  // — useMemo / useEffect re-creating it each frame would lose state.
  // We use refs for the latest fractions inside the gesture worklets.
  const startRef = React.useRef(localStart);
  const endRef = React.useRef(localEnd);
  const draggingHandleRef = React.useRef<'start' | 'end' | null>(null);
  const grantXRef = React.useRef(0);
  const grantFractionRef = React.useRef(0);
  React.useEffect(() => { startRef.current = localStart; }, [localStart]);
  React.useEffect(() => { endRef.current = localEnd; }, [localEnd]);

  const usable = Math.max(1, trackW - HANDLE_W);

  function handleBegin(touchX: number) {
    grantXRef.current = touchX;
    const startPx = startRef.current * usable + HANDLE_W / 2;
    const endPx = endRef.current * usable + HANDLE_W / 2;
    const distToStart = Math.abs(touchX - startPx);
    const distToEnd = Math.abs(touchX - endPx);
    draggingHandleRef.current = distToStart <= distToEnd ? 'start' : 'end';
    grantFractionRef.current = draggingHandleRef.current === 'start' ? startRef.current : endRef.current;
    setIsDragging(true);
    // v244: push undo snapshot once at drag start (not every frame).
    onTrimDragBegin?.();
  }

  function applyFraction(f: number) {
    if (draggingHandleRef.current === 'start') {
      const next = Math.min(f, endRef.current - TRIM_MIN_FRACTION);
      startRef.current = next;
      setLocalStart(next);
      // v243: real-time update — push to store every frame so the
      // route line redraws while the user is still dragging. PO request.
      onTrimStartChange(next);
    } else if (draggingHandleRef.current === 'end') {
      const next = Math.max(f, startRef.current + TRIM_MIN_FRACTION);
      endRef.current = next;
      setLocalEnd(next);
      onTrimEndChange(next);
    }
  }

  function handleUpdateTranslation(translationX: number) {
    const f = clamp(grantFractionRef.current + precisionTrimDeltaPx(translationX) / usable, 0, 1);
    applyFraction(f);
  }

  function handleUpdateAbsolute(touchX: number) {
    handleUpdateTranslation(touchX - grantXRef.current);
  }

  function handleEnd() {
    const which = draggingHandleRef.current;
    draggingHandleRef.current = null;
    setIsDragging(false);
    // v243: onChange already fired during drag (handleUpdate). Final
    // call ensures store has the exact release value.
    if (which === 'start') onTrimStartChange(startRef.current);
    else if (which === 'end') onTrimEndChange(endRef.current);
  }

  const pan = Gesture.Pan()
    .minDistance(0)
    .activateAfterLongPress(0)
    .onBegin((e) => {
      'worklet';
      runOnJS(handleBegin)(e.x);
    })
    .onUpdate((e) => {
      'worklet';
      runOnJS(handleUpdateTranslation)(e.translationX);
    })
    .onEnd(() => {
      'worklet';
      runOnJS(handleEnd)();
    })
    .onFinalize(() => {
      'worklet';
      runOnJS(handleEnd)();
    });

  const startX = localStart * usable;
  const endX = localEnd * usable;

  const track = (
    <View
      style={styles.trackRow}
      onLayout={onTrackLayout}
      collapsable={false}
      testID="route-trim-track"
      {...(Platform.OS === 'web' ? {
        onStartShouldSetResponder: () => true,
        onMoveShouldSetResponder: () => true,
        onResponderGrant: (event: any) => handleBegin(event.nativeEvent.locationX),
        onResponderMove: (event: any) => handleUpdateAbsolute(event.nativeEvent.locationX),
        onResponderRelease: handleEnd,
        onResponderTerminate: handleEnd,
      } : {})}
    >
      <View style={styles.trackBg} />
      <View
        style={[
          styles.trackFill,
          { left: startX + HANDLE_W / 2, width: Math.max(0, endX - startX) },
        ]}
      />
      <View
        style={[styles.handle, styles.handleStart, { left: startX }]}
        pointerEvents="none"
      />
      <View
        style={[styles.handle, styles.handleEnd, { left: endX }]}
        pointerEvents="none"
      />
    </View>
  );

  return (
    <View style={styles.container}>
      {Platform.OS === 'web' ? track : <GestureDetector gesture={pan}>{track}</GestureDetector>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 4,
  },
  trackRow: {
    height: TRACK_H + HIT_SLOP * 2,
    justifyContent: 'center',
    position: 'relative',
    marginVertical: -HIT_SLOP,
  },
  trackBg: {
    position: 'absolute',
    left: HANDLE_W / 2,
    right: HANDLE_W / 2,
    top: '50%',
    marginTop: -3,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.border,
  },
  trackFill: {
    position: 'absolute',
    top: '50%',
    marginTop: -3,
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
    top: '50%',
    marginTop: -HANDLE_W / 2,
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
