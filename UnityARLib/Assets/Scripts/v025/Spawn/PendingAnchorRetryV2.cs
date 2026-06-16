// Phase 2A.4 — PendingAnchorRetryV2 + AntiPattern B3.
//
// Bug pattern this guards: v0.2.4 had a "retry forever" loop that, when
// ARWorldMap was permanently broken, retried indefinitely instead of failing
// hard. v0.2.5: bounded retry with hard-fail at 1s; refuse-to-spawn via
// BlockerSentinel.
//
// Round-2 #2A-1-C03: emit per-attempt telemetry for Rule H visibility so
// operators can distinguish "fast convergence" from "slow flap".
//
// Contract:
//   AwaitAttachOrFail(timeoutMs, attemptFactory) — invoke `attemptFactory()`
//   repeatedly with exponential backoff up to `timeoutMs`. If still failing
//   at deadline, throw BlockerSentinelException (NOT catch Exception per
//   Rule C.2 — caller must specifically catch BlockerSentinelException).

using System;
using System.Threading;
using System.Threading.Tasks;

namespace Cairn.AR.V025.Spawn
{
    using Cairn.AR.V025.Core;

    public sealed class PendingAnchorRetryV2
    {
        private readonly BlockerSentinel _sentinel;
        private readonly PhaseStepTracker _tracker;
        private readonly Action<V025Event> _emit;
        public const int DefaultTimeoutMs = 1000;
        public const int InitialBackoffMs = 50;
        public const int MaxBackoffMs = 250;

        public PendingAnchorRetryV2(BlockerSentinel sentinel, PhaseStepTracker tracker, Action<V025Event> emit)
        {
            _sentinel = sentinel ?? throw new ArgumentNullException(nameof(sentinel));
            _tracker = tracker ?? throw new ArgumentNullException(nameof(tracker));
            _emit = emit ?? throw new ArgumentNullException(nameof(emit));
        }

        /// <summary>
        /// Run <paramref name="attempt"/> with exponential backoff up to
        /// <paramref name="timeoutMs"/>. attempt() returns true on success, false to retry.
        /// On total timeout: BlockerSentinel.RaiseRefuseSpawn — caller MUST catch
        /// BlockerSentinelException specifically, not Exception (Rule C.2).
        /// Emits one V025Event per attempt for Rule H visibility.
        /// </summary>
        public async Task AwaitAttachOrFailAsync(
            Func<Task<bool>> attempt,
            CancellationToken cancel,
            int timeoutMs = DefaultTimeoutMs)
        {
            if (attempt == null) throw new ArgumentNullException(nameof(attempt));
            var deadlineUtc = DateTime.UtcNow.AddMilliseconds(timeoutMs);
            var backoff = InitialBackoffMs;
            int attemptCount = 0;

            while (true)
            {
                if (cancel.IsCancellationRequested)
                {
                    _sentinel.RaiseRefuseSpawn("PendingAnchorRetryV2 cancelled");
                    return; // unreachable — RaiseRefuseSpawn throws (BlockerSentinel contract guarantees throw)
                }

                attemptCount++;
                _tracker.EnterPhase(V025Phases.Spawn, "retry-attempt");
                bool ok = await attempt().ConfigureAwait(false);
                _emit(_tracker.NextEvent(
                    ok ? V025Outcomes.Success : V025Outcomes.Failure,
                    $"attempt={attemptCount} backoff={backoff}ms"));
                if (ok) return;

                if (DateTime.UtcNow >= deadlineUtc)
                {
                    _sentinel.RaiseRefuseSpawn(
                        $"PendingAnchorRetryV2 exceeded {timeoutMs}ms timeout after {attemptCount} attempts — refuse to spawn rather than fall back to bare GPS coords");
                    return;
                }

                await Task.Delay(Math.Min(backoff, MaxBackoffMs), cancel).ConfigureAwait(false);
                backoff = Math.Min(backoff * 2, MaxBackoffMs);
            }
        }
    }
}
