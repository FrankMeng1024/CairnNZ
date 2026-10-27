const mockValues = new Map<string, string>();
const mockAutomaticCapture = jest.fn(async (_input: unknown) => undefined);

jest.mock('../../../store/storage', () => ({
  storage: {
    getItemStrict: jest.fn(async (key: string) => mockValues.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockValues.set(key, value); }),
    getAllKeysStrict: jest.fn(async () => [...mockValues.keys()]),
    removeItemsStrict: jest.fn(async (keys: string[]) => keys.forEach(key => mockValues.delete(key))),
  },
}));

jest.mock('../../../services/automaticDiagnosticOutbox', () => ({
  captureAutomaticDiagnosticEvent: (input: unknown) => mockAutomaticCapture(input),
}));

import {
  activityDiagnosticReplayOwnerPrefix,
  beginActivityDiagnosticReplay,
  exportActivityDiagnosticReplay,
  exportLatestActivityDiagnosticReplay,
  finishActivityDiagnosticReplay,
  purgeActivityDiagnosticReplayForOwner,
  recordActivityDiagnosticCanonicalPromotion,
  recordActivityDiagnosticDecision,
  recordActivityDiagnosticObservation,
  recordActivityDiagnosticProviderExchange,
  replayObservationsFromDiagnosticExport,
} from '../activityDiagnosticReplay';

