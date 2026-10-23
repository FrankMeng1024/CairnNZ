const mockDurable = new Map<string, string>();
const mockAuthenticatedFetch = jest.fn();
const mockPresentationRefresh = jest.fn(async () => undefined);
const mockApp = { isLoggedIn: true, user: { id: 'owner-a' } };
const mockSettings = {
  passiveExplorationEnabled: true,
  memoryLocationTransitionRequired: false,
  automaticExplorationDisclosureVersion: 1,
};

jest.mock('../../../store/storage', () => ({
  storage: {
    getItemStrict: jest.fn(async (key: string) => mockDurable.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockDurable.set(key, value); }),
    getAllKeysStrict: jest.fn(async () => [...mockDurable.keys()]),
    removeItemsStrict: jest.fn(async (keys: string[]) => keys.forEach(key => mockDurable.delete(key))),
  },
}));
jest.mock('../../../store/useAppStore', () => ({
  useAppStore: { getState: () => mockApp },
}));
jest.mock('../../memory/store/useMemorySettingsStore', () => ({
  AUTOMATIC_EXPLORATION_DISCLOSURE_VERSION: 1,
  useMemorySettingsStore: { getState: () => mockSettings },
}));
jest.mock('../../../services/networkMonitor', () => ({
  __esModule: true,
  default: { getState: () => ({ state: 'online' }) },
}));
jest.mock('../../../services/apiService', () => ({
  authenticatedFetch: (...args: unknown[]) => mockAuthenticatedFetch(...args),
}));
jest.mock('../../../services/tokenStore', () => ({ getHeadlessTokenForOwner: jest.fn(async () => null) }));
jest.mock('../../cairns/cairnPresentationStore', () => ({
  useCairnPresentationStore: { getState: () => ({ refresh: mockPresentationRefresh }) },
}));

import {
  __walkingEncounterEvidenceTest,
  flushWalkingEncounterEvidence,
  purgeWalkingEncounterEvidenceForOwner,
  recordWalkingEncounterObservations,
} from '../services/walkingEncounterEvidence';

const activityId = '11111111-1111-4111-8111-111111111111';
const base = Date.now() - 30_000;

function response(body: unknown, ok = true, status = 200): any {
  return { ok, status, json: jest.fn(async () => body) };
}

describe('independent walking encounter evidence', () => {
  beforeEach(async () => {
    mockDurable.clear();
    jest.clearAllMocks();
    __walkingEncounterEvidenceTest.reset();
    mockApp.isLoggedIn = true;
    mockApp.user = { id: 'owner-a' };
    mockSettings.passiveExplorationEnabled = true;
    mockSettings.memoryLocationTransitionRequired = false;
    mockSettings.automaticExplorationDisclosureVersion = 1;
    await purgeWalkingEncounterEvidenceForOwner('owner-a');
  });

  afterEach(() => {
    __walkingEncounterEvidenceTest.reset();
  });

  test('Activity evidence uploads without any Memory API or setting dependency', async () => {
    mockSettings.passiveExplorationEnabled = false;
    mockAuthenticatedFetch.mockImplementationOnce(async (_path: string, options: any) => {
      const body = JSON.parse(options.body);
      expect(body.witnesses).toHaveLength(1);
      expect(body.witnesses[0]).toMatchObject({
        evidence_source: 'activity_real',
        source_activity_client_id: activityId,
      });
      return response({ processed_witness_cids: [body.witnesses[0].cid], acquired: [{ marker_id: '7' }] });
    });
    await recordWalkingEncounterObservations({
      ownerUserId: 'owner-a', source: 'activity_real', sourceActivityClientId: activityId,
      observations: [
        { lat: -41, lng: 174, t: base, accuracy: 8, sourceSegmentId: 'segment-a' },
        { lat: -41.0001, lng: 174.0001, t: base + 12_000, accuracy: 9, sourceSegmentId: 'segment-a' },
      ],
    });
    await expect(flushWalkingEncounterEvidence('owner-a')).resolves.toMatchObject({
      status: 'acknowledged', processedWitnessCount: 1, acquiredCount: 1,
    });
    expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      '/api/cairn-memory/walking-evidence',
      expect.objectContaining({ expectedUserId: 'owner-a' }),
    );
    expect(mockPresentationRefresh).toHaveBeenCalledTimes(1);
    expect([...mockDurable.values()].map(value => JSON.parse(value))).toHaveLength(1);
  });

  test('failed upload survives a fresh service lifetime and retry removes only acknowledged history', async () => {
    mockAuthenticatedFetch
      .mockRejectedValueOnce(new Error('offline flap'))
      .mockImplementationOnce(async (_path: string, options: any) => {
        const body = JSON.parse(options.body);
        return response({ processed_witness_cids: [body.witnesses[0].cid], acquired: [] });
      });
    await recordWalkingEncounterObservations({
      ownerUserId: 'owner-a', source: 'activity_real', sourceActivityClientId: activityId,
      observations: [
        { lat: -41, lng: 174, t: base, accuracy: 8, sourceSegmentId: 'segment-a' },
        { lat: -41.0001, lng: 174.0001, t: base + 12_000, accuracy: 9, sourceSegmentId: 'segment-a' },
      ],
    });
    await expect(flushWalkingEncounterEvidence('owner-a')).resolves.toMatchObject({ status: 'failed' });
    expect(mockDurable.size).toBe(2);
    // Reset every in-memory flight/backoff field while retaining the mocked
    // durable storage, matching a process death followed by app relaunch.
    __walkingEncounterEvidenceTest.reset();
    await expect(flushWalkingEncounterEvidence('owner-a')).resolves.toMatchObject({ status: 'acknowledged' });
    expect(mockDurable.size).toBe(1);
  });

  test('explicit OFF suppresses passive scanning while preserving Activity availability and owner isolation', async () => {
    mockSettings.passiveExplorationEnabled = false;
    await recordWalkingEncounterObservations({
      ownerUserId: 'owner-a', source: 'passive_real',
      observations: [
        { lat: -41, lng: 174, t: base, accuracy: 8, sourceSegmentId: 'passive-a' },
        { lat: -41.0001, lng: 174.0001, t: base + 12_000, accuracy: 9, sourceSegmentId: 'passive-a' },
      ],
    });
    await expect(flushWalkingEncounterEvidence('owner-a')).resolves.toMatchObject({ status: 'nothing_to_push' });
    expect(mockAuthenticatedFetch).not.toHaveBeenCalled();

    mockApp.user = { id: 'owner-b' };
    await expect(flushWalkingEncounterEvidence('owner-a')).resolves.toMatchObject({ status: 'authority_changed' });
    expect(mockAuthenticatedFetch).not.toHaveBeenCalled();
  });
});
