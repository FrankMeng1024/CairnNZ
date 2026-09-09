import fs from 'node:fs';
import path from 'node:path';
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
import {
  boundSimulatorLogEvents,
  sanitizeSimulatorLogFields,
  serializeQaEventsForUpload,
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
    expect(provider).toContain('return buildCapable && debugMode && simulatorEnabled');
    expect(provider).toContain('resolveActivityLocationSource(');
    expect(eas.build.production.env.EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED).toBe('false');
    expect(eas.build.preview.env.EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED).toBe('true');
  });

  test.each(['HikingScreen.tsx', 'RunningScreen.tsx'])('%s exposes the same provider panel', screen => {
    const source = read(`src/screens/${screen}`);
    expect(source).toContain('<ActivitySimulatorPanel');
    expect(source).toContain('locationProviderSource');
    expect(source).toContain('resolveSimulatorMapState({');
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
    expect(tracking.indexOf("locationProviderSource === 'simulator'"))
      .toBeLessThan(tracking.indexOf("'simulator_provider_locked'"));
    expect(tracking).toContain("'real_callback_rejected_for_simulator_activity'");
  });

  test('virtual origin is selected before Start and only canonical Simulator evidence becomes point one', () => {
    const panel = read('src/features/activitySimulator/ActivitySimulatorPanel.tsx');
    const provider = read('src/features/activitySimulator/activityLocationProvider.ts');
    const tracking = read('src/store/useTrackingStore.ts');
    expect(panel).toContain("'virtual_origin_selected'");
    expect(panel).toContain('firstActivityPointPending: true');
    expect(provider).toContain('state.startConfigured');
    expect(provider).toContain('activitySimulatorEngine.bindActivity');
    expect(tracking).toContain('firstAcceptedPointPending: get().trackPoints.length === 0');
    expect(tracking).toContain("return reject('provider-source-mismatch')");
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
    expect(engine).toContain('poorSimulatorAccuracyMeters(sequence)');
    expect(engine).toContain("state.signal === 'lost'");
    expect(engine).toContain("state.signal === 'frozen'");
  });

  test('manual reacquisition and rollback preserve central segment/metric authority', () => {
    const tracking = read('src/store/useTrackingStore.ts');
    const correction = read('src/features/activitySimulator/simulatorActivityCorrection.ts');
    const writer = read('src/services/hikeTrackWriter.ts');
    expect(tracking).toContain("pendingSegmentStartReason: 'gps-reacquired'");
    expect(tracking).toContain("'simulator_manual_reacquisition_committed'");
    expect(tracking).toContain('gapDistanceCreditedM: 0');
    expect(correction).toContain('sameSegment');
    expect(tracking).toContain('calculateActivityStats(retained)');
    expect(writer).toContain('truncateActiveHikeTrack');
    expect(writer).toContain('activity_journal_truncation_verification_failed');
    expect(tracking).toContain('memoryRolledBack: false');
    expect(tracking).toContain('cairnsRolledBack: false');
  });

  test('Full Plant and Quick Cairn fail closed during Simulator GPS loss', () => {
    const sampler = read('src/features/plant/services/gpsSampler.ts');
    const provider = read('src/features/activitySimulator/activityLocationProvider.ts');
    const running = read('src/screens/RunningScreen.tsx');
    expect(sampler).toContain('readTrustedSimulatorLocation()');
    expect(sampler).toContain("return makeFailure('no-readings')");
    expect(sampler).toContain('decideFromReadings(readings)');
    expect(sampler).toContain("locationSource: 'last-canonically-accepted-simulator'");
    expect(provider).toContain('tracking.lastCoordinate');
    expect(provider).toContain('tracking.lastCoordinateTime');
    expect(running).toContain("locationProviderSource === 'simulator' && simulatorSignal === 'lost'");
    expect(running).toContain("locationSource: locationProviderSource === 'simulator' ? 'last-canonically-accepted-simulator'");
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
    expect(store).toContain('waypoints.slice(0, MAX_SIMULATOR_AUTOPILOT_POINTS)');
    expect(recovery).toContain("const locationProviderSource = meta.location_source ?? registered?.locationProviderSource ?? 'real'");
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

  test('map matching is derived independently per real segment with truthful raw fallback', () => {
    const tracking = read('src/store/useTrackingStore.ts');
    expect(tracking).toContain('const sourceSegments = segmentTrace(memorySource).segments');
    expect(tracking).toContain('snappedSegments.push(segment)');
    expect(tracking).toContain('snappedTrackPoints = hikeSource');
    expect(tracking).not.toContain('if (everySegmentSafe) snappedTrackPoints');
    expect(tracking.indexOf('activity_map_matching_started'))
      .toBeLessThan(tracking.indexOf('const v412Route3'));
    const detail = read('src/screens/MapHistoryScreen.tsx');
    expect(detail).toContain('const remotePts = (detail as any)?.route_points');
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
    expect(panel).toContain('([1, 5, 10, 30, 60, 120] as SimulatorTimeScale[]).map');
    expect(panel).toContain('时间倍率');
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

  test('Auto Move follows a bounded walking geometry and straight-line mode is explicit Advanced QA', () => {
    const route = read('src/features/activitySimulator/simulatorWalkingRoute.ts');
    const panel = read('src/features/activitySimulator/ActivitySimulatorPanel.tsx');
    expect(route).toContain('/directions/v5/mapbox/walking/');
    expect(route).toContain('MAX_SIMULATOR_AUTOPILOT_POINTS');
    expect(panel).toContain("'simulator_walking_route_ready'");
    expect(panel).toContain('无法获取步行路径，请使用摇杆');
    expect(panel).toContain('label="直线移动"');
  });

  test('map configuration fails safe on missing OTA token and restores outdoor information density', () => {
    const mapbox = read('src/config/mapbox.ts');
    expect(mapbox).toContain('if (isMapboxTokenConfigured()) Mapbox.setAccessToken(MAPBOX_TOKEN)');
    expect(mapbox).toContain('showPedestrianRoads: true');
    expect(mapbox).toContain("theme: 'default'");
    const map = read('src/screens/HikingMap.tsx');
    expect(map).toContain('mapboxTokenConfigured: isMapboxTokenConfigured()');
  });

  test('Activity Detail deletion invalidates retained state and resets to Trails without a Back loop', () => {
    const detail = read('src/screens/MapHistoryScreen.tsx');
    const backContract = detail.slice(
      detail.indexOf('const returnToActivities'),
      detail.indexOf('const commitActivityRename'),
    );
    expect(detail).toContain('selectedSessionId === invalidatedSessionId ? null');
    expect(detail).toContain('setInvalidatedSessionId(id)');
    expect(detail).toContain('detailSessionSnapshots.current.delete(id)');
    expect(detail).toContain("routes: [{ name: 'Home' }, { name: 'Routes', params: { initialTab: 'activities' } }]");
    expect(backContract).not.toContain('nav.goBack()');
    expect(detail).not.toContain("? () => nav.navigate('Routes', { initialTab: 'activities' })");
  });

  test('Debug Simulator keep-awake and virtual origin lifecycle do not affect Real Activity', () => {
    const keepAwake = read('src/features/activitySimulator/useSimulatorKeepAwake.ts');
    const engine = read('src/features/activitySimulator/activitySimulatorEngine.ts');
    const hike = read('src/screens/HikingScreen.tsx');
    const run = read('src/screens/RunningScreen.tsx');
    expect(keepAwake).toContain('activateKeepAwakeAsync');
    expect(keepAwake).toContain('deactivateKeepAwake');
    expect(hike).toContain("locationProviderSource === 'simulator'");
    expect(run).toContain("locationProviderSource === 'simulator'");
    expect(engine).toContain("reason === 'completed' || reason === 'discarded'");
    expect(engine).toContain('clearOrigin');
  });

  test('rename and Activity-derived Route mutations are server-authoritative', () => {
    const sessions = read('src/store/useSessionStore.ts');
    const sessionService = read('src/services/sessionService.ts');
    const editor = read('src/screens/RouteEditorScreen.tsx');
    const routeService = read('src/services/routeService.ts');
    expect(sessions).toContain('await renameRemoteSession(remoteId, trimmed)');
    expect(sessions.indexOf('await renameRemoteSession(remoteId, trimmed)'))
      .toBeLessThan(sessions.indexOf('const run = sessionWriteTail.then', sessions.indexOf('renameSession: async')));
    expect(sessionService).toContain('/api/sessions/${remoteId}/name');
    expect(editor).toContain('if (fromSessionId && !liveSourceSession)');
    expect(routeService).toContain('source_activity_client_id');
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
      session_id: 'qa-a',
      qaSessionId: 'qa-a',
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
      coordinateSource: 'simulator',
      debugMode: true,
      simulatorEnabled: true,
      providerSource: 'simulator',
      trackingStatus: 'tracking',
      fields: {},
    });
    const bounded = boundSimulatorLogEvents(
      Array.from({ length: SIMULATOR_LOG_LIMITS.maxEventsPerSession + 50 }, (_, index) => event(index)),
    );
    expect(bounded.length).toBeLessThanOrEqual(SIMULATOR_LOG_LIMITS.maxEventsPerSession);
    expect(JSON.stringify(bounded).length).toBeLessThanOrEqual(SIMULATOR_LOG_LIMITS.maxBytesPerSession);
    expect(bounded[0].timestamp).toBeGreaterThanOrEqual(50);
    const realEvent = event(1);
    realEvent.coordinateSource = 'real';
    realEvent.fields = { lat: -45.0312, lng: 168.6626, accuracyM: 7 };
    const syntheticEvent = event(2);
    syntheticEvent.fields = { lat: -45.0312, lng: 168.6626, accuracyM: 5 };
    const upload = serializeQaEventsForUpload([realEvent, syntheticEvent])
      .split('\n')
      .map(line => JSON.parse(line));
    expect(upload[0].fields).toEqual({ accuracyM: 7 });
    expect(upload[1].fields).toMatchObject({ lat: -45.0312, lng: 168.6626, accuracyM: 5 });

    const criticalNames = [
      'app_start',
      'hike_map_mounted',
      'run_map_loading_error',
      'virtual_origin_selected',
      'simulator_provider_locked',
      'real_callback_rejected_for_simulator_activity',
      'simulator_first_sample_generated',
      'simulator_first_point_accepted',
      'simulator_first_point_committed',
      'simulator_gps_state_changed',
      'simulator_manual_reacquisition_committed',
      'canonical_segment_changed',
      'simulator_rollback_completed',
      'hike_cairn_location_selected',
      'activity_save_started',
      'activity_sync_acknowledged',
      'simulator_activity_server_acknowledged',
      'real_activity_location_source_activated',
      'real_activity_location_callback',
      'location_sample_accepted',
      'location_sample_rejected',
      'activity_trace_state_received',
    ];
    const critical = criticalNames.map((eventName, index) => ({
      ...event(index),
      timestamp: index,
      eventName,
    }));
    const withNoise = boundSimulatorLogEvents([
      ...critical,
      ...Array.from({ length: SIMULATOR_LOG_LIMITS.maxEventsPerSession + 50 }, (_, index) => event(index + 1)),
    ]);
    expect(withNoise.map(item => item.eventName)).toEqual(expect.arrayContaining(criticalNames));

    const realPipelineWithIdleNoise = boundSimulatorLogEvents([
      { ...event(0), eventName: 'real_activity_location_callback', coordinateSource: 'real' },
      { ...event(1), eventName: 'activity_trace_state_received', coordinateSource: 'real' },
      ...Array.from({ length: SIMULATOR_LOG_LIMITS.maxEventsPerSession + 200 }, (_, index) => ({
        ...event(index + 2),
        eventName: 'hike_map_idle',
        category: 'MAP_STATE' as const,
      })),
    ]);
    expect(realPipelineWithIdleNoise.map(item => item.eventName)).toEqual(expect.arrayContaining([
      'real_activity_location_callback',
      'activity_trace_state_received',
    ]));

    const criticalOnly = boundSimulatorLogEvents(Array.from({ length: 128 }, (_, index) => {
      const item = event(index);
      item.eventName = 'simulator_rollback_completed';
      item.fields = { padding: 'x'.repeat(10_000) };
      return item;
    }));
    expect(JSON.stringify(criticalOnly).length).toBeLessThanOrEqual(SIMULATOR_LOG_LIMITS.maxBytesPerSession);
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

  test('fresh Simulator accounts require an explicit worldwide start', () => {
    const store = read('src/features/activitySimulator/useActivitySimulatorStore.ts');
    const provider = read('src/features/activitySimulator/activityLocationProvider.ts');
    const panel = read('src/features/activitySimulator/ActivitySimulatorPanel.tsx');
    expect(store).toContain('startConfigured: false');
    expect(store).toContain('startConfigured: true');
    expect(provider).toContain('&& state.startConfigured');
    expect(panel).toContain('activity-simulator-start-here');
    expect(panel).toContain('模拟起点');
  });

  test('both fresh Activity screens reset stale Simulator setup through the durable unfinished-Activity guard', () => {
    const store = read('src/features/activitySimulator/useActivitySimulatorStore.ts');
    const hike = read('src/screens/HikingScreen.tsx');
    const run = read('src/screens/RunningScreen.tsx');
    expect(store).toContain('initializeFreshSimulatorSetupForActivityEntry');
    expect(store).toContain("return 'preserved-unfinished-activity'");
    expect(store).toContain('current.mapDiagnostics');
    expect(hike).toContain('initializeFreshSimulatorSetupForActivityEntry(String(simulatorOwnerUserId))');
    expect(run).toContain('initializeFreshSimulatorSetupForActivityEntry(String(simulatorOwnerUserId))');
  });

  test('Simulator overlays stay in bounded map-safe docks', () => {
    const panel = read('src/features/activitySimulator/ActivitySimulatorPanel.tsx');
    expect(panel).toContain('activity-simulator-joystick');
    expect(panel).toContain('left: 10');
    expect(panel).toContain('right: 10');
    expect(panel).toContain('expandedIdle: { bottom: 106 }');
    expect(panel).toContain('expandedActive: { height: 210 }');
    expect(panel).toContain('activity-simulator-settings-scroll');
    expect(panel).toContain('top: 118');
  });

  test('both native camera paths retain bounded Simulator behavior', () => {
    const hikeMap = read('src/screens/HikingMap.tsx');
    const hike = read('src/screens/HikingScreen.tsx');
    const run = read('src/screens/RunningScreen.tsx');
    expect(hikeMap).toContain('simulatorEnabled ? userPos');
    expect(hikeMap).toContain('onDidFinishLoadingStyle={markStyleLoaded}');
    expect(hikeMap).toContain('onMapIdle={markMapIdle}');
    expect(hikeMap).toContain('key={`hike-map-${mapEpoch}`}');
    expect(hike.match(/<HikingMap/g)).toHaveLength(1);
    expect(hike).toContain('key="hike-map-surface"');
    expect(run.match(/<HikingMap/g)).toHaveLength(1);
    expect(run).toContain('key="run-map-surface"');
    expect(run).not.toContain("setMapLoadState('unavailable')");
  });

  test('Settings exposes an independent Simulator toggle and locks it during an owned Activity', () => {
    const settings = read('src/screens/SettingsScreen.tsx');
    expect(settings).toContain('label="Debug mode"');
    expect(settings).toContain('label="Activity Simulator"');
    expect(settings).toContain('testID="activity-simulator-toggle"');
    expect(settings).toContain('disabled={simulatorContinuity.locked}');
    expect(settings).toContain('simulatorContinuity.reason');
  });

  test('no-start setup preserves real map display while keeping setup controls visible', () => {
    const mapState = read('src/features/activitySimulator/simulatorMapState.ts');
    const hike = read('src/screens/HikingScreen.tsx');
    const run = read('src/screens/RunningScreen.tsx');
    const panel = read('src/features/activitySimulator/ActivitySimulatorPanel.tsx');
    expect(mapState).toContain('args.acceptedPosition');
    expect(mapState).toContain("args.providerSource === 'simulator'");
    expect(mapState).toContain("args.trackingStatus !== 'idle'");
    expect(mapState).not.toContain('args.controlsVisible && args.startConfigured');
    expect(hike).toContain('simulatorControlsEnabled={showSimulator}');
    expect(hike).toContain("status === 'idle' || simulatorPickerMode !== null");
    expect(hike).toContain('simulatorEnabled={hikeCameraContract.simulatorEnabled}');
    expect(run).toContain('userPos={mapDisplayPosition}');
    expect(run).toContain("status === 'idle' || simulatorPickerMode !== null");
    expect(panel).toContain('actions.setPickerMode(\'reacquire\')');
    expect(panel).toContain('actions.setPickerMode(\'destination\')');
    expect(panel).toContain('模拟起点');
    expect(panel).toContain('从这里开始');
    expect(panel).toContain('自动前往');
    expect(panel).toContain('activity-simulator-speed-controls');
    expect(panel).toContain('时间倍率');
    expect(panel).toContain('地形');
    expect(panel).toContain('GPS 状态');
    expect(panel).toContain('设置虚拟位置');
    expect(panel).toContain("'simulator_manual_virtual_position_set'");
  });

  test('native readiness and end-to-end sample diagnostics are visible only in expanded SIM', () => {
    const panel = read('src/features/activitySimulator/ActivitySimulatorPanel.tsx');
    const hikeMap = read('src/screens/HikingMap.tsx');
    const run = read('src/screens/RunningScreen.tsx');
    const engine = read('src/features/activitySimulator/activitySimulatorEngine.ts');
    expect(panel).toContain('activity-simulator-native-diagnostics');
    expect(panel).toContain('styleLoaded');
    expect(panel).toContain('lastGeneratedSample');
    expect(panel).toContain('lastAcceptedSample');
    expect(panel).toContain('lastRejectionReason');
    expect(hikeMap).toContain('onDidFinishLoadingStyle');
    expect(hikeMap).toContain('onMapIdle');
    expect(hikeMap).toContain('onMapLoadingError');
    expect(run).toContain('<HikingMap');
    expect(engine).toContain('recordGeneratedSample');
    expect(engine).toContain('const decision = await sink(sample)');
    expect(engine).toContain('recordDecision');
  });

  test('native joystick owns its hold lifecycle until release', () => {
    const panel = read('src/features/activitySimulator/ActivitySimulatorPanel.tsx');
    expect(panel).toContain('applyJoystickPoint(event.nativeEvent.locationX, event.nativeEvent.locationY)');
    expect(panel).toContain("'joystick_termination_requested'");
    expect(panel).toContain('return false;');
    expect(panel).toContain('onShouldBlockNativeResponder: () => true');
    expect(panel).toContain('pointerEvents="box-only"');
    expect(panel).toContain('setJoystickActive(true)');
    expect(panel).toContain('releaseJoystick()');
  });

  test('runtime exposes fast replay and truthful Simulator GPS states without changing real GPS health', () => {
    const panel = read('src/features/activitySimulator/ActivitySimulatorPanel.tsx');
    const hike = read('src/screens/HikingScreen.tsx');
    const run = read('src/screens/RunningScreen.tsx');
    expect(panel).toContain('([1, 5, 10, 30, 60, 120] as SimulatorTimeScale[])');
    expect(panel).toContain("SIM · {timeScale}×");
    expect(panel).toContain("normal: '正常', poor: '较差', lost: '丢失', frozen: '卡住'");
    expect(hike).toContain("locationProviderSource === 'simulator'");
    expect(hike).toContain("simulatorSignal === 'poor' ? Colors.severityWarning");
    expect(run).toContain("simulatorSignal === 'lost' ? Colors.danger");
    expect(run).toContain(": gpsFixHealthy ? runTheme.iconActive : runTheme.iconInactive");
  });

  test('Hike recenter and Run follow use the provider-selected accepted display position', () => {
    const hikeMap = read('src/screens/HikingMap.tsx');
    const run = read('src/screens/RunningScreen.tsx');
    expect(hikeMap).toContain('const cur = simulatorEnabled ? userPos');
    expect(run).toContain('userPos={mapDisplayPosition}');
    expect(run).toContain('simulatorEnabled={simulatorLocationAuthoritative}');
  });
});
