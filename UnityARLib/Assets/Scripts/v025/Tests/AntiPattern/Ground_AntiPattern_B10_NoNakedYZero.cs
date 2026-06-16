// Phase 1A.10 — AntiPattern B10: GroundResolverV2 must refuse spawn on no-hit.
//
// Bug pattern this guards: returning Y=0 (or any fake "default" ground) when
// raycast misses. v0.2.4 had a subtle version of this where missing rays
// silently used the last known plane Y → cairns drifted into walls.

using NUnit.Framework;
using Unity.Mathematics;
using Cairn.AR.V025.Core;

namespace Cairn.AR.V025.Tests.AntiPattern
{
    public class Ground_AntiPattern_B10_NoNakedYZero
    {
        [Test]
        public void NoHit_DoesNotReturnYZero_DoesNotReturnAnyPosition()
        {
            var resolver = new GroundResolverV2(
                raycast: (uv) => GroundResolverV2.RaycastResult.Miss);
            var resolved = resolver.ResolveAtScreenCenter();

            Assert.AreEqual(GroundHitKind.NoHit, resolved.Kind);
            Assert.IsFalse(resolved.HasGround);
            // Sub#1A-2 found: must explicitly assert position is float3.zero on NoHit
            // so a future regression that returns (NoHit, position={1,2,3}) fails this test.
            Assert.AreEqual(float3.zero, resolved.Position);
            // Diagnostic must mention 裸坐标 or refuse so callers can grep
            Assert.That(resolved.Diagnostic, Does.Contain("refuse").Or.Contain("裸坐标"));
        }

        [Test]
        public void HitPlaneSurface_ReturnsExactPosition()
        {
            var expected = new float3(1.0f, 0.5f, 2.0f);
            var resolver = new GroundResolverV2(
                raycast: (uv) => new GroundResolverV2.RaycastResult(true, GroundHitKind.HitPlaneSurface, expected));
            var resolved = resolver.ResolveAtScreenCenter();

            Assert.AreEqual(GroundHitKind.HitPlaneSurface, resolved.Kind);
            Assert.IsTrue(resolved.HasGround);
            Assert.AreEqual(expected, resolved.Position);
        }

        [Test]
        public void HitFeaturePoint_AcceptedAsValidFallback()
        {
            var expected = new float3(0, 0.3f, 1.0f);
            var resolver = new GroundResolverV2(
                raycast: (uv) => new GroundResolverV2.RaycastResult(true, GroundHitKind.HitFeaturePoint, expected));
            var resolved = resolver.ResolveAtScreenCenter();

            Assert.AreEqual(GroundHitKind.HitFeaturePoint, resolved.Kind);
            Assert.IsTrue(resolved.HasGround);
        }
    }
}
