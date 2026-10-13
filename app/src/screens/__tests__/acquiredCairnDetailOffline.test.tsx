import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockFetch = jest.fn();
const mockLoadCache = jest.fn();
const mockCacheHistory = jest.fn();
const mockBeginHistoryRequest = jest.fn((_ownerId: string, _markerId: string) => 1);
const mockMarkUnavailable = jest.fn();
const mockUpdateCache = jest.fn();
const mockGoBack = jest.fn();
let mockOwnerId = 'owner-a';

const acquired = {
  revision_id: 5, content_revision: 5, type: 'text', text: 'Already found page',
  source_audience: 'public', availability: 'available', acquired_at: '2026-10-13T00:00:00.000Z',
  opened_at: '2026-10-13T00:01:00.000Z', thanked_at: null,
};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
  useRoute: () => ({ params: { markerId: 'marker-1' } }),
}));
jest.mock('react-native-safe-area-context', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return { SafeAreaView: ({ children, ...props }: any) => ReactModule.createElement(View, props, children) };
});
jest.mock('../../components/BackButton', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return { BackButton: () => ReactModule.createElement(View) };
});
jest.mock('../../components/Icon', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return { Icon: ({ name }: any) => ReactModule.createElement(View, { testID: `icon-${name}` }) };
});
jest.mock('../../components/ContentSurface', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return { ContentSurface: ({ children, ...props }: any) => ReactModule.createElement(View, props, children) };
});
jest.mock('../../components/PrimaryButton', () => {
  const ReactModule = require('react');
  const { Text, TouchableOpacity } = require('react-native');
  return { PrimaryButton: ({ label, onPress, disabled }: any) => ReactModule.createElement(
    TouchableOpacity, { onPress, disabled, accessibilityRole: 'button' }, ReactModule.createElement(Text, null, label),
  ) };
});
jest.mock('../../hooks/useVisualTheme', () => {
  const { DAY_VISUAL_THEME } = jest.requireActual('../../components/tokens');
  return { useVisualTheme: () => DAY_VISUAL_THEME };
});
jest.mock('../../store/useAppStore', () => {
  const hook: any = (selector: (state: any) => unknown) => selector({ user: { id: mockOwnerId } });
  hook.getState = () => ({ user: { id: mockOwnerId } });
  return { useAppStore: hook };
});
jest.mock('../../services/apiService', () => ({ authenticatedFetch: (...args: any[]) => mockFetch(...args) }));
jest.mock('../../features/cairns/acquiredCairnHistoryCache', () => ({
  beginAcquiredCairnHistoryRequest: (ownerId: string, markerId: string) => mockBeginHistoryRequest(ownerId, markerId),
  loadCachedAcquiredCairnHistory: (...args: any[]) => mockLoadCache(...args),
  cacheAcquiredCairnHistory: (...args: any[]) => mockCacheHistory(...args),
  markAcquiredCairnKnownUnavailable: (...args: any[]) => mockMarkUnavailable(...args),
  updateCachedAcquiredRevision: (...args: any[]) => mockUpdateCache(...args),
}));
jest.mock('../../features/cairns/cairnPresentationStore', () => ({
  useCairnPresentationStore: { getState: () => ({ refreshAcquiredMap: jest.fn() }) },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'submission-1' }));

import { AcquiredCairnDetailScreen } from '../AcquiredCairnDetailScreen';

describe('AcquiredCairnDetail offline entitlement boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOwnerId = 'owner-a';
    mockLoadCache.mockResolvedValue([acquired]);
    mockCacheHistory.mockImplementation(async (_owner: string, _marker: string, rows: unknown[]) => rows);
    mockMarkUnavailable.mockResolvedValue(undefined);
    mockUpdateCache.mockResolvedValue(undefined);
  });

  test('network failure shows an explicit same-account offline acquired copy', async () => {
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    const screen = render(<AcquiredCairnDetailScreen />);
    expect(await screen.findByText('Already found page')).toBeTruthy();
    expect(screen.getByText(/Offline copy of versions already acquired/)).toBeTruthy();
    expect(mockLoadCache).toHaveBeenCalledWith('owner-a', 'marker-1');
  });

  test('known server removal tombstones the cache and never falls back to stale content', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    const screen = render(<AcquiredCairnDetailScreen />);
    expect(await screen.findByText('This acquired Cairn is unavailable right now.')).toBeTruthy();
    expect(mockMarkUnavailable).toHaveBeenCalledWith('owner-a', 'marker-1');
    expect(mockLoadCache).not.toHaveBeenCalled();
    expect(screen.queryByText('Already found page')).toBeNull();
  });

  test('Thanks is single-flight and failed action remains visible/retryable', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ revisions: [acquired] }) });
    let resolveThanks!: (value: any) => void;
    const pending = new Promise(resolve => { resolveThanks = resolve; });
    mockFetch.mockReturnValueOnce(pending);
    const screen = render(<AcquiredCairnDetailScreen />);
    await screen.findByText('Already found page');
    fireEvent.press(screen.getByText('Thanks'));
    fireEvent.press(screen.getByText('Thanks'));
    expect(mockFetch.mock.calls.filter(call => String(call[0]).includes('/thanks'))).toHaveLength(1);
    await act(async () => { resolveThanks({ ok: false, status: 503 }); });
    expect(await screen.findByText('Could not send Thanks. Try again later.')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Thanks')).toBeTruthy());
  });

  test('a delayed account-A history response cannot render or cache after switching to B', async () => {
    let resolveA!: (value: any) => void;
    mockFetch.mockReturnValueOnce(new Promise(resolve => { resolveA = resolve; }));
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    mockLoadCache.mockResolvedValueOnce(null);
    const screen = render(<AcquiredCairnDetailScreen />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    mockOwnerId = 'owner-b';
    screen.rerender(<AcquiredCairnDetailScreen />);
    expect(await screen.findByText('This acquired Cairn is unavailable right now.')).toBeTruthy();
    await act(async () => {
      resolveA({ ok: true, status: 200, json: async () => ({ revisions: [acquired] }) });
      await Promise.resolve();
    });

    expect(mockCacheHistory).not.toHaveBeenCalled();
    expect(screen.queryByText('Already found page')).toBeNull();
  });
});
