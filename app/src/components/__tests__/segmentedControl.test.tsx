import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { SegmentedControl } from '../SegmentedControl';
import { RadiusRole } from '../tokens';

jest.mock('../../hooks/useVisualTheme', () => {
  const { DAY_VISUAL_THEME } = jest.requireActual('../tokens');
  return { useVisualTheme: () => DAY_VISUAL_THEME };
});

describe('SegmentedControl integrated track contract', () => {
  it('renders adjoining active and inactive regions inside one clipped track', () => {
    const screen = render(
      <SegmentedControl
        value="friends"
        segments={[
          { key: 'friends', label: 'Friends' },
          { key: 'requests', label: 'Requests' },
        ]}
        onChange={() => {}}
        testID="tabs"
      />,
    );

    const track = StyleSheet.flatten(screen.getByTestId('tabs').props.style);
    const [first, last] = screen.getAllByRole('tab').map(tab => StyleSheet.flatten(tab.props.style));

    expect(track.padding).toBe(1);
    expect(track.gap).toBeUndefined();
    expect(track.overflow).toBe('hidden');
    expect(first.borderTopLeftRadius).toBe(RadiusRole.segmentedItem);
    expect(first.borderTopRightRadius).toBeUndefined();
    expect(last.borderTopRightRadius).toBe(RadiusRole.segmentedItem);
    expect(last.borderTopLeftRadius).toBeUndefined();
  });
});
