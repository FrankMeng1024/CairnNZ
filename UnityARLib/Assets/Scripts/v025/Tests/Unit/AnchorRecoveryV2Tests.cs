// Phase 2A.5 — AnchorRecoveryV2 unit tests + Rule P mitigation contract.

using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using Cairn.AR.V025.Core;
using Cairn.AR.V025.Anchor;

namespace Cairn.AR.V025.Tests.Unit
{
    public class AnchorRecoveryV2Tests
    {
        private static (AnchorRecoveryV2, List<V025Event>) Make()
        {
            var tracker = new PhaseStepTracker("test-session");
            var captured = new List<V025Event>();
            return (new AnchorRecoveryV2(tracker, ev => captured.Add(ev)), captured);
        }

        [Test]
        public async Task SuccessfulAttempt_ResetsCounter()
        {
            var (recovery, _) = Make();
            // fail twice
            await recovery.AttemptRecoveryAsync(() => Task.FromResult(false), CancellationToken.None);
            await recovery.AttemptRecoveryAsync(() => Task.FromResult(false), CancellationToken.None);
            Assert.AreEqual(2, recovery.ConsecutiveFailures);
            // succeed
            var outcome = await recovery.AttemptRecoveryAsync(() => Task.FromResult(true), CancellationToken.None);
            Assert.AreEqual(RecoveryOutcome.Recovered, outcome);
            Assert.AreEqual(0, recovery.ConsecutiveFailures);
        }

        [Test]
        public async Task ThreeFailures_ReturnsNeedsFullReset()
        {
            var (recovery, _) = Make();
            await recovery.AttemptRecoveryAsync(() => Task.FromResult(false), CancellationToken.None);
            await recovery.AttemptRecoveryAsync(() => Task.FromResult(false), CancellationToken.None);
            var outcome = await recovery.AttemptRecoveryAsync(() => Task.FromResult(false), CancellationToken.None);
            Assert.AreEqual(RecoveryOutcome.NeedsFullReset, outcome);
        }

        [Test]
        public void MitigateOrReset_BeforeFailureThreshold_ReturnsNoMitigation()
        {
            var (recovery, _) = Make();
            Assert.AreEqual(RecoveryAction.NoMitigationNeeded, recovery.MitigateOrReset());
        }

        [Test]
        public async Task MitigateOrReset_AtFailureThreshold_ReturnsRestartSession_AndResetsCounter()
        {
            var (recovery, _) = Make();
            await recovery.AttemptRecoveryAsync(() => Task.FromResult(false), CancellationToken.None);
            await recovery.AttemptRecoveryAsync(() => Task.FromResult(false), CancellationToken.None);
            await recovery.AttemptRecoveryAsync(() => Task.FromResult(false), CancellationToken.None);

            Assert.AreEqual(RecoveryAction.RestartSession, recovery.MitigateOrReset());
            // After mitigation, counter resets so next session starts fresh
            Assert.AreEqual(0, recovery.ConsecutiveFailures);
        }

        [Test]
        public async Task EmitsTelemetryOnEveryAttempt()
        {
            var (recovery, captured) = Make();
            await recovery.AttemptRecoveryAsync(() => Task.FromResult(true), CancellationToken.None);
            Assert.Greater(captured.Count, 0);
            Assert.AreEqual(V025Phases.Recovery, captured[0].Phase);
        }

        [Test]
        public async Task CancelledToken_ReturnsCancelled()
        {
            var (recovery, _) = Make();
            var cts = new CancellationTokenSource();
            cts.Cancel();
            var outcome = await recovery.AttemptRecoveryAsync(() => Task.FromResult(true), cts.Token);
            Assert.AreEqual(RecoveryOutcome.Cancelled, outcome);
        }
    }
}
