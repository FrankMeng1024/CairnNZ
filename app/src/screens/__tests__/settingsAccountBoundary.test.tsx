import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const accountA = {
  id: 'owner-a', name: 'Owner A', email: 'a@example.com', hasPassword: true, providers: [],
};
const accountB = {
  id: 'owner-b', name: 'Owner B', email: 'b@example.com', hasPassword: true, providers: [],
};

const mockSetUser = jest.fn((user: any) => {
  mockAppState.user = user;
  mockAppState.isLoggedIn = Boolean(user);
});
const mockAppState: any = {
  user: accountA,
  isLoggedIn: true,
  setUser: mockSetUser,
  logout: jest.fn(async () => undefined),
};
const mockGetMe = jest.fn();
const mockPatchName = jest.fn();
const mockDeleteAllMemoryFromServer = jest.fn();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}

jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0', nativeBuildVersion: '1' }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }));
jest.mock('expo-location', () => ({
  PermissionStatus: { GRANTED: 'granted' },
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted', canAskAgain: true })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted', canAskAgain: true })),
}));
jest.mock('react-native-safe-area-context', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return { SafeAreaView: ({ children, ...props }: any) => ReactModule.createElement(View, props, children) };
});
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn() }),
}));
jest.mock('../../components/BackButton', () => {
  const ReactModule = require('react');
  const { Pressable, Text } = require('react-native');
  return { BackButton: ({ onPress }: any) => ReactModule.createElement(Pressable, { onPress }, ReactModule.createElement(Text, null, 'Back')) };
});
jest.mock('../../components/ContentSurface', () => {
  const ReactModule = require('react');
  const { Pressable, View } = require('react-native');
  return {
    ContentSurface: ({ children, onPress, testID, ...props }: any) => onPress
      ? ReactModule.createElement(Pressable, { ...props, testID, onPress }, children)
      : ReactModule.createElement(View, { ...props, testID }, children),
  };
});
jest.mock('../../components/Icon', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return { Icon: ({ name }: any) => ReactModule.createElement(View, { testID: `icon-${name}` }) };
});
jest.mock('../../components/ModalCard', () => {
  const ReactModule = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    ModalCard: ({ visible, children, testID }: any) => visible
      ? ReactModule.createElement(View, { testID }, children)
      : null,
    ModalCardHeader: ({ title, body, onClose }: any) => ReactModule.createElement(View, null,
      ReactModule.createElement(Text, null, title),
      body ? ReactModule.createElement(Text, null, body) : null,
      onClose
        ? ReactModule.createElement(
            Pressable,
            { testID: 'settings-modal-close', onPress: onClose, accessibilityRole: 'button' },
            ReactModule.createElement(Text, null, 'Close dialog'),
          )
        : null,
    ),
  };
});
jest.mock('../../components/PrimaryButton', () => {
  const ReactModule = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    PrimaryButton: ({ label, onPress, disabled, loading, testID }: any) => ReactModule.createElement(
      Pressable,
      {
        testID,
        onPress,
        disabled: Boolean(disabled || loading),
        accessibilityRole: 'button',
        accessibilityState: { disabled: Boolean(disabled || loading), busy: Boolean(loading) },
      },
      ReactModule.createElement(Text, null, label),
    ),
  };
});
jest.mock('../../components/SegmentedControl', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return { SegmentedControl: (props: any) => ReactModule.createElement(View, { testID: props.testID }) };
});
jest.mock('../../components/TextField', () => {
  const ReactModule = require('react');
  const { TextInput, View, Text } = require('react-native');
  return {
    TextField: ({ value, onChangeText, testID, error }: any) => ReactModule.createElement(
      View,
      null,
      ReactModule.createElement(TextInput, { value, onChangeText, testID }),
      error ? ReactModule.createElement(Text, null, error) : null,
    ),
  };
});
jest.mock('../../hooks/useVisualTheme', () => {
  const { DAY_VISUAL_THEME } = jest.requireActual('../../components/tokens');
  return { useVisualTheme: () => DAY_VISUAL_THEME };
});
jest.mock('../../hooks/useScenicTimeState', () => ({
  useScenicTimeState: () => ({ timeOfDay: 'day', sunriseMs: 1, sunsetMs: 2 }),
}));
jest.mock('../../utils/homeBackground', () => ({
  getHomeBackground: () => ({
    bgAsset: 1,
    settingsBackgroundColor: '#fff',
    settingsVeilColor: 'transparent',
    settingsCardBackgroundColor: '#fff',
    settingsCardBorderColor: '#ccc',
    textColor: '#111',
    textShadowColor: 'transparent',
  }),
  getWeatherReviewBackground: () => ({
    bgAsset: 1,
    settingsBackgroundColor: '#fff',
    settingsVeilColor: 'transparent',
    settingsCardBackgroundColor: '#fff',
    settingsCardBorderColor: '#ccc',
    textColor: '#111',
    textShadowColor: 'transparent',
  }),
  getRegisteredBackgroundLayout: () => ({}),
}));
jest.mock('../../store/useAppStore', () => {
  const hook: any = (selector: (state: any) => unknown) => selector(mockAppState);
  hook.getState = () => mockAppState;
  hook.setState = (patch: any) => Object.assign(mockAppState, typeof patch === 'function' ? patch(mockAppState) : patch);
  return { useAppStore: hook };
});
jest.mock('../../store/useSettingsStore', () => ({
  useSettingsStore: (selector: (state: any) => unknown) => selector({
    units: 'metric', appearance: 'auto', hapticFeedback: true, updateSetting: jest.fn(),
  }),
}));
jest.mock('../../features/memory/store/useMemorySettingsStore', () => ({
  useMemorySettingsStore: (selector: (state: any) => unknown) => selector({
    foregroundAutoUnlockEnabled: false, set: jest.fn(),
  }),
}));
jest.mock('../../store/useWeatherStore', () => ({
  useWeatherStore: (selector: (state: any) => unknown) => selector({ condition: 'clear', conditionOverride: null }),
}));
jest.mock('../../services/authService', () => ({
  getMe: (...args: unknown[]) => mockGetMe(...args),
  patchName: (...args: unknown[]) => mockPatchName(...args),
  changePassword: jest.fn(async () => ({})),
  deleteAccount: jest.fn(async () => ({})),
  fetchExportHistory: jest.fn(async () => ({ exports: [] })),
  logout: jest.fn(async () => undefined),
  requestDataExport: jest.fn(async () => ({})),
  submitFeedback: jest.fn(async () => ({ acknowledged: true })),
}));
jest.mock('../../services/accountLocalData', () => ({
  completeDeletedAccountLocalPurge: jest.fn(async () => undefined),
  scheduleDeletedAccountLocalPurge: jest.fn(async () => undefined),
}));
jest.mock('../../services/credentialsStore', () => ({ clearCredentials: jest.fn(async () => undefined) }));
jest.mock('../../services/memorySync', () => ({
  deleteAllMemoryFromServer: (...args: unknown[]) => mockDeleteAllMemoryFromServer(...args),
}));
jest.mock('../../services/hapticService', () => ({ haptic: { selection: jest.fn() } }));
jest.mock('../../config/api', () => ({ PRIVACY_URL: 'https://example.test/privacy' }));

