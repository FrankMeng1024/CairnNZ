// Phase 1A.8 — LidarAvailability (iOS LiDAR sensor probe + sticky cache).
//
// Why sticky:
//   ARSession's LiDAR availability flag flickers during early session frames
//   (returns false for ~200ms even on devices that have LiDAR). v0.2.4 had
//   a bug where Spawn ran before flag stabilized → wrong shader path was
//   chosen. Fix: cache the FIRST positive result for the lifetime of the
//   process; only return false if ALL probes within ProbeWindow returned false.
//
// Anti-pattern test C8 (Phase 1A.8 + Tests/AntiPattern/Lidar_AntiPattern_C8_NoFlicker.cs):
//   Verify that once Probe() observes Available=true, subsequent observations
//   of false do NOT downgrade the cached value.

using System;

namespace Cairn.AR.V025.Core
{
    public sealed class LidarAvailability
    {
        public enum LidarState
        {
            Unknown,
            Available,
            Unavailable,
        }

        private LidarState _state = LidarState.Unknown;
        private int _consecutiveUnavailable;
        private const int UnavailableConfirmationCount = 3;

        public LidarState CurrentState => _state;

        /// <summary>
        /// Feed a single observation from ARSession or platform probe.
        /// Sticky semantics:
        ///   - First Available observation → state = Available, never downgraded.
        ///   - Unavailable observations: only confirm Unavailable after
        ///     UnavailableConfirmationCount consecutive false reports.
        /// </summary>
        public void Observe(bool available)
        {
            if (available)
            {
                _state = LidarState.Available;
                _consecutiveUnavailable = 0;
                return;
            }

            // already Available → sticky, ignore
            if (_state == LidarState.Available)
                return;

            _consecutiveUnavailable++;
            if (_consecutiveUnavailable >= UnavailableConfirmationCount)
                _state = LidarState.Unavailable;
        }

        /// <summary>True only if state has settled to Available. Unknown returns false.</summary>
        public bool IsAvailable => _state == LidarState.Available;

        /// <summary>
        /// Resets the cache. ONLY for tests; production code never resets — the cache
        /// is intentionally process-lifetime.
        /// </summary>
        public void ResetForTesting()
        {
            _state = LidarState.Unknown;
            _consecutiveUnavailable = 0;
        }
    }
}
