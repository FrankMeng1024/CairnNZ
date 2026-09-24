import type { ActivityMode } from '../../store/useSessionStore';
import type { TrackingStatus } from '../../store/useTrackingStore';

export type ActivityScreenOwnership =
  | { kind: 'available' }
  | { kind: 'owner'; ownerMode: ActivityMode }
  | { kind: 'owned-elsewhere'; ownerMode: ActivityMode };

/**
 * A live Activity belongs to the mode that created it. Screens may present
 * that Activity, but may never relabel it merely because navigation changed.
 */
export function resolveActivityScreenOwnership(
  status: TrackingStatus,
  ownerMode: ActivityMode,
  requestedMode: ActivityMode,
): ActivityScreenOwnership {
  if (status === 'idle') return { kind: 'available' };
  if (ownerMode === requestedMode) return { kind: 'owner', ownerMode };
  return { kind: 'owned-elsewhere', ownerMode };
}
