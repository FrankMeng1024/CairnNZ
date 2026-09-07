import fs from 'node:fs';
import path from 'node:path';
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
import {
  boundSimulatorLogEvents,
  sanitizeSimulatorLogFields,
  SIMULATOR_LOG_LIMITS,
  type SimulatorLogEvent,
} from '../simulatorLog';

const appRoot = path.resolve(__dirname, '../../../..');
const read = (relative: string) => fs.readFileSync(path.join(appRoot, relative), 'utf8');

describe('Activity Simulator integration and safety contracts', () => {
  test('internal capability AND Debug Mode AND explicit toggle select Simulator', () => {
    const capability = read('src/features/activitySimulator/capability.ts');
    const provider = read('src/features/activitySimulator/activityLocationProvider.ts');
    const eas = JSON.parse(read('eas.json'));
    expect(capability).toContain("EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED === 'true'");
    expect(provider).toContain('simulatorRuntimeAuthorized() && useActivitySimulatorStore.getState().enabled');
    expect(eas.build.production.env.EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED).toBe('false');
    expect(eas.build.preview.env.EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED).toBe('true');
  });

  test.each(['HikingScreen.tsx', 'RunningScreen.tsx'])('%s exposes the same provider panel', screen => {
    const source = read(`src/screens/${screen}`);
    expect(source).toContain('<ActivitySimulatorPanel');
    expect(source).toContain('locationProviderSource');
    expect(source).toContain('selectedActivityLocationSource()');
  });

  test('simulator feeds addTrackPoint and owns no metric or Memory mutation', () => {
    const provider = read('src/features/activitySimulator/activityLocationProvider.ts');
    const engine = read('src/features/activitySimulator/activitySimulatorEngine.ts');
    const directory = ['activityLocationProvider.ts', 'activitySimulatorEngine.ts', 'useActivitySimulatorStore.ts']
      .map(file => read(`src/features/activitySimulator/${file}`)).join('\n');
    expect(provider).toContain('CanonicalActivitySink');
    expect(engine).toContain('const decision = await sink(sample)');
    expect(directory).not.toContain('recordMemoryEvidence');
    expect(directory).not.toContain('distanceM: s.distanceM');
    expect(directory).not.toContain('elevationGainM: s.elevationGainM');
    expect(directory).not.toContain('useSessionStore.getState().addSession');
  });

  test('provider lease rejects stale identity and cross-source callbacks', () => {
    const tracking = read('src/store/useTrackingStore.ts');
    expect(tracking).toContain("return reject('stale-client-activity')");
    expect(tracking).toContain("return reject('stale-owner-generation')");
    expect(tracking).toContain("return reject('provider-source-mismatch')");
    expect(tracking).toContain("src: owned.source === 'simulator'");
  });

  test('Pause, recovery and forced interruption use real segment ownership', () => {
    const tracking = read('src/store/useTrackingStore.ts');
    const interruption = tracking.slice(
      tracking.indexOf('simulateRecordingInterruption: async'),
      tracking.indexOf('suspendForUserSwitch: async'),
    );
    expect(interruption).toContain("status: 'paused'");
    expect(interruption).toContain("nextSegmentStartReason: 'process-recovery'");
    expect(interruption).not.toContain('addTrackPoint(');
    expect(tracking).toContain("pendingSegmentStartReason: rebuildingAfterProcessDeath ? 'process-recovery' : 'resume'");
  });

  test('poor accuracy and gap authority remain canonical Activity decisions', () => {
    const tracking = read('src/store/useTrackingStore.ts');
    const engine = read('src/features/activitySimulator/activitySimulatorEngine.ts');
    expect(tracking).toContain("acceptance.reason = 'poor-accuracy'");
    expect(tracking).toContain('MAX_ACCEPTABLE_HORIZONTAL_ACCURACY_M');
    expect(tracking).toContain('shouldStartNewSegment({');
    expect(engine).not.toContain('newSegmentId(');
    expect(engine).not.toContain('shouldStartNewSegment');
  });

  test('Full Plant and Quick Cairn fail closed during Simulator GPS loss', () => {
    const sampler = read('src/features/plant/services/gpsSampler.ts');
    const running = read('src/screens/RunningScreen.tsx');
    expect(sampler).toContain('readTrustedSimulatorLocation()');
    expect(sampler).toContain("return makeFailure('no-readings')");
    expect(sampler).toContain('decideFromReadings(readings)');
    expect(running).toContain("locationProviderSource === 'simulator' && simulatorSignal === 'lost'");
  });

  test('Cairn provenance/offline commit and Activity/passive Memory use shared authorities', () => {
    const markers = read('src/store/useMarkerStore.ts');
    const tracking = read('src/store/useTrackingStore.ts');
    const passive = read('src/features/memory/components/PassiveMemoryRecorder.tsx');
    expect(markers.indexOf('await offlineMarkers.saveLocal')).toBeLessThan(markers.indexOf("appendSimulatorLog('CAIRN_COMMIT'"));
    expect(markers).toContain('originActivityClientId: activeActivityClientId');
    expect(tracking).toContain("source: 'activity'");
    expect(passive).toContain("source: 'passive'");
    expect(passive).toContain("status !== 'idle'");
    expect(passive).toContain('MAX_ACCEPTABLE_HORIZONTAL_ACCURACY_M');
  });

  test('Simulator recovery context is user-scoped, bounded and locally persisted', () => {
    const store = read('src/features/activitySimulator/useActivitySimulatorStore.ts');
    const recovery = read('src/features/activity/activityRecovery.ts');
    expect(store).toContain('activity_simulator:v1:${userId}');
    expect(store).toContain('boundActivityClientId');
    expect(store).toContain('waypoints.slice(0, MAX_WAYPOINTS)');
    expect(recovery).toContain("locationProviderSource: meta.location_source ?? registered?.locationProviderSource ?? 'real'");
    expect(recovery).toContain("point.src === 'sim'");
  });

 test('Finish, Detail and sync retain the normal product path', () => {
    const tracking = read('src/store/useTrackingStore.ts');
    const detail = read('src/screens/MapHistoryScreen.tsx');
    const sync = read('src/services/syncDaemon.ts');
    expect(tracking).toContain('await completeActivity({');
    expect(tracking).toContain('await useSessionStore.getState().addSession({');
    expect(detail).toContain('segmentTrace(pts)');
    expect(sync).toContain('await saveHikeAtomic(');
    expect(sync).toContain("item.locationProviderSource === 'simulator'");
    expect(sync).toContain("appendSimulatorLog('SYNC_ACK'");
 });

  test('accelerated time changes provider evidence, never Activity business calculations', () => {
    const time = read('src/features/activitySimulator/simulatorTime.ts');
    const engine = read('src/features/activitySimulator/activitySimulatorEngine.ts');
    const tracking = read('src/store/useTrackingStore.ts');
    const panel = read('src/features/activitySimulator/ActivitySimulatorPanel.tsx');
    expect(time).toContain('SIMULATOR_MAX_VIRTUAL_ACTIVITY_MS');
    expect(time).toContain('SIMULATOR_FUTURE_SAFETY_MARGIN_MS');
    expect(engine).toContain('elapsedVirtualMs');
    expect(engine).toContain('configuredSpeedKmh: args.state.speedKmh');
    expect(engine).not.toMatch(/durationS\s*[:+]=/);
    expect(engine).not.toContain('calculateActivityStats');
    expect(tracking).toContain('simulatorActivityStartTimestamp(');
    expect(tracking).toContain('const endedAt = activityTimestampForSource(');
    expect(panel).toContain('SIMULATOR_TIME_SCALES.map');
    expect(panel).toContain('simulated sec/real sec');
  });

  test('recovery fences and live freshness use the provider timeline without changing Real GPS', () => {
    const recovery = read('src/features/activity/activityRecovery.ts');
    const tracking = read('src/store/useTrackingStore.ts');
    const hike = read('src/screens/HikingScreen.tsx');
    const run = read('src/screens/RunningScreen.tsx');
    expect(recovery).toContain('activityTimestampForSource(');
    expect(tracking).toContain('resumeGenerationStartedAt = activityTimestampForSource(');
    expect(hike).toContain("locationProviderSource === 'simulator'");
    expect(hike).toContain('simulatorVirtualTimestamp');
    expect(run).toContain('simulatorVirtualTimestamp');
  });

  test('too-short eligibility has no simulator bypass or history undo', () => {
    const contracts = read('src/features/activity/activityContracts.ts');
    const tracking = read('src/store/useTrackingStore.ts');
    expect(contracts).not.toContain('allowAuthoredSimulation');
    expect(tracking).not.toContain('__simwalker');
    expect(fs.existsSync(path.join(appRoot, 'src/dev/simWalker/gpsInjector.ts'))).toBe(false);
  });

  test('logs are bounded and secret-bearing fields are removed', () => {
    const fields = sanitizeSimulatorLogFields({
      accessToken: 'secret',
      password: 'secret',
      rawEmail: 'qa@example.test',
      coordinate: { lat: -45, lng: 168 },
      safeCode: 'ok',
    });
    expect(fields).toEqual({ coordinate: { lat: -45, lng: 168 }, safeCode: 'ok' });
    const event = (index: number): SimulatorLogEvent => ({
      timestamp: index,
      eventName: `event-${index}`,
      category: 'SIM_SAMPLE',
      simulatorSessionId: 'sim-a',
      clientActivityIdSuffix: 'activity',
      ownerSuffix: 'owner',
      virtualTimestamp: index,
      wallClockTimestamp: index,
      timeScale: 10,
      effectiveVirtualElapsed: index,
      sampleSequence: index,
     batchSequence: index,
      fields: {},
    });
    const bounded = boundSimulatorLogEvents(
      Array.from({ length: SIMULATOR_LOG_LIMITS.maxEventsPerSession + 50 }, (_, index) => event(index)),
    );
    expect(bounded).toHaveLength(SIMULATOR_LOG_LIMITS.maxEventsPerSession);
    expect(bounded[0].timestamp).toBe(50);
  });

  test('public source has no simulator activation path', () => {
    const productionProfile = JSON.parse(read('eas.json')).build.production;
    expect(productionProfile.env.EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED).toBe('false');
    expect(read('src/features/activitySimulator/capability.ts')).not.toContain('__DEV__ ||');
  });

  test('panel does not overwrite a fresh toggle with redundant same-owner hydration', () => {
    const panel = read('src/features/activitySimulator/ActivitySimulatorPanel.tsx');
    expect(panel).toContain("hydratedUserId !== String(userId)");
  });
});
