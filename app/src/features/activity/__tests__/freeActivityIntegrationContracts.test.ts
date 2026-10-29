import fs from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(__dirname, '../../../..');
const read = (relative: string) => fs.readFileSync(path.join(appRoot, relative), 'utf8');

describe('Free Activity integration contracts', () => {
  test('Home discovers one user-scoped registry entry and resumes its exact ID', () => {
    const source = read('src/screens/HomeScreen.tsx');
    expect(source).toContain('getUnfinishedActivity(userId)');
    expect(source).toContain('clientActivityId: unfinished.clientActivityId');
    expect(source).toContain('{ recoverClientActivityId: activity.clientActivityId }');
    expect(source).not.toContain('restoreRecoverableActivity(activity)');
    expect(source).toContain('recoveryLookupGenerationRef');
  });

  test.each(['HikingScreen.tsx', 'RunningScreen.tsx'])('%s blocks Start with the shared unfinished resolution surface', file => {
    const source = read(`src/screens/${file}`);
    expect(source).toContain('unfinishedResolutionRequested');
    expect(source).toContain('<UnfinishedRecoveryModal');
    expect(source).toContain('saveRecoverableActivity');
    expect(source).toContain('discardRecoverableActivity');
  });

  test.each(['HikingScreen.tsx', 'RunningScreen.tsx'])('%s recovery Save resets Detail over Trails Activities', file => {
    const source = read(`src/screens/${file}`);
    const recoverySave = source.slice(source.indexOf('onSave={async () =>'), source.indexOf('onDiscard={async () =>'));
    expect(recoverySave).toContain('CommonActions.reset');
    expect(recoverySave).toContain("{ name: 'Routes', params: { initialTab: 'activities' } }");
    expect(recoverySave).toContain("{ name: 'MapHistory', params: { sessionId:");
  });

  test.each(['HikingScreen.tsx', 'RunningScreen.tsx'])('%s successful Finish resets one Detail over Trails Activities', file => {
    const source = read(`src/screens/${file}`);
    expect(source).toContain('<StopSummarySheet');
    expect(source).toContain('onViewActivity');
    expect(source).toMatch(/finishResult(?:\?\.|\.)status (?:===|!==) 'saved-local'/);
    expect(source).toContain('finishResult.clientActivityId');
    expect(source).not.toContain('useSessionStore.getState().sessions.find');
    expect(source).toContain('CommonActions.reset');
    expect(source).toContain("{ name: 'Routes', params: { initialTab: 'activities' } }");
    expect(source).toContain("{ name: 'MapHistory', params: { sessionId:");
    expect(source).not.toContain('openCommittedDetail');
  });

  test('recovery is exact-ID, creates a process gap, and does not impose a 72-hour expiry', () => {
    const source = read('src/features/activity/activityRecovery.ts');
    expect(source).toContain('meta.session_id === exactId');
    expect(source).toContain('!terminalIds.has(meta.session_id)');
    expect(source).toContain("pendingSegmentStartReason: 'process-recovery'");
    expect(source).not.toMatch(/72\s*\*\s*60\s*\*\s*60/);
  });

  test('normal Finish and recovery Save import the same save authority', () => {
    const store = read('src/store/useTrackingStore.ts');
    const recovery = read('src/features/activity/activityRecovery.ts');
    const modal = read('src/components/UnfinishedRecoveryModal.tsx');
    expect(store).toContain('saveEligibility(');
    expect(recovery).toContain("import('./activityContracts')).saveEligibility");
    expect(modal).toContain('disabled={data.saveEligible === false || actionPending}');
    expect(modal).toContain('disabled={actionPending}');
  });

  test('borrowed friend Route geometry is durable only for unfinished Activity recovery', () => {
    const store = read('src/store/useTrackingStore.ts');
    const registry = read('src/features/activity/activityRegistry.ts');
    const recovery = read('src/features/activity/activityRecovery.ts');
    expect(store).toContain('borrowedRouteReference: captureBorrowedRouteForRecovery()');
    expect(registry).toContain('borrowedRouteReference?: ActivityRouteReference');
    expect(recovery).toContain('publishRecoveredBorrowedRoute(activity.borrowedRouteReference)');
    expect(recovery).toContain('publishRecoveredBorrowedRoute();');
    expect(store).toContain("await clearActivityRouteReferenceAfterTerminal('finished')");
    expect(store).toContain("await clearActivityRouteReferenceAfterTerminal('discarded')");
    expect(store).toContain('clearActivityRouteReferenceForAccountBoundary()');
    expect(store).toContain('await finalizeBorrowedRouteUse(reference.borrowedUse, terminal)');
  });

  test('a failed durable completion remains paused and explains that Save did not complete', () => {
    const source = read('src/store/useTrackingStore.ts');
    const catalog = read('src/i18n/cairnText.ts');
    const failure = source.slice(
      source.indexOf('if (!durableSaveCommitted)'),
      source.indexOf('if (remoteId)', source.indexOf('if (!durableSaveCommitted)')),
    );
    // REVISE_WITH_REASON: app-owned copy now has one authority in cairnText.ts;
    // keep this contract on both the stable key wiring and its en-NZ source.
    expect(failure).toContain("cairnText('use-tracking-store.activity-not-saved')");
    expect(catalog).toContain("'use-tracking-store.activity-not-saved':");
    expect(catalog).toContain("'en-NZ': 'Activity not saved'");
    expect(failure).toContain("status: 'paused'");
    expect(failure).toContain("status: 'recoverable-failure'");
    expect(failure).toContain("reason: 'local-commit-failed'");
  });

  test('Run Finish confirmation preserves lifecycle instead of pausing and guessing on Cancel', () => {
    const source = read('src/screens/RunningScreen.tsx');
    const open = source.slice(source.indexOf('const openSaveSheet'), source.indexOf('const closeSaveSheet'));
    const close = source.slice(source.indexOf('const closeSaveSheet'), source.indexOf('async function handleStart'));
    expect(open).not.toContain('pauseTracking()');
    expect(close).not.toContain('resumeTracking()');
    expect(source).toContain('committedRunActivityId');
    expect(source).toContain('runStopSummaryPresentation');
    expect(source).not.toContain('Run Complete');
    expect(source).not.toMatch(/setRunState\(['"]complete/);
  });

  test('Hike Finish confirmation also leaves Recording or Paused untouched', () => {
    const source = read('src/screens/HikingScreen.tsx');
    const open = source.slice(source.indexOf('const handleFinishHike'), source.indexOf('if (!activitySessionVisible)'));
    const cancel = source.slice(source.indexOf('onCancel={() =>'), source.indexOf('onDiscard={async'));
    expect(open).not.toContain('await pauseTracking()');
    expect(cancel).not.toContain('resumeTracking()');
    expect(source).toContain('finishLifecycleBeforeSummary');
  });

  test('transition chrome shows truthful Resuming state while keeping Finish enabled', () => {
    const chrome = read('src/components/activity/ActivityRecordingChrome.tsx');
    const catalog = read('src/i18n/cairnText.ts');
    expect(chrome).toContain("phase: 'tracking' | 'paused' | 'resuming' | 'pausing' | 'finishing'");
    // REVISE_WITH_REASON: verify the state-to-key mapping without restoring a
    // second English authority beside the localized callsite.
    expect(chrome).toContain("phase === 'resuming' ? cairnText('activity.activity-recording-chrome.resuming')");
    expect(catalog).toContain("'activity.activity-recording-chrome.resuming':");
    expect(catalog).toContain("'en-NZ': 'Resuming…'");
    const finishControl = chrome.slice(chrome.indexOf('onPress={onFinish}'), chrome.indexOf('</TouchableOpacity>', chrome.indexOf('onPress={onFinish}')));
    expect(finishControl).toContain('disabled={finishing}');
    expect(finishControl).not.toContain('transitioning');
  });

  test('accepted foreground points require Activity and ownership-generation identity', () => {
    const source = read('src/store/useTrackingStore.ts');
    expect(source).toMatch(/before\.status !== 'tracking'\s*\|\| before\.isFinishing/);
    expect(source).toContain('owned.clientActivityId !== before.sessionId');
    expect(source).toContain('owned.ownerGeneration !== before.liveOwnerGeneration');
    const durable = source.indexOf('await appendHikePoint({', source.indexOf('addTrackPoint: async'));
    const publish = source.indexOf('...acceptedTransition', durable);
    expect(durable).toBeGreaterThan(0);
    expect(publish).toBeGreaterThan(durable);
  });

  test('native receipt is captured before the ingest queue and Memory cannot delay the next accepted fix', () => {
    const source = read('src/store/useTrackingStore.ts');
    const ingest = source.slice(
      source.indexOf('addTrackPoint: async'),
      source.indexOf('linkMarker:', source.indexOf('addTrackPoint: async')),
    );
    expect(ingest.indexOf('const receiptWallTimeMs')).toBeGreaterThanOrEqual(0);
    expect(ingest.indexOf('await previousIngest')).toBeGreaterThan(ingest.indexOf('const receiptWallTimeMs'));
    expect(ingest).toContain('const responsibility = scheduleActivityMemoryProjection({');
    expect(ingest).not.toContain('await scheduleActivityMemoryProjection({');
    expect(ingest.indexOf("stage: 'store-published'"))
      .toBeLessThan(ingest.indexOf('const responsibility = scheduleActivityMemoryProjection({'));
    expect(ingest).toContain("status: 'wal-discovery-required'");
  });

  test('Activity duration is lifecycle-clocked and accepted GPS points do not own timer progress', () => {
    const source = read('src/store/useTrackingStore.ts');
    const ingest = source.slice(source.indexOf('addTrackPoint: async'), source.indexOf('linkMarker:', source.indexOf('addTrackPoint: async')));
    expect(source).toContain('calculateLifecycleDurationMs({');
    expect(source).toContain('startActivityLifecycleTimer(localSessionId)');
    expect(source).toContain('const finalDurationS = Math.max(0, Math.floor(s.durationS))');
    expect(ingest).not.toMatch(/durationS:\s*s\.durationS\s*\+/);
    expect(source).toContain('activityLifecycleInterval = setInterval(tick, 1_000)');
  });

  test('debug-off Activity does not own diagnostic battery or minute timers', () => {
    const source = read('src/store/useTrackingStore.ts');
    expect(source).toContain("locationProviderSource === 'real' && useSettingsStore.getState().debugMode");
    expect(source).toContain('if (useSettingsStore.getState().debugMode) {\n        void batteryMonitor.start()');
  });

  test('Finish commits locally before a bounded immediate server acknowledgement wait', () => {
    const source = read('src/store/useTrackingStore.ts');
    const durable = source.indexOf("recordSavePhase('local_durable_completion'");
    const server = source.indexOf('IMMEDIATE_SERVER_SAVE_BUDGET_MS', durable);
    expect(durable).toBeGreaterThan(0);
    expect(server).toBeGreaterThan(durable);
    expect(source).toContain('const IMMEDIATE_SERVER_SAVE_BUDGET_MS = 4_000');
    expect(source).not.toContain('v412 wall-clock timeout 20s');
  });

  test('always-online failure and reconnect both wake the durable Activity worker', () => {
    const tracking = read('src/store/useTrackingStore.ts');
    const app = read('App.tsx');
    const immediate = tracking.slice(
      tracking.indexOf('if (durableSaveCommitted && !serverSaveAcknowledged)'),
      tracking.indexOf('// Public encounter qualification', tracking.indexOf('if (durableSaveCommitted && !serverSaveAcknowledged)')),
    );
    expect(immediate).toContain("drainPending({ wakeReason: 'manual', force: true })");
    expect(app).toContain("drainPending({ wakeReason: 'network_online' })");
    expect(app).toContain("drainPending({ wakeReason: 'foreground' })");
  });

  test('Finish durably commits offline Base Final before optional Mapbox reconstruction', () => {
    const source = read('src/store/useTrackingStore.ts');
    const baseCommit = source.indexOf("recordSavePhase('base_final_local_commit'");
    const mapbox = source.indexOf('resolveMapboxPublicTokenAuthority()', baseCommit);
    const reconstruction = source.indexOf('reconstructPedestrianFinalRoute(canonicalInput', mapbox);
    expect(baseCommit).toBeGreaterThan(0);
    expect(mapbox).toBeGreaterThan(baseCommit);
    expect(reconstruction).toBeGreaterThan(mapbox);
    expect(source.slice(0, mapbox)).toContain('activity_base_final_committed');
  });

  test('a slow pre-Finish WAL append cannot publish after the immutable completion snapshot', () => {
    const source = read('src/store/useTrackingStore.ts');
    const snapshotClosed = source.indexOf('finishAcceptanceSnapshotClosed = true');
    const completionSnapshot = source.indexOf('const s = get();', snapshotClosed);
    const postJournalGuard = source.indexOf('(current.isFinishing && finishAcceptanceSnapshotClosed)');
    expect(snapshotClosed).toBeGreaterThan(source.indexOf('await settleWithin(pointIngestTail.then'));
    expect(completionSnapshot).toBeGreaterThan(snapshotClosed);
    expect(postJournalGuard).toBeGreaterThan(completionSnapshot);
  });

  test('rejected real fixes advance only the raw reducer watermark, never the accepted continuity anchor', () => {
    const source = read('src/store/useTrackingStore.ts');
    for (const reason of ['poor-accuracy', 'stationary-suppressed', 'indoor-drift-suppressed']) {
      const start = source.indexOf(`acceptance.reason = '${reason}'`);
      const end = source.indexOf('\n        }', start);
      const branch = source.slice(start, end);
      expect(start).toBeGreaterThan(0);
      expect(branch).toContain('lastFixTimestamp: isSimulatorSample ? t : s.lastFixTimestamp');
      expect(branch).not.toContain('lastCoordinateTime: t');
    }
    for (const reason of ['hiking-overspeed']) {
      const start = source.indexOf(`acceptance.reason = '${reason}'`);
      const end = source.indexOf('\n        }', start);
      const branch = source.slice(start, end);
      expect(start).toBeGreaterThan(0);
      expect(branch).toContain('lastFixTimestamp: t');
      expect(branch).not.toContain('lastCoordinateTime: t');
    }
    // The real-GPS reducer owns its raw-observation watermark. This source-level
    // guard is intentionally limited to the store invariant above; reducer
    // watermark behavior is covered behaviorally by realGpsContinuity.test.ts.
  });

  test('late journaled background points drain at ownership fences without a polling timer', () => {
    const source = read('src/store/useTrackingStore.ts');
    const handoff = source.slice(
      source.indexOf('async function transitionToForegroundSource'),
      source.indexOf('async function activateBackgroundSource'),
    );
    expect(source).not.toContain('drainInterval');
    const foregroundActivation = handoff.indexOf('await activateForegroundSource(expectedIntentEpoch, operationIsCurrent)');
    const deferredDrain = handoff.indexOf("? drainCommittedBackgroundLocations('foreground')");
    expect(foregroundActivation).toBeGreaterThan(0);
    expect(deferredDrain).toBeGreaterThan(0);
    expect(deferredDrain).toBeLessThan(foregroundActivation);
    expect(handoff).toContain('historyProjectionStartedBeforeActivation: true');
    expect(handoff).toContain('providerActivationParallel: true');
    expect(source).toContain("await drainCommittedBackgroundLocations('pause-fence')");
    expect(source).toContain("await drainCommittedBackgroundLocations('finish-fence')");
    expect(source).toContain('A queued raw receipt may refresh source-health immediately');
    expect(source).toContain('latestSourceCoordinate: presentationTail ?');
    expect(source).not.toContain('lat: retained.latitude');
  });

  test('real background ownership refreshes native authorization and never trusts a hardcoded grant', () => {
    const tracking = read('src/store/useTrackingStore.ts');
    const authorization = read('src/features/activity/backgroundAuthorization.ts');
    expect(tracking).toContain('await refreshRealBackgroundAuthorization(true, {');
    expect(tracking).not.toContain('refreshRealBackgroundAuthorization(!hasSeenBackgroundEducation)');
    expect(tracking).toContain('const authorization = await refreshRealBackgroundAuthorization(false)');
    expect(tracking).toContain('const granted = authorization.granted');
    expect(tracking).toContain('refreshBackgroundLocationPermission: async () =>');
    expect(authorization).toContain('await provider.getBackgroundPermissionsAsync()');
    expect(authorization).toContain("current.granted || !options.requestIfEligible || !current.canAskAgain");
    expect(authorization).not.toMatch(/granted:\s*true\s*[,}]/);
  });

  test('real lifecycle treats inactive as transient and coalesces by owner state', () => {
    const tracking = read('src/store/useTrackingStore.ts');
    const lifecycle = read('src/features/activity/activityLocationLifecycle.ts');
    const closureQa = read('scripts/hike-run-client-backend-closure-qa.mjs');
    expect(tracking).toContain('enqueueRealLocationLifecycleTransition(nextState)');
    expect(lifecycle).toContain("appState === 'inactive'");
    expect(lifecycle).toContain("action: 'hold-transient-inactive'");
    expect(lifecycle).toContain("action: 'keep-current-owner'");
    expect(tracking).not.toContain("markRecordingContinuityUnavailable('inactive'");
    expect(tracking).toContain('lifecycleTransitionProcessed');
    expect(closureQa).toContain('entry.lifecycleTransitionProcessed === true');
    expect(closureQa).toContain("entry.lifecyclePlanAction === 'keep-current-owner'");
  });

  test('M4 closure cannot pass without a completed real provider decision and non-degenerate fingerprint proof', () => {
    const closureQa = read('scripts/hike-run-client-backend-closure-qa.mjs');
    expect(closureQa).toContain("revision.job?.status === 'complete'");
    expect(closureQa).toContain('revision.job?.matchingAttempted === true');
    expect(closureQa).toContain('revision.job?.governorAuthorized === true');
    expect(closureQa).toContain("entry.kind === 'response' && entry.status >= 200 && entry.status < 400");
    expect(closureQa).not.toContain('?? artifact?.canonicalFingerprint ?? null');
  });

  test('a timed-out native activation releases recovery behind a generation fence', () => {
    const source = read('src/store/useTrackingStore.ts');
    const queue = read('src/features/activity/activityActivationQueue.ts');
    expect(source).toContain('createActivityActivationQueue({');
    expect(source).toContain("eventCode: 'ACTIVITY_ACTIVATION_TIMEOUT'");
    expect(queue).toContain('const boundedSettlement = Promise.race([');
    expect(queue).toContain('chain = boundedSettlement');
    expect(queue).toContain('isCurrent: () => operationGeneration === generation');
    expect(queue).toContain('void actualSettlement');
  });

  test('foreground and background request one fixed precision policy without a sampling state machine', () => {
    const tracking = read('src/store/useTrackingStore.ts');
    expect(tracking.match(/accuracy: Location\.Accuracy\.BestForNavigation/g)).toHaveLength(2);
    expect(tracking.match(/distanceInterval: realForegroundCadenceExperiment\.distanceFilterM/g)).toHaveLength(2);
    expect(tracking).not.toContain('shouldRestartForegroundForNominalIntervalChange');
    expect(tracking).not.toContain('samplingEvaluationInterval');
  });

  test('foreground presentation retains a verified persistent native Task source', () => {
    const source = read('src/store/useTrackingStore.ts');
    const foreground = source.slice(
      source.indexOf('async function activateForegroundSource'),
      source.indexOf('function deactivateForegroundSource'),
    );
    const transition = source.slice(
      source.indexOf('async function transitionToForegroundSource'),
      source.indexOf('async function activateBackgroundSource'),
    );
    expect(foreground).not.toContain('stopRealBackgroundSourceForHandoff');
    expect(foreground).toContain('if (backgroundTaskActive || !intentIsCurrent()) return');
    expect(transition).toContain('await activateBackgroundSource(expectedIntentEpoch, operationIsCurrent)');
    expect(source).toContain('setActivityTaskForegroundProjectionWake((wakeOwner) =>');
    expect(source).toContain("await drainCommittedBackgroundLocations('foreground-live')");
    expect(transition).toContain("drainCommittedBackgroundLocations('foreground')");
  });

  test('temporary background provider unavailability defers truth segmentation to the next observation', () => {
    const source = read('src/store/useTrackingStore.ts');
    const uncertain = source.slice(
      source.indexOf('async function markRecordingContinuityUncertain'),
      source.indexOf('async function drainCommittedBackgroundLocations'),
    );
    // The provider lifecycle alone is not movement evidence. Preserve the
    // trusted tail so a short, plausible reacquisition remains continuous;
    // the shared physical classifier still opens real long/displaced gaps.
    expect(uncertain).toContain('locationAvailable: false');
    expect(uncertain).toContain("decision: 'defer-until-next-observation'");
    expect(uncertain).not.toContain("pendingSegmentStartReason: 'gps-reacquired'");
    expect(uncertain).not.toContain('lastCoordinate: null');
    expect(source).toContain('const physicalGap = shouldStartNewSegment({');
    expect(source).toContain("markRecordingContinuityUncertain('background-provider-unavailable')");
  });

  test('Finish uses one versioned Final artifact for local and server detail', () => {
    const source = read('src/store/useTrackingStore.ts');
    expect(source).toContain('const finalDisplayTrackPoints = finalArtifact.points');
    expect(source).toContain('const v412Route3 = finalDisplayTrackPoints.map');
    expect(source).toContain('trackPoints: finalDisplayTrackPoints');
    expect(source).toContain('finalGeometryRevision: finalArtifact.revision');
    expect(source).toContain('displayFingerprint: finalArtifact.displayFingerprint');
    expect(source).toContain("algorithmVersion: 'pedestrian-final-v2-base'");
    expect(read('src/features/activity/activityFinalArtifact.ts'))
      .toContain("'pedestrian-final-v4-road-fillet'");
    // A safe validated local/canonical result may replace Base even when no
    // network candidate refined the display; displayRefined is descriptive,
    // not a veto on the chosen fallback.
    expect(source).not.toContain('!snapRes.stats.displayRefined');
    expect(source).toContain('snapRes.stats.canonicalFallbackDistanceM');
    expect(source).toContain("endpointDecision: 'atomic-canonical-boundary'");
    expect(source).not.toContain('snappedTrackPoints ?? (s.trackPointsSmoothed');
  });

  test('Final matching remains segment-local and Memory remains canonical', () => {
    const source = read('src/store/useTrackingStore.ts');
    expect(source).toContain('const canonicalSegments = segmentTrace(s.trackPoints).segments');
    expect(source).toContain('const sourceSegments = canonicalSegments');
    expect(source).toContain('const snapRes = await reconstructPedestrianFinalRoute(canonicalInput');
    expect(source).toContain('for (const point of s.trackPoints)');
    expect(source).toContain("source: 'simulator_test'");
    expect(source).toContain("source: 'activity_real'");
    expect(source).toContain('if (isSimulatorSample)');
    expect(source).not.toContain('for (const point of finalDisplayTrackPoints)');
  });

  test('live Hike and Run traces render the bounded causal accepted-route presentation', () => {
    const hike = read('src/screens/HikingScreen.tsx');
    const run = read('src/screens/RunningScreen.tsx');
    expect(hike).toContain("const liveTrackPoints = locationProviderSource === 'real'");
    expect(hike).toContain("|| (locationProviderSource === 'simulator' && simulatorObservationMode === 'raw-gps')");
    expect(hike).toContain('? trackPointsSmoothed');
    expect(hike).not.toContain('const liveMapTrackPoints = useMemo(');
    expect(hike).toContain('trackPoints={activitySessionVisible ? liveTrackPoints : []}');
    expect(run).toContain("const liveTrackPoints = locationProviderSource === 'real'");
    expect(run).toContain("|| (locationProviderSource === 'simulator' && simulatorObservationMode === 'raw-gps')");
    expect(run).toContain('? trackPointsSmoothed');
    expect(run).toContain('trackPoints={liveTrackPoints}');
  });

  test('one-source confirmed route animation is presentation-only and cancels outside active foreground tracking', () => {
    const map = read('src/screens/HikingMap.tsx');
    // Native animation behavior cannot be certified by Jest. This structural
    // guard protects the integration boundary while pure segmentation and
    // bounded-tail outcomes are tested behaviorally.
    expect(map).toContain('new AnimatedCoordinatesArrayClass(coordinatesValue)');
    expect(map).toContain('planContinuousRouteTarget(coordinates, stableCountRef.current)');
    // The semantic prefix remains stable, while the style generation forces
    // RNMapbox to recreate the source/layers after native style loss.
    expect(map).toContain('id={`track-confirmed-continuous-style-${routeStyleGeneration}`}');
    expect(map).not.toContain('id="track-confirmed-head"');
    expect(map).not.toContain('id="track-confirmed-body"');
    expect(map).toContain("mapAppState === 'active'");
    expect(map).toContain("trackingStatus === 'tracking'");
    expect(map).toContain('&& !reduceMotion');
    expect(map).toContain('Mapbox.CustomLocationProvider');
    expect(map).toContain('<CustomLocationProviderComponent');
    expect(map).toContain("trackingStatus === 'idle'");
    expect(map).toContain("trackingStatus === 'paused'");
    expect(map).toContain('followUserLocation={!instantCamera && followUser && realUserLocationActive}');
    expect(map).toContain("coordinateSource: 'none'");
    expect(map).not.toContain('useTrackingStore.setState({ animated');
  });

  test('real GPS UI wires source freshness separately from canonical-route freshness', () => {
    const hike = read('src/screens/HikingScreen.tsx');
    const run = read('src/screens/RunningScreen.tsx');
    for (const source of [hike, run]) {
      // Structural guard: the pure health behavior is covered in
      // activityLocationHealth.test; this verifies both screens actually
      // supply the independent provider and canonical clocks to it.
      expect(source).toContain('deriveActivityLocationHealth({');
      expect(source).toContain('latestSourceTimestamp: latestSourceLocationTime');
      expect(source).toContain('latestCanonicalTimestamp: lastTrackT');
      expect(source).toContain("userFacingIssue === 'sustained-route-unreliable'");
      expect(source).not.toContain("? 'Checking route'");
      expect(source).not.toContain('GPS accuracy ±');
    }
  });

  test('foreground recovery reuses the one fenced watcher instead of opening a one-shot client', () => {
    const source = read('src/store/useTrackingStore.ts');
    const foreground = source.slice(
      source.indexOf('async function activateForegroundSource'),
      source.indexOf('function deactivateForegroundSource'),
    );
    expect(source).not.toContain('getCurrentPositionAsync');
    expect(foreground).toContain('clientActivityId: ownerSessionId');
    expect(foreground).toContain('ownerGeneration');
  });

  test('remote Start is downstream of local registry, WAL and active GPS authority', () => {
    const source = read('src/store/useTrackingStore.ts');
    const start = source.slice(
      source.indexOf('startTracking: async'),
      source.indexOf('stopTracking: async'),
    );
    const registry = start.indexOf('await registerUnfinishedActivity');
    const lease = start.indexOf('await persistBackgroundContext(get().sessionId');
    const journal = start.indexOf('await startHikeTrack(sid');
    const sourceActivation = start.indexOf('await activateForegroundSource()');
    const tracking = start.indexOf("status: 'tracking'");
    const remote = start.indexOf("scheduleRemoteSessionStart(get, set, 'local-start')");
    expect(registry).toBeGreaterThan(0);
    expect(registry).toBeLessThan(lease);
    expect(lease).toBeLessThan(journal);
    expect(journal).toBeLessThan(sourceActivation);
    expect(sourceActivation).toBeLessThan(tracking);
    expect(tracking).toBeLessThan(remote);
    expect(start).not.toContain('await startSessionResolved');
    expect(source).toContain('persistServerMapping: serverActivityId => mapActivityServerId');
    expect(source).toContain("mappingTarget === 'tombstoned'");
  });

  test('Hike and Run use the same terminal-aware Start error presentation', () => {
    const shared = read('src/components/activity/ActivityRecordingChrome.tsx');
    const catalog = read('src/i18n/cairnText.ts');
    const hike = read('src/screens/HikingScreen.tsx');
    const run = read('src/screens/RunningScreen.tsx');
    expect(shared).toContain('activityStartErrorMessage');
    // REVISE_WITH_REASON: the shared helper owns the stable key; the catalog
    // owns the exact source copy.
    expect(shared).toContain("cairnText('activity.activity-recording-chrome.your-previous-activity-is-safely-saved-and')");
    expect(catalog).toContain("'activity.activity-recording-chrome.your-previous-activity-is-safely-saved-and':");
    expect(catalog).toContain("'en-NZ': 'Your previous Activity is safely saved and still syncing. Try again when sync completes.'");
    expect(hike).toContain('startError={activityStartErrorMessage(startError)}');
    expect(run).toContain('startError={activityStartErrorMessage(startError)}');
  });

  test('late point-upload responses cannot advance a newer Activity upload cursor', () => {
    const source = read('src/store/useTrackingStore.ts');
    expect(source.match(/current\.sessionId === ownerSessionId/g)?.length).toBeGreaterThanOrEqual(1);
    expect(source.match(/liveOwnerGeneration === ownerGeneration/g)?.length).toBeGreaterThanOrEqual(2);
    const finalFlush = source.slice(
      source.indexOf('session:final-flush count='),
      source.indexOf('// v333:', source.indexOf('session:final-flush count=')),
    );
    expect(finalFlush).not.toContain('lastFlushedIdx =');
  });

  test('headless background samples are durably written before entering the live queue', () => {
    const source = read('src/services/backgroundLocationTask.ts');
    const write = source.indexOf('await appendDirectlyToHikeTrack');
    const queue = source.indexOf('pendingBackgroundLocations.push');
    expect(write).toBeGreaterThan(0);
    expect(queue).toBeGreaterThan(write);
    expect(source).toContain('ownerGeneration');
    expect(source).toContain('shouldStartNewSegment');
  });

  test('committed Cairn outbox includes stable identity provenance before UI cache', () => {
    const source = read('src/store/useMarkerStore.ts');
    const payload = source.indexOf('const payload: MarkerCreatePayload');
    const durableSave = source.indexOf('await offlineMarkers.saveLocal(payload, ownerId)', payload);
    const cacheWrite = source.indexOf('storage.setItem(storageKey(ownerId)', durableSave);
    expect(payload).toBeGreaterThan(-1);
    expect(durableSave).toBeGreaterThan(payload);
    expect(cacheWrite).toBeGreaterThan(durableSave);
    expect(source.slice(payload, durableSave)).toContain('originActivityClientId: activeActivityClientId');
  });

  test('movement owns Memory evidence and Plant cannot reveal unexplored terrain', () => {
    const tracking = read('src/store/useTrackingStore.ts');
    const cairns = read('src/store/useMarkerStore.ts');
    const passive = read('src/features/memory/components/PassiveMemoryRecorder.tsx');
    for (const source of [tracking, passive]) expect(source).toContain('recordMemoryEvidence');
    expect(cairns).not.toContain('recordMemoryEvidence');
    expect(passive).toContain("status === 'idle' || status === 'paused'");
  });

  test('fresh-user automatic exploration defaults on while Activity capture remains independent', () => {
    const settings = read('src/features/memory/store/useMemorySettingsStore.ts');
    const ui = read('src/screens/SettingsScreen.tsx');
    const catalog = read('src/i18n/cairnText.ts');
    expect(settings).toMatch(/passiveExplorationEnabled:\s*true/);
    expect(settings).toContain('passiveExplorationContractVersion: 6');
    expect(settings).toContain('automaticExplorationDisclosureVersion');
    expect(settings).not.toContain('recordMode:');
    expect(settings).not.toContain('showFriendOverlay:');
    expect(settings).not.toContain('useH3Fog:');
    // REVISE_WITH_REASON: count the shared stable key at both surfaces and
    // keep exact English solely in the catalog.
    expect(ui.match(/title=\{cairnText\('settings-screen\.automatic-exploration'\)\}/g)).toHaveLength(2);
    expect(ui).not.toContain("title={cairnText('settings-screen.automatic-exploration-encounters')}");
    expect(ui).toContain("cairnText('settings-screen.off-ordinary-app-use-does-not-record')");
    expect(catalog).toContain("'en-NZ': 'Off · ordinary app use does not record exploration or scan for encounters; Hike and Run still work'");
  });

  test('background task publishes activation last, clears it first, and requires exact owner identity', () => {
    const source = read('src/services/backgroundLocationTask.ts');
    const persistence = source.slice(source.indexOf('export async function persistBackgroundContext'), source.indexOf('// Singleton queue'));
    expect(persistence.indexOf("STORAGE_KEY_ACTIVITY_CONTEXT, JSON.stringify(context)")).toBeLessThan(persistence.indexOf("STORAGE_KEY_HIKE_ACTIVE, '1'"));
    expect(persistence.indexOf("STORAGE_KEY_HIKE_ACTIVE, '0'")).toBeLessThan(persistence.indexOf('removeItem(STORAGE_KEY_ACTIVITY_CONTEXT)'));
    expect(source).toContain('activeSid !== context.clientActivityId');
    expect(source).toContain('appendBackgroundHikePoints(accepted, context.userId)');
  });

  test('emergency Save payload is user-scoped and logout hides rather than deletes it', () => {
    const tracking = read('src/store/useTrackingStore.ts');
    const app = read('src/store/useAppStore.ts');
    expect(tracking).toContain('cairn_saf01_payload:${userId}');
    expect(tracking).toContain('payloadUserId !== currentUserId');
    expect(tracking.match(/stillOwnsHydration\(\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(tracking).toContain('fromLegacy');
    expect(app).toContain('logout:saf01_hidden');
    expect(app).not.toContain("removeItem('cairn_saf01_payload')");
  });

  test('orphaned pending Activity reconstruction is scoped to the authenticated user', () => {
    const app = read('src/store/useAppStore.ts');
    const intentBlock = app.slice(app.indexOf('const ownedIntents ='), app.indexOf('for (const h of ownedIntents)'));
    expect(intentBlock).toContain("String(h.userId ?? '') === String(user.id)");
  });

  test('logout snapshots Memory before clearing the outgoing user store', () => {
    const app = read('src/store/useAppStore.ts');
    const detach = app.indexOf('await detachMemoryPersistence()');
    const reset = app.indexOf('useMemoryStore.getState().resetForUserSwitch()', detach);
    expect(detach).toBeGreaterThan(0);
    expect(reset).toBeGreaterThan(detach);
  });

  test('Memory durable commit uses strict storage and captures account ownership before queueing', () => {
    const persistence = read('src/features/memory/services/memoryPersistence.ts');
    const evidence = read('src/features/memory/services/recordMemoryEvidence.ts');
    expect(persistence).toContain('serialized = JSON.stringify(serialize(merged.points, snapshot.initialRevealDone))');
    expect(persistence).toContain('storage.setItem(storageKey(userId), serialized, { strict: true })');
    expect(evidence.indexOf('const ownerUserId')).toBeLessThan(evidence.indexOf('const run = commitTail.then'));
    expect(evidence).toContain("throw new Error('memory_owner_changed')");
  });

  test('logout revokes live GPS ownership without tombstoning the unfinished Activity', () => {
    const tracking = read('src/store/useTrackingStore.ts');
    const app = read('src/store/useAppStore.ts');
    const suspend = tracking.slice(
      tracking.indexOf('suspendForUserSwitch: async'),
      tracking.indexOf('discardCurrentSession: async'),
    );
    expect(app.indexOf('suspendForUserSwitch()')).toBeLessThan(app.indexOf("set({ isLoggedIn: false"));
    expect(suspend).toContain('set({ ...initialState');
    expect(suspend).toContain('await flushNow()');
    expect(suspend).not.toContain('tombstoneActivity');
    expect(suspend).not.toContain('discardActiveHike');
  });

  test('server ACK mapping precedes pending removal and per-Activity heavy cleanup', () => {
    const source = read('src/services/syncDaemon.ts');
    const ack = source.indexOf('const registryAcked = await acknowledgeActivity');
    const invokeCleanup = source.indexOf('await cleanupAcknowledgedActivityArtifacts(hike.userId, hike.localId)', ack);
    const helper = source.slice(
      source.indexOf('export async function cleanupAcknowledgedActivityArtifacts'),
      source.indexOf('/**\n * 上传单条 pending。'),
    );
    const remove = helper.indexOf('await removePending(clientActivityId, userId)');
    const cleanup = helper.indexOf('await deleteAcknowledgedHikeTrackArtifacts(clientActivityId, userId)');
    expect(ack).toBeGreaterThan(0);
    expect(invokeCleanup).toBeGreaterThan(ack);
    expect(remove).toBeGreaterThan(0);
    expect(cleanup).toBeGreaterThan(remove);
    expect(helper).not.toContain('removeLocalTrackPoints');
    expect(source).toContain('reconcileAcknowledgedActivityCleanup');
    expect(helper).toContain('await deleteAcknowledgedHikeTrackArtifacts(clientActivityId, userId)');
    expect(helper.indexOf('await removeAcknowledgedActivity')).toBeGreaterThan(cleanup);
  });

  test('Activity sync requires the exact current account before and after network awaits', () => {
    const source = read('src/services/syncDaemon.ts');
    expect(source).toContain("if (!currentUserId || currentUserId === 'guest' || hikeUser !== currentUserId)");
    expect(source.match(/isCurrentActivityOwner\(hike\.userId\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain('new Date(hike.startedAt ?? hike.createdAt).toISOString()');
  });

  test('committed user queues have no terminal retry-drop cap', () => {
    const activity = read('src/services/syncDaemon.ts');
    const cairn = read('src/services/markerOfflineEntities.ts');
    expect(activity).not.toMatch(/attemptCount\s*[>=]{1,2}\s*8[\s\S]{0,120}removePending/);
    expect(cairn).toContain('retainOnPermanentFailure: true');
  });

  test('Cairn outbox sends only the strict marker API fields', () => {
    const cairn = read('src/services/markerOfflineEntities.ts');
    expect(cairn).toContain('never spread');
    expect(cairn).toContain('type, text, lat, lng, alt, permission, approximate, originActivityClientId');
    expect(cairn).not.toContain('...marker,');
  });

  test('Activity Detail renders real segments with true gaps disconnected', () => {
    const source = read('src/screens/MapHistoryScreen.tsx');
    expect(source).toContain('segmentTrace(pts)');
    expect(source).toContain('if (isGap) continue');
    expect(source).not.toContain('track-gap-line');
    expect(source).not.toContain('lineDasharray: [2, 1.5]');
  });

  test('Activity Detail owns a mount-lifetime trace snapshot across sync cleanup', () => {
    const source = read('src/screens/MapHistoryScreen.tsx');
    expect(source).toContain('const detailSessionSnapshots = useRef(new Map');
    expect(source).toContain('const detailTrackSnapshots = useRef(new Map');
    const loader = source.slice(
      source.indexOf('const [loadedTrackPoints'),
      source.indexOf('// Merge loaded track points'),
    );
    expect(loader).toContain('detailTrackSnapshots.current.set(selectedSessionId');
    expect(loader).toContain('detailTrackSnapshots.current.get(selectedSessionId) ?? []');
    expect(loader).toContain('liveSelectedSession?.finalGeometryRevision,');
    expect(loader).toContain('liveSelectedSession?.finalGeometryFingerprint,');
    expect(loader).not.toMatch(/}, \[[^\]]*sessions[^\]]*\]\);/);
  });

  test('a missing Activity target has a Detail-specific degraded state', () => {
    const source = read('src/screens/MapHistoryScreen.tsx');
    const catalog = read('src/i18n/cairnText.ts');
    expect(source).toContain('testID="activity-detail-unavailable"');
    // REVISE_WITH_REASON: assert keys at the branch and exact copy at its one
    // editable authority.
    expect(source).toContain("cairnText('map-history-screen.this-activity-could-not-be-found-in')");
    expect(source).toContain("? cairnText('navigation.back')");
    expect(source).toContain(": cairnText('map-history-screen.back-to-activities')");
    expect(catalog).toContain("'en-NZ': 'This Activity could not be found in local Activity history.'");
    expect(source).toContain('onPress={handleActivityBack}');
  });

  test('Activity Detail uses shared semantic roles across Day, Sunset, and Night', () => {
    const source = read('src/screens/MapHistoryScreen.tsx');
    const detail = source.slice(
      source.indexOf('targetSessionId && selectedSession ?'),
      source.indexOf('testID="activity-detail-unavailable"'),
    );
    for (const role of ['surfaceElevated', 'foreground', 'foregroundSecondary', 'borderSubtle', 'destructive']) {
      expect(detail).toContain(`visualTheme.${role}`);
    }
    expect(detail).toContain('<ModalCard');
    expect(detail).toContain('<PrimaryButton');
  });

  test('Activity Detail creates an independent Route while import preserves real ordered segments', () => {
    const detail = read('src/screens/MapHistoryScreen.tsx');
    const trails = read('src/screens/RoutesScreen.tsx');
    const editor = read('src/screens/OrderedRouteEditorScreen.tsx');
    const catalog = read('src/i18n/cairnText.ts');
    expect(detail).toContain('testID="activity-create-route"');
    expect(detail).toContain("creationSource: 'activity'");
    expect(detail).toContain('fromSessionId: selectedSession.id');
    expect(detail).toContain('creationSessionId: createRouteCreationSessionId()');
    // REVISE_WITH_REASON: keep the independence copy in the catalog while
    // retaining a source-level guard on the exact callsite.
    expect(detail).toContain("cairnText('map-history-screen.creates-a-separate-editable-copy-this-activity')");
    expect(catalog).toContain("'en-NZ': 'Creates a separate editable copy. This Activity and its Memory stay unchanged.'");
    expect(detail).not.toContain('Save as Route');
    expect(trails).toContain("cairnText('routes-screen.use-an-activity')");
    expect(editor).toContain('const segments = segmentTrace(points).segments');
    expect(editor).toContain('createImportedOrderedDraft');
    expect(editor).not.toContain('trace.gaps.flatMap');
  });

  test('discard writes resurrection protection before deleting pending work', () => {
    const source = read('src/features/activity/activityRecovery.ts');
    const tombstone = source.indexOf('await tombstoneActivity');
    const pending = source.indexOf('await removePending', tombstone);
    const remote = source.indexOf('await deleteRemoteSessionByClientId', pending);
    expect(tombstone).toBeGreaterThan(0);
    expect(pending).toBeGreaterThan(tombstone);
    expect(remote).toBeGreaterThan(pending);
  });
});
