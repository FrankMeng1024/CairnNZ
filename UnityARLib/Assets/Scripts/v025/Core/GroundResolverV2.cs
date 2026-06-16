// Phase 1A.10 — GroundResolverV2.
//
// Screen-space raycast resolver for "永远落地" guarantee.
//
// When FloorPlaneValidatorV2 rejects a plane and ResolveFallback() routes here,
// GroundResolverV2 issues a ARRaycastManager raycast from the screen center
// straight down to the camera-relative ground.
//
// Returns ResolvedGroundPoint with one of three states:
//   - HitPlaneSurface  → cm-precision Y from plane intersection
//   - HitFeaturePoint  → meter-precision Y from feature-point cluster
//   - NoHit            → BlockerSentinel triggers (refuse to spawn)
//
// Anti-pattern test B10 (Tests/AntiPattern/Ground_AntiPattern_B10_NoNakedYZero.cs):
//   Verifies that NO code path ever returns Y=0 as a "default ground" — the
//   resolver MUST refuse-to-spawn on no-hit, never return a fake plane.

using System;
using Unity.Mathematics;

namespace Cairn.AR.V025.Core
{
    public enum GroundHitKind
    {
        NoHit,
        HitFeaturePoint,
        HitPlaneSurface,
    }

    public readonly struct ResolvedGroundPoint
    {
        public GroundHitKind Kind { get; }
        public float3 Position { get; }
        public string Diagnostic { get; }

        public ResolvedGroundPoint(GroundHitKind kind, float3 position, string diagnostic)
        {
            Kind = kind;
            Position = position;
            Diagnostic = diagnostic ?? string.Empty;
        }

        public bool HasGround => Kind != GroundHitKind.NoHit;
    }

    /// <summary>
    /// Pure-logic resolver. The actual ARRaycastManager call lives in the
    /// session adapter; this class consumes a delegate of the form
    ///   (Func&lt;float2, RaycastResult&gt;)
    /// so it can be unit-tested with a mock.
    /// </summary>
    public sealed class GroundResolverV2
    {
        public readonly struct RaycastResult
        {
            public readonly bool Hit;
            public readonly GroundHitKind Kind;
            public readonly float3 Position;

            public RaycastResult(bool hit, GroundHitKind kind, float3 position)
            {
                Hit = hit;
                Kind = kind;
                Position = position;
            }

            public static RaycastResult Miss => new RaycastResult(false, GroundHitKind.NoHit, float3.zero);
        }

        public delegate RaycastResult ScreenSpaceRaycastFn(float2 normalizedScreen);

        private readonly ScreenSpaceRaycastFn _raycast;

        public GroundResolverV2(ScreenSpaceRaycastFn raycast)
        {
            _raycast = raycast ?? throw new ArgumentNullException(nameof(raycast));
        }

        /// <summary>
        /// Try to resolve ground at the screen center. If plane raycast misses,
        /// fall to feature-point raycast (typically returned with Kind=HitFeaturePoint
        /// by the adapter). Never returns Y=0 as a "default" — refuses if no hit.
        /// </summary>
        public ResolvedGroundPoint ResolveAtScreenCenter()
        {
            var center = new float2(0.5f, 0.5f);
            var result = _raycast(center);
            if (!result.Hit)
            {
                return new ResolvedGroundPoint(GroundHitKind.NoHit, float3.zero,
                    "screen-center raycast missed all surfaces — refuse spawn (no裸坐标)");
            }
            // result.Kind is set by the adapter (PlaneSurface or FeaturePoint).
            return new ResolvedGroundPoint(result.Kind, result.Position, string.Empty);
        }
    }
}
