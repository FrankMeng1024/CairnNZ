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
import {
  reconstructPedestrianFinalRoute,
} from '../../../services/routing/pedestrianFinalRoute';
import {
  analyzeTrustedEndpointCoverage,
  evaluateMatchedGeometryQuality,
  preserveTrustedRouteEndpoints,
} from '../../../services/routing/snapTrack';
import {
  decideActivityFinalCandidatePromotion,
  selectRoundedActivityFinalCandidate,
} from '../activityFinalRefinementDecision';
import { confidentRoadCornerMask } from '../activityFinalRefinementQueue';

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
    // Model real pre-v4 cold storage where displayMode did not exist. Loader
    // must accept these records without silently rewriting them.
    const legacyBaseRecord = { ...legacyBase.artifact };
    const legacyTrendRecord = { ...legacyTrend.artifact };
    delete legacyBaseRecord.displayMode;
    delete legacyTrendRecord.displayMode;
    const legacyBaseRaw = JSON.stringify(legacyBaseRecord);
    const legacyTrendRaw = JSON.stringify(legacyTrendRecord);
    mockStorage.set('@cairn:activity_final:v1:owner-a:activity-base', legacyBaseRaw);
    mockStorage.set('@cairn:activity_final:v1:owner-a:activity-trend', legacyTrendRaw);
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
    await expect(loadActivityFinalArtifact('owner-a', 'activity-base')).resolves.toEqual(legacyBaseRecord);
    await expect(loadActivityFinalArtifact('owner-a', 'activity-trend')).resolves.toEqual(legacyTrendRecord);
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

  test('cold-reads an actual reconstruction → assembly → provenance → rounding v4 revision without mutating evidence', async () => {
    const metres = (eastM: number, northM: number, index: number) => ({
      lat: -43 + northM / 111_320,
      lng: 170 + eastM / (111_320 * Math.cos(-43 * Math.PI / 180)),
      t: 1_700_000_000_000 + index * 4_000,
      accuracy: 5,
      segmentId: 'synthetic-road-chain',
    });
    const canonicalRoad = [
      metres(0, 0, 0), metres(10, 0, 1), metres(20, 0, 2), metres(30, 0, 3),
      metres(40, 0, 4), metres(40, 10, 5), metres(40, 20, 6),
      metres(40, 30, 7), metres(40, 40, 8),
    ];
    const immutableEvidence = {
      distanceM: 80,
      memory: [{ cell: 'synthetic-private-safe-cell', firstSeenAt: 123 }],
      idempotencyKey: 'synthetic-fixed-upload-identity',
      canonical: canonicalRoad.map(point => ({ ...point })),
    };
    const evidenceSnapshot = JSON.parse(JSON.stringify(immutableEvidence));
    const fetchImpl = jest.fn(async (url: string | URL | Request) => {
      const encoded = String(url).match(/\/walking\/([^?]+)/)?.[1];
      if (!encoded) throw new Error('unexpected Mapbox test URL');
      const coordinates = decodeURIComponent(encoded).split(';').map(pair => (
        pair.split(',').map(Number) as [number, number]
      ));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 'Ok',
          matchings: [{ confidence: 0.99, geometry: { coordinates } }],
          tracepoints: coordinates.map((location, index) => ({
            matchings_index: 0,
            waypoint_index: index,
            alternatives_count: 0,
            name: 'Synthetic mapped pedestrian path',
            location,
          })),
        }),
      } as Response;
    }) as unknown as typeof fetch;

    const reconstructed = await reconstructPedestrianFinalRoute(canonicalRoad, {
      mapboxToken: 'pk.synthetic-test-boundary',
      directionsFallback: false,
      fetchImpl,
    });
    expect(reconstructed.ok).toBe(true);
    if (!reconstructed.ok) return;
    expect(fetchImpl).toHaveBeenCalled();
    const refinedSections = reconstructed.stats.sections.filter(section => section.decision === 'refined');
    expect(refinedSections.length).toBeGreaterThan(0);
    expect(refinedSections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        networkSource: 'map-matching',
        corridorEvidence: expect.objectContaining({ accepted: true }),
        seam: expect.objectContaining({ accepted: true }),
        promotionUtility: expect.objectContaining({ accepted: true, networkAuthority: 'strong' }),
      }),
    ]));
    const coverage = analyzeTrustedEndpointCoverage(canonicalRoad, reconstructed.points);
    expect(coverage.eligibleForAnchoring).toBe(true);
    const anchored = preserveTrustedRouteEndpoints(canonicalRoad, reconstructed.points);
    expect(evaluateMatchedGeometryQuality(canonicalRoad, anchored).accepted).toBe(true);
    const candidate = anchored.map((point, index) => ({
      ...point,
      t: point.t ?? canonicalRoad[0].t + Math.round(
        (canonicalRoad.at(-1)!.t - canonicalRoad[0].t) * index / Math.max(1, anchored.length - 1),
      ),
      segmentId: 'synthetic-road-chain',
    }));
    expect(decideActivityFinalCandidatePromotion({
      canonical: canonicalRoad,
      current: canonicalRoad,
      candidate,
      networkMatched: true,
    }).accepted).toBe(true);
    const display = selectRoundedActivityFinalCandidate({
      canonical: canonicalRoad,
      current: canonicalRoad,
      approvedUnrounded: candidate,
      eligibleCorners: confidentRoadCornerMask(candidate.length, reconstructed.stats),
    });
    expect(display.usedRoundedCandidate).toBe(true);
    expect(display.roundingDiagnostics.roundedCorners).toBeGreaterThan(0);

    const base = await commitActivityFinalArtifact({
      ownerUserId: 'owner-chain',
      clientActivityId: 'activity-chain',
      canonicalPoints: canonicalRoad,
      displayPoints: canonicalRoad,
      source: 'base',
      displayMode: 'base',
      expectedRevision: null,
    });
    const enhanced = await commitActivityFinalArtifact({
      ownerUserId: 'owner-chain',
      clientActivityId: 'activity-chain',
      canonicalPoints: canonicalRoad,
      displayPoints: display.points,
      source: 'matched',
      displayMode: 'road',
      expectedRevision: base.artifact.revision,
    });
    const cold = await loadActivityFinalArtifact('owner-chain', 'activity-chain');
    expect(cold).toEqual(enhanced.artifact);
    expect(cold).toMatchObject({
      revision: 2,
      parentRevision: 1,
      algorithmVersion: 'pedestrian-final-v4-road-fillet',
      source: 'matched',
      displayMode: 'road',
      canonicalFingerprint: base.artifact.canonicalFingerprint,
    });
    expect(new Set(cold!.points.map(point => point.segmentId))).toEqual(new Set(['synthetic-road-chain']));
    expect(immutableEvidence).toEqual(evidenceSnapshot);
    expect(activityGeometryFingerprint(immutableEvidence.canonical))
      .toBe(base.artifact.canonicalFingerprint);
  });
});
