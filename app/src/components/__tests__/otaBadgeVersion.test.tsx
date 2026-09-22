import React from 'react';
import { render } from '@testing-library/react-native';
import { OTA_VERSION, OtaBadge } from '../OtaBadge';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

describe('OTA candidate marker', () => {
  it('exports O61 and renders the exact truthful initial inline status once', () => {
    expect(OTA_VERSION).toBe('O61');

    const screen = render(<OtaBadge inline />);

    expect(screen.getAllByText('O61 · Checking for update')).toHaveLength(1);
    expect(screen.queryByText(/O60/)).toBeNull();
    screen.unmount();
  });
});
