import React from 'react';
import fs from 'fs';
import path from 'path';
import { render } from '@testing-library/react-native';
import { OTA_VERSION, OtaBadge } from '../OtaBadge';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

describe('OTA candidate marker', () => {
  it('exports O90 and renders the exact truthful initial inline status once', () => {
    expect(OTA_VERSION).toBe('O90');

    const screen = render(<OtaBadge inline />);

    expect(screen.getAllByText('O90 · Checking for update')).toHaveLength(1);
    expect(screen.queryByText(/O88/)).toBeNull();
    screen.unmount();
  });

  it('is mounted visibly by the active Home rendering path', () => {
    const homeSource = fs.readFileSync(path.resolve(__dirname, '../../screens/HomeScreen.tsx'), 'utf8');
    expect(homeSource).toContain("import { OtaBadge } from '../components/OtaBadge';");
    expect(homeSource).toContain('<OtaBadge inline />');
  });
});
