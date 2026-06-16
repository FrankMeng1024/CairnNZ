// Phase 2A.6 — ArSessionLifecycleV2 unit tests.

using NUnit.Framework;
using Cairn.AR.V025.Session;

namespace Cairn.AR.V025.Tests.Unit
{
    public class ArSessionLifecycleV2Tests
    {
        [Test]
        public void InitialState_Idle_NoTracker()
        {
            var s = new ArSessionLifecycleV2();
            Assert.AreEqual(ArSessionStateV2.Idle, s.State);
            Assert.IsNull(s.SessionInstanceId);
            Assert.IsNull(s.Tracker);
        }

        [Test]
        public void BringUp_AssignsIdAndTracker()
        {
            int seq = 0;
            var s = new ArSessionLifecycleV2(() => $"id-{++seq}");
            var id = s.BringUp();
            Assert.AreEqual("id-1", id);
            Assert.AreEqual(ArSessionStateV2.BringingUp, s.State);
            Assert.IsNotNull(s.Tracker);
            Assert.AreEqual("id-1", s.Tracker.SessionInstanceId);
        }

        [Test]
        public void BringUp_Idempotent_ReturnsSameId()
        {
            int seq = 0;
            var s = new ArSessionLifecycleV2(() => $"id-{++seq}");
            var id1 = s.BringUp();
            var id2 = s.BringUp();
            Assert.AreEqual(id1, id2);
        }

        [Test]
        public void EnterRecovery_PreservesSessionInstanceId()
        {
            var s = new ArSessionLifecycleV2();
            var id = s.BringUp();
            s.Activate();
            s.EnterRecovery("tracking lost");
            Assert.AreEqual(ArSessionStateV2.Recovering, s.State);
            Assert.AreEqual(id, s.SessionInstanceId);
            Assert.AreEqual(id, s.Tracker.SessionInstanceId);
        }

        [Test]
        public void Teardown_ClearsId_NextBringUpFresh()
        {
            int seq = 0;
            var s = new ArSessionLifecycleV2(() => $"id-{++seq}");
            var id1 = s.BringUp();
            s.Activate();
            s.Teardown();
            Assert.IsNull(s.SessionInstanceId);
            Assert.IsNull(s.Tracker);
            var id2 = s.BringUp();
            Assert.AreNotEqual(id1, id2);
        }

        [Test]
        public void DefaultIdFactory_Generates_arv2Prefix()
        {
            var s = new ArSessionLifecycleV2();
            var id = s.BringUp();
            Assert.That(id, Does.StartWith("arv2-"));
        }

        // Round-2 #2A-1-C02: Teardown-during-active-spawn must be safe.
        // Pattern: caller snapshots Tracker at spawn start (DI'd into CairnSpawnerV2),
        // so a later Teardown that nulls lifecycle.Tracker doesn't NRE the in-flight
        // spawn.
        [Test]
        public void Teardown_DuringActiveSpawn_DoesNotBreakSnapshottedTracker()
        {
            var s = new ArSessionLifecycleV2();
            s.BringUp();
            s.Activate();

            var trackerSnapshot = s.Tracker;
            Assert.IsNotNull(trackerSnapshot);

            s.Teardown();
            Assert.IsNull(s.Tracker);
            Assert.IsNull(s.SessionInstanceId);

            // The snapshotted reference is still usable — emits do not NRE.
            Assert.DoesNotThrow(() =>
            {
                var ev = trackerSnapshot.NextEvent("success", "post-teardown");
                Assert.IsNotNull(ev.SessionInstanceId);
            });
        }
    }
}
