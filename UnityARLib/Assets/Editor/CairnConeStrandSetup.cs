#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;
using System.IO;

namespace Cairn.AR.Editor
{
    /// <summary>
    /// v0.2.3 Branch C — one-shot setup tool for the new ribbon visual.
    ///
    /// Generates:
    ///   • Procedural cone mesh (Assets/Meshes/cairn_cone_strand.asset)
    ///       radius: 0.18m base → 0.05m tip
    ///       height: 1.6m (vertical, Y up, base at Y=0)
    ///       segments: 16 radial × 8 height (mobile-cheap)
    ///       normals: radially outward (for fresnel rim in shaders)
    ///   • Material: Assets/Materials/CairnConeCore.mat using Cairn/CairnConeCore
    ///   • Material: Assets/Materials/CairnConeOutline.mat using Cairn/CairnConeOutline
    ///   • Adds CairnRibbonLOD + CairnDayNightAdapter to scene root if missing.
    ///
    /// Run via menu: Cairn → Branch C → Setup Cone Strand Assets
    /// Idempotent — re-running overwrites the cone mesh + materials, leaves
    /// scene wiring alone if already present.
    /// </summary>
    public static class CairnConeStrandSetup
    {
        [MenuItem("Cairn/Branch C/Setup Cone Strand Assets")]
        public static void RunSetup()
        {
            // Branch C v3 review-fix: assets MUST live under Assets/Resources
            // so Resources.Load works on device builds (not just Editor).
            EnsureFolder("Assets/Resources");
            EnsureFolder("Assets/Resources/Meshes");
            EnsureFolder("Assets/Resources/Materials");

            // 1. Cone mesh — 2 submeshes (one per material slot: core + outline)
            var mesh = BuildConeMesh(
                baseRadius: 0.18f,
                tipRadius: 0.05f,
                height: 1.6f,
                radialSegments: 16,
                heightSegments: 8);
            string meshPath = "Assets/Resources/Meshes/cairn_cone_strand.asset";
            AssetDatabase.CreateAsset(mesh, meshPath);
            AssetDatabase.SaveAssets();

            // 2. Core material
            var coreShader = Shader.Find("Cairn/CairnConeCore");
            if (coreShader == null)
            {
                Debug.LogError("[CairnConeStrandSetup] CairnConeCore shader not found. Reimport shaders first.");
                return;
            }
            var coreMat = new Material(coreShader) { name = "CairnConeCore" };
            string coreMatPath = "Assets/Resources/Materials/CairnConeCore.mat";
            AssetDatabase.CreateAsset(coreMat, coreMatPath);

            // 3. Outline material
            var outlineShader = Shader.Find("Cairn/CairnConeOutline");
            if (outlineShader == null)
            {
                Debug.LogError("[CairnConeStrandSetup] CairnConeOutline shader not found. Reimport shaders first.");
                return;
            }
            var outlineMat = new Material(outlineShader) { name = "CairnConeOutline" };
            string outlineMatPath = "Assets/Resources/Materials/CairnConeOutline.mat";
            AssetDatabase.CreateAsset(outlineMat, outlineMatPath);

            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();

            // 4. Wire LOD + DayNight adapter into the active scene if not present.
            var lod = Object.FindFirstObjectByType<CairnRibbonLOD>();
            if (lod == null)
            {
                var go = new GameObject("CairnRibbonLOD");
                go.AddComponent<CairnRibbonLOD>();
                Debug.Log("[CairnConeStrandSetup] Added CairnRibbonLOD to scene.");
            }
            var dn = Object.FindFirstObjectByType<CairnDayNightAdapter>();
            if (dn == null)
            {
                var go = new GameObject("CairnDayNightAdapter");
                go.AddComponent<CairnDayNightAdapter>();
                Debug.Log("[CairnConeStrandSetup] Added CairnDayNightAdapter to scene.");
            }

            Debug.Log($"[CairnConeStrandSetup] Done. Mesh: {meshPath}, Materials: {coreMatPath}, {outlineMatPath}");
        }

        private static void EnsureFolder(string path)
        {
            if (!Directory.Exists(path))
            {
                Directory.CreateDirectory(path);
                AssetDatabase.Refresh();
            }
        }

        private static Mesh BuildConeMesh(
            float baseRadius, float tipRadius, float height,
            int radialSegments, int heightSegments)
        {
            var mesh = new Mesh();
            mesh.name = "cairn_cone_strand";

            int ringCount = heightSegments + 1;       // count of vertex rings along height
            int verticesPerRing = radialSegments + 1;  // close the loop with seam vertex
            int vertCount = ringCount * verticesPerRing;
            var vertices = new Vector3[vertCount];
            var normals  = new Vector3[vertCount];
            var uvs      = new Vector2[vertCount];

            for (int h = 0; h <= heightSegments; h++)
            {
                float vT = (float)h / heightSegments;
                float y = vT * height;
                float r = Mathf.Lerp(baseRadius, tipRadius, vT);
                for (int s = 0; s <= radialSegments; s++)
                {
                    float uT = (float)s / radialSegments;
                    float angle = uT * Mathf.PI * 2f;
                    float cs = Mathf.Cos(angle), sn = Mathf.Sin(angle);
                    int idx = h * verticesPerRing + s;
                    vertices[idx] = new Vector3(r * cs, y, r * sn);
                    // Radially outward normal — fresnel rim depends on this.
                    // Account for cone slant so the normal is perpendicular to
                    // the cone surface, not just horizontal.
                    Vector3 radial = new Vector3(cs, 0, sn);
                    Vector3 slope = new Vector3(0, (baseRadius - tipRadius) / Mathf.Max(0.001f, height), 0);
                    Vector3 n = (radial + slope).normalized;
                    normals[idx] = n;
                    uvs[idx] = new Vector2(uT, vT);
                }
            }

            // Triangles — quad strips between successive rings.
            // Branch C v3 review-fix: TWO submeshes, one per material slot
            // (core + outline). Both submeshes use the SAME triangles —
            // MeshRenderer with sharedMaterials=[core, outline] then renders
            // both passes against the same geometry. Without this, only the
            // core material draws and the outline pass is silently dead.
            int triCount = heightSegments * radialSegments * 2;
            var triangles = new int[triCount * 3];
            int t = 0;
            for (int h = 0; h < heightSegments; h++)
            {
                for (int s = 0; s < radialSegments; s++)
                {
                    int a = h * verticesPerRing + s;
                    int b = a + 1;
                    int c = a + verticesPerRing;
                    int d = c + 1;
                    triangles[t++] = a;
                    triangles[t++] = c;
                    triangles[t++] = b;
                    triangles[t++] = b;
                    triangles[t++] = c;
                    triangles[t++] = d;
                }
            }

            mesh.vertices = vertices;
            mesh.normals = normals;
            mesh.uv = uvs;
            // Two submeshes — both reference the same triangle buffer.
            mesh.subMeshCount = 2;
            mesh.SetTriangles(triangles, 0);
            mesh.SetTriangles(triangles, 1);
            mesh.RecalculateBounds();
            return mesh;
        }
    }
}
#endif
