import fs from 'node:fs';
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
      mockRenderedSources.set(id, shape);
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
import { FogLayer } from '../components/FogLayer';
import { useFriendMemoryStore, type FriendProjection } from '../store/useFriendMemoryStore';
import { useMemoryScopeStore } from '../store/useMemoryScopeStore';
import { useMemoryStore } from '../store/useMemoryStore';
import { useMemorySubscriptionsStore } from '../store/useMemorySubscriptionsStore';

function polygonCount(shape: any): number {
  if (!shape?.geometry) return 0;
  return shape.geometry.type === 'Polygon' ? 1 : shape.geometry.coordinates.length;
}

describe('O84 isolated real API Friend Fog render boundary', () => {
  jest.setTimeout(20_000);

  test('the exact two authorized server projections reach production Mapbox ShapeSources', async () => {
    const evidencePath = process.env.O84_FRIEND_FOG_EVIDENCE;
    if (!evidencePath) throw new Error('O84_FRIEND_FOG_EVIDENCE is required');
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    expect(evidence.result).toBe('PASS');
    const fixture = evidence.render_fixture;
    expect(fixture.owners).toHaveLength(2);
    const viewerId = String(fixture.viewer_id);
    const now = Date.now();
    const projections: Record<string, FriendProjection> = {};
    for (const owner of fixture.owners) {
      const value = owner.projection;
      const friendId = String(value.source_friend_id);
      projections[friendId] = {
        friendId,
        authorizationVersion: Number(value.authorization_version),
        projectionVersion: String(value.projection_version),
        cellSizeM: Number(value.cell_size_m),
        cells: value.cells.map((cell: any) => ({ id: String(cell.id), polygon: cell.polygon })),
        regions: [],
        serverAuthorizedAtMs: now - 60_000,
        authorizationExpiresAtMs: now + 60 * 60 * 1000,
      };
    }
    const friendIds = Object.keys(projections);
    const expectedAuthorizedCells = Object.values(projections)
      .reduce((total, projection) => total + projection.cells.length, 0);
    const viewerPoints = fixture.viewer_points.map((point: any) => ({
      lat: point.lat,
      lng: point.lng,
      ts: point.ts,
      cid: point.cid,
      synced: true,
      evidenceSource: 'passive_real' as const,
      sourceSegmentId: point.source_segment_id,
      horizontalAccuracyM: point.horizontal_accuracy_m,
      continuityState: 'accepted' as const,
    }));

    useAppStore.setState({ user: { id: viewerId } as any, isLoggedIn: true, hydrated: true });
    useSettingsStore.setState({ debugMode: false });
    useActivitySimulatorStore.setState({ enabled: false });
    useMemoryScopeStore.setState({ scope: 'combined', selectedFriendId: null });
    useMemoryStore.setState(state => ({
      points: viewerPoints,
      testPoints: [],
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
        authorization_version: projections[id].authorizationVersion,
        effective_at: new Date(now - 60_000).toISOString(),
        sharing_status: 'shared' as const,
        coverage_scope: 'full_history_delayed_v1' as const,
      })),
      loading: false,
      error: null,
    });
    mockAuthenticatedFetch.mockImplementation(async (_url: string, options: any) => {
      const requestedId = String(JSON.parse(options.body).friend_ids[0]);
      const original = fixture.owners.find((owner: any) => String(owner.projection.source_friend_id) === requestedId)?.projection;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          projections: [{
            ...original,
            server_authorized_at: new Date(now - 60_000).toISOString(),
            authorization_expires_at: new Date(now + 60 * 60 * 1000).toISOString(),
          }],
          revoked_friend_ids: [],
        }),
      };
    });
    useFriendMemoryStore.getState().reset();
    await useFriendMemoryStore.getState().loadSelectedProjections(friendIds);

    const ready = jest.fn();
    render(<FogLayer onFogReady={ready} />);
    await waitFor(() => expect(mockRenderedSources.has('memory-friend-union-src')).toBe(true), { timeout: 15_000 });
    await waitFor(() => expect(ready).toHaveBeenCalled(), { timeout: 15_000 });

    const visible = useFriendMemoryStore.getState().getVisibleCells();
    expect(new Set(visible.map(cell => cell.sourceFriendId))).toEqual(new Set(friendIds));
    expect(visible).toHaveLength(expectedAuthorizedCells);
    const fogShape = mockRenderedSources.get('memory-fog-src');
    const friendShape = mockRenderedSources.get('memory-friend-union-src');
    expect(polygonCount(fogShape)).toBeGreaterThan(0);
    expect(polygonCount(friendShape)).toBeGreaterThan(0);
    expect(fogShape.properties.cairnEvidencePointCount).toBe(viewerPoints.length);

    // Emit source-backed measurements for the handoff artifact.
    process.stdout.write(`o84-friend-fog-mapbox=${JSON.stringify({
      sourceFriendIds: friendIds,
      authorizedCells: visible.length,
      friendSourcePolygons: polygonCount(friendShape),
      fogSourcePolygons: polygonCount(fogShape),
      mineEvidencePoints: viewerPoints.length,
      projectionVersions: Object.fromEntries(friendIds.map(id => [id, projections[id].projectionVersion])),
    })}\n`);

    await act(async () => {
      useFriendMemoryStore.getState().reset();
      useMemorySubscriptionsStore.getState().reset();
      useMemoryScopeStore.setState({ scope: 'self', selectedFriendId: null });
    });
  });
});
