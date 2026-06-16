// Phase 4.3 + 4.6 — WorldMapLoadGateV2 unit tests + AntiPattern coverage.
//
// AntiPattern: Tier-S timeout MUST return RelocalizeTimeout (which then triggers
// AnchorAttachStrategy fallback to Tier-G via ADR-001), NOT silently fall back to
// "naked GPS XYZ". Tested at the AnchorAttachStrategy level via Phase 1A
// Anchor_AntiPattern_C5_NoBareGpsXyz; this file pins the gate's own behavior.

using NUnit.Framework;
using Cairn.AR.V025.Anchor;

namespace Cairn.AR.V025.Tests.Unit
{
    public class WorldMapLoadGateV2Tests
    {
        // Use a deterministic clock for repeatable tests.
        private long _now;
        private long Now() => _now;

        [SetUp]
        public void Init() { _now = 1000000; }

        [Test]
        public void Mapped_ImmediatelyReady()
        {
            var gate = new WorldMapLoadGateV2(timeoutMs: 6000, nowUnixMs: Now);
            Assert.AreEqual(LoadGateOutcome.Ready, gate.OnStatusUpdate(WorldMappingStatus.Mapped));
        }

        [Test]
        public void NotMapped_BeforeDeadline_InProgress()
        {
            var gate = new WorldMapLoadGateV2(timeoutMs: 6000, nowUnixMs: Now);
            _now += 1000;
            Assert.AreEqual(LoadGateOutcome.InProgress, gate.OnStatusUpdate(WorldMappingStatus.Limited));
            _now += 1000;
            Assert.AreEqual(LoadGateOutcome.InProgress, gate.OnStatusUpdate(WorldMappingStatus.Extending));
        }

        [Test]
        public void DeadlineExceeded_ReturnsTimeout()
        {
            var gate = new WorldMapLoadGateV2(timeoutMs: 6000, nowUnixMs: Now);
            _now += 6001;
            Assert.AreEqual(LoadGateOutcome.Timeout, gate.OnStatusUpdate(WorldMappingStatus.Limited));
        }

        [Test]
        public void MappedTakesPrecedenceOverDeadline()
        {
            // Even at deadline, if status reaches Mapped, we report Ready (caller
            // can use the just-relocalized session).
            var gate = new WorldMapLoadGateV2(timeoutMs: 6000, nowUnixMs: Now);
            _now += 6500;
            Assert.AreEqual(LoadGateOutcome.Ready, gate.OnStatusUpdate(WorldMappingStatus.Mapped));
        }

        [Test]
        public void NotAvailable_NeverFiresMapped()
        {
            var gate = new WorldMapLoadGateV2(timeoutMs: 1000, nowUnixMs: Now);
            _now += 500;
            Assert.AreEqual(LoadGateOutcome.InProgress, gate.OnStatusUpdate(WorldMappingStatus.NotAvailable));
            _now += 600;
            Assert.AreEqual(LoadGateOutcome.Timeout, gate.OnStatusUpdate(WorldMappingStatus.NotAvailable));
        }

        // Round-1 #4-1: terminal latch.
        [Test]
        public void OnceReady_StaysReady_EvenOnNonMappedSubsequentUpdates()
        {
            var gate = new WorldMapLoadGateV2(timeoutMs: 6000, nowUnixMs: Now);
            Assert.AreEqual(LoadGateOutcome.Ready, gate.OnStatusUpdate(WorldMappingStatus.Mapped));
            Assert.AreEqual(LoadGateOutcome.Ready, gate.OnStatusUpdate(WorldMappingStatus.Limited));
            Assert.AreEqual(LoadGateOutcome.Ready, gate.OnStatusUpdate(WorldMappingStatus.NotAvailable));
        }

        [Test]
        public void OnceTimeout_StaysTimeout_EvenIfMappedArrivesLate()
        {
            var gate = new WorldMapLoadGateV2(timeoutMs: 1000, nowUnixMs: Now);
            _now += 1500;
            Assert.AreEqual(LoadGateOutcome.Timeout, gate.OnStatusUpdate(WorldMappingStatus.Limited));
            Assert.AreEqual(LoadGateOutcome.Timeout, gate.OnStatusUpdate(WorldMappingStatus.Mapped));
        }
    }
}
