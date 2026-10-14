export interface LocationFixLike {
  coords: {
    latitude: number;
    longitude: number;
    accuracy?: number | null;
  };
  timestamp?: number | null;
}
export interface QualifiedLocationPoint {
  lat: number;
  lng: number;
}

export function qualifiedLocationPoint(
  fix: LocationFixLike | null | undefined,
  options: { now?: number; maxAgeMs: number; maxAccuracyM: number },
): QualifiedLocationPoint | null {
  if (!fix) return null;
  const { latitude, longitude, accuracy } = fix.coords;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  if (accuracy != null && (!Number.isFinite(accuracy) || accuracy > options.maxAccuracyM)) return null;
  const timestamp = fix.timestamp;
  if (timestamp != null) {
    if (!Number.isFinite(timestamp)) return null;
    const age = (options.now ?? Date.now()) - timestamp;
    if (age < -30_000 || age > options.maxAgeMs) return null;
  }
  return { lat: latitude, lng: longitude };
}
