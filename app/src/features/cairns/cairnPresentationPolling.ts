export const CAIRN_PRESENTATION_POLL_MS = 5_000;
export const CAIRN_PRESENTATION_OFFLINE_MAX_MS = 60_000;

export type CairnPresentationPollFailure = 'offline' | 'authorization' | 'server' | null;

export interface CairnPresentationPollCounters {
  callbacks: number;
  refreshCalls: number;
  knownOfflineSkips: number;
}

interface CairnPresentationPollDependencies {
  refresh: () => Promise<void>;
  failure: () => CairnPresentationPollFailure;
  connectivity: () => 'online' | 'offline' | 'unknown';
}

export interface CairnPresentationPoller {
  start: () => void;
  stop: () => void;
  kick: () => void;
  counters: () => CairnPresentationPollCounters;
}

export function cairnPresentationOfflineDelayMs(consecutiveOffline: number): number {
  const exponent = Math.max(0, Math.min(8, consecutiveOffline - 1));
  return Math.min(
    CAIRN_PRESENTATION_OFFLINE_MAX_MS,
    CAIRN_PRESENTATION_POLL_MS * (2 ** exponent),
  );
}

/**
 * Foreground-only polling coordinator. The five-second online cadence remains
 * the revocation/discovery authority. Known or observed transport loss backs
 * off without converting authorization/server rejection into "offline".
 */
export function createCairnPresentationPoller(
  dependencies: CairnPresentationPollDependencies,
): CairnPresentationPoller {
  let active = false;
  let running = false;
  let kickPending = false;
  let consecutiveOffline = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const work: CairnPresentationPollCounters = {
    callbacks: 0,
    refreshCalls: 0,
    knownOfflineSkips: 0,
  };

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const schedule = (delayMs: number) => {
    if (!active) return;
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, delayMs);
  };

  const run = async () => {
    if (!active || running) {
      if (active && running) kickPending = true;
      return;
    }
    running = true;
    work.callbacks += 1;
    try {
      if (dependencies.connectivity() === 'offline') {
        work.knownOfflineSkips += 1;
        consecutiveOffline += 1;
      } else {
        work.refreshCalls += 1;
        await dependencies.refresh();
        consecutiveOffline = dependencies.failure() === 'offline'
          ? consecutiveOffline + 1
          : 0;
      }
    } finally {
      running = false;
      if (!active) return;
      if (kickPending) {
        kickPending = false;
        schedule(0);
      } else {
        schedule(consecutiveOffline > 0
          ? cairnPresentationOfflineDelayMs(consecutiveOffline)
          : CAIRN_PRESENTATION_POLL_MS);
      }
    }
  };

  return {
    start: () => {
      if (active) return;
      active = true;
      schedule(0);
    },
    stop: () => {
      active = false;
      kickPending = false;
      consecutiveOffline = 0;
      clearTimer();
    },
    kick: () => {
      if (!active) return;
      if (running) {
        kickPending = true;
        return;
      }
      schedule(0);
    },
    counters: () => ({ ...work }),
  };
}
