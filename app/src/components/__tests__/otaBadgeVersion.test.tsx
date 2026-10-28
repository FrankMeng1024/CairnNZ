import React from 'react';
import fs from 'fs';
import path from 'path';
import { render } from '@testing-library/react-native';
import { OTA_VERSION, OtaReleaseMarker } from '../OtaBadge';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

describe('OTA candidate marker', () => {
  it('exports O96 and renders only the discreet release marker', () => {
    expect(OTA_VERSION).toBe('O96');

    const screen = render(<OtaReleaseMarker />);

    expect(screen.getAllByText('O96')).toHaveLength(1);
    expect(screen.queryByText(/Checking|Up to date|update/i)).toBeNull();
    screen.unmount();
  });

  it('is mounted only by the active Home rendering path', () => {
    const homeSource = fs.readFileSync(path.resolve(__dirname, '../../screens/HomeScreen.tsx'), 'utf8');
    const authSource = fs.readFileSync(path.resolve(__dirname, '../../screens/AuthScreen.tsx'), 'utf8');
    expect(homeSource).toContain("import { OtaReleaseMarker } from '../components/OtaBadge';");
    expect(homeSource).toContain('<OtaReleaseMarker />');
    expect(authSource).not.toContain('<OtaBadge');
  });
});
