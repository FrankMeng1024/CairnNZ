// Phase 2B.3 — CeremonyV2Controller.
//
// Outer ring sweep effect: a circular ring around the cairn base that animates
// a "sweep" — a single-color phase-shifted gradient revolving once over
// CeremonySweepDurationSeconds.
//
// Design (v2026-06_variant_C HTML demo):
//   - ring radius = 0.30m around cairn center
//   - ring height = 1.5cm (shallow; sits at ground)
//   - sweep period = 1.0s
//   - color = warm orange (#FB923C) on ADR-004 default; degraded → static
//
// The math + sweep position are pure-logic; the GameObject wrapper only
// applies the computed value to a shader property.

using UnityEngine;

namespace Cairn.AR.V025.Visual
{
    public static class CeremonySweepMath
    {
        /// <summary>
        /// Compute current sweep angle (in radians, 0 to 2π) given elapsed time.
        /// Wraps at 2π.
        /// </summary>
        public static float SweepAngleRadians(float elapsedSeconds, float periodSeconds)
        {
            if (periodSeconds <= 0) return 0;
            var t = elapsedSeconds / periodSeconds;
            return (t - Mathf.Floor(t)) * Mathf.PI * 2.0f;
        }

        /// <summary>
        /// Compute alpha intensity at a given ring point given sweep position.
        /// Returns 1.0 at sweep peak, fading linearly over halfWidthRadians on either side.
        /// Round-2 fix #2B-1-C2: use atan2(sin,cos) wrap directly (matches shader frag),
        /// no degree round-trip.
        /// </summary>
        public static float SweepIntensityAtPoint(float pointAngleRad, float sweepAngleRad, float halfWidthRadians)
        {
            var raw = pointAngleRad - sweepAngleRad;
            var wrapped = Mathf.Atan2(Mathf.Sin(raw), Mathf.Cos(raw));
            var d = Mathf.Abs(wrapped);
            if (d >= halfWidthRadians) return 0.0f;
            return 1.0f - (d / halfWidthRadians);
        }
    }

    [RequireComponent(typeof(MeshFilter))]
    [RequireComponent(typeof(MeshRenderer))]
    public sealed class CeremonyV2Controller : MonoBehaviour
    {
        [SerializeField] private Material _ringMaterial;
        [SerializeField] private float _ringRadiusMeters = 0.30f;
        [SerializeField] private float _ringHeightMeters = 0.015f;
        [SerializeField] private float _sweepPeriodSeconds = 1.0f;
        [SerializeField] private float _sweepHalfWidthRadians = 0.6f;
        [SerializeField] private bool _staticDegradedMode = false;

        private MeshFilter _filter;
        private MeshRenderer _renderer;
        private MaterialPropertyBlock _block;
        private float _elapsed;

        public bool StaticDegradedMode { get => _staticDegradedMode; set => _staticDegradedMode = value; }

        private void Awake()
        {
            _filter = GetComponent<MeshFilter>();
            _renderer = GetComponent<MeshRenderer>();
            _block = new MaterialPropertyBlock();
        }

        private void OnEnable()
        {
            _filter.sharedMesh = CeremonyRingGeometry.BuildRing(_ringRadiusMeters, _ringHeightMeters);
            if (_ringMaterial != null) _renderer.sharedMaterial = _ringMaterial;
            _elapsed = 0;
        }

        private void Update()
        {
            if (_renderer == null) return;
            _elapsed += Time.deltaTime;
            float sweepAngle;
            if (_staticDegradedMode)
            {
                sweepAngle = 0;
            }
            else
            {
                sweepAngle = CeremonySweepMath.SweepAngleRadians(_elapsed, _sweepPeriodSeconds);
            }
            _renderer.GetPropertyBlock(_block);
            _block.SetFloat("_SweepAngle", sweepAngle);
            _block.SetFloat("_SweepHalfWidth", _sweepHalfWidthRadians);
            _renderer.SetPropertyBlock(_block);
        }
    }

    public static class CeremonyRingGeometry
    {
        public static Mesh BuildRing(float radius, float height)
        {
            const int segments = 64;
            var verts = new System.Collections.Generic.List<Vector3>();
            var uvs = new System.Collections.Generic.List<Vector2>();
            var tris = new System.Collections.Generic.List<int>();
            for (int s = 0; s < segments; s++)
            {
                float ang = (s / (float)segments) * Mathf.PI * 2.0f;
                float cx = Mathf.Cos(ang) * radius;
                float cz = Mathf.Sin(ang) * radius;
                verts.Add(new Vector3(cx, 0, cz));
                verts.Add(new Vector3(cx, height, cz));
                uvs.Add(new Vector2(s / (float)segments, 0));
                uvs.Add(new Vector2(s / (float)segments, 1));
            }
            for (int s = 0; s < segments; s++)
            {
                int s0Low = s * 2;
                int s0High = s0Low + 1;
                int s1Low = ((s + 1) % segments) * 2;
                int s1High = s1Low + 1;
                tris.Add(s0Low); tris.Add(s0High); tris.Add(s1High);
                tris.Add(s0Low); tris.Add(s1High); tris.Add(s1Low);
            }
            var mesh = new Mesh { name = "CairnCeremony_Ring" };
            mesh.SetVertices(verts);
            mesh.SetUVs(0, uvs);
            mesh.SetTriangles(tris, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }
    }
}
