import fs from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(__dirname, '../../../..');
const read = (relative: string) => fs.readFileSync(path.join(appRoot, relative), 'utf8');

describe('Free Activity integration contracts', () => {
  test('Home discovers one user-scoped registry entry and resumes its exact ID', () => {
    const source = read('src/screens/HomeScreen.tsx');
    expect(source).toContain('getUnfinishedActivity(userId)');
    expect(source).toContain('clientActivityId: unfinished.clientActivityId');
    expect(source).toContain('restoreRecoverableActivity(activity)');
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
    expect(modal).toContain('disabled={data.saveEligible === false}');
  });

  test('a failed durable completion remains paused and explains that Save did not complete', () => {
    const source = read('src/store/useTrackingStore.ts');
    const failure = source.slice(
      source.indexOf('if (!durableSaveCommitted)'),
      source.indexOf('if (remoteId)', source.indexOf('if (!durableSaveCommitted)')),
    );
    expect(failure).toContain("'Activity not saved'");
    expect(failure).toContain("status: 'paused'");
    expect(failure).toContain('return false');
  });

  test('Run freezes recording before naming and has no separate complete state', () => {
    const source = read('src/screens/RunningScreen.tsx');
    const open = source.slice(source.indexOf('const openSaveSheet'), source.indexOf('const closeSaveSheet'));
    expect(open.indexOf('pauseTracking()')).toBeLessThan(open.indexOf('setShowSaveSheet(true)'));
    expect(source).not.toContain('Run Complete');
    expect(source).not.toMatch(/setRunState\(['"]complete/);
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

  test('Activity duration is lifecycle-clocked and accepted GPS points do not own timer progress', () => {
    const source = read('src/store/useTrackingStore.ts');
    const ingest = source.slice(source.indexOf('addTrackPoint: async'), source.indexOf('linkMarker:', source.indexOf('addTrackPoint: async')));
    expect(source).toContain('calculateLifecycleDurationMs({');
    expect(source).toContain('startActivityLifecycleTimer(localSessionId)');
    expect(source).toContain('const finalDurationS = Math.max(0, Math.floor(s.durationS))');
    expect(ingest).not.toMatch(/durationS:\s*s\.durationS\s*\+/);
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
    expect(handoff).toContain('await drainCommittedBackgroundLocations()');
    expect(source).toContain('await drainCommittedBackgroundLocations(true)');
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
    expect(tracking).toContain('enqueueRealLocationLifecycleTransition(nextState)');
    expect(lifecycle).toContain("appState === 'inactive'");
    expect(lifecycle).toContain("action: 'hold-transient-inactive'");
    expect(lifecycle).toContain("action: 'keep-current-owner'");
    expect(tracking).not.toContain("markRecordingContinuityUnavailable('inactive'");
  });

  test('foreground and background request one fixed precision policy without a sampling state machine', () => {
    const tracking = read('src/store/useTrackingStore.ts');
    expect(tracking.match(/accuracy: Location\.Accuracy\.BestForNavigation/g)).toHaveLength(2);
    expect(tracking.match(/distanceInterval: realForegroundCadenceExperiment\.distanceFilterM/g)).toHaveLength(2);
    expect(tracking).not.toContain('shouldRestartForegroundForNominalIntervalChange');
    expect(tracking).not.toContain('samplingEvaluationInterval');
  });

  test('foreground recovery stops any native-owned background stream before starting its watcher', () => {
    const source = read('src/store/useTrackingStore.ts');
    const foreground = source.slice(
      source.indexOf('async function activateForegroundSource'),
      source.indexOf('function deactivateForegroundSource'),
    );
    const handoff = source.slice(
      source.indexOf('async function stopRealBackgroundSourceForHandoff'),
      source.indexOf('async function transitionToForegroundSource'),
    );
    expect(foreground.indexOf('await stopRealBackgroundSourceForHandoff()')).toBeLessThan(
      foreground.indexOf('Location.watchPositionAsync'),
    );
    expect(handoff).toContain('Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)');
    expect(handoff).toContain('await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)');
  });

  test('known background unavailability opens a new truth segment instead of a connector', () => {
    const source = read('src/store/useTrackingStore.ts');
    const unavailable = source.slice(
      source.indexOf('async function markRecordingContinuityUnavailable'),
      source.indexOf('async function drainCommittedBackgroundLocations'),
    );
    expect(unavailable).toContain("pendingSegmentStartReason: 'gps-reacquired'");
    expect(unavailable).toContain('lastCoordinate: null');
    expect(source).toContain("markRecordingContinuityUnavailable('background-provider-unavailable')");
  });

  test('Finish uses one matched-or-canonical geometry contract for local and server detail', () => {
    const source = read('src/store/useTrackingStore.ts');
    expect(source).toContain('const finalDisplayTrackPoints = snappedTrackPoints ?? s.trackPoints');
    expect(source).toContain('const v412Route3 = finalDisplayTrackPoints.map');
    expect(source).toContain('trackPoints: finalDisplayTrackPoints');
    expect(source).toContain("algorithmVersion: 'pedestrian-final-v1'");
    expect(source).toContain('!snapRes.stats.displayRefined');
    expect(source).toContain('snapRes.stats.canonicalFallbackDistanceM');
    expect(source).toContain("endpointDecision: 'atomic-canonical-boundary'");
    expect(source).not.toContain('snappedTrackPoints ?? (s.trackPointsSmoothed');
  });

  test('Final matching remains segment-local and Memory remains canonical', () => {
    const source = read('src/store/useTrackingStore.ts');
    expect(source).toContain('const sourceSegments = segmentTrace(s.trackPoints).segments');
    expect(source).toContain('const snapRes = await reconstructPedestrianFinalRoute(canonicalInput');
    expect(source).toContain('for (const point of s.trackPoints)');
    expect(source).toContain("source: 'reconciliation'");
    expect(source).not.toContain('for (const point of finalDisplayTrackPoints)');
  });

  test('live Hike and Run traces render the bounded causal accepted-route presentation', () => {
    const hike = read('src/screens/HikingScreen.tsx');
    const run = read('src/screens/RunningScreen.tsx');
    expect(hike).toContain("const liveTrackPoints = locationProviderSource === 'real' ? trackPointsSmoothed : trackPoints");
    expect(hike).toContain('const liveMapTrackPoints = useMemo(');
    expect(hike).toContain('trackPoints={activitySessionVisible ? liveMapTrackPoints : []}');
    expect(run).toContain("const liveTrackPoints = locationProviderSource === 'real' ? trackPointsSmoothed : trackPoints");
    expect(run).toContain('trackPoints={liveTrackPoints}');
  });

  test('one-source confirmed route animation is presentation-only and cancels outside active foreground tracking', () => {
    const map = read('src/screens/HikingMap.tsx');
    // Native animation behavior cannot be certified by Jest. This structural
    // guard protects the integration boundary while pure segmentation and
    // bounded-tail outcomes are tested behaviorally.
    expect(map).toContain('new AnimatedCoordinatesArrayClass(coordinatesValue)');
    expect(map).toContain('planContinuousRouteTarget(coordinates, stableCountRef.current)');
    expect(map).toContain('id="track-confirmed-continuous"');
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

  test('authoritative Start conflict replaces the speculative identity before recovery materialization', () => {
    const source = read('src/store/useTrackingStore.ts');
    const conflict = source.slice(
      source.indexOf("startResolution.kind === 'conflict'"),
      source.indexOf("set({ ...initialState, activityMode: mode, startError: 'unfinished-exists'", source.indexOf("startResolution.kind === 'conflict'")),
    );
    expect(conflict).toContain('await replaceUnfinishedActivity');
    expect(conflict).toContain('await startHikeTrack');
    expect(conflict.indexOf('await replaceUnfinishedActivity')).toBeLessThan(conflict.indexOf('await startHikeTrack'));
    expect(source).toContain('await mapActivityServerId(userId, localSessionId, startResolution.serverActivityId)');
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
    const durableSave = source.indexOf('await offlineMarkers.saveLocal(payload)', payload);
    const cacheWrite = source.indexOf('storage.setItem(storageKey(s.userId)', durableSave);
    expect(source.slice(payload, durableSave)).toContain('originActivityClientId: activeActivityClientId');
    expect(durableSave).toBeLessThan(cacheWrite);
  });

  test('Activity and Cairn evidence use the one central durable Memory authority', () => {
    const tracking = read('src/store/useTrackingStore.ts');
    const cairns = read('src/store/useMarkerStore.ts');
    const passive = read('src/features/memory/components/PassiveMemoryRecorder.tsx');
    for (const source of [tracking, cairns, passive]) expect(source).toContain('recordMemoryEvidence');
    expect(passive).toContain("status !== 'idle'");
  });

  test('passive exploration defaults off and is independent from Activity capture', () => {
    const settings = read('src/features/memory/store/useMemorySettingsStore.ts');
    const ui = read('src/screens/SettingsScreen.tsx');
    expect(settings).toMatch(/foregroundAutoUnlockEnabled:\s*false/);
    expect(settings).toContain('passiveExplorationContractVersion: 1');
    expect(settings).toContain("migratedToPassiveContract ? parsed.recordMode : 'session-only'");
    expect(ui).toContain('Record exploration outside activities');
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
    expect(persistence).toContain('const serialized = JSON.stringify(payload)');
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

  test('Activity Detail renders real segments plus dashed non-metric gaps', () => {
    const source = read('src/screens/MapHistoryScreen.tsx');
    expect(source).toContain('segmentTrace(pts)');
    expect(source).toContain('trace.gaps.map');
    expect(source).toContain('lineDasharray: [2, 1.5]');
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
    expect(loader).toMatch(/}, \[selectedSessionId\]\);/);
    expect(loader).not.toMatch(/}, \[[^\]]*sessions[^\]]*\]\);/);
  });

  test('Save as Route sends only selected real segment geometry', () => {
    const source = read('src/screens/MapHistoryScreen.tsx');
    expect(source).toContain('const realSegments = segmentTrace(loadedTrackPoints ?? []).segments');
    expect(source).toContain('const openSegment = (segment: typeof realSegments[number])');
    expect(source).toContain('fromSessionTrackPoints: segment.map');
    expect(source).not.toContain('trace.gaps.flatMap');
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
