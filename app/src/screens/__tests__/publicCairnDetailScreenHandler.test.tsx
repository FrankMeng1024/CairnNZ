import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { Alert, Platform } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGoBack = jest.fn();
const mockLoadDetail = jest.fn();
const mockThanks = jest.fn();
const mockHide = jest.fn();
const mockBlockAuthor = jest.fn();
const mockReport = jest.fn();
let mockAuthorityCurrent = true;
let mockAuthorityGeneration = 7;
let mockRouteId = '501';
const mockActionableRenderTrace: string[] = [];
const mockBrowserAlert = jest.fn();
const originalPlatformOS = Platform.OS;
const originalBrowserAlertDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'alert');
const publicDetailSourcePath = path.resolve(__dirname, '..', 'PublicCairnDetailScreen.tsx');

const detail = {
  id: '501', author: { id: 'author-a', name: 'Alice' }, type: 'cairn',
  lat: -41.2865, lng: 174.7762, approximate: true,
  createdAt: 1_800_000_000_000, encounteredAt: 1_800_000_001_000,
  readOnly: true as const, resourceRevision: 'resource-v1', authorizationRevision: 'auth-v1',
  authorizationIssuedAt: 1_799_999_000_000, authorizationExpiresAt: 1_800_086_400_000,
  text: 'A useful note\nThe bridge is quiet after rain.', displayText: 'A useful note',
};
const nextDetail = {
  ...detail,
  id: '502',
  author: { id: 'author-b', name: 'Bob' },
  text: 'A second note\nAuthority for the next route.',
  displayText: 'A second note',
};

const publicState: any = {
  viewerId: 'viewer-a',
  enabled: true,
  details: { '501': detail },
  loadDetail: (...args: any[]) => mockLoadDetail(...args),
  thanks: (...args: any[]) => mockThanks(...args),
  hide: (...args: any[]) => mockHide(...args),
  blockAuthor: (...args: any[]) => mockBlockAuthor(...args),
  report: (...args: any[]) => mockReport(...args),
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function setPlatformOS(os: string) {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
}

function replaceExact(source: string, before: string, after: string): string {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`mutation preimage count ${count}: ${before}`);
  return source.replace(before, after);
}

function queuedFeedbackContract(source: string): boolean {
  const helperStart = source.indexOf('export function showPublicActionFeedback');
  const screenStart = source.indexOf('export function PublicCairnDetailScreen');
  const actionStart = source.indexOf('const commitConfirmedAction');
  const thanksStart = source.indexOf('const sendThanks');
  const reportStart = source.indexOf('const submitReport');
  if ([helperStart, screenStart, actionStart, thanksStart, reportStart].some(index => index < 0)) return false;
  const helper = source.slice(helperStart, screenStart);
  const action = source.slice(actionStart, thanksStart);
  const thanks = source.slice(thanksStart, reportStart);
  const actionFence = action.indexOf("if (!screenActionIsCurrent(ticket) || result.status === 'superseded') return;");
  const actionQueued = action.indexOf("if (result.status === 'queued_offline')");
  const actionFeedback = action.indexOf(
    "showPublicActionFeedback(\n          selected === 'hide' ? 'Hidden here' : 'Blocked here',\n          'This change is saved on this device and will retry when you are connected.',\n        );",
    actionQueued,
  );
  const actionUnavailable = action.indexOf("} else if (result.status === 'unavailable')", actionQueued);
  const navigation = action.indexOf('nav.goBack();');
  const thanksFence = thanks.indexOf("if (!screenActionIsCurrent(ticket) || result.status === 'superseded') return;");
  const thanksQueued = thanks.indexOf("result.status === 'queued_offline'");
  const thanksFeedback = thanks.indexOf('showPublicActionFeedback(', thanksQueued);
  return helper.includes("Platform.OS === 'web'")
    && helper.includes('browserGlobal.alert(`${title}\\n\\n${body}`)')
    && helper.includes('Alert.alert(title, body);')
    && action.includes("selected === 'hide' ? 'Hidden here' : 'Blocked here'")
    && action.includes('This change is saved on this device and will retry when you are connected.')
    && actionFence >= 0 && actionFence < actionQueued
    && actionQueued < actionFeedback && actionFeedback < actionUnavailable
    && actionFeedback < navigation
    && thanks.includes("showPublicActionFeedback('Thanks saved', 'Your Thanks will retry when you are connected.');")
    && thanksFence >= 0 && thanksFence < thanksQueued && thanksQueued < thanksFeedback;
}

