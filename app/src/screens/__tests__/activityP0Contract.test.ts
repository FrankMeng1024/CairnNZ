import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Activity P0 source contract', () => {
  const hiking = read('screens/HikingScreen.tsx');
  const running = read('screens/RunningScreen.tsx');
  const store = read('store/useTrackingStore.ts');

  it('uses the shared derived operational-state adapter in both modes', () => {
    expect(hiking).toContain('deriveActivityOperationalState');
    expect(running).toContain('deriveActivityOperationalState');
    expect(hiking).not.toContain("useState<'select' | 'tracking'>");
  });

  it('does not keep either activity screen awake unconditionally', () => {
    expect(hiking).not.toContain('useKeepAwake');
    expect(running).not.toContain('useKeepAwake');
  });

  it('hosts unfinished and save-loss recovery for Running', () => {
    expect(running).toContain("findRecoverableActivity('running')");
    expect(running).toContain('<UnfinishedRecoveryModal');
    expect(running).toContain("useActivitySaveLossRecovery('running')");
  });

  it('guards start and finish at the shared store boundary', () => {
    expect(store).toContain("if (beforeStart.status !== 'idle' || beforeStart.isFinishing) return false;");
    expect(store).toContain("if (stopEntry.status === 'idle' || stopEntry.isFinishing) return null;");
    expect(store).toContain('set({ ...(frozenLifecycle ?? {}), isFinishing: true });');
  });

  it('returns a durable Finish result instead of making screens rediscover it after reset', () => {
    expect(store).toContain('ActivityFinishResult');
    expect(store).toMatch(/stopTracking:[\s\S]{0,220}Promise<ActivityFinishResult \| null>/);
    expect(hiking).toContain('finishResult = await stopTracking(name, clientActivityId =>');
    expect(running).toContain('finishResult = await stopTracking(trimmed, clientActivityId =>');
    expect(hiking).not.toContain('sessions.find(item => (');
    expect(running).not.toContain('sessions.find(item => (');
  });

  it('keeps the committed summary mounted after the tracking store returns to idle', () => {
    expect(hiking).toContain('if (!activitySessionVisible && !stopSummary)');
    expect(running).toContain('if (!isActivitySessionVisible(operationalState) && !showSaveSheet)');
  });

  it('keeps built-in Mapbox attribution and logo enabled on active activity maps', () => {
    const hikingMap = read('screens/HikingMap.tsx');
    expect(hikingMap).toMatch(/logoEnabled\s+attributionEnabled/);
    expect(hiking).toContain('<HikingMap');
    expect(running).toContain('<HikingMap');
    expect(hikingMap).not.toContain('logoEnabled={false}');
    expect(hikingMap).not.toContain('attributionEnabled={false}');
  });

  it('rebinds the full live route after every native style generation', () => {
    const hikingMap = read('screens/HikingMap.tsx');
    expect(hikingMap).toContain('routeStyleGeneration');
    expect(hikingMap).toContain('setRouteStyleGeneration');
    expect(hikingMap).toMatch(/key=\{`\$\{chunk\.key\}:style-\$\{routeStyleGeneration\}`\}/);
  });

  it('binds Activity Detail Final geometry above the style and refits by geometry identity', () => {
    const history = read('screens/MapHistoryScreen.tsx');
    expect(history).toContain('onDidFinishLoadingStyle');
    expect(history).toContain('detailStyleGeneration');
    expect(history).toContain('activityGeometryFingerprint(pts)');
    expect(history).toContain('activityGeometryFingerprint(session.trackPoints) === expectedFinalFingerprint');
    expect(history).toContain('activityFinalArtifactMatchesExpected(');
    expect(history).toContain('activityFinalPointsMatchExpected(normalised, expectedFinalFingerprint)');
    expect(history).toMatch(/id=\{`track-line-layer-[\s\S]{0,180}slot="top"/);
    expect(history).toContain('cameraRef.current?.fitBounds');
    expect(history).toContain('loadActivityTrackPoints(session)');
    expect(history).toContain('liveSelectedSession?.finalGeometryFingerprint');
  });
});
