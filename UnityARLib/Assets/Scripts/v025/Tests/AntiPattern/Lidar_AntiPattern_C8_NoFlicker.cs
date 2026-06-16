// Phase 1A.8 — Anti-pattern test C8: LiDAR availability sticky-cache.
//
// Verifies that once Available is observed, subsequent false observations do
// NOT downgrade the cached value. This guards against the v0.2.4 bug where
// transient false reports during ARSession bring-up caused wrong shader path.

using NUnit.Framework;
using Cairn.AR.V025.Core;

namespace Cairn.AR.V025.Tests.AntiPattern
{
    public class Lidar_AntiPattern_C8_NoFlicker
    {
        [Test]
        public void OnceAvailable_NeverDowngrades()
        {
            var lidar = new LidarAvailability();
            lidar.Observe(true);
            Assert.IsTrue(lidar.IsAvailable);

            // Three consecutive false reports — stickiness keeps it Available.
            lidar.Observe(false);
            lidar.Observe(false);
            lidar.Observe(false);
            Assert.IsTrue(lidar.IsAvailable, "LiDAR was downgraded after observing Available — flicker bug regressed");
        }

        [Test]
        public void NeverObservedAvailable_RequiresThreeFalseToConfirmUnavailable()
        {
            var lidar = new LidarAvailability();
            Assert.AreEqual(LidarAvailability.LidarState.Unknown, lidar.CurrentState);

            lidar.Observe(false);
            Assert.AreEqual(LidarAvailability.LidarState.Unknown, lidar.CurrentState);
            lidar.Observe(false);
            Assert.AreEqual(LidarAvailability.LidarState.Unknown, lidar.CurrentState);
            lidar.Observe(false);
            Assert.AreEqual(LidarAvailability.LidarState.Unavailable, lidar.CurrentState);
        }

        [Test]
        public void TrueObservation_ResetsConsecutiveFalseCounter()
        {
            var lidar = new LidarAvailability();
            lidar.Observe(false);
            lidar.Observe(false);
            lidar.Observe(true);
            Assert.IsTrue(lidar.IsAvailable);

            // Subsequent falses should not flip back: stickiness wins.
            lidar.Observe(false);
            lidar.Observe(false);
            lidar.Observe(false);
            Assert.IsTrue(lidar.IsAvailable);
        }

        // Round-2 (#1A-1-7): ResetForTesting should fully reset state.
        [Test]
        public void ResetForTesting_ReturnsStateToUnknown()
        {
            var lidar = new LidarAvailability();
            lidar.Observe(true);
            Assert.IsTrue(lidar.IsAvailable);

            lidar.ResetForTesting();
            Assert.AreEqual(LidarAvailability.LidarState.Unknown, lidar.CurrentState);
            Assert.IsFalse(lidar.IsAvailable);

            // After reset, two falses should not be enough to confirm Unavailable
            lidar.Observe(false);
            lidar.Observe(false);
            Assert.AreEqual(LidarAvailability.LidarState.Unknown, lidar.CurrentState);
            // Third false confirms.
            lidar.Observe(false);
            Assert.AreEqual(LidarAvailability.LidarState.Unavailable, lidar.CurrentState);
        }
    }
}