function moveQueuedFeedbackAfterNavigation(source: string): string {
  const actionStart = source.indexOf('const commitConfirmedAction');
  const actionEnd = source.indexOf('const sendThanks', actionStart);
  const action = source.slice(actionStart, actionEnd);
  const feedbackStart = action.indexOf('        showPublicActionFeedback(');
  const feedbackEnd = action.indexOf('        );', feedbackStart) + '        );'.length;
  if (feedbackStart < 0 || feedbackEnd < '        );'.length) throw new Error('feedback statement missing');
  const feedback = action.slice(feedbackStart, feedbackEnd);
  const withoutFeedback = `${action.slice(0, feedbackStart)}${action.slice(feedbackEnd)}`;
  const moved = replaceExact(withoutFeedback, '      nav.goBack();', `      nav.goBack();\n${feedback}`);
  return `${source.slice(0, actionStart)}${moved}${source.slice(actionEnd)}`;
}

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
  useRoute: () => ({ params: { cairnId: mockRouteId } }),
}));

jest.mock('@rnmapbox/maps', () => ({ available: false }));

jest.mock('../../components/BackButton', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return { BackButton: () => ReactModule.createElement(View) };
});

jest.mock('../../components/Icon', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return { Icon: () => ReactModule.createElement(View) };
});

jest.mock('../../components/PrimaryButton', () => {
  const ReactModule = require('react');
  const { Text, TouchableOpacity } = require('react-native');
  return {
    PrimaryButton: ({ label, onPress, disabled, testID }: any) => {
      if (['Thanks', 'Hide', 'Submit report', 'Sending…', 'Report saved'].includes(label)) {
        mockActionableRenderTrace.push(`${mockRouteId}:${publicState.enabled ? 'on' : 'off'}:${label}`);
      }
      return ReactModule.createElement(
        TouchableOpacity,
        { onPress, disabled, testID, accessibilityRole: 'button' },
        ReactModule.createElement(Text, null, label),
      );
    },
  };
});

jest.mock('../../components/ModalCard', () => {
  const ReactModule = require('react');
  const { Text, View } = require('react-native');
  return {
    ModalCard: ({ visible, children, testID }: any) => (
      visible ? ReactModule.createElement(View, { testID }, children) : null
    ),
    ModalCardHeader: ({ title, body }: any) => ReactModule.createElement(
      View,
      null,
      ReactModule.createElement(Text, null, title),
      body ? ReactModule.createElement(Text, null, body) : null,
    ),
  };
});

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
  capturePublicCairnAccountAuthority: (viewerId: string | null) => (
    mockAuthorityCurrent && viewerId ? { viewerId, generation: mockAuthorityGeneration } : null
  ),
  publicCairnAccountAuthorityIsCurrent: (authority: { viewerId: string; generation: number }) => (
    mockAuthorityCurrent
    && authority.viewerId === publicState.viewerId
    && authority.generation === mockAuthorityGeneration
  ),
}));

import { PublicCairnDetailScreen } from '../PublicCairnDetailScreen';

