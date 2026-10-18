import React, { useRef, useState } from 'react';
import { findNodeHandle, PixelRatio, Platform, StyleSheet, UIManager, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import Svg, { Polyline } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RoutePoint } from '../../store/useRouteStore';
import { routePointDistanceM, validRoutePoint } from '../../features/route/orderedRouteDraft';

interface Props {
  active: boolean;
  mapViewRef: React.MutableRefObject<any>;
  onStroke: (points: RoutePoint[], capture: RouteDrawStrokeCapture) => void;
  onDrawingStart?: () => void;
  onCancel: (
    reason: 'gesture-interrupted' | 'coordinate-unavailable',
    capture?: RouteDrawStrokeCapture,
  ) => void;
  bottomInset?: number;
  strokeColor?: string;
}

export interface RouteDrawSample {
  timestampMs: number;
  /** Absolute window coordinate from RNGH; retained as the native evidence. */
  x: number;
  y: number;
  /** Coordinate in the MapView's local projection space. */
  mapX?: number;
  mapY?: number;
  mapOriginX?: number;
  mapOriginY?: number;
  mapOriginMeasured?: boolean;
  pixelRatio?: number;
  geographic?: RoutePoint;
}

export interface RouteDrawStrokeCapture {
  strokeId: string;
  startedAtMs: number;
  endedAtMs: number;
  samples: RouteDrawSample[];
  sampleCapacity: number;
  droppedSampleCount: number;
}

const MAX_NATIVE_SAMPLES = 4096;

interface MapWindowOrigin {
  x: number;
  y: number;
  measured: boolean;
}

/**
 * One finger draws one stroke. Any interruption cancels that provisional
 * stroke; accepted or cancelled work returns the owning editor to Browse so
 * ordinary map movement never depends on a paused multi-touch continuation.
 */
