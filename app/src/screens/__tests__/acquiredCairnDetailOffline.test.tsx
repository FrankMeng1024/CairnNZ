import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockFetch = jest.fn();
const mockLoadCache = jest.fn();
const mockCacheHistory = jest.fn();
const mockHistoryToken = { ownerGeneration: 0, markerEpoch: 1 };
const mockBeginHistoryRequest = jest.fn((_ownerId: string, _markerId: string) => mockHistoryToken);
const mockHistoryRequestIsCurrent = jest.fn((
  _ownerId: string,
  _markerId: string,
  _request: typeof mockHistoryToken,
) => true);
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
  return {
    SafeAreaView: ({ children, ...props }: any) => ReactModule.createElement(View, props, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
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
  acquiredCairnHistoryRequestIsCurrent: (
    ownerId: string,
    markerId: string,
    request: typeof mockHistoryToken,
  ) => mockHistoryRequestIsCurrent(ownerId, markerId, request),
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
    mockHistoryRequestIsCurrent.mockReturnValue(true);
    mockLoadCache.mockResolvedValue([acquired]);
    mockCacheHistory.mockImplementation(async (_owner: string, _marker: string, rows: unknown[]) => rows);
    mockMarkUnavailable.mockResolvedValue(undefined);
    mockUpdateCache.mockResolvedValue(undefined);
  });

  test('network failure shows an explicit same-account offline acquired copy', async () => {
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    const screen = render(<AcquiredCairnDetailScreen />);
    expect(await screen.findByText('Already found page')).toBeTruthy();
    expect(screen.getByText(/keeps up to the latest 100 acquired versions/)).toBeTruthy();
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

  test('a transient Archive failure is serialized and keeps the readable page in place', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ revisions: [acquired] }) });
    let resolveArchive!: (value: any) => void;
    mockFetch.mockReturnValueOnce(new Promise(resolve => { resolveArchive = resolve; }));
    const screen = render(<AcquiredCairnDetailScreen />);
    await screen.findByText('Already found page');

    expect(screen.queryByText(/Hide from Current/)).toBeNull();
    fireEvent.press(screen.getByLabelText('Manage found Cairn'));
    expect(screen.getByText(/Hide from Current/)).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Archive from Current'));
    fireEvent.press(screen.getByText('Archiving…'));
    expect(mockFetch.mock.calls.filter(call => String(call[0]).includes('/collection'))).toHaveLength(1);
    await act(async () => { resolveArchive({ ok: false, status: 503 }); });

    expect(await screen.findByText('Archive did not complete. The Cairn is still here; check your connection and try again.')).toBeTruthy();
    expect(screen.getByText('Already found page')).toBeTruthy();
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(mockMarkUnavailable).not.toHaveBeenCalled();
  });

  test('an authoritative collection revocation invalidates the page instead of offering a false retry', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ revisions: [acquired] }) })
      .mockResolvedValueOnce({ ok: false, status: 410 });
    const screen = render(<AcquiredCairnDetailScreen />);
    await screen.findByText('Already found page');
    fireEvent.press(screen.getByLabelText('Manage found Cairn'));
    fireEvent.press(screen.getByLabelText('Archive from Current'));

    expect(await screen.findByText('This acquired Cairn is no longer available to this account.')).toBeTruthy();
    expect(mockMarkUnavailable).toHaveBeenCalledWith('owner-a', 'marker-1');
    expect(screen.queryByText('Already found page')).toBeNull();
  });

  test('Remove uses a deliberate in-sheet confirmation and Cancel returns to management', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ revisions: [acquired] }) });
    const screen = render(<AcquiredCairnDetailScreen />);
    await screen.findByText('Already found page');

    fireEvent.press(screen.getByLabelText('Manage found Cairn'));
    fireEvent.press(screen.getByLabelText('Remove from my Memory'));
    expect(screen.getByText('Remove from my Memory?')).toBeTruthy();
    expect(screen.getByText(/There is no in-app restore yet/)).toBeTruthy();
    expect(mockFetch.mock.calls.filter(call => String(call[0]).includes('/collection'))).toHaveLength(0);

    fireEvent.press(screen.getByText('Cancel'));
    expect(screen.getByText('Manage found Cairn')).toBeTruthy();
    expect(screen.queryByText('Remove from my Memory?')).toBeNull();
    expect(screen.getByText('Already found page')).toBeTruthy();
  });

  test('closing Manage preserves the selected page and does not issue an action', async () => {
    const earlier = { ...acquired, revision_id: 4, content_revision: 4, text: 'Earlier found page' };
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ revisions: [acquired, earlier] }) });
    mockCacheHistory.mockResolvedValueOnce([acquired, earlier]);
    const screen = render(<AcquiredCairnDetailScreen />);
    await screen.findByText('Already found page');
    fireEvent.press(screen.getByText('Earlier'));
    expect(screen.getByText('Earlier found page')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Manage found Cairn'));
    fireEvent.press(screen.getByLabelText('Close sheet'));
    expect(screen.getByText('Earlier found page')).toBeTruthy();
    expect(screen.queryByTestId('acquired-cairn-manage-sheet')).toBeNull();
    expect(mockFetch.mock.calls.filter(call => String(call[0]).includes('/collection'))).toHaveLength(0);
  });

  test('Remove is single-flight, preserves content on failure, and succeeds only after retry acceptance', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ revisions: [acquired] }) });
    let resolveRemove!: (value: any) => void;
    mockFetch.mockReturnValueOnce(new Promise(resolve => { resolveRemove = resolve; }));
    const screen = render(<AcquiredCairnDetailScreen />);
    await screen.findByText('Already found page');

    fireEvent.press(screen.getByLabelText('Manage found Cairn'));
    fireEvent.press(screen.getByLabelText('Remove from my Memory'));
    fireEvent.press(screen.getByLabelText('Confirm remove from my Memory'));
    fireEvent.press(screen.getByText('Removing…'));
    expect(mockFetch.mock.calls.filter(call => String(call[0]).includes('/collection'))).toHaveLength(1);
    await act(async () => { resolveRemove({ ok: false, status: 503 }); });

    expect(await screen.findByText('Remove did not complete. The Cairn is still here; check your connection and try again.')).toBeTruthy();
    expect(screen.getByText('Already found page')).toBeTruthy();
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(mockMarkUnavailable).not.toHaveBeenCalled();

    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
    fireEvent.press(screen.getByLabelText('Confirm remove from my Memory'));
    await waitFor(() => expect(mockMarkUnavailable).toHaveBeenCalledWith('owner-a', 'marker-1'));
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

  test('a delayed account-A Archive response cannot close account B or strand its management state', async () => {
    let resolveArchive!: (value: any) => void;
    const accountB = { ...acquired, revision_id: 8, content_revision: 8, text: 'Account B found page' };
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ revisions: [acquired] }) })
      .mockReturnValueOnce(new Promise(resolve => { resolveArchive = resolve; }))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ revisions: [accountB] }) });
    mockCacheHistory
      .mockResolvedValueOnce([acquired])
      .mockResolvedValueOnce([accountB]);
    const screen = render(<AcquiredCairnDetailScreen />);
    await screen.findByText('Already found page');
    fireEvent.press(screen.getByLabelText('Manage found Cairn'));
    fireEvent.press(screen.getByLabelText('Archive from Current'));

    mockOwnerId = 'owner-b';
    screen.rerender(<AcquiredCairnDetailScreen />);
    expect(await screen.findByText('Account B found page')).toBeTruthy();
    expect(screen.queryByTestId('acquired-cairn-manage-sheet')).toBeNull();
    await act(async () => { resolveArchive({ ok: true, status: 200 }); });

    expect(screen.getByText('Account B found page')).toBeTruthy();
    expect(mockGoBack).not.toHaveBeenCalled();
    fireEvent.press(screen.getByLabelText('Manage found Cairn'));
    expect(screen.getByLabelText('Archive from Current')).toBeTruthy();
  });

  test('N03 a marker invalidated after cache persistence never reaches the mounted detail', async () => {
    let resolveCache!: (rows: (typeof acquired)[]) => void;
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ revisions: [acquired] }) });
    mockCacheHistory.mockReturnValueOnce(new Promise(resolve => { resolveCache = resolve; }));
    const screen = render(<AcquiredCairnDetailScreen />);
    await waitFor(() => expect(mockCacheHistory).toHaveBeenCalledTimes(1));
    mockHistoryRequestIsCurrent.mockReturnValue(false);
    await act(async () => { resolveCache([acquired]); });
    expect(mockHistoryRequestIsCurrent).toHaveBeenCalledWith('owner-a', 'marker-1', mockHistoryToken);
    expect(await screen.findByText('This acquired Cairn is unavailable right now.')).toBeTruthy();
    expect(screen.queryByText('Already found page')).toBeNull();
  });

  test('N04 all 101 authorized online revisions remain reachable while offline scope is separately disclosed', async () => {
    const rows = Array.from({ length: 101 }, (_, index) => ({
      ...acquired,
      revision_id: 101 - index,
      content_revision: 101 - index,
      text: `page-${101 - index}`,
      opened_at: '2026-10-13T00:01:00.000Z',
    }));
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ revisions: rows }) });
    mockCacheHistory.mockResolvedValueOnce(rows);
    const screen = render(<AcquiredCairnDetailScreen />);
    expect(await screen.findByText('1 of 101')).toBeTruthy();
    expect(screen.getByText('page-101')).toBeTruthy();
    for (let index = 0; index < 100; index += 1) fireEvent.press(screen.getByText('Earlier'));
    expect(screen.getByText('101 of 101')).toBeTruthy();
    expect(screen.getByText('page-1')).toBeTruthy();
    expect(screen.queryByText(/keeps up to the latest 100/)).toBeNull();
  });
});
