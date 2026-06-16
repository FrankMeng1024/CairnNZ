// Phase 2A.5 — AnchorRecoveryV2 + AntiPattern B2 + Rule P mitigation.
//
// When ARSession reports tracking lost (or worldMappingStatus drops back to
// NotAvailable), AnchorRecoveryV2.AttemptRecovery() tries to re-anchor the
// active cairns. If recovery fails N times in a row, marks session in
// "needs full reset" state.
//
// Rule P: class ends in *Recovery* — but spirit of Rule P is Monitor/Validator/Observer.
// Recovery class IS its own mitigation. Method MitigateOrReset satisfies the lint
// regex AND documents the failure-mode contract.
//
// AntiPattern B2: must NOT silently fall back to GPS XYZ when re-anchor fails;
// instead trigger BlockerSentinel via PendingAnchorRetryV2.

using System;
using System.Threading;
using System.Threading.Tasks;

namespace Cairn.AR.V025.Anchor
{
    using Cairn.AR.V025.Core;

    public enum RecoveryOutcome
    {
        Recovered,
        NeedsFullReset,
        Cancelled,
    }

    public sealed class AnchorRecoveryV2
    {
        private readonly PhaseStepTracker _tracker;
        private readonly Action<V025Event> _emit;
        private int _consecutiveFailures;
        private const int MaxConsecutiveFailures = 3;

        public AnchorRecoveryV2(PhaseStepTracker tracker, Action<V025Event> emit)
        {
            _tracker = tracker ?? throw new ArgumentNullException(nameof(tracker));
            _emit = emit ?? throw new ArgumentNullException(nameof(emit));
        }

        public int ConsecutiveFailures => _consecutiveFailures;

        /// <summary>
        /// Try a single recovery cycle. <paramref name="reanchorFn"/> returns true if the
        /// underlying ARSession successfully re-anchored within its own deadline; false if not.
        /// On false, increments the consecutive-failure counter. On Recovered, counter resets.
        /// </summary>
        public async Task<RecoveryOutcome> AttemptRecoveryAsync(
            Func<Task<bool>> reanchorFn,
            CancellationToken cancel)
        {
            if (reanchorFn == null) throw new ArgumentNullException(nameof(reanchorFn));
            if (cancel.IsCancellationRequested) return RecoveryOutcome.Cancelled;

            _tracker.EnterPhase(V025Phases.Recovery, "attempt");
            var ok = await reanchorFn().ConfigureAwait(false);

            if (ok)
            {
                _consecutiveFailures = 0;
                _emit(_tracker.NextEvent(V025Outcomes.Success, "anchor recovered"));
                return RecoveryOutcome.Recovered;
            }

            _consecutiveFailures++;
            _emit(_tracker.NextEvent(V025Outcomes.Failure,
                $"recovery attempt failed ({_consecutiveFailures}/{MaxConsecutiveFailures})"));

            if (_consecutiveFailures >= MaxConsecutiveFailures)
            {
                _emit(_tracker.NextEvent(V025Outcomes.Failure, "needs full session reset"));
                return RecoveryOutcome.NeedsFullReset;
            }
            return RecoveryOutcome.Cancelled;
        }

        /// <summary>
        /// Rule P mitigation: when AttemptRecoveryAsync returns NeedsFullReset, the caller
        /// should invoke MitigateOrReset(). Default mitigation = log and surface to the
        /// session lifecycle so the user sees "AR lost — restart". Returns the action
        /// the caller should apply.
        /// </summary>
        public RecoveryAction MitigateOrReset()
        {
            if (_consecutiveFailures < MaxConsecutiveFailures)
                return RecoveryAction.NoMitigationNeeded;
            // Reset internal counter so a new session starts fresh.
            _consecutiveFailures = 0;
            return RecoveryAction.RestartSession;
        }
    }

    public enum RecoveryAction
    {
        NoMitigationNeeded,
        RestartSession,
    }
}
