import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { linkedCairnsForActivity } from '../../features/activity/activityDetailPresentation';

const mockAddMarker = jest.fn();
const mockGoBack = jest.fn();
const mockReplace = jest.fn();
const mockGetCurrentRegion = jest.fn();
const mockDraftGet = jest.fn();
const mockDraftRemove = jest.fn();
const mockDraftSet = jest.fn();
let mockContentSubmit: ((payload: any) => void) | null = null;
const activityId = 'activity-client-id';
let mockAppUserId = 'owner-a';
let mockMarkerOwnerId = 'owner-a';
let mockTrackingState: Record<string, any>;

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    canGoBack: () => true,
    goBack: mockGoBack,
    replace: mockReplace,
  }),
}));

jest.mock('react-native-safe-area-context', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, ...props }: any) => ReactModule.createElement(View, props, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
  };
});

jest.mock('../../store/useMarkerStore', () => ({
  useMarkerStore: Object.assign(
    (selector: (state: any) => unknown) => selector({ addMarker: mockAddMarker, userId: mockMarkerOwnerId }),
    { getState: () => ({ addMarker: mockAddMarker, userId: mockMarkerOwnerId }) },
  ),
}));

jest.mock('../../store/useAppStore', () => ({
  useAppStore: Object.assign(
    (selector: (state: any) => unknown) => selector({ user: mockAppUserId ? { id: mockAppUserId } : null }),
    { getState: () => ({ user: mockAppUserId ? { id: mockAppUserId } : null }) },
  ),
}));

jest.mock('../../store/useTrackingStore', () => ({
  useTrackingStore: {
    getState: () => mockTrackingState,
  },
}));

jest.mock('../../features/activitySimulator/simulatorTime', () => ({
  activityFreshnessNow: () => 1_800_000_001_000,
}));

jest.mock('../../features/plant/components/GpsLockStep', () => ({ GpsLockStep: () => null }));
jest.mock('../../features/plant/components/PinAdjustStep', () => ({ PinAdjustStep: () => null }));
jest.mock('../../features/plant/components/ContentStep', () => {
  const ReactModule = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    ContentStep: ({ onSubmit }: any) => {
      mockContentSubmit = onSubmit;
      return ReactModule.createElement(
        Pressable,
        {
          testID: 'submit-full-plant',
          onPress: () => onSubmit({
            gpsLat: -41.2865,
            gpsLng: 174.7762,
            lat: -41.2865,
            lng: 174.7762,
            accuracyM: 8,
            type: 'cairn',
            title: 'Turn and return',
            text: 'Private Activity Cairn',
            voiceUri: null,
            voiceMs: null,
            visibility: 'personal',
          }),
        },
        ReactModule.createElement(Text, null, 'Submit full Plant'),
      );
    },
  };
});

jest.mock('../../features/public/services/publicCairns', () => ({
  usePublicCairnStore: (selector: (state: any) => unknown) => selector({ enabled: false }),
}));

jest.mock('../../services/networkMonitor', () => ({
  __esModule: true,
  default: { getState: () => ({ state: 'online' }) },
}));
jest.mock('../../services/appLog', () => ({ log: jest.fn() }));
jest.mock('../../services/hapticService', () => ({
  haptic: { notification: jest.fn() },
}));
jest.mock('../../hooks/useVisualTheme', () => ({
  useVisualTheme: () => ({ background: '#fff' }),
}));
jest.mock('../../store/storage', () => ({
  __esModule: true,
  storage: {
    getItem: (...args: unknown[]) => mockDraftGet(...args),
    removeItem: (...args: unknown[]) => mockDraftRemove(...args),
    setItem: (...args: unknown[]) => mockDraftSet(...args),
  },
}));
jest.mock('../../config/regions', () => ({
  getCurrentRegion: () => mockGetCurrentRegion(),
}));

import { getCurrentRegion } from '../../config/regions';
import { PlantScreen } from '../PlantScreen';

const mockAlert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

function activitySession() {
  return {
    id: activityId,
    clientActivityId: activityId,
    markerIds: [],
  };
}

