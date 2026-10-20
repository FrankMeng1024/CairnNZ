const mockValues = new Map<string, string>();

jest.mock('../../../store/storage', () => ({
  storage: {
    getItemStrict: jest.fn(async (key: string) => mockValues.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockValues.set(key, value); }),
    getAllKeysStrict: jest.fn(async () => [...mockValues.keys()]),
    removeItemsStrict: jest.fn(async (keys: string[]) => keys.forEach(key => mockValues.delete(key))),
  },
}));

type DiagnosticModule = typeof import('../activityDiagnosticReplay');

function freshDiagnosticModule(): DiagnosticModule {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../activityDiagnosticReplay') as DiagnosticModule;
}

describe('Activity diagnostic durable lifecycle', () => {
  beforeEach(() => {
    mockValues.clear();
    jest.resetModules();
  });

  test('resumes the same Activity after module reload without erasing its durable prefix', async () => {
    const first = freshDiagnosticModule();
    await first.beginActivityDiagnosticReplay({
      ownerUserId: 'owner-reload', clientActivityId: 'activity-reload', mode: 'hiking', source: 'real',
    });
    await first.recordActivityDiagnosticObservation({
      ownerUserId: 'owner-reload', clientActivityId: 'activity-reload', observationTimeMs: 100,
      coordinate: { lat: -41.2, lng: 174.7, receiptWallTimeMs: 110 },
    });
    await first.recordActivityDiagnosticReplayEvent({
      ownerUserId: 'owner-reload', clientActivityId: 'activity-reload', kind: 'application-event',
      data: { stage: 'lifecycle', state: 'background' },
    });
    await first.flushActivityDiagnosticReplay('owner-reload', 'activity-reload');

    const recovered = freshDiagnosticModule();
    await recovered.beginActivityDiagnosticReplay({
      ownerUserId: 'owner-reload', clientActivityId: 'activity-reload', mode: 'hiking', source: 'real',
    });
    await recovered.recordActivityDiagnosticObservation({
      ownerUserId: 'owner-reload', clientActivityId: 'activity-reload', observationTimeMs: 200,
      coordinate: { lat: -41.201, lng: 174.701, receiptWallTimeMs: 210 },
    });
    await recovered.finishActivityDiagnosticReplay('owner-reload', 'activity-reload', {
      finalArtifact: { artifactFingerprint: 'reload-final' },
    });
    const exported = await recovered.exportActivityDiagnosticReplay({
      ownerUserId: 'owner-reload', clientActivityId: 'activity-reload',
    });

    expect(exported.records.filter(record => record.kind === 'raw-observation').map(record => (
      record.data.observationTimeMs
    ))).toEqual([100, 200]);
    expect(exported.records.filter(record => record.kind === 'diagnostic-start')).toHaveLength(1);
    expect(exported.completeness).toMatchObject({
      durableRecordsComplete: true,
      recordingFinished: true,
      complete: false,
      recoveryCount: 1,
      volatileTailMayBeMissing: true,
      reason: 'volatile-tail-may-be-missing-after-process-recovery',
    });
    expect(exported.declaredMissing).toContain('volatile-tail-after-process-recovery');
  });

  test('does not misreport an unflushed pre-crash tail as complete', async () => {
    const first = freshDiagnosticModule();
    await first.beginActivityDiagnosticReplay({
      ownerUserId: 'owner-tail', clientActivityId: 'activity-tail', mode: 'running', source: 'real',
    });
    await first.recordActivityDiagnosticObservation({
      ownerUserId: 'owner-tail', clientActivityId: 'activity-tail', observationTimeMs: 100,
      coordinate: { lat: -36.8, lng: 174.8, receiptWallTimeMs: 110 },
    });

    const recovered = freshDiagnosticModule();
    await recovered.finishActivityDiagnosticReplay('owner-tail', 'activity-tail', {
      finalArtifact: { artifactFingerprint: 'tail-final' },
    });
    const exported = await recovered.exportActivityDiagnosticReplay({
      ownerUserId: 'owner-tail', clientActivityId: 'activity-tail',
    });

    expect(exported.records.filter(record => record.kind === 'raw-observation')).toHaveLength(0);
    expect(exported.completeness).toMatchObject({
      durableRecordsComplete: true,
      recordingFinished: true,
      complete: false,
      volatileTailMayBeMissing: true,
    });
  });

  test('keeps provider and sync evidence appended after Finish', async () => {
    const first = freshDiagnosticModule();
    await first.beginActivityDiagnosticReplay({
      ownerUserId: 'owner-after', clientActivityId: 'activity-after', mode: 'hiking', source: 'real',
    });
    await first.finishActivityDiagnosticReplay('owner-after', 'activity-after', {
      finalArtifact: { artifactFingerprint: 'after-final' },
    });

    const recovered = freshDiagnosticModule();
    await recovered.recordActivityDiagnosticProviderExchange({
      ownerUserId: 'owner-after', clientActivityId: 'activity-after',
      exchange: {
        phase: 'response', requestId: 'matching:after', requestKind: 'map-matching',
        requestFingerprint: 'fingerprint-after',
        sanitizedUrl: 'https://api.mapbox.com/matching/v5/mapbox/walking/x?access_token=<redacted>',
        status: 200, headers: {}, body: { code: 'Ok' }, capturedAt: '2026-10-21T00:00:00.000Z',
      },
    });
    await recovered.recordActivityDiagnosticReplayEvent({
      ownerUserId: 'owner-after', clientActivityId: 'activity-after', kind: 'application-event',
      data: { stage: 'sync-state', details: { phase: 'ack', acknowledged: true } },
    });
    const exported = await recovered.exportActivityDiagnosticReplay({
      ownerUserId: 'owner-after', clientActivityId: 'activity-after',
    });

    expect(exported.completeness).toMatchObject({
      complete: true,
      recordingFinished: true,
      postFinishRecordCount: 2,
      recoveryCount: 1,
    });
    expect(exported.providerResponses).toEqual([
      expect.objectContaining({ requestId: 'matching:after', status: 200 }),
    ]);
    expect(exported.records.at(-1)).toMatchObject({
      kind: 'application-event', data: { stage: 'sync-state' },
    });
  });
});
