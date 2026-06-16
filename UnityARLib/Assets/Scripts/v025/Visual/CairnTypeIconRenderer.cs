// Phase 2B.2 — CairnTypeIconRenderer.
//
// Renders the type icon (image/voice/video/text/route) on a billboard quad
// above the cairn base. Uses ADR-005-allowed legacy SDF textures from
// `Resources/cairn_type_sdf/{image,voice,video,text,route}.png`.
//
// 见 ADR-005(SDF 纹理来源:允许从 v0.2.4 老 SDF 引入,跟"视觉自包含"局部矛盾,以"质量优先"裁定)

using UnityEngine;

namespace Cairn.AR.V025.Visual
{
    public enum CairnType
    {
        Image,
        Voice,
        Video,
        Text,
        Route,
    }

    [RequireComponent(typeof(MeshFilter))]
    [RequireComponent(typeof(MeshRenderer))]
    public sealed class CairnTypeIconRenderer : MonoBehaviour
    {
        [SerializeField] private CairnType _cairnType = CairnType.Image;
        [SerializeField] private Material _iconMaterial;
        [SerializeField] private float _iconSizeMeters = 0.18f;
        [SerializeField] private float _yOffsetAboveBase = 0.50f;
        // ADR-005: legacy SDF resource path
        [SerializeField] private string _legacySdfResourcePath = "cairn_type_sdf";

        private MeshFilter _filter;
        private MeshRenderer _renderer;

        public CairnType CairnType
        {
            get => _cairnType;
            set { _cairnType = value; ApplyTexture(); }
        }

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
            _filter.sharedMesh = QuadGeometry.BuildBillboardQuad(_iconSizeMeters);
            transform.localPosition = new Vector3(0, _yOffsetAboveBase, 0);
            if (_iconMaterial != null) _renderer.sharedMaterial = _iconMaterial;
            ApplyTexture();
        }

        private void ApplyTexture()
        {
            if (_renderer == null) return;
            var name = TextureNameFor(_cairnType);
            var tex = Resources.Load<Texture2D>(_legacySdfResourcePath + "/" + name);
            if (tex == null)
            {
                // Fallback to runtime placeholder per ADR-005 (revised 2026-06-17).
                // Phase 4 EAS build #1 replaces this with designer-authored SDFs.
                tex = PlaceholderTextures.Get(_cairnType);
            }
            // Use property block to avoid material instance leaks
            var block = new MaterialPropertyBlock();
            _renderer.GetPropertyBlock(block);
            block.SetTexture("_MainTex", tex);
            _renderer.SetPropertyBlock(block);
        }

        public static string TextureNameFor(CairnType t)
        {
            switch (t)
            {
                case CairnType.Image: return "image";
                case CairnType.Voice: return "voice";
                case CairnType.Video: return "video";
                case CairnType.Text:  return "text";
                case CairnType.Route: return "route";
                default: return "image";
            }
        }
    }

    public static class QuadGeometry
    {
        /// <summary>
        /// Build a centered XY quad of side length sizeMeters (Z=0).
        /// Caller is responsible for making it billboard via BillboardYawV2.
        /// </summary>
        public static Mesh BuildBillboardQuad(float sizeMeters)
        {
            float h = sizeMeters * 0.5f;
            var mesh = new Mesh { name = "CairnTypeIcon_Quad" };
            mesh.SetVertices(new System.Collections.Generic.List<Vector3>
            {
                new Vector3(-h, -h, 0),
                new Vector3( h, -h, 0),
                new Vector3( h,  h, 0),
                new Vector3(-h,  h, 0),
            });
            mesh.SetUVs(0, new System.Collections.Generic.List<Vector2>
            {
                new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, 1), new Vector2(0, 1),
            });
            mesh.SetTriangles(new int[] { 0, 1, 2, 0, 2, 3 }, 0);
            mesh.SetNormals(new System.Collections.Generic.List<Vector3>
            {
                Vector3.back, Vector3.back, Vector3.back, Vector3.back,
            });
            mesh.RecalculateBounds();
            return mesh;
        }
    }
}
