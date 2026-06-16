// Phase 2A.4 — PendingAnchorRetryV2 unit tests + AntiPattern B3.

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using Cairn.AR.V025.Core;
using Cairn.AR.V025.Spawn;

namespace Cairn.AR.V025.Tests.Unit
{
    public class PendingAnchorRetryV2Tests
    {
        private static (PendingAnchorRetryV2, List<V025Event>, PhaseStepTracker) Make()
        {
            var tracker = new PhaseStepTracker("test-session");
            var captured = new List<V025Event>();
            var sentinel = new BlockerSentinel(tracker, ev => captured.Add(ev));
            return (new PendingAnchorRetryV2(sentinel, tracker, ev => captured.Add(ev)), captured, tracker);
        }

        [Test]
        public async Task ReturnsOnFirstAttemptSuccess_NoSentinelRaise()
        {
            var (retry, captured, _) = Make();
            var calls = 0;
            await retry.AwaitAttachOrFailAsync(
                attempt: () => { calls++; return Task.FromResult(true); },
                cancel: CancellationToken.None,
                timeoutMs: 1000);
            Assert.AreEqual(1, calls);
            // 1 success telemetry event (per-attempt), no sentinel raise event
            Assert.AreEqual(1, captured.Count, "exactly one per-attempt telemetry event for first-try success");
            Assert.AreEqual(V025Outcomes.Success, captured[0].Outcome);
        }

        [Test]
        public async Task SuccessAfterTwoRetries_EmitsThreePerAttemptEvents()
        {
            var (retry, captured, _) = Make();
            var calls = 0;
            await retry.AwaitAttachOrFailAsync(
                attempt: () =>
                {
                    calls++;
                    return Task.FromResult(calls >= 3); // succeed on 3rd attempt
                },
                cancel: CancellationToken.None,
                timeoutMs: 1000);
            Assert.AreEqual(3, calls);
            // 3 per-attempt events (2 failure + 1 success); no sentinel raise
            Assert.AreEqual(3, captured.Count);
            Assert.AreEqual(V025Outcomes.Failure, captured[0].Outcome);
            Assert.AreEqual(V025Outcomes.Failure, captured[1].Outcome);
            Assert.AreEqual(V025Outcomes.Success, captured[2].Outcome);
        }

        [Test]
        public void Timeout_RaisesBlockerSentinelException()
        {
            var (retry, captured, _) = Make();
            var ex = Assert.ThrowsAsync<BlockerSentinelException>(async () =>
                await retry.AwaitAttachOrFailAsync(
                    attempt: () => Task.FromResult(false),
                    cancel: CancellationToken.None,
                    timeoutMs: 100));
            Assert.That(ex.Message, Does.Contain("100ms"));
            Assert.That(ex.Message, Does.Contain("refuse"));
            // At least one per-attempt failure event + one sentinel raise event
            Assert.GreaterOrEqual(captured.Count, 2);
        }

        [Test]
        public void Cancellation_RaisesBlockerSentinelException()
        {
            var (retry, _, _) = Make();
            var cts = new CancellationTokenSource();
            cts.Cancel();
            Assert.ThrowsAsync<BlockerSentinelException>(async () =>
                await retry.AwaitAttachOrFailAsync(
                    attempt: () => Task.FromResult(false),
                    cancel: cts.Token,
                    timeoutMs: 1000));
        }

        // AntiPattern B3: must NOT silently retry forever — bounded timeout
        [Test]
        public void RetryDoesNotExceedTimeout_WallClock()
        {
            var (retry, _, _) = Make();
            var start = DateTime.UtcNow;
            try
            {
                retry.AwaitAttachOrFailAsync(
                    attempt: () => Task.FromResult(false),
                    cancel: CancellationToken.None,
                    timeoutMs: 200).GetAwaiter().GetResult();
            }
            catch (BlockerSentinelException) { /* expected */ }
            var elapsedMs = (DateTime.UtcNow - start).TotalMilliseconds;
            Assert.Less(elapsedMs, 1500, "PendingAnchorRetryV2 exceeded timeout — B3 regression");
        }
    }
}
