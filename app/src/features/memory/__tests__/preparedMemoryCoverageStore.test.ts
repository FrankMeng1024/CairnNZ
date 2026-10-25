const mockAuthenticatedFetch = jest.fn();
const mockAcknowledgePreparedCoverage = jest.fn();
let mockUserId = 'viewer-a';

jest.mock('../../../services/apiService', () => ({
  authenticatedFetch: (...args: unknown[]) => mockAuthenticatedFetch(...args),
}));
jest.mock('../../../store/useAppStore', () => ({
  useAppStore: { getState: () => ({ user: { id: mockUserId } }) },
}));
jest.mock('../store/useMemoryStore', () => ({
  useMemoryStore: { getState: () => ({ acknowledgePreparedCoverage: mockAcknowledgePreparedCoverage }) },
}));

import {
  PREPARED_MEMORY_COVERAGE_TIMEOUT_MS,
  usePreparedMemoryCoverageStore,
} from '../store/usePreparedMemoryCoverageStore';

const viewport = { key: 'viewport-a', bbox: [174.77, -41.29, 174.79, -41.28] as [number, number, number, number] };

function response(version: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      manifest: {
        snapshot_id: version,
        dataset_revision: version,
        coverage_rule_version: 4,
        as_of: '2026-10-24T00:00:00.000Z',
        expected_pages: 1,
        expected_tiles: 1,
        expected_evidence_count: 2,
        regions: [],
        complete: false,
      },
      page: {
        snapshot_id: version,
        page_index: 0,
        tiles: [{
          id: 'tile-1',
          bbox: [174.7, -41.4, 174.9, -41.1],
          evidence_count: 2,
          geometry_sha256: `sha-${version}`,
          geometry: { type: 'MultiPolygon', coordinates: [[[[174.77, -41.29], [174.78, -41.29], [174.77, -41.28], [174.77, -41.29]]]] },
        }],
        next_cursor: null,
        complete: true,
      },
    }),
  };
}

