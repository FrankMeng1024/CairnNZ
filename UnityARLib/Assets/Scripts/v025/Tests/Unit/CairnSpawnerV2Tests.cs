// Phase 2A.3 — CairnSpawnerV2 unit tests.

using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using Unity.Mathematics;
using Cairn.AR.V025.Core;
using Cairn.AR.V025.Spawn;

namespace Cairn.AR.V025.Tests.Unit
{
    public class CairnSpawnerV2Tests
    {
        private sealed class StubPersistence : IAnchorPersistence
        {
            public PersistenceResult LoadResult { get; set; } = PersistenceResult.NoCache();
            public bool IsPlatformSupported => true;
            public Task<PersistenceResult> SaveAsync(string spaceId, CancellationToken c)
                => Task.FromResult(PersistenceResult.IoError("stub"));
            public Task<PersistenceResult> LoadAsync(string spaceId, CancellationToken c)
                => Task.FromResult(LoadResult);
        }

        private static AnchorAttachStrategy MakeStrategy(StubPersistence p, GroundResolverV2.RaycastResult raycastResult)
        {
            var v = new FloorPlaneValidatorV2();
            var g = new GroundResolverV2(uv => raycastResult);
            return new AnchorAttachStrategy(p, v, g);
        }

        [Test]
        public async Task TierS_Success_ReturnsOkResponse_WithGivenTargetXyz()
        {
            var p = new StubPersistence { LoadResult = PersistenceResult.Success() };
            var strategy = MakeStrategy(p, GroundResolverV2.RaycastResult.Miss);
            var tracker = new PhaseStepTracker("test-session");
            var emitted = new List<V025Event>();
            var spawner = new CairnSpawnerV2(strategy, tracker, ev => emitted.Add(ev));

            var req = new CairnSpawnerV2.SpawnRequest("space-1", "cairn-1",
                new float3(5, 0, 7), System.Array.Empty<PlaneCandidate>());
            var resp = await spawner.HandleAsync(req, CancellationToken.None);

            Assert.IsTrue(resp.Ok);
            Assert.AreEqual("cairn-1", resp.CairnId);
            Assert.AreEqual(AttachOutcomeKind.AttachedTierS, resp.Kind);
            Assert.AreEqual(new float3(5, 0, 7), resp.FinalXyz);
            Assert.That(emitted.Count, Is.GreaterThanOrEqualTo(2));
            Assert.AreEqual("test-session", emitted[0].SessionInstanceId);
        }

        [Test]
        public async Task AllTiersFail_ReturnsRefusedResponse_WithEmittedFailureTelemetry()
        {
            var p = new StubPersistence { LoadResult = PersistenceResult.NoCache() };
            var strategy = MakeStrategy(p, GroundResolverV2.RaycastResult.Miss);
            var tracker = new PhaseStepTracker("test-session");
            var emitted = new List<V025Event>();
            var spawner = new CairnSpawnerV2(strategy, tracker, ev => emitted.Add(ev));

            var req = new CairnSpawnerV2.SpawnRequest("space-1", "cairn-1",
                new float3(99, 99, 99), System.Array.Empty<PlaneCandidate>());
            var resp = await spawner.HandleAsync(req, CancellationToken.None);

            Assert.IsFalse(resp.Ok);
            Assert.AreEqual(AttachOutcomeKind.Refused, resp.Kind);
            Assert.AreEqual(float3.zero, resp.FinalXyz);
            // last emitted event must be a failure
            var last = emitted[emitted.Count - 1];
            Assert.AreEqual(V025Outcomes.Failure, last.Outcome);
        }

        [Test]
        public void NullSpaceId_Throws()
        {
            var p = new StubPersistence();
            var strategy = MakeStrategy(p, GroundResolverV2.RaycastResult.Miss);
            var tracker = new PhaseStepTracker("test-session");
            var spawner = new CairnSpawnerV2(strategy, tracker, _ => { });

            var req = new CairnSpawnerV2.SpawnRequest(null, "cairn-1",
                float3.zero, System.Array.Empty<PlaneCandidate>());
            Assert.ThrowsAsync<System.ArgumentNullException>(async () =>
                await spawner.HandleAsync(req, CancellationToken.None));
        }
    }
}
