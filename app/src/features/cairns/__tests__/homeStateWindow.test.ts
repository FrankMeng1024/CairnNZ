import { hasPersonalMemoryEvidence, resolveHomeStateWindow } from '../homeStateWindow';

describe('Home state window priority', () => {
  test.each([
    [{ saveRecovery: true, activeOrRecoverable: true, unannouncedDiscovery: true, recentActivity: true, personalMemory: true }, 'save-recovery'],
    [{ saveRecovery: false, activeOrRecoverable: true, unannouncedDiscovery: true, recentActivity: true, personalMemory: true }, 'active-or-recoverable'],
    [{ saveRecovery: false, activeOrRecoverable: false, unannouncedDiscovery: true, recentActivity: true, personalMemory: true }, 'discovery'],
    [{ saveRecovery: false, activeOrRecoverable: false, unannouncedDiscovery: false, recentActivity: true, personalMemory: true }, 'recent'],
    [{ saveRecovery: false, activeOrRecoverable: false, unannouncedDiscovery: false, recentActivity: false, personalMemory: true }, 'memory'],
    [{ saveRecovery: false, activeOrRecoverable: false, unannouncedDiscovery: false, recentActivity: false, personalMemory: false }, 'first-use'],
  ] as const)('selects exactly one stable state %#', (input, expected) => {
    expect(resolveHomeStateWindow(input)).toBe(expected);
  });
});

describe('Home personal Memory truth', () => {
  test.each([
    [{ memoryPointCount: 1, ownedCairnCount: 0, acquiredCairnCount: 0, unreadAcquiredGroupCount: 0 }, true],
    [{ memoryPointCount: 0, ownedCairnCount: 1, acquiredCairnCount: 0, unreadAcquiredGroupCount: 0 }, true],
    [{ memoryPointCount: 0, ownedCairnCount: 0, acquiredCairnCount: 3, unreadAcquiredGroupCount: 0 }, true],
    [{ memoryPointCount: 0, ownedCairnCount: 0, acquiredCairnCount: 0, unreadAcquiredGroupCount: 3 }, true],
    [{ memoryPointCount: 0, ownedCairnCount: 0, acquiredCairnCount: 0, unreadAcquiredGroupCount: 0 }, false],
  ] as const)('never renders first-use over existing personal Memory %#', (input, expected) => {
    expect(hasPersonalMemoryEvidence(input)).toBe(expected);
  });
});
