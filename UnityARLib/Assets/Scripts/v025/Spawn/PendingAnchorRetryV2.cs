// Phase 2A.4 — PendingAnchorRetryV2 + AntiPattern B3.
//
// Bug pattern this guards: v0.2.4 had a "retry forever" loop that, when
// ARWorldMap was permanently broken, retried indefinitely instead of failing
// hard. v0.2.5: bounded retry with hard-fail at 1s; refuse-to-spawn via
// BlockerSentinel.
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
        public const int DefaultTimeoutMs = 1000;
        public const int InitialBackoffMs = 50;
        public const int MaxBackoffMs = 250;

        public PendingAnchorRetryV2(BlockerSentinel sentinel)
        {
            _sentinel = sentinel ?? throw new ArgumentNullException(nameof(sentinel));
        }

        /// <summary>
        /// Run <paramref name="attempt"/> with exponential backoff up to
        /// <paramref name="timeoutMs"/>. attempt() returns true on success, false to retry.
        /// On total timeout: BlockerSentinel.RaiseRefuseSpawn — caller MUST catch
        /// BlockerSentinelException specifically, not Exception (Rule C.2).
        /// </summary>
        public async Task AwaitAttachOrFailAsync(
            Func<Task<bool>> attempt,
            CancellationToken cancel,
            int timeoutMs = DefaultTimeoutMs)
        {
            if (attempt == null) throw new ArgumentNullException(nameof(attempt));
            var deadlineUtc = DateTime.UtcNow.AddMilliseconds(timeoutMs);
            var backoff = InitialBackoffMs;

            while (true)
            {
                if (cancel.IsCancellationRequested)
                {
                    _sentinel.RaiseRefuseSpawn("PendingAnchorRetryV2 cancelled");
                    return; // unreachable — RaiseRefuseSpawn throws
                }

                bool ok = await attempt().ConfigureAwait(false);
                if (ok) return;

                if (DateTime.UtcNow >= deadlineUtc)
                {
                    _sentinel.RaiseRefuseSpawn(
                        $"PendingAnchorRetryV2 exceeded {timeoutMs}ms timeout — refuse to spawn rather than naked-XYZ fallback");
                    return;
                }

                await Task.Delay(Math.Min(backoff, MaxBackoffMs), cancel).ConfigureAwait(false);
                backoff = Math.Min(backoff * 2, MaxBackoffMs);
            }
        }
    }
}
