// Phase 1A.9 — FloorPlaneValidatorV2 8-边界 unit tests + AntiPattern C6/C7.

using NUnit.Framework;
using Unity.Mathematics;
using Cairn.AR.V025.Core;

namespace Cairn.AR.V025.Tests.Unit
{
    public class FloorPlaneValidatorV2Tests
    {
        private FloorPlaneValidatorV2 _v;

        [SetUp]
        public void Init()
        {
            _v = new FloorPlaneValidatorV2();
        }

        private static PlaneCandidate Floor(float y, float area = 1.0f, float userHeadY = 1.6f)
            => new PlaneCandidate(
                center: new float3(0, y, 0),
                normal: new float3(0, 1, 0),
                extentAreaM2: area,
                alignment: PlaneAlignment.Horizontal,
                userHeadY: userHeadY);

        // 1. Happy path: floor at user feet
        [Test]
        public void Validate_FloorAtUserFeet_Accepted()
        {
            var verdict = _v.Validate(Floor(y: 0.0f));
            Assert.AreEqual(PlaneRejectReason.Accepted, verdict.Reason);
        }

        // 2. B6: tilted normal
        [Test]
        public void Validate_TiltedNormal20Deg_Rejected_B6()
        {
            var p = new PlaneCandidate(
                center: new float3(0, 0, 0),
                normal: math.normalize(new float3(0.34f, 1f, 0)), // ~20°
                extentAreaM2: 1.0f,
                alignment: PlaneAlignment.Horizontal,
                userHeadY: 1.6f);
            var verdict = _v.Validate(p);
            Assert.AreEqual(PlaneRejectReason.B6_NormalNotUp, verdict.Reason);
        }

        // 3. B7: table-top above user
        [Test]
        public void Validate_PlaneAboveUserHead_Rejected_B7()
        {
            // userHeadY=1.6, plane at 2.0 → 0.4m above head → above 0.3 threshold
            var verdict = _v.Validate(Floor(y: 2.0f, userHeadY: 1.6f));
            Assert.AreEqual(PlaneRejectReason.B7_TooHighAboveUser, verdict.Reason);
        }

        // 4. B7': basement floor far below user
        [Test]
        public void Validate_PlaneFarBelowUser_Rejected_B7Prime()
        {
            // userHeadY=1.6, plane at -2.0 → 3.6m below head → exceeds 3.0
            var verdict = _v.Validate(Floor(y: -2.0f, userHeadY: 1.6f));
            Assert.AreEqual(PlaneRejectReason.B7p_TooFarBelowUser, verdict.Reason);
        }

        // 5. C6: tiny plane
        [Test]
        public void Validate_TinyExtent_Rejected_C6()
        {
            var verdict = _v.Validate(Floor(y: 0.0f, area: 0.1f));
            Assert.AreEqual(PlaneRejectReason.C6_TooSmall, verdict.Reason);
        }

        // 6. C7: vertical wall plane
        [Test]
        public void Validate_VerticalWall_Rejected_C7()
        {
            var p = new PlaneCandidate(
                center: new float3(0, 1.0f, 0),
                normal: new float3(1, 0, 0),
                extentAreaM2: 1.0f,
                alignment: PlaneAlignment.Vertical,
                userHeadY: 1.6f);
            var verdict = _v.Validate(p);
            Assert.AreEqual(PlaneRejectReason.C7_NotHorizontal, verdict.Reason);
        }

        // 7. boundary: exact threshold area
        [Test]
        public void Validate_ExactlyMinArea_Accepted()
        {
            var verdict = _v.Validate(Floor(y: 0.0f, area: FloorPlaneValidatorV2.MinExtentAreaM2));
            Assert.AreEqual(PlaneRejectReason.Accepted, verdict.Reason);
        }

        // 8. degenerate normal
        [Test]
        public void Validate_ZeroNormal_Rejected_B6()
        {
            var p = new PlaneCandidate(
                center: new float3(0, 0, 0),
                normal: new float3(0, 0, 0),
                extentAreaM2: 1.0f,
                alignment: PlaneAlignment.Horizontal,
                userHeadY: 1.6f);
            var verdict = _v.Validate(p);
            Assert.AreEqual(PlaneRejectReason.B6_NormalNotUp, verdict.Reason);
        }

