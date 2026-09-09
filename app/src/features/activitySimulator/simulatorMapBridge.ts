import type { SimulatorCoordinate } from './types';

type CenterGetter = () => Promise<SimulatorCoordinate | null>;
let getter: CenterGetter | null = null;

export function registerSimulatorMapCenterGetter(next: CenterGetter): () => void {
  getter = next;
  return () => unregisterSimulatorMapCenterGetter(next);
}

export function unregisterSimulatorMapCenterGetter(expected: CenterGetter): void {
  if (getter === expected) getter = null;
}

export async function getSimulatorMapCenter(): Promise<SimulatorCoordinate | null> {
  try {
    return getter ? await getter() : null;
  } catch {
    return null;
  }
}

export function coordinateFromMapEvent(event: any): SimulatorCoordinate | null {
  const coordinates = event?.geometry?.coordinates ?? event?.features?.[0]?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const lng = Number(coordinates[0]);
  const lat = Number(coordinates[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}
