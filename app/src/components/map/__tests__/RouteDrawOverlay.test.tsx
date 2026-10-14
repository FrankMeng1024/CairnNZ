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
});
