import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGoBack = jest.fn();
const mockLoadDetail = jest.fn();
const mockThanks = jest.fn();
const mockHide = jest.fn();
const mockBlockAuthor = jest.fn();
const mockReport = jest.fn();

const detail = {
  id: '501', author: { id: 'author-a', name: 'Alice' }, type: 'cairn',
  lat: -41.2865, lng: 174.7762, approximate: true,
  createdAt: 1_800_000_000_000, encounteredAt: 1_800_000_001_000,
  readOnly: true as const, resourceRevision: 'resource-v1', authorizationRevision: 'auth-v1',
  authorizationIssuedAt: 1_799_999_000_000, authorizationExpiresAt: 1_800_086_400_000,
  text: 'A useful note\nThe bridge is quiet after rain.', displayText: 'A useful note',
};

const publicState: any = {
  details: { '501': detail },
  loadDetail: (...args: any[]) => mockLoadDetail(...args),
  thanks: (...args: any[]) => mockThanks(...args),
  hide: (...args: any[]) => mockHide(...args),
  blockAuthor: (...args: any[]) => mockBlockAuthor(...args),
  report: (...args: any[]) => mockReport(...args),
};

jest.mock('react-native-safe-area-context', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, ...props }: any) => ReactModule.createElement(View, props, children),
    useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
  };
});

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
  useRoute: () => ({ params: { cairnId: '501' } }),
}));

jest.mock('../../hooks/useVisualTheme', () => {
  const { DAY_VISUAL_THEME } = jest.requireActual('../../components/tokens');
  return { useVisualTheme: () => DAY_VISUAL_THEME };
});

jest.mock('../../hooks/useMapTheme', () => ({ useMapTheme: () => 'day' }));

jest.mock('../../features/memory/components/CairnPinsLayer', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return { CairnPin: () => ReactModule.createElement(View, { testID: 'public-cairn-pin' }) };
});

jest.mock('../../features/public/services/publicCairns', () => ({
  usePublicCairnStore: (selector: (state: any) => unknown) => selector(publicState),
}));

import { PublicCairnDetailScreen } from '../PublicCairnDetailScreen';

describe('PublicCairnDetailScreen durable action feedback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadDetail.mockResolvedValue(detail);
    mockThanks.mockResolvedValue(true);
    mockHide.mockResolvedValue(true);
    mockBlockAuthor.mockResolvedValue(true);
    mockReport.mockResolvedValue(true);
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  test('a durably queued offline Hide reports that state and leaves Detail only after local commit', async () => {
    mockHide.mockResolvedValue(false);
    const screen = render(<PublicCairnDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('public-cairn-detail')).toBeTruthy());

    fireEvent.press(screen.getByText('Hide'));
    fireEvent.press(screen.getByText('Hide Cairn'));

    await waitFor(() => expect(mockHide).toHaveBeenCalledWith('501'));
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith(
      'Hidden here',
      'This change is saved on this device and will retry when you are connected.',
    ));
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  test('a failed durable Hide remains on Detail with retry feedback', async () => {
    mockHide.mockRejectedValue(new Error('storage unavailable'));
    const screen = render(<PublicCairnDetailScreen />);
    fireEvent.press(await screen.findByText('Hide'));
    fireEvent.press(screen.getByText('Hide Cairn'));

    await waitFor(() => expect(screen.getByText(
      'Could not save that change on this device. Nothing was sent; please try again.',
    )).toBeTruthy());
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(screen.getByTestId('public-cairn-detail')).toBeTruthy();
  });

  test('a failed durable Report clears pending state and keeps the draft for retry', async () => {
    mockReport.mockRejectedValue(new Error('storage unavailable'));
    const screen = render(<PublicCairnDetailScreen />);
    fireEvent.press(await screen.findByText('Report'));
    const input = screen.getByLabelText('Report context');
    fireEvent.changeText(input, 'Please review this context.');
    fireEvent.press(screen.getByTestId('public-report-submit'));

    await waitFor(() => expect(screen.getByText(
      'Could not save this report on your device. Your draft is still here; please try again.',
    )).toBeTruthy());
    expect(screen.getByDisplayValue('Please review this context.')).toBeTruthy();
    expect(screen.getByText('Submit report')).toBeTruthy();
  });
});
