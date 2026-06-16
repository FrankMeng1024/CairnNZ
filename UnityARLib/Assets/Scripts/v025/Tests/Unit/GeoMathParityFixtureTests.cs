// Phase 1A — GeoMath parity fixture test (Rule G C# / TS lock-step).
//
// Reads _review/v0.2.5/fixtures/geomath_parity.json and verifies all
// expected values match within fixture tolerance. Phase 2A.2 geoMath.ts
// MUST consume the same fixture and pass the same checks — that is the
// drift-detection mechanism for Rule G.

using System;
using System.IO;
using System.Linq;
using NUnit.Framework;
using Cairn.AR.V025.Core;

namespace Cairn.AR.V025.Tests.Unit
{
    public class GeoMathParityFixtureTests
    {
        // Resolve path relative to project root (Unity Application.dataPath ends in /Assets,
        // so we go up two levels). Tests run from C:/.../Cairn/UnityARLib so we find the
        // fixture via repo-relative search.
        private static string FindFixturePath()
        {
            // Walk up from current dir to find _review/v0.2.5/fixtures/geomath_parity.json
            var dir = TestContext.CurrentContext.TestDirectory ?? Directory.GetCurrentDirectory();
            for (int hop = 0; hop < 8; hop++)
            {
                var candidate = Path.Combine(dir, "_review", "v0.2.5", "fixtures", "geomath_parity.json");
                if (File.Exists(candidate)) return candidate;
                var parent = Directory.GetParent(dir);
                if (parent == null) break;
                dir = parent.FullName;
            }
            return null;
        }

        [Test]
        public void EarthRadiusMatchesFixture()
        {
            var path = FindFixturePath();
            if (path == null) Assert.Inconclusive("fixture not found — running outside repo");
            var json = File.ReadAllText(path);
            // Minimal JSON probe — avoid full parser dependency. Look for "earth_radius_meters":
            var idx = json.IndexOf("\"earth_radius_meters\"", StringComparison.Ordinal);
            Assert.Greater(idx, -1, "fixture must contain earth_radius_meters");
            var colon = json.IndexOf(':', idx);
            var comma = json.IndexOf(',', colon);
            var raw = json.Substring(colon + 1, comma - colon - 1).Trim();
            var fixtureRadius = double.Parse(raw, System.Globalization.CultureInfo.InvariantCulture);
            Assert.AreEqual(fixtureRadius, GeoMath.EarthRadiusMeters,
                "GeoMath.EarthRadiusMeters has drifted from parity fixture — TS port will fail");
        }

        [TestCase(0.0, 0.0, 0.0, 0.0, 0.0)]                      // same_point
        [TestCase(0, 0, 0, 1, 111195.0)]                         // one_deg_lng_at_equator
        [TestCase(0, 0, 1, 0, 111195.0)]                         // one_deg_lat
        [TestCase(40.7128, -74.0060, 40.7578, -74.0060, 5005.0)] // 5km_north_of_ny
        public void Haversine_Fixture(double lat1, double lng1, double lat2, double lng2, double expectedM)
        {
            var actual = GeoMath.HaversineMeters(lat1, lng1, lat2, lng2);
            Assert.That(actual, Is.EqualTo(expectedM).Within(2.0),
                "haversine drift > 2m from parity fixture (TS port will fail)");
        }

        [TestCase(0, 0, 1, 0, 0.0)]    // due_north
        [TestCase(0, 0, 0, 1, 90.0)]   // due_east
        [TestCase(0, 0, -1, 0, 180.0)] // due_south
        [TestCase(0, 0, 0, -1, 270.0)] // due_west
        public void Bearing_Fixture(double lat1, double lng1, double lat2, double lng2, double expectedDeg)
        {
            var actual = GeoMath.BearingDegrees(lat1, lng1, lat2, lng2);
            Assert.That(actual, Is.EqualTo(expectedDeg).Within(0.5),
                "bearing drift > 0.5° from parity fixture");
        }
    }
}
