import { createOfflineEntity } from './offlineEntity';
import { createRoute } from './routeService';
import type { Route } from '../store/useRouteStore';

export interface OfflineRouteCreatePayload {
  userId: string;
  route: Omit<Route, 'id' | 'createdAt' | 'updatedAt' | 'runCount' | 'isActive' | 'remoteId' | 'syncState'>;
  sourceActivity?: {
    clientActivityId?: string;
    serverActivityId?: number;
    reconnectsActivityGap?: boolean;
  };
}

let routeAckHandler: ((localId: string, server: Route, data: OfflineRouteCreatePayload, ownerId: string) => void | Promise<void>) | null = null;
let routeFailureHandler: ((localId: string, error: unknown, ownerId: string) => void) | null = null;

export function setRouteCreateHandlers(
  ack: (localId: string, server: Route, data: OfflineRouteCreatePayload, ownerId: string) => void | Promise<void>,
  fail?: (localId: string, error: unknown, ownerId: string) => void,
): void {
  routeAckHandler = ack;
  routeFailureHandler = fail ?? null;
}

function currentUserId(): string {
  try {
    // Lazy require avoids making auth hydration depend on the route store.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useAppStore } = require('../store/useAppStore');
    return String(useAppStore.getState().user?.id ?? '');
  } catch {
    return '';
  }
}

export const offlineRoutes = createOfflineEntity<OfflineRouteCreatePayload, Route>({
  kind: 'route_create',
  retainOnPermanentFailure: true,
  captureOwnerId: currentUserId,
  isOwnerCurrent: ownerId => currentUserId() === ownerId,
  storageKey: ownerId => ownerId ? `@cairn:offline_routes:v1:${ownerId}` : '',
  syncToServer: async (data, localId, ownerId) => {
    if (!ownerId || data.userId !== ownerId || currentUserId() !== ownerId) {
      const error: any = new Error('route owner unavailable');
      error.status = 503;
      throw error;
    }
    try {
      const created = await createRoute({
        client_route_id: localId,
        name: data.route.name,
        description: data.route.description,
        points: data.route.points,
        waypoints: data.route.waypoints,
        distance_m: data.route.distanceM,
        elevation_gain_m: data.route.elevationGainM,
        permission: data.route.permission,
        source_activity_client_id: data.sourceActivity?.clientActivityId,
        source_session_id: data.sourceActivity?.serverActivityId,
        origin_gap_reconnected: data.sourceActivity?.reconnectsActivityGap,
      }, localId);
      if (!created) {
        const error: any = new Error('route create returned no route');
        error.status = 503;
        throw error;
      }
      return created;
    } catch (error: any) {
      // Activity and Route queues may race after connectivity returns. A
      // source lookup miss is repairable after the Activity upload lands.
      if (error?.code === 'SOURCE_ACTIVITY_NOT_FOUND' || error?.code === 'SOURCE_ACTIVITY_NOT_READY') {
        error.status = 503;
      }
      throw error;
    }
  },
  onSyncSuccess: (localId, server, data, ownerId) =>
    routeAckHandler?.(localId, server, data, ownerId),
  onSyncFailure: (localId, error, _data, ownerId) =>
    routeFailureHandler?.(localId, error, ownerId),
});
