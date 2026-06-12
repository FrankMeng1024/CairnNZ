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
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { useRouteEditStore } from '../../store/useRouteEditStore';
import { Colors, FontSize, Spacing } from '../tokens';

interface Props {
  /** Ref to the Mapbox MapView so we can unproject screen→geo. */
  mapViewRef: React.MutableRefObject<any>;
}

export function BrushOverlay({ mapViewRef }: Props): React.JSX.Element | null {
  const activeTool = useRouteEditStore(s => s.activeTool);
  const beginStroke = useRouteEditStore(s => s.beginStroke);
  const appendStrokePoint = useRouteEditStore(s => s.appendStrokePoint);
  const endStroke = useRouteEditStore(s => s.endStroke);
  const eraseAt = useRouteEditStore(s => s.eraseAt);
  const lastError = useRouteEditStore(s => s.lastError);

  const currentStrokeIdRef = useRef<string | null>(null);

  if (activeTool === 'pan') return null;
  if (Platform.OS === 'web') return null;

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
    const coord = await unproject(x, y);
    if (!coord) return;
    if (activeTool === 'brush') {
      const id = currentStrokeIdRef.current;
      if (!id) return;
      appendStrokePoint(id, coord);
    } else if (activeTool === 'eraser') {
      eraseAt(coord, 25);
    }
  }

  function handleEnd() {
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
      runOnJS(handleBegin)(e.x, e.y);
    })
    .onUpdate((e) => {
      'worklet';
      runOnJS(handleUpdate)(e.x, e.y);
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
      <GestureDetector gesture={pan}>
        <View style={StyleSheet.absoluteFill} collapsable={false} />
      </GestureDetector>
      <View pointerEvents="none" style={styles.modeHint}>
        <Text style={styles.modeHintText}>
          {activeTool === 'brush' ? 'Drawing — start on the route' : 'Eraser — drag over a stroke to remove'}
        </Text>
      </View>
      {lastError && (
        <View pointerEvents="none" style={styles.errorHint}>
          <Text style={styles.errorHintText}>{lastError}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  modeHint: {
    position: 'absolute',
    top: 80,
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
  errorHint: {
    position: 'absolute',
    top: 122,
    alignSelf: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: Colors.dangerBg,
    borderWidth: 1,
    borderColor: Colors.danger,
  },
  errorHintText: {
    fontSize: FontSize.small,
    color: Colors.danger,
    fontWeight: '700',
  },
});
