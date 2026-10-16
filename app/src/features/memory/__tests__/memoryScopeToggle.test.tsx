import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Animated, StyleSheet } from 'react-native';

jest.mock('../../../hooks/useVisualTheme', () => {
  const { DAY_VISUAL_THEME } = jest.requireActual('../../../components/tokens');
  return { useVisualTheme: () => DAY_VISUAL_THEME };
});

import { MemoryScopeToggle } from '../components/MemoryScopeToggle';
import { useMemoryScopeStore } from '../store/useMemoryScopeStore';
import { useMemorySubscriptionsStore } from '../store/useMemorySubscriptionsStore';

describe('Memory scope presentation', () => {
  let timingSpy: jest.SpyInstance;

  beforeAll(() => {
    timingSpy = jest.spyOn(Animated, 'timing').mockImplementation(() => ({
      start: (callback?: (result: { finished: boolean }) => void) => callback?.({ finished: true }),
    } as any));
  });

  afterAll(() => timingSpy.mockRestore());

  beforeEach(() => {
    useMemoryScopeStore.setState({ scope: 'self', selectedFriendId: null });
    useMemorySubscriptionsStore.setState({
      subscriptions: [
        { friend_id: 11, friend_name: 'First Friend' },
        { friend_id: 22, friend_name: 'Second Friend' },
      ],
    });
  });

  test('shows the selected-friend count only while Friends is active', () => {
    const onPickPress = jest.fn();
    const screen = render(<MemoryScopeToggle onPickPress={onPickPress} />);

    expect(screen.getByText('Mine')).toBeTruthy();
    expect(screen.getByText('Friends')).toBeTruthy();
    expect(screen.queryByText('2')).toBeNull();

    fireEvent.press(screen.getByTestId('memory-scope-combined'));

    expect(useMemoryScopeStore.getState().scope).toBe('combined');
    expect(screen.getByText('2')).toBeTruthy();
    expect(useMemorySubscriptionsStore.getState().subscriptions).toHaveLength(2);
    expect(onPickPress).not.toHaveBeenCalled();
    const picker = screen.getByTestId('memory-scope-pick');
    expect(StyleSheet.flatten(picker.props.style)).toMatchObject({ width: 40 });
    expect(picker.props.hitSlop).toEqual({ top: 2, bottom: 2, left: 2, right: 2 });
    expect(screen.queryByText('First Friend')).toBeNull();
    expect(screen.queryByText('Second Friend')).toBeNull();

    fireEvent.press(screen.getByTestId('memory-scope-self'));
    expect(screen.queryByText('2')).toBeNull();
    expect(useMemorySubscriptionsStore.getState().subscriptions).toHaveLength(2);
  });
});
