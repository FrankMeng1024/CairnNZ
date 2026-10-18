export interface MemoryCoverageViewport {
  bbox: [number, number, number, number];
  key: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mercatorY(lat: number): number {
  const radians = clamp(lat, -85.05112878, 85.05112878) * Math.PI / 180;
  return (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2;
}

function latitudeFromMercatorY(y: number): number {
  return Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
}

export function memoryCoverageViewport(
  center: { lat: number; lng: number },
  zoom: number,
  widthPx = 430,
  heightPx = 844,
): MemoryCoverageViewport {
  const boundedZoom = clamp(Number.isFinite(zoom) ? zoom : 14, 4, 20);
  const worldPx = 512 * 2 ** boundedZoom;
  const halfLng = clamp((Math.max(1, widthPx) / worldPx) * 180, 0.001, 9.5);
  const centerY = mercatorY(center.lat);
  const halfY = clamp(Math.max(1, heightPx) / worldPx / 2, 0.000001, 0.2);
  const north = latitudeFromMercatorY(Math.max(0, centerY - halfY));
  const south = latitudeFromMercatorY(Math.min(1, centerY + halfY));
  const west = clamp(center.lng - halfLng, -180, 180);
  const east = clamp(center.lng + halfLng, -180, 180);
  const bbox: [number, number, number, number] = [west, south, east, north];
  return {
    bbox,
    key: bbox.map(value => value.toFixed(5)).join(','),
  };
}
