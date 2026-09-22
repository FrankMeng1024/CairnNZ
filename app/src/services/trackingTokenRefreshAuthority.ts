export interface TrackingTokenRefreshSnapshot {
  ownerUserId: string;
  sessionId: string;
  ownerGeneration: string;
  refreshEpoch: number;
  status: 'tracking' | 'paused';
}

interface RefreshResult {
  token?: string;
  error?: string;
  authInvalid?: boolean;
}

export interface OwnedTrackingRefreshResult extends RefreshResult {
  notified: boolean;
}

function stillOwns(
  expected: TrackingTokenRefreshSnapshot,
  current: TrackingTokenRefreshSnapshot | null,
): boolean {
  return !!current
    && current.ownerUserId === expected.ownerUserId
    && current.sessionId === expected.sessionId
    && current.ownerGeneration === expected.ownerGeneration
    && current.refreshEpoch === expected.refreshEpoch
    && (current.status === 'tracking' || current.status === 'paused');
}

/**
 * Run one periodic Activity-token refresh under the exact live owner lease.
 * Lazy module loads are awaits too: ownership is rechecked after each one so
 * a suspended A callback cannot notify Memory, even when its timer was
 * already executing when account cleanup began.
 */
export async function runOwnedTrackingTokenRefresh(input: {
  captured: TrackingTokenRefreshSnapshot;
  current: () => TrackingTokenRefreshSnapshot | null;
  loadRefresh: () => Promise<(ownerUserId: string) => Promise<RefreshResult>>;
  loadNotify: () => Promise<(ownerUserId: string) => void>;
}): Promise<OwnedTrackingRefreshResult> {
  if (!stillOwns(input.captured, input.current())) {
    return { error: 'activity_authority_changed', notified: false };
  }
  const refresh = await input.loadRefresh();
  if (!stillOwns(input.captured, input.current())) {
    return { error: 'activity_authority_changed', notified: false };
  }
  const result = await refresh(input.captured.ownerUserId);
  if (!result.token || !stillOwns(input.captured, input.current())) {
    return { ...result, error: result.error ?? 'activity_authority_changed', notified: false };
  }
  const notify = await input.loadNotify();
  if (!stillOwns(input.captured, input.current())) {
    return { ...result, error: 'activity_authority_changed', notified: false };
  }
  notify(input.captured.ownerUserId);
  return { ...result, notified: true };
}
