// Phase 2B.1 — CairnBaseRenderer.
//
// Renders the cairn's stone base — a stack of mesh primitives whose proportions
// match the design v2026-06_variant_C HTML demo (the visual baseline per Rule M).
//
// Phase 2B scope:
//   - Construct mesh stack at runtime (no prefab dependency for the base shape;
//     prefab provides only the GameObject + Material slots)
//   - Apply CairnBase.shader (Phase 2B.7)
//   - Wire into CairnAssemblyV2's child hierarchy
//
// Visual fidelity (Rule M.4):
//   The HTML demo shows 5 progressively smaller flat stones stacked. We mirror
//   that proportional system; exact heights per Sprint 0 style direction.
//
// 见 ADR-005(SDF 纹理来源):base 不需 SDF,只 type icon needs.

using System;
using UnityEngine;

namespace Cairn.AR.V025.Visual
{
    [RequireComponent(typeof(MeshFilter))]
    [RequireComponent(typeof(MeshRenderer))]
    public sealed class CairnBaseRenderer : MonoBehaviour
    {
        [SerializeField] private Material _baseMaterial;
        [SerializeField] private float _totalHeightMeters = 0.45f;
        [SerializeField] private float _baseRadiusMeters = 0.12f;
        [SerializeField] private int _stoneLayers = 5;

        private MeshFilter _filter;
        private MeshRenderer _renderer;

        public Material BaseMaterial { get => _baseMaterial; set => _baseMaterial = value; }
        public float TotalHeightMeters { get => _totalHeightMeters; set => _totalHeightMeters = Mathf.Max(0.05f, value); }

        private void Awake()
        {
            _filter = GetComponent<MeshFilter>();
            _renderer = GetComponent<MeshRenderer>();
        }

        private void OnEnable()
        {
            BuildOrRefresh();
        }

        public void BuildOrRefresh()
        {
            if (_filter == null) _filter = GetComponent<MeshFilter>();
            if (_renderer == null) _renderer = GetComponent<MeshRenderer>();
            _filter.sharedMesh = CairnBaseGeometry.BuildStackedStoneMesh(
                _totalHeightMeters, _baseRadiusMeters, _stoneLayers);
            if (_baseMaterial != null) _renderer.sharedMaterial = _baseMaterial;
        }
    }

    /// <summary>
    /// Pure-geometry construction. Editor + EditMode tests can call this without a
    /// MonoBehaviour. Caller supplies the dimensions; this class returns a fully
    /// constructed Mesh (positions + normals + uvs + indices).
    /// </summary>
    public static class CairnBaseGeometry
    {
        /// <summary>
        /// Build a stack of <paramref name="layers"/> flat cylindrical stones.
        /// Each layer's radius shrinks linearly from baseRadius (bottom) to baseRadius*0.4 (top).
        /// Each layer's height = totalHeight / layers.
        /// </summary>
        public static Mesh BuildStackedStoneMesh(float totalHeightMeters, float baseRadiusMeters, int layers)
        {
            if (layers < 1) layers = 1;
            if (totalHeightMeters <= 0) totalHeightMeters = 0.05f;
            if (baseRadiusMeters <= 0) baseRadiusMeters = 0.05f;

            const int segments = 24; // around-circumference subdivisions per stone
            var verts = new System.Collections.Generic.List<Vector3>(segments * 2 * layers);
            var norms = new System.Collections.Generic.List<Vector3>();
            var uvs = new System.Collections.Generic.List<Vector2>();
            var tris = new System.Collections.Generic.List<int>();

            float layerHeight = totalHeightMeters / layers;
            for (int L = 0; L < layers; L++)
            {
                float yLow = L * layerHeight;
                float yHigh = yLow + layerHeight;
                // shrink bottom→top
                float t = (float)L / Mathf.Max(1, layers - 1);
                float r = Mathf.Lerp(baseRadiusMeters, baseRadiusMeters * 0.4f, t);

                int baseIdx = verts.Count;
                for (int s = 0; s < segments; s++)
                {
                    float ang = (s / (float)segments) * Mathf.PI * 2.0f;
                    float cx = Mathf.Cos(ang) * r;
                    float cz = Mathf.Sin(ang) * r;
                    // bottom ring
                    verts.Add(new Vector3(cx, yLow, cz));
                    norms.Add(new Vector3(Mathf.Cos(ang), 0, Mathf.Sin(ang)));
                    uvs.Add(new Vector2(s / (float)segments, 0));
                    // top ring
                    verts.Add(new Vector3(cx, yHigh, cz));
                    norms.Add(new Vector3(Mathf.Cos(ang), 0, Mathf.Sin(ang)));
                    uvs.Add(new Vector2(s / (float)segments, 1));
                }
                // side triangles
                for (int s = 0; s < segments; s++)
                {
                    int s0Low = baseIdx + s * 2;
                    int s0High = s0Low + 1;
                    int s1Low = baseIdx + ((s + 1) % segments) * 2;
                    int s1High = s1Low + 1;
                    tris.Add(s0Low); tris.Add(s0High); tris.Add(s1High);
                    tris.Add(s0Low); tris.Add(s1High); tris.Add(s1Low);
                }
                // top cap (simple fan around layer-center)
                int centerIdx = verts.Count;
                verts.Add(new Vector3(0, yHigh, 0));
                norms.Add(Vector3.up);
                uvs.Add(new Vector2(0.5f, 0.5f));
                for (int s = 0; s < segments; s++)
                {
                    int s0High = baseIdx + s * 2 + 1;
                    int s1High = baseIdx + ((s + 1) % segments) * 2 + 1;
                    tris.Add(centerIdx); tris.Add(s0High); tris.Add(s1High);
                }
            }

            var mesh = new Mesh { name = "CairnBase_Stacked" };
            mesh.SetVertices(verts);
            mesh.SetNormals(norms);
            mesh.SetUVs(0, uvs);
            mesh.SetTriangles(tris, 0);
            mesh.RecalculateBounds();
            return mesh;
        }
    }
}
