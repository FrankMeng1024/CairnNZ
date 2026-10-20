import fs from 'fs';
import { replayObservationsFromDiagnosticExport } from '../activityDiagnosticReplay';
import { diagnosticReplayFixture } from '../../activitySimulator/diagnosticReplayFixture';

const exportPath = process.env.CAIRN_DIAGNOSTIC_EXPORT_PATH;
const freshProcessTest = exportPath ? test : test.skip;

describe('standalone Activity diagnostic replay', () => {
  freshProcessTest('builds a raw-only replay fixture without importing output geometry', async () => {
    const source = JSON.parse(fs.readFileSync(exportPath!, 'utf8'));
    const diagnostic = source.diagnosticReplay ?? source;
    expect(diagnostic.declaredMissing).toEqual([]);
    const observations = replayObservationsFromDiagnosticExport(diagnostic);
    const decisions = diagnostic.records.filter((record: any) => (
      record.kind === 'observation-decision'
    ));
    expect(observations).toHaveLength(decisions.length);
    const fixture = diagnosticReplayFixture(diagnostic);
    expect(fixture.rawEvents).toHaveLength(observations.length);
    expect(fixture.rawEvents[0]).toMatchObject({
      observationTimeMs: observations[0].timestampMs,
      coordinate: {
        lat: observations[0].coordinate.lat,
        lng: observations[0].coordinate.lng,
      },
      callbackIdentity: observations[0].coordinate.callbackIdentity ?? null,
      nativeBatchSequence: observations[0].coordinate.nativeBatchSequence ?? null,
      nativeBatchIndex: observations[0].coordinate.nativeBatchIndex ?? null,
    });
    expect(fixture.transportConfig?.mode).toBe('captured-real');
    expect(fixture.transportConfig?.cassetteEntries).toEqual(diagnostic.providerResponses);
    const encodedFixture = JSON.stringify(fixture);
    expect(encodedFixture).not.toContain('canonicalPoints');
    expect(encodedFixture).not.toContain('localFinalPoints');
    expect(encodedFixture).not.toContain('selectedFinalPoints');
  });
});
