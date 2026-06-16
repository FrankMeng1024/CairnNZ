/**
 * geoMath.ts — TS port of UnityARLib/Assets/Scripts/v025/Core/GeoMath.cs
 *
 * v0.2.5 Phase 2A.2. Rule G algorithmic lock-step:
 *   - C# and TS implementations MUST produce identical results
 *   - Both sides consume _review/v0.2.5/fixtures/geomath_parity.json
 *   - Drift detection via parity tests (TS: this file's __tests__; C#: GeoMathParityFixtureTests)
 *
 * EarthRadiusMeters MUST equal C# constant (6371000.0). Do not change without
 * also changing GeoMath.cs and the parity fixture.
 *
 * Coordinate convention: same as C#:
 *   Origin = (originLat, originLng) defines local ENU frame.
 *   East = +X, North = +Z, Up = +Y. Right-handed Y-up matches Unity.
 */

export const EarthRadiusMeters = 6371000.0;

export function toRad(deg: number): number {
    return (deg * Math.PI) / 180.0;
}

export function toDeg(rad: number): number {
    return (rad * 180.0) / Math.PI;
}

/** Great-circle distance between two lat/lng points in meters. */
export function haversineMeters(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number
): number {
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const lat1R = toRad(lat1);
    const lat2R = toRad(lat2);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1R) * Math.cos(lat2R) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EarthRadiusMeters * c;
}

/**
 * Convert (lat, lng) to local ENU offset relative to origin, in meters.
 * Returns { east, north }. Up component is altitude diff handled separately.
 *
 * Same shape as C# tuple (east, north) — Phase 1A ADR-010 §C parity contract.
 */
export function latLngToEnuMeters(
    originLat: number,
    originLng: number,
    lat: number,
    lng: number
): { east: number; north: number } {
    const dLat = toRad(lat - originLat);
    const dLng = toRad(lng - originLng);
    const north = dLat * EarthRadiusMeters;
    const east = dLng * EarthRadiusMeters * Math.cos(toRad(originLat));
    return { east, north };
}

/** Inverse of latLngToEnuMeters. */
export function enuMetersToLatLng(
    originLat: number,
    originLng: number,
    eastM: number,
    northM: number
): { lat: number; lng: number } {
    const dLat = northM / EarthRadiusMeters;
    const dLng = eastM / (EarthRadiusMeters * Math.cos(toRad(originLat)));
    const lat = originLat + toDeg(dLat);
    const lng = originLng + toDeg(dLng);
    return { lat, lng };
}

/** Initial bearing from (lat1,lng1) to (lat2,lng2) in degrees [0,360). */
export function bearingDegrees(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number
): number {
    const lat1R = toRad(lat1);
    const lat2R = toRad(lat2);
    const dLng = toRad(lng2 - lng1);
    const y = Math.sin(dLng) * Math.cos(lat2R);
    const x =
        Math.cos(lat1R) * Math.sin(lat2R) -
        Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLng);
    const brngRad = Math.atan2(y, x);
    const brngDeg = toDeg(brngRad);
    return (brngDeg + 360.0) % 360.0;
}