export function RouteDrawOverlay({
  active,
  mapViewRef,
  onStroke,
  onDrawingStart,
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
  const rawSamplesRef = useRef<RouteDrawSample[]>([]);
  const strokeIdRef = useRef('');
  const startedAtMsRef = useRef(0);
  const droppedSampleCountRef = useRef(0);
  const mapOriginPromiseRef = useRef<Promise<MapWindowOrigin>>(Promise.resolve({ x: 0, y: 0, measured: false }));
  const [screenPoints, setScreenPoints] = useState<Array<{ x: number; y: number }>>([]);

  if (!active || Platform.OS === 'web') return null;

  function measureMapOrigin(): Promise<MapWindowOrigin> {
    const map = mapViewRef.current;
    if (!map) {
      return Promise.resolve({ x: 0, y: 0, measured: false });
    }
    return new Promise(resolve => {
      const done = (x: number, y: number) => {
        resolve(Number.isFinite(x) && Number.isFinite(y)
          ? { x, y, measured: true }
          : { x: 0, y: 0, measured: false });
      };
      try {
        if (typeof map.measureInWindow === 'function') {
          map.measureInWindow(done);
          return;
        }
        // RNMapbox exposes a composite MapView ref on some native versions.
        // Resolve its host node instead of silently projecting absolute window
        // coordinates as map-local coordinates.
        const node = findNodeHandle(map);
        if (node != null && typeof UIManager.measureInWindow === 'function') {
          UIManager.measureInWindow(node, done);
          return;
        }
        resolve({ x: 0, y: 0, measured: false });
      } catch {
        resolve({ x: 0, y: 0, measured: false });
      }
    });
  }

  async function unproject(absoluteX: number, absoluteY: number): Promise<{
    point: RoutePoint | null;
    mapX: number;
    mapY: number;
    origin: MapWindowOrigin;
  }> {
    const origin = await mapOriginPromiseRef.current;
    const mapX = absoluteX - origin.x;
    const mapY = absoluteY - origin.y;
    try {
      const map = mapViewRef.current;
      if (!map || typeof map.getCoordinateFromView !== 'function') return { point: null, mapX, mapY, origin };
      const coordinate = await map.getCoordinateFromView([mapX, mapY]);
      const point = Array.isArray(coordinate)
        ? { lng: Number(coordinate[0]), lat: Number(coordinate[1]) }
        : null;
      return { point: validRoutePoint(point) ? point : null, mapX, mapY, origin };
    } catch {
      return { point: null, mapX, mapY, origin };
    }
  }

  function queuePoint(x: number, y: number, generation: number, sampleIndex: number) {
    chainRef.current = chainRef.current.then(async () => {
      if (generationRef.current !== generation) return;
      const projection = await unproject(x, y);
      const point = projection.point;
      const sample = rawSamplesRef.current[sampleIndex];
      if (sample) {
        sample.mapX = projection.mapX;
        sample.mapY = projection.mapY;
        sample.mapOriginX = projection.origin.x;
        sample.mapOriginY = projection.origin.y;
        sample.mapOriginMeasured = projection.origin.measured;
        sample.pixelRatio = PixelRatio.get();
      }
      if (!point) {
        coordinateFailureRef.current = true;
        return;
      }
      if (sample) sample.geographic = { ...point };
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
    startedAtMsRef.current = Date.now();
    droppedSampleCountRef.current = 0;
    strokeIdRef.current = `${startedAtMsRef.current}-${Math.random().toString(36).slice(2, 10)}`;
    rawSamplesRef.current = [{ timestampMs: startedAtMsRef.current, x, y }];
    mapOriginPromiseRef.current = measureMapOrigin();
    screenPointsRef.current = [{ x, y }];
    setScreenPoints(screenPointsRef.current);
    chainRef.current = Promise.resolve();
    onDrawingStart?.();
    queuePoint(x, y, generation, 0);
  }

  function update(x: number, y: number) {
    if (rawSamplesRef.current.length >= MAX_NATIVE_SAMPLES) {
      droppedSampleCountRef.current += 1;
      return;
    }
    const sampleIndex = rawSamplesRef.current.push({ timestampMs: Date.now(), x, y }) - 1;
    const previous = screenPointsRef.current.at(-1);
    if (!previous || Math.hypot(previous.x - x, previous.y - y) >= 2) {
      screenPointsRef.current = [...screenPointsRef.current, { x, y }];
      setScreenPoints(screenPointsRef.current);
    }
    queuePoint(x, y, generationRef.current, sampleIndex);
  }

  async function finish(x: number, y: number) {
    const generation = generationRef.current;
    endedNormallyRef.current = true;
    const endedAtMs = Date.now();
    if (rawSamplesRef.current.length < MAX_NATIVE_SAMPLES) {
      const sampleIndex = rawSamplesRef.current.push({ timestampMs: endedAtMs, x, y }) - 1;
      queuePoint(x, y, generation, sampleIndex);
      await chainRef.current;
    } else {
      // Preserve the pen-up position inside the bounded capture. Await older
      // projections first so one of them cannot attach its coordinate to the
      // replacement sample.
      droppedSampleCountRef.current += 1;
      await chainRef.current;
      const projection = await unproject(x, y);
      const point = projection.point;
      rawSamplesRef.current[MAX_NATIVE_SAMPLES - 1] = {
        timestampMs: endedAtMs,
        x,
        y,
        mapX: projection.mapX,
        mapY: projection.mapY,
        mapOriginX: projection.origin.x,
        mapOriginY: projection.origin.y,
        mapOriginMeasured: projection.origin.measured,
        pixelRatio: PixelRatio.get(),
        ...(point ? { geographic: { ...point } } : {}),
      };
      if (point) {
        const previous = pointsRef.current.at(-1);
        if (!previous || routePointDistanceM(previous, point) >= 0.75) pointsRef.current.push(point);
      } else {
        coordinateFailureRef.current = true;
      }
    }
    if (generationRef.current !== generation) return;
    const points = pointsRef.current.map(point => ({ ...point }));
    const capture: RouteDrawStrokeCapture = {
      strokeId: strokeIdRef.current,
      startedAtMs: startedAtMsRef.current,
      endedAtMs,
      sampleCapacity: MAX_NATIVE_SAMPLES,
      droppedSampleCount: droppedSampleCountRef.current,
      samples: rawSamplesRef.current.map(sample => ({
        ...sample,
        geographic: sample.geographic ? { ...sample.geographic } : undefined,
      })),
    };
    // A missing interior projection breaks geographic continuity. Never join
    // the successful samples on either side with an invented straight edge.
    if (coordinateFailureRef.current) {
      onCancel('coordinate-unavailable', capture);
      pointsRef.current = [];
      rawSamplesRef.current = [];
      screenPointsRef.current = [];
      setScreenPoints([]);
      return;
    }
    pointsRef.current = [];
    rawSamplesRef.current = [];
    screenPointsRef.current = [];
    setScreenPoints([]);
    onStroke(points, capture);
  }

  async function finalizeWithoutEnd() {
    if (endedNormallyRef.current) return;
    const generation = generationRef.current;
    await chainRef.current;
    if (generationRef.current !== generation || endedNormallyRef.current) return;
    const endedAtMs = Date.now();
    const capture: RouteDrawStrokeCapture = {
      strokeId: strokeIdRef.current,
      startedAtMs: startedAtMsRef.current,
      endedAtMs,
      sampleCapacity: MAX_NATIVE_SAMPLES,
      droppedSampleCount: droppedSampleCountRef.current,
      samples: rawSamplesRef.current.map(sample => ({
        ...sample,
        geographic: sample.geographic ? { ...sample.geographic } : undefined,
      })),
    };
    generationRef.current += 1;
    pointsRef.current = [];
    rawSamplesRef.current = [];
    screenPointsRef.current = [];
    setScreenPoints([]);
    onCancel('gesture-interrupted', capture);
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
    .onFinalize((_event, success) => {
      'worklet';
      // RNGH always finalizes after a successful onEnd. Calling the cancel
      // path unconditionally queued a competing JS transition; on a loaded
      // iPhone it could clear the stroke before async projection completed.
      if (!success) runOnJS(finalizeWithoutEnd)();
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
