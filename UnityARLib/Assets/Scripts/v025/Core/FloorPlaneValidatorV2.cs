// Phase 1A.9 — FloorPlaneValidatorV2.
//
// Validates a candidate floor plane against geometric + AR-quality criteria
// before allowing AnchorAttachStrategy to spawn a cairn on it.
//
// Validation rules (from v0.2.4 lessons + plan §1A.9):
//   B-pattern guards:
//     B6 reject planes whose normal deviates > 15° from world up
//     B7 reject planes whose centerY > userY + 0.3m (avoid spawning on table tops)
//     B7' reject planes whose centerY < userY - 3.0m (avoid spawning in basements)
//   C-pattern guards:
//     C6 reject planes with extentArea < 0.25 m^2 (too small to stand on)
//     C7 reject planes whose alignment is "Vertical" or "NotAxisAligned"
//
// Rule P (Monitor/Validator/Observer must contain Mitigate*/Recover*/Resolve* method):
//   This class is named *Validator and therefore MUST expose at least one
//   Mitigate*/Recover*/Resolve* method. ResolveFallback() is the formal
//   contract: when validation fails, what action does the caller take?

using Unity.Mathematics;

namespace Cairn.AR.V025.Core
{
    public enum PlaneAlignment
    {
        Horizontal,
        Vertical,
        NotAxisAligned,
    }

    public readonly struct PlaneCandidate
    {
        public readonly float3 Center;
        public readonly float3 Normal;
        public readonly float ExtentAreaM2;
        public readonly PlaneAlignment Alignment;
        public readonly float UserHeadY;

        public PlaneCandidate(float3 center, float3 normal, float extentAreaM2, PlaneAlignment alignment, float userHeadY)
        {
            Center = center;
            Normal = normal;
            ExtentAreaM2 = extentAreaM2;
            Alignment = alignment;
            UserHeadY = userHeadY;
        }
    }

    public enum PlaneRejectReason
    {
        Accepted,
        B6_NormalNotUp,
        B7_TooHighAboveUser,
        B7p_TooFarBelowUser,
        C6_TooSmall,
        C7_NotHorizontal,
    }

    public readonly struct PlaneVerdict
    {
        public PlaneRejectReason Reason { get; }
        public string Diagnostic { get; }
        public bool Accepted => Reason == PlaneRejectReason.Accepted;

        public PlaneVerdict(PlaneRejectReason reason, string diagnostic)
        {
            Reason = reason;
            Diagnostic = diagnostic ?? string.Empty;
        }
    }

    public sealed class FloorPlaneValidatorV2
    {
        // Plan §1A.9 rule constants (immutable per v0.2.5).
        public const float MaxNormalDeviationDegrees = 15.0f;
        public const float MaxAboveUserMeters = 0.3f;
        public const float MaxBelowUserMeters = 3.0f;
        public const float MinExtentAreaM2 = 0.25f;

        public PlaneVerdict Validate(PlaneCandidate p)
        {
            // C7 alignment check
            if (p.Alignment != PlaneAlignment.Horizontal)
            {
                return new PlaneVerdict(PlaneRejectReason.C7_NotHorizontal,
                    $"alignment={p.Alignment} (expected Horizontal)");
            }

            // C6 area
            if (p.ExtentAreaM2 < MinExtentAreaM2)
            {
                return new PlaneVerdict(PlaneRejectReason.C6_TooSmall,
                    $"extent={p.ExtentAreaM2:F2}m² < {MinExtentAreaM2}m²");
            }

            // B6 normal vs world-up
            var up = new float3(0, 1, 0);
            var normalLength = math.length(p.Normal);
            if (normalLength < 1e-4f)
            {
                return new PlaneVerdict(PlaneRejectReason.B6_NormalNotUp,
                    "normal vector near zero — degenerate plane");
            }
            var normalized = p.Normal / normalLength;
            var dotUp = math.clamp(math.dot(normalized, up), -1.0f, 1.0f);
            var deviationDeg = math.degrees(math.acos(dotUp));
            if (deviationDeg > MaxNormalDeviationDegrees)
            {
                return new PlaneVerdict(PlaneRejectReason.B6_NormalNotUp,
                    $"normal off-axis by {deviationDeg:F1}° > {MaxNormalDeviationDegrees}°");
            }

            // B7 / B7' user-relative height
            var heightDelta = p.Center.y - p.UserHeadY;
            if (heightDelta > MaxAboveUserMeters)
            {
                return new PlaneVerdict(PlaneRejectReason.B7_TooHighAboveUser,
                    $"plane is {heightDelta:F2}m above userHead — likely table top");
            }
            if (heightDelta < -MaxBelowUserMeters)
            {
                return new PlaneVerdict(PlaneRejectReason.B7p_TooFarBelowUser,
                    $"plane is {-heightDelta:F2}m below userHead — likely floor of room below");
            }

            return new PlaneVerdict(PlaneRejectReason.Accepted, string.Empty);
        }

        /// <summary>
        /// Rule P mitigation contract. When Validate() returns Accepted=false, callers
        /// must invoke ResolveFallback() to get the documented next-step action.
        /// </summary>
        public static FallbackAction ResolveFallback(PlaneRejectReason reason)
        {
            switch (reason)
            {
                case PlaneRejectReason.Accepted:
                    return FallbackAction.None;
                case PlaneRejectReason.C6_TooSmall:
                case PlaneRejectReason.C7_NotHorizontal:
                    return FallbackAction.RaycastDeeperPlanes;
                case PlaneRejectReason.B6_NormalNotUp:
                case PlaneRejectReason.B7_TooHighAboveUser:
                case PlaneRejectReason.B7p_TooFarBelowUser:
                    return FallbackAction.GroundResolverV2;
                default:
                    return FallbackAction.RejectSpawn;
            }
        }
    }

    public enum FallbackAction
    {
        None,                    // plane was accepted
        RaycastDeeperPlanes,     // try other plane candidates from ARRaycastManager
        GroundResolverV2,        // engage GroundResolverV2 screen-space raycast
        RejectSpawn,             // BlockerSentinel: refuse to spawn (no裸坐标)
    }
}
