// Phase 2B.4 — TypeParticleV2Controller.
//
// Per-type ambient particle effect rendering. Uses a billboard SDF on each
// particle so the effect is consistent on any view angle.
//
// 5 types × distinct color/motion (from design spec):
//   image: gentle upward float, soft warm gold
//   voice: pulsing inward-outward radial, blue
//   video: fast wisps, magenta
//   text:  paper-flutter horizontal, white
//   route: trailing dash, green
//
// Implementation note: rather than a per-type ParticleSystem (heavyweight),
// we use one shared ParticleSystem with parameters driven by CairnType.

using UnityEngine;

namespace Cairn.AR.V025.Visual
{
    public sealed class TypeParticleV2Controller : MonoBehaviour
    {
        [SerializeField] private ParticleSystem _particles;
        [SerializeField] private CairnType _cairnType = CairnType.Image;

        public CairnType CairnType
        {
            get => _cairnType;
            set { _cairnType = value; ApplyTypeParameters(); }
        }

        private void Awake()
        {
            if (_particles == null) _particles = GetComponentInChildren<ParticleSystem>();
        }

        private void OnEnable()
        {
            ApplyTypeParameters();
        }

        public void ApplyTypeParameters()
        {
            if (_particles == null) return;
            var main = _particles.main;
            var emission = _particles.emission;
            var velocity = _particles.velocityOverLifetime;
            velocity.enabled = true;

            switch (_cairnType)
            {
                case CairnType.Image:
                    main.startColor = new Color(1f, 0.85f, 0.4f, 1f); // warm gold
                    main.startSpeed = 0.2f;
                    main.startLifetime = 2.5f;
                    main.startSize = 0.04f;
                    velocity.y = new ParticleSystem.MinMaxCurve(0.1f, 0.3f);
                    emission.rateOverTime = 6f;
                    break;
                case CairnType.Voice:
                    main.startColor = new Color(0.4f, 0.7f, 1f, 1f); // blue
                    main.startSpeed = 0.3f;
                    main.startLifetime = 1.5f;
                    main.startSize = 0.05f;
                    velocity.y = new ParticleSystem.MinMaxCurve(0f);
                    emission.rateOverTime = 10f;
                    break;
                case CairnType.Video:
                    main.startColor = new Color(0.95f, 0.4f, 0.95f, 1f); // magenta
                    main.startSpeed = 0.5f;
                    main.startLifetime = 1.0f;
                    main.startSize = 0.03f;
                    velocity.y = new ParticleSystem.MinMaxCurve(0.2f, 0.6f);
                    emission.rateOverTime = 14f;
                    break;
                case CairnType.Text:
                    main.startColor = new Color(0.95f, 0.95f, 0.95f, 1f); // white
                    main.startSpeed = 0.15f;
                    main.startLifetime = 3.0f;
                    main.startSize = 0.05f;
                    velocity.y = new ParticleSystem.MinMaxCurve(0.0f, 0.05f);
                    emission.rateOverTime = 4f;
                    break;
                case CairnType.Route:
                    main.startColor = new Color(0.4f, 0.85f, 0.5f, 1f); // green
                    main.startSpeed = 0.4f;
                    main.startLifetime = 1.8f;
                    main.startSize = 0.04f;
                    velocity.y = new ParticleSystem.MinMaxCurve(0.05f, 0.2f);
                    emission.rateOverTime = 8f;
                    break;
            }
        }
    }
}
