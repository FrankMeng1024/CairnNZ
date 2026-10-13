import { buildDiscoveryHomeCopy, hasPersonalMemoryEvidence, resolveHomeStateWindow } from '../homeStateWindow';

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

describe('Home discovery copy', () => {
  test.each([
    [{ cairnCount: 1, eventCount: 1, updatedEventCount: 0, mergeStartedAt: 1 }, 'A Cairn is now in Memory'],
    [{ cairnCount: 1, eventCount: 1, updatedEventCount: 1, mergeStartedAt: 1 }, 'A Cairn story was updated'],
    [{ cairnCount: 3, eventCount: 3, updatedEventCount: 0, mergeStartedAt: 1 }, '3 Cairns are now in Memory'],
    [{ cairnCount: 10, eventCount: 10, updatedEventCount: 2, mergeStartedAt: 1 }, '10 Cairns are now in Memory'],
  ] as const)('summarizes durable discovery state without repeated cards %#', (group, title) => {
    expect(buildDiscoveryHomeCopy(group, 'Just now')).toEqual({
      title, meta: 'Saved in Memory · Just now', details: ['Saved in Memory', 'Just now'],
    });
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
