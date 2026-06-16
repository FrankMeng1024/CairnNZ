// Phase 2B.5 — DistanceFaderV2.
//
// Fades cairn opacity based on distance from camera. Pure logic core
// (curve evaluation) extracted for EditMode unit tests; MonoBehaviour wrapper
// reads transform + camera at LateUpdate and applies to material.
//
// Curve (from plan §2B.5 + ADR-004 visual degradation feature flag):
//   distance ≤ near:        alpha = 1.0
//   distance ≥ far:         alpha = 0.0
//   between near and far:   alpha = smoothstep(far, near, distance)  [smoothstep clamped]

using UnityEngine;

namespace Cairn.AR.V025.Visual
{
    public static class DistanceFaderMath
    {
        /// <summary>
        /// Smoothstep alpha: 1 inside near, 0 beyond far, smooth between.
        /// </summary>
        public static float ComputeAlpha(float distance, float near, float far)
        {
            if (far <= near) return distance <= near ? 1.0f : 0.0f;
            if (distance <= near) return 1.0f;
            if (distance >= far) return 0.0f;
            // Manual smoothstep: t = (distance-near)/(far-near); 1 - t*t*(3-2t)
            var t = (distance - near) / (far - near);
            return 1.0f - (t * t * (3.0f - 2.0f * t));
        }
    }

    public sealed class DistanceFaderV2 : MonoBehaviour
    {
        [SerializeField] private Camera _targetCamera;
        [SerializeField] private float _nearMeters = 5.0f;
        [SerializeField] private float _farMeters = 25.0f;
        [SerializeField] private string _alphaShaderProperty = "_Alpha";

        private Renderer _renderer;
        private MaterialPropertyBlock _block;

        public float NearMeters { get => _nearMeters; set => _nearMeters = value; }
        public float FarMeters { get => _farMeters; set => _farMeters = value; }

        private void Awake()
        {
            _renderer = GetComponent<Renderer>();
            _block = new MaterialPropertyBlock();
        }

        private void LateUpdate()
        {
            var cam = _targetCamera ?? Camera.main;
            if (cam == null || _renderer == null) return;
            var dist = Vector3.Distance(transform.position, cam.transform.position);
            var alpha = DistanceFaderMath.ComputeAlpha(dist, _nearMeters, _farMeters);
            _renderer.GetPropertyBlock(_block);
            _block.SetFloat(_alphaShaderProperty, alpha);
            _renderer.SetPropertyBlock(_block);
        }
    }
}
