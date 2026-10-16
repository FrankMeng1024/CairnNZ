import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';

let mockPanCallbacks: Record<string, (...args: any[]) => any> = {};
const mockMaxPointers = jest.fn();

jest.mock('react-native-gesture-handler', () => {
  const ReactModule = require('react'); const { View } = require('react-native');
  const builder: any = {
    minDistance: () => builder,
    minPointers: () => builder,
    maxPointers: (value: number) => { mockMaxPointers(value); return builder; },
    onBegin: (fn: any) => { mockPanCallbacks.onBegin = fn; return builder; },
    onUpdate: (fn: any) => { mockPanCallbacks.onUpdate = fn; return builder; },
    onEnd: (fn: any) => { mockPanCallbacks.onEnd = fn; return builder; },
    onFinalize: (fn: any) => { mockPanCallbacks.onFinalize = fn; return builder; },
  };
  return {
    Gesture: { Pan: () => builder },
    GestureDetector: ({ children }: any) => ReactModule.createElement(View, null, children),
  };
});
jest.mock('react-native-reanimated', () => ({ runOnJS: (fn: any) => fn }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock('react-native-svg', () => {
  const ReactModule = require('react'); const { View } = require('react-native');
  const Svg = ({ children }: any) => ReactModule.createElement(View, null, children);
  return { __esModule: true, default: Svg, Polyline: () => null };
});

import { RouteDrawOverlay } from '../RouteDrawOverlay';

describe('RouteDrawOverlay native gesture handoff', () => {
  beforeEach(() => {
    mockPanCallbacks = {};
    jest.clearAllMocks();
  });

  test('one finger records map coordinates and commits only on normal pen-up', async () => {
    const onStroke = jest.fn();
    const mapViewRef = { current: {
      getCoordinateFromView: jest.fn(async ([x, y]: [number, number]) => [174 + x / 1000, -41 + y / 1000]),
    } } as any;
    render(<RouteDrawOverlay active mapViewRef={mapViewRef} onStroke={onStroke} onCancel={jest.fn()} />);

    expect(mockMaxPointers).toHaveBeenCalledWith(1);
    await act(async () => {
      mockPanCallbacks.onBegin({ absoluteX: 10, absoluteY: 20 });
      mockPanCallbacks.onUpdate({ absoluteX: 20, absoluteY: 30 });
      mockPanCallbacks.onEnd({ absoluteX: 30, absoluteY: 40 });
      mockPanCallbacks.onFinalize({}, true);
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(onStroke).toHaveBeenCalledTimes(1));
    expect(onStroke.mock.calls[0][0]).toEqual([
      { lng: 174.01, lat: -40.98 },
      { lng: 174.02, lat: -40.97 },
      { lng: 174.03, lat: -40.96 },
    ]);
    expect(onStroke.mock.calls[0][1]).toMatchObject({
      strokeId: expect.any(String),
      startedAtMs: expect.any(Number),
      endedAtMs: expect.any(Number),
      samples: [
        { x: 10, y: 20, geographic: { lng: 174.01, lat: -40.98 } },
        { x: 20, y: 30, geographic: { lng: 174.02, lat: -40.97 } },
        { x: 30, y: 40, geographic: { lng: 174.03, lat: -40.96 } },
      ],
    });
  });

  test('projects absolute finger samples through the measured MapView-local origin', async () => {
    const onStroke = jest.fn();
    const mapViewRef = { current: {
      measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => callback(7, 54, 390, 700),
      getCoordinateFromView: jest.fn(async ([x, y]: [number, number]) => [174 + x / 1000, -41 + y / 1000]),
    } } as any;
    render(<RouteDrawOverlay active mapViewRef={mapViewRef} onStroke={onStroke} onCancel={jest.fn()} />);

    await act(async () => {
      mockPanCallbacks.onBegin({ absoluteX: 107, absoluteY: 254 });
      mockPanCallbacks.onUpdate({ absoluteX: 127, absoluteY: 274 });
      mockPanCallbacks.onEnd({ absoluteX: 147, absoluteY: 294 });
      mockPanCallbacks.onFinalize({}, true);
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(onStroke).toHaveBeenCalledTimes(1));
    expect(mapViewRef.current.getCoordinateFromView).toHaveBeenNthCalledWith(1, [100, 200]);
    expect(onStroke.mock.calls[0][1].samples[0]).toMatchObject({
      x: 107,
      y: 254,
      mapX: 100,
      mapY: 200,
      mapOriginX: 7,
      mapOriginY: 54,
      mapOriginMeasured: true,
    });
  });

  test('a pointer-count interruption cancels provisional ink and yields to native map navigation', async () => {
    const onStroke = jest.fn();
    const onCancel = jest.fn();
    const mapViewRef = { current: {
      getCoordinateFromView: jest.fn(async ([x, y]: [number, number]) => [121 + x / 1000, 31 + y / 1000]),
    } } as any;
    render(<RouteDrawOverlay
      active mapViewRef={mapViewRef} onStroke={onStroke}
      onCancel={onCancel}
    />);

    await act(async () => {
      mockPanCallbacks.onBegin({ absoluteX: 10, absoluteY: 20 });
      mockPanCallbacks.onUpdate({ absoluteX: 30, absoluteY: 40 });
      mockPanCallbacks.onFinalize({}, false);
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(onCancel).toHaveBeenCalledWith('gesture-interrupted'));
    expect(onStroke).not.toHaveBeenCalled();
  });

  test('cancels the whole stroke when an interior map projection is missing', async () => {
    const onStroke = jest.fn();
    const onCancel = jest.fn();
    let projection = 0;
    const mapViewRef = { current: {
      getCoordinateFromView: jest.fn(async ([x, y]: [number, number]) => {
        projection += 1;
        return projection === 2 ? null : [174 + x / 1000, -41 + y / 1000];
      }),
    } } as any;
    render(<RouteDrawOverlay active mapViewRef={mapViewRef} onStroke={onStroke} onCancel={onCancel} />);

    await act(async () => {
      mockPanCallbacks.onBegin({ absoluteX: 10, absoluteY: 20 });
      mockPanCallbacks.onUpdate({ absoluteX: 20, absoluteY: 30 });
      mockPanCallbacks.onEnd({ absoluteX: 30, absoluteY: 40 });
      mockPanCallbacks.onFinalize({}, true);
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(onCancel).toHaveBeenCalledWith('coordinate-unavailable'));
    expect(onStroke).not.toHaveBeenCalled();
  });
});
