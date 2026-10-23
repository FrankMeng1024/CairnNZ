const mockValues = new Map<string, string>();
jest.mock('../../../store/storage', () => ({ storage: { getItem: jest.fn(), setItem: jest.fn() } }));

import { __memoryGuidanceTest, claimMemoryGuidance } from '../services/memoryGuidance';
import { storage } from '../../../store/storage';

describe('owner-scoped Memory guidance', () => {
  beforeEach(() => {
    mockValues.clear();
    jest.clearAllMocks();
    (storage.getItem as jest.Mock).mockImplementation(async (key: string) => mockValues.get(key) ?? null);
    (storage.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => { mockValues.set(key, value); });
    __memoryGuidanceTest.reset();
  });

  test('is claimed durably before its single presentation', async () => {
    expect(await claimMemoryGuidance({ ownerId: 'owner-a', hasExploredEvidence: false, legacyDone: false })).toBe(true);
    __memoryGuidanceTest.reset(); // model a fresh process
    expect(await claimMemoryGuidance({ ownerId: 'owner-a', hasExploredEvidence: false, legacyDone: false })).toBe(false);
  });

  test('is isolated by owner and skipped for an already explored owner', async () => {
    expect(await claimMemoryGuidance({ ownerId: 'owner-a', hasExploredEvidence: true, legacyDone: false })).toBe(false);
    expect(await claimMemoryGuidance({ ownerId: 'owner-b', hasExploredEvidence: false, legacyDone: false })).toBe(true);
    expect(__memoryGuidanceTest.keyFor('owner-a')).not.toBe(__memoryGuidanceTest.keyFor('owner-b'));
  });
});
