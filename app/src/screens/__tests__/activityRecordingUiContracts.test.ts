import fs from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(__dirname, '../../..');
const read = (relative: string) => fs.readFileSync(path.join(appRoot, relative), 'utf8');

describe('shared Hike and Run recording UI contracts', () => {
  const shared = read('src/components/activity/ActivityRecordingChrome.tsx');
  const hike = read('src/screens/HikingScreen.tsx');
  const run = read('src/screens/RunningScreen.tsx');

  test.each([
    ['Hike', hike, 'hike'],
    ['Run', run, 'run'],
  ])('%s consumes one shared map-first chrome family', (_label, source, mode) => {
    expect(source).toContain('<ActivityTopChrome');
    expect(source).toContain(`<ActivityStartDock\n          mode="${mode}"`);
    expect(source).toContain(`<ActivityControlDock\n        mode="${mode}"`);
    expect(source).toContain(`<ActivityRecenterButton\n          mode="${mode}"`);
    expect(source).not.toContain('actionsExpanded');
    expect(source).not.toContain('runActionsExpanded');
  });

  test('tracking actions stay visible and paused Resume is primary', () => {
    expect(shared).toContain("{paused ? 'Resume' : 'Pause'}");
    expect(shared).toContain('styles.primaryControl');
    expect(shared).toContain("accessibilityLabel={`Finish ${mode}`}");
    expect(shared).toContain("mode === 'run' ? 'Cairn' : 'Plant'");
    expect(shared).toContain("paused ? 'Activity paused' : 'Recording activity'");
  });

  test('metric hierarchy deliberately differs inside one family', () => {
    expect(hike).toContain("primaryMetric={{ label: 'ACTIVE TIME'");
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
    expect(hike).toContain('No accepted GPS for');
    expect(run).toContain('No accepted GPS for');
    expect(shared).toContain('notices.slice(0, 2)');
  });

  test('Mapbox route styling keeps explicit Hike/Run identity and a readability casing', () => {
    const map = read('src/screens/HikingMap.tsx');
    expect(map).toContain('id="track-line-casing"');
    expect(map).toContain("activityVariant === 'run' ? Colors.running : theme.primary");
    expect(map).toContain('lineWidth: 4.5');
    expect(map).toContain('if (isSegmentBreak)');
    expect(map).toContain('features: []');
  });

  test('Run recenter calls the provider-selected accepted map target', () => {
    expect(run).toContain('recenterImperativeRef={runRecenterImperativeRef}');
    expect(run).toContain('runRecenterImperativeRef.current?.()');
  });
});
