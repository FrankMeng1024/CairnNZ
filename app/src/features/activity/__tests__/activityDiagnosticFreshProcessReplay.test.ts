import fs from 'fs';
import {
  activityGeometryFingerprint,
  buildLocalFinalTrackPoints,
} from '../activityFinalArtifact';
import { replayObservationsFromDiagnosticExport } from '../activityDiagnosticReplay';
import { probeSnapLabFinalWithCapturedResponses } from '../../activitySimulator/snapLabLogicalRunner';
import type { SnapLabCassetteEntry } from '../../activitySimulator/snapLabTransport';
import type { TrackPoint } from '../../../store/useSessionStore';

const exportPath = process.env.CAIRN_DIAGNOSTIC_EXPORT_PATH;
const freshProcessTest = exportPath ? test : test.skip;

describe('standalone Activity diagnostic replay', () => {
  freshProcessTest('reconstructs local and selected Final fingerprints from the export alone', async () => {
    const source = JSON.parse(fs.readFileSync(exportPath!, 'utf8'));
    const diagnostic = source.diagnosticReplay ?? source;
    expect(diagnostic.declaredMissing).toEqual([]);
    const observations = replayObservationsFromDiagnosticExport(diagnostic);
    const decisions = diagnostic.records.filter((record: any) => (
      record.kind === 'observation-decision'
    ));
    const promotions = diagnostic.records.filter((record: any) => (
      record.kind === 'canonical-promotion'
    ));
    const artifact = diagnostic.finalArtifact as {
      selectedSource: 'local' | 'matched' | 'hybrid';
      artifactFingerprint: string;
      localFingerprint: string;
      canonicalPointCount: number;
      canonicalPoints: TrackPoint[];
    };
    expect(observations).toHaveLength(decisions.length);
    const canonicalDecisionTimes = new Set([
      ...decisions
        .filter((record: any) => record.data.accepted === true)
        .map((record: any) => record.data.observationTimeMs),
      ...promotions.map((record: any) => record.data.observationTimeMs),
    ]);
    expect(canonicalDecisionTimes.size).toBe(artifact.canonicalPointCount);
    expect(artifact.canonicalPoints.every(point => canonicalDecisionTimes.has(point.t))).toBe(true);
    expect(artifact.canonicalPoints).toHaveLength(artifact.canonicalPointCount);

    const local = buildLocalFinalTrackPoints(artifact.canonicalPoints);
    expect(activityGeometryFingerprint(local)).toBe(artifact.localFingerprint);

    const providerResponses = diagnostic.providerResponses as SnapLabCassetteEntry[];
    if (artifact.selectedSource === 'local') {
      expect(activityGeometryFingerprint(local)).toBe(artifact.artifactFingerprint);
      return;
    }
    expect(providerResponses.length).toBeGreaterThan(0);
    const replayed = await probeSnapLabFinalWithCapturedResponses(
      artifact.canonicalPoints,
      providerResponses,
      {
        caseId: 'standalone-diagnostic-replay',
        profileId: 'fresh-process',
        seed: 1,
        requestIdentity: diagnostic.recordsChecksum,
      },
    );
    expect(replayed.selectedSource).toBe(artifact.selectedSource);
    expect(activityGeometryFingerprint(replayed.selectedFinal)).toBe(artifact.artifactFingerprint);
  });
});
