import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';

const mockRenderedSources = new Map<string, any>();
const mockAuthenticatedFetch = jest.fn();

jest.mock('../../../services/apiService', () => ({
  authenticatedFetch: (...args: any[]) => mockAuthenticatedFetch(...args),
}));

jest.mock('../services/mapboxAdapter', () => ({
  getMapbox: () => {
    const mockReact = require('react');
    const MockView = require('react-native').View;
    return ({
    available: true,
    ShapeSource: ({ id, shape, children }: any) => {
      mockReact.useEffect(() => {
        mockRenderedSources.set(id, shape);
        return () => { mockRenderedSources.delete(id); };
      }, [id, shape]);
      return mockReact.createElement(MockView, { testID: id }, children);
    },
    FillLayer: ({ id }: any) => mockReact.createElement(MockView, { testID: id }),
    LineLayer: ({ id }: any) => mockReact.createElement(MockView, { testID: id }),
    });
  },
}));

jest.mock('../../../hooks/useVisualTheme', () => ({
  useVisualTheme: () => ({
    mapFogFill: '#111',
    mapFogEdgeOuter: '#222',
    mapFogEdgeInner: '#333',
    mapMineMemoryFill: '#173',
    mapMineMemoryOpacity: 0.3,
    mapFriendMemoryFill: '#0a7',
    mapFriendMemoryOpacity: 0.4,
    mapMemoryOverlapFill: '#fc0',
    mapMemoryOverlapOpacity: 0.5,
  }),
}));

jest.mock('../../../store/storage', () => ({
  storage: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
  },
}));

import { useAppStore } from '../../../store/useAppStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { useActivitySimulatorStore } from '../../activitySimulator/useActivitySimulatorStore';
import {
  FogLayer,
  memoryFogSafeFallbackPresentationKey,
  memoryFogSceneMatchesSelection,
  memoryFogSceneRemainsAuthorized,
} from '../components/FogLayer';
import { useFriendMemoryStore } from '../store/useFriendMemoryStore';
import { useMemoryScopeStore } from '../store/useMemoryScopeStore';
import { useMemoryStore } from '../store/useMemoryStore';
import { useMemorySubscriptionsStore } from '../store/useMemorySubscriptionsStore';
import { usePreparedMemoryCoverageStore } from '../store/usePreparedMemoryCoverageStore';

function polygonCount(shape: any): number {
  if (!shape?.geometry) return 0;
  return shape.geometry.type === 'Polygon' ? 1 : shape.geometry.coordinates.length;
}

function sceneFeature(shape: any, kind: 'fog' | 'mine' | 'friend' | 'overlap'): any {
  return shape?.features?.find((feature: any) => feature?.properties?.cairnFogKind === kind);
}