describe('PublicCairnDetailScreen durable action feedback', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'alert', {
      configurable: true,
      value: mockBrowserAlert,
      writable: true,
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    setPlatformOS(originalPlatformOS);
    mockLoadDetail.mockResolvedValue(detail);
    mockThanks.mockResolvedValue({ status: 'confirmed' });
    mockHide.mockResolvedValue({ status: 'confirmed' });
    mockBlockAuthor.mockResolvedValue({ status: 'confirmed' });
    mockReport.mockResolvedValue({ status: 'confirmed' });
    mockAuthorityCurrent = true;
    mockAuthorityGeneration = 7;
    mockRouteId = '501';
    publicState.viewerId = 'viewer-a';
    publicState.enabled = true;
    publicState.details = { '501': detail, '502': { ...detail, id: '502' } };
    mockActionableRenderTrace.length = 0;
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    setPlatformOS(originalPlatformOS);
    jest.restoreAllMocks();
  });

  afterAll(() => {
    if (originalBrowserAlertDescriptor) {
      Object.defineProperty(globalThis, 'alert', originalBrowserAlertDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'alert');
    }
  });

  test('ordinary offline entry is non-actionable while loading and settles to retryable unavailable', async () => {
    publicState.details = {};
    const request = deferred<typeof detail>();
    mockLoadDetail.mockReturnValueOnce(request.promise);

    const screen = render(<PublicCairnDetailScreen />);

    expect(screen.getByText('Loading Public Cairn…')).toBeTruthy();
    expect(screen.queryByTestId('public-cairn-detail')).toBeNull();
    expect(screen.queryByText('Thanks')).toBeNull();
    expect(screen.queryByText('Hide')).toBeNull();
    await act(async () => { request.reject({ code: 'offline' }); });

    expect(await screen.findByText('Connect to download this Cairn.')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
    expect(screen.queryByTestId('public-cairn-detail')).toBeNull();
  });

  test('route A to B synchronously withholds A actions until B has authorized detail', async () => {
    const nextRequest = deferred<typeof nextDetail>();
    mockLoadDetail.mockImplementation((resourceId: string) => (
      resourceId === '501' ? Promise.resolve(detail) : nextRequest.promise
    ));
    publicState.details = { '501': detail };
    const screen = render(<PublicCairnDetailScreen />);
    await screen.findByText('Left by Alice');
    mockActionableRenderTrace.length = 0;

    mockRouteId = '502';
    publicState.details = { '501': detail };
    screen.rerender(<PublicCairnDetailScreen />);

    expect(screen.getByText('Loading Public Cairn…')).toBeTruthy();
    expect(screen.queryByText('Left by Alice')).toBeNull();
    expect(mockActionableRenderTrace.filter(frame => frame.startsWith('502:'))).toEqual([]);
    await act(async () => { nextRequest.resolve(nextDetail); });
    expect(await screen.findByText('Left by Bob')).toBeTruthy();
  });

  test('enabled to disabled synchronously removes cached detail, actions, and Retry', async () => {
    const screen = render(<PublicCairnDetailScreen />);
    await screen.findByText('Left by Alice');
    mockActionableRenderTrace.length = 0;

    publicState.enabled = false;
    screen.rerender(<PublicCairnDetailScreen />);

    expect(screen.getByText('Public Cairns are not available in this release.')).toBeTruthy();
    expect(screen.queryByText('Left by Alice')).toBeNull();
    expect(screen.queryByText('Try again')).toBeNull();
    expect(mockActionableRenderTrace.filter(frame => frame.includes(':off:'))).toEqual([]);
  });

  test('viewer transition synchronously removes the prior owner detail and actions', async () => {
    const nextOwnerRequest = deferred<typeof detail>();
    mockLoadDetail
      .mockResolvedValueOnce(detail)
      .mockReturnValueOnce(nextOwnerRequest.promise);
    const screen = render(<PublicCairnDetailScreen />);
    await screen.findByText('Left by Alice');
    mockActionableRenderTrace.length = 0;

    publicState.viewerId = 'viewer-b';
    publicState.details = {};
    mockAuthorityGeneration = 8;
    screen.rerender(<PublicCairnDetailScreen />);

    expect(screen.getByText('Loading Public Cairn…')).toBeTruthy();
    expect(screen.queryByText('Left by Alice')).toBeNull();
    expect(mockActionableRenderTrace).toEqual([]);
    screen.unmount();
    await act(async () => { nextOwnerRequest.reject({ code: 'superseded' }); });
  });

  test('same-viewer generation transition starts a newly bound load instead of wedging', async () => {
    const nextGenerationRequest = deferred<typeof detail>();
    mockLoadDetail
      .mockResolvedValueOnce(detail)
      .mockReturnValueOnce(nextGenerationRequest.promise);
    const screen = render(<PublicCairnDetailScreen />);
    await screen.findByText('Left by Alice');

    mockAuthorityGeneration = 8;
    publicState.details = {};
    screen.rerender(<PublicCairnDetailScreen />);

    expect(screen.getByText('Loading Public Cairn…')).toBeTruthy();
    expect(screen.queryByText('Left by Alice')).toBeNull();
    await waitFor(() => expect(mockLoadDetail).toHaveBeenCalledTimes(2));
    await act(async () => { nextGenerationRequest.resolve(detail); });
    expect(await screen.findByText('Left by Alice')).toBeTruthy();
  });

  test('each action payload is taken from the currently visible detail binding', async () => {
    mockRouteId = '502';
    publicState.details = { '502': nextDetail };
    mockLoadDetail.mockResolvedValue(nextDetail);
    const screen = render(<PublicCairnDetailScreen />);
    await screen.findByText('Left by Bob');

    fireEvent.press(screen.getByText('Thanks'));
    await waitFor(() => expect(mockThanks).toHaveBeenCalledWith('502'));
    await screen.findByText('Thanks sent');

    fireEvent.press(screen.getByText('Hide'));
    fireEvent.press(screen.getByText('Hide Cairn'));
    await waitFor(() => expect(mockHide).toHaveBeenCalledWith('502'));

    fireEvent.press(screen.getByText('Block author'));
    fireEvent.press(screen.getByTestId('public-confirm-submit'));
    await waitFor(() => expect(mockBlockAuthor).toHaveBeenCalledWith('author-b'));

    fireEvent.press(screen.getByText('Report'));
    fireEvent.changeText(screen.getByLabelText('Report context'), 'B-only context');
    fireEvent.press(screen.getByTestId('public-report-submit'));
    await waitFor(() => expect(mockReport).toHaveBeenCalledWith('502', 'other', 'B-only context'));
  });

  test('route transition clears an open report and its prior-route draft', async () => {
    const nextRequest = deferred<typeof nextDetail>();
    mockLoadDetail.mockImplementation((resourceId: string) => (
      resourceId === '501' ? Promise.resolve(detail) : nextRequest.promise
    ));
    publicState.details = { '501': detail };
    const screen = render(<PublicCairnDetailScreen />);
    fireEvent.press(await screen.findByText('Report'));
    fireEvent.changeText(screen.getByLabelText('Report context'), 'A-only context');

    mockRouteId = '502';
    screen.rerender(<PublicCairnDetailScreen />);

    expect(screen.queryByTestId('public-report-sheet')).toBeNull();
    expect(screen.queryByDisplayValue('A-only context')).toBeNull();
    await act(async () => { nextRequest.resolve(nextDetail); });
    expect(await screen.findByText('Left by Bob')).toBeTruthy();
    expect(screen.queryByTestId('public-report-sheet')).toBeNull();
  });

  test('older same-route superseded attempt cannot end the latest loading attempt', async () => {
    publicState.details = {};
    const older = deferred<typeof detail>();
    const latest = deferred<typeof detail>();
    mockLoadDetail
      .mockRejectedValueOnce({ code: 'offline' })
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(latest.promise);
    const screen = render(<PublicCairnDetailScreen />);
    const retry = await screen.findByText('Try again');

    await act(async () => {
      fireEvent.press(retry);
      fireEvent.press(retry);
    });
    expect(mockLoadDetail).toHaveBeenCalledTimes(3);
    await act(async () => { older.reject({ code: 'superseded' }); });
    expect(screen.getByText('Loading Public Cairn…')).toBeTruthy();

    await act(async () => { latest.resolve(detail); });
    expect(await screen.findByText('Left by Alice')).toBeTruthy();
  });

  test('current superseded invalidation terminates loading without exposing actions', async () => {
    publicState.details = {};
    const invalidated = deferred<typeof detail>();
    mockLoadDetail
      .mockRejectedValueOnce({ code: 'offline' })
      .mockReturnValueOnce(invalidated.promise);
    const screen = render(<PublicCairnDetailScreen />);
    fireEvent.press(await screen.findByText('Try again'));

    await act(async () => { invalidated.reject({ code: 'superseded' }); });

    expect(await screen.findByText('This Public Cairn is no longer available.')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
    expect(screen.queryByText('Loading Public Cairn…')).toBeNull();
    expect(screen.queryByText('Thanks')).toBeNull();
  });

  test('unmount fences late load and action completion UI', async () => {
    const loadRequest = deferred<typeof detail>();
    mockLoadDetail.mockReturnValueOnce(loadRequest.promise);
    const cold = render(<PublicCairnDetailScreen />);
    cold.unmount();
    await act(async () => { loadRequest.resolve(detail); });

    const actionRequest = deferred<{ status: 'queued_offline' }>();
    mockHide.mockReturnValueOnce(actionRequest.promise);
    mockLoadDetail.mockResolvedValue(detail);
    const screen = render(<PublicCairnDetailScreen />);
    fireEvent.press(await screen.findByText('Hide'));
    fireEvent.press(screen.getByText('Hide Cairn'));
    await waitFor(() => expect(mockHide).toHaveBeenCalledTimes(1));
    screen.unmount();
    await act(async () => { actionRequest.resolve({ status: 'queued_offline' }); });

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockBrowserAlert).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  test.each([
    ['Thanks', mockThanks, 'Thanks saved', 'Your Thanks will retry when you are connected.', false,
      async (screen: ReturnType<typeof render>) => {
        fireEvent.press(await screen.findByText('Thanks'));
      }],
    ['Hide', mockHide, 'Hidden here', 'This change is saved on this device and will retry when you are connected.', true,
      async (screen: ReturnType<typeof render>) => {
        fireEvent.press(await screen.findByText('Hide'));
        fireEvent.press(screen.getByText('Hide Cairn'));
      }],
    ['Block', mockBlockAuthor, 'Blocked here', 'This change is saved on this device and will retry when you are connected.', true,
      async (screen: ReturnType<typeof render>) => {
        fireEvent.press(await screen.findByText('Block author'));
        fireEvent.press(screen.getByTestId('public-confirm-submit'));
      }],
  ])('Web queued %s feedback uses one exact browser alert before navigation', async (
    _label, actionMock, title, body, navigates, invoke,
  ) => {
    setPlatformOS('web');
    const queuedResult = deferred<{ status: 'queued_offline' }>();
    actionMock.mockReturnValueOnce(queuedResult.promise);
    const trace: string[] = [];
    mockBrowserAlert.mockImplementation(message => { trace.push(`feedback:${String(message)}`); });
    mockGoBack.mockImplementation(() => { trace.push('navigate'); });
    const screen = render(<PublicCairnDetailScreen />);

    await invoke(screen);
    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(1));
    await act(async () => { queuedResult.resolve({ status: 'queued_offline' }); });
    const expectedMessage = `${title}\n\n${body}`;
    await waitFor(() => expect(mockBrowserAlert).toHaveBeenCalledWith(expectedMessage));
    expect(mockBrowserAlert).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockGoBack).toHaveBeenCalledTimes(navigates ? 1 : 0);
    expect(trace).toEqual(navigates
      ? [`feedback:${expectedMessage}`, 'navigate']
      : [`feedback:${expectedMessage}`]);
  });

  test('a durably queued offline Hide reports that state and leaves Detail only after local commit', async () => {
    setPlatformOS('ios');
    mockHide.mockResolvedValue({ status: 'queued_offline' });
    const screen = render(<PublicCairnDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('public-cairn-detail')).toBeTruthy());

    fireEvent.press(screen.getByText('Hide'));
    fireEvent.press(screen.getByText('Hide Cairn'));

    await waitFor(() => expect(mockHide).toHaveBeenCalledWith('501'));
    await act(async () => { await Promise.resolve(); });
    expect(Alert.alert).toHaveBeenCalledWith(
      'Hidden here',
      'This change is saved on this device and will retry when you are connected.',
    );
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(mockBrowserAlert).not.toHaveBeenCalled();
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
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockBrowserAlert).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(screen.getByTestId('public-cairn-detail')).toBeTruthy();
  });

  test('a superseded queued action cannot publish success feedback or navigate', async () => {
    mockHide.mockResolvedValue({ status: 'superseded' });
    const screen = render(<PublicCairnDetailScreen />);
    fireEvent.press(await screen.findByText('Hide'));
    fireEvent.press(screen.getByText('Hide Cairn'));

    await waitFor(() => expect(mockHide).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockBrowserAlert).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
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

  test.each([
    ['Thanks', mockThanks, async (screen: ReturnType<typeof render>) => {
      fireEvent.press(await screen.findByText('Thanks'));
    }],
    ['Hide', mockHide, async (screen: ReturnType<typeof render>) => {
      fireEvent.press(await screen.findByText('Hide'));
      fireEvent.press(screen.getByText('Hide Cairn'));
    }],
    ['Block', mockBlockAuthor, async (screen: ReturnType<typeof render>) => {
      fireEvent.press(await screen.findByText('Block author'));
      fireEvent.press(screen.getByTestId('public-confirm-submit'));
    }],
    ['Report', mockReport, async (screen: ReturnType<typeof render>) => {
      fireEvent.press(await screen.findByText('Report'));
      fireEvent.press(screen.getByTestId('public-report-submit'));
    }],
  ])('late %s completion after A to B is silent and cannot navigate or publish feedback', async (
    _label, actionMock, invoke,
  ) => {
    let release!: (result: any) => void;
    actionMock.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const screen = render(<PublicCairnDetailScreen />);
    await invoke(screen);
    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(1));

    publicState.viewerId = 'viewer-b';
    mockAuthorityCurrent = false;
    await act(async () => {
      release({ status: 'queued_offline' });
      await Promise.resolve();
    });

    expect(mockGoBack).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockBrowserAlert).not.toHaveBeenCalled();
    expect(screen.queryByText('Thanks sent')).toBeNull();
    expect(screen.queryByText('Report received.')).toBeNull();
    expect(screen.queryByText('Saved to retry when you are connected.')).toBeNull();
  });

  test('route change invalidates a delayed Hide attempt before completion UI', async () => {
    let release!: (result: any) => void;
    mockHide.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const screen = render(<PublicCairnDetailScreen />);
    fireEvent.press(await screen.findByText('Hide'));
    fireEvent.press(screen.getByText('Hide Cairn'));
    await waitFor(() => expect(mockHide).toHaveBeenCalledTimes(1));

    await act(async () => {
      mockRouteId = '502';
      screen.rerender(<PublicCairnDetailScreen />);
    });
    await act(async () => {
      release({ status: 'queued_offline' });
      await Promise.resolve();
    });

    expect(mockGoBack).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockBrowserAlert).not.toHaveBeenCalled();
  });

  test('queued feedback source contract rejects removal, platform bypass, stale fence loss, and navigation-first order', () => {
    const source = fs.readFileSync(publicDetailSourcePath, 'utf8');
    const withoutActionFeedback = replaceExact(source,
      "        showPublicActionFeedback(\n          selected === 'hide' ? 'Hidden here' : 'Blocked here',\n          'This change is saved on this device and will retry when you are connected.',\n        );",
      "        removedPublicActionFeedback(\n          selected === 'hide' ? 'Hidden here' : 'Blocked here',\n          'This change is saved on this device and will retry when you are connected.',\n        );");
    const withoutThanksFeedback = replaceExact(source,
      "        showPublicActionFeedback('Thanks saved', 'Your Thanks will retry when you are connected.');",
      "        removedPublicActionFeedback('Thanks saved', 'Your Thanks will retry when you are connected.');");
    const withoutWebAlert = replaceExact(source,
      '    browserGlobal.alert(`${title}\\n\\n${body}`);',
      '    Alert.alert(title, body);');
    const withoutNativeAlert = replaceExact(source, '  Alert.alert(title, body);', '  return;');
    const withoutActionFence = source.replace(
      "      if (!screenActionIsCurrent(ticket) || result.status === 'superseded') return;\n",
      '',
    );
    const navigationFirst = moveQueuedFeedbackAfterNavigation(source);

    expect(queuedFeedbackContract(source)).toBe(true);
    expect(queuedFeedbackContract(withoutActionFeedback)).toBe(false);
    expect(queuedFeedbackContract(withoutThanksFeedback)).toBe(false);
    expect(queuedFeedbackContract(withoutWebAlert)).toBe(false);
    expect(queuedFeedbackContract(withoutNativeAlert)).toBe(false);
    expect(queuedFeedbackContract(withoutActionFence)).toBe(false);
    expect(queuedFeedbackContract(navigationFirst)).toBe(false);
  });
});
