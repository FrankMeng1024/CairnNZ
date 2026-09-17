const mockStorage = new Map<string, string>();
let mockOwnerId = 'route-owner';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockStorage.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockStorage.delete(key); }),
    getAllKeys: jest.fn(async () => Array.from(mockStorage.keys())),
    multiGet: jest.fn(async (keys: string[]) => keys.map(key => [key, mockStorage.get(key) ?? null])),
    multiRemove: jest.fn(async (keys: string[]) => { keys.forEach(key => mockStorage.delete(key)); }),
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
  deleteRoute: jest.fn(async () => 'deleted'),
  deleteRouteByClientId: jest.fn(async () => 'deleted'),
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
import { useRouteEditStore } from '../useRouteEditStore';
import { polylineLengthM } from '../../services/routing/corridor/PolylineSampler';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

const geometryG0 = [
  { lat: -43, lng: 171, alt: 100 },
  { lat: -43.0005, lng: 171.0005, alt: 106 },
  { lat: -43.001, lng: 171.001, alt: 110 },
  { lat: -43.0015, lng: 171.0015, alt: 108 },
  { lat: -43.002, lng: 171.002, alt: 115 },
];

function beginSyntheticTrim(routeId: string, points = geometryG0) {
  useRouteEditStore.setState({
    sessionId: 'geometry-transaction',
    routeId,
    isOpen: true,
    isSaving: false,
    isComputing: false,
    originalPoints: points.map(point => ({ ...point })),
    matchedPoints: points.map(point => ({ ...point })),
    workingPoints: points.map(point => ({ ...point })),
    brushStrokes: [],
    trimStartFrac: 0,
    trimEndFrac: 1,
    previewIsCurrent: true,
    committedDraft: null,
    undoStack: [],
    lastError: null,
  });
  useRouteEditStore.getState().beginTrimDrag();
  useRouteEditStore.getState().setTrimStart(0.25);
  return useRouteEditStore.getState().workingPoints.map(point => ({ ...point }));
}

