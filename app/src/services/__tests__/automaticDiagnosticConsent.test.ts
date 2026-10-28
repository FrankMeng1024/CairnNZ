import AsyncStorage from '@react-native-async-storage/async-storage';

const mockAuthenticatedFetch = jest.fn();
const mockCurrentOwner = { value: 'owner-a' as string | null };

jest.mock('../apiService', () => ({
  authenticatedFetch: (...args: unknown[]) => mockAuthenticatedFetch(...args),
}));
jest.mock('../../store/useAppStore', () => ({
  useAppStore: { getState: () => ({ user: mockCurrentOwner.value ? { id: mockCurrentOwner.value } : null }) },
}));
jest.mock('../networkMonitor', () => ({
  __esModule: true,
  default: { isOnline: () => true },
  networkMonitor: { isOnline: () => true },
}));

import {
  getAutomaticDiagnosticConsent,
  setAutomaticDiagnosticConsent,
} from '../automaticDiagnosticConsent';
import {
  _resetAutomaticDiagnosticOutboxForTesting,
  captureAutomaticDiagnosticEvent,
  getAutomaticDiagnosticStatus,
} from '../automaticDiagnosticOutbox';

const policy = (enabled: boolean) => ({
  enabled,
  tier: enabled ? 'tier_b' : 'disabled',
  consentVersion: enabled ? 'activity-precise-v1' : null,
  enrolledAt: enabled ? '2026-10-28T00:00:00.000Z' : null,
  expiresAt: enabled ? '2026-11-27T00:00:00.000Z' : null,
});

describe('explicit automatic Activity diagnostics consent', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockCurrentOwner.value = 'owner-a';
    await AsyncStorage.clear();
    await _resetAutomaticDiagnosticOutboxForTesting();
  });

  test('adopts authenticated Tier B consent immediately and revocation purges precise queued evidence', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(new Response(JSON.stringify(policy(true)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    await expect(setAutomaticDiagnosticConsent('owner-a', true)).resolves.toMatchObject({
      enabled: true,
      tier: 'tier_b',
      consentVersion: 'activity-precise-v1',
    });
    expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      '/api/telemetry/diagnostics/consent',
      expect.objectContaining({
        method: 'PUT',
        expectedUserId: 'owner-a',
        body: JSON.stringify({ enabled: true, consentVersion: 'activity-precise-v1' }),
      }),
    );

    await captureAutomaticDiagnosticEvent({
      ownerUserId: 'owner-a',
      stream: {
        streamId: 'activity:consent-test',
        sourceType: 'activity',
        clientActivityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        activityMode: 'hiking',
      },
      eventCode: 'ACTIVITY_LOCATION_OBSERVED',
      sourceModule: 'automaticDiagnosticConsentTest',
      requiredPolicyTier: 'tier_b',
      details: { lat: -41.28664, lng: 174.77557, replayKind: 'raw-observation' },
    });
    expect(await getAutomaticDiagnosticStatus('owner-a', 'activity:consent-test')).toMatchObject({
      pendingCount: 1,
      quality: 'UPLOAD_PENDING',
    });

    mockAuthenticatedFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      ...policy(false),
      deletedStreams: 1,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await expect(setAutomaticDiagnosticConsent('owner-a', false)).resolves.toMatchObject({ enabled: false });
    expect(await getAutomaticDiagnosticStatus('owner-a', 'activity:consent-test')).toMatchObject({
      pendingCount: 0,
      quality: 'POLICY_DISABLED',
    });
    const stored = (await Promise.all((await AsyncStorage.getAllKeys()).map(async key => (
      await AsyncStorage.getItem(key)
    )))).join('\n');
    expect(stored).not.toMatch(/-41\.28664|174\.77557/);
  });

  test('never adopts a response after the signed-in account changes', async () => {
    mockAuthenticatedFetch.mockImplementationOnce(async () => {
      mockCurrentOwner.value = 'owner-b';
      return new Response(JSON.stringify(policy(true)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    await expect(setAutomaticDiagnosticConsent('owner-a', true)).rejects.toMatchObject({
      code: 'ACCOUNT_CHANGED',
    });
    await captureAutomaticDiagnosticEvent({
      ownerUserId: 'owner-a',
      stream: { streamId: 'app:stale-consent', sourceType: 'app' },
      eventCode: 'STALE_CONSENT',
      sourceModule: 'automaticDiagnosticConsentTest',
      requiredPolicyTier: 'tier_b',
      details: { lat: -41.2, lng: 174.7 },
    });
    expect(await getAutomaticDiagnosticStatus('owner-a', 'app:stale-consent')).toMatchObject({
      pendingCount: 0,
    });
  });

  test('reads policy with owner fencing and rejects malformed success bodies', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(new Response(JSON.stringify(policy(false)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    await expect(getAutomaticDiagnosticConsent('owner-a')).resolves.toMatchObject({ enabled: false });

    mockAuthenticatedFetch.mockResolvedValueOnce(new Response(JSON.stringify({ enabled: true, tier: 'tier_b' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    await expect(getAutomaticDiagnosticConsent('owner-a')).rejects.toMatchObject({
      code: 'DIAGNOSTIC_POLICY_INVALID',
    });
  });
});
