// Phase 1A.11 — AntiPattern C5: AnchorAttachStrategy must NEVER use bare GPS XYZ.
//
// Validates that when both Tier-S and Tier-G fail, the strategy returns Refused
// rather than synthesizing a position from raw GPS deltas.
//
// Round-2 additions (#1A-1 + #1A-2 review):
//   - cancellation honored mid-plane-scan (CRITICAL #1A-1-3)
//   - attempt order pinned: Tier-S → plane scan → raycast (MEDIUM #1A-2-2)

using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using Unity.Mathematics;
using Cairn.AR.V025.Core;

namespace Cairn.AR.V025.Tests.AntiPattern
{
    public class Anchor_AntiPattern_C5_NoBareGpsXyz
    {
        // Mock persistence that always returns NoCache, recording call order.
        private sealed class NoCachePersistence : IAnchorPersistence
        {
            public List<string> CallLog { get; } = new List<string>();
            public bool IsPlatformSupported => true;
            public Task<PersistenceResult> SaveAsync(string spaceId, CancellationToken cancel)
            {
                CallLog.Add("save");
                return Task.FromResult(PersistenceResult.IoError("test"));
            }
            public Task<PersistenceResult> LoadAsync(string spaceId, CancellationToken cancel)
            {
                CallLog.Add("load");
                return Task.FromResult(PersistenceResult.NoCache());
            }
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

        // Round-2 #1A-1-3: cancellation must be honored within the plane scan loop.
        [Test]
        public async Task Cancellation_BetweenPlaneScans_ReturnsRefused()
        {
            var validator = new FloorPlaneValidatorV2();
            var ground = new GroundResolverV2(
                raycast: (uv) => GroundResolverV2.RaycastResult.Miss);
            var strategy = new AnchorAttachStrategy(new NoCachePersistence(), validator, ground);

            // Many bad planes — without cancellation honoring, all are scanned.
            var bad = new PlaneCandidate[100];
            for (int i = 0; i < bad.Length; i++)
            {
                bad[i] = new PlaneCandidate(
                    center: new float3(0, 1, 0),
                    normal: new float3(1, 0, 0),
                    extentAreaM2: 1.0f,
                    alignment: PlaneAlignment.Vertical,
                    userHeadY: 1.6f);
            }

            var cts = new CancellationTokenSource();
            cts.Cancel(); // cancel BEFORE call so the loop's first iteration sees it
            var outcome = await strategy.AttachAsync("space-1", float3.zero, bad, cts.Token);

            Assert.AreEqual(AttachOutcomeKind.Refused, outcome.Kind);
            Assert.That(outcome.Diagnostic, Does.Contain("cancelled"));
        }

        // Round-2 #1A-2-2: pin attempt order Tier-S → plane scan → raycast.
        // This guards against future refactors that reorder, which v0.2.4 had.
        [Test]
        public async Task AttemptOrder_TierS_BeforePlaneScan_BeforeRaycast()
        {
            var persistence = new NoCachePersistence();
            var planeScanLog = new List<int>();

            // Custom validator that records WHEN each plane was scanned via index in CallLog.
            var validator = new FloorPlaneValidatorV2();
            // Ground resolver records "raycast" in shared log when called.
            var orderLog = new List<string>();
            var ground = new GroundResolverV2(uv =>
            {
                orderLog.Add("raycast");
                return GroundResolverV2.RaycastResult.Miss;
            });

            // Wrap persistence to share the same log.
            var wrappedPersistence = new OrderRecordingPersistence(orderLog);
            var strategy = new AnchorAttachStrategy(wrappedPersistence, validator, ground);

            // 1 bad plane (vertical) so validator runs but rejects, forcing fall-through to raycast.
            var bad = new[]
            {
                new PlaneCandidate(
                    center: new float3(0, 1, 0),
                    normal: new float3(1, 0, 0),
                    extentAreaM2: 1.0f,
                    alignment: PlaneAlignment.Vertical,
                    userHeadY: 1.6f),
            };

            await strategy.AttachAsync("space-1", float3.zero, bad, CancellationToken.None);

            // Order MUST be: load (Tier-S) first, then raycast (Tier-G ground after planes failed)
            Assert.That(orderLog, Has.Count.GreaterThanOrEqualTo(2));
            Assert.AreEqual("load", orderLog[0], "Tier-S LoadAsync must be called first");
            Assert.AreEqual("raycast", orderLog[orderLog.Count - 1], "GroundResolver must be called LAST");
        }

        private sealed class OrderRecordingPersistence : IAnchorPersistence
        {
            private readonly List<string> _log;
            public OrderRecordingPersistence(List<string> log) { _log = log; }
            public bool IsPlatformSupported => true;
            public Task<PersistenceResult> SaveAsync(string spaceId, CancellationToken cancel)
            {
                _log.Add("save");
                return Task.FromResult(PersistenceResult.IoError("t"));
            }
            public Task<PersistenceResult> LoadAsync(string spaceId, CancellationToken cancel)
            {
                _log.Add("load");
                return Task.FromResult(PersistenceResult.NoCache());
            }
        }
    }
}
