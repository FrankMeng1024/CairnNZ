
import { cairnText } from '../../i18n/runtime';export type HomeStateWindow = 'save-recovery' | 'active-or-recoverable' | 'discovery' | 'recent' | 'memory' | 'first-use';

export function hasPersonalMemoryEvidence(input: {
  memoryPointCount: number;
  ownedCairnCount: number;
  acquiredCairnCount: number;
  unreadAcquiredGroupCount: number;
}): boolean {
  return input.memoryPointCount > 0
    || input.ownedCairnCount > 0
    || input.acquiredCairnCount > 0
    || input.unreadAcquiredGroupCount > 0;
}

export function buildDiscoveryHomeCopy(group: {
  cairnCount: number;
  eventCount: number;
  updatedEventCount: number;
  mergeStartedAt: number;
}, relativeTime: string): { title: string; meta: string; details: string[] } {
  const title = group.cairnCount === 1
    ? (group.eventCount > 0 && group.updatedEventCount === group.eventCount
      ? cairnText('cairns.home-state-window.a-cairn-story-was-updated')
      : cairnText('cairns.home-state-window.a-cairn-is-now-in-memory'))
    : cairnText('cairns.home-state-window.value-cairns-are-now-in-memory', { cairnCount: group.cairnCount });
  return {
    title,
    meta: cairnText('cairns.home-state-window.saved-in-memory-value', { relativeTime: relativeTime }),
    details: [cairnText('memory.saved-in-memory'), relativeTime],
  };
}

export function resolveDiscoveryHomeDestination(singleMarkerId: string | null):
  | { screen: 'AcquiredCairnDetail'; params: { markerId: string } }
  | { screen: 'AllCairns'; params: { initialSection: 'found' } } {
  return singleMarkerId
    ? { screen: 'AcquiredCairnDetail', params: { markerId: singleMarkerId } }
    : { screen: 'AllCairns', params: { initialSection: 'found' } };
}

/** The single Home middle window has one deterministic, non-cycling owner. */
export function resolveHomeStateWindow(input: {
  saveRecovery: boolean;
  activeOrRecoverable: boolean;
  unannouncedDiscovery: boolean;
  recentActivity: boolean;
  personalMemory: boolean;
}): HomeStateWindow {
  if (input.saveRecovery) return 'save-recovery';
  if (input.activeOrRecoverable) return 'active-or-recoverable';
  if (input.unannouncedDiscovery) return 'discovery';
  if (input.recentActivity) return 'recent';
  if (input.personalMemory) return 'memory';
  return 'first-use';
}
