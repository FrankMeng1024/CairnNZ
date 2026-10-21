import type {
  ActivityDiagnosticReplayExport,
  ActivityDiagnosticReplayRecord,
} from '../activityDiagnosticReplay';
import {
  diagnosticReplayFixture,
  replayDiagnosticEventTimeline,
} from '../../activitySimulator/diagnosticReplayFixture';

const record = (
  ordinal: number,
  kind: ActivityDiagnosticReplayRecord['kind'],
  data: Record<string, unknown>,
): ActivityDiagnosticReplayRecord => ({
  ordinal, kind, data, wallTimeMs: 1_000 + ordinal * 10, monotonicTimeMs: ordinal,
});

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function diagnostic(records: ActivityDiagnosticReplayRecord[]): ActivityDiagnosticReplayExport {
  return {
    schema: 'cairn-activity-diagnostic-replay-export',
    version: 2,
    exportedAt: '2026-10-21T00:00:00.000Z',
    ownerUserId: 'current-owner',
    clientActivityId: 'timeline-sentinel',
    privacy: { localOnly: true, explicitOptIn: true, coordinatesIncluded: true, automaticUpload: false },
    completeness: {
      complete: true, reason: null, chunkCount: 1, recordCount: records.length,
      contiguousRecordOrdinals: true, everyChunkChecksumValid: true, pendingWriteCount: 0,
      durableRecordsComplete: true, recordingFinished: true, selfContainedReplayComplete: true,
      replayScope: 'tracking-replay-inputs-only', syncTerminalState: 'not-recorded',
      fullLifecycleComplete: false, fullLifecycleReason: 'completed-activity-sync:not-recorded',
      recoveryCount: 0, volatileTailMayBeMissing: false, postFinishRecordCount: 0,
    },
    checksumAlgorithm: 'fnv1a32', recordsChecksum: fnv1a32(JSON.stringify(records)), records,
    stageLedger: { schema: 'test-stage-ledger' } as never,
    finalArtifact: { artifactFingerprint: 'timeline-final' },
    providerReceipts: [], providerResponses: [], declaredMissing: [],
  };
}

describe('diagnostic logs-only event timeline replay', () => {
  test('pause → movement receipt → resume preserves the user-event boundary', () => {
    const result = replayDiagnosticEventTimeline(diagnostic([
      record(0, 'application-event', { stage: 'lifecycle', details: { event: 'recording-paused' } }),
      record(1, 'raw-observation', { observationTimeMs: 2, lat: 1, lng: 2, source: 'foreground' }),
      record(2, 'application-event', { stage: 'lifecycle', details: { event: 'recording-resumed' } }),
    ]));
    expect(result.observations).toMatchObject({ total: 1, whilePaused: 1 });
    expect(result.finalState.paused).toBe(false);
  });

  test('foreground → background TaskManager receipt → foreground keeps append order', () => {
    const result = replayDiagnosticEventTimeline(diagnostic([
      record(0, 'application-event', { stage: 'lifecycle', details: { state: 'active' } }),
      record(1, 'raw-observation', {
        observationTimeMs: 2, lat: 1, lng: 2, source: 'background', appStateAtReceipt: 'background',
      }),
      record(2, 'application-event', { stage: 'lifecycle', details: { state: 'active' } }),
    ]));
    expect(result.events.map(event => event.ordinal)).toEqual([0, 1, 2]);
    expect(result.observations.background).toBe(1);
    expect(result.finalState.appState).toBe('active');
  });

  test('Plant can be open while receipts continue and stale decisions stay comparison-only', () => {
    const result = replayDiagnosticEventTimeline(diagnostic([
      record(0, 'application-event', { stage: 'lifecycle', details: { event: 'plant-opened' } }),
      record(1, 'raw-observation', { observationTimeMs: 2, lat: 1, lng: 2, source: 'foreground' }),
      record(2, 'observation-decision', { accepted: false, reason: 'stale-or-equal-observation' }),
      record(3, 'application-event', { stage: 'lifecycle', details: { event: 'plant-returned' } }),
    ]));
    expect(result.observations).toMatchObject({ total: 1, staleDecisionComparisons: 1 });
    expect(result.events[2].inputAuthority).toBe(false);
    expect(result.finalState.plantOpen).toBe(false);
  });

  test('offline Finish → cold-open online ACK → cleanup derives fixture lifecycle flags', () => {
    const source = diagnostic([
      record(0, 'diagnostic-start', { mode: 'hiking', source: 'real' }),
      record(1, 'raw-observation', {
        observationTimeMs: 2_000, receiptWallTimeMs: 2_100, lat: -41, lng: 174,
        source: 'foreground', appStateAtReceipt: 'active',
      }),
      record(2, 'application-event', { stage: 'lifecycle', details: { event: 'network-offline' } }),
      record(3, 'diagnostic-finish', { finalArtifact: { artifactFingerprint: 'timeline-final' } }),
      record(4, 'application-event', { stage: 'lifecycle', details: { event: 'network-online' } }),
      record(5, 'application-event', { event: 'completed-activity-sync', phase: 'attempt' }),
      record(6, 'application-event', { event: 'completed-activity-sync', phase: 'ack' }),
      record(7, 'application-event', { event: 'completed-activity-sync', phase: 'phone-cleanup-complete' }),
    ]);
    const result = replayDiagnosticEventTimeline(source);
    expect(result).toMatchObject({
      offlineAtFinish: true,
      syncAckAfterFinish: true,
      finalState: { online: true, phoneCleanupComplete: true, syncPhase: 'phone-cleanup-complete' },
    });
    expect(diagnosticReplayFixture(source).lifecycle).toMatchObject({
      offlineAtFinish: true,
      restoreOnlineAfterColdOpen: true,
    });
  });

  test('late provider response is retained after Finish and deleted Activity output cannot become input', () => {
    const result = replayDiagnosticEventTimeline(diagnostic([
      record(0, 'diagnostic-finish', {}),
      record(1, 'provider-exchange', { phase: 'response', requestId: 'late', status: 200 }),
      record(2, 'application-event', { stage: 'lifecycle', details: { event: 'activity-deleted' } }),
      record(3, 'observation-decision', { accepted: true, reason: 'accepted' }),
    ]));
    expect(result.provider.completionsAfterFinish).toBe(1);
    expect(result.finalState.deletedOrCancelled).toBe(true);
    expect(result.observations.decisionsAfterDeletedOrCancelled).toBe(1);
    expect(result.events[3].inputAuthority).toBe(false);
  });
});
