jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../../../store/useTrackingStore', () => ({
  useTrackingStore: { getState: () => ({ status: 'idle', sessionId: null }) },
}));

import { fetchSimulatorWalkingRoute } from '../simulatorWalkingRoute';
import { MAX_SIMULATOR_AUTOPILOT_POINTS, useActivitySimulatorStore } from '../useActivitySimulatorStore';

const TOKEN = `pk.${'a'.repeat(64)}`;

describe('Simulator walking auto-move', () => {
  test('uses Mapbox walking Directions geometry, not a silent straight line', async () => {
    const fetchMock = jest.fn(async (url: string) => ({
      ok: true,
      json: async () => ({
        routes: [{
          distance: 321,
          geometry: { coordinates: [[168.6626, -45.0312], [168.663, -45.0305], [168.664, -45.03]] },
        }],
      }),
    }));
    const fetchImpl = fetchMock as unknown as typeof fetch;

    const result = await fetchSimulatorWalkingRoute(
      { lat: -45.0312, lng: 168.6626 },
      { lat: -45.03, lng: 168.664 },
      { mapboxToken: TOKEN, fetchImpl },
    );

    expect(result).toEqual({
      ok: true,
      distanceM: 321,
      points: [{ lat: -45.0305, lng: 168.663 }, { lat: -45.03, lng: 168.664 }],
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain('/directions/v5/mapbox/walking/');
  });

  test.each([
    [{ isOnline: false, mapboxToken: TOKEN }, 'offline'],
    [{ isOnline: true, mapboxToken: '' }, 'mapbox-token-unavailable'],
  ] as const)('fails closed rather than traversing a straight line: %s', async (options, reason) => {
    await expect(fetchSimulatorWalkingRoute(
      { lat: 31.23, lng: 121.47 },
      { lat: -45.03, lng: 168.66 },
      options,
    )).resolves.toEqual({ ok: false, reason });
  });

  test('bounds persisted walking geometry and activates the existing provider engine', () => {
    useActivitySimulatorStore.setState({ waypoints: [], autopilotActive: false });
    const points = Array.from({ length: MAX_SIMULATOR_AUTOPILOT_POINTS + 50 }, (_, index) => ({
      id: `p-${index}`,
      lat: -45 + index / 100_000,
      lng: 168,
    }));
    useActivitySimulatorStore.getState().replaceWaypoints(points);
    expect(useActivitySimulatorStore.getState().waypoints).toHaveLength(MAX_SIMULATOR_AUTOPILOT_POINTS);
    expect(useActivitySimulatorStore.getState().autopilotActive).toBe(true);
  });
});
