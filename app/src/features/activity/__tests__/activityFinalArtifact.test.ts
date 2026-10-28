const mockStorage = new Map<string, string>();
jest.mock('../../../store/storage', () => ({
  storage: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockStorage.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockStorage.delete(key); }),
  },
}));

import {
  activityFinalArtifactMatchesExpected,
  activityFinalPointsMatchExpected,
  activityGeometryFingerprint,
  buildBaseFinalTrackPoints,
  buildLocalFinalTrackPointsWithDecision,
  commitActivityFinalArtifact,
  loadActivityFinalArtifact,
} from '../activityFinalArtifact';

const canonical = [
  { lat: -41, lng: 174, t: 1_000, segmentId: 'a', segmentStartReason: 'start' as const },
  { lat: -41.001, lng: 174.001, t: 2_000, segmentId: 'a' },
  { lat: -41.01, lng: 174.01, t: 3_000, segmentId: 'b', segmentStartReason: 'gps-reacquired' as const },
  { lat: -41.011, lng: 174.011, t: 4_000, segmentId: 'b' },
];

describe('versioned Activity Final artifact', () => {
  beforeEach(() => mockStorage.clear());

  test('base preserves real segment gaps and verifies its fingerprint', async () => {
    const base = buildBaseFinalTrackPoints(canonical);
    expect(new Set(base.map(point => point.segmentId))).toEqual(new Set(['a', 'b']));
    const committed = await commitActivityFinalArtifact({
      ownerUserId: 'owner-a',
      clientActivityId: 'activity-a',
      canonicalPoints: canonical,
      displayPoints: base,
      source: 'base',
      expectedRevision: null,
    });
    expect(committed.artifact).toMatchObject({ revision: 1, parentRevision: null, source: 'base' });
    expect(committed.artifact.displayFingerprint).toBe(activityGeometryFingerprint(base));
    await expect(loadActivityFinalArtifact('owner-a', 'activity-a')).resolves.toEqual(committed.artifact);
  });

  test('newer refinement wins and a delayed base or stale match cannot downgrade it', async () => {
    const base = buildBaseFinalTrackPoints(canonical);
    const first = await commitActivityFinalArtifact({
      ownerUserId: 'owner-a', clientActivityId: 'activity-a', canonicalPoints: canonical,
      displayPoints: base, source: 'base', expectedRevision: null,
    });
    const enhanced = base.map((point, index) => ({ ...point, lat: point.lat + index * 0.000001 }));
    const second = await commitActivityFinalArtifact({
      ownerUserId: 'owner-a', clientActivityId: 'activity-a', canonicalPoints: canonical,
      displayPoints: enhanced, source: 'matched', expectedRevision: first.artifact.revision,
    });
    expect(second.artifact.revision).toBe(2);
    const delayedBase = await commitActivityFinalArtifact({
      ownerUserId: 'owner-a', clientActivityId: 'activity-a', canonicalPoints: canonical,
      displayPoints: base, source: 'base', expectedRevision: first.artifact.revision,
    });
    expect(delayedBase.artifact).toEqual(second.artifact);
    expect(activityFinalArtifactMatchesExpected(
      second.artifact,
      second.artifact.revision,
      second.artifact.displayFingerprint,
    )).toBe(true);
    expect(activityFinalArtifactMatchesExpected(
      first.artifact,
      second.artifact.revision,
      second.artifact.displayFingerprint,
    )).toBe(false);
    expect(activityFinalPointsMatchExpected(base, second.artifact.displayFingerprint)).toBe(false);
  });

  test('records the selected chronological trend algorithm without changing artifact schema version', async () => {
    const display = buildBaseFinalTrackPoints(canonical);
    const committed = await commitActivityFinalArtifact({
      ownerUserId: 'owner-a', clientActivityId: 'activity-trend', canonicalPoints: canonical,
      displayPoints: display, source: 'base', displayMode: 'trend', expectedRevision: null,
    });
    expect(committed.artifact).toMatchObject({
      version: 1,
      displayMode: 'trend',
      algorithmVersion: 'pedestrian-final-v3-trend',
    });
    const reopened = await loadActivityFinalArtifact('owner-a', 'activity-trend');
    expect(reopened).toEqual(committed.artifact);
    expect(reopened?.points).toEqual(display);
    expect(reopened?.displayFingerprint).toBe(activityGeometryFingerprint(display));
  });

  test('versions accepted road display geometry independently from old Final artifacts', async () => {
    const display = buildBaseFinalTrackPoints(canonical);
    const legacyBase = await commitActivityFinalArtifact({
      ownerUserId: 'owner-a', clientActivityId: 'activity-base', canonicalPoints: canonical,
      displayPoints: display, source: 'base', displayMode: 'base', expectedRevision: null,
    });
    const legacyTrend = await commitActivityFinalArtifact({
      ownerUserId: 'owner-a', clientActivityId: 'activity-trend', canonicalPoints: canonical,
      displayPoints: display, source: 'base', displayMode: 'trend', expectedRevision: null,
    });
    const legacyBaseRaw = mockStorage.get('@cairn:activity_final:v1:owner-a:activity-base');
    const legacyTrendRaw = mockStorage.get('@cairn:activity_final:v1:owner-a:activity-trend');
    const committed = await commitActivityFinalArtifact({
      ownerUserId: 'owner-a', clientActivityId: 'activity-road', canonicalPoints: canonical,
      displayPoints: display, source: 'matched', displayMode: 'road', expectedRevision: null,
    });
    expect(committed.artifact).toMatchObject({
      version: 1,
      displayMode: 'road',
      algorithmVersion: 'pedestrian-final-v4-road-fillet',
    });
    // Existing v2/v3 records remain schema-v1 compatible and are not migrated
    // or rewritten merely because this display-only algorithm exists.
    await expect(loadActivityFinalArtifact('owner-a', 'activity-base')).resolves.toEqual(legacyBase.artifact);
    await expect(loadActivityFinalArtifact('owner-a', 'activity-trend')).resolves.toEqual(legacyTrend.artifact);
    expect(mockStorage.get('@cairn:activity_final:v1:owner-a:activity-base')).toBe(legacyBaseRaw);
    expect(mockStorage.get('@cairn:activity_final:v1:owner-a:activity-trend')).toBe(legacyTrendRaw);
  });

  test('selects each true GPS segment independently and never invents a bridge across the gap', () => {
    const selected = buildLocalFinalTrackPointsWithDecision(canonical);
    expect(new Set(selected.points.map(point => point.segmentId))).toEqual(new Set(['a', 'b']));
    expect(selected.points.findIndex(point => point.segmentId === 'b')).toBeGreaterThan(0);
    const firstB = selected.points.find(point => point.segmentId === 'b');
    expect(firstB).toMatchObject({
      lat: canonical[2].lat,
      lng: canonical[2].lng,
      segmentStartReason: 'gps-reacquired',
    });
  });
});
