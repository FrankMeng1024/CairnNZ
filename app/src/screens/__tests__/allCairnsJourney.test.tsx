import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockLoadLibrary = jest.fn(async () => undefined);
const mockFetch = jest.fn();
const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn(), navigate: mockNavigate }),
  useRoute: () => ({ params: undefined }),
}));
jest.mock('../../components/BackButton', () => ({
  BackButton: () => {
    const MockText = require('react-native').Text;
    return <MockText>Back</MockText>;
  },
}));
jest.mock('../../hooks/useVisualTheme', () => {
  const { DAY_VISUAL_THEME } = jest.requireActual('../../components/tokens');
  return { useVisualTheme: () => DAY_VISUAL_THEME };
});
jest.mock('../../store/useSettingsStore', () => ({
  useSettingsStore: (selector: any) => selector({ debugMode: false }),
}));
jest.mock('../../store/useAppStore', () => ({
  useAppStore: (selector: any) => selector({ user: { id: 'owner-a' } }),
}));
jest.mock('../../store/useMarkerStore', () => ({
  useMarkerStore: (selector: any) => selector({
    markers: [],
    libraryRemoteMarkers: [],
    libraryCoverage: 'complete',
    libraryLoading: false,
    libraryError: null,
    libraryHasMore: false,
    libraryQuery: '',
    loadCairnLibrary: mockLoadLibrary,
    retryMarkerSync: jest.fn(),
  }),
}));
jest.mock('../../services/apiService', () => ({
  authenticatedFetch: (...args: any[]) => mockFetch(...args),
}));
jest.mock('../../features/cairns/cairnPresentationStore', () => ({
  useCairnPresentationStore: {
    getState: () => ({ refreshAcquiredMap: jest.fn() }),
  },
}));
jest.mock('../../features/memory/components/CairnPinV10', () => ({
  CairnPinV10: () => null,
}));

import { AllCairnsScreen } from '../AllCairnsScreen';

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

describe('Cairn Library ordinary tab journey', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('acknowledges the target tab immediately, keeps each query, and reuses loaded Found content', async () => {
    let releaseFound!: () => void;
    const gate = new Promise<void>(resolve => { releaseFound = resolve; });
    mockFetch.mockImplementation(async () => {
      await gate;
      return ok({ cairns: [], has_more: false, next_cursor: null });
    });

    const screen = render(<AllCairnsScreen />);
    const search = screen.getByTestId('all-cairns-search');
    fireEvent.changeText(search, 'ridge');
    expect(screen.getByTestId('all-cairns-search').props.value).toBe('ridge');

    const tapStartedAt = performance.now();
    fireEvent.press(screen.getByTestId('cairn-library-found'));
    expect(screen.getByTestId('cairn-library-found').props.accessibilityState).toMatchObject({ selected: true });
    const intentAckMs = performance.now() - tapStartedAt;
    expect(intentAckMs).toBeLessThanOrEqual(100);
    process.stdout.write(`library-react-intent-ack-ms=${intentAckMs.toFixed(2)}\n`);
    expect(screen.getByTestId('all-cairns-search').props.value).toBe('');
    fireEvent.changeText(screen.getByTestId('all-cairns-search'), 'fern');
    expect(screen.getByTestId('all-cairns-search').props.value).toBe('fern');

    // Selection ACK is intentionally one paint ahead of target acquisition.
    // Wait for the independent target request before releasing its response;
    // the already-mounted empty panel is not proof that loading completed.
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    releaseFound();
    await waitFor(() => expect(screen.getByTestId('found-cairns-empty')).toBeTruthy());
    expect(mockFetch).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('cairn-library-left'));
    expect(screen.getByTestId('all-cairns-search').props.value).toBe('ridge');
    fireEvent.press(screen.getByTestId('cairn-library-found'));
    expect(screen.getByTestId('all-cairns-search').props.value).toBe('fern');
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  });

  test('a failed Found target terminates with panel-local error and does not refetch-loop', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    const screen = render(<AllCairnsScreen />);

    fireEvent.press(screen.getByTestId('cairn-library-found'));
    await waitFor(() => expect(screen.getByText('Connect to refresh acquired Cairns.')).toBeTruthy());
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
