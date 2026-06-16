// Phase 1A.11 — AnchorAttachStrategy.
//
// Single decision authority for "where + how to attach a cairn anchor".
// Composes:
//   1. Try Tier-S (ARWorldMap relocalize) via IAnchorPersistence.LoadAsync
//      - On Success: attach at relocalized origin
//      - On NoCache / Timeout / NotSupported / IoError: fall to Tier-G
//   2. Tier-G: FloorPlaneValidatorV2 over candidate planes; first accepted plane wins
//   3. If no plane accepted: GroundResolverV2 screen-center raycast
//   4. If GroundResolverV2 NoHit: BlockerSentinel.RaiseRefuseSpawn() — no裸坐标
//
// Anti-pattern test C5 (Tests/AntiPattern/Anchor_AntiPattern_C5_NoBareGpsXyz.cs):
//   Verifies that NO path ever uses raw GPS lat/lng → world XYZ without going
//   through one of {plane raycast, feature-point raycast, ARWorldMap}. v0.2.4
//   bug: when ARKit was slow to provide planes, code would compute XYZ purely
//   from GPS deltas — cairn appeared underground or on roofs.
//
// 见 ADR-001(Tier-S 失败时 fallback 到 Tier-G GPS 路径)

using System;
using System.Threading;
using System.Threading.Tasks;
using Unity.Mathematics;

namespace Cairn.AR.V025.Core
{
    public enum AttachOutcomeKind
    {
        AttachedTierS,         // ARWorldMap relocalized + cm precision anchor
        AttachedTierGPlane,    // FloorPlaneValidatorV2 accepted a plane
        AttachedTierGRaycast,  // GroundResolverV2 hit plane via raycast
        AttachedTierGFeature,  // GroundResolverV2 hit feature point
        Refused,               // BlockerSentinel: no valid ground; never naked GPS XYZ
    }

    public readonly struct AnchorAttachOutcome
    {
        public AttachOutcomeKind Kind { get; }
        public float3 Position { get; }
        public string Diagnostic { get; }

        public AnchorAttachOutcome(AttachOutcomeKind kind, float3 position, string diagnostic)
        {
            Kind = kind;
            Position = position;
            Diagnostic = diagnostic ?? string.Empty;
        }
    }

    public sealed class AnchorAttachStrategy
    {
        private readonly IAnchorPersistence _persistence;
        private readonly FloorPlaneValidatorV2 _validator;
        private readonly GroundResolverV2 _ground;

        public AnchorAttachStrategy(
            IAnchorPersistence persistence,
            FloorPlaneValidatorV2 validator,
            GroundResolverV2 ground)
        {
            _persistence = persistence ?? throw new ArgumentNullException(nameof(persistence));
            _validator = validator ?? throw new ArgumentNullException(nameof(validator));
            _ground = ground ?? throw new ArgumentNullException(nameof(ground));
        }

        /// <summary>
        /// Tries Tier-S then Tier-G. Returns Refused on every "no valid ground"
        /// path — caller MUST honor Refused (do not synthesize XYZ from GPS).
        /// </summary>
        public async Task<AnchorAttachOutcome> AttachAsync(
            string spaceId,
            float3 tierSAttachIfRelocalized,
            PlaneCandidate[] candidatePlanes,
            CancellationToken cancel)
        {
            if (spaceId == null) throw new ArgumentNullException(nameof(spaceId));
            if (candidatePlanes == null) throw new ArgumentNullException(nameof(candidatePlanes));

            // Tier-S
            var loadResult = await _persistence.LoadAsync(spaceId, cancel).ConfigureAwait(false);
            if (loadResult.IsSuccess)
            {
                return new AnchorAttachOutcome(AttachOutcomeKind.AttachedTierS,
                    tierSAttachIfRelocalized,
                    $"Tier-S relocalized OK; spaceId={spaceId}");
            }

            if (cancel.IsCancellationRequested)
            {
                return new AnchorAttachOutcome(AttachOutcomeKind.Refused, float3.zero, "cancelled");
            }

            // Tier-G plane scan
            for (int i = 0; i < candidatePlanes.Length; i++)
            {
                var v = _validator.Validate(candidatePlanes[i]);
                if (v.Accepted)
                {
                    return new AnchorAttachOutcome(AttachOutcomeKind.AttachedTierGPlane,
                        candidatePlanes[i].Center,
                        $"Tier-G plane {i} accepted; tier-S diagnostic={loadResult.Diagnostic}");
                }
            }

            // Tier-G raycast
            var resolved = _ground.ResolveAtScreenCenter();
            if (resolved.Kind == GroundHitKind.HitPlaneSurface)
            {
                return new AnchorAttachOutcome(AttachOutcomeKind.AttachedTierGRaycast,
                    resolved.Position,
                    "Tier-G raycast hit plane surface");
            }
            if (resolved.Kind == GroundHitKind.HitFeaturePoint)
            {
                return new AnchorAttachOutcome(AttachOutcomeKind.AttachedTierGFeature,
                    resolved.Position,
                    "Tier-G raycast hit feature point (meter precision)");
            }

            // 见 ADR-001(Tier-S 失败时 fallback 到 Tier-G GPS 路径) — Tier-G 也没找到地面 → 拒绝 spawn,不允许裸 GPS XYZ
            return new AnchorAttachOutcome(AttachOutcomeKind.Refused, float3.zero,
                $"all tiers failed; tier-S={loadResult.Diagnostic}; tier-G ground={resolved.Diagnostic}");
        }
    }
}
