/**
 * TrimSlider — double-handled slider for trimming a route's head and tail.
 *
 * Sprint 67 v241. Pure client-side: each handle controls a fraction in
 * [0..1] of the matched polyline's arc length. No API calls.
 *
 * v241 gesture model: PanResponder is bound to the WHOLE track row, not
 * the small handle Views. On grant, we figure out which handle is closer
 * to the touch point (start vs end) and drive that one. On move, we use
 * the absolute x relative to the track (not gestureState.dx) so the
 * handle tracks the finger directly. This fixes:
 *   - "slider only goes left" (Mapbox MapView underneath was stealing
 *     touches that strayed off the small 28×28 handle)
 *   - The ambiguous "which handle is being dragged?" feel
 */

import React, { useRef, useState } from 'react';
import { View, StyleSheet, PanResponder, LayoutChangeEvent, GestureResponderEvent, PanResponderGestureState } from 'react-native';
import { Colors } from '../tokens';

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
const HIT_SLOP = 16; // each handle's effective grab zone (extra px)

export function TrimSlider({
  trimStartFrac,
  trimEndFrac,
  onTrimStartChange,
  onTrimEndChange,
}: TrimSliderProps): React.JSX.Element {
  const [trackW, setTrackW] = useState(0);
  const [localStart, setLocalStart] = useState(trimStartFrac);
  const [localEnd, setLocalEnd] = useState(trimEndFrac);
  const draggingHandleRef = useRef<'start' | 'end' | null>(null);

  React.useEffect(() => {
    if (draggingHandleRef.current === null) {
      setLocalStart(trimStartFrac);
      setLocalEnd(trimEndFrac);
    }
  }, [trimStartFrac, trimEndFrac]);

  const localStartRef = useRef(localStart);
  const localEndRef = useRef(localEnd);
  React.useEffect(() => { localStartRef.current = localStart; }, [localStart]);
  React.useEffect(() => { localEndRef.current = localEnd; }, [localEnd]);

  const onTrackLayout = (e: LayoutChangeEvent) => {
    setTrackW(e.nativeEvent.layout.width);
  };

  // Convert a touch's locationX (relative to the trackRow View) into a
  // fraction in [0..1]. The usable portion of the track is trackW - HANDLE_W
  // (because handle Views are HANDLE_W wide and centered on their `left`).
  const fracFromLocalX = (localX: number): number => {
    const usable = Math.max(1, trackW - HANDLE_W);
    const f = (localX - HANDLE_W / 2) / usable;
    return Math.max(0, Math.min(1, f));
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false, // don't yield to MapView
      onPanResponderGrant: (e: GestureResponderEvent) => {
        const usable = Math.max(1, trackW - HANDLE_W);
        const localX = e.nativeEvent.locationX;
        const startPx = localStartRef.current * usable + HANDLE_W / 2;
        const endPx = localEndRef.current * usable + HANDLE_W / 2;
        const distToStart = Math.abs(localX - startPx);
        const distToEnd = Math.abs(localX - endPx);
        // Pick whichever handle is closer (within HIT_SLOP). If both are
        // far, prefer the one whose direction the touch is heading toward
        // — but for grant we only have the start point, so closer wins.
        draggingHandleRef.current = distToStart <= distToEnd ? 'start' : 'end';
      },
      onPanResponderMove: (e: GestureResponderEvent, _g: PanResponderGestureState) => {
        const localX = e.nativeEvent.locationX;
        const f = fracFromLocalX(localX);
        if (draggingHandleRef.current === 'start') {
          setLocalStart(Math.min(f, localEndRef.current - TRIM_MIN_FRACTION));
        } else if (draggingHandleRef.current === 'end') {
          setLocalEnd(Math.max(f, localStartRef.current + TRIM_MIN_FRACTION));
        }
      },
      onPanResponderRelease: () => {
        const which = draggingHandleRef.current;
        draggingHandleRef.current = null;
        if (which === 'start') {
          onTrimStartChange(localStartRef.current);
        } else if (which === 'end') {
          onTrimEndChange(localEndRef.current);
        }
      },
      onPanResponderTerminate: () => {
        const which = draggingHandleRef.current;
        draggingHandleRef.current = null;
        if (which === 'start') {
          onTrimStartChange(localStartRef.current);
        } else if (which === 'end') {
          onTrimEndChange(localEndRef.current);
        }
      },
    }),
  ).current;

  const usable = Math.max(0, trackW - HANDLE_W);
  const startX = localStart * usable;
  const endX = localEnd * usable;

  return (
    <View style={styles.container}>
      <View
        style={styles.trackRow}
        onLayout={onTrackLayout}
        {...responder.panHandlers}
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
