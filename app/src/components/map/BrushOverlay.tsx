/**
 * BrushOverlay — captures pan gestures over the map when the user is in
 * brush or eraser mode and turns them into stroke geometry on the store.
 *
 * Sprint 67 v245.
 *
 * The overlay sits above MapView when activeTool !== 'pan'. It uses
 * react-native-gesture-handler Gesture.Pan() (UI thread) + a ref to the
 * Mapbox MapView so it can call `getCoordinateFromView({x, y})` on every
 * frame to convert screen → lng/lat.
 *
 * On gesture begin: store.beginStroke(coord) — refused if the first
 * point is more than 50m from the original GPS trace.
 * On move: store.appendStrokePoint(strokeId, coord) — auto-downsamples
 * to 5m spacing inside the store.
 * On end: store.endStroke(strokeId).
 *
 * In eraser mode: same gestures but call store.eraseAt(coord) for every
 * sampled point.
 */

import React, { useRef, useState } from 'react';
import { View, StyleSheet, Platform, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { useRouteEditStore } from '../../store/useRouteEditStore';
import { Colors, FontSize, Spacing } from '../tokens';

interface Props {
  /** Ref to the Mapbox MapView so we can unproject screen→geo. */
  mapViewRef: React.MutableRefObject<any>;
}

export function BrushOverlay({ mapViewRef }: Props): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const activeTool = useRouteEditStore(s => s.activeTool);
  const beginStroke = useRouteEditStore(s => s.beginStroke);
  const appendStrokePoint = useRouteEditStore(s => s.appendStrokePoint);
  const endStroke = useRouteEditStore(s => s.endStroke);
  const eraseAt = useRouteEditStore(s => s.eraseAt);

  const currentStrokeIdRef = useRef<string | null>(null);
  // v247: prevent double endStroke when both onEnd and onFinalize fire.
  const endedRef = useRef(false);
  // v250: in-flight guard for handleUpdate. runOnJS(handleUpdate) fires
  // for every gesture frame (~60Hz). unproject is async (await on
  // getCoordinateFromView native bridge call). Without this guard, the
  // JS thread queues 60 promises/sec and falls behind as the queue
  // grows — visible as second-stroke jank that cumulates with stroke
  // count. We drop frames whose unproject would queue behind an
  // in-flight call. The dropped pixel-position is acceptable because
  // appendStrokePoint already 5m-downsamples — losing a frame here
  // either means the next frame will have moved >5m (and is sampled)
  // or <5m (and would have been dropped anyway).
  const updateInFlightRef = useRef(false);

  if (activeTool === 'pan') return null;
  if (Platform.OS === 'web') return null;

  // v248: gesture capture region must avoid both the back-button area
  // at the top (~insets.top + 50) AND the entire bottom card which now
  // hosts tool strip + status + slider + preview + save (~360px).
  const gestureTopInset = insets.top + 50;
  const gestureBottomInset = 360;

  // Convert screen point to map lng/lat via Mapbox API. Async; we keep it
  // off the worklet thread by calling on JS thread inside runOnJS handlers.
  async function unproject(x: number, y: number): Promise<{ lng: number; lat: number } | null> {
    try {
      const map = mapViewRef.current;
      if (!map || typeof map.getCoordinateFromView !== 'function') return null;
      const coord = await map.getCoordinateFromView([x, y]);
      if (!Array.isArray(coord) || coord.length < 2) return null;
      return { lng: coord[0], lat: coord[1] };
    } catch {
      return null;
    }
  }

  async function handleBegin(x: number, y: number) {
    endedRef.current = false;
    updateInFlightRef.current = false; // v250: reset for new stroke
    const coord = await unproject(x, y);
    if (!coord) return;
    if (activeTool === 'brush') {
      const id = beginStroke(coord);
      currentStrokeIdRef.current = id;
    } else if (activeTool === 'eraser') {
      eraseAt(coord, 25);
    }
  }

  async function handleUpdate(x: number, y: number) {
    // v250: skip if a previous handleUpdate is still awaiting unproject.
    // Drops frames rather than queuing — keeps gesture responsive.
    if (updateInFlightRef.current) return;
    updateInFlightRef.current = true;
    try {
      const coord = await unproject(x, y);
      if (!coord) return;
      if (activeTool === 'brush') {
        const id = currentStrokeIdRef.current;
        if (!id) return;
        appendStrokePoint(id, coord);
      } else if (activeTool === 'eraser') {
        eraseAt(coord, 25);
      }
    } finally {
      updateInFlightRef.current = false;
    }
  }

  function handleEnd() {
    // v247: onEnd + onFinalize both fire on normal completion. Guard so
    // endStroke (and editCount telemetry) only triggers once per stroke.
    if (endedRef.current) return;
    endedRef.current = true;
    if (activeTool === 'brush') {
      const id = currentStrokeIdRef.current;
      if (id) endStroke(id);
      currentStrokeIdRef.current = null;
    }
  }

  const pan = Gesture.Pan()
    .minDistance(0)
    .activateAfterLongPress(0)
    .onBegin((e) => {
      'worklet';
      // v248: Gesture.Pan e.x/e.y are RELATIVE to the GestureDetector
      // inner view, which is inset from screen top by gestureTopInset.
      // Mapbox getCoordinateFromView expects coords relative to MapView,
      // which is absoluteFill (top:0). Use absoluteX/absoluteY (screen
      // coords) instead — MapView is at screen top:0 too, so absolute
      // = MapView-relative. Without this fix, every brush press was
      // unprojected ~100+insets.top pixels above the actual finger,
      // landing far off the route → "Brush must start on the route".
      runOnJS(handleBegin)(e.absoluteX, e.absoluteY);
    })
    .onUpdate((e) => {
      'worklet';
      runOnJS(handleUpdate)(e.absoluteX, e.absoluteY);
    })
    .onEnd(() => {
      'worklet';
      runOnJS(handleEnd)();
    })
    .onFinalize(() => {
      'worklet';
      runOnJS(handleEnd)();
    });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* v247: gesture-capture View is INSET from screen edges so taps
          on the floating top toolbar / bottom card never fire onBegin
          → never start an unwanted stroke. */}
      <View
        style={{
          position: 'absolute',
          top: gestureTopInset,
          left: 0,
          right: 0,
          bottom: gestureBottomInset,
        }}
        pointerEvents="box-none"
      >
        <GestureDetector gesture={pan}>
          <View style={StyleSheet.absoluteFill} collapsable={false} />
        </GestureDetector>
      </View>
      <View pointerEvents="none" style={[styles.modeHint, { top: insets.top + 56 }]}>
        <Text style={styles.modeHintText}>
          {activeTool === 'brush' ? 'Drawing — start on the route' : 'Eraser — drag over a stroke to remove'}
        </Text>
      </View>
      {/* v255: lastError pill removed from top. PO request — all error
          / warning text now consolidated to the bottom statusRow. */}
    </View>
  );
}

const styles = StyleSheet.create({
  modeHint: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  modeHintText: {
    fontSize: FontSize.small,
    color: Colors.primary,
    fontWeight: '700',
  },
});
