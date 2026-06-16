// Phase 1A.11 — AntiPattern C5: AnchorAttachStrategy must NEVER use bare GPS XYZ.
//
// Validates that when both Tier-S and Tier-G fail, the strategy returns Refused
// rather than synthesizing a position from raw GPS deltas.

using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using Unity.Mathematics;
using Cairn.AR.V025.Core;

namespace Cairn.AR.V025.Tests.AntiPattern
{
    public class Anchor_AntiPattern_C5_NoBareGpsXyz
    {
        // Mock persistence that always returns NoCache.
        private sealed class NoCachePersistence : IAnchorPersistence
        {
            public bool IsPlatformSupported => true;
            public Task<PersistenceResult> SaveAsync(string spaceId, CancellationToken cancel)
                => Task.FromResult(PersistenceResult.IoError("test"));
            public Task<PersistenceResult> LoadAsync(string spaceId, CancellationToken cancel)
                => Task.FromResult(PersistenceResult.NoCache());
        }

        // Mock persistence that always returns Success.
        private sealed class SuccessPersistence : IAnchorPersistence
        {
            public bool IsPlatformSupported => true;
            public Task<PersistenceResult> SaveAsync(string spaceId, CancellationToken cancel)
                => Task.FromResult(PersistenceResult.Success());
            public Task<PersistenceResult> LoadAsync(string spaceId, CancellationToken cancel)
                => Task.FromResult(PersistenceResult.Success());
        }

        [Test]
        public async Task TierS_NoCache_AllPlanesRejected_RaycastMisses_Refused()
        {
            var validator = new FloorPlaneValidatorV2();
            var ground = new GroundResolverV2(
                raycast: (uv) => GroundResolverV2.RaycastResult.Miss);
            var strategy = new AnchorAttachStrategy(new NoCachePersistence(), validator, ground);

            // Provide a plane that fails validation (vertical wall)
            var bad = new[]
            {
                new PlaneCandidate(
                    center: new float3(0, 1, 0),
                    normal: new float3(1, 0, 0),
                    extentAreaM2: 1.0f,
                    alignment: PlaneAlignment.Vertical,
                    userHeadY: 1.6f),
            };

            var outcome = await strategy.AttachAsync("space-1", new float3(99, 99, 99), bad, CancellationToken.None);

            Assert.AreEqual(AttachOutcomeKind.Refused, outcome.Kind);
            // Position MUST be zero (refused), not anything resembling GPS XYZ.
            Assert.AreEqual(float3.zero, outcome.Position);
            Assert.That(outcome.Diagnostic, Does.Contain("all tiers failed"));
        }

        [Test]
        public async Task TierS_Success_UsesProvidedRelocalizedAttachPosition()
        {
            var validator = new FloorPlaneValidatorV2();
            var ground = new GroundResolverV2(
                raycast: (uv) => GroundResolverV2.RaycastResult.Miss);
            var strategy = new AnchorAttachStrategy(new SuccessPersistence(), validator, ground);

            var attachPos = new float3(10, 0, 5);
            var outcome = await strategy.AttachAsync("space-1", attachPos, System.Array.Empty<PlaneCandidate>(), CancellationToken.None);

            Assert.AreEqual(AttachOutcomeKind.AttachedTierS, outcome.Kind);
            Assert.AreEqual(attachPos, outcome.Position);
        }

        [Test]
        public async Task TierS_NoCache_PlaneAccepted_UsesPlaneCenter()
        {
            var validator = new FloorPlaneValidatorV2();
            var ground = new GroundResolverV2(
                raycast: (uv) => GroundResolverV2.RaycastResult.Miss);
            var strategy = new AnchorAttachStrategy(new NoCachePersistence(), validator, ground);

            var goodFloor = new PlaneCandidate(
                center: new float3(2, 0, 3),
                normal: new float3(0, 1, 0),
                extentAreaM2: 1.0f,
                alignment: PlaneAlignment.Horizontal,
                userHeadY: 1.6f);
            var planes = new[] { goodFloor };

            var outcome = await strategy.AttachAsync("space-1", float3.zero, planes, CancellationToken.None);

            Assert.AreEqual(AttachOutcomeKind.AttachedTierGPlane, outcome.Kind);
            Assert.AreEqual(goodFloor.Center, outcome.Position);
        }
    }
}
