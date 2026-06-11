/**
 * EditResumePrompt — Detects unfinished edit session on app resume and
 * prompts the user to Resume or Discard.
 *
 * Mounts at app root. Runs once on mount + on AppState 'active' transition.
 * If checkResumable() returns available + the route still exists → Alert with
 * "Resume" / "Discard" actions. Resume kicks off useRouteEditStore.beginEdit
 * with persisted state. Discard clears the session.
 *
 * Sprint 66 Fix-4 (review v3.1 §C5 + Phase 6b retro fix).
 *
 * v3-audit (ARCH-021): the parent App.tsx gates this component's mount
 * on flagsPrimed=true (after `await getFlags()`), so by the time this
 * useEffect runs, getFlagsSync() returns the AsyncStorage-overridden
 * value. We additionally re-check by awaiting getFlags() at the top
 * of runCheck — defense in depth against a future caller mounting
 * this component before the boot await completes.
 */
import { useEffect, useRef } from 'react';
import { Alert, AppState, AppStateStatus, BackHandler, Platform } from 'react-native';
import { checkResumable, clearSession } from './src/services/EditSessionPersistence';
import { useRouteStore } from './src/store/useRouteStore';
import { useRouteEditStore, isSessionRecentlyCancelled } from './src/store/useRouteEditStore';
import { getFlags } from './src/config/featureFlags';

