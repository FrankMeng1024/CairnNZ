import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { EditOverlayV274 } from '../EditOverlayV274';

const setActiveTool = jest.fn();
const resetEdits = jest.fn();
const undo = jest.fn();
const setTrimStart = jest.fn();
const setTrimEnd = jest.fn();
const beginTrimDrag = jest.fn();

let mockRouteEditState = {
  isComputing: false,
  lastError: null as string | null,
  brushStrokes: [] as unknown[],
  activeTool: 'pan',
  setActiveTool,
  previewIsCurrent: true,
  resetEdits,
  undo,
  undoStack: [] as unknown[],
  matchedPoints: [
    { lat: -41.2865, lng: 174.7762 },
    { lat: -41.286, lng: 174.777 },
  ],
  trimStartFrac: 0,
  trimEndFrac: 1,
  setTrimStart,
  setTrimEnd,
  beginTrimDrag,
};

jest.mock('../../../store/useRouteEditStore', () => ({
  useRouteEditStore: (selector: (state: typeof mockRouteEditState) => unknown) =>
    selector(mockRouteEditState),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('../../../hooks/useVisualTheme', () => {
  const { DAY_VISUAL_THEME } = jest.requireActual('../../tokens');
  return { useVisualTheme: () => DAY_VISUAL_THEME };
});

jest.mock('../../../utils/distanceFormat', () => ({
  useDistance: () => ({ format: (meters: number) => String(meters), unit: 'km' }),
}));

jest.mock('../../Icon', () => ({ Icon: () => null }));
jest.mock('../TrimSlider', () => ({ TrimSlider: () => null }));

describe('EditOverlayV274 Apply control accessibility', () => {
  beforeEach(() => {
    mockRouteEditState = { ...mockRouteEditState, isComputing: false };
    jest.clearAllMocks();
  });

  it('exposes the enabled Apply action as one named button with a stable identity', () => {
    const onSave = jest.fn();
    const screen = render(
      <EditOverlayV274
        onCancel={jest.fn()}
        onSave={onSave}
        onPreview={jest.fn()}
        onBeautify={jest.fn()}
        saveLabel="Apply to draft"
      />,
    );

    const apply = screen.getByRole('button', { name: 'Apply to draft' });
    expect(apply).toBe(screen.getByTestId('route-editor-apply-draft'));
    expect(apply).toBeEnabled();
    expect(apply.props.accessibilityState).toEqual({ disabled: false, busy: false });

    fireEvent.press(apply);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('keeps the same named control present and truthfully disabled while computing', () => {
    mockRouteEditState = { ...mockRouteEditState, isComputing: true };
    const screen = render(
      <EditOverlayV274
        onCancel={jest.fn()}
        onSave={jest.fn()}
        onPreview={jest.fn()}
        onBeautify={jest.fn()}
        saveLabel="Apply to draft"
      />,
    );

    const apply = screen.getByRole('button', { name: 'Apply to draft' });
    expect(apply).toBeDisabled();
    expect(apply.props.accessibilityState).toEqual({ disabled: true, busy: true });
  });
});
