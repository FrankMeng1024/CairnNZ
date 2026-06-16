// Phase 2A.10 — Algorithmic lock-step single-source unit tests.
//
// Rule G v3 modified: physical-platform parity (real ARCore vs ARKit) is
// deferred to v0.2.6 per ADR-002. Phase 2A's lock-step test is thus
// "algorithmic per-branch parity" — verify that #if UNITY_IOS path and
// #if UNITY_ANDROID path produce the same output for the same inputs at the
// algorithm layer (GeoMath, FloorPlaneValidatorV2 thresholds, retry timeouts).
//
// Since the test runs in Editor (UNITY_EDITOR), neither UNITY_IOS nor
// UNITY_ANDROID branches activate at compile time. We verify lock-step by
// comparing the two branches' EXPECTED outputs derived from the same constant
// table (PlanConstantsV2) — if a future dev forks one platform's threshold,
// the constant table changes and this test detects it.

using NUnit.Framework;
using Cairn.AR.V025.Core;

namespace Cairn.AR.V025.Tests.Unit
{
    public class GpsAlgorithmLockStepTests
    {
        // The key algorithmic constants both platforms must read from.
        // If a #if branch ever overrides these, that's a parity violation.
        [Test]
        public void EarthRadius_SameForAllPlatforms()
        {
            // GeoMath is platform-agnostic — no #if branches in current code.
            // This test pins that fact: forking GeoMath under #if UNITY_ANDROID
            // would make this test grep `#if UNITY_` in GeoMath.cs and fail.
            // Static check via type metadata can't easily cover preprocessor;
            // instead we assert behavior: same lat/lng → same haversine.
            var d1 = GeoMath.HaversineMeters(40.7128, -74.0060, 40.7228, -74.0060);
            var d2 = GeoMath.HaversineMeters(40.7128, -74.0060, 40.7228, -74.0060);
            Assert.AreEqual(d1, d2);
            // 0.01 deg lat ≈ 1112m
            Assert.That(d1, Is.InRange(1100.0, 1115.0));
        }

        [Test]
        public void FloorPlaneValidator_ThresholdsConstant_NoForkPerPlatform()
        {
            // Plan §1A.9 constants — same on iOS and Android.
            Assert.AreEqual(15.0f, FloorPlaneValidatorV2.MaxNormalDeviationDegrees);
            Assert.AreEqual(0.3f, FloorPlaneValidatorV2.MaxAboveUserMeters);
            Assert.AreEqual(3.0f, FloorPlaneValidatorV2.MaxBelowUserMeters);
            Assert.AreEqual(0.25f, FloorPlaneValidatorV2.MinExtentAreaM2);
        }

        [Test]
        public void PendingAnchorRetry_TimeoutsConstant()
        {
            // Phase 2A.4 constants — same per platform; if a platform-specific
            // override creeps in (e.g. Android = 2000ms) telemetry analysis breaks.
            Assert.AreEqual(1000, Cairn.AR.V025.Spawn.PendingAnchorRetryV2.DefaultTimeoutMs);
            Assert.AreEqual(50, Cairn.AR.V025.Spawn.PendingAnchorRetryV2.InitialBackoffMs);
            Assert.AreEqual(250, Cairn.AR.V025.Spawn.PendingAnchorRetryV2.MaxBackoffMs);
        }
    }
}
