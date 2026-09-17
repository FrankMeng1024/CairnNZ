jest.mock('../../store/storage', () => ({
  storage: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

import { useSettingsStore } from '../../store/useSettingsStore';
import {
  formatDistanceForUser,
  formatElevationForUser,
  formatShortDistanceForUser,
} from '../distanceFormat';

describe('Settings units preference', () => {
  afterEach(() => {
    useSettingsStore.setState({ units: 'metric' });
  });

  test('formats distance and elevation consistently in Metric', () => {
    useSettingsStore.setState({ units: 'metric' });

    expect(formatDistanceForUser(1609.344, 2)).toBe('1.61 km');
    expect(formatShortDistanceForUser(125)).toBe('125 m');
    expect(formatElevationForUser(100, 0)).toBe('100 m');
  });

  test('formats distance, near distance, and elevation consistently in Imperial', () => {
    useSettingsStore.setState({ units: 'imperial' });

    expect(formatDistanceForUser(1609.344, 2)).toBe('1.00 mi');
    expect(formatShortDistanceForUser(125)).toBe('410 ft');
    expect(formatElevationForUser(100, 0)).toBe('328 ft');
  });
});
