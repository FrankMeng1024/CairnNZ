const mockTrackingStore = Object.assign(jest.fn(), { getState: jest.fn() });

jest.mock('@react-navigation/native', () => ({
  useNavigation: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: jest.fn(),
}));

jest.mock('../../store/useMarkerStore', () => ({
  useMarkerStore: jest.fn(),
}));

jest.mock('../../store/useAppStore', () => ({
  useAppStore: jest.fn(),
}));

jest.mock('../../store/storage', () => ({
  storage: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

jest.mock('../../services/networkMonitor', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../../features/plant/components/GpsLockStep', () => ({
  GpsLockStep: jest.fn(),
}));

jest.mock('../../features/plant/components/PinAdjustStep', () => ({
  PinAdjustStep: jest.fn(),
}));

jest.mock('../../features/plant/components/ContentStep', () => ({
  ContentStep: jest.fn(),
}));

jest.mock('../../features/public/services/publicCairns', () => ({
  usePublicCairnStore: jest.fn(),
}));

jest.mock('../../services/appLog', () => ({ log: jest.fn() }));
jest.mock('../../services/hapticService', () => ({ haptic: {} }));
jest.mock('../../hooks/useVisualTheme', () => ({ useVisualTheme: jest.fn() }));

jest.mock('../../store/useTrackingStore', () => ({
  useTrackingStore: mockTrackingStore,
}));

jest.mock('../../features/activitySimulator/simulatorTime', () => ({
  activityFreshnessNow: jest.fn(),
}));

import { activityFreshnessNow } from '../../features/activitySimulator/simulatorTime';
import { resolveInitialPlantContext } from '../PlantScreen';

const mockActivityFreshnessNow = activityFreshnessNow as jest.MockedFunction<
  typeof activityFreshnessNow
>;

describe('Plant active-Activity location authority', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('historical Simulator evidence is fresh on the selected provider timeline', () => {
    const virtualNow = 1_800_000_000_000 - 12 * 60 * 60_000;
    const tracking = {
      status: 'tracking',
      locationProviderSource: 'simulator',
      locationAvailable: true,
      lastCoordinate: { lat: -41.2865, lng: 174.7762, accuracy: 13 },
      lastCoordinateTime: virtualNow - 1_000,
      sessionId: 'simulator-activity',
      ownerUserId: 'owner-a',
      liveOwnerGeneration: 'simulator-generation',
    } as const;
    mockActivityFreshnessNow.mockReturnValue(virtualNow);

    const context = resolveInitialPlantContext(tracking);

    expect(context).toMatchObject({
      step: 'content',
      fromActivity: true,
      draft: {
        lat: -41.2865,
        lng: 174.7762,
        accuracyM: 13,
      },
    });
    expect(mockActivityFreshnessNow).toHaveBeenCalledWith('simulator');
  });

  test('normal Real evidence remains fresh on wall-clock authority', () => {
    const wallNow = 1_800_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(wallNow);
    const tracking = {
      status: 'tracking',
      locationProviderSource: 'real',
      locationAvailable: true,
      lastCoordinate: { lat: -41.2864, lng: 174.7763, accuracy: 8 },
      lastCoordinateTime: wallNow - 2_000,
      sessionId: 'real-activity',
      ownerUserId: 'owner-a',
      liveOwnerGeneration: 'real-generation',
    } as const;
    mockActivityFreshnessNow.mockReturnValue(wallNow);

    expect(resolveInitialPlantContext(tracking)).toMatchObject({ step: 'content', fromActivity: true });
    expect(mockActivityFreshnessNow).toHaveBeenCalledWith('real');
  });

  test('standalone Plant still enters bounded GPS flow without an active Activity', () => {
    const tracking = {
      status: 'idle',
      locationProviderSource: 'real',
      locationAvailable: true,
      lastCoordinate: { lat: -41.2864, lng: 174.7763, accuracy: 8 },
      lastCoordinateTime: 1_800_000_000_000,
      sessionId: null,
      ownerUserId: null,
      liveOwnerGeneration: null,
    } as const;
    mockActivityFreshnessNow.mockReturnValue(1_800_000_000_000);

    expect(resolveInitialPlantContext(tracking)).toMatchObject({ step: 'gps', fromActivity: false });
  });
});
