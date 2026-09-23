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
  logout: jest.fn(async () => true),
};
const mockGetMe = jest.fn();
const mockPatchName = jest.fn();
const mockChangePassword = jest.fn();
const mockDeleteAccount = jest.fn();
const mockLogoutService = jest.fn();
const mockDeleteAllMemoryFromServer = jest.fn();
const mockSubmitFeedback = jest.fn();
const mockFetchExportHistory = jest.fn();
const mockRequestDataExport = jest.fn();
const mockNotification = jest.fn();
let mockUuidSequence = 0;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}

jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0', nativeBuildVersion: '1' }));
jest.mock('expo-crypto', () => ({
  randomUUID: () => `00000000-0000-4000-8000-${String(++mockUuidSequence).padStart(12, '0')}`,
}));
jest.mock('expo-location', () => ({
  PermissionStatus: { GRANTED: 'granted' },
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted', canAskAgain: true })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted', canAskAgain: true })),
}));
jest.mock('react-native-safe-area-context', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, ...props }: any) => ReactModule.createElement(View, props, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
  };
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
  return {
    SegmentedControl: ({ testID, value, onChange }: any) => ReactModule.createElement(
      View,
      { testID, value, onChange },
    ),
  };
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
  changePassword: (...args: unknown[]) => mockChangePassword(...args),
  deleteAccount: (...args: unknown[]) => mockDeleteAccount(...args),
  fetchExportHistory: (...args: unknown[]) => mockFetchExportHistory(...args),
  logout: (...args: unknown[]) => mockLogoutService(...args),
  requestDataExport: (...args: unknown[]) => mockRequestDataExport(...args),
  submitFeedback: (...args: unknown[]) => mockSubmitFeedback(...args),
}));
jest.mock('../../services/accountLocalData', () => ({
  completeDeletedAccountLocalPurge: jest.fn(async () => undefined),
  scheduleDeletedAccountLocalPurge: jest.fn(async () => undefined),
}));
jest.mock('../../services/credentialsStore', () => ({ clearCredentials: jest.fn(async () => undefined) }));
jest.mock('../../services/memorySync', () => ({
  deleteAllMemoryFromServer: (...args: unknown[]) => mockDeleteAllMemoryFromServer(...args),
}));
jest.mock('../../services/hapticService', () => ({
  haptic: { selection: jest.fn(), notification: (...args: unknown[]) => mockNotification(...args) },
}));
jest.mock('../../config/api', () => ({ PRIVACY_URL: 'https://example.test/privacy' }));

import { SettingsScreen } from '../SettingsScreen';

function installAccount(user: typeof accountA) {
  mockAppState.user = user;
  mockAppState.isLoggedIn = true;
}

