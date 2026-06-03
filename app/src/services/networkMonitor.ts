/**
 * NetworkMonitor — wraps expo-network with native listener (no polling).
 *
 * Triggers events on:
 *   - Initial start (current state)
 *   - Native NetworkStateChange via addNetworkStateListener
 *
 * Backup poll every 30s in case the listener misses something (rare on iOS).
 *
 * Web fallback: navigator.onLine basic detection.
 */
import { debugLogger } from './debugLogger';

type NetworkModule = typeof import('expo-network');
let Network: NetworkModule | null = null;
let loadAttempted = false;

async function getNetwork(): Promise<NetworkModule | null> {
  if (Network) return Network;
  if (loadAttempted) return null;
  loadAttempted = true;
  try {
    // require() for jest compatibility
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Network = require('expo-network');
    return Network;
  } catch {
    return null;
  }
}

const POLL_BACKUP_INTERVAL_MS = 30_000;

type NetState = {
  state: 'online' | 'offline';
  type: 'wifi' | 'cellular' | 'none' | 'unknown';
  is_connected: boolean;
  is_internet_reachable: boolean | null;
};

class NetworkMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private subscription: { remove: () => void } | null = null;
  private last: NetState | null = null;
  private active: boolean = false;
  private starting: boolean = false; // re-entrancy guard
  private listeners: ((s: NetState) => void)[] = [];

  async start(): Promise<void> {
    if (this.active || this.starting) return;
    this.starting = true;
    try {
      this.active = true;

      // Initial read
      await this.poll();

      // Native listener (fast path)
      const network = await getNetwork();
      if (network) {
        try {
          this.subscription = network.addNetworkStateListener((event) => {
            const typeMap: Record<string, NetState['type']> = {
              WIFI: 'wifi',
              CELLULAR: 'cellular',
              NONE: 'none',
              UNKNOWN: 'unknown',
            };
            const type = typeMap[event.type ?? 'UNKNOWN'] ?? 'unknown';
            const isConnected = event.isConnected ?? false;
            const isInternetReachable = event.isInternetReachable ?? null;
            const newState: NetState = {
              state: isConnected && isInternetReachable !== false ? 'online' : 'offline',
              type,
              is_connected: isConnected,
              is_internet_reachable: isInternetReachable,
            };
            this.maybeEmit(newState);
          });
        } catch (err) {
          debugLogger.logError(err, 'networkMonitor:listener');
        }
      }

      // Backup poll
      this.timer = setInterval(() => {
        this.poll().catch(() => {});
      }, POLL_BACKUP_INTERVAL_MS);
    } finally {
      this.starting = false;
    }
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.subscription) {
      try { this.subscription.remove(); } catch { /* ignore */ }
      this.subscription = null;
    }
  }

  /**
   * Read current network state synchronously (best known).
   */
  getState(): NetState | null {
    return this.last;
  }

  isOnline(): boolean {
    return this.last?.state === 'online';
  }

  isWifi(): boolean {
    return this.last?.type === 'wifi';
  }

  /**
   * Subscribe to state changes. Returns unsubscribe.
   */
  onChange(callback: (state: NetState) => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    const network = await getNetwork();
    if (!network) {
      // Web fallback
      const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
      const newState: NetState = {
        state: online ? 'online' : 'offline',
        type: 'unknown',
        is_connected: online,
        is_internet_reachable: online ? true : null,
      };
      this.maybeEmit(newState);
      return;
    }

    try {
      const state = await network.getNetworkStateAsync();
      const typeMap: Record<string, NetState['type']> = {
        WIFI: 'wifi',
        CELLULAR: 'cellular',
        NONE: 'none',
        UNKNOWN: 'unknown',
      };
      const type = typeMap[state.type ?? 'UNKNOWN'] ?? 'unknown';
      const isConnected = state.isConnected ?? false;
      const isInternetReachable = state.isInternetReachable ?? null;

      const newState: NetState = {
        state: isConnected && (isInternetReachable !== false) ? 'online' : 'offline',
        type,
        is_connected: isConnected,
        is_internet_reachable: isInternetReachable,
      };
      this.maybeEmit(newState);
    } catch (err) {
      debugLogger.logError(err, 'networkMonitor:poll');
    }
  }

  private maybeEmit(newState: NetState): void {
    const prev = this.last;
    const changed =
      !prev ||
      prev.state !== newState.state ||
      prev.type !== newState.type ||
      prev.is_internet_reachable !== newState.is_internet_reachable;

    this.last = newState;

    if (changed) {
      debugLogger.log({
        ts: Date.now(),
        event: 'network_change',
        state: newState.state,
        type: newState.type,
        is_connected: newState.is_connected,
        is_internet_reachable: newState.is_internet_reachable,
      });
      for (const l of this.listeners) {
        try { l(newState); } catch { /* ignore */ }
      }
    }
  }
}

export const networkMonitor = new NetworkMonitor();
export default networkMonitor;
