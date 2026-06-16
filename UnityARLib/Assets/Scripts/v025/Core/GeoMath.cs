// Phase 1A.7 — GeoMath (C# side, lat/lng <-> ENU local frame).
//
// Pure-math, no Unity dependency, no I/O. Mirror of geoMath.ts (Phase 2A.2)
// for cross-platform lock-step (Rule G algorithmic parity).
//
// Coordinate convention:
//   Origin = (originLat, originLng) defines local ENU frame.
//   East = +X, North = +Z, Up = +Y. (Matches Unity right-handed Y-up.)
//
// Accuracy: WGS84 great-circle (Haversine) for distance + bearing; flat-earth
// approximation for ENU offsets within ~1km (sufficient for AR placement).

using System;

namespace Cairn.AR.V025.Core
{
    public static class GeoMath
    {
        public const double EarthRadiusMeters = 6371000.0;

        /// <summary>Great-circle distance between two lat/lng points in meters.</summary>
        public static double HaversineMeters(double lat1, double lng1, double lat2, double lng2)
        {
            var dLat = ToRad(lat2 - lat1);
            var dLng = ToRad(lng2 - lng1);
            var lat1R = ToRad(lat1);
            var lat2R = ToRad(lat2);
            var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2) +
                    Math.Cos(lat1R) * Math.Cos(lat2R) *
                    Math.Sin(dLng / 2) * Math.Sin(dLng / 2);
            var c = 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
            return EarthRadiusMeters * c;
        }

        /// <summary>
        /// Convert (lat, lng) to local ENU offset relative to origin, in meters.
        /// Returns (east, north). Up component is altitude diff handled separately.
        /// </summary>
        public static (double east, double north) LatLngToEnuMeters(
            double originLat, double originLng,
            double lat, double lng)
        {
            // Flat-earth approximation valid for distances < ~1km.
            var dLat = ToRad(lat - originLat);
            var dLng = ToRad(lng - originLng);
            var north = dLat * EarthRadiusMeters;
            var east = dLng * EarthRadiusMeters * Math.Cos(ToRad(originLat));
            return (east, north);
        }

        /// <summary>
        /// Inverse of LatLngToEnuMeters. Convert ENU offset (meters) back to (lat, lng).
        /// </summary>
        public static (double lat, double lng) EnuMetersToLatLng(
            double originLat, double originLng,
            double eastM, double northM)
        {
            var dLat = northM / EarthRadiusMeters;
            var dLng = eastM / (EarthRadiusMeters * Math.Cos(ToRad(originLat)));
            var lat = originLat + ToDeg(dLat);
            var lng = originLng + ToDeg(dLng);
            return (lat, lng);
        }

        /// <summary>Initial bearing from (lat1,lng1) to (lat2,lng2) in degrees [0,360).</summary>
        public static double BearingDegrees(double lat1, double lng1, double lat2, double lng2)
        {
            var lat1R = ToRad(lat1);
            var lat2R = ToRad(lat2);
            var dLng = ToRad(lng2 - lng1);
            var y = Math.Sin(dLng) * Math.Cos(lat2R);
            var x = Math.Cos(lat1R) * Math.Sin(lat2R) -
                    Math.Sin(lat1R) * Math.Cos(lat2R) * Math.Cos(dLng);
            var brngRad = Math.Atan2(y, x);
            var brngDeg = ToDeg(brngRad);
            return (brngDeg + 360.0) % 360.0;
        }

        public static double ToRad(double deg) => deg * Math.PI / 180.0;
        public static double ToDeg(double rad) => rad * 180.0 / Math.PI;
    }
}