describe('Settings normal-handler account and action boundaries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSubmitFeedback.mockReset();
    mockUuidSequence = 0;
    installAccount(accountA);
    mockGetMe.mockImplementation(async () => ({ ...mockAppState.user }));
    mockPatchName.mockResolvedValue({ user: accountA });
    mockChangePassword.mockResolvedValue({ commitState: 'committed', sessionTransitioned: true });
    mockDeleteAccount.mockResolvedValue({ error: 'not_configured' });
    mockLogoutService.mockResolvedValue({ cleared: true, ownerChanged: false });
    mockDeleteAllMemoryFromServer.mockResolvedValue(true);
    mockSubmitFeedback.mockResolvedValue({ acknowledged: true });
    mockFetchExportHistory.mockReset();
    mockFetchExportHistory.mockResolvedValue({ exports: [] });
    mockRequestDataExport.mockReset();
    mockRequestDataExport.mockResolvedValue({});
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
  }, 15_000);

  test('SET-SAVE-01 preserves B and clears the A name draft when A save resolves after the switch', async () => {
    const oldSave = deferred<any>();
    mockPatchName.mockImplementationOnce(() => oldSave.promise);
    const screen = render(<SettingsScreen />);
    await waitFor(() => expect(mockGetMe).toHaveBeenCalled());
    fireEvent.press(screen.getByTestId('settings-account-row'));
    fireEvent.press(await screen.findByTestId('settings-edit-name'));
    fireEvent.changeText(screen.getByTestId('settings-name-input'), 'Owner A draft');
    fireEvent.press(screen.getByTestId('settings-name-save'));
    expect(mockPatchName).toHaveBeenCalledWith('Owner A draft', 'owner-a');

    act(() => {
      installAccount(accountB);
      screen.rerender(<SettingsScreen />);
    });
    expect(screen.queryByTestId('settings-name-modal')).toBeNull();
    oldSave.resolve({ user: { ...accountA, name: 'Saved Owner A' } });
    await act(async () => { await oldSave.promise; await Promise.resolve(); });

    expect(mockAppState.user).toEqual(accountB);
    expect(screen.queryByTestId('settings-name-modal')).toBeNull();
    fireEvent.press(screen.getByTestId('settings-edit-name'));
    expect(screen.getByDisplayValue('Owner B')).toBeTruthy();
    expect(screen.queryByDisplayValue('Owner A draft')).toBeNull();
  });

  test('SET-DELETE-01 exploration deletion is hard single-flight with one terminal result', async () => {
    const deletion = deferred<boolean>();
    mockDeleteAllMemoryFromServer.mockImplementation(() => deletion.promise);
    const screen = render(<SettingsScreen />);
    await waitFor(() => expect(mockGetMe).toHaveBeenCalled());
    fireEvent.press(screen.getByTestId('settings-privacy-row'));
    const deleteRow = await screen.findByTestId('settings-delete-exploration');
    fireEvent.press(deleteRow);

    const destructive = screen.getByTestId('settings-delete-exploration-confirm');
    act(() => {
      fireEvent.press(destructive);
      fireEvent.press(destructive);
    });

    expect(mockDeleteAllMemoryFromServer).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('settings-delete-exploration').props.accessibilityState)
      .toMatchObject({ disabled: true, busy: true });

    deletion.resolve(true);
    await waitFor(() => expect(screen.getByText('Deleted. Activities, Routes and Cairns were not changed.')).toBeTruthy());
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
    act(() => fireEvent.press(screen.getByTestId('settings-delete-exploration-confirm')));
    expect(mockDeleteAllMemoryFromServer).toHaveBeenCalledWith('owner-a');

    act(() => {
      installAccount(accountB);
      screen.rerender(<SettingsScreen />);
    });
    expect(screen.getByTestId('settings-delete-exploration').props.accessibilityState)
      .toMatchObject({ disabled: false, busy: false });

    deletion.resolve(true);
    await act(async () => { await deletion.promise; await Promise.resolve(); });
    expect(screen.queryByText('Deleted. Activities, Routes and Cairns were not changed.')).toBeNull();
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

    expect(screen.queryByTestId('settings-name-modal')).toBeNull();
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

  test('SET/NAME-GEN-02 late A settlement cannot release B name single-flight', async () => {
    const saveA = deferred<any>();
    const saveB = deferred<any>();
    mockPatchName
      .mockImplementationOnce(() => saveA.promise)
      .mockImplementationOnce(() => saveB.promise);
    const screen = render(<SettingsScreen />);
    await waitFor(() => expect(mockGetMe).toHaveBeenCalled());
    fireEvent.press(screen.getByTestId('settings-account-row'));
    fireEvent.press(await screen.findByTestId('settings-edit-name'));
    fireEvent.changeText(screen.getByTestId('settings-name-input'), 'A draft');
    fireEvent.press(screen.getByTestId('settings-name-save'));

    act(() => {
      installAccount(accountB);
      screen.rerender(<SettingsScreen />);
    });
    expect(screen.queryByTestId('settings-name-modal')).toBeNull();
    fireEvent.press(screen.getByTestId('settings-edit-name'));
    fireEvent.changeText(screen.getByTestId('settings-name-input'), 'B draft');
    fireEvent.press(screen.getByTestId('settings-name-save'));
    expect(mockPatchName).toHaveBeenNthCalledWith(2, 'B draft', 'owner-b');

    saveA.resolve({ user: { ...accountA, name: 'Late A' } });
    await act(async () => { await saveA.promise; await Promise.resolve(); });
    expect(screen.getByTestId('settings-name-save').props.accessibilityState)
      .toMatchObject({ disabled: true, busy: true });
    fireEvent.press(screen.getByTestId('settings-name-save'));
    expect(mockPatchName).toHaveBeenCalledTimes(2);

    saveB.resolve({ user: { ...accountB, name: 'B draft' } });
    await act(async () => { await saveB.promise; await Promise.resolve(); });
  });

  test('SET/ACCOUNT-DELETE-COMMIT-02 committed A service result cannot mutate newly rendered B', async () => {
    const deletion = deferred<any>();
    mockDeleteAccount.mockImplementationOnce(() => deletion.promise);
    const screen = render(<SettingsScreen />);
    await waitFor(() => expect(mockGetMe).toHaveBeenCalled());
    fireEvent.press(screen.getByTestId('settings-account-row'));
    fireEvent.press(await screen.findByTestId('settings-delete-account'));
    fireEvent.changeText(screen.getByTestId('settings-delete-phrase'), 'delete account');
    fireEvent.press(screen.getByTestId('settings-delete-confirm'));
    expect(mockDeleteAccount).toHaveBeenCalledWith('owner-a');
    expect(screen.queryByTestId('settings-modal-close')).toBeNull();

    act(() => {
      installAccount(accountB);
      screen.rerender(<SettingsScreen />);
    });
    expect(screen.queryByTestId('settings-delete-modal')).toBeNull();
    deletion.resolve({
      commitState: 'committed',
      restoreDeadline: '2026-09-27T00:00:00.000Z',
      localCleanup: 'pending',
      durableCleanupScheduled: true,
    });
    await act(async () => { await deletion.promise; await Promise.resolve(); });

    expect(mockLogoutService).not.toHaveBeenCalled();
    expect(mockAppState.logout).not.toHaveBeenCalled();
    expect(mockAppState.user).toEqual(accountB);
    expect((Alert.alert as jest.Mock).mock.calls.filter(
      ([title]) => title === 'Account scheduled for deletion'
        || title === 'Account deletion accepted'
        || title === 'Previous account deletion not confirmed',
    )).toHaveLength(0);
    fireEvent.press(screen.getByTestId('settings-delete-account'));
    expect(screen.getByTestId('settings-delete-phrase').props.value).toBe('');
  });

  test('SET/PASSWORD-COMMIT-02 committed A password result cannot clear B or claim retryable failure', async () => {
    const change = deferred<any>();
    mockChangePassword.mockImplementationOnce(() => change.promise);
    const screen = render(<SettingsScreen />);
    await waitFor(() => expect(mockGetMe).toHaveBeenCalled());
    fireEvent.press(screen.getByTestId('settings-account-row'));
    fireEvent.press(await screen.findByTestId('settings-change-password'));
    fireEvent.changeText(screen.getByTestId('settings-current-password'), 'old-password');
    fireEvent.changeText(screen.getByTestId('settings-new-password'), 'New-password1');
    fireEvent.changeText(screen.getByTestId('settings-confirm-password'), 'New-password1');
    fireEvent.press(screen.getByTestId('settings-password-save'));
    expect(screen.queryByTestId('settings-modal-close')).toBeNull();

    act(() => {
      installAccount(accountB);
      screen.rerender(<SettingsScreen />);
    });
    expect(screen.queryByTestId('settings-password-modal')).toBeNull();
    change.resolve({
      commitState: 'committed',
      sessionTransitioned: false,
      error: 'Password updated on the server; sign in again.',
    });
    await act(async () => { await change.promise; await Promise.resolve(); });

    expect(mockLogoutService).not.toHaveBeenCalled();
    expect(mockAppState.logout).not.toHaveBeenCalled();
    expect(mockAppState.user).toEqual(accountB);
    expect((Alert.alert as jest.Mock).mock.calls.filter(
      ([title]) => title === 'Password updated'
        || title === 'Previous account password updated'
        || title === 'Password result unknown',
    )).toHaveLength(0);
    fireEvent.press(screen.getByTestId('settings-change-password'));
    expect(screen.getByTestId('settings-current-password').props.value).toBe('');
    expect(screen.getByTestId('settings-new-password').props.value).toBe('');
    expect(screen.getByTestId('settings-confirm-password').props.value).toBe('');
  });

  test('SET/PASSWORD-UNMOUNT-03 late committed password result has no UI feedback after Settings unmounts', async () => {
    const change = deferred<any>();
    mockChangePassword.mockImplementationOnce(() => change.promise);
    const screen = render(<SettingsScreen />);
    await waitFor(() => expect(mockGetMe).toHaveBeenCalled());
    fireEvent.press(screen.getByTestId('settings-account-row'));
    fireEvent.press(await screen.findByTestId('settings-change-password'));
    fireEvent.changeText(screen.getByTestId('settings-current-password'), 'old-password');
    fireEvent.changeText(screen.getByTestId('settings-new-password'), 'New-password1');
    fireEvent.changeText(screen.getByTestId('settings-confirm-password'), 'New-password1');
    fireEvent.press(screen.getByTestId('settings-password-save'));
    screen.unmount();

    change.resolve({ commitState: 'committed', sessionTransitioned: true });
    await act(async () => { await change.promise; await Promise.resolve(); });

    expect((Alert.alert as jest.Mock).mock.calls.filter(
      ([title]) => title === 'Password updated' || title === 'Password result unknown',
    )).toHaveLength(0);
  });

  test('SET/DELETE-UNMOUNT-03 late committed deletion has no UI feedback after Settings unmounts', async () => {
    const deletion = deferred<any>();
    mockDeleteAccount.mockImplementationOnce(() => deletion.promise);
    const screen = render(<SettingsScreen />);
    await waitFor(() => expect(mockGetMe).toHaveBeenCalled());
    fireEvent.press(screen.getByTestId('settings-account-row'));
    fireEvent.press(await screen.findByTestId('settings-delete-account'));
    fireEvent.changeText(screen.getByTestId('settings-delete-phrase'), 'delete account');
    fireEvent.press(screen.getByTestId('settings-delete-confirm'));
    screen.unmount();

    deletion.resolve({
      commitState: 'committed',
      restoreDeadline: '2026-09-27T00:00:00.000Z',
      localCleanup: 'pending',
      durableCleanupScheduled: true,
    });
    await act(async () => { await deletion.promise; await Promise.resolve(); });

    expect((Alert.alert as jest.Mock).mock.calls.filter(
      ([title]) => title === 'Account scheduled for deletion' || title === 'Account deletion accepted',
    )).toHaveLength(0);
  });

  test('SET/FEEDBACK-OWNER-01 clears the A composer draft and kind when B becomes current', async () => {
    const screen = render(<SettingsScreen />);
    await waitFor(() => expect(mockGetMe).toHaveBeenCalled());
    fireEvent.press(screen.getByTestId('settings-help-row'));
    act(() => screen.getByTestId('settings-feedback-kind').props.onChange('bug'));
    fireEvent.changeText(screen.getByTestId('settings-feedback-input'), 'Owner A private feedback');

    act(() => {
      installAccount(accountB);
      screen.rerender(<SettingsScreen />);
    });

    expect(screen.getByTestId('settings-feedback-kind').props.value).toBe('feedback');
    expect(screen.getByTestId('settings-feedback-input').props.value).toBe('');
    expect(screen.getByText('Send feedback')).toBeTruthy();
  });

  test('SET/FEEDBACK-DISPATCH-02 stale A composer cannot dispatch after B becomes current', async () => {
    // If the stale source dispatches, keep that unauthorized request pending so
    // this deliberately failing baseline case cannot leak completion effects
    // into the independent schedules that follow.
    mockSubmitFeedback.mockReturnValueOnce(new Promise(() => {}));
    const screen = render(<SettingsScreen />);
    await waitFor(() => expect(mockGetMe).toHaveBeenCalled());
    fireEvent.press(screen.getByTestId('settings-help-row'));
    fireEvent.changeText(screen.getByTestId('settings-feedback-input'), 'Owner A private feedback');

    installAccount(accountB);
    fireEvent.press(screen.getByTestId('settings-feedback-send'));

    expect(mockSubmitFeedback).not.toHaveBeenCalled();
  });

  test('SET/FEEDBACK-ERROR-03 clears A failure and rotates submission authority for B', async () => {
    mockSubmitFeedback
      .mockResolvedValueOnce({ acknowledged: false, error: 'Owner A delivery failed.' })
      .mockResolvedValueOnce({ acknowledged: true });
    const screen = render(<SettingsScreen />);
    await waitFor(() => expect(mockGetMe).toHaveBeenCalled());
    fireEvent.press(screen.getByTestId('settings-help-row'));
    fireEvent.changeText(screen.getByTestId('settings-feedback-input'), 'Owner A failed feedback');
    fireEvent.press(screen.getByTestId('settings-feedback-send'));
    await screen.findByText('Owner A delivery failed.');
    const ownerASubmissionId = mockSubmitFeedback.mock.calls[0][0].submissionId;

    act(() => {
      installAccount(accountB);
      screen.rerender(<SettingsScreen />);
    });
    expect(screen.queryByText('Owner A delivery failed.')).toBeNull();
    expect(screen.getByText('Send feedback')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('settings-feedback-input'), 'Owner B feedback');
    fireEvent.press(screen.getByTestId('settings-feedback-send'));
    await waitFor(() => expect(mockSubmitFeedback).toHaveBeenCalledTimes(2));
    expect(mockSubmitFeedback.mock.calls[1][0].submissionId).not.toBe(ownerASubmissionId);
    await screen.findByText('Delivered to Cairn');
  });

  test('SET/FEEDBACK-GEN-04 late A acknowledgement cannot clear or acknowledge B draft', async () => {
    const sendA = deferred<any>();
    mockSubmitFeedback.mockImplementationOnce(() => sendA.promise);
    const screen = render(<SettingsScreen />);
    await waitFor(() => expect(mockGetMe).toHaveBeenCalled());
    fireEvent.press(screen.getByTestId('settings-help-row'));
    fireEvent.changeText(screen.getByTestId('settings-feedback-input'), 'Owner A private feedback');
    fireEvent.press(screen.getByTestId('settings-feedback-send'));
    expect(mockSubmitFeedback).toHaveBeenCalledTimes(1);

    act(() => {
      installAccount(accountB);
      screen.rerender(<SettingsScreen />);
    });
    fireEvent.changeText(screen.getByTestId('settings-feedback-input'), 'Owner B draft');

    sendA.resolve({ acknowledged: true });
    await act(async () => { await sendA.promise; await Promise.resolve(); });

    expect(screen.getByTestId('settings-feedback-input').props.value).toBe('Owner B draft');
    expect(screen.queryByText('Delivered to Cairn')).toBeNull();
    expect(mockNotification).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('settings-feedback-send'));
    await waitFor(() => expect(mockSubmitFeedback).toHaveBeenCalledTimes(2));
    expect(mockSubmitFeedback.mock.calls[1][0].submissionId)
      .not.toBe(mockSubmitFeedback.mock.calls[0][0].submissionId);
    await screen.findByText('Delivered to Cairn');
  });

  test('SET/FEEDBACK-FLIGHT-05 late A settlement cannot release B single-flight', async () => {
    const sendA = deferred<any>();
    const sendB = deferred<any>();
    mockSubmitFeedback
      .mockImplementationOnce(() => sendA.promise)
      .mockImplementationOnce(() => sendB.promise);
    const screen = render(<SettingsScreen />);
    await waitFor(() => expect(mockGetMe).toHaveBeenCalled());
    fireEvent.press(screen.getByTestId('settings-help-row'));
    fireEvent.changeText(screen.getByTestId('settings-feedback-input'), 'Owner A private feedback');
    fireEvent.press(screen.getByTestId('settings-feedback-send'));

    act(() => {
      installAccount(accountB);
      screen.rerender(<SettingsScreen />);
    });
    fireEvent.changeText(screen.getByTestId('settings-feedback-input'), 'Owner B draft');
    fireEvent.press(screen.getByTestId('settings-feedback-send'));
    expect(mockSubmitFeedback).toHaveBeenCalledTimes(2);

    sendA.resolve({ acknowledged: true });
    await act(async () => { await sendA.promise; await Promise.resolve(); });

    expect(screen.getByTestId('settings-feedback-input').props.value).toBe('Owner B draft');
    expect(screen.queryByText('Delivered to Cairn')).toBeNull();
    expect(screen.getByTestId('settings-feedback-send').props.accessibilityState)
      .toMatchObject({ disabled: true, busy: true });
    fireEvent.press(screen.getByTestId('settings-feedback-send'));
    expect(mockSubmitFeedback).toHaveBeenCalledTimes(2);
    expect(mockNotification).not.toHaveBeenCalled();

    sendB.resolve({ acknowledged: true });
    await act(async () => { await sendB.promise; await Promise.resolve(); });
    expect(screen.getByTestId('settings-feedback-input').props.value).toBe('');
    expect(screen.getByText('Delivered to Cairn')).toBeTruthy();
    expect(mockNotification).toHaveBeenCalledTimes(1);
    expect(mockNotification).toHaveBeenCalledWith('success');
  });

  test('SET/FEEDBACK-UNMOUNT-06 late acknowledgement has no haptic or UI side effect after unmount', async () => {
    mockSubmitFeedback.mockResolvedValueOnce({ acknowledged: true });
    const screen = render(<SettingsScreen />);
    await waitFor(() => expect(mockGetMe).toHaveBeenCalled());
    fireEvent.press(screen.getByTestId('settings-help-row'));
    fireEvent.changeText(screen.getByTestId('settings-feedback-input'), 'Owner A private feedback');
    fireEvent.press(screen.getByTestId('settings-feedback-send'));
    expect(mockSubmitFeedback).toHaveBeenCalledTimes(1);
    screen.unmount();

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(mockNotification).not.toHaveBeenCalled();
  });

  test('SET/EXPORT-OWNER-01 clears an A download before B can render it', async () => {
    mockFetchExportHistory.mockResolvedValueOnce({
      exports: [{
        id: 41,
        status: 'ready',
        size_bytes: 2048,
        requested_at: '2026-09-20T00:00:00.000Z',
        built_at: '2026-09-20T00:01:00.000Z',
        expires_at: '2099-09-27T00:00:00.000Z',
        sent_at: null,
        download_url: 'https://authority.test/private-owner-a-export',
        error_msg: null,
      }],
    });
    const screen = render(<SettingsScreen />);
    await waitFor(() => expect(mockGetMe).toHaveBeenCalled());
    fireEvent.press(screen.getByTestId('settings-privacy-row'));
    await screen.findByText('Ready to download');

    act(() => {
      installAccount(accountB);
      screen.rerender(<SettingsScreen />);
    });
    await act(async () => { await Promise.resolve(); });

    expect(screen.queryByText('Ready to download')).toBeNull();
    expect(screen.queryByTestId('settings-export-download')).toBeNull();
  }, 15_000);

  test('SET/EXPORT-GEN-02 drops delayed A history after B becomes current', async () => {
    const historyA = deferred<any>();
    mockFetchExportHistory.mockImplementationOnce(() => historyA.promise);
    const screen = render(<SettingsScreen />);
    await waitFor(() => expect(mockGetMe).toHaveBeenCalled());
    fireEvent.press(screen.getByTestId('settings-privacy-row'));
    await waitFor(() => expect(mockFetchExportHistory).toHaveBeenCalledTimes(1));

    act(() => {
      installAccount(accountB);
      screen.rerender(<SettingsScreen />);
    });
    await act(async () => { await Promise.resolve(); });
    historyA.resolve({
      exports: [{
        id: 42,
        status: 'ready',
        size_bytes: 4096,
        requested_at: '2026-09-20T00:00:00.000Z',
        built_at: '2026-09-20T00:01:00.000Z',
        expires_at: '2099-09-27T00:00:00.000Z',
        sent_at: null,
        download_url: 'https://authority.test/late-private-owner-a-export',
        error_msg: null,
      }],
    });
    await act(async () => { await historyA.promise; await Promise.resolve(); });

    expect(screen.queryByText('Ready to download')).toBeNull();
    expect(screen.queryByTestId('settings-export-download')).toBeNull();
  }, 15_000);

  test('SET/EXPORT-FLIGHT-03 A completion cannot block or release B request state', async () => {
    const requestA = deferred<any>();
    const requestB = deferred<any>();
    mockRequestDataExport
      .mockImplementationOnce(() => requestA.promise)
      .mockImplementationOnce(() => requestB.promise);
    const screen = render(<SettingsScreen />);
    await waitFor(() => expect(mockGetMe).toHaveBeenCalled());
    fireEvent.press(screen.getByTestId('settings-privacy-row'));
    await waitFor(() => expect(mockFetchExportHistory).toHaveBeenCalled());
    fireEvent.press(screen.getByTestId('settings-export-request'));
    expect(mockRequestDataExport).toHaveBeenCalledTimes(1);

    act(() => {
      installAccount(accountB);
      screen.rerender(<SettingsScreen />);
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('settings-export-request').props.accessibilityState)
      .toMatchObject({ disabled: false, busy: false });
    fireEvent.press(screen.getByTestId('settings-export-request'));
    expect(mockRequestDataExport).toHaveBeenCalledTimes(2);

    requestA.resolve({ error: 'Owner A export failed.' });
    await act(async () => { await requestA.promise; await Promise.resolve(); });
    expect(screen.queryByText('Owner A export failed.')).toBeNull();
    expect(screen.getByTestId('settings-export-request').props.accessibilityState)
      .toMatchObject({ disabled: true, busy: true });
    fireEvent.press(screen.getByTestId('settings-export-request'));
    expect(mockRequestDataExport).toHaveBeenCalledTimes(2);

    requestB.resolve({});
    await act(async () => { await requestB.promise; await Promise.resolve(); });
    expect(screen.getByTestId('settings-export-request').props.accessibilityState)
      .toMatchObject({ disabled: false, busy: false });
  }, 15_000);
});
