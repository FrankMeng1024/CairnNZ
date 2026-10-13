export type HomeStateWindow = 'save-recovery' | 'active-or-recoverable' | 'discovery' | 'recent' | 'memory' | 'first-use';

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
