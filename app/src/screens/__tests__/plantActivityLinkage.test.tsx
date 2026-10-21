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
let mockContentAdjust: (() => void) | null = null;
let mockDraftChange: ((patch: any) => void) | null = null;
let mockGpsLocked: ((...args: any[]) => void) | null = null;
let mockGpsCancel: (() => void) | null = null;
let mockPinConfirm: ((lat: number, lng: number) => void) | null = null;
let mockPinBack: (() => void) | null = null;
let mockContentProps: Record<string, any> | null = null;
const activityId = 'activity-client-id';
let mockAppUserId = 'owner-a';
let mockMarkerOwnerId = 'owner-a';
let mockTrackingState: Record<string, any>;
let mockRouteParams: Record<string, any>;

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    canGoBack: () => true,
    goBack: mockGoBack,
    replace: mockReplace,
  }),
  useRoute: () => ({ params: mockRouteParams }),
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
    (selector: (state: any) => unknown) => selector({ addMarker: mockAddMarker, markers: [], userId: mockMarkerOwnerId }),
    { getState: () => ({ addMarker: mockAddMarker, markers: [], userId: mockMarkerOwnerId }) },
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

jest.mock('../../features/plant/components/GpsLockStep', () => ({
  GpsLockStep: ({ onLocked, onCancel }: any) => {
    mockGpsLocked = onLocked;
    mockGpsCancel = onCancel;
    return null;
  },
}));
jest.mock('../../features/plant/components/PinAdjustStep', () => ({
  PinAdjustStep: ({ onConfirm, onBack }: any) => {
    mockPinConfirm = onConfirm;
    mockPinBack = onBack;
    return null;
  },
}));
jest.mock('../../features/plant/components/ContentStep', () => {
  const ReactModule = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    ContentStep: (props: any) => {
      const { onSubmit, onAdjustLocation, onDraftChange } = props;
      mockContentProps = props;
      mockContentSubmit = onSubmit;
      mockContentAdjust = onAdjustLocation;
      mockDraftChange = onDraftChange;
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

async function renderHydratedActivity() {
  const screen = render(<PlantScreen />);
  await waitFor(() => expect(mockContentSubmit).not.toBeNull());
  return screen;
}

describe('full Plant to Activity Detail Cairn linkage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockContentSubmit = null;
    mockContentAdjust = null;
    mockDraftChange = null;
    mockGpsLocked = null;
    mockGpsCancel = null;
    mockPinConfirm = null;
    mockPinBack = null;
    mockContentProps = null;
    mockAppUserId = 'owner-a';
    mockMarkerOwnerId = 'owner-a';
    mockRouteParams = {
      origin: {
        kind: 'activity',
        clientActivityId: activityId,
        ownerGeneration: 'activity-generation-1',
        activityMode: 'hiking',
      },
    };
    mockTrackingState = {
      status: 'tracking',
      activityMode: 'hiking',
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
    const screen = await renderHydratedActivity();

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

  test('coalesces two full-Plant submits in the same render turn into one durable commit', async () => {
    mockAddMarker.mockReturnValue(new Promise(() => {}));
    await renderHydratedActivity();
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
    const screen = await renderHydratedActivity();
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
    const screen = await renderHydratedActivity();
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
    expect(mockDraftSet).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockDraftSet.mock.calls[0][1]).draft).toMatchObject({
      title: 'Turn and return', text: 'Private Activity Cairn',
    });
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
    await renderHydratedActivity();
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
    const persisted = JSON.parse(mockDraftSet.mock.calls[0][1]);
    expect(persisted).toMatchObject({
      v: 5,
      ownerUserId: 'owner-a',
      scopeId: expect.stringContaining(`activity:${activityId}`),
      activityContext: {
        ownerUserId: 'owner-a',
        clientActivityId: activityId,
        ownerGeneration: 'activity-generation-1',
      },
      draft: {
        title: 'Retry', text: 'Preserve this', visibility: 'personal',
        lat: -41.2865, lng: 174.7762, gpsLat: -41.2865, gpsLng: 174.7762,
        accuracyM: 8, locationCapturedAtMs: 1_800_000_000_000,
        locationCaptureMethod: 'activity',
      },
    });
  });

  test('keeps words, audience, Activity identity, and fresh placement through adjust, failure, and retry', async () => {
    mockAddMarker
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({
        state: 'durably-accepted',
        ownerId: 'owner-a',
        projection: 'current',
        marker: { id: 'adjusted-cairn', clientCairnId: 'adjusted-cairn', originActivityClientId: activityId },
      });
    await renderHydratedActivity();
    await waitFor(() => expect(mockDraftGet).toHaveBeenCalled());

    act(() => {
      mockDraftChange!({
        title: 'Keep across adjustment',
        text: 'The same note returns after a fresh fix.',
        visibility: 'group',
      });
    });
    act(() => { mockContentAdjust!(); });
    expect(mockGpsLocked).not.toBeNull();
    act(() => {
      mockGpsLocked!(-41.287, 174.777, 6, 'real', 1_800_000_000_500, 4, 'activity');
    });
    expect(mockPinConfirm).not.toBeNull();
    act(() => { mockPinConfirm!(-41.2871, 174.7771); });

    const payload = {
      type: 'cairn',
      title: 'Keep across adjustment',
      text: 'The same note returns after a fresh fix.',
      voiceUri: null,
      voiceMs: null,
      visibility: 'group',
    };
    act(() => { mockContentSubmit!(payload); });
    await waitFor(() => expect(mockAlert).toHaveBeenCalledWith(
      "Couldn't plant this cairn",
      expect.stringContaining('draft is saved'),
      [{ text: 'OK' }],
    ));
    act(() => { mockContentSubmit!(payload); });
    await waitFor(() => expect(mockAddMarker).toHaveBeenCalledTimes(2));

    expect(mockAddMarker.mock.calls[0][0]).toMatchObject({
      note: 'Keep across adjustment\u001eThe same note returns after a fresh fix.',
      permission: 'group',
      lat: -41.2871,
      lng: 174.7771,
      placementAccuracyM: 6,
      placementObservedAtMs: 1_800_000_000_500,
      placementSampleCount: 4,
      placementSource: 'activity',
      activityContext: {
        clientActivityId: activityId,
        ownerGeneration: 'activity-generation-1',
      },
    });
    expect(mockAddMarker.mock.calls[1][0]).toEqual(mockAddMarker.mock.calls[0][0]);
    const persistedFailure = mockDraftSet.mock.calls
      .map(([, value]) => JSON.parse(value))
      .find(value => value?.draft?.title === 'Keep across adjustment');
    expect(persistedFailure).toMatchObject({
      v: 5,
      ownerUserId: 'owner-a',
      origin: { kind: 'activity', clientActivityId: activityId },
      draft: {
        title: 'Keep across adjustment',
        text: 'The same note returns after a fresh fix.',
        visibility: 'group',
        lat: -41.2871,
        lng: 174.7771,
      },
    });
  });

  test('does not transfer an Activity A draft into Activity B words, audience, place, or provenance', async () => {
    mockDraftGet.mockResolvedValueOnce(JSON.stringify({
      v: 4,
      ownerUserId: 'owner-a',
      sessionId: 'activity-a-plant',
      origin: {
        kind: 'activity', clientActivityId: 'activity-a',
        ownerGeneration: 'activity-a-generation', activityMode: 'hiking',
      },
      activityContext: {
        ownerUserId: 'owner-a', clientActivityId: 'activity-a',
        ownerGeneration: 'activity-a-generation',
      },
      savedAtMs: 1_799_000_000_000,
      draft: {
        title: 'Activity A words', text: 'Only for Activity A', type: 'cairn',
        visibility: 'group', lat: -45, lng: 170, gpsLat: -45, gpsLng: 170,
        accuracyM: 5, locationProvenance: 'real', locationCapturedAtMs: 1_799_000_000_000,
      },
    }));
    await renderHydratedActivity();
    expect(mockContentProps).toMatchObject({ title: '', text: '', visibility: 'personal' });
    act(() => { mockContentSubmit!({
      type: 'cairn', title: 'Activity B words', text: 'Only for Activity B',
      voiceUri: null, voiceMs: null, visibility: 'personal',
    }); });
    await waitFor(() => expect(mockAddMarker).toHaveBeenCalledTimes(1));
    expect(mockAddMarker.mock.calls[0][0]).toMatchObject({
      lat: -41.2865,
      lng: 174.7762,
    });
    expect(mockAddMarker.mock.calls[0][0].activityContext).toMatchObject({ clientActivityId: activityId });
  });

  test('resumes the exact same Activity draft with its original words, audience, and chosen place', async () => {
    mockDraftGet.mockResolvedValueOnce(JSON.stringify({
      v: 4,
      ownerUserId: 'owner-a',
      sessionId: 'same-activity-old-session',
      origin: mockRouteParams.origin,
      activityContext: {
        ownerUserId: 'owner-a', clientActivityId: activityId,
        ownerGeneration: 'activity-generation-1',
      },
      savedAtMs: 1_800_000_000_500,
      draft: {
        gpsLat: -41.287, gpsLng: 174.777, lat: -41.2871, lng: 174.7771,
        accuracyM: 6, locationProvenance: 'real', locationCapturedAtMs: 1_800_000_000_500,
        locationSampleCount: 4, locationCaptureMethod: 'activity', type: 'cairn',
        title: 'Same Activity', text: 'Keep this exact place', voiceUri: null, voiceMs: null,
        visibility: 'group',
      },
    }));
    await renderHydratedActivity();
    expect(mockContentProps).toMatchObject({
      title: 'Same Activity', text: 'Keep this exact place', visibility: 'group',
    });
    act(() => { mockContentSubmit!({
      type: 'cairn', title: 'Same Activity', text: 'Keep this exact place',
      voiceUri: null, voiceMs: null, visibility: 'group',
    }); });
    await waitFor(() => expect(mockAddMarker).toHaveBeenCalledTimes(1));
    expect(mockAddMarker.mock.calls[0][0]).toMatchObject({
      lat: -41.2871,
      lng: 174.7771,
      permission: 'group',
      activityContext: { clientActivityId: activityId },
    });
  });

  test('a standalone failed draft never bypasses a fresh GPS lock', async () => {
    mockRouteParams = { origin: { kind: 'standalone' } };
    mockTrackingState = { ...mockTrackingState, status: 'idle' };
    mockDraftGet.mockResolvedValueOnce(JSON.stringify({
      title: 'Saved words', text: '', type: 'cairn', visibility: 'personal',
      lat: -45, lng: 170, gpsLat: -45, gpsLng: 170, accuracyM: 5,
    }));
    const screen = render(<PlantScreen />);
    await waitFor(() => expect(screen.getByTestId('plant-resume-modal')).toBeTruthy());
    expect(mockContentSubmit).toBeNull();
    expect(mockAddMarker).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('plant-resume-discard'));
    await waitFor(() => expect(mockGpsLocked).not.toBeNull());
    expect(mockContentSubmit).toBeNull();
  });

  test('gates editing until delayed hydration resolves instead of overwriting newer typing', async () => {
    let resolveRead!: (value: string | null) => void;
    mockDraftGet.mockReturnValueOnce(new Promise(resolve => { resolveRead = resolve; }));
    const screen = render(<PlantScreen />);
    expect(screen.getByTestId('plant-draft-hydration')).toBeTruthy();
    expect(mockContentSubmit).toBeNull();
    expect(mockDraftChange).toBeNull();

    resolveRead(null);
    await waitFor(() => expect(mockContentSubmit).not.toBeNull());
    act(() => { mockDraftChange!({ title: 'Typed after hydration', text: 'Never overwritten' }); });
    await waitFor(() => expect(mockContentProps).toMatchObject({
      title: 'Typed after hydration', text: 'Never overwritten',
    }));
  });

  test('GPS Cancel during Adjust restores the editor, words, audience, pin, and Activity', async () => {
    await renderHydratedActivity();
    act(() => { mockDraftChange!({ title: 'Keep me', text: 'Still here', visibility: 'group' }); });
    act(() => { mockContentAdjust!(); });
    expect(mockGpsCancel).not.toBeNull();
    act(() => { mockGpsCancel!(); });

    await waitFor(() => expect(mockContentProps).toMatchObject({
      title: 'Keep me', text: 'Still here', visibility: 'group', activityLocation: true,
    }));
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  test('Pin Back during Adjust restores the original pin rather than exiting Plant', async () => {
    await renderHydratedActivity();
    act(() => { mockDraftChange!({ title: 'Original place', text: 'Do not move', visibility: 'personal' }); });
    act(() => { mockContentAdjust!(); });
    act(() => {
      mockGpsLocked!(-41.3, 174.8, 5, 'real', 1_800_000_000_900, 3, 'gps_window');
    });
    expect(mockPinBack).not.toBeNull();
    act(() => { mockPinBack!(); });

    await waitFor(() => expect(mockContentProps).toMatchObject({
      title: 'Original place', text: 'Do not move', visibility: 'personal',
      accuracyM: 8,
      capturedAtMs: 1_800_000_000_000,
    }));
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  test('first-entry GPS Cancel still exits the whole standalone flow', async () => {
    mockRouteParams = { origin: { kind: 'standalone' } };
    mockTrackingState = { ...mockTrackingState, status: 'idle' };
    render(<PlantScreen />);
    await waitFor(() => expect(mockGpsCancel).not.toBeNull());
    act(() => { mockGpsCancel!(); });
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  test('suppresses stale failure feedback when A becomes B while the retry draft write awaits', async () => {
    let releaseDraft!: () => void;
    mockDraftSet.mockReturnValueOnce(new Promise<void>(resolve => { releaseDraft = resolve; }));
    mockAddMarker.mockRejectedValueOnce(new Error('storage full'));
    await renderHydratedActivity();
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
    const view = await renderHydratedActivity();
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
