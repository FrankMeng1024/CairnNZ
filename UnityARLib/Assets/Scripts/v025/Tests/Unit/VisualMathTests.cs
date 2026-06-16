// Phase 2B.5 — Billboard + DistanceFader + Ceremony sweep math unit tests.

using NUnit.Framework;
using Unity.Mathematics;
using Cairn.AR.V025.Visual;

namespace Cairn.AR.V025.Tests.Unit
{
    public class BillboardYawMathTests
    {
        [Test]
        public void ComputeYaw_CameraDueNorth_Yaw0()
        {
            var yaw = BillboardYawMath.ComputeYawDegrees(new float3(0, 0, 0), new float3(0, 0, 5));
            Assert.That(yaw, Is.EqualTo(0).Within(0.01f));
        }

        [Test]
        public void ComputeYaw_CameraDueEast_Yaw90()
        {
            var yaw = BillboardYawMath.ComputeYawDegrees(new float3(0, 0, 0), new float3(5, 0, 0));
            Assert.That(yaw, Is.EqualTo(90).Within(0.01f));
        }

        [Test]
        public void ComputeYaw_CameraDueSouth_Yaw180()
        {
            var yaw = BillboardYawMath.ComputeYawDegrees(new float3(0, 0, 0), new float3(0, 0, -5));
            // atan2(0, -5) = 180 or -180; we accept either with abs = 180
            Assert.That(math.abs(yaw), Is.EqualTo(180).Within(0.01f));
        }

        [Test]
        public void ComputeYaw_CameraDueWest_YawNeg90()
        {
            var yaw = BillboardYawMath.ComputeYawDegrees(new float3(0, 0, 0), new float3(-5, 0, 0));
            Assert.That(yaw, Is.EqualTo(-90).Within(0.01f));
        }

        [Test]
        public void DampYaw_NoTimeElapsed_NoChange()
        {
            var result = BillboardYawMath.DampYaw(45f, 90f, 12f, 0f);
            Assert.That(result, Is.EqualTo(45f).Within(0.001f));
        }

        [Test]
        public void DampYaw_LargeTime_ApproachesTarget()
        {
            var result = BillboardYawMath.DampYaw(45f, 90f, 12f, 5f);
            Assert.That(result, Is.EqualTo(90f).Within(0.5f));
        }

        [Test]
        public void DampYaw_TakesShortPath_AcrossWrapBoundary()
        {
            // 358° → 2° should go forward (+4°) not backward (-356°)
            var result = BillboardYawMath.DampYaw(358f, 2f, 100f, 1f);
            // After heavy damping, near the target (2 + 4*decay) ≈ between 358 and 4
            Assert.That(result, Is.GreaterThan(357.5f).Or.LessThan(5f));
        }
    }

    public class DistanceFaderMathTests
    {
        [Test]
        public void Inside_Near_ReturnsOne()
        {
            Assert.AreEqual(1.0f, DistanceFaderMath.ComputeAlpha(2.0f, 5.0f, 25.0f));
        }

        [Test]
        public void Beyond_Far_ReturnsZero()
        {
            Assert.AreEqual(0.0f, DistanceFaderMath.ComputeAlpha(30.0f, 5.0f, 25.0f));
        }

        [Test]
        public void AtNear_ReturnsOne()
        {
            Assert.AreEqual(1.0f, DistanceFaderMath.ComputeAlpha(5.0f, 5.0f, 25.0f));
        }

        [Test]
        public void AtFar_ReturnsZero()
        {
            Assert.AreEqual(0.0f, DistanceFaderMath.ComputeAlpha(25.0f, 5.0f, 25.0f));
        }

        [Test]
        public void Midpoint_ReturnsHalf()
        {
            // smoothstep midpoint at t=0.5: 0.5 (smoothstep: 1 - (0.5)^2 * (3 - 1) = 1 - 0.5 = 0.5)
            var alpha = DistanceFaderMath.ComputeAlpha(15.0f, 5.0f, 25.0f);
            Assert.That(alpha, Is.EqualTo(0.5f).Within(0.01f));
        }

        [Test]
        public void DegenerateInput_FarLessThanNear_FallsBackBinary()
        {
            Assert.AreEqual(1.0f, DistanceFaderMath.ComputeAlpha(3.0f, 5.0f, 4.0f));
            Assert.AreEqual(0.0f, DistanceFaderMath.ComputeAlpha(7.0f, 5.0f, 4.0f));
        }
    }

    public class CeremonySweepMathTests
    {
        [Test]
        public void SweepAngle_AtZero_IsZero()
        {
            Assert.That(CeremonySweepMath.SweepAngleRadians(0f, 1.0f), Is.EqualTo(0f).Within(0.001f));
        }

        [Test]
        public void SweepAngle_AtHalfPeriod_IsPi()
        {
            var ang = CeremonySweepMath.SweepAngleRadians(0.5f, 1.0f);
            Assert.That(ang, Is.EqualTo(UnityEngine.Mathf.PI).Within(0.001f));
        }

        [Test]
        public void SweepAngle_WrapsAtPeriodMultiple()
        {
            var ang = CeremonySweepMath.SweepAngleRadians(2.5f, 1.0f);
            Assert.That(ang, Is.EqualTo(UnityEngine.Mathf.PI).Within(0.001f));
        }

        [Test]
        public void SweepIntensity_AtSweepCenter_IsOne()
        {
            var i = CeremonySweepMath.SweepIntensityAtPoint(1.0f, 1.0f, 0.5f);
            Assert.That(i, Is.EqualTo(1.0f).Within(0.001f));
        }

        [Test]
        public void SweepIntensity_BeyondHalfWidth_IsZero()
        {
            Assert.AreEqual(0.0f, CeremonySweepMath.SweepIntensityAtPoint(0.0f, 2.0f, 0.5f));
        }
    }
}