describe('O86 exact prepared coverage Mapbox render boundary', () => {
  jest.setTimeout(20_000);

  test('published Friends scenes fail closed on account, selection, or authorization-version change', () => {
    const common = {
      sceneAccountId: 'viewer-a',
      currentAccountId: 'viewer-a',
      friendSources: [{
        friendId: '31',
        authorizationVersion: 7,
        authorizationExpiresAtMs: 2_000,
      }],
      selectedFriendIds: ['31'],
      authorizedSourceVersions: { '31': 7 },
      nowMs: 1_000,
    };
    expect(memoryFogSceneRemainsAuthorized(common)).toBe(true);
    expect(memoryFogSceneMatchesSelection({ ...common, scope: 'combined' })).toBe(true);
    expect(memoryFogSceneMatchesSelection({
      ...common,
      scope: 'combined',
      selectedFriendIds: ['31', '32'],
      authorizedSourceVersions: { '31': 7, '32': 9 },
    })).toBe(false);
    expect(memoryFogSceneMatchesSelection({
      ...common,
      scope: 'self',
      selectedFriendIds: [],
    })).toBe(false);
    expect(memoryFogSceneRemainsAuthorized({
      ...common,
      authorizedSourceVersions: { '31': 8 },
    })).toBe(false);
    expect(memoryFogSceneRemainsAuthorized({
      ...common,
      selectedFriendIds: [],
    })).toBe(false);
    expect(memoryFogSceneRemainsAuthorized({
      ...common,
      currentAccountId: 'viewer-b',
    })).toBe(false);
    expect(memoryFogSceneRemainsAuthorized({
      ...common,
      nowMs: 2_000,
    })).toBe(false);
    expect(memoryFogSafeFallbackPresentationKey('viewer-b', 'self-v2')).toBeTruthy();
  });

  test('exact Mine and two Friends publish atomically in one stable source and revoke without legacy cells', async () => {
    const viewerId = 'prepared-viewer';
    const now = Date.now();
    const viewport = {
      key: '174.76000,-36.86000,174.80000,-36.82000',
      bbox: [174.76, -36.86, 174.8, -36.82] as [number, number, number, number],
    };
    const mineGeometry = { type: 'MultiPolygon' as const, coordinates: [[[[
      174.770, -36.850,
    ], [174.780, -36.850], [174.780, -36.840], [174.770, -36.840], [174.770, -36.850]]]] };
    const friendGeometries: Record<string, any> = {
      '31': { type: 'MultiPolygon', coordinates: [[[[174.775, -36.850], [174.785, -36.850], [174.785, -36.840], [174.775, -36.840], [174.775, -36.850]]]] },
      '32': { type: 'MultiPolygon', coordinates: [[[[174.790, -36.838], [174.795, -36.838], [174.795, -36.833], [174.790, -36.833], [174.790, -36.838]]]] },
    };
    const friendIds = Object.keys(friendGeometries);

    useAppStore.setState({ user: { id: viewerId } as any, isLoggedIn: true, hydrated: true });
    useSettingsStore.setState({ debugMode: false });
    useActivitySimulatorStore.setState({ enabled: false });
    useMemoryScopeStore.setState({ scope: 'combined' });
    useMemoryStore.setState(state => ({
      points: [],
      testPoints: [],
      pendingPreparedCoverageCids: [],
      geometryVersion: state.geometryVersion + 1,
      localHydration: {
        ownerUserId: viewerId,
        status: 'ready',
        requiresInitialReconcile: false,
        initialReconcile: 'not_required',
        revision: state.localHydration.revision + 1,
      },
    }));
    useMemorySubscriptionsStore.setState({
      subscriptions: friendIds.map(id => ({ friend_id: Number(id), friend_name: `Friend ${id}` })),
      availableSources: friendIds.map(id => ({
        friend_id: id,
        friend_name: `Friend ${id}`,
        selected: true,
        authorization_version: 4,
        effective_at: new Date(now - 60_000).toISOString(),
        sharing_status: 'shared' as const,
        coverage_scope: 'full_history_delayed_v1' as const,
      })),
      loading: false,
      error: null,
    });
    mockAuthenticatedFetch.mockImplementation(async (url: string, options: any) => {
      if (url.startsWith('/api/memory/coverage?bbox=')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            coverage_rule_version: 4,
            coverage_version: 'mine-exact-v1',
            evidence_count: 8,
            tile_count: 1,
            rebuilt_tile_count: 0,
            geometry: mineGeometry,
          }),
        };
      }
      const requestedId = String(JSON.parse(options.body).friend_ids[0]);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          projections: [{
            source_friend_id: requestedId,
            authorization_version: 4,
            projection_version: `friend-${requestedId}-exact-v1`,
            coverage_rule_version: 4,
            evidence_count: 4,
            cells: [],
            regions: [],
            geometry: friendGeometries[requestedId],
            server_authorized_at: new Date(now - 60_000).toISOString(),
            authorization_expires_at: new Date(now + 60 * 60 * 1000).toISOString(),
          }],
          revoked_friend_ids: [],
        }),
      };
    });
    mockRenderedSources.clear();
    usePreparedMemoryCoverageStore.getState().reset();
    useFriendMemoryStore.getState().reset();

    const ready = jest.fn();
    const unavailable = jest.fn();
    const view = render(<FogLayer viewport={viewport} onFogReady={ready} onFogUnavailable={unavailable} />);
    await waitFor(() => expect(sceneFeature(mockRenderedSources.get('memory-fog-src'), 'friend')).toBeTruthy(), { timeout: 15_000 });
    await waitFor(() => expect(sceneFeature(mockRenderedSources.get('memory-fog-src'), 'overlap')).toBeTruthy(), { timeout: 15_000 });
    await waitFor(() => expect(ready).toHaveBeenCalled(), { timeout: 15_000 });

    const visible = useFriendMemoryStore.getState().getVisibleGeometries();
    expect(new Set(visible.map(source => source.sourceFriendId))).toEqual(new Set(friendIds));
    expect(visible).toHaveLength(2);
    expect(useFriendMemoryStore.getState().getVisibleCells()).toEqual([]);
    const scene = mockRenderedSources.get('memory-fog-src');
    const fogShape = sceneFeature(scene, 'fog');
    const mineShape = sceneFeature(scene, 'mine');
    const friendShape = sceneFeature(scene, 'friend');
    const overlapShape = sceneFeature(scene, 'overlap');
    expect(polygonCount(fogShape)).toBeGreaterThan(0);
    expect(polygonCount(friendShape)).toBeGreaterThan(0);
    expect(polygonCount(overlapShape)).toBeGreaterThan(0);
    expect(polygonCount(mineShape)).toBeGreaterThan(0);
    expect(fogShape.properties.cairnEvidencePointCount).toBe(0);
    expect(usePreparedMemoryCoverageStore.getState().coverage?.coverageVersion).toBe('mine-exact-v1');

    // A refresh failure reports truthful pending/error state without clearing
    // a still-authorized warm scene or pretending the partial selection is a
    // newly completed combined render.
    await act(async () => {
      unavailable.mockClear();
      useFriendMemoryStore.setState(state => ({
        error: 'unavailable',
        sourceStates: {
          ...state.sourceStates,
          '31': { status: 'error', cellCount: 1, error: 'Unavailable' },
        },
        version: state.version + 1,
      }));
    });
    expect(unavailable).not.toHaveBeenCalled();
    expect(sceneFeature(mockRenderedSources.get('memory-fog-src'), 'friend')).toBeTruthy();
    await act(async () => {
      useFriendMemoryStore.setState(state => ({
        error: null,
        sourceStates: {
          ...state.sourceStates,
          '31': { status: 'loaded', cellCount: 1 },
        },
        version: state.version + 1,
      }));
    });

    // Finishing or revising the local journal does not change the exact
    // prepared account/scope/content authority. It must not clear the painted
    // Friend classifications and then short-circuit on the cached main mask.
    await act(async () => {
      useMemoryStore.setState(state => ({
        localHydration: {
          ...state.localHydration,
          revision: state.localHydration.revision + 1,
        },
      }));
    });
    await waitFor(() => expect(sceneFeature(mockRenderedSources.get('memory-fog-src'), 'friend')).toBeTruthy());
    await waitFor(() => expect(sceneFeature(mockRenderedSources.get('memory-fog-src'), 'overlap')).toBeTruthy());

    // A style reload remounts the sources while the exact authenticated
    // viewport stores stay current. It must not fall back to legacy cells.
    view.unmount();
    mockRenderedSources.clear();
    const remount = render(<FogLayer viewport={viewport} />);
    await waitFor(() => expect(sceneFeature(mockRenderedSources.get('memory-fog-src'), 'friend')).toBeTruthy(), { timeout: 15_000 });
    await waitFor(() => expect(sceneFeature(mockRenderedSources.get('memory-fog-src'), 'overlap')).toBeTruthy(), { timeout: 15_000 });

    // Revoking the overlapping friend removes that source immediately. The
    // geographically separate second friend remains, so overlap disappears
    // while Friends coverage stays visible.
    await act(async () => {
      await useFriendMemoryStore.getState().purgeFriend('31', viewerId);
    });
    await waitFor(() => expect(sceneFeature(mockRenderedSources.get('memory-fog-src'), 'overlap')).toBeFalsy(), { timeout: 15_000 });
    await waitFor(() => expect(sceneFeature(mockRenderedSources.get('memory-fog-src'), 'friend')).toBeTruthy(), { timeout: 15_000 });
    expect(useFriendMemoryStore.getState().getVisibleGeometries().map(item => item.sourceFriendId)).toEqual(['32']);

    process.stdout.write(`o86-exact-friend-fog-mapbox=${JSON.stringify({
      sourceFriendIds: friendIds,
      exactGeometrySources: visible.length,
      legacyCells: 0,
      friendSourcePolygons: polygonCount(friendShape),
      overlapSourcePolygons: polygonCount(overlapShape),
      fogSourcePolygons: polygonCount(fogShape),
      mineCoverageVersion: usePreparedMemoryCoverageStore.getState().coverage?.coverageVersion,
    })}\n`);

    remount.unmount();
    await act(async () => {
      useFriendMemoryStore.getState().reset();
      usePreparedMemoryCoverageStore.getState().reset();
      useMemorySubscriptionsStore.getState().reset();
      useMemoryScopeStore.setState({ scope: 'self' });
    });
  });
});

