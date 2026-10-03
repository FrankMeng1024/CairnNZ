const mockPersisted = new Map<string, string>();

jest.mock('../../../store/storage', () => ({
  storage: {
    getItem: jest.fn(async (key: string) => mockPersisted.get(key) ?? null),
    getItemStrict: jest.fn(async (key: string) => mockPersisted.get(key) ?? null),
    getAllKeysStrict: jest.fn(async () => [...mockPersisted.keys()]),
    setItem: jest.fn(async (key: string, value: string) => { mockPersisted.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockPersisted.delete(key); }),
    removeItemsStrict: jest.fn(async (keys: string[]) => keys.forEach(key => mockPersisted.delete(key))),
  },
}));

import type { TrackingSession, TrackPoint } from '../../../store/useSessionStore';
import {
  clearSnapLabRunConfiguration,
  clearSnapLabActivities,
  configureSnapLabRun,
  listSnapLabActivities,
  loadSnapLabActivity,
  runSnapLabFinal,
  saveSnapLabActivity,
  saveSnapLabRouteSnapshot,
  type SnapLabActivityRecord,
} from '../snapLabActivityStore';

function points(): TrackPoint[] {
  return Array.from({ length: 14 }, (_unused, index) => ({
    lat: -41 + (index % 2 ? 1 : -1) * 0.000005,
    lng: 174 + index * 0.00005,
    t: 1_800_000_000_000 + index * 4_000,
    accuracy: 8,
    segmentId: 'qa-segment-a',
    ...(index === 0 ? { segmentStartReason: 'start' as const } : {}),
  }));
}

function record(ownerUserId: string, activityId: string): SnapLabActivityRecord {
  const canonical = points();
  const session = {
    id: activityId,
    clientActivityId: activityId,
    activityMode: 'hiking',
    regionCode: 'NZ',
    startedAt: canonical[0].t,
    endedAt: canonical.at(-1)!.t,
    durationS: 52,
    distanceM: 65,
    elevationGainM: 0,
    trackPoints: canonical,
    markerIds: [],
    name: 'QA straight corridor',
    syncState: 'synced',
    finalGeometryState: 'base_ready',
    finalGeometryRevision: 1,
    finalGeometryFingerprint: 'qa-final-fingerprint',
    qaProvenance: 'snap_lab',
  } as TrackingSession;
  return {
    format: 'cairn-snap-lab-activity',
    version: 1,
    realm: 'snap-lab',
    ownerUserId,
    activityId,
    createdAt: Date.now(),
    context: {
      caseId: 'store-contract',
      profileId: 'primary',
      seed: 17,
      networkCondition: 'offline',
      transportMode: 'offline',
      evidenceLabel: 'LOCAL_ONLY',
    },
    session,
    rawPoints: canonical,
    canonicalPoints: canonical,
    liveBeforeFinish: canonical,
    localFinal: canonical,
    selectedFinal: canonical,
    selectedSource: 'local',
    segmentStats: [],
    requestCount: 0,
    directionsRequestCount: 0,
    acceptedIslandCount: 0,
    transportReceipts: [],
    qaMemoryPointCount: 8,
    stageTimestamps: { finishRequestedAt: Date.now() },
    stageLedger: null,
    routeSnapshots: [],
  };
}

describe('Snap Lab isolated persistent Activity shelf', () => {
  beforeEach(() => {
    mockPersisted.clear();
    clearSnapLabRunConfiguration();
  });

  test('cold loading is owner-scoped and uses only Snap Lab storage keys', async () => {
    const saved = record('owner-a', 'qa-snap-activity-a');
    await saveSnapLabActivity(saved);
    expect(await loadSnapLabActivity('owner-a', saved.activityId)).toEqual(saved);
    expect(await loadSnapLabActivity('owner-b', saved.activityId)).toBeNull();
    expect(await listSnapLabActivities('owner-a')).toEqual([saved]);
    expect([...mockPersisted.keys()].every(key => key.startsWith('@cairn:snap_lab:'))).toBe(true);
  });

  test('enumerates and clears owner records even when the bounded index is corrupt', async () => {
    const ownerA = record('owner-a', 'qa-snap-orphan-a');
    const ownerB = record('owner-b', 'qa-snap-owner-b');
    await saveSnapLabActivity(ownerA);
    await saveSnapLabActivity(ownerB);
    mockPersisted.set('@cairn:snap_lab:activity_index:v1:owner-a', '{corrupt-index');

    expect(await listSnapLabActivities('owner-a')).toEqual([ownerA]);
    await clearSnapLabActivities('owner-a');
    expect(await listSnapLabActivities('owner-a')).toEqual([]);
    expect(await loadSnapLabActivity('owner-b', ownerB.activityId)).toEqual(ownerB);
    expect([...mockPersisted.keys()].some(key => key.includes('owner-a'))).toBe(false);
  });

  test('Save-as-Route creates an immutable QA snapshot without a product Route', async () => {
    const saved = record('owner-a', 'qa-snap-activity-route');
    await saveSnapLabActivity(saved);
    const snapshot = await saveSnapLabRouteSnapshot('owner-a', saved.activityId, 'QA route');
    expect(snapshot).toMatchObject({
      sourceActivityId: saved.activityId,
      name: 'QA route',
      artifactRevision: 1,
    });
    const reloaded = await loadSnapLabActivity('owner-a', saved.activityId);
    expect(reloaded?.routeSnapshots).toHaveLength(1);
    saved.selectedFinal[0].lat = 0;
    expect(reloaded?.routeSnapshots[0].points[0].lat).not.toBe(0);
  });

  test('offline Finish runs the production local Final and dispatches no HTTP request', async () => {
    const fetchImpl = jest.fn();
    configureSnapLabRun({
      caseId: 'offline-local',
      profileId: 'primary',
      seed: 3,
      networkCondition: 'offline',
      transportMode: 'offline',
      evidenceLabel: 'LOCAL_ONLY',
    }, fetchImpl as unknown as typeof fetch);
    const result = await runSnapLabFinal(points());
    expect(result.selectedSource).toBe('local');
    expect(result.localFinal).toEqual(result.selectedFinal);
    expect(result.localFinal.length).toBeGreaterThanOrEqual(2);
    expect(result.refinementAuthority).toMatchObject({
      runResult: 'pending-network',
      jobStatus: 'queued',
      roadEnhancementState: 'pending-network',
      roadRefinementPending: true,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('provider failure consumes the production retryable-pending authority', async () => {
    const fetchImpl = jest.fn(async () => { throw new Error('provider unavailable'); });
    configureSnapLabRun({
      caseId: 'provider-failure',
      profileId: 'primary',
      seed: 4,
      networkCondition: 'online-provider-failure',
      transportMode: 'captured',
      evidenceLabel: 'CAPTURED_REAL_RESPONSE',
    }, fetchImpl as unknown as typeof fetch);
    const result = await runSnapLabFinal(points());
    expect(result.selectedSource).toBe('local');
    expect(result.refinementAuthority).toMatchObject({
      runResult: 'pending-retry',
      jobStatus: 'queued',
      jobOutcome: 'pending',
      roadEnhancementState: 'pending-retry',
      roadRefinementPending: true,
      technicalOutcome: 'network-failure',
      requestHttpCategory: 'network',
    });
    expect(fetchImpl).toHaveBeenCalled();
  });
});
