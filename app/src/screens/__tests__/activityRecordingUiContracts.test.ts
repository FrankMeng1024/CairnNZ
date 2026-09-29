import fs from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(__dirname, '../../..');
const read = (relative: string) => fs.readFileSync(path.join(appRoot, relative), 'utf8');

describe('shared Hike and Run recording UI contracts', () => {
  const shared = read('src/components/activity/ActivityRecordingChrome.tsx');
  const hike = read('src/screens/HikingScreen.tsx');
  const run = read('src/screens/RunningScreen.tsx');
  const hikeFinish = read('src/screens/StopSummarySheet.tsx');
  const settings = read('src/screens/SettingsScreen.tsx');

  test.each([
    ['Hike', hike, 'hike'],
    ['Run', run, 'run'],
  ])('%s consumes one shared map-first chrome family', (_label, source, mode) => {
    expect(source).toContain('<ActivityTopChrome');
    expect(source).toContain(`<ActivityStartDock\n          mode="${mode}"`);
    expect(source).toMatch(new RegExp(`<ActivityControlDock\\s+mode="${mode}"`));
    expect(source).toContain(`<ActivityRecenterButton\n          mode="${mode}"`);
    expect(source).not.toContain('actionsExpanded');
    expect(source).not.toContain('runActionsExpanded');
  });

  test('tracking actions stay visible and paused Resume is primary', () => {
    expect(shared).toContain("phase === 'resuming' ? 'Resuming…'");
    expect(shared).toContain("phase === 'pausing' ? 'Pausing…'");
    expect(shared).toContain("paused ? 'Resume' : 'Pause'");
    expect(shared).toContain('styles.primaryControl');
    expect(shared).toContain("accessibilityLabel={`Finish ${mode}`}");
    expect(shared).toContain("mode === 'run' ? 'Cairn' : 'Plant'");
    expect(shared).toContain("paused ? 'Activity paused' : 'Recording activity'");
    expect(run).toContain('{!showSaveSheet ? (');
    expect(run).toContain('{!showSaveSheet && !runFollowUser ? (');
    expect(hike).toContain('{!stopSummary ? (');
    expect(hike).toContain('{!stopSummary && !followUser ? (');
  });

  test('metric hierarchy deliberately differs inside one family', () => {
    expect(hike).toContain("primaryMetric={{ label: 'DISTANCE'");
    expect(hike).toContain("{ label: 'ACTIVE TIME'");
    expect(hike).toContain("{ label: 'ELEVATION'");
    expect(run).toContain("primaryMetric={{ label: 'LIVE PACE'");
    expect(run).toContain("{ label: 'ACTIVE TIME'");
    expect(shared).toContain("mode === 'run' ? Colors.running");
  });

  test('real background permission is presented truthfully', () => {
    expect(hike).toContain("backgroundLocationPermission === 'foreground-only'");
    expect(run).toContain("backgroundLocationPermission === 'foreground-only'");
    expect(hike).toContain('Background location is off');
    expect(run).toContain('Background location is off');
    expect(shared).toContain('CloudOff');
    expect(shared).toContain('Settings');
  });

  test('GPS degraded states remain concise and operational', () => {
    expect(hike).toContain("? 'Signal lost'");
    expect(run).toContain("? 'Signal lost'");
    expect(hike).toContain('No location update for');
    expect(run).toContain('No location update for');
    expect(hike).not.toContain('route truth is recorded from accepted GPS');
    expect(shared).not.toContain('GPS evidence is saved as you move');
    expect(shared).toContain('notices.slice(0, 2)');
  });

  test('shared mode identity uses the Cairn activity pictogram family', () => {
    expect(shared).toContain("import { CairnIcon, type CairnIconName } from '../CairnIcon'");
    expect(shared).toContain("icon: 'hiking' as CairnIconName");
    expect(shared).toContain("icon: 'running' as CairnIconName");
    expect(shared).toContain('<CairnIcon name={modeMeta.icon}');
    expect(shared).toContain('ROUTE');
  });

  test('Mapbox route styling keeps explicit Hike/Run identity and a readability casing', () => {
    const map = read('src/screens/HikingMap.tsx');
    const presentation = read('src/features/activity/activityMapPresentation.ts');
    expect(map).toContain('id={`${id}-casing`}');
    expect(map).toContain('activityMapPresentation(mapTheme, activityVariant)');
    expect(map).toContain('lineWidth={mapPresentation.routeWidth}');
    expect(map).toContain('lineEmissiveStrength: emissiveStrength');
    expect(map).toContain('slot="top"');
    expect(map).toContain('updateIncrementalRoutePresentation');
    expect(presentation).toContain("routeCasingColor: '#FFF9ED'");
    expect(presentation).toContain('emissiveStrength: 1');
  });

  test('Run recenter calls the provider-selected accepted map target', () => {
    expect(run).toContain('recenterImperativeRef={runRecenterImperativeRef}');
    expect(run).toContain('runRecenterImperativeRef.current?.()');
  });

  test('finish intent stays honest, calm, and above live controls', () => {
    expect(hikeFinish).toContain("? (isRun ? 'Finishing run' : 'Finishing hike')");
    expect(hikeFinish).toContain("? (isRun ? 'Run complete' : 'Hike complete')");
    expect(hikeFinish).toContain(": (isRun ? 'Finish run' : 'Finish hike')");
    expect(hikeFinish).toContain("{committed ? 'View activity' : `Finish ${label.toLowerCase()}`}");
    expect(hikeFinish).toContain('if (committed) onViewActivity?.()');
    expect(hikeFinish).not.toContain('complete-hero.png');
    expect(run).toContain('<StopSummarySheet');
    expect(run).toContain('summary={runStopSummaryPresentation}');
    expect(run).toContain('committed={Boolean(committedRunActivityId)}');
    expect(run).toContain('finishProgress={finishProgress}');
    expect(run).toContain('onViewActivity={() =>');
  });

  test('shows the walked route before Save and the selected Route afterward', () => {
    expect(hikeFinish).toContain('{summary.trackPoints.length >= 2 && (');
    expect(hikeFinish).not.toContain('{committed && summary.trackPoints.length >= 2 && (');
    expect(hikeFinish).toContain("committed ? 'Route ready' : 'Walked route preview'");
  });

  test('Finish exposes exactly Hike saved, Route and Sync concepts', () => {
    expect(hikeFinish).toContain('activity-finish-progress-rail');
    expect(hikeFinish).toContain('`${label} saved`');
    expect(hikeFinish).toContain('`Saving ${label.toLowerCase()}`');
    expect(hikeFinish).toContain("'Route ready'");
    expect(hikeFinish).toContain("'Refining route'");
    expect(hikeFinish).toContain("'Sync · Waiting for connection'");
    expect(hikeFinish).toContain("'Synced'");
    expect(hikeFinish).toContain("'Sync · Needs attention'");
    expect(hikeFinish).not.toContain('Step 2 of 3');
    expect(hikeFinish).not.toContain("'Base Final'");
    expect(hikeFinish).not.toContain("'Refined Final'");
    expect(hikeFinish).not.toContain("'Map Matching'");
  });

  test('Settings exposes one privacy-safe owner action for the follow-up field ledger', () => {
    expect(settings).toContain('title="Copy Activity diagnostics"');
    expect(settings).toContain('testID="settings-copy-activity-diagnostics"');
    expect(settings).toContain('exportLatestActivityStageLedger(ownerId)');
    expect(settings).toContain('currentOwnerId() !== ownerId');
    expect(settings).toContain('contains no coordinates or Mapbox token');
  });
});
