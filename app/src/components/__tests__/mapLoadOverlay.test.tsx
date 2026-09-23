import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { MapLoadOverlay } from '../MapLoadOverlay';

jest.mock('../../hooks/useVisualTheme', () => ({
  useVisualTheme: () => ({
    background: '#f4f1e8',
    surfaceElevated: '#fffdf7',
    border: '#d9d3c5',
    shadow: '#000000',
    controlSelected: '#e2eadf',
    primary: '#35604a',
    iconActive: '#35604a',
    foreground: '#20332b',
    foregroundSecondary: '#5d6d65',
    primaryAction: '#35604a',
    onPrimary: '#ffffff',
  }),
}));

jest.mock('../Icon', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return { Icon: ({ name }: { name: string }) => ReactModule.createElement(View, { testID: `icon-${name}` }) };
});

describe('MapLoadOverlay', () => {
  test('describes a cold map load without mislabelling it as low GPS signal', () => {
    const view = render(<MapLoadOverlay state="loading" recordingContinues />);
    expect(view.getByText('Preparing your map')).toBeTruthy();
    expect(view.getByText(/Your activity is still being recorded/)).toBeTruthy();
    expect(view.queryByText(/Low signal/i)).toBeNull();
  });

  test('offers one immediate retry for a slow or failed map', () => {
    const retry = jest.fn();
    const view = render(<MapLoadOverlay state="slow" onRetry={retry} />);
    fireEvent.press(view.getByRole('button', { name: 'Try loading the map again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  test('does not pretend an offline map can be retried without connectivity', () => {
    const view = render(<MapLoadOverlay state="offline" />);
    expect(view.getByText('Map offline')).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Try loading the map again' })).toBeNull();
  });
});
