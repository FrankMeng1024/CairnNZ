// Phase 1A.12 — BlockerSentinel unit tests.

using System.Collections.Generic;
using NUnit.Framework;
using Cairn.AR.V025.Core;

namespace Cairn.AR.V025.Tests.Unit
{
    public class BlockerSentinelTests
    {
        [Test]
        public void RaiseRefuseSpawn_EmitsBeforeThrowing()
        {
            var captured = new List<V025Event>();
            var tracker = new PhaseStepTracker("session-test-1");
            var sentinel = new BlockerSentinel(tracker, ev => captured.Add(ev));

            var thrown = Assert.Throws<BlockerSentinelException>(() =>
                sentinel.RaiseRefuseSpawn("no plane found"));

            Assert.That(thrown.Message, Does.Contain("no plane found"));
            Assert.AreEqual(1, captured.Count, "must emit exactly one event before throwing");
            Assert.AreEqual(V025Phases.Spawn, captured[0].Phase);
            Assert.AreEqual("refused", captured[0].Step);
            Assert.AreEqual(V025Outcomes.Failure, captured[0].Outcome);
            Assert.AreEqual("session-test-1", captured[0].SessionInstanceId);
            Assert.AreEqual(1, captured[0].Seq);
        }

        [Test]
        public void Throws_OnNullTracker()
        {
            Assert.Throws<System.ArgumentNullException>(() =>
                new BlockerSentinel(null, ev => { }));
        }

        [Test]
        public void Throws_OnNullEmitter()
        {
            var tracker = new PhaseStepTracker("session-test-1");
            Assert.Throws<System.ArgumentNullException>(() =>
                new BlockerSentinel(tracker, null));
        }

        [Test]
        public void EmitsCorrectPhaseStepAndCarriesNullDiagnosticAsEmpty()
        {
            var captured = new List<V025Event>();
            var tracker = new PhaseStepTracker("s2");
            var sentinel = new BlockerSentinel(tracker, ev => captured.Add(ev));

            Assert.Throws<BlockerSentinelException>(() => sentinel.RaiseRefuseSpawn(null));
            Assert.AreEqual(string.Empty, captured[0].Diagnostic);
        }
    }
}
