// Phase 1A.7 — GeoMath unit tests (Editor mode).

using NUnit.Framework;
using Cairn.AR.V025.Core;

namespace Cairn.AR.V025.Tests.Unit
{
    public class GeoMathTests
    {
        // Equator: 1 degree lng ≈ 111.32 km
        [Test]
        public void Haversine_OneDegreeLng_AtEquator_IsAbout111km()
        {
            var d = GeoMath.HaversineMeters(0.0, 0.0, 0.0, 1.0);
            Assert.That(d, Is.InRange(111000.0, 112000.0));
        }

        [Test]
        public void Haversine_SamePoint_IsZero()
        {
            var d = GeoMath.HaversineMeters(40.7128, -74.0060, 40.7128, -74.0060);
            Assert.That(d, Is.EqualTo(0.0).Within(0.001));
        }

        [Test]
        public void Haversine_KnownDistance_NyToLondon_About5570km()
        {
            // NYC 40.7128, -74.0060 → London 51.5074, -0.1278
            var d = GeoMath.HaversineMeters(40.7128, -74.0060, 51.5074, -0.1278);
            Assert.That(d, Is.InRange(5550000.0, 5600000.0));
        }

        [Test]
        public void LatLngToEnu_RoundTrip_StaysWithin1Cm()
        {
            // 100m east + 50m north of NYC origin
            var origin = (lat: 40.7128, lng: -74.0060);
            var (lat2, lng2) = GeoMath.EnuMetersToLatLng(origin.lat, origin.lng, 100.0, 50.0);
            var (east, north) = GeoMath.LatLngToEnuMeters(origin.lat, origin.lng, lat2, lng2);
            Assert.That(east, Is.EqualTo(100.0).Within(0.01));
            Assert.That(north, Is.EqualTo(50.0).Within(0.01));
        }

        [Test]
        public void Bearing_DueNorth_Is0()
        {
            var b = GeoMath.BearingDegrees(0.0, 0.0, 1.0, 0.0);
            Assert.That(b, Is.EqualTo(0.0).Within(0.01));
        }

        [Test]
        public void Bearing_DueEast_Is90()
        {
            var b = GeoMath.BearingDegrees(0.0, 0.0, 0.0, 1.0);
            Assert.That(b, Is.EqualTo(90.0).Within(0.5));
        }

        [Test]
        public void Bearing_DueSouth_Is180()
        {
            var b = GeoMath.BearingDegrees(0.0, 0.0, -1.0, 0.0);
            Assert.That(b, Is.EqualTo(180.0).Within(0.01));
        }

        [Test]
        public void Bearing_DueWest_Is270()
        {
            var b = GeoMath.BearingDegrees(0.0, 0.0, 0.0, -1.0);
            Assert.That(b, Is.EqualTo(270.0).Within(0.5));
        }

        [Test]
        public void Bearing_AlwaysInZeroTo360Range()
        {
            // Negative lng diff should map into [0, 360)
            var b = GeoMath.BearingDegrees(40.0, -74.0, 41.0, -75.0);
            Assert.That(b, Is.GreaterThanOrEqualTo(0.0).And.LessThan(360.0));
        }
    }
}
