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
  const activityDetail = read('src/screens/MapHistoryScreen.tsx');
  const catalog = read('src/i18n/cairnText.ts');

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
    // REVISE_WITH_REASON: keep state-to-copy semantics keyed while English is
    // authoritative only in cairnText.ts.
    expect(shared).toContain("phase === 'resuming' ? cairnText('activity.activity-recording-chrome.resuming')");
    expect(shared).toContain("phase === 'pausing' ? cairnText('activity.activity-recording-chrome.pausing')");
    expect(shared).toContain("paused ? cairnText('activity.activity-recording-chrome.resume') : cairnText('activity.activity-recording-chrome.pause')");
    expect(shared).toContain('styles.primaryControl');
    expect(shared).toContain("cairnText('activity.activity-recording-chrome.finish-value'");
    expect(shared).toContain("mode === 'run' ? cairnText('activity.activity-recording-chrome.cairn') : cairnText('activity.activity-recording-chrome.plant')");
    expect(shared).toContain("paused ? cairnText('activity.activity-recording-chrome.activity-paused') : cairnText('activity.activity-recording-chrome.recording-activity')");
    expect(run).toContain('{!showSaveSheet ? (');
    expect(run).toContain('{!showSaveSheet && !runFollowUser ? (');
    expect(hike).toContain('{!stopSummary ? (');
    expect(hike).toContain('{!stopSummary && !followUser ? (');
  });

  test('simulator setup cannot remount over Finish confirmation or completion', () => {
    expect(hike.match(/showSimulator && !stopSummary \? <ActivitySimulatorPanel/g)).toHaveLength(2);
    expect(run.match(/showSimulator && !showSaveSheet \? <ActivitySimulatorPanel/g)).toHaveLength(2);
    expect(hike).not.toContain('{showSimulator ? <ActivitySimulatorPanel /> : null}');
    expect(run).not.toContain('{showSimulator ? <ActivitySimulatorPanel /> : null}');
  });

  test('metric hierarchy deliberately differs inside one family', () => {
    expect(hike).toContain("primaryMetric={{ label: cairnText('hiking-screen.distance')");
    expect(hike).toContain("{ label: cairnText('hiking-screen.active-time')");
    expect(hike).toContain("{ label: cairnText('hiking-screen.elevation')");
    expect(run).toContain("primaryMetric={{ label: cairnText('running-screen.live-pace')");
    expect(run).toContain("{ label: cairnText('running-screen.active-time')");
    expect(shared).toContain("mode === 'run' ? Colors.running");
  });

  test('real background permission is presented truthfully', () => {
    expect(hike).toContain("backgroundLocationPermission === 'foreground-only'");
    expect(run).toContain("backgroundLocationPermission === 'foreground-only'");
    expect(hike).toContain("cairnText('hiking-screen.background-location-is-off-keep-cairnnz-open')");
    expect(run).toContain("cairnText('running-screen.background-location-is-off-keep-cairnnz-open')");
    expect(shared).toContain('CloudOff');
    expect(shared).toContain("cairnText('activity.activity-recording-chrome.settings')");
  });

  test('GPS degraded states remain concise and operational', () => {
    expect(hike).toContain("? cairnText('hiking-screen.signal-lost')");
    expect(run).toContain("? cairnText('running-screen.signal-lost')");
    expect(hike).toContain("cairnText('hiking-screen.no-location-update-for-value-min'");
    expect(run).toContain("cairnText('running-screen.no-location-update-for-value-min'");
    expect(hike).not.toContain('route truth is recorded from accepted GPS');
    expect(shared).not.toContain('GPS evidence is saved as you move');
    expect(shared).toContain('notices.slice(0, 2)');
  });

  test('shared mode identity uses the Cairn activity pictogram family', () => {
    expect(shared).toContain("import { CairnIcon, type CairnIconName } from '../CairnIcon'");
    expect(shared).toContain("icon: 'hiking' as CairnIconName");
    expect(shared).toContain("icon: 'running' as CairnIconName");
    expect(shared).toContain('<CairnIcon name={modeMeta.icon}');
    expect(shared).toContain("cairnText('activity.activity-recording-chrome.route')");
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
    expect(hikeFinish).toContain("? (isRun ? cairnText('stop-summary-sheet.finishing-run') : cairnText('stop-summary-sheet.finishing-hike'))");
    expect(hikeFinish).toContain("? (isRun ? cairnText('stop-summary-sheet.run-complete') : cairnText('stop-summary-sheet.hike-complete'))");
    expect(hikeFinish).toContain(": (isRun ? cairnText('stop-summary-sheet.finish-run') : cairnText('stop-summary-sheet.finish-hike'))");
    expect(hikeFinish).toContain("{committed ? cairnText('stop-summary-sheet.view-activity') : cairnText('stop-summary-sheet.finish-value'");
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
    expect(hikeFinish).toContain("committed ? cairnText('stop-summary-sheet.route-ready') : cairnText('stop-summary-sheet.walked-route-preview')");
  });

  test('Finish exposes exactly Hike saved, Route and Sync concepts', () => {
    expect(hikeFinish).toContain('activity-finish-progress-rail');
    expect(hikeFinish).toContain("cairnText('stop-summary-sheet.value-saved'");
    expect(hikeFinish).toContain("cairnText('stop-summary-sheet.saving-value'");
    expect(hikeFinish).toContain("cairnText('stop-summary-sheet.route-ready')");
    expect(hikeFinish).toContain("cairnText('stop-summary-sheet.refining-route')");
    expect(hikeFinish).toContain("cairnText('stop-summary-sheet.sync-waiting-for-connection')");
    expect(hikeFinish).toContain("cairnText('stop-summary-sheet.synced')");
    expect(hikeFinish).toContain("cairnText('stop-summary-sheet.sync-needs-attention')");
    expect(hikeFinish).not.toContain('Step 2 of 3');
    expect(hikeFinish).not.toContain("'Base Final'");
    expect(hikeFinish).not.toContain("'Refined Final'");
    expect(hikeFinish).not.toContain("'Map Matching'");
  });

  test('Settings exposes one owner-bound export and accurately discloses opted-in coordinates', () => {
    expect(settings).toContain("title={cairnText('settings-screen.copy-activity-diagnostics')}");
    expect(settings).toContain('testID="settings-copy-activity-diagnostics"');
    expect(settings).toContain('exportLatestActivityStageLedger(ownerId)');
    expect(settings).toContain('exportActivityDiagnosticReplayIfPresent({');
    expect(settings).toContain('clientActivityId: ledger.clientActivityId');
    expect(settings).toContain('currentOwnerId() !== ownerId');
    expect(settings).toContain("detail={cairnText('settings-screen.owner-debug-recordings-include-precise-coordinates-for')}");
    expect(catalog).toContain('includes precise coordinates and redacted provider evidence');
    expect(catalog).toContain('contains no Mapbox token');
  });

  test('debug Activity Detail exports the explicitly selected historical Activity', () => {
    expect(activityDetail).toContain('testID="activity-copy-diagnostics"');
    expect(activityDetail).toContain('exportActivityStageLedger(ownerUserId, clientActivityId, realm)');
    expect(activityDetail).toContain('selectedClientActivityId: clientActivityId');
    expect(activityDetail).toContain("schema: 'cairn-selected-activity-forensic-export'");
    expect(activityDetail).toContain('{debugMode ? (');
  });
});
