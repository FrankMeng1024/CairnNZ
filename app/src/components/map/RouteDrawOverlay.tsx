import React, { useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import Svg, { Polyline } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RoutePoint } from '../../store/useRouteStore';
import { routePointDistanceM, validRoutePoint } from '../../features/route/orderedRouteDraft';

interface Props {
  active: boolean;
  mapViewRef: React.MutableRefObject<any>;
  onStroke: (points: RoutePoint[]) => void;
  onCancel: (reason: 'gesture-interrupted' | 'coordinate-unavailable') => void;
  bottomInset?: number;
  strokeColor?: string;
}

/**
 * One deliberate one-finger Draw transaction. Multi-touch fails the pending
 * ink and leaves native map gestures available on the next touch; partial ink
 * is never promoted to a connected Route segment.
 */
export function RouteDrawOverlay({
  active,
  mapViewRef,
  onStroke,
  onCancel,
  bottomInset = 250,
  strokeColor = '#245C43',
}: Props): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const pointsRef = useRef<RoutePoint[]>([]);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const generationRef = useRef(0);
  const endedNormallyRef = useRef(false);
  const coordinateFailureRef = useRef(false);
  const screenPointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const [screenPoints, setScreenPoints] = useState<Array<{ x: number; y: number }>>([]);

  if (!active || Platform.OS === 'web') return null;

  async function unproject(x: number, y: number): Promise<RoutePoint | null> {
    try {
      const map = mapViewRef.current;
      if (!map || typeof map.getCoordinateFromView !== 'function') return null;
      const coordinate = await map.getCoordinateFromView([x, y]);
      const point = Array.isArray(coordinate)
        ? { lng: Number(coordinate[0]), lat: Number(coordinate[1]) }
        : null;
      return validRoutePoint(point) ? point : null;
    } catch {
      return null;
    }
  }

  function queuePoint(x: number, y: number, generation: number) {
    chainRef.current = chainRef.current.then(async () => {
      if (generationRef.current !== generation) return;
      const point = await unproject(x, y);
      if (!point) {
        coordinateFailureRef.current = true;
        return;
      }
      const previous = pointsRef.current.at(-1);
      if (!previous || routePointDistanceM(previous, point) >= 0.75) pointsRef.current.push(point);
    });
  }

  function begin(x: number, y: number) {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    endedNormallyRef.current = false;
    coordinateFailureRef.current = false;
    pointsRef.current = [];
    screenPointsRef.current = [{ x, y }];
    setScreenPoints(screenPointsRef.current);
    chainRef.current = Promise.resolve();
    queuePoint(x, y, generation);
  }

  function update(x: number, y: number) {
    const previous = screenPointsRef.current.at(-1);
    if (!previous || Math.hypot(previous.x - x, previous.y - y) >= 2) {
      screenPointsRef.current = [...screenPointsRef.current, { x, y }];
      setScreenPoints(screenPointsRef.current);
    }
    queuePoint(x, y, generationRef.current);
  }

  async function finish(x: number, y: number) {
    const generation = generationRef.current;
    endedNormallyRef.current = true;
    queuePoint(x, y, generation);
    await chainRef.current;
    if (generationRef.current !== generation) return;
    const points = pointsRef.current.map(point => ({ ...point }));
    pointsRef.current = [];
    screenPointsRef.current = [];
    setScreenPoints([]);
    if (coordinateFailureRef.current && points.length < 2) {
      onCancel('coordinate-unavailable');
      return;
    }
    onStroke(points);
  }

  function finalizeWithoutEnd() {
    if (endedNormallyRef.current) return;
    generationRef.current += 1;
    pointsRef.current = [];
    screenPointsRef.current = [];
    setScreenPoints([]);
    onCancel('gesture-interrupted');
  }

  const draw = Gesture.Pan()
    .minDistance(0)
    .minPointers(1)
    .maxPointers(1)
    .onBegin(event => {
      'worklet';
      runOnJS(begin)(event.absoluteX, event.absoluteY);
    })
    .onUpdate(event => {
      'worklet';
      runOnJS(update)(event.absoluteX, event.absoluteY);
    })
    .onEnd(event => {
      'worklet';
      runOnJS(finish)(event.absoluteX, event.absoluteY);
    })
    .onFinalize(() => {
      'worklet';
      runOnJS(finalizeWithoutEnd)();
    });

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View
        style={{
          position: 'absolute',
          top: insets.top + 54,
          left: 0,
          right: 0,
          bottom: bottomInset,
        }}
      >
        {screenPoints.length > 1 ? (
          <Svg pointerEvents="none" style={StyleSheet.absoluteFill}>
            <Polyline
              points={screenPoints.map(point => `${point.x},${point.y - (insets.top + 54)}`).join(' ')}
              fill="none"
              stroke={strokeColor}
              strokeWidth={5}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.82}
            />
          </Svg>
        ) : null}
        <GestureDetector gesture={draw}>
          <View style={StyleSheet.absoluteFill} collapsable={false} />
        </GestureDetector>
      </View>
    </View>
  );
}
