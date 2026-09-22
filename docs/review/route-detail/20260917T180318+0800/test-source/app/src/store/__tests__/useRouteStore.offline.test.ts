const mockStorage = new Map<string, string>();
let mockOwnerId = 'route-owner';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockStorage.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockStorage.delete(key); }),
  },
}));
jest.mock('../../services/networkMonitor', () => ({
  __esModule: true,
  default: { onChange: jest.fn(() => () => {}) },
}));
jest.mock('../../services/crashLogger', () => ({ crashLogger: { breadcrumb: jest.fn() } }));
jest.mock('../useAppStore', () => ({
  useAppStore: { getState: () => ({ user: mockOwnerId ? { id: mockOwnerId } : null }) },
}));
jest.mock('../../services/routeService', () => ({
  fetchRoutes: jest.fn(async () => { throw new Error('offline'); }),
  fetchRouteDetail: jest.fn(async () => null),
  createRoute: jest.fn(async () => { throw new Error('network unavailable'); }),
  updateRoute: jest.fn(async () => null),
  deleteRoute: jest.fn(async () => true),
  deleteRouteByClientId: jest.fn(async () => true),
}));

import { offlineRoutes } from '../../services/routeOfflineEntities';
import {
  createRoute,
  deleteRoute as deleteRemoteRoute,
  deleteRouteByClientId,
  fetchRouteDetail,
  fetchRoutes,
  updateRoute,
} from '../../services/routeService';
import { useRouteStore } from '../useRouteStore';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('offline Route creation', () => {
  beforeEach(() => {
    mockStorage.clear();
    mockOwnerId = 'route-owner';
    jest.clearAllMocks();
    jest.mocked(createRoute).mockRejectedValue(new Error('network unavailable'));
    jest.mocked(fetchRoutes).mockRejectedValue(new Error('offline'));
    jest.mocked(fetchRouteDetail).mockResolvedValue(null);
    jest.mocked(updateRoute).mockResolvedValue(null);
    jest.mocked(deleteRemoteRoute).mockResolvedValue(true);
    jest.mocked(deleteRouteByClientId).mockResolvedValue(true);
    useRouteStore.setState({
      routes: [],
      routeOwnerId: 'route-owner',
      routesLoading: false,
      routesLoadError: false,
      routeDetailState: {},
      activityRouteReference: null,
    });
  });

  test('commits an independent local Route before server acknowledgement', async () => {
    const activityPoints = [
      { lat: -39.2, lng: 175.5, alt: 1180 },
      { lat: -39.201, lng: 175.502, alt: 1195 },
    ];
    const id = await useRouteStore.getState().addRoute({
      name: 'Ridge return',
      points: activityPoints,
      originalPoints: activityPoints,
      waypoints: [],
      distanceM: 220,
      elevationGainM: 15,
      permission: 'personal',
    });

    expect(id).toEqual(expect.any(String));
    expect(useRouteStore.getState().routes[0]).toMatchObject({
      id,
      clientRouteId: id,
      name: 'Ridge return',
      syncState: 'pending',
    });
    expect(await offlineRoutes.getEntry(id!)).toMatchObject({
      data: { userId: 'route-owner', route: { name: 'Ridge return' } },
    });

    activityPoints[0].lat = 0;
    expect(useRouteStore.getState().routes[0].points[0].lat).toBe(-39.2);
    expect((await offlineRoutes.getEntry(id!))?.data.route.points[0].lat).toBe(-39.2);

    await settle();
    expect(createRoute).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Ridge return' }),
      id,
    );
    expect(useRouteStore.getState().routes[0].syncState).toBe('pending');
    expect(mockStorage.has('@cairn:routes:v1:route-owner')).toBe(true);
  });

  test('a fast acknowledgement keeps one stable local identity', async () => {
    jest.mocked(createRoute).mockResolvedValueOnce({
      id: '42',
      name: 'Fast ridge',
      points: [{ lat: -43, lng: 171 }, { lat: -43.001, lng: 171.001 }],
      waypoints: [],
      distanceM: 140,
      elevationGainM: 8,
      runCount: 0,
      createdAt: 1,
      updatedAt: 1,
      isActive: false,
    });

    const id = await useRouteStore.getState().addRoute({
      name: 'Fast ridge',
      points: [{ lat: -43, lng: 171 }, { lat: -43.001, lng: 171.001 }],
      waypoints: [],
      distanceM: 140,
      elevationGainM: 8,
    });
    await settle();

    expect(useRouteStore.getState().routes).toHaveLength(1);
    expect(useRouteStore.getState().routes[0]).toMatchObject({
      id,
      remoteId: '42',
      syncState: 'synced',
    });
  });

  test('keeps the minimal Activity origin on the independent local Route', async () => {
    const sourcePoints = [{ lat: -44, lng: 168 }, { lat: -44.001, lng: 168.001 }];
    const id = await useRouteStore.getState().addRoute({
      name: 'Activity copy',
      points: sourcePoints,
      waypoints: [],
      distanceM: 150,
      elevationGainM: 8,
    }, {
      clientActivityId: 'activity-client',
      serverActivityId: 42,
      reconnectsActivityGap: true,
    });

    expect(useRouteStore.getState().routes[0]).toMatchObject({
      id,
      originActivityClientId: 'activity-client',
      originActivityServerId: 42,
      originActivityGapReconnected: true,
    });
    expect((await offlineRoutes.getEntry(id!))?.data.route).toMatchObject({
      originActivityClientId: 'activity-client',
      originActivityServerId: 42,
      originActivityGapReconnected: true,
    });
    sourcePoints[0].lat = 0;
    expect(useRouteStore.getState().routes[0].points[0].lat).toBe(-44);
  });

  test('a server load failure preserves local Routes and exposes honest load state', async () => {
    useRouteStore.setState({
      routeOwnerId: 'route-owner',
      routes: [{
        id: 'local-route',
        name: 'Local ridge',
        createdAt: 1,
        updatedAt: 1,
        points: [{ lat: -43, lng: 171 }, { lat: -43.001, lng: 171.001 }],
        waypoints: [],
        distanceM: 140,
        elevationGainM: 8,
        runCount: 0,
        isActive: false,
        syncState: 'pending',
      }],
    });

    await useRouteStore.getState().loadRoutes();

    expect(useRouteStore.getState()).toMatchObject({ routesLoading: false, routesLoadError: true });
    expect(useRouteStore.getState().routes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'local-route', name: 'Local ridge' }),
    ]));
  });

  test('pending edits update durable create payload before visible truth', async () => {
    const id = await useRouteStore.getState().addRoute({
      name: 'Original',
      points: [{ lat: -43, lng: 171 }, { lat: -43.001, lng: 171.001 }],
      waypoints: [],
      distanceM: 140,
      elevationGainM: 8,
    });

    await useRouteStore.getState().updateRoute(id!, { name: 'Durable draft' });

    expect((await offlineRoutes.getEntry(id!))?.data.route.name).toBe('Durable draft');
    expect(useRouteStore.getState().routes[0]).toMatchObject({
      id,
      name: 'Durable draft',
      syncState: 'pending',
    });
  });

  test('synced update waits for acknowledgement and retains accepted truth on failure', async () => {
    const route = {
      id: 'stable-client', clientRouteId: 'stable-client', remoteId: '42',
      name: 'Accepted', createdAt: 1, updatedAt: 1,
      points: [{ lat: -43, lng: 171 }, { lat: -43.001, lng: 171.001 }],
      waypoints: [], distanceM: 140, elevationGainM: 8, runCount: 0,
      isActive: false, syncState: 'synced' as const,
    };
    useRouteStore.setState({ routes: [route] });
    jest.mocked(updateRoute).mockRejectedValueOnce(new Error('offline'));

    await expect(useRouteStore.getState().updateRoute(route.id, { name: 'Draft' })).rejects.toThrow('offline');
    expect(useRouteStore.getState().routes[0].name).toBe('Accepted');

    jest.mocked(updateRoute).mockResolvedValueOnce({ ...route, id: '42', remoteId: '42', name: 'Draft' });
    await useRouteStore.getState().updateRoute(route.id, { name: 'Draft' });
    expect(useRouteStore.getState().routes[0]).toMatchObject({ id: 'stable-client', remoteId: '42', name: 'Draft' });
  });

  test('an old-backend update preserves local origin without claiming durable provenance', async () => {
    const route = {
      id: 'stable-client', clientRouteId: 'stable-client', remoteId: '42',
      name: 'Accepted', createdAt: 1, updatedAt: 1,
      points: [{ lat: -43, lng: 171 }, { lat: -43.001, lng: 171.001 }],
      waypoints: [], distanceM: 140, elevationGainM: 8, runCount: 0,
      isActive: false, syncState: 'synced' as const,
      creationOrigin: 'activity' as const,
      originActivityClientId: 'activity-client',
      originPersistence: 'legacy-local' as const,
    };
    useRouteStore.setState({ routes: [route] });
    jest.mocked(updateRoute).mockResolvedValueOnce({
      ...route,
      id: '42',
      clientRouteId: undefined,
      creationOrigin: 'legacy_unknown',
      originActivityClientId: undefined,
      originPersistence: 'unknown',
      name: 'Renamed',
    });

    await useRouteStore.getState().updateRoute(route.id, { name: 'Renamed' });

    expect(useRouteStore.getState().routes[0]).toMatchObject({
      id: 'stable-client',
      name: 'Renamed',
      creationOrigin: 'activity',
      originActivityClientId: 'activity-client',
      originPersistence: 'legacy-local',
    });
  });

  test('permanent source failure stays local and is not presented as retryable connectivity', async () => {
    jest.mocked(createRoute).mockRejectedValueOnce(Object.assign(
      new Error('Source Activity no longer exists.'),
      { status: 410, code: 'SOURCE_ACTIVITY_DELETED' },
    ));
    const id = await useRouteStore.getState().addRoute({
      name: 'Independent local copy',
      points: [{ lat: -43, lng: 171 }, { lat: -43.001, lng: 171.001 }],
      waypoints: [], distanceM: 140, elevationGainM: 8,
    }, { clientActivityId: 'deleted-activity' });
    await settle();
    await settle();

    expect(useRouteStore.getState().routes[0]).toMatchObject({
      id,
      syncState: 'failed',
      syncErrorCode: 'SOURCE_ACTIVITY_DELETED',
    });
    expect((await offlineRoutes.getEntry(id!))?.lastErrorCode).toBe('SOURCE_ACTIVITY_DELETED');
  });

  test('legacy synced delete waits for acknowledgement and retains Route on failure', async () => {
    const route = {
      id: '42', remoteId: '42', name: 'Legacy server Route',
      createdAt: 1, updatedAt: 1,
      points: [{ lat: -43, lng: 171 }, { lat: -43.001, lng: 171.001 }],
      waypoints: [], distanceM: 140, elevationGainM: 8, runCount: 0,
      isActive: false, syncState: 'synced' as const,
    };
    useRouteStore.setState({ routes: [route] });
    jest.mocked(deleteRemoteRoute).mockRejectedValueOnce(new Error('offline'));
    await expect(useRouteStore.getState().deleteRoute(route.id)).rejects.toThrow('offline');
    expect(useRouteStore.getState().routes).toHaveLength(1);

    jest.mocked(deleteRemoteRoute).mockResolvedValueOnce(true);
    await useRouteStore.getState().deleteRoute(route.id);
    expect(useRouteStore.getState().routes).toHaveLength(0);
  });

  test('durable delete prevents a late create acknowledgement from resurrecting the Route', async () => {
    let resolveCreate!: (route: any) => void;
    jest.mocked(createRoute).mockReturnValueOnce(new Promise(resolve => { resolveCreate = resolve; }));
    const id = await useRouteStore.getState().addRoute({
      name: 'Delete me',
      points: [{ lat: -43, lng: 171 }, { lat: -43.001, lng: 171.001 }],
      waypoints: [], distanceM: 140, elevationGainM: 8,
    });
    await settle();
    await useRouteStore.getState().deleteRoute(id!);
    expect(useRouteStore.getState().routes).toHaveLength(0);
    resolveCreate({
      id: '99', remoteId: '99', clientRouteId: id!, name: 'Delete me',
      createdAt: 1, updatedAt: 1,
      points: [{ lat: -43, lng: 171 }, { lat: -43.001, lng: 171.001 }],
      waypoints: [], distanceM: 140, elevationGainM: 8, runCount: 0, isActive: false,
    });
    await settle();
    await settle();
    expect(useRouteStore.getState().routes).toHaveLength(0);
  });

  test('an active Activity keeps an independent Route reference snapshot', () => {
    const route = {
      id: 'snapshot-route', clientRouteId: 'snapshot-route', name: 'Reference',
      createdAt: 1, updatedAt: 1,
      points: [{ lat: -43, lng: 171 }, { lat: -43.001, lng: 171.001 }],
      waypoints: [], distanceM: 140, elevationGainM: 8, runCount: 0, isActive: false,
    };
    useRouteStore.setState({ routes: [route] });
    const snapshot = useRouteStore.getState().captureActivityRouteReference(route.id);
    route.points[0].lat = 0;
    useRouteStore.setState({ routes: [{ ...route, points: [{ lat: 1, lng: 1 }, ...route.points.slice(1)] }] });
    expect(snapshot?.points[0].lat).toBe(-43);
    expect(useRouteStore.getState().activityRouteReference?.points[0].lat).toBe(-43);
  });

  test('server acknowledgement discovered by list deduplicates the pending local identity', async () => {
    const id = await useRouteStore.getState().addRoute({
      name: 'Response lost',
      points: [{ lat: -43, lng: 171 }, { lat: -43.001, lng: 171.001 }],
      waypoints: [], distanceM: 140, elevationGainM: 8,
    });
    jest.mocked(fetchRoutes).mockResolvedValueOnce([{
      id: '88', remoteId: '88', clientRouteId: id!, name: 'Response lost',
      creationOrigin: 'manual', originPersistence: 'durable',
      createdAt: 1, updatedAt: 2, points: [], waypoints: [],
      distanceM: 140, elevationGainM: 8, runCount: 0, isActive: false,
    }]);

    await useRouteStore.getState().loadRoutes();

    expect(useRouteStore.getState().routes).toHaveLength(1);
    expect(useRouteStore.getState().routes[0]).toMatchObject({
      id,
      clientRouteId: id,
      remoteId: '88',
      originPersistence: 'durable',
    });
  });

  test('late detail response is dropped after an account switch', async () => {
    let resolveDetail!: (value: any) => void;
    jest.mocked(fetchRouteDetail).mockReturnValueOnce(new Promise(resolve => { resolveDetail = resolve; }));
    useRouteStore.setState({ routes: [{
      id: 'a-client', clientRouteId: 'a-client', remoteId: '42', name: 'A',
      createdAt: 1, updatedAt: 1, points: [], waypoints: [], distanceM: 10,
      elevationGainM: 0, runCount: 0, isActive: false,
    }] });
    const pending = useRouteStore.getState().loadRouteDetail('a-client');
    mockOwnerId = 'owner-b';
    resolveDetail({
      id: '42', remoteId: '42', name: 'Leaked A', createdAt: 1, updatedAt: 2,
      points: [{ lat: -43, lng: 171 }, { lat: -43.1, lng: 171.1 }], waypoints: [],
      distanceM: 10, elevationGainM: 0, runCount: 0, isActive: false,
    });
    await pending;
    expect(useRouteStore.getState().routes[0].name).toBe('A');
  });

  test('detail hydration uses remote identity while preserving the local stable ID', async () => {
    jest.mocked(fetchRouteDetail).mockResolvedValueOnce({
      id: '42',
      name: 'Synced ridge',
      createdAt: 1,
      updatedAt: 2,
      points: [{ lat: -43, lng: 171 }, { lat: -43.001, lng: 171.001 }],
      waypoints: [],
      distanceM: 140,
      elevationGainM: 8,
      runCount: 0,
      isActive: false,
    });
    useRouteStore.setState({
      routes: [{
        id: 'stable-local-id',
        remoteId: '42',
        name: 'Synced ridge',
        createdAt: 1,
        updatedAt: 1,
        points: [],
        waypoints: [],
        distanceM: 140,
        elevationGainM: 8,
        runCount: 0,
        isActive: false,
        syncState: 'synced',
      }],
    });

    await useRouteStore.getState().loadRouteDetail('stable-local-id');

    expect(fetchRouteDetail).toHaveBeenCalledWith('42');
    expect(useRouteStore.getState().routes[0]).toMatchObject({
      id: 'stable-local-id',
      points: expect.arrayContaining([expect.objectContaining({ lat: -43 })]),
    });
  });
});
