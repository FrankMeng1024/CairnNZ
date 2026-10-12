export type HomeStateWindow = 'save-recovery' | 'active-or-recoverable' | 'discovery' | 'recent' | 'memory' | 'first-use';

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
