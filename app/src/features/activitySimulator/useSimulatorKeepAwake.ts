import { useEffect } from 'react';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { appendSimulatorLog } from './simulatorLog';

const KEEP_AWAKE_TAG = 'cairn-debug-simulator-activity';

/** Keep awake only for an Internal Debug Activity owned by virtual GPS. */
export function useSimulatorKeepAwake(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG).then(() => {
      if (active) appendSimulatorLog('ACTIVITY_STATE', 'simulator_keep_awake_started');
    }).catch(() => {
      appendSimulatorLog('ERROR', 'simulator_keep_awake_failed');
    });
    return () => {
      active = false;
      void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
      appendSimulatorLog('ACTIVITY_STATE', 'simulator_keep_awake_stopped');
    };
  }, [enabled]);
}