describe('offline Route creation', () => {
  beforeEach(() => {
    mockStorage.clear();
    mockOwnerId = 'route-owner';
    jest.clearAllMocks();
    jest.mocked(createRoute).mockRejectedValue(new Error('network unavailable'));
    jest.mocked(fetchRoutes).mockRejectedValue(new Error('offline'));
    jest.mocked(fetchRouteDetail).mockResolvedValue(null);
    jest.mocked(updateRoute).mockResolvedValue(null);
    jest.mocked(deleteRemoteRoute).mockResolvedValue('deleted');
    jest.mocked(deleteRouteByClientId).mockResolvedValue('deleted');
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

    jest.mocked(deleteRemoteRoute).mockResolvedValueOnce('deleted');
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

  test('a mutation acknowledgement cannot cross an account switch', async () => {
    let resolveUpdate!: (value: any) => void;
    jest.mocked(updateRoute).mockReturnValueOnce(new Promise(resolve => { resolveUpdate = resolve; }));
    const route = {
      id: 'a-client', clientRouteId: 'a-client', remoteId: '42', name: 'Owner A truth',
      createdAt: 1, updatedAt: 1, points: geometryG0, waypoints: [], distanceM: 250,
      elevationGainM: 15, runCount: 0, isActive: false, syncState: 'synced' as const,
    };
    useRouteStore.setState({ routes: [route] });
    const mutation = useRouteStore.getState().updateRoute(route.id, { name: 'Late A mutation' });
    mockOwnerId = 'owner-b';
    resolveUpdate({ ...route, id: '42', name: 'Late A mutation', updatedAt: 2 });
    await expect(mutation).rejects.toThrow('route_owner_changed');
    expect(useRouteStore.getState().routes[0].name).toBe('Owner A truth');
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

  test('a detail read started before an accepted same-owner mutation cannot overwrite store or cache', async () => {
    let resolveDetail!: (value: any) => void;
    jest.mocked(fetchRouteDetail).mockReturnValueOnce(new Promise(resolve => { resolveDetail = resolve; }));
    const oldPoints = [{ lat: -43, lng: 171 }, { lat: -43.001, lng: 171.001 }];
    const newPoints = [{ lat: -43, lng: 171 }, { lat: -43.002, lng: 171.004 }];
    const route = {
      id: 'stable-client', clientRouteId: 'stable-client', remoteId: '42',
      name: 'Old', createdAt: 1, updatedAt: 1, points: oldPoints,
      waypoints: [], distanceM: 140, elevationGainM: 8, runCount: 0,
      isActive: false, syncState: 'synced' as const,
    };
    useRouteStore.setState({ routes: [route] });

    const oldRead = useRouteStore.getState().loadRouteDetail(route.id);
    jest.mocked(updateRoute).mockResolvedValueOnce({
      ...route,
      id: '42',
      remoteId: '42',
      name: 'New saved name',
      points: newPoints,
      distanceM: 410,
      updatedAt: 2,
    });
    await useRouteStore.getState().updateRoute(route.id, {
      name: 'New saved name',
      points: newPoints,
      distanceM: 410,
    });
    expect(useRouteStore.getState().routes[0]).toMatchObject({
      name: 'New saved name', points: newPoints, distanceM: 410,
    });

    resolveDetail({
      ...route,
      id: '42',
      remoteId: '42',
      name: 'Old',
      points: oldPoints,
      distanceM: 140,
    });
    await oldRead;

    expect(useRouteStore.getState().routes[0]).toMatchObject({
      name: 'New saved name', points: newPoints, distanceM: 410,
    });
    const cached = JSON.parse(mockStorage.get('@cairn:routes:v1:route-owner')!);
    expect(cached[0]).toMatchObject({
      name: 'New saved name', points: newPoints, distanceM: 410,
    });
  });

  test('unsupported client delete falls back to a known owned server ID', async () => {
    const route = {
      id: 'stable-client', clientRouteId: 'stable-client', remoteId: '42',
      name: 'Delete by fallback', createdAt: 1, updatedAt: 1,
      points: geometryG0, waypoints: [], distanceM: 250, elevationGainM: 15,
      runCount: 0, isActive: false, syncState: 'synced' as const,
    };
    useRouteStore.setState({ routes: [route] });
    jest.mocked(deleteRouteByClientId).mockResolvedValueOnce('unsupported');
    jest.mocked(deleteRemoteRoute).mockResolvedValueOnce('already-absent');

    await expect(useRouteStore.getState().deleteRoute(route.id)).resolves.toEqual({ remoteState: 'deleted' });
    expect(deleteRemoteRoute).toHaveBeenCalledWith('42');
    expect(useRouteStore.getState().routes).toHaveLength(0);
    const tombstones = JSON.parse(mockStorage.get('@cairn:route_tombstones:v1:route-owner')!);
    expect(tombstones[0]).toMatchObject({ clientRouteId: 'stable-client', remoteId: '42', remoteDeleted: true });
  });

  test('unsupported client delete without a server ID remains queued', async () => {
    const route = {
      id: 'local-client', clientRouteId: 'local-client', name: 'Pending cleanup',
      createdAt: 1, updatedAt: 1, points: geometryG0, waypoints: [],
      distanceM: 250, elevationGainM: 15, runCount: 0, isActive: false,
      syncState: 'synced' as const,
    };
    useRouteStore.setState({ routes: [route] });
    jest.mocked(deleteRouteByClientId).mockResolvedValueOnce('unsupported');

    await expect(useRouteStore.getState().deleteRoute(route.id)).resolves.toEqual({ remoteState: 'queued' });
    expect(deleteRemoteRoute).not.toHaveBeenCalled();
    const tombstones = JSON.parse(mockStorage.get('@cairn:route_tombstones:v1:route-owner')!);
    expect(tombstones[0]).toMatchObject({
      clientRouteId: 'local-client',
      remoteDeleted: false,
      lastErrorCode: 'CLIENT_DELETE_ENDPOINT_UNSUPPORTED',
    });
  });

  test('failed legacy fallback retains tombstone cleanup state', async () => {
    const route = {
      id: 'stable-client', clientRouteId: 'stable-client', remoteId: '42',
      name: 'Retry cleanup', createdAt: 1, updatedAt: 1, points: geometryG0,
      waypoints: [], distanceM: 250, elevationGainM: 15, runCount: 0,
      isActive: false, syncState: 'synced' as const,
    };
    useRouteStore.setState({ routes: [route] });
    jest.mocked(deleteRouteByClientId).mockResolvedValueOnce('unsupported');
    jest.mocked(deleteRemoteRoute).mockRejectedValueOnce(Object.assign(new Error('timeout'), {
      code: 'ROUTE_REQUEST_TIMEOUT', outcomeUnknown: true,
    }));

    await expect(useRouteStore.getState().deleteRoute(route.id)).resolves.toEqual({ remoteState: 'queued' });
    const tombstones = JSON.parse(mockStorage.get('@cairn:route_tombstones:v1:route-owner')!);
    expect(tombstones[0]).toMatchObject({
      clientRouteId: 'stable-client', remoteDeleted: false, lastErrorCode: 'ROUTE_REQUEST_TIMEOUT',
    });
  });

  test('a list read started before a geometry save cannot reintroduce superseded content', async () => {
    let resolveList!: (value: any[]) => void;
    jest.mocked(fetchRoutes).mockReturnValueOnce(new Promise(resolve => { resolveList = resolve; }));
    const oldRoute = {
      id: 'stable-client', clientRouteId: 'stable-client', remoteId: '42',
      name: 'Old', createdAt: 1, updatedAt: 1, points: geometryG0,
      waypoints: [], distanceM: 250, elevationGainM: 15, runCount: 0,
      isActive: false, syncState: 'synced' as const,
    };
    const nextPoints = geometryG0.slice(1);
    useRouteStore.setState({ routes: [oldRoute] });
    const oldList = useRouteStore.getState().loadRoutes();
    await settle();
    jest.mocked(updateRoute).mockResolvedValueOnce({
      ...oldRoute, id: '42', remoteId: '42', name: 'Accepted',
      points: nextPoints, distanceM: 190, updatedAt: 3,
    });
    await useRouteStore.getState().updateRoute(oldRoute.id, {
      name: 'Accepted', points: nextPoints, distanceM: 190,
    });
    resolveList([{ ...oldRoute, id: '42', remoteId: '42', points: [], name: 'Old' }]);
    await oldList;
    expect(useRouteStore.getState().routes[0]).toMatchObject({
      id: 'stable-client', name: 'Accepted', points: nextPoints, distanceM: 190,
    });
  });

  test('a delayed detail not-found cannot replace a newer accepted mutation', async () => {
    let resolveDetail!: (value: null) => void;
    jest.mocked(fetchRouteDetail).mockReturnValueOnce(new Promise(resolve => { resolveDetail = resolve; }));
    const route = {
      id: 'stable-client', clientRouteId: 'stable-client', remoteId: '42',
      name: 'Before', createdAt: 1, updatedAt: 1, points: geometryG0,
      waypoints: [], distanceM: 250, elevationGainM: 15, runCount: 0,
      isActive: false, syncState: 'synced' as const,
    };
    useRouteStore.setState({ routes: [route] });
    const read = useRouteStore.getState().loadRouteDetail(route.id);
    jest.mocked(updateRoute).mockResolvedValueOnce({ ...route, id: '42', name: 'After', updatedAt: 2 });
    await useRouteStore.getState().updateRoute(route.id, { name: 'After' });
    resolveDetail(null);
    await expect(read).resolves.toBe('ready');
    expect(useRouteStore.getState().routes[0].name).toBe('After');
    expect(useRouteStore.getState().routeDetailState['stable-client']).toBe('ready');
  });

  test('two detail reads returning out of order keep the newer request and later refresh remains usable', async () => {
    let resolveFirst!: (value: any) => void;
    let resolveSecond!: (value: any) => void;
    jest.mocked(fetchRouteDetail)
      .mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve; }))
      .mockReturnValueOnce(new Promise(resolve => { resolveSecond = resolve; }));
    const route = {
      id: 'stable-client', clientRouteId: 'stable-client', remoteId: '42',
      name: 'Cached', createdAt: 1, updatedAt: 1, points: [], waypoints: [],
      distanceM: 250, elevationGainM: 15, runCount: 0, isActive: false,
      syncState: 'synced' as const,
    };
    useRouteStore.setState({ routes: [route] });
    const first = useRouteStore.getState().loadRouteDetail(route.id);
    const second = useRouteStore.getState().loadRouteDetail(route.id);
    resolveSecond({ ...route, id: '42', name: 'Newer response', points: geometryG0, updatedAt: 4 });
    await expect(second).resolves.toBe('ready');
    resolveFirst({ ...route, id: '42', name: 'Older response', points: geometryG0, updatedAt: 2 });
    await expect(first).resolves.toBe('idle');
    expect(useRouteStore.getState().routes[0].name).toBe('Newer response');

    jest.mocked(fetchRouteDetail).mockResolvedValueOnce({
      ...route, id: '42', name: 'Legitimate later refresh', points: geometryG0, updatedAt: 5,
    });
    await expect(useRouteStore.getState().loadRouteDetail(route.id)).resolves.toBe('ready');
    expect(useRouteStore.getState().routes[0].name).toBe('Legitimate later refresh');
  });

  test('cache hydration after relaunch preserves a newer acknowledged server result', async () => {
    const route = {
      id: 'stable-client', clientRouteId: 'stable-client', remoteId: '42',
      name: 'Before', createdAt: 1, updatedAt: 1, points: geometryG0,
      waypoints: [], distanceM: 250, elevationGainM: 15, runCount: 0,
      isActive: false, syncState: 'synced' as const,
    };
    useRouteStore.setState({ routes: [route] });
    jest.mocked(updateRoute).mockResolvedValueOnce({
      ...route, id: '42', remoteId: '42', name: 'Accepted after save', updatedAt: 10,
    });
    await useRouteStore.getState().updateRoute(route.id, { name: 'Accepted after save' });
    expect(useRouteStore.getState().routes[0]).toMatchObject({
      name: 'Accepted after save', acceptedServerUpdatedAt: 10,
    });

    useRouteStore.setState({ routes: [] });
    jest.mocked(fetchRoutes).mockResolvedValueOnce([{
      ...route, id: '42', remoteId: '42', name: 'Older server projection', points: [], updatedAt: 5,
    }]);
    await useRouteStore.getState().loadRoutes();
    expect(useRouteStore.getState().routes[0]).toMatchObject({
      id: 'stable-client', name: 'Accepted after save', acceptedServerUpdatedAt: 10,
    });
    const cached = JSON.parse(mockStorage.get('@cairn:routes:v1:route-owner')!);
    expect(cached[0].name).toBe('Accepted after save');
  });

  test('a detail read returning after tombstoned deletion cannot resurrect the Route or cache', async () => {
    let resolveDetail!: (value: any) => void;
    jest.mocked(fetchRouteDetail).mockReturnValueOnce(new Promise(resolve => { resolveDetail = resolve; }));
    const route = {
      id: 'stable-client', clientRouteId: 'stable-client', remoteId: '42',
      name: 'Delete during read', createdAt: 1, updatedAt: 1, points: geometryG0,
      waypoints: [], distanceM: 250, elevationGainM: 15, runCount: 0,
      isActive: false, syncState: 'synced' as const,
    };
    useRouteStore.setState({ routes: [route] });
    const read = useRouteStore.getState().loadRouteDetail(route.id);
    await useRouteStore.getState().deleteRoute(route.id);
    resolveDetail({ ...route, id: '42', name: 'Late resurrection' });
    await read;
    expect(useRouteStore.getState().routes).toHaveLength(0);
    expect(JSON.parse(mockStorage.get('@cairn:routes:v1:route-owner')!)).toEqual([]);
  });

  test('real trim commands produce G1, Apply leaves G0 accepted, Save persists G1, and reload retains it', async () => {
    const activityTruth = { points: geometryG0.map(point => ({ ...point })), distanceM: 250 };
    const memoryTruth = [{ cid: 'memory-1', lat: -43, lng: 171 }];
    const activityBefore = JSON.stringify(activityTruth);
    const memoryBefore = JSON.stringify(memoryTruth);
    const id = await useRouteStore.getState().addRoute({
      name: 'Geometry transaction', points: geometryG0.map(point => ({ ...point })),
      originalPoints: geometryG0.map(point => ({ ...point })), waypoints: [],
      distanceM: 250, elevationGainM: 15, originActivityGapReconnected: true,
    }, { clientActivityId: 'source-activity', reconnectsActivityGap: true });
    const g1 = beginSyntheticTrim(id!);
    expect(g1).not.toEqual(geometryG0);
    expect(useRouteEditStore.getState().commitEditDraft()).toEqual({ ok: true });
    expect(useRouteStore.getState().routes[0].points).toEqual(geometryG0);

    await useRouteStore.getState().updateRoute(id!, {
      points: g1,
      distanceM: polylineLengthM(g1),
    });
    expect(useRouteStore.getState().routes[0]).toMatchObject({
      points: g1,
      geometryEditedSinceCreation: true,
      originActivityGapReconnected: true,
    });
    expect(JSON.stringify(activityTruth)).toBe(activityBefore);
    expect(JSON.stringify(memoryTruth)).toBe(memoryBefore);

    useRouteStore.setState({ routes: [] });
    await useRouteStore.getState().loadRoutes();
    expect(useRouteStore.getState().routes[0].points).toEqual(g1);
  });

  test('Cancel leaves G0 accepted; failed save retains G1 draft and retry commits once', async () => {
    const route = {
      id: 'stable-client', clientRouteId: 'stable-client', remoteId: '42',
      name: 'Geometry retry', createdAt: 1, updatedAt: 1,
      points: geometryG0.map(point => ({ ...point })), originalPoints: geometryG0.map(point => ({ ...point })),
      waypoints: [], distanceM: 250, elevationGainM: 15, runCount: 0,
      isActive: false, syncState: 'synced' as const,
    };
    useRouteStore.setState({ routes: [route] });
    beginSyntheticTrim(route.id);
    useRouteEditStore.getState().cancelEdit();
    expect(useRouteStore.getState().routes[0].points).toEqual(geometryG0);

    const g1 = beginSyntheticTrim(route.id);
    expect(useRouteEditStore.getState().commitEditDraft()).toEqual({ ok: true });
    jest.mocked(updateRoute).mockRejectedValueOnce(new Error('offline'));
    await expect(useRouteStore.getState().updateRoute(route.id, {
      points: g1, distanceM: polylineLengthM(g1),
    })).rejects.toThrow('offline');
    expect(useRouteStore.getState().routes[0].points).toEqual(geometryG0);
    expect(useRouteEditStore.getState().committedDraft?.workingPoints).toEqual(g1);

    jest.mocked(updateRoute).mockResolvedValueOnce({
      ...route, id: '42', remoteId: '42', points: g1,
      distanceM: polylineLengthM(g1), updatedAt: 2,
    });
    await useRouteStore.getState().updateRoute(route.id, {
      points: g1, distanceM: polylineLengthM(g1),
    });
    expect(updateRoute).toHaveBeenCalledTimes(2);
    expect(useRouteStore.getState().routes[0].points).toEqual(g1);
  });
});
