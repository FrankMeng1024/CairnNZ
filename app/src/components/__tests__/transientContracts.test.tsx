import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BottomActionArea } from '../BottomActionArea';
import { BottomSheetHeader } from '../BottomSheetFrame';
import { StateSurface, STATE_SURFACE_SYMBOL } from '../StateSurface';

jest.mock('../../hooks/useVisualTheme', () => {
  const { DAY_VISUAL_THEME } = jest.requireActual('../tokens');
  return { useVisualTheme: () => DAY_VISUAL_THEME };
});

const safeAreaMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

describe('transient surface contracts', () => {
  it('keeps the state API semantic and restrained', () => {
    expect(Object.keys(STATE_SURFACE_SYMBOL)).toEqual([
      'loading', 'empty', 'error', 'offline', 'permission', 'recovery', 'unavailable',
    ]);
    expect(STATE_SURFACE_SYMBOL.loading).toBeNull();
    expect(STATE_SURFACE_SYMBOL.permission).toBe('MapPin');
    expect(STATE_SURFACE_SYMBOL.offline).toBe('CloudOff');
  });

  it('renders loading, copy, guidance and caller-owned actions compositionally', () => {
    const screen = render(
      <StateSurface
        variant="loading"
        title="Loading route details"
        body="This should only take a moment."
        secondaryGuidance={<Text>Offline copy stays available.</Text>}
        actions={<Text>Cancel</Text>}
      />,
    );
    expect(screen.getByTestId('state-surface-spinner')).toBeTruthy();
    expect(screen.getByText('Loading route details')).toBeTruthy();
    expect(screen.getByText('Offline copy stays available.')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
  });

  it('provides optional sheet hierarchy and safe-area-aware bottom actions', () => {
    const screen = render(
      <SafeAreaProvider initialMetrics={safeAreaMetrics}>
        <BottomSheetHeader title="Preparing your route" subtitle="Ready when you are." />
        <BottomActionArea testID="actions"><Text>Continue</Text></BottomActionArea>
      </SafeAreaProvider>,
    );
    expect(screen.getByText('Preparing your route')).toBeTruthy();
    expect(screen.getByText('Ready when you are.')).toBeTruthy();
    expect(screen.getByTestId('actions')).toBeTruthy();
  });
});