describe('prepared Memory viewport handoff', () => {
  beforeEach(() => {
    mockUserId = 'viewer-a';
    mockAuthenticatedFetch.mockReset();
    mockAcknowledgePreparedCoverage.mockReset();
    usePreparedMemoryCoverageStore.getState().reset();
  });

  test('reuses a ready viewport ordinarily but forces a post-ACK refresh', async () => {
    mockAuthenticatedFetch
      .mockResolvedValueOnce(response('revision-1'))
      .mockResolvedValueOnce(response('revision-2'));

    await usePreparedMemoryCoverageStore.getState().loadViewport(viewport);
    expect(usePreparedMemoryCoverageStore.getState().coverage?.coverageVersion).toBe('revision-1');
    expect(mockAcknowledgePreparedCoverage).toHaveBeenCalledTimes(1);

    await usePreparedMemoryCoverageStore.getState().loadViewport(viewport);
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);

    await usePreparedMemoryCoverageStore.getState().refreshCurrentViewport();
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(2);
    expect(usePreparedMemoryCoverageStore.getState().coverage?.coverageVersion).toBe('revision-2');
    expect(mockAcknowledgePreparedCoverage).toHaveBeenCalledTimes(2);
  });

  test('coalesces an identical in-flight viewport instead of restarting it', async () => {
    let resolveRequest!: (value: ReturnType<typeof response>) => void;
    mockAuthenticatedFetch.mockImplementationOnce(() => new Promise(resolve => { resolveRequest = resolve; }));

    const first = usePreparedMemoryCoverageStore.getState().loadViewport(viewport);
    const duplicate = usePreparedMemoryCoverageStore.getState().loadViewport({ ...viewport });
    await duplicate;
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);

    resolveRequest(response('coalesced'));
    await first;
    expect(usePreparedMemoryCoverageStore.getState().coverage?.coverageVersion).toBe('coalesced');
  });

  test('Recenter or a distant camera reuses the complete dataset without another request', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(response('all-regions-v1'));
    await usePreparedMemoryCoverageStore.getState().loadViewport(viewport);
    await usePreparedMemoryCoverageStore.getState().loadViewport({
      key: 'distant-camera',
      bbox: [168.5, -46.0, 168.8, -45.7],
    });
    await usePreparedMemoryCoverageStore.getState().loadViewport({ ...viewport, key: 'recenter' });

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
    expect(usePreparedMemoryCoverageStore.getState()).toMatchObject({
      status: 'ready',
      coverage: { snapshotId: 'all-regions-v1', complete: true, expectedTiles: 1 },
    });
  });

  test('a successful automatic sync cannot leave a ready cache stale when no screen owns a viewport', async () => {
    mockAuthenticatedFetch
      .mockResolvedValueOnce(response('before-automatic-memory'))
      .mockResolvedValueOnce(response('after-automatic-memory'));
    await usePreparedMemoryCoverageStore.getState().loadViewport(viewport);

    // Leaving Memory can remove the current presentation viewport while the
    // complete in-memory snapshot remains reusable. This is the exact passive
    // recording boundary used by memorySync after its server ACK.
    usePreparedMemoryCoverageStore.setState({ viewport: null });
    usePreparedMemoryCoverageStore.getState().markServerCoverageDirty();
    await usePreparedMemoryCoverageStore.getState().loadViewport({
      ...viewport,
      key: 'memory-re-entry-after-automatic-sync',
    });

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(2);
    expect(usePreparedMemoryCoverageStore.getState().coverage?.coverageVersion)
      .toBe('after-automatic-memory');
  });

  test('a first-ever read after an ACK accepts the first complete post-ACK snapshot', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(response('snapshot-after-first-ack'));
    usePreparedMemoryCoverageStore.getState().markServerCoverageDirty();

    await usePreparedMemoryCoverageStore.getState().loadViewport(viewport);

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
    expect(usePreparedMemoryCoverageStore.getState()).toMatchObject({
      status: 'ready',
      serverCoverageDirty: false,
      coverage: { snapshotId: 'snapshot-after-first-ack' },
    });
  });

  test('two ACKs before first Memory entry coalesce into one complete acquisition', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(response('snapshot-after-two-acks'));
    usePreparedMemoryCoverageStore.getState().markServerCoverageDirty();
    usePreparedMemoryCoverageStore.getState().markServerCoverageDirty();

    await usePreparedMemoryCoverageStore.getState().loadViewport(viewport);

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
    expect(usePreparedMemoryCoverageStore.getState()).toMatchObject({
      status: 'ready',
      serverCoverageDirty: false,
      coverage: { snapshotId: 'snapshot-after-two-acks' },
    });
  });

  test('a first-ever 503 retains dirty and the next complete snapshot terminates it', async () => {
    usePreparedMemoryCoverageStore.getState().markServerCoverageDirty();
    mockAuthenticatedFetch.mockResolvedValueOnce({ ok: false, status: 503 });
    await usePreparedMemoryCoverageStore.getState().loadViewport(viewport);
    expect(usePreparedMemoryCoverageStore.getState()).toMatchObject({
      status: 'error',
      coverage: null,
      serverCoverageDirty: true,
    });

    mockAuthenticatedFetch.mockResolvedValueOnce(response('snapshot-after-first-503'));
    await usePreparedMemoryCoverageStore.getState().loadViewport({ ...viewport, key: 'first-entry-retry' });
    expect(usePreparedMemoryCoverageStore.getState()).toMatchObject({
      status: 'ready',
      serverCoverageDirty: false,
      coverage: { snapshotId: 'snapshot-after-first-503' },
    });
  });

  test('an unchanged snapshot remains dirty and retries on the next city entry', async () => {
    mockAuthenticatedFetch
      .mockResolvedValueOnce(response('before-passive-write'))
      .mockResolvedValueOnce(response('before-passive-write'))
      .mockResolvedValueOnce(response('after-passive-write'));
    await usePreparedMemoryCoverageStore.getState().loadViewport(viewport);
    usePreparedMemoryCoverageStore.setState({ viewport: null });
    usePreparedMemoryCoverageStore.getState().markServerCoverageDirty();

    await usePreparedMemoryCoverageStore.getState().loadViewport({
      ...viewport,
      key: 'same-city-first-re-entry',
    });
    expect(usePreparedMemoryCoverageStore.getState()).toMatchObject({
      serverCoverageDirty: true,
      coverage: { snapshotId: 'before-passive-write' },
    });

    usePreparedMemoryCoverageStore.setState({ viewport: null });
    await usePreparedMemoryCoverageStore.getState().loadViewport({
      key: 'different-city-second-re-entry',
      bbox: [168.5, -46.0, 168.8, -45.7],
    });
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(3);
    expect(usePreparedMemoryCoverageStore.getState()).toMatchObject({
      serverCoverageDirty: false,
      coverage: { snapshotId: 'after-passive-write' },
    });
  });

  test('a failed dirty refresh retries successfully without discarding the complete scene', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(response('before-retry'));
    await usePreparedMemoryCoverageStore.getState().loadViewport(viewport);
    usePreparedMemoryCoverageStore.setState({ viewport: null });
    usePreparedMemoryCoverageStore.getState().markServerCoverageDirty();
    mockAuthenticatedFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    await usePreparedMemoryCoverageStore.getState().loadViewport({ ...viewport, key: 'failed-re-entry' });
    expect(usePreparedMemoryCoverageStore.getState()).toMatchObject({
      status: 'error',
      serverCoverageDirty: true,
      coverage: { snapshotId: 'before-retry' },
    });

    mockAuthenticatedFetch.mockResolvedValueOnce(response('after-retry'));
    await usePreparedMemoryCoverageStore.getState().loadViewport({ ...viewport, key: 'successful-re-entry' });
    expect(usePreparedMemoryCoverageStore.getState()).toMatchObject({
      status: 'ready',
      serverCoverageDirty: false,
      coverage: { snapshotId: 'after-retry' },
    });
  });

  test('a server write arriving during refresh fences the older response and schedules another fetch', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(response('before-delayed-write'));
    await usePreparedMemoryCoverageStore.getState().loadViewport(viewport);
    usePreparedMemoryCoverageStore.setState({ viewport: null });
    usePreparedMemoryCoverageStore.getState().markServerCoverageDirty();

    let releaseOlder!: (value: ReturnType<typeof response>) => void;
    mockAuthenticatedFetch
      .mockImplementationOnce(() => new Promise(resolve => { releaseOlder = resolve; }))
      .mockResolvedValueOnce(response('after-latest-write'));
    const pending = usePreparedMemoryCoverageStore.getState().loadViewport({ ...viewport, key: 'delayed-refresh' });
    usePreparedMemoryCoverageStore.getState().markServerCoverageDirty();
    releaseOlder(response('after-first-write'));
    await pending;
    for (let attempt = 0; attempt < 10 && mockAuthenticatedFetch.mock.calls.length < 3; attempt += 1) {
      await Promise.resolve();
    }
    for (let attempt = 0; attempt < 10
      && usePreparedMemoryCoverageStore.getState().coverage?.snapshotId !== 'after-latest-write'; attempt += 1) {
      await Promise.resolve();
    }

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(3);
    expect(usePreparedMemoryCoverageStore.getState()).toMatchObject({
      status: 'ready',
      serverCoverageDirty: false,
      coverage: { snapshotId: 'after-latest-write' },
    });
  });

  test('a missing terminal page never publishes incomplete data as complete', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        manifest: {
          snapshot_id: 'missing-page', dataset_revision: '7', coverage_rule_version: 4,
          as_of: '2026-10-24T00:00:00.000Z', expected_pages: 2, expected_tiles: 2,
          expected_evidence_count: 4, regions: [], complete: false,
        },
        page: {
          snapshot_id: 'missing-page', page_index: 0, tiles: [{
            id: 'tile-1', bbox: [174.7, -41.4, 174.9, -41.1], evidence_count: 2,
            geometry_sha256: 'sha-1', geometry: { type: 'MultiPolygon', coordinates: [] },
          }],
          next_cursor: null,
          complete: true,
        },
      }),
    });

    await usePreparedMemoryCoverageStore.getState().loadViewport(viewport);
    expect(usePreparedMemoryCoverageStore.getState()).toMatchObject({
      coverage: null,
      status: 'error',
      lastFailure: { kind: 'payload', stage: 'completeness', causeCode: 'INCOMPLETE_SNAPSHOT' },
    });
  });

  test('an account change drops the prior account geometry before accepting a response', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(response('viewer-a'));
    await usePreparedMemoryCoverageStore.getState().loadViewport(viewport);

    mockUserId = 'viewer-b';
    mockAuthenticatedFetch.mockResolvedValueOnce(response('viewer-b'));
    const pending = usePreparedMemoryCoverageStore.getState().loadViewport(viewport, true);
    expect(usePreparedMemoryCoverageStore.getState().coverage).toBeNull();
    await pending;
    expect(usePreparedMemoryCoverageStore.getState().userId).toBe('viewer-b');
    expect(usePreparedMemoryCoverageStore.getState().coverage?.coverageVersion).toBe('viewer-b');
  });

  test('an account switch during a dirty request cannot transfer its late geometry', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(response('viewer-a-initial'));
    await usePreparedMemoryCoverageStore.getState().loadViewport(viewport);
    usePreparedMemoryCoverageStore.setState({ viewport: null });
    usePreparedMemoryCoverageStore.getState().markServerCoverageDirty();

    let releaseViewerA!: (value: ReturnType<typeof response>) => void;
    mockAuthenticatedFetch.mockImplementationOnce(() => new Promise(resolve => { releaseViewerA = resolve; }));
    const viewerARequest = usePreparedMemoryCoverageStore.getState().loadViewport({ ...viewport, key: 'viewer-a-dirty' });

    mockUserId = 'viewer-b';
    mockAuthenticatedFetch.mockResolvedValueOnce(response('viewer-b-current'));
    const viewerBRequest = usePreparedMemoryCoverageStore.getState().loadViewport({ ...viewport, key: 'viewer-b-first' }, true);
    releaseViewerA(response('viewer-a-late'));
    await Promise.all([viewerARequest, viewerBRequest]);

    expect(usePreparedMemoryCoverageStore.getState()).toMatchObject({
      userId: 'viewer-b',
      status: 'ready',
      serverCoverageDirty: false,
      coverage: { snapshotId: 'viewer-b-current', datasetRevision: 'viewer-b-current' },
    });
  });

  test('times out a request that never resolves and exposes a retryable error', async () => {
    jest.useFakeTimers();
    mockAuthenticatedFetch.mockImplementation((_path: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }));

    const pending = usePreparedMemoryCoverageStore.getState().loadViewport(viewport);
    jest.advanceTimersByTime(PREPARED_MEMORY_COVERAGE_TIMEOUT_MS);
    await pending;

    expect(usePreparedMemoryCoverageStore.getState()).toMatchObject({
      status: 'error',
      error: 'Memory coverage timed out',
    });
    expect(mockAuthenticatedFetch.mock.calls[0][1].signal.aborted).toBe(true);
    jest.useRealTimers();
  });

  test('reset aborts in-flight work and a late response cannot cross the account boundary', async () => {
    let resolveRequest!: (value: ReturnType<typeof response>) => void;
    mockAuthenticatedFetch.mockImplementationOnce((_path: string, init: RequestInit) => new Promise((resolve, reject) => {
      resolveRequest = resolve;
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));

    usePreparedMemoryCoverageStore.getState().markServerCoverageDirty();
    const pending = usePreparedMemoryCoverageStore.getState().loadViewport(viewport);
    const requestSignal = mockAuthenticatedFetch.mock.calls[0][1].signal as AbortSignal;
    usePreparedMemoryCoverageStore.getState().reset();
    resolveRequest(response('late-viewer-a'));
    await pending;

    expect(requestSignal.aborted).toBe(true);
    expect(usePreparedMemoryCoverageStore.getState()).toMatchObject({
      userId: null,
      coverage: null,
      status: 'idle',
      serverCoverageDirty: false,
    });
  });
});
