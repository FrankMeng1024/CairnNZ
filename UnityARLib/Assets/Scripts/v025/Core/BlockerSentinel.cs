// Phase 1A.12 — BlockerSentinel.
//
// Last-line guard: when AnchorAttachStrategy.Refused fires, BlockerSentinel
// MUST throw + emit telemetry + halt the spawn flow. No silent swallowing,
// and no synthetic ground from raw GPS.
//
// Rule L: BlockerSentinel.Raise* throws AND emits a v22-SPAWN/refused event.
//
// Class is named *Sentinel (not Monitor/Validator/Observer) so Rule P does
// not apply directly; however, in spirit it MUST expose a documented mitigation
// path — which is "throw to caller; caller's UI shows 'plant failed, move to
// open ground' message".

using System;

namespace Cairn.AR.V025.Core
{
    public class BlockerSentinelException : Exception
    {
        public string PhaseStep { get; }
        public BlockerSentinelException(string phaseStep, string message) : base(message)
        {
            PhaseStep = phaseStep ?? string.Empty;
        }
    }

    public sealed class BlockerSentinel
    {
        private readonly PhaseStepTracker _tracker;
        private readonly Action<V025Event> _emit;

        public BlockerSentinel(PhaseStepTracker tracker, Action<V025Event> emit)
        {
            _tracker = tracker ?? throw new ArgumentNullException(nameof(tracker));
            _emit = emit ?? throw new ArgumentNullException(nameof(emit));
        }

        /// <summary>
        /// Raise "refuse spawn" — emit telemetry then throw. Caller MUST NOT catch
        /// + ignore; only catch + show UI ("plant failed, move to open ground").
        /// </summary>
        public void RaiseRefuseSpawn(string diagnostic)
        {
            var ev = _tracker.AdHocEvent(V025Phases.Spawn, "refused", V025Outcomes.Failure, diagnostic ?? string.Empty);
            _emit(ev);
            throw new BlockerSentinelException(
                phaseStep: $"{ev.Phase}/{ev.Step}",
                message: $"BlockerSentinel: refuse spawn — {diagnostic}");
        }
    }
}