describe('Activity diagnostic replay', () => {
  beforeEach(() => {
    mockValues.clear();
    mockAutomaticCapture.mockClear();
  });

  test('mirrors OS-visible observation lineage to the opt-in Tier B automatic stream', async () => {
    await recordActivityDiagnosticObservation({
      ownerUserId: 'owner-auto',
      clientActivityId: 'activity-auto',
      observationTimeMs: 1_000,
      coordinate: {
        lat: -41.28664,
        lng: 174.77557,
        accuracy: 6,
        source: 'background',
        nativeBatchSequence: 4,
        nativeBatchIndex: 2,
        receiptWallTimeMs: 1_250,
        receiptMonotonicTimeMs: 800,
        appStateAtReceipt: 'background',
        receiptEvidenceId: 'receipt-auto',
      },
    });
    await recordActivityDiagnosticDecision({
      ownerUserId: 'owner-auto',
      clientActivityId: 'activity-auto',
      observationTimeMs: 1_000,
      accepted: true,
      reason: 'accepted',
      segmentId: 'segment-auto',
      receiptEvidenceId: 'receipt-auto',
    });

    expect(mockAutomaticCapture).toHaveBeenCalledTimes(2);
    expect(mockAutomaticCapture.mock.calls[0][0]).toMatchObject({
      ownerUserId: 'owner-auto',
      stream: {
        streamId: 'activity:activity-auto:precise',
        sourceType: 'activity',
        clientActivityId: 'activity-auto',
      },
      eventCode: 'ACTIVITY_REPLAY_RAW_OBSERVATION',
      requiredPolicyTier: 'tier_b',
      details: {
        replayKind: 'raw-observation',
        lat: -41.28664,
        lng: 174.77557,
        source: 'background',
        nativeBatchSequence: 4,
        nativeBatchIndex: 2,
        receiptEvidenceId: 'receipt-auto',
      },
    });
    expect(mockAutomaticCapture.mock.calls[1][0]).toMatchObject({
      eventCode: 'ACTIVITY_REPLAY_OBSERVATION_DECISION',
      requiredPolicyTier: 'tier_b',
      details: {
        replayKind: 'observation-decision',
        accepted: true,
        reason: 'accepted',
        receiptEvidenceId: 'receipt-auto',
      },
    });
  });

  test('persists a long exact stream beyond the stage-ledger ring and replays it standalone', async () => {
    await beginActivityDiagnosticReplay({
      ownerUserId: 'owner-a',
      clientActivityId: 'activity-a',
      mode: 'hiking',
      source: 'real',
      wallTimeMs: 10,
    });
    for (let ordinal = 0; ordinal < 1_305; ordinal += 1) {
      const observationTimeMs = 1_000 + ordinal * 3_000;
      await recordActivityDiagnosticObservation({
        ownerUserId: 'owner-a',
        clientActivityId: 'activity-a',
        observationTimeMs,
        coordinate: {
          lat: -41.2 + ordinal / 1_000_000,
          lng: 174.7 + ordinal / 1_000_000,
          accuracy: 5 + ordinal % 4,
          speed: 1.2,
          source: ordinal % 2 ? 'background' : 'foreground',
          nativeBatchSequence: Math.floor(ordinal / 4),
          nativeBatchIndex: ordinal % 4,
          receiptWallTimeMs: observationTimeMs + 250,
          receiptMonotonicTimeMs: ordinal * 2.5,
          appStateAtReceipt: ordinal % 2 ? 'background' : 'active',
        },
      });
      await recordActivityDiagnosticDecision({
        ownerUserId: 'owner-a',
        clientActivityId: 'activity-a',
        observationTimeMs,
        accepted: ordinal % 19 !== 0,
        reason: ordinal % 19 === 0 ? 'quality-rejected' : 'accepted',
        segmentId: 'segment-a',
      });
    }
    await finishActivityDiagnosticReplay('owner-a', 'activity-a', { finalFingerprint: 'abc123' });
    const exported = await exportActivityDiagnosticReplay({
      ownerUserId: 'owner-a',
      clientActivityId: 'activity-a',
      stageLedger: null,
      finalArtifact: { finalFingerprint: 'abc123' },
      providerReceipts: [],
    });

    expect(exported.completeness).toMatchObject({
      complete: true,
      contiguousRecordOrdinals: true,
      everyChunkChecksumValid: true,
      pendingWriteCount: 0,
    });
    expect(exported.records.length).toBe(2_612);
    expect(exported.completeness.chunkCount).toBeGreaterThan(50);
    const replay = replayObservationsFromDiagnosticExport(JSON.parse(JSON.stringify(exported)));
    expect(replay).toHaveLength(1_305);
    expect(replay[0]).toMatchObject({
      timestampMs: 1_000,
      coordinate: { lat: -41.2, lng: 174.7, accuracy: 5, source: 'foreground' },
    });
    expect(replay.at(-1)?.timestampMs).toBe(1_000 + 1_304 * 3_000);
  });

  test('fails visibly after durable chunk corruption', async () => {
    await beginActivityDiagnosticReplay({
      ownerUserId: 'owner-b', clientActivityId: 'activity-b', mode: 'running', source: 'real',
    });
    await recordActivityDiagnosticObservation({
      ownerUserId: 'owner-b', clientActivityId: 'activity-b', observationTimeMs: 100,
      coordinate: { lat: 1, lng: 2, receiptWallTimeMs: 120 },
    });
    await finishActivityDiagnosticReplay('owner-b', 'activity-b');
    const chunkKey = [...mockValues.keys()].find(key => key.includes(':chunk:'))!;
    const chunk = JSON.parse(mockValues.get(chunkKey)!);
    chunk.records[0].data.mode = 'tampered';
    mockValues.set(chunkKey, JSON.stringify(chunk));

    const exported = await exportActivityDiagnosticReplay({
      ownerUserId: 'owner-b', clientActivityId: 'activity-b',
    });
    expect(exported.completeness.complete).toBe(false);
    expect(exported.completeness.everyChunkChecksumValid).toBe(false);
    expect(() => replayObservationsFromDiagnosticExport(exported)).toThrow('diagnostic_replay_incomplete');
  });

  test('retains a later canonical promotion without rewriting the receipt decision', async () => {
    await beginActivityDiagnosticReplay({
      ownerUserId: 'owner-promote', clientActivityId: 'activity-promote', mode: 'hiking', source: 'real',
    });
    await recordActivityDiagnosticObservation({
      ownerUserId: 'owner-promote', clientActivityId: 'activity-promote', observationTimeMs: 100,
      coordinate: { lat: 1, lng: 2, receiptWallTimeMs: 120 },
    });
    await recordActivityDiagnosticDecision({
      ownerUserId: 'owner-promote', clientActivityId: 'activity-promote', observationTimeMs: 100,
      accepted: false, reason: 'candidate-awaiting-second-fix', segmentId: 'segment-a',
    });
    await recordActivityDiagnosticCanonicalPromotion({
      ownerUserId: 'owner-promote', clientActivityId: 'activity-promote', observationTimeMs: 100,
      promotedByObservationTimeMs: 103, reason: 'candidate-confirmed', segmentId: 'segment-a',
    });
    await finishActivityDiagnosticReplay('owner-promote', 'activity-promote');
    const exported = await exportActivityDiagnosticReplay({
      ownerUserId: 'owner-promote', clientActivityId: 'activity-promote',
    });
    expect(exported.records.filter(record => record.kind === 'observation-decision')).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ accepted: false, observationTimeMs: 100 }) }),
    ]);
    expect(exported.records.filter(record => record.kind === 'canonical-promotion')).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ observationTimeMs: 100, promotedByObservationTimeMs: 103 }),
      }),
    ]);
  });

  test('cold export reconstructs the opted-in final artifact and redacted provider exchange', async () => {
    await beginActivityDiagnosticReplay({
      ownerUserId: 'owner-latest', clientActivityId: 'activity-latest', mode: 'hiking', source: 'real',
      wallTimeMs: 1_000,
    });
    await recordActivityDiagnosticProviderExchange({
      ownerUserId: 'owner-latest', clientActivityId: 'activity-latest',
      exchange: {
        phase: 'request', requestId: 'matching:0-1', requestKind: 'map-matching',
        requestFingerprint: 'safe-fingerprint',
        sanitizedUrl: 'https://api.mapbox.com/matching/v5/mapbox/walking/x?access_token=<redacted>',
        status: null, headers: {}, body: null, capturedAt: '2026-10-20T00:00:00.000Z',
      },
    });
    await recordActivityDiagnosticProviderExchange({
      ownerUserId: 'owner-latest', clientActivityId: 'activity-latest',
      exchange: {
        phase: 'response', requestId: 'matching:0-1', requestKind: 'map-matching',
        requestFingerprint: 'safe-fingerprint',
        sanitizedUrl: 'https://api.mapbox.com/matching/v5/mapbox/walking/x?access_token=<redacted>',
        status: 200, headers: { 'content-type': 'application/json' },
        body: { code: 'Ok' }, capturedAt: '2026-10-20T00:00:01.000Z',
      },
    });
    await finishActivityDiagnosticReplay('owner-latest', 'activity-latest', {
      finalArtifact: { artifactFingerprint: 'final-123', selectedFinalPoints: [{ lat: 1, lng: 2 }] },
    });

    const exported = await exportLatestActivityDiagnosticReplay('owner-latest', {
      clientActivityId: 'activity-latest',
    } as any);
    expect(exported).toMatchObject({
      clientActivityId: 'activity-latest',
      finalArtifact: { artifactFingerprint: 'final-123' },
      providerReceipts: [expect.objectContaining({ requestFingerprint: 'safe-fingerprint' })],
      providerResponses: [expect.objectContaining({ status: 200, body: { code: 'Ok' } })],
      declaredMissing: [],
    });
    expect(JSON.stringify(exported)).not.toContain('pk.');
  });

  test('owner cleanup removes every coordinate-bearing chunk', async () => {
    await beginActivityDiagnosticReplay({
      ownerUserId: 'owner-c', clientActivityId: 'activity-c', mode: 'hiking', source: 'simulator',
    });
    await finishActivityDiagnosticReplay('owner-c', 'activity-c');
    await purgeActivityDiagnosticReplayForOwner('owner-c');
    expect([...mockValues.keys()].some(key => key.startsWith(activityDiagnosticReplayOwnerPrefix('owner-c'))))
      .toBe(false);
  });
});
