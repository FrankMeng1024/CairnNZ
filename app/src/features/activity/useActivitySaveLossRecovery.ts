import { useCallback, useEffect } from 'react';
import { Alert, AppState } from 'react-native';
import type { ActivityMode } from '../../store/useSessionStore';
import { useTrackingStore } from '../../store/useTrackingStore';

// Screens remain separate and can coexist in a navigation stack. This module
// guard prevents both hosts from presenting the same native recovery alert.
let saveLossAlertVisible = false;

/**
 * Shared data-loss recovery host for both activity modes.
 *
 * The native Alert is retained for this P0 correctness pass because it is the
 * existing proven last-resort save-loss affordance. It is inventoried for the
 * later Activity UX convergence; parity must not wait on that redesign.
 */
export function useActivitySaveLossRecovery(mode: ActivityMode): void {
  const saveLostSessionId = useTrackingStore(state => state.saveLostSessionId);
  const clearLastStopReason = useTrackingStore(state => state.clearLastStopReason);
  const discardCurrentSession = useTrackingStore(state => state.discardCurrentSession);

  useEffect(() => {
    void useTrackingStore.getState().hydrateSaf01();
  }, []);

  const retry = useCallback(async () => {
    const payload = useTrackingStore.getState().saveLostPayload;
    try {
      if (payload) {
        const { savePending } = require('../../services/pendingSyncStore');
        await savePending({
          ...payload,
          userId: payload.userId,
          createdAt: Date.now(),
          lastAttemptAt: null,
          attemptCount: 0,
        });
      }
      const { drainPending } = require('../../services/syncDaemon');
      await drainPending();
      const { listPending } = require('../../services/pendingSyncStore');
      const stillPending = (await listPending()).some(
        (entry: any) => entry.localId === payload?.localId,
      );
      if (!stillPending) clearLastStopReason();
    } catch (error) {
      // Keep the durable marker intact so foregrounding/re-entry offers Retry.
      // eslint-disable-next-line no-console
      console.warn('[activity-save-loss] retry failed:', error);
    } finally {
      saveLossAlertVisible = false;
    }
  }, [clearLastStopReason]);

  const present = useCallback(() => {
    const current = useTrackingStore.getState();
    if (!current.saveLostSessionId || current.saveLostPayload?.activityMode !== mode) return;
    if (saveLossAlertVisible) return;
    saveLossAlertVisible = true;
    const label = mode === 'running' ? 'run' : 'hike';
    Alert.alert(
      `We couldn't save this ${label}`,
      `Your ${label} is still recorded on this device. Retry saving it, or discard it.`,
      [
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            saveLossAlertVisible = false;
            clearLastStopReason();
            try { discardCurrentSession(); } catch { /* best effort */ }
          },
        },
        { text: 'Retry', onPress: () => { void retry(); } },
      ],
      { cancelable: false },
    );
  }, [clearLastStopReason, discardCurrentSession, mode, retry]);

  useEffect(() => {
    if (saveLostSessionId) present();
  }, [present, saveLostSessionId]);

  useEffect(() => {
    if (!saveLostSessionId) return undefined;
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'background' || state === 'inactive') {
        // iOS dismisses Alert on background; allow the active transition to
        // present it again while the durable marker still exists.
        saveLossAlertVisible = false;
      } else if (state === 'active') {
        present();
      }
    });
    return () => { try { subscription.remove(); } catch { /* no-op */ } };
  }, [present, saveLostSessionId]);
}

