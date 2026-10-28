import AsyncStorage from '@react-native-async-storage/async-storage';

const mockOwnerUserId = String(process.env.CAIRN_DIAGNOSTIC_E2E_OWNER_ID || '');
const mockBaseUrl = String(process.env.CAIRN_DIAGNOSTIC_E2E_BASE_URL || '');
const mockBearerToken = String(process.env.CAIRN_DIAGNOSTIC_E2E_BEARER_TOKEN || '');
const mockOtherBearerToken = String(process.env.CAIRN_DIAGNOSTIC_E2E_OTHER_BEARER_TOKEN || '');
const mockOperationsKey = String(process.env.CAIRN_DIAGNOSTIC_E2E_OPERATIONS_KEY || '');
const e2eEnvironmentAvailable = Boolean(
  mockOwnerUserId && mockBaseUrl && mockBearerToken && mockOtherBearerToken && mockOperationsKey,
);

jest.mock('../src/services/apiService', () => ({
  authenticatedFetch: async (path: string, options: Record<string, unknown> = {}) => {
    const expectedUserId = options.expectedUserId == null ? null : String(options.expectedUserId);
    if (!mockOwnerUserId || expectedUserId !== mockOwnerUserId) {
      const error = new Error('authenticated_fetch_account_changed') as Error & { code?: string };
      error.code = 'ACCOUNT_CHANGED';
      throw error;
    }
    const { expectedUserId: _expected, skipLogoutOn401: _skip, ...fetchOptions } = options;
    return fetch(`${mockBaseUrl}${path}`, {
      ...(fetchOptions as RequestInit),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mockBearerToken}`,
        ...((fetchOptions.headers as Record<string, string> | undefined) ?? {}),
      },
    });
  },
}));
jest.mock('../src/store/useAppStore', () => ({
  useAppStore: { getState: () => ({ user: { id: mockOwnerUserId }, isLoggedIn: true }) },
}));
jest.mock('../src/services/networkMonitor', () => ({
  __esModule: true,
  default: { isOnline: () => true },
  networkMonitor: { isOnline: () => true },
}));

import {
  _resetAutomaticDiagnosticOutboxForTesting,
  drainAutomaticDiagnosticOutbox,
  getAutomaticDiagnosticStatus,
} from '../src/services/automaticDiagnosticOutbox';
import { setAutomaticDiagnosticConsent } from '../src/services/automaticDiagnosticConsent';
import {
  beginActivityDiagnosticReplay,
  finishActivityDiagnosticReplay,
  recordActivityDiagnosticDecision,
  recordActivityDiagnosticObservation,
} from '../src/features/activity/activityDiagnosticReplay';

const activityId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

(e2eEnvironmentAvailable ? describe : describe.skip)(
  'production outbox through real isolated Express/MySQL',
  () => {
  jest.setTimeout(60_000);

  beforeEach(async () => {
    if (!mockOwnerUserId || !mockBaseUrl || !mockBearerToken || !mockOperationsKey) {
      throw new Error('real_diagnostic_e2e_environment_required');
    }
    await AsyncStorage.clear();
    await _resetAutomaticDiagnosticOutboxForTesting();
  });

  test('explicit consent captures normal Activity lineage durably, survives restart, uploads and revokes', async () => {
    await expect(setAutomaticDiagnosticConsent(mockOwnerUserId, true)).resolves.toMatchObject({
      enabled: true,
      tier: 'tier_b',
    });
    await beginActivityDiagnosticReplay({
      ownerUserId: mockOwnerUserId,
      clientActivityId: activityId,
      mode: 'hiking',
      source: 'real',
      wallTimeMs: 1_761_177_600_000,
    });
    await recordActivityDiagnosticObservation({
      ownerUserId: mockOwnerUserId,
      clientActivityId: activityId,
      observationTimeMs: 1_761_177_601_000,
      coordinate: {
        lat: -41.28664,
        lng: 174.77557,
        accuracy: 6,
        source: 'background',
        nativeBatchSequence: 2,
        nativeBatchIndex: 0,
        receiptWallTimeMs: 1_761_177_601_250,
        receiptMonotonicTimeMs: 1_250,
        appStateAtReceipt: 'background',
        receiptEvidenceId: 'synthetic-receipt-e2e',
        ownerGeneration: 'synthetic-owner-generation-e2e',
      },
    });
    await recordActivityDiagnosticDecision({
      ownerUserId: mockOwnerUserId,
      clientActivityId: activityId,
      observationTimeMs: 1_761_177_601_000,
      accepted: true,
      reason: 'accepted',
      segmentId: 'synthetic-segment-e2e',
      receiptEvidenceId: 'synthetic-receipt-e2e',
    });
    await finishActivityDiagnosticReplay(mockOwnerUserId, activityId, { outcome: 'synthetic-complete' });

    const streamId = `activity:${activityId}:precise`;
    expect(await getAutomaticDiagnosticStatus(mockOwnerUserId, streamId)).toMatchObject({
      pendingCount: 2,
      quality: 'UPLOAD_PENDING',
    });

    // Recreate all in-process locks/counters while retaining the durable queue.
    await _resetAutomaticDiagnosticOutboxForTesting();
    const drained = await drainAutomaticDiagnosticOutbox(mockOwnerUserId, { reason: 'foreground' });
    expect(drained).toMatchObject({ acknowledgedEvents: 2, failedBatches: 0, skipped: false });
    expect(await getAutomaticDiagnosticStatus(mockOwnerUserId, streamId)).toMatchObject({
      pendingCount: 0,
      quality: 'SERVER_ACKED',
    });

    const query = await fetch(
      `${mockBaseUrl}/api/telemetry/diagnostics/activity/${activityId}?owner_id=${mockOwnerUserId}`,
      { headers: { 'X-API-Key': mockOperationsKey } },
    );
    expect(query.status).toBe(200);
    const queried = await query.json();
    expect(queried.count).toBe(1);
    expect(queried.streams[0].events.map((event: { eventCode: string }) => event.eventCode)).toEqual([
      'ACTIVITY_REPLAY_RAW_OBSERVATION',
      'ACTIVITY_REPLAY_OBSERVATION_DECISION',
    ]);
    expect(JSON.stringify(queried)).toContain('-41.28664');

    const crossAccount = await fetch(
      `${mockBaseUrl}/api/telemetry/diagnostics/activity/${activityId}?owner_id=${mockOwnerUserId}`,
      { headers: { Authorization: `Bearer ${mockOtherBearerToken}` } },
    );
    expect(crossAccount.status).toBe(401);

    await expect(setAutomaticDiagnosticConsent(mockOwnerUserId, false)).resolves.toMatchObject({ enabled: false });
    const afterRevocation = await fetch(
      `${mockBaseUrl}/api/telemetry/diagnostics/activity/${activityId}?owner_id=${mockOwnerUserId}`,
      { headers: { 'X-API-Key': mockOperationsKey } },
    );
    expect(afterRevocation.status).toBe(200);
    expect((await afterRevocation.json()).count).toBe(0);
  });
  },
);
