const mockAuthenticatedFetch = jest.fn();
const mockAcknowledgePreparedCoverage = jest.fn();
let mockUserId = 'viewer-a';
let mockPendingCids: string[] = [];

jest.mock('../../../services/apiService', () => ({
  authenticatedFetch: (...args: unknown[]) => mockAuthenticatedFetch(...args),
}));
jest.mock('../../../store/useAppStore', () => ({
  useAppStore: { getState: () => ({ user: { id: mockUserId } }) },
}));
jest.mock('../store/useMemoryStore', () => ({
  useMemoryStore: {
    getState: () => ({
      pendingPreparedCoverageCids: mockPendingCids,
      acknowledgePreparedCoverage: mockAcknowledgePreparedCoverage,
    }),
  },
}));

import { useMemoryNavigationSessionStore } from '../store/useMemoryNavigationSessionStore';
import { usePreparedMemoryCoverageStore } from '../store/usePreparedMemoryCoverageStore';

const viewport = { key: 'wellington', bbox: [174.7, -41.4, 174.9, -41.1] as [number, number, number, number] };

function snapshot(version: string, evidenceCount = 1) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      manifest: {
        snapshot_id: version,
        dataset_revision: version,
        coverage_rule_version: 4,
        as_of: '2026-10-26T00:00:00.000Z',
        expected_pages: 1,
        expected_tiles: 1,
        expected_evidence_count: evidenceCount,
        regions: [],
        complete: false,
      },
      page: {
        snapshot_id: version,
        page_index: 0,
        tiles: [{
          id: `tile-${version}`,
          bbox: viewport.bbox,
          evidence_count: evidenceCount,
          geometry_sha256: `sha-${version}`,
          geometry: { type: 'MultiPolygon', coordinates: [[[[174.7, -41.4], [174.8, -41.4], [174.8, -41.3], [174.7, -41.4]]]] },
        }],
        next_cursor: null,
        complete: true,
      },
    }),
  };
}

describe('Memory navigation session ownership', () => {
  beforeEach(() => {
    mockUserId = 'viewer-a';
    mockPendingCids = [];
    mockAuthenticatedFetch.mockReset();
    mockAcknowledgePreparedCoverage.mockReset();
    useMemoryNavigationSessionStore.getState().reset();
    usePreparedMemoryCoverageStore.getState().reset();
  });

  test('one session pins Mine across camera/city/recenter and defers ACK freshness to next entry', async () => {
    mockAuthenticatedFetch
      .mockResolvedValueOnce(snapshot('session-one'))
      .mockResolvedValueOnce(snapshot('session-two', 2));
    const firstSession = useMemoryNavigationSessionStore.getState().begin('viewer-a', []);
    const transitions: string[] = [];
    const unsubscribe = usePreparedMemoryCoverageStore.subscribe(state => transitions.push(state.status));
    await usePreparedMemoryCoverageStore.getState().loadViewport(viewport);
    const firstHash = JSON.stringify(useMemoryNavigationSessionStore.getState().mineCoverage?.geometry);

    for (let index = 0; index < 15; index += 1) {
      await usePreparedMemoryCoverageStore.getState().loadViewport({
        key: `gesture-${index}`,
        bbox: [174.7 + index * 0.001, -41.4, 174.9 + index * 0.001, -41.1],
      });
    }
    await usePreparedMemoryCoverageStore.getState().loadViewport({ ...viewport, key: 'recenter' });
    await usePreparedMemoryCoverageStore.getState().loadViewport({ ...viewport, key: 'beijing' });
    await usePreparedMemoryCoverageStore.getState().loadViewport({ ...viewport, key: 'shanghai' });
    await usePreparedMemoryCoverageStore.getState().loadViewport({ ...viewport, key: 'beijing-again' });
    usePreparedMemoryCoverageStore.getState().markServerCoverageDirty();
    await Promise.resolve();

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(useMemoryNavigationSessionStore.getState().mineCoverage?.geometry)).toBe(firstHash);
    expect(transitions.slice(transitions.lastIndexOf('ready') + 1)).not.toContain('loading');
    expect(usePreparedMemoryCoverageStore.getState().serverCoverageDirty).toBe(true);

    useMemoryNavigationSessionStore.getState().end(firstSession);
    useMemoryNavigationSessionStore.getState().begin('viewer-a', []);
    await usePreparedMemoryCoverageStore.getState().loadViewport({ ...viewport, key: 'next-session' });
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(2);
    expect(useMemoryNavigationSessionStore.getState().mineCoverage?.snapshotId).toBe('session-two');
    unsubscribe();
  });

  test('camera state keeps center zoom bearing pitch and rejects an older action', () => {
    useMemoryNavigationSessionStore.getState().begin('viewer-a', []);
    useMemoryNavigationSessionStore.getState().setCamera('viewer-a', {
      center: [116.32, 39.9], zoom: 18, bearing: 42, pitch: 35, actionId: 20,
    });
    useMemoryNavigationSessionStore.getState().setCamera('viewer-a', {
      center: [121.47, 31.23], zoom: 12, bearing: 0, pitch: 0, actionId: 19,
    });
    expect(useMemoryNavigationSessionStore.getState().camera).toEqual({
      center: [116.32, 39.9], zoom: 18, bearing: 42, pitch: 35, actionId: 20,
    });
  });

  test('late local hydration pins one coherent overlay cutoff and ignores later recording', () => {
    useMemoryNavigationSessionStore.getState().begin('viewer-a', [], false);
    const hydratedPoint = { lat: -41.3, lng: 174.8, ts: 10, cid: 'hydrated', evidenceSource: 'historical_unknown' as const };
    const laterPoint = { ...hydratedPoint, ts: 20, cid: 'later' };
    useMemoryNavigationSessionStore.getState().pinLocalOverlay('viewer-a', [hydratedPoint]);
    useMemoryNavigationSessionStore.getState().pinLocalOverlay('viewer-a', [hydratedPoint, laterPoint]);
    expect(useMemoryNavigationSessionStore.getState()).toMatchObject({
      localOverlayPinned: true,
      localOverlayPoints: [hydratedPoint],
    });
  });

  test('account change cannot reuse pinned geometry or camera', async () => {
    mockAuthenticatedFetch
      .mockResolvedValueOnce(snapshot('viewer-a'))
      .mockResolvedValueOnce(snapshot('viewer-b'));
    const sessionA = useMemoryNavigationSessionStore.getState().begin('viewer-a', []);
    await usePreparedMemoryCoverageStore.getState().loadViewport(viewport);
    useMemoryNavigationSessionStore.getState().end(sessionA);
    mockUserId = 'viewer-b';
    useMemoryNavigationSessionStore.getState().begin('viewer-b', []);
    await usePreparedMemoryCoverageStore.getState().loadViewport(viewport);
    expect(useMemoryNavigationSessionStore.getState()).toMatchObject({
      ownerId: 'viewer-b', camera: null, mineCoverage: { snapshotId: 'viewer-b' },
    });
  });
});
