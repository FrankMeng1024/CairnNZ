// Phase 4.3 — WorldMapLoadGateV2.
//
// After ArkitWorldMapPersistence.SetWorldMap, ARSession needs time to process
// + relocalize. WorldMapLoadGateV2 polls worldMappingStatus and reports Ready
// when Mapped is reached, or Timeout after deadline.
//
// Pure logic: state machine consumes status updates from ARSession (Phase 4 wiring
// adapter feeds ARSession.GetWorldMappingStatus) and reports Ready/Timeout.
// Editor-testable.

using System;

namespace Cairn.AR.V025.Anchor
{
    public enum WorldMappingStatus
    {
        NotAvailable,
        Limited,
        Extending,
        Mapped,
    }

    public enum LoadGateOutcome
    {
        InProgress,
        Ready,
        Timeout,
    }

    public sealed class WorldMapLoadGateV2
    {
        public int TimeoutMs { get; }
        private readonly long _deadlineUnixMs;
        private readonly Func<long> _now;
        // Round-1 #4-1-load_gate_state_machine: terminal-state latch.
        // Once Ready or Timeout returned, subsequent calls keep returning that.
        private LoadGateOutcome _terminal = LoadGateOutcome.InProgress;

        public WorldMapLoadGateV2(int timeoutMs, Func<long> nowUnixMs = null)
        {
            TimeoutMs = timeoutMs;
            _now = nowUnixMs ?? DefaultNow;
            _deadlineUnixMs = _now() + timeoutMs;
        }

        private static long DefaultNow()
        {
            return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }

        /// <summary>
        /// Feed a status update; returns the outcome at this moment.
        /// Once Ready or Timeout is returned the gate latches — subsequent calls
        /// keep returning the same terminal state.
        /// </summary>
        public LoadGateOutcome OnStatusUpdate(WorldMappingStatus status)
        {
            if (_terminal != LoadGateOutcome.InProgress) return _terminal;
            if (status == WorldMappingStatus.Mapped) { _terminal = LoadGateOutcome.Ready; return _terminal; }
            if (_now() >= _deadlineUnixMs) { _terminal = LoadGateOutcome.Timeout; return _terminal; }
            return LoadGateOutcome.InProgress;
        }
    }
}
