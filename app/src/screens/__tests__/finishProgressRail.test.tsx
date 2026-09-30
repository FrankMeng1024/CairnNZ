import React from 'react';
import { act, render, screen } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('../../utils/distanceFormat', () => ({
  useDistance: () => ({
    format: (value: number) => String(value), unit: 'km',
    formatElevation: (value: number) => String(value), elevUnit: 'm',
  }),
}));
jest.mock('../../hooks/useVisualTheme', () => ({
  useVisualTheme: () => ({
    mode: 'day', surfaceElevated: '#fff', foreground: '#111', foregroundSecondary: '#666',
  }),
}));

import { StopSummarySheet } from '../StopSummarySheet';

const summary = {
  distanceM: 120,
  durationS: 80,
  elevationGainM: 3,
  activityMode: 'hiking' as const,
  trackPoints: [
    { lat: -41, lng: 174, segmentId: 'one' },
    { lat: -41.001, lng: 174.001, segmentId: 'one' },
  ],
  startedAt: 1_700_000_000_000,
};

describe('three-concept Finish progress rail', () => {
  afterEach(() => jest.useRealTimers());

  test('shows local safety complete while the bounded Route selection is current', () => {
    render(
      <StopSummarySheet
        summary={summary}
        saving
        finishProgress={{
          hike: 'saved', route: 'refining', sync: 'pending', roadRefinementPending: false,
        }}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );
    expect(screen.getByText('Finishing hike')).toBeTruthy();
    expect(screen.getByText('Hike saved')).toBeTruthy();
    expect(screen.getByText('Refining route')).toBeTruthy();
    expect(screen.getByText('Sync')).toBeTruthy();
    expect(screen.queryByText('Hike complete')).toBeNull();
  });

  test('does not claim the Hike is saved before the durable local boundary', () => {
    render(
      <StopSummarySheet
        summary={summary}
        saving
        finishProgress={{
          hike: 'saving', route: 'pending', sync: 'pending', roadRefinementPending: false,
        }}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );
    expect(screen.getByText('Saving hike')).toBeTruthy();
    expect(screen.queryByText('Hike saved')).toBeNull();
    expect(screen.getByText('Sync')).toBeTruthy();
  });

  test('offline completion presents a ready Route and waiting Sync without failure copy', () => {
    render(
      <StopSummarySheet
        summary={summary}
        committed
        syncState="pending"
        roadRefinementPending
        finishProgress={{
          hike: 'saved', route: 'ready', sync: 'waiting', roadRefinementPending: true,
        }}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );
    expect(screen.getByText('Hike complete')).toBeTruthy();
    expect(screen.getByText('Hike saved')).toBeTruthy();
    expect(screen.getAllByText('Route ready').length).toBeGreaterThan(0);
    expect(screen.getByText('Sync · Waiting for connection')).toBeTruthy();
    expect(screen.getByText('Road refinement will continue when online')).toBeTruthy();
    expect(screen.queryByText(/failed/i)).toBeNull();
  });

  test('durable session completion clears stale process-local road-pending copy', () => {
    const props = {
      summary,
      committed: true,
      syncState: 'pending' as const,
      finishProgress: {
        hike: 'saved' as const, route: 'ready' as const, sync: 'pending' as const,
        roadRefinementPending: true,
      },
      onCancel: jest.fn(),
      onConfirm: jest.fn(),
    };
    const rendered = render(<StopSummarySheet {...props} roadRefinementPending />);
    expect(screen.getByText('Road refinement will continue when online')).toBeTruthy();
    rendered.rerender(<StopSummarySheet {...props} roadRefinementPending={false} />);
    expect(screen.queryByText('Road refinement will continue when online')).toBeNull();
  });

  test('route-selected online completion is complete while Sync continues', () => {
    render(
      <StopSummarySheet
        summary={summary}
        committed
        syncState="syncing"
        finishProgress={{
          hike: 'saved', route: 'ready', sync: 'syncing', roadRefinementPending: false,
        }}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );
    expect(screen.getByText('Hike complete')).toBeTruthy();
    expect(screen.getByText('Syncing')).toBeTruthy();
  });

  test('a single accepted upgrade is described without internal refinement terminology', () => {
    render(
      <StopSummarySheet
        summary={summary}
        committed
        syncState="syncing"
        routeRefined
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );
    expect(screen.getByText('Route refined')).toBeTruthy();
    expect(screen.queryByText(/revision|map matching|candidate/i)).toBeNull();
  });

  test('sync errors are not mislabeled as offline waiting', () => {
    render(
      <StopSummarySheet
        summary={summary}
        committed
        syncState="sync_error"
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );
    expect(screen.getByText('Hike complete')).toBeTruthy();
    expect(screen.getByText('Sync · Needs attention')).toBeTruthy();
    expect(screen.queryByText('Sync · Waiting for connection')).toBeNull();
  });

  test('briefly shows all three complete, then collapses to Hike complete', () => {
    jest.useFakeTimers();
    render(
      <StopSummarySheet
        summary={summary}
        committed
        syncState="synced"
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );
    expect(screen.getByText('Hike complete')).toBeTruthy();
    expect(screen.getByText('Synced')).toBeTruthy();
    expect(screen.getByTestId('activity-finish-progress-rail')).toBeTruthy();
    act(() => { jest.advanceTimersByTime(1_201); });
    expect(screen.getByText('Hike complete')).toBeTruthy();
    expect(screen.queryByTestId('activity-finish-progress-rail')).toBeNull();
    expect(screen.getByText('View activity')).toBeTruthy();
  });

  test('collapses when Finish truth is synced before the persisted session sync field catches up', () => {
    jest.useFakeTimers();
    render(
      <StopSummarySheet
        summary={summary}
        committed
        syncState="pending"
        finishProgress={{
          hike: 'saved', route: 'ready', sync: 'synced', roadRefinementPending: false,
        }}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );
    expect(screen.getByText('Synced')).toBeTruthy();
    act(() => { jest.advanceTimersByTime(1_201); });
    expect(screen.queryByTestId('activity-finish-progress-rail')).toBeNull();
    expect(screen.getByText('Hike complete')).toBeTruthy();
  });

  test('does not collapse the completed rail until the save handler has settled', () => {
    jest.useFakeTimers();
    const progress = {
      hike: 'saved' as const, route: 'ready' as const, sync: 'synced' as const,
      roadRefinementPending: false,
    };
    const rendered = render(
      <StopSummarySheet
        summary={summary}
        committed
        saving
        syncState="pending"
        finishProgress={progress}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );
    act(() => { jest.advanceTimersByTime(2_000); });
    expect(screen.getByTestId('activity-finish-progress-rail')).toBeTruthy();
    rendered.rerender(
      <StopSummarySheet
        summary={summary}
        committed
        syncState="pending"
        finishProgress={progress}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );
    act(() => { jest.advanceTimersByTime(1_201); });
    expect(screen.queryByTestId('activity-finish-progress-rail')).toBeNull();
  });
});