export function EditResumePrompt(): null {
  const checked = useRef(false);
  const isAlertActiveRef = useRef(false);
  // v6-audit (BUG-ERS-1): a separate "in-progress" ref guards the wait
  // phase. The original isAlertActiveRef was moved past the 5s wait by
  // v5-ARCH-010, opening a race window where two concurrent runChecks
  // (initial mount + AppState 'active') could both pass the guard and
  // stack two Alert dialogs.
  const inProgressRef = useRef(false);

  const runCheck = async () => {
    // v3-audit (ARCH-021): await the async getFlags() so AsyncStorage
    // overrides are honored even on the very first cold-start tick.
    const flags = await getFlags();
    if (!flags.editModeEnabled) return;

    // v17-audit (BUG-S66-V17-01): suppress the resume prompt when an
    // edit session is already active in-memory. Without this guard,
    // every AppState 'active' transition (background→foreground while
    // mid-edit) would re-fire the modal for the same session the user
    // is currently editing, and "Resume" would call beginEdit again,
    // overwriting in-memory state (pendingDrag/pendingStraightConfirm
    // lost, in-flight commit aborted via editOpSeq bump).
    if (useRouteEditStore.getState().isOpen) return;

    // v6-audit (BUG-ERS-1): claim the in-progress slot BEFORE the wait
    // so a concurrent runCheck triggered by AppState 'active' returns
    // immediately rather than racing past the wait.
    if (inProgressRef.current) return;
    inProgressRef.current = true;

    try {
      // v5-audit (ARCH-010) + v6-audit (FUNC-003): wait for routes to
      // load before deciding whether the session's routeId is known.
      // 5s polling is a fallback for the unsubscribe-on-resolve approach
      // — extending here keeps the simple flow.
      let knownRouteIds = new Set(useRouteStore.getState().routes.map(r => r.id));
      if (knownRouteIds.size === 0) {
        const deadline = Date.now() + 5000;
        while (knownRouteIds.size === 0 && Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 100));
          knownRouteIds = new Set(useRouteStore.getState().routes.map(r => r.id));
        }
        if (knownRouteIds.size === 0) return;
      }

      if (isAlertActiveRef.current) return;
      isAlertActiveRef.current = true;

      const result = await checkResumable(knownRouteIds);
      if (!result.available) {
        isAlertActiveRef.current = false;
        return;
      }
      // v20-audit (F-NEW-4): suppress modal for sessions the user just
      // explicitly cancelled. cancelEdit's clearSession is async and
      // may not have flushed by the time AppState 'active' fires
      // runCheck — without this guard the modal would prompt to resume
      // an edit the user just cancelled.
      if (isSessionRecentlyCancelled(result.session.sessionId)) {
        isAlertActiveRef.current = false;
        return;
      }

      const minutesAgo = Math.max(1, Math.floor((Date.now() - result.session.lastEditAt) / 60000));
      Alert.alert(
        'Resume route edit?',
        `You have unsaved edits from ${minutesAgo} minute${minutesAgo === 1 ? '' : 's'} ago.`,
        [
          {
            text: 'Discard',
            style: 'destructive',
            onPress: async () => {
              // v25-audit (S-V25-28): register sessionId in
              // recentlyCancelledSessions so a concurrent AppState
              // 'active' transition fired before clearSession flushes
              // doesn't re-show this modal for the just-discarded
              // session. Symmetric with cancelEdit's protection.
              const { recentlyCancelledSessions } = await import(
                './src/store/useRouteEditStore'
              );
              recentlyCancelledSessions.add(result.session.sessionId);
              try {
                await clearSession();
              } finally {
                recentlyCancelledSessions.delete(result.session.sessionId);
                isAlertActiveRef.current = false;
              }
            },
          },
          {
            text: 'Resume',
            onPress: async () => {
              try {
                const route = useRouteStore.getState().routes.find(r => r.id === result.session.routeId);
                if (!route) {
                  await clearSession();
                  return;
                }
                // v12-audit (Architectural Critical VU-RESUME-EMPTY-POINTS):
                // route.points may be EMPTY because the list endpoint
                // strips points for perf (useRouteStore.ts:99-103).
                // Build walkedIndex from extras.originalPoints loaded
                // directly from AsyncStorage — this is the user's
                // immutable GPS trace.
                // v13-audit (VU-RESUME-CORRIDOR-BYPASS): checkResumable
                // now validates extras existence BEFORE returning
                // available:true (EditSessionPersistence v13). So
                // extras MUST exist here. If reading still fails,
                // refuse to resume (fail-closed) rather than silently
                // dropping corridor enforcement.
                let resumeWalkedIndex: any = null;
                let resumeBlocked = false;
                try {
                  const { PointCloudIndex } = await import('./src/services/routing/corridor/PointCloudIndex');
                  const { loadExtras } = await import('./src/services/LocalRouteExtras');
                  const extras = await loadExtras(route.id);
                  // v14-audit (BUG-03 contract drift): require
                  // extras.originalPoints UNCONDITIONALLY. Do NOT fall
                  // back to route.points — useRouteStore.ts:99-103 strips
                  // points server-side for perf, and even when present
                  // route.points is the edited/simplified polyline, not
                  // the immutable GPS trace. A TOCTOU window exists
                  // between checkResumable (validates extras) and this
                  // onPress handler (re-loads extras): if extras was
                  // deleted in between (concurrent deleteRoute, cache
                  // eviction, AsyncStorage corruption) we MUST refuse
                  // resume rather than silently degrade corridor
                  // enforcement.
                  if (extras?.originalPoints && extras.originalPoints.length > 0) {
                    resumeWalkedIndex = new PointCloudIndex(
                      extras.originalPoints.map((p, i) => ({
                        lng: p.lng,
                        lat: p.lat,
                        source: 'original' as const,
                        refId: `resume:${route.id}:${i}`,
                      })),
                    );
                  } else {
                    // Fail-closed: extras gone or empty → corridor cannot
                    // be enforced → refuse resume.
                    resumeBlocked = true;
                  }
                } catch {
                  resumeBlocked = true;
                }
                if (resumeBlocked) {
                  await clearSession();
                  Alert.alert(
                    'Cannot resume edit',
                    'The original route data is missing. The pending edit has been discarded.',
                    [{ text: 'OK' }],
                  );
                  return;
                }
                await useRouteEditStore.getState().beginEdit({
                  routeId: route.id,
                  routePoints: route.points.map(p => ({ lng: p.lng, lat: p.lat, alt: p.alt ?? null } as any)),
                  resumeFrom: {
                    workingPoints: result.session.workingPoints,
                    viaPoints: (result.session as any).viaPoints ?? [],
                    trimStartFrac: (result.session as any).trimStartFrac ?? 0,
                    trimEndFrac: (result.session as any).trimEndFrac ?? 1,
                    enteredAt: result.session.enteredAt,
                  },
                });
                // v20-audit (F-NEW-10): if beginEdit failed (migration
                // error or edit-mode-disabled), the session record is
                // NOT cleared by beginEdit — the next AppState 'active'
                // would re-fire this modal indefinitely. Clear here so
                // a single Resume attempt is final.
                // v21-audit (F-V21-014): EXCEPT when migratorRetry is
                // set — that means the migration is recoverable and the
                // user will be shown a Retry/Skip/Report alert by
                // MigratorRetryPrompt. Clearing session here would
                // destroy the data the retry is meant to recover.
                const postBeginState = useRouteEditStore.getState();
                if (!postBeginState.isOpen && !postBeginState.migratorRetry) {
                  // v23-audit (BUG-V22-04): when beginEdit aborts due to
                  // editModeEnabled=false (lastError='Edit mode is
                  // disabled'), surface the reason to the user before
                  // clearing the session. Otherwise the modal silently
                  // closes and the user has no idea why Resume did
                  // nothing.
                  if (
                    typeof postBeginState.lastError === 'string' &&
                    postBeginState.lastError.includes('Edit mode is disabled')
                  ) {
                    Alert.alert(
                      'Edit mode disabled',
                      'Route editing is currently disabled. The pending edit has been discarded.',
                      [{ text: 'OK' }],
                    );
                  }
                  await clearSession();
                }
              } catch (err) {
                // v25-audit (S-V25-14) + v26-audit (V26-02): if beginEdit
                // throws unexpectedly (e.g. PointCloudIndex constructor
                // crash on corrupted extras), we must (1) clear the
                // session record (else next AppState 'active' loops),
                // (2) RESET in-memory store state. v25 only did (1) —
                // if beginEdit threw AFTER its atomic set, the store
                // was left with isOpen=true / stale sessionId, no
                // recovery path.
                try {
                  useRouteEditStore.getState().cancelEdit();
                } catch {
                  // ignore — best effort
                }
                await clearSession();
                Alert.alert(
                  'Cannot resume edit',
                  'An unexpected error occurred while resuming. The pending edit has been discarded.',
                  [{ text: 'OK' }],
                );
              } finally {
                isAlertActiveRef.current = false;
              }
            },
          },
        ],
        { cancelable: false },
      );
    } catch {
      isAlertActiveRef.current = false;
    } finally {
      // v6-audit (BUG-ERS-1): always release the in-progress slot so
      // the next AppState 'active' transition can run runCheck cleanly.
      inProgressRef.current = false;
    }
  };

  useEffect(() => {
    if (!checked.current) {
      checked.current = true;
      runCheck();
    }
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        runCheck();
      }
    });
    // v27-audit (SC-V27-32): on Android, the hardware back button can
    // dismiss Alert.alert without firing either onPress, leaving
    // isAlertActiveRef stuck true forever — subsequent runChecks would
    // skip the modal until the app fully restarts. Listen for back
    // press while an alert is active and release the ref. iOS doesn't
    // have this hardware path, so the listener is a no-op on iOS.
    let backSub: { remove: () => void } | null = null;
    if (Platform.OS === 'android') {
      backSub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (isAlertActiveRef.current) {
          isAlertActiveRef.current = false;
          // Returning false lets the system handle the back press
          // normally (which dismisses the alert). We just need to
          // free our guard.
        }
        return false;
      });
    }
    return () => {
      sub.remove();
      backSub?.remove();
    };
  }, []);

  return null;
}
