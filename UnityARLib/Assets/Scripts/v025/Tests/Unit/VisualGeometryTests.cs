// Phase 2B (round-2 fix #2B-1-C3) — Mesh geometry unit tests.
//
// Pure-geometry public statics (CairnBaseGeometry / QuadGeometry / CeremonyRingGeometry)
// were uncovered by Phase 2B's first VisualMathTests pass. Add coverage:
// vertex / triangle counts, bounds non-zero, degenerate-input safety.

using NUnit.Framework;
using UnityEngine;
using Cairn.AR.V025.Visual;

namespace Cairn.AR.V025.Tests.Unit
{
    public class VisualGeometryTests
    {
        // ─── QuadGeometry ───
        [Test]
        public void Quad_HasFourVerticesTwoTriangles()
        {
            var m = QuadGeometry.BuildBillboardQuad(0.5f);
            Assert.AreEqual(4, m.vertexCount);
            Assert.AreEqual(6, m.triangles.Length);
            Object.DestroyImmediate(m);
        }

        [Test]
        public void Quad_HasNonZeroBounds()
        {
            var m = QuadGeometry.BuildBillboardQuad(0.5f);
            Assert.Greater(m.bounds.size.x, 0.4f);
            Assert.Greater(m.bounds.size.y, 0.4f);
            Object.DestroyImmediate(m);
        }

        [Test]
        public void Quad_DegenerateZeroSize_DoesNotCrash()
        {
            // 0 size: still produces 4 collapsed verts; no NaN/exception.
            Assert.DoesNotThrow(() =>
            {
                var m = QuadGeometry.BuildBillboardQuad(0f);
                Object.DestroyImmediate(m);
            });
        }

        // ─── CeremonyRingGeometry ───
        [Test]
        public void Ring_DefaultParams_64Segments_128Vertices()
        {
            var m = CeremonyRingGeometry.BuildRing(0.30f, 0.015f);
            // 64 segments × 2 (low+high vertex pair per segment)
            Assert.AreEqual(64 * 2, m.vertexCount);
            Object.DestroyImmediate(m);
        }

        [Test]
        public void Ring_HasNonZeroBounds()
        {
            var m = CeremonyRingGeometry.BuildRing(0.30f, 0.015f);
            Assert.Greater(m.bounds.size.x, 0.5f);
            Assert.Greater(m.bounds.size.z, 0.5f);
            Assert.Greater(m.bounds.size.y, 0.014f);
            Object.DestroyImmediate(m);
        }

        // ─── CairnBaseGeometry ───
        [Test]
        public void Base_FiveLayers_24Segments_HasExpectedVertexCount()
        {
            var m = CairnBaseGeometry.BuildStackedStoneMesh(0.45f, 0.12f, 5);
            // Per layer: 24 segments × 2 (top+bottom) + 1 cap-center = 49
            // Total: 5 × 49 = 245
            Assert.AreEqual(245, m.vertexCount);
            Object.DestroyImmediate(m);
        }

        [Test]
        public void Base_HasNonZeroBounds_AndCorrectHeight()
        {
            var m = CairnBaseGeometry.BuildStackedStoneMesh(0.45f, 0.12f, 5);
            Assert.That(m.bounds.size.y, Is.EqualTo(0.45f).Within(0.01f));
            Assert.Greater(m.bounds.size.x, 0.20f); // 2 * baseRadius
            Object.DestroyImmediate(m);
        }

        [Test]
        public void Base_DegenerateLayersZero_NormalizedTo1()
        {
            // layers=0 → clamped to 1 by the implementation; should not crash
            Assert.DoesNotThrow(() =>
            {
                var m = CairnBaseGeometry.BuildStackedStoneMesh(0.45f, 0.12f, 0);
                Assert.Greater(m.vertexCount, 0);
                Object.DestroyImmediate(m);
            });
        }

        [Test]
        public void Base_DegenerateNegativeRadius_NormalizedTo005()
        {
            Assert.DoesNotThrow(() =>
            {
                var m = CairnBaseGeometry.BuildStackedStoneMesh(0.45f, -1f, 5);
                Assert.Greater(m.bounds.size.x, 0.05f);
                Object.DestroyImmediate(m);
            });
        }

        // ─── PlaceholderTextures (round-2 fix #2B-1-B2 / #2B-2.A) ───
        [Test]
        public void PlaceholderTextures_ReturnsTextureForEachCairnType()
        {
            foreach (CairnType t in System.Enum.GetValues(typeof(CairnType)))
            {
                var tex = PlaceholderTextures.Get(t);
                Assert.IsNotNull(tex, $"placeholder texture missing for {t}");
                Assert.AreEqual(128, tex.width);
                Assert.AreEqual(128, tex.height);
            }
        }

        [Test]
        public void PlaceholderTextures_CachesPerType()
        {
            var first = PlaceholderTextures.Get(CairnType.Image);
            var second = PlaceholderTextures.Get(CairnType.Image);
            Assert.AreSame(first, second, "PlaceholderTextures must cache");
        }
    }
}