describe('full Plant to Activity Detail Cairn linkage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockContentSubmit = null;
    mockAppUserId = 'owner-a';
    mockMarkerOwnerId = 'owner-a';
    mockTrackingState = {
      status: 'tracking',
      locationProviderSource: 'real',
      locationAvailable: true,
      lastCoordinate: { lat: -41.2865, lng: 174.7762, accuracy: 8 },
      lastCoordinateTime: 1_800_000_000_000,
      sessionId: activityId,
      ownerUserId: 'owner-a',
      liveOwnerGeneration: 'activity-generation-1',
    };
    mockDraftGet.mockResolvedValue(null);
    mockDraftRemove.mockResolvedValue(undefined);
    mockDraftSet.mockResolvedValue(undefined);
    mockGetCurrentRegion.mockReturnValue({ code: 'nz' });
    mockAddMarker.mockImplementation(async (payload: any) => ({
      state: 'durably-accepted',
      ownerId: 'owner-a',
      projection: 'current',
      marker: {
        ...payload,
        id: 'cairn-client-id',
        clientCairnId: 'cairn-client-id',
        originActivityClientId: activityId,
        createdAt: 1_800_000_001_000,
      },
    }));
  });

  test.each([
    ['nz'],
    ['test-south'],
  ])('uses canonical %s region so the origin-linked Cairn remains visible on Activity Detail', async regionCode => {
    mockGetCurrentRegion.mockReturnValue({ code: regionCode });
    const screen = render(<PlantScreen />);

    fireEvent.press(screen.getByTestId('submit-full-plant'));
    await waitFor(() => expect(mockAddMarker).toHaveBeenCalledTimes(1));

    const submitted = mockAddMarker.mock.calls[0][0];
    const created = (await mockAddMarker.mock.results[0].value).marker;
    const currentRegionMarkers = [created].filter(marker => marker.regionCode === getCurrentRegion().code);

    expect(created.originActivityClientId).toBe(activityId);
    expect(submitted).toMatchObject({
      type: 'cairn',
      permission: 'personal',
      lat: -41.2865,
      lng: 174.7762,
      regionCode,
    });
    expect(linkedCairnsForActivity(currentRegionMarkers, activitySession()).map(marker => marker.id))
      .toEqual(['cairn-client-id']);
  });

  test('coalesces two full-Plant submits in the same render turn into one durable commit', () => {
    mockAddMarker.mockReturnValue(new Promise(() => {}));
    render(<PlantScreen />);
    expect(mockContentSubmit).not.toBeNull();
    const payload = {
      type: 'cairn',
      title: 'Turn and return',
      text: 'Private Activity Cairn',
      voiceUri: null,
      voiceMs: null,
      visibility: 'personal',
    };

    act(() => {
      mockContentSubmit!(payload);
      mockContentSubmit!(payload);
    });

    expect(mockAddMarker).toHaveBeenCalledTimes(1);
  });

  test('captures S1 identity and rejects a submit after the Plant context has become S2', async () => {
    const screen = render(<PlantScreen />);
    mockTrackingState = {
      ...mockTrackingState,
      sessionId: 'activity-s2',
      liveOwnerGeneration: 'activity-generation-2',
    };

    fireEvent.press(screen.getByTestId('submit-full-plant'));
    await waitFor(() => expect(mockAddMarker).toHaveBeenCalledTimes(0));
    expect(Alert.alert).toHaveBeenCalledWith(
      "Couldn't plant this cairn",
      expect.stringContaining('Activity changed'),
      [{ text: 'OK' }],
    );
  });

  test('suppresses A feedback, navigation, and retry draft after durable acceptance resolves under B', async () => {
    let resolveCommit!: (value: any) => void;
    mockAddMarker.mockReturnValue(new Promise(resolve => { resolveCommit = resolve; }));
    const screen = render(<PlantScreen />);
    fireEvent.press(screen.getByTestId('submit-full-plant'));
    mockAppUserId = 'owner-b';
    mockMarkerOwnerId = 'owner-b';
    screen.unmount();
    resolveCommit({
      state: 'durably-accepted',
      ownerId: 'owner-a',
      projection: 'owner-changed',
      marker: { id: 'cairn-a', clientCairnId: 'cairn-a', originActivityClientId: activityId },
    });
    await act(async () => undefined);

    expect(mockGoBack).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockDraftSet).not.toHaveBeenCalled();
  });

  test('a true pre-commit failure unlocks one retry and retains the owner-scoped draft', async () => {
    mockAddMarker
      .mockRejectedValueOnce(new Error('storage full'))
      .mockResolvedValueOnce({
        state: 'durably-accepted',
        ownerId: 'owner-a',
        projection: 'current',
        marker: { id: 'retry-cairn', clientCairnId: 'retry-cairn', originActivityClientId: activityId },
      });
    render(<PlantScreen />);
    const payload = {
      type: 'cairn',
      title: 'Retry',
      text: 'Preserve this',
      voiceUri: null,
      voiceMs: null,
      visibility: 'personal',
    };
    act(() => { mockContentSubmit!(payload); });
    await waitFor(() => expect(mockAddMarker).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockAlert).toHaveBeenCalled());
    await waitFor(() => expect(mockDraftSet).toHaveBeenCalledTimes(1));
    act(() => { mockContentSubmit!(payload); });
    await waitFor(() => expect(mockAddMarker).toHaveBeenCalledTimes(2));
    expect(mockDraftSet.mock.calls[0][0]).toContain('owner-a');
  });

  test('suppresses stale failure feedback when A becomes B while the retry draft write awaits', async () => {
    let releaseDraft!: () => void;
    mockDraftSet.mockReturnValueOnce(new Promise<void>(resolve => { releaseDraft = resolve; }));
    mockAddMarker.mockRejectedValueOnce(new Error('storage full'));
    render(<PlantScreen />);
    act(() => { mockContentSubmit!({
      type: 'cairn',
      title: 'Owner A draft',
      text: '',
      voiceUri: null,
      voiceMs: null,
      visibility: 'personal',
    }); });
    await waitFor(() => expect(mockDraftSet).toHaveBeenCalledTimes(1));
    mockAppUserId = 'owner-b';
    mockMarkerOwnerId = 'owner-b';
    releaseDraft();
    await act(async () => undefined);

    expect(mockAlert).not.toHaveBeenCalled();
    expect(mockAddMarker).toHaveBeenCalledTimes(1);
  });

  test('post-Plant rediscovery choice keeps durable acceptance terminal', async () => {
    const view = render(<PlantScreen />);
    const payload = {
      type: 'cairn',
      title: 'One durable object',
      text: '',
      voiceUri: null,
      voiceMs: null,
      visibility: 'personal',
    };
    act(() => { mockContentSubmit!(payload); });
    await waitFor(() => expect(view.getByTestId('plant-success-modal')).toBeTruthy());
    act(() => { mockContentSubmit!(payload); });
    fireEvent.press(view.getByTestId('plant-success-back'));

    expect(mockAddMarker).toHaveBeenCalledTimes(1);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(mockDraftSet).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalledWith(
      "Couldn't plant this cairn",
      expect.any(String),
      expect.any(Array),
    );
  });
});
