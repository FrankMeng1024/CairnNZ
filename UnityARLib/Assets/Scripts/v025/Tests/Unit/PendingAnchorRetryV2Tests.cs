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
        private static (PendingAnchorRetryV2, List<V025Event>) Make()
        {
            var tracker = new PhaseStepTracker("test-session");
            var captured = new List<V025Event>();
            var sentinel = new BlockerSentinel(tracker, ev => captured.Add(ev));
            return (new PendingAnchorRetryV2(sentinel), captured);
        }

        [Test]
        public async Task ReturnsOnFirstAttemptSuccess_NoSentinelRaise()
        {
            var (retry, captured) = Make();
            var calls = 0;
            await retry.AwaitAttachOrFailAsync(
                attempt: () => { calls++; return Task.FromResult(true); },
                cancel: CancellationToken.None,
                timeoutMs: 1000);
            Assert.AreEqual(1, calls);
            Assert.AreEqual(0, captured.Count, "no sentinel events on first-try success");
        }

        [Test]
        public void Timeout_RaisesBlockerSentinelException()
        {
            var (retry, captured) = Make();
            var ex = Assert.ThrowsAsync<BlockerSentinelException>(async () =>
                await retry.AwaitAttachOrFailAsync(
                    attempt: () => Task.FromResult(false),
                    cancel: CancellationToken.None,
                    timeoutMs: 100));
            Assert.That(ex.Message, Does.Contain("100ms"));
            Assert.That(ex.Message, Does.Contain("refuse"));
            Assert.AreEqual(1, captured.Count, "sentinel emits one event before throwing");
        }

        [Test]
        public void Cancellation_RaisesBlockerSentinelException()
        {
            var (retry, _) = Make();
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
            var (retry, _) = Make();
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
            // allow 500ms slop for backoff overshoot, but must NOT exceed by 1s+
            Assert.Less(elapsedMs, 1500, "PendingAnchorRetryV2 exceeded timeout — B3 regression");
        }
    }
}
