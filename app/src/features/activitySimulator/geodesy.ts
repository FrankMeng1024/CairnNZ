export interface GeoCoordinate {
  lat: number;
  lng: number;
}

// Match the production Activity haversine authority so a configured physical
// speed produces the same derived distance/pace without a Simulator formula.
const EARTH_RADIUS_M = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/** Normalize a longitude into the canonical [-180, 180] interval. */
export function normalizeLongitude(longitude: number): number {
  if (!Number.isFinite(longitude)) return Number.NaN;
  const normalized = ((longitude + 180) % 360 + 360) % 360 - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}

export function validateCoordinate(
  latitude: number,
  longitude: number,
): { ok: true; coordinate: GeoCoordinate } | { ok: false; reason: string } {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { ok: false, reason: 'Latitude and longitude must be numbers.' };
  }
  if (latitude < -90 || latitude > 90) {
    return { ok: false, reason: 'Latitude must be between -90 and 90.' };
  }
  return {
    ok: true,
    coordinate: { lat: latitude, lng: normalizeLongitude(longitude) },
  };
}

/**
 * Great-circle destination. Screen-up is true north, right is east.
 * The spherical model is deterministic and remains valid across hemispheres,
 * high latitudes, and the International Date Line.
 */
export function destinationPoint(
  origin: GeoCoordinate,
  bearingDegrees: number,
  distanceM: number,
): GeoCoordinate {
  const validated = validateCoordinate(origin.lat, origin.lng);
  if (!validated.ok || !Number.isFinite(bearingDegrees) || !Number.isFinite(distanceM)) {
    return { lat: origin.lat, lng: normalizeLongitude(origin.lng) };
  }
  if (distanceM <= 0) return validated.coordinate;

  const angularDistance = distanceM / EARTH_RADIUS_M;
  const bearing = toRadians(bearingDegrees);
  const lat1 = toRadians(validated.coordinate.lat);
  const lon1 = toRadians(validated.coordinate.lng);
  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinAngular = Math.sin(angularDistance);
  const cosAngular = Math.cos(angularDistance);

  const lat2 = Math.asin(
    Math.max(-1, Math.min(1,
      sinLat1 * cosAngular + cosLat1 * sinAngular * Math.cos(bearing),
    )),
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * sinAngular * cosLat1,
    cosAngular - sinLat1 * Math.sin(lat2),
  );

  return {
    lat: Math.max(-90, Math.min(90, toDegrees(lat2))),
    lng: normalizeLongitude(toDegrees(lon2)),
  };
}

export function distanceMeters(a: GeoCoordinate, b: GeoCoordinate): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLat = lat2 - lat1;
  const dLng = toRadians(normalizeLongitude(b.lng - a.lng));
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial great-circle bearing in degrees clockwise from true north. */
export function initialBearingDegrees(a: GeoCoordinate, b: GeoCoordinate): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLng = toRadians(normalizeLongitude(b.lng - a.lng));
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((toDegrees(Math.atan2(y, x)) % 360) + 360) % 360;
}
