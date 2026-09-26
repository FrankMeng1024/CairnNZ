const mockStorage = new Map<string, string>();
jest.mock('../../../store/storage', () => ({
  storage: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockStorage.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockStorage.delete(key); }),
  },
}));

import {
  activityGeometryFingerprint,
  buildBaseFinalTrackPoints,
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
  });
});