import { SettingsScreen } from '../SettingsScreen';

function installAccount(user: typeof accountA) {
  mockAppState.user = user;
  mockAppState.isLoggedIn = true;
}

describe('Settings normal-handler account and action boundaries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installAccount(accountA);
    mockGetMe.mockImplementation(async () => ({ ...mockAppState.user }));
    mockPatchName.mockResolvedValue({ user: accountA });
    mockDeleteAllMemoryFromServer.mockResolvedValue(true);
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  test('SET-ACCOUNT-01 drops a delayed account-A profile refresh after B becomes current', async () => {
    const oldProfile = deferred<any>();
    mockGetMe.mockImplementationOnce(() => oldProfile.promise);
    const screen = render(<SettingsScreen />);
    await waitFor(() => expect(mockGetMe).toHaveBeenCalledTimes(1));

    act(() => {
      installAccount(accountB);
      screen.rerender(<SettingsScreen />);
    });
    oldProfile.resolve({ ...accountA, name: 'Late Owner A' });
    await act(async () => { await oldProfile.promise; await Promise.resolve(); });

    expect(mockAppState.user).toEqual(accountB);
    expect(mockSetUser).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'owner-a' }));
  });

  test('SET-SAVE-01 preserves B and the A draft when A name-save resolves after the switch', async () => {
    const oldSave = deferred<any>();
    mockPatchName.mockImplementationOnce(() => oldSave.promise);
    const screen = render(<SettingsScreen />);
    await waitFor(() => expect(mockGetMe).toHaveBeenCalled());
    fireEvent.press(screen.getByTestId('settings-account-row'));
    fireEvent.press(await screen.findByTestId('settings-edit-name'));
    fireEvent.changeText(screen.getByTestId('settings-name-input'), 'Owner A draft');
    fireEvent.press(screen.getByTestId('settings-name-save'));
    expect(mockPatchName).toHaveBeenCalledWith('Owner A draft');

    act(() => {
      installAccount(accountB);
      screen.rerender(<SettingsScreen />);
    });
    oldSave.resolve({ user: { ...accountA, name: 'Saved Owner A' } });
    await act(async () => { await oldSave.promise; await Promise.resolve(); });

    expect(mockAppState.user).toEqual(accountB);
    expect(screen.getByTestId('settings-name-modal')).toBeTruthy();
    expect(screen.getByDisplayValue('Owner A draft')).toBeTruthy();
    expect(screen.getByTestId('settings-name-save').props.accessibilityState).toMatchObject({ busy: false });
  });

  test('SET-DELETE-01 exploration deletion is hard single-flight with one terminal result', async () => {
    const deletion = deferred<boolean>();
    mockDeleteAllMemoryFromServer.mockImplementation(() => deletion.promise);
    const screen = render(<SettingsScreen />);
    await waitFor(() => expect(mockGetMe).toHaveBeenCalled());
    fireEvent.press(screen.getByTestId('settings-privacy-row'));
    const deleteRow = await screen.findByTestId('settings-delete-exploration');
    fireEvent.press(deleteRow);

    const confirmation = (Alert.alert as jest.Mock).mock.calls.find(
      ([title]) => title === 'Delete exploration history?',
    );
    const destructive = confirmation?.[2]?.find((button: any) => button.text === 'Delete history');
    expect(destructive?.onPress).toEqual(expect.any(Function));
    act(() => {
      destructive.onPress();
      destructive.onPress();
    });

    expect(mockDeleteAllMemoryFromServer).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('settings-delete-exploration').props.accessibilityState)
      .toMatchObject({ disabled: true, busy: true });

    deletion.resolve(true);
    await waitFor(() => expect((Alert.alert as jest.Mock).mock.calls.filter(
      ([title]) => title === 'Exploration history deleted',
    )).toHaveLength(1));
    expect(screen.getByTestId('settings-delete-exploration').props.accessibilityState)
      .toMatchObject({ disabled: false, busy: false });
  });

  test('SET/DELETE-OWNER-02 suppresses A feedback and releases B UI after an account switch', async () => {
    const deletion = deferred<boolean>();
    mockDeleteAllMemoryFromServer.mockImplementation(() => deletion.promise);
    const screen = render(<SettingsScreen />);
    await waitFor(() => expect(mockGetMe).toHaveBeenCalled());
    fireEvent.press(screen.getByTestId('settings-privacy-row'));
    fireEvent.press(await screen.findByTestId('settings-delete-exploration'));
    const confirmation = (Alert.alert as jest.Mock).mock.calls.find(
      ([title]) => title === 'Delete exploration history?',
    );
    const destructive = confirmation?.[2]?.find((button: any) => button.text === 'Delete history');
    act(() => destructive.onPress());
    expect(mockDeleteAllMemoryFromServer).toHaveBeenCalledWith('owner-a');

    act(() => {
      installAccount(accountB);
      screen.rerender(<SettingsScreen />);
    });
    expect(screen.getByTestId('settings-delete-exploration').props.accessibilityState)
      .toMatchObject({ disabled: false, busy: false });

    deletion.resolve(true);
    await act(async () => { await deletion.promise; await Promise.resolve(); });
    expect((Alert.alert as jest.Mock).mock.calls.filter(
      ([title]) => title === 'Exploration history deleted' || title === 'Could not delete history',
    )).toHaveLength(0);
    expect(screen.getByTestId('settings-delete-exploration').props.accessibilityState)
      .toMatchObject({ disabled: false, busy: false });
  });

  test('SET/NAME-RETRY-01 an A-owned draft cannot be retried under B', async () => {
    const oldSave = deferred<any>();
    mockPatchName.mockImplementationOnce(() => oldSave.promise);
    const screen = render(<SettingsScreen />);
    await waitFor(() => expect(mockGetMe).toHaveBeenCalled());
    fireEvent.press(screen.getByTestId('settings-account-row'));
    fireEvent.press(await screen.findByTestId('settings-edit-name'));
    fireEvent.changeText(screen.getByTestId('settings-name-input'), 'Owner A private draft');
    fireEvent.press(screen.getByTestId('settings-name-save'));
    expect(mockPatchName).toHaveBeenCalledTimes(1);

    act(() => {
      installAccount(accountB);
      screen.rerender(<SettingsScreen />);
    });
    oldSave.resolve({ user: { ...accountA, name: 'Saved A' } });
    await act(async () => { await oldSave.promise; await Promise.resolve(); });

    fireEvent.press(screen.getByTestId('settings-name-save'));
    expect(mockPatchName).toHaveBeenCalledTimes(1);
    expect(mockAppState.user).toEqual(accountB);
  });

  test('SET/PROFILE-ORDER-01 an older A refresh cannot overwrite a newer A refresh', async () => {
    const older = deferred<any>();
    const newer = deferred<any>();
    mockGetMe
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);
    const screen = render(<SettingsScreen />);
    await waitFor(() => expect(mockGetMe).toHaveBeenCalledTimes(1));
    fireEvent.press(screen.getByTestId('settings-account-row'));
    await waitFor(() => expect(mockGetMe).toHaveBeenCalledTimes(2));

    newer.resolve({ ...accountA, name: 'Newest A' });
    await act(async () => { await newer.promise; await Promise.resolve(); });
    expect(mockAppState.user.name).toBe('Newest A');

    older.resolve({ ...accountA, name: 'Older A' });
    await act(async () => { await older.promise; await Promise.resolve(); });
    expect(mockAppState.user.name).toBe('Newest A');
  });

  test('SET/NAME-CLOSE-01 the header close is unavailable while Save is in flight', async () => {
    const save = deferred<any>();
    mockPatchName.mockImplementationOnce(() => save.promise);
    const screen = render(<SettingsScreen />);
    await waitFor(() => expect(mockGetMe).toHaveBeenCalled());
    fireEvent.press(screen.getByTestId('settings-account-row'));
    fireEvent.press(await screen.findByTestId('settings-edit-name'));
    fireEvent.changeText(screen.getByTestId('settings-name-input'), 'Saving A');
    fireEvent.press(screen.getByTestId('settings-name-save'));

    expect(screen.queryByTestId('settings-modal-close')).toBeNull();
    expect(screen.getByTestId('settings-name-modal')).toBeTruthy();

    save.resolve({ user: { ...accountA, name: 'Saving A' } });
    await act(async () => { await save.promise; await Promise.resolve(); });
  });
});
