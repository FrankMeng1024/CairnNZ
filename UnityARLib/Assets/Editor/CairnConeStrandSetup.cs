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

            // 1. v3.2: Two cone meshes — inner (solid trail) + outer (hollow halo).
            // Subagent Plan C nested cones: small inner solid (the bright core line)
            // nested fully inside larger outer hollow shell (the volumetric halo).
            // Eye sees: through outer rim → dimmer interior → bright thin core trail.
            // Matches DS chiral pattern.
            var meshInner = BuildConeMesh(
                baseRadius: 0.04f,    // very thin core trail
                tipRadius: 0.0f,
                height: 1.4f,
                radialSegments: 12,
                heightSegments: 6);
            string innerPath = "Assets/Resources/Meshes/cairn_cone_inner.asset";
            AssetDatabase.CreateAsset(meshInner, innerPath);

            var meshOuter = BuildConeMesh(
                baseRadius: 0.18f,    // outer halo
                tipRadius: 0.0f,
                height: 1.7f,
                radialSegments: 16,
                heightSegments: 8);
            string outerPath = "Assets/Resources/Meshes/cairn_cone_outer.asset";
            AssetDatabase.CreateAsset(meshOuter, outerPath);

            // Keep the legacy single-mesh asset for compatibility (some debug
            // paths reference it).
            var meshLegacy = BuildConeMesh(
                baseRadius: 0.18f,
                tipRadius: 0.0f,
                height: 1.6f,
                radialSegments: 16,
                heightSegments: 8);
            string legacyPath = "Assets/Resources/Meshes/cairn_cone_strand.asset";
            AssetDatabase.CreateAsset(meshLegacy, legacyPath);
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

            // v3.5b: 4 layers stack additively (2 strands × inner+outer).
            // Each layer must output ~0.2 max luma so stacked total is
            // ~0.8 — bright but not clipped to white. Tint must dominate.
            //
            // Inner-core material — thin TINTED thread.
            var coreInnerMat = new Material(coreShader) { name = "CairnConeCoreInner" };
            coreInnerMat.SetFloat("_RimSharpness", 1.5f);
            coreInnerMat.SetFloat("_FlowStrength", 0.95f);
            coreInnerMat.SetFloat("_BloomBoost", 0.20f);
            coreInnerMat.SetFloat("_NightMul", 0.45f);     // v3.5f: only 1 cairn now (overlap fixed)
            coreInnerMat.SetFloat("_DayMul", 0.30f);
            coreInnerMat.SetFloat("_MaxLuma", 0.85f);      // v3.5f restored from over-dim 0.20
            coreInnerMat.SetFloat("_CoreTintMix", 1.00f);  // v3.5c: inner = pure type color (no white mix)
            string coreInnerPath = "Assets/Resources/Materials/CairnConeCoreInner.mat";
            AssetDatabase.CreateAsset(coreInnerMat, coreInnerPath);

            // Outer halo — DOMINANT volumetric halo with rim tint.
            var coreOuterMat = new Material(coreShader) { name = "CairnConeCoreOuter" };
            coreOuterMat.SetFloat("_RimSharpness", 2.8f);   // v3.5g was 4.5 — softer gaussian-like falloff
            coreOuterMat.SetFloat("_FlowStrength", 0.95f);
            coreOuterMat.SetFloat("_BloomBoost", 0.35f);
            coreOuterMat.SetFloat("_NightMul", 0.55f);     // v3.5f: only 1 cairn now
            coreOuterMat.SetFloat("_DayMul", 0.30f);
            coreOuterMat.SetFloat("_MaxLuma", 0.90f);      // v3.5f restored
            coreOuterMat.SetFloat("_CoreTintMix", 0.65f);  // v3.5c was 0.45 — even stronger type body
            string coreOuterPath = "Assets/Resources/Materials/CairnConeCoreOuter.mat";
            AssetDatabase.CreateAsset(coreOuterMat, coreOuterPath);

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

            Debug.Log($"[CairnConeStrandSetup] Done. Meshes: inner+outer+legacy, Materials: core/inner/outer/outline");
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