        [Test]
        public void ResolveFallback_C6_C7_GoToRaycastDeeperPlanes()
        {
            Assert.AreEqual(FallbackAction.RaycastDeeperPlanes, FloorPlaneValidatorV2.ResolveFallback(PlaneRejectReason.C6_TooSmall));
            Assert.AreEqual(FallbackAction.RaycastDeeperPlanes, FloorPlaneValidatorV2.ResolveFallback(PlaneRejectReason.C7_NotHorizontal));
        }

        [Test]
        public void ResolveFallback_B_GoToGroundResolverV2()
        {
            Assert.AreEqual(FallbackAction.GroundResolverV2, FloorPlaneValidatorV2.ResolveFallback(PlaneRejectReason.B6_NormalNotUp));
            Assert.AreEqual(FallbackAction.GroundResolverV2, FloorPlaneValidatorV2.ResolveFallback(PlaneRejectReason.B7_TooHighAboveUser));
            Assert.AreEqual(FallbackAction.GroundResolverV2, FloorPlaneValidatorV2.ResolveFallback(PlaneRejectReason.B7p_TooFarBelowUser));
        }

        [Test]
        public void ResolveFallback_Accepted_None()
        {
            Assert.AreEqual(FallbackAction.None, FloorPlaneValidatorV2.ResolveFallback(PlaneRejectReason.Accepted));
        }

        // Round-2 #1A-4-1: float-precision-safe boundary at MaxAboveUserMeters.
        // Naive `userHeadY=1.6f, y=1.6f+0.3f` fails because float32 (1.6f+0.3f-1.6f) =
        // 0.30000007 which strictly > MaxAboveUserMeters=0.30000001. Construct boundary
        // exactly: userHeadY=0f, y=MaxAboveUserMeters → heightDelta=MaxAboveUserMeters
        // exactly (no fp residue). This proves `>` strict-greater-than admits ==.
        [Test]
        public void Validate_PlaneAtExactlyMaxAboveUser_Accepted()
        {
            var p = Floor(y: FloorPlaneValidatorV2.MaxAboveUserMeters, userHeadY: 0f);
            var verdict = _v.Validate(p);
            Assert.AreEqual(PlaneRejectReason.Accepted, verdict.Reason);
        }

        // Boundary just above MaxAboveUserMeters → must reject. Pins the strict-`>`
        // contract from the OTHER side, so a future change to `>=` is detected.
        [Test]
        public void Validate_PlaneJustAboveMaxAboveUser_Rejected_B7()
        {
            const float epsilon = 0.001f;
            var p = Floor(y: FloorPlaneValidatorV2.MaxAboveUserMeters + epsilon, userHeadY: 0f);
            var verdict = _v.Validate(p);
            Assert.AreEqual(PlaneRejectReason.B7_TooHighAboveUser, verdict.Reason);
        }

        // Round-2 #1A-1-7: boundary at exactly -MaxBelowUserMeters.
        // float32: 1.6 - 3.0 = -1.4 exactly (no residue), so this construction is
        // already fp-safe. Kept original form for documentation.
        [Test]
        public void Validate_PlaneAtExactlyMaxBelowUser_Accepted()
        {
            var p = Floor(y: -FloorPlaneValidatorV2.MaxBelowUserMeters, userHeadY: 0f);
            var verdict = _v.Validate(p);
            Assert.AreEqual(PlaneRejectReason.Accepted, verdict.Reason);
        }

        // Round-2 #1A-1-7: default branch in ResolveFallback for unknown reason.
        [Test]
        public void ResolveFallback_UnknownReason_DefaultsToRejectSpawn()
        {
            // Cast an int outside the enum range to exercise default branch.
            var unknown = (PlaneRejectReason)999;
            Assert.AreEqual(FallbackAction.RejectSpawn, FloorPlaneValidatorV2.ResolveFallback(unknown));
        }
    }
}
