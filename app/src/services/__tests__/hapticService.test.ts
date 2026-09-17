const mockGetSettingsState = jest.fn();
const mockImpactAsync = jest.fn(async () => undefined);
const mockSelectionAsync = jest.fn(async () => undefined);
const mockNotificationAsync = jest.fn(async () => undefined);

let haptic: typeof import('../hapticService').haptic;

describe('Settings haptics preference', () => {
  beforeAll(() => {
    jest.resetModules();
    jest.doMock('../../store/useSettingsStore', () => ({
      __esModule: true,
      useSettingsStore: { getState: mockGetSettingsState },
    }));
    jest.doMock('expo-haptics', () => ({
      __esModule: true,
      ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
      NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
      impactAsync: mockImpactAsync,
      selectionAsync: mockSelectionAsync,
      notificationAsync: mockNotificationAsync,
    }));
    haptic = require('../hapticService').haptic;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSettingsState.mockReturnValue({ hapticFeedback: true });
  });

  test('dispatches each shared haptic role while enabled', () => {
    haptic.impact('medium');
    haptic.selection();
    haptic.notification('warning');

    expect(mockImpactAsync).toHaveBeenCalledWith('medium');
    expect(mockSelectionAsync).toHaveBeenCalledTimes(1);
    expect(mockNotificationAsync).toHaveBeenCalledWith('warning');
  });

  test('suppresses every shared haptic role while disabled', () => {
    mockGetSettingsState.mockReturnValue({ hapticFeedback: false });

    haptic.impact('heavy');
    haptic.selection();
    haptic.notification('error');

    expect(mockImpactAsync).not.toHaveBeenCalled();
    expect(mockSelectionAsync).not.toHaveBeenCalled();
    expect(mockNotificationAsync).not.toHaveBeenCalled();
  });

  test('does not surface device haptic failures', async () => {
    mockImpactAsync.mockRejectedValueOnce(new Error('unsupported'));
    expect(() => haptic.impact()).not.toThrow();
    await Promise.resolve();
  });
});