describe('O86 prepared viewport render lifecycle', () => {
  test('a cold combined terminal error exposes safe Fog and unavailable feedback, never Mine-as-complete', async () => {
    const ownerId = 'cold-friend-error-owner';
    const viewport = {
      key: '174.76000,-36.86000,174.78000,-36.84000',
      bbox: [174.76, -36.86, 174.78, -36.84] as [number, number, number, number],
    };
    useAppStore.setState({ user: { id: ownerId } as any, isLoggedIn: true, hydrated: true });
    useSettingsStore.setState({ debugMode: false });
    useActivitySimulatorStore.setState({ enabled: false });
    useMemoryScopeStore.setState({ ownerUserId: ownerId, scope: 'combined' });
    useMemorySubscriptionsStore.setState({
      subscriptions: [{ friend_id: 31, friend_name: 'Unavailable Friend' }],
      availableSources: [{
        friend_id: '31', friend_name: 'Unavailable Friend', selected: true,
        authorization_version: 1, effective_at: new Date().toISOString(),
        sharing_status: 'shared', coverage_scope: 'full_history_delayed_v1',
      }],
      loading: false,
      error: null,
    });
    useMemoryStore.setState(state => ({
      points: [], testPoints: [], pendingPreparedCoverageCids: [],
      geometryVersion: state.geometryVersion + 1,
      localHydration: {
        ownerUserId: ownerId, status: 'ready', requiresInitialReconcile: false,
        initialReconcile: 'not_required', revision: state.localHydration.revision + 1,
      },
    }));
    usePreparedMemoryCoverageStore.setState({
      userId: ownerId,
      coverage: {
        viewportKey: viewport.key, coverageVersion: 'cold-error-mine-v1', coverageRuleVersion: 4,
        geometry: { type: 'MultiPolygon', coordinates: [] }, evidenceCount: 0, loadedAtMs: Date.now(),
      },
      status: 'ready', error: null, version: 1, viewport,
      loadViewport: jest.fn(async () => undefined),
    });
    const loadSelectedProjections = jest.fn(async () => undefined);
    useFriendMemoryStore.setState({
      userId: ownerId,
      projections: {},
      authorizedSourceVersions: {},
      activeViewport: viewport,
      loading: false,
      error: 'unavailable',
      sourceStates: { '31': { status: 'error', cellCount: 0, error: 'Unavailable' } },
      loadSelectedProjections,
    });
    mockRenderedSources.clear();
    const ready = jest.fn();
    const unavailable = jest.fn();
    const view = render(<FogLayer viewport={viewport} onFogReady={ready} onFogUnavailable={unavailable} />);

    await waitFor(() => expect(unavailable).toHaveBeenCalled());
    await waitFor(() => expect(sceneFeature(mockRenderedSources.get('memory-fog-src'), 'fog')).toBeTruthy());
    expect(ready).not.toHaveBeenCalled();
    expect(sceneFeature(mockRenderedSources.get('memory-fog-src'), 'friend')).toBeFalsy();
    expect(sceneFeature(mockRenderedSources.get('memory-fog-src'), 'overlap')).toBeFalsy();

    view.unmount();
    useFriendMemoryStore.getState().reset();
    usePreparedMemoryCoverageStore.getState().reset();
    useMemorySubscriptionsStore.getState().reset();
  });

  test('a same-key viewport rerender does not restart prepared coverage work', async () => {
    const viewport = { key: '174.76000,-36.86000,174.78000,-36.84000', bbox: [174.76, -36.86, 174.78, -36.84] as [number, number, number, number] };
    const loadViewport = jest.fn(async () => undefined);
    useAppStore.setState({ user: { id: 'viewport-owner' } as any, isLoggedIn: true, hydrated: true });
    useSettingsStore.setState({ debugMode: false });
    useActivitySimulatorStore.setState({ enabled: false });
    useMemoryScopeStore.setState({ scope: 'self' });
    useMemoryStore.setState(state => ({
      points: [],
      testPoints: [],
      pendingPreparedCoverageCids: [],
      geometryVersion: state.geometryVersion + 1,
      localHydration: {
        ownerUserId: 'viewport-owner', status: 'ready', requiresInitialReconcile: false,
        initialReconcile: 'not_required', revision: state.localHydration.revision + 1,
      },
    }));
    usePreparedMemoryCoverageStore.setState({
      userId: 'viewport-owner',
      coverage: {
        viewportKey: viewport.key,
        coverageVersion: 'same-key-v1',
        coverageRuleVersion: 4,
        geometry: { type: 'MultiPolygon', coordinates: [] },
        evidenceCount: 0,
        loadedAtMs: Date.now(),
      },
      status: 'ready', error: null, version: 1, viewport, loadViewport,
    });

    const view = render(<FogLayer viewport={{ ...viewport, bbox: [...viewport.bbox] }} />);
    await waitFor(() => expect(loadViewport).toHaveBeenCalledTimes(1));
    view.rerender(<FogLayer viewport={{ ...viewport, bbox: [...viewport.bbox] }} />);
    await act(async () => undefined);
    expect(loadViewport).toHaveBeenCalledTimes(1);

    view.unmount();
    usePreparedMemoryCoverageStore.getState().reset();
  });

  test('loads Friends when the selected contributor list arrives after FogLayer mounts', async () => {
    const viewport = { key: '174.76000,-36.86000,174.78000,-36.84000', bbox: [174.76, -36.86, 174.78, -36.84] as [number, number, number, number] };
    const loadSelectedProjections = jest.fn(async () => undefined);
    useAppStore.setState({ user: { id: 'late-subscriptions-owner' } as any, isLoggedIn: true, hydrated: true });
    useSettingsStore.setState({ debugMode: false });
    useActivitySimulatorStore.setState({ enabled: false });
    useMemoryScopeStore.setState({ ownerUserId: 'late-subscriptions-owner', scope: 'combined' });
    useMemorySubscriptionsStore.setState({ subscriptions: [], availableSources: [], loading: true, error: null });
    useMemoryStore.setState(state => ({
      points: [], testPoints: [], pendingPreparedCoverageCids: [],
      geometryVersion: state.geometryVersion + 1,
      localHydration: {
        ownerUserId: 'late-subscriptions-owner', status: 'ready', requiresInitialReconcile: false,
        initialReconcile: 'not_required', revision: state.localHydration.revision + 1,
      },
    }));
    usePreparedMemoryCoverageStore.setState({
      userId: 'late-subscriptions-owner',
      coverage: {
        viewportKey: viewport.key, coverageVersion: 'late-subscriptions-v1', coverageRuleVersion: 4,
        geometry: { type: 'MultiPolygon', coordinates: [] }, evidenceCount: 0, loadedAtMs: Date.now(),
      },
      status: 'ready', error: null, version: 1, viewport,
    });
    useFriendMemoryStore.setState({ userId: 'late-subscriptions-owner', loadSelectedProjections });

    const view = render(<FogLayer viewport={viewport} />);
    await waitFor(() => expect(loadSelectedProjections).toHaveBeenCalledTimes(1));
    loadSelectedProjections.mockClear();

    act(() => {
      useMemorySubscriptionsStore.setState({
        subscriptions: [{ friend_id: 31, friend_name: 'Late Friend' }],
        availableSources: [{
          friend_id: '31', friend_name: 'Late Friend', selected: true,
          authorization_version: 1, effective_at: new Date().toISOString(),
          sharing_status: 'shared', coverage_scope: 'full_history_delayed_v1',
        }],
        loading: false, error: null,
      });
    });

    await waitFor(() => expect(loadSelectedProjections).toHaveBeenCalledWith(undefined, viewport));
    view.unmount();
    useFriendMemoryStore.getState().reset();
    usePreparedMemoryCoverageStore.getState().reset();
    useMemorySubscriptionsStore.getState().reset();
  });
});
