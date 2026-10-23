import { haversineM } from '../../../utils/geo';

export function memoryCameraAtTarget(
  target: [number, number],
  renderedCenter: [number, number],
): boolean {
  return haversineM(
    { lat: target[1], lng: target[0] },
    { lat: renderedCenter[1], lng: renderedCenter[0] },
  ) <= 150;
}

export function memoryCameraCenterFromEvent(event: unknown): [number, number] | null {
  const value = event as {
    properties?: { center?: unknown };
    geometry?: { coordinates?: unknown };
  } | null;
  const center = value?.properties?.center ?? value?.geometry?.coordinates;
  if (!Array.isArray(center) || center.length < 2) return null;
  const lng = Number(center[0]);
  const lat = Number(center[1]);
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
}
