import type { Route, RoutePoint } from '../../store/useRouteStore';

export type RouteCreationOrigin = 'activity' | 'manual' | 'legacy_unknown';

export interface ActivityRouteReference {
  routeId: string;
  name: string;
  points: RoutePoint[];
  distanceM: number;
  elevationGainM: number;
  capturedAt: number;
}

export function routeIdentityKeys(route: Pick<Route, 'id' | 'remoteId' | 'clientRouteId'>): string[] {
  return Array.from(new Set([route.id, route.remoteId, route.clientRouteId].filter(Boolean) as string[]));
}

export function routeMatchesIdentity(
  route: Pick<Route, 'id' | 'remoteId' | 'clientRouteId'>,
  target: string,
): boolean {
  return routeIdentityKeys(route).includes(String(target));
}

export function cloneActivityRouteReference(route: Route, capturedAt = Date.now()): ActivityRouteReference {
  return {
    routeId: route.id,
    name: route.name,
    points: route.points.map(point => ({ ...point })),
    distanceM: route.distanceM,
    elevationGainM: route.elevationGainM,
    capturedAt,
  };
}

export function routeOriginLines(route: Route): string[] {
  const lines: string[] = [];
  if (route.creationOrigin === 'activity' || route.originActivityClientId || route.originActivityServerId) {
    lines.push('Created from an Activity');
    if (route.originGeometryHash && route.createdGeometryHash
      && route.originGeometryHash !== route.createdGeometryHash) {
      lines.push('Adjusted when this Route was created');
    }
  } else if (route.creationOrigin === 'manual') {
    lines.push('Created as a Route');
  } else {
    lines.push('Origin not recorded');
  }
  if (route.geometryEditedSinceCreation) lines.push('Edited since creation');
  if (route.originActivityGapReconnected) lines.push('Includes a planned connection across a missing Activity section');
  return lines;
}

export function routeCanBeUsed(route: Route): boolean {
  return route.points.length >= 2;
}
