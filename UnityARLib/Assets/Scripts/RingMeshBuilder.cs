// Cairn AR — RingMeshBuilder (v0.2.4 Branch C, Tier-1 圆环)
//
// 程序化生成圆环 mesh,1:1 移植 Three.js RingGeometry(outer, inner, segments)。
// 主环:RingGeometry(R - 0.013, R, 96)
// 内环:RingGeometry(R * 0.65, R * 0.665, 64)
//
// Mesh 在 XZ 平面(y=0),无需后续 transform.rotation.x = -π/2。
// UV.x = 角度 0..1(用于 shader sweep discard)
// UV.y = 0 outer / 1 inner(径向,未来可用作渐变)
// 起始角度 -π/2(12 点钟),顺时针(angular sweep 用)

using UnityEngine;

namespace Cairn.AR
{
    public static class RingMeshBuilder
    {
        /// <summary>
        /// Build a flat ring mesh on XZ plane (y=0).
        /// </summary>
        /// <param name="outerR">Outer radius (m)</param>
        /// <param name="innerR">Inner radius (m). Must be &lt; outerR.</param>
        /// <param name="segments">Number of angular segments (96 for main, 64 for inner)</param>
        public static Mesh Build(float outerR, float innerR, int segments)
        {
            if (segments < 8) segments = 8;
            var mesh = new Mesh();
            mesh.name = $"RingFlat_{outerR:F3}_{innerR:F3}_{segments}";

            // Vertex count = (segments + 1) × 2 (outer + inner ring)
            int vertCount = (segments + 1) * 2;
            var verts = new Vector3[vertCount];
            var uvs   = new Vector2[vertCount];

            // Triangle count = segments × 2 (each angular slice = 2 triangles forming a quad)
            int triCount = segments * 2;
            var tris  = new int[triCount * 3];

            // Build vertices
            // Theta starts at -π/2 (12 o'clock) and goes clockwise.
            // Three.js Y-up + counter-clockwise → in Unity XZ we mirror Z to get clockwise.
            // For our shader, what matters is that uv.x increases monotonically from
            // 12 o'clock around the ring; we use clockwise to match Three.js sweep.
            float thetaStart = -Mathf.PI * 0.5f;
            for (int i = 0; i <= segments; i++)
            {
                float t = (float)i / segments;
                // Clockwise from 12 o'clock: theta = thetaStart - 2π × t
                float theta = thetaStart - 2f * Mathf.PI * t;
                float cs = Mathf.Cos(theta);
                float sn = Mathf.Sin(theta);

                int outerIdx = i * 2 + 0;
                int innerIdx = i * 2 + 1;

                verts[outerIdx] = new Vector3(cs * outerR, 0f, sn * outerR);
                verts[innerIdx] = new Vector3(cs * innerR, 0f, sn * innerR);

                uvs[outerIdx] = new Vector2(t, 0f);  // uv.y = 0 → outer
                uvs[innerIdx] = new Vector2(t, 1f);  // uv.y = 1 → inner
            }

            // Build triangles
            // Each segment's quad: [outer_i, inner_i, outer_i+1, inner_i+1]
            //   triangle 1: outer_i, outer_i+1, inner_i
            //   triangle 2: outer_i+1, inner_i+1, inner_i
            int t2 = 0;
            for (int i = 0; i < segments; i++)
            {
                int o0 = i * 2;
                int i0 = o0 + 1;
                int o1 = o0 + 2;
                int i1 = o0 + 3;

                tris[t2++] = o0;
                tris[t2++] = o1;
                tris[t2++] = i0;

                tris[t2++] = o1;
                tris[t2++] = i1;
                tris[t2++] = i0;
            }

            mesh.SetVertices(verts);
            mesh.SetUVs(0, uvs);
            mesh.SetTriangles(tris, 0);
            mesh.RecalculateNormals();
            // Manual bounds (avoid frustum cull on flat mesh + small thickness)
            float r = Mathf.Max(outerR, innerR);
            mesh.bounds = new Bounds(Vector3.zero, new Vector3(r * 2.2f, 0.05f, r * 2.2f));
            return mesh;
        }
    }
}
