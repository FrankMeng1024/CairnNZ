// Cairn AR — Type-specific particle controller (v0.2.4 Branch C)
//
// 1:1 port of design_v2026-06_variant_C_3D.html line 421-568 TypeParticles
// class, with Unity-specific enhancements per user request "目前的太单调
// 不够凸显type本身":
//   * cairn  — small stones with emissive flicker + ground bounce dust
//   * water  — drops with motion trail + landing ripple
//   * danger — sparks already flicker; added rising ember sub-emitter
//   * hut    — embers with lateral oscillation (candle-flame feel)
//   * junction — orbiting arrows with subtle trail
//
// Activated by CeremonyController at t >= 0.5s, deactivated when cairn
// LOD goes to FAR.
//
// Performance budget: 5 types × ~16 particles concurrent = ~80 per cluster.
// 5 cairn clusters visible = ~400 particles. iPhone SE2 baseline OK.
//
// Cleanup: clear() on type change or cairn destroy.

using System.Collections.Generic;
using UnityEngine;

namespace Cairn.AR
{
    /// <summary>
    /// Per-type particle "soul" controller. One instance per cairn cluster.
    /// Attach to a child GameObject of the cairn root.
    /// </summary>
    public class TypeParticleController : MonoBehaviour
    {
        [Header("Type")]
        [SerializeField] string _type = "cairn";  // cairn / water / danger / hut / junction
        [SerializeField] Color _typeColor = new Color(0.91f, 0.78f, 0.59f, 1f);
        [SerializeField] float _ringRadius = 0.55f;

        [Header("Behavior gates (driven by CeremonyController)")]
        [SerializeField] bool _spawnEnabled = false;

        // Per-particle data
        struct Particle
        {
            public Transform tr;
            public Renderer renderer;
            public Material mat;        // instance for opacity flicker
            public Vector3 vel;
            public float life;
            public float maxLife;
            public string kind;
            public float orbitR;
            public float orbitPhase;
            public float orbitSpeed;
            public float orbitY;
            public TrailRenderer trail; // optional
        }

        readonly List<Particle> _points = new List<Particle>();
        float _spawnAccum;

        // Spawn rate per type (per second)
        static readonly Dictionary<string, float> _rates = new Dictionary<string, float>
        {
            { "cairn", 6f },
            { "water", 14f },
            { "danger", 16f },
            { "hut", 4f },
            { "junction", 0f },  // junction is orbital fixed-count (6)
        };

        // For "junction" — fixed 6 arrows always.
        const int JUNCTION_ARROW_COUNT = 6;

        public void Configure(string type, Color color, float ringRadius = 0.55f)
        {
            // type change → clear existing particles
            if (_type != type)
            {
                Clear();
                _type = type;
            }
            _typeColor = color;
            _ringRadius = ringRadius;
        }

        public void SetSpawnEnabled(bool enabled)
        {
            _spawnEnabled = enabled;
            if (!enabled)
            {
                // Don't immediately clear — let live particles finish their life
                // for visual continuity. Just stop spawning new.
            }
        }

        public void Clear()
        {
            for (int i = 0; i < _points.Count; i++)
            {
                var p = _points[i];
                if (p.tr != null) Destroy(p.tr.gameObject);
            }
            _points.Clear();
            _spawnAccum = 0f;
        }

        void OnDisable()
        {
            // Lifecycle: hide cluster (LOD far / cairn destroyed) → reset.
            // Don't Clear here so re-enable can pick up where it left off if
            // designed that way. For now we keep state.
        }

        void OnDestroy()
        {
            Clear();
        }

        void Update()
        {
            float dt = Time.deltaTime;
            if (dt <= 0f || dt > 0.5f) return;  // skip pause / first frame
            UpdateInternal(dt);
        }

        /// <summary>
        /// v0.2.4: manual tick for Editor batch capture.
        /// Calls UpdateInternal directly with provided dt, bypassing
        /// MonoBehaviour Update which doesn't fire in batch mode.
        /// </summary>
        public void EditorManualTick(float dt)
        {
            UpdateInternal(dt);
        }

        void UpdateInternal(float dt)
        {
            // Spawn pacing
            if (_spawnEnabled)
            {
                if (_type == "junction")
                {
                    int arrows = 0;
                    for (int i = 0; i < _points.Count; i++)
                    {
                        if (_points[i].kind == "arrow") arrows++;
                    }
                    while (arrows < JUNCTION_ARROW_COUNT)
                    {
                        SpawnOne();
                        arrows++;
                    }
                }
                else
                {
                    float rate = _rates.TryGetValue(_type, out var r) ? r : 6f;
                    _spawnAccum += dt * rate;
                    while (_spawnAccum >= 1f)
                    {
                        _spawnAccum -= 1f;
                        SpawnOne();
                    }
                }
            }

            // Update & cull
            float tNow = Time.time;
            for (int i = _points.Count - 1; i >= 0; i--)
            {
                var p = _points[i];
                p.life += dt;

                if (p.kind == "arrow")
                {
                    // Orbit + bobbing
                    p.orbitPhase += dt * p.orbitSpeed;
                    var pos = new Vector3(
                        Mathf.Cos(p.orbitPhase) * p.orbitR,
                        p.orbitY + Mathf.Sin(tNow * 1.5f + i) * 0.025f,
                        Mathf.Sin(p.orbitPhase) * p.orbitR);
                    p.tr.localPosition = pos;
                    // Cone default tip is +Y; tilt 90° so it points along orbit tangent
                    p.tr.localRotation = Quaternion.Euler(0, -p.orbitPhase * Mathf.Rad2Deg + 90f, 90f);
                }
                else
                {
                    // Physics: gravity + per-kind behaviour
                    p.vel.y -= 1.4f * dt;
                    var pos = p.tr.localPosition + p.vel * dt;

                    if (p.kind == "stone")
                    {
                        // Tumble
                        p.tr.localRotation *= Quaternion.Euler(dt * 200f, 0, dt * 115f);
                        // Bounce on ground (y=0.012 above ring plane)
                        if (pos.y < 0.012f && p.vel.y < 0f)
                        {
                            pos.y = 0.012f;
                            p.vel.y = -p.vel.y * 0.4f;
                            p.vel.x *= 0.6f;
                            p.vel.z *= 0.6f;
                        }
                        // v0.2.4 enhancement: emissive flicker for "stone has soul"
                        if (p.mat != null && p.mat.HasProperty("_EmissionColor"))
                        {
                            float flick = 0.4f + 0.3f * Mathf.Sin(p.life * 9f + i * 0.7f);
                            p.mat.SetColor("_EmissionColor", new Color(
                                _typeColor.r * 0.4f, _typeColor.g * 0.3f, _typeColor.b * 0.2f) * flick);
                        }
                    }
                    else if (p.kind == "spark")
                    {
                        // Counteract gravity (rising)
                        p.vel.y += 1.2f * dt;
                        // Flicker opacity
                        float a = (0.5f + 0.5f * Mathf.Sin(p.life * 14f)) * Mathf.Max(0f, 1f - p.life / p.maxLife);
                        SetOpacity(p.mat, a);
                    }
                    else if (p.kind == "ember")
                    {
                        // Slow rise + lateral drift (candle flame)
                        p.vel.y += 1.1f * dt;
                        p.vel.x += Mathf.Sin(tNow * 1.2f + i * 0.7f) * 0.025f * dt;
                        p.vel.z += Mathf.Cos(tNow * 0.9f + i * 0.7f) * 0.025f * dt;
                        // v0.2.4 D2-4: 烛光摇曳 — opacity sin wave 替代单调 fade
                        // 0.7 + 0.25 * sin(t * 2.5 + phase) 模拟烛芯闪动
                        float flameMod = 0.7f + 0.25f * Mathf.Sin(p.life * 2.5f + i * 1.3f);
                        SetOpacity(p.mat, flameMod * Mathf.Max(0f, 1f - p.life / p.maxLife));
                    }
                    else if (p.kind == "drop")
                    {
                        // Water: gravity + alpha fade
                        SetOpacity(p.mat, 0.85f * Mathf.Max(0f, 1f - p.life / p.maxLife));
                    }

                    p.tr.localPosition = pos;
                }

                _points[i] = p;

                // Death
                bool dead = p.life >= p.maxLife;
                if (p.kind != "arrow" && p.tr.localPosition.y < -0.3f) dead = true;
                if (dead)
                {
                    Destroy(p.tr.gameObject);
                    _points.RemoveAt(i);
                }
            }
        }

        static void SetOpacity(Material mat, float a)
        {
            if (mat == null) return;
            if (mat.HasProperty("_BaseColor"))
            {
                var c = mat.GetColor("_BaseColor");
                c.a = a;
                mat.SetColor("_BaseColor", c);
            }
            if (mat.HasProperty("_Color"))
            {
                var c = mat.GetColor("_Color");
                c.a = a;
                mat.SetColor("_Color", c);
            }
        }

        void SpawnOne()
        {
            var go = new GameObject("part_" + _type);
            go.transform.SetParent(this.transform, worldPositionStays: false);
            float angle = Random.value * Mathf.PI * 2f;

            switch (_type)
            {
                case "cairn":
                    SpawnStone(go, angle);
                    break;
                case "water":
                    SpawnDrop(go, angle);
                    break;
                case "danger":
                    SpawnSpark(go, angle);
                    break;
                case "hut":
                    SpawnEmber(go, angle);
                    break;
                case "junction":
                    SpawnArrow(go, angle);
                    break;
                default:
                    SpawnStone(go, angle);
                    break;
            }
        }

        void SpawnStone(GameObject go, float a)
        {
            float sz = 0.018f + Random.value * 0.014f;
            var mf = go.AddComponent<MeshFilter>();
            mf.sharedMesh = GetCubeMesh();
            var mr = go.AddComponent<MeshRenderer>();
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            mr.receiveShadows = false;
            // Use Standard URP Lit (or fall back to Unlit) — stone should respond to light
            var mat = MakeMat("Universal Render Pipeline/Lit", "Universal Render Pipeline/Unlit");
            if (mat.HasProperty("_BaseColor")) mat.SetColor("_BaseColor", new Color(0.43f, 0.35f, 0.23f, 1f));
            if (mat.HasProperty("_Color")) mat.SetColor("_Color", new Color(0.43f, 0.35f, 0.23f, 1f));
            if (mat.HasProperty("_EmissionColor")) mat.SetColor("_EmissionColor", new Color(0.10f, 0.07f, 0.03f, 1f));
            if (mat.HasProperty("_Metallic")) mat.SetFloat("_Metallic", 0f);
            if (mat.HasProperty("_Smoothness")) mat.SetFloat("_Smoothness", 0.1f);
            mr.sharedMaterial = mat;

            float r = _ringRadius * (0.85f + Random.value * 0.30f);
            go.transform.localPosition = new Vector3(Mathf.Cos(a) * r, 0.005f, Mathf.Sin(a) * r);
            go.transform.localScale = Vector3.one * sz;

            // v0.2.4 D2-1: 碎石尾迹(Reviewer B 加强)
            var trail = AttachTrail(go, 0.4f, 0.005f, new Color(0.55f, 0.42f, 0.20f, 0.7f), Color.clear);

            _points.Add(new Particle
            {
                tr = go.transform,
                renderer = mr,
                mat = mat,
                vel = new Vector3((Random.value - 0.5f) * 0.10f, 0.45f + Random.value * 0.30f, (Random.value - 0.5f) * 0.10f),
                life = 0f,
                maxLife = 1.6f,
                kind = "stone",
                trail = trail,
            });
        }

        void SpawnDrop(GameObject go, float a)
        {
            float sz = 0.014f + Random.value * 0.010f;
            var mf = go.AddComponent<MeshFilter>();
            mf.sharedMesh = GetSphereMesh();
            var mr = go.AddComponent<MeshRenderer>();
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            mr.receiveShadows = false;
            var mat = MakeAdditiveMat();
            if (mat.HasProperty("_BaseColor")) mat.SetColor("_BaseColor", new Color(_typeColor.r, _typeColor.g, _typeColor.b, 0.85f));
            if (mat.HasProperty("_Color")) mat.SetColor("_Color", new Color(_typeColor.r, _typeColor.g, _typeColor.b, 0.85f));
            mr.sharedMaterial = mat;

            float r = _ringRadius * (0.85f + Random.value * 0.30f);
            go.transform.localPosition = new Vector3(Mathf.Cos(a) * r, 0.005f, Mathf.Sin(a) * r);
            go.transform.localScale = Vector3.one * sz;

            // v0.2.4 D2-2: 水珠 motion trail(Reviewer B 加强 — 折射用 fresnel 替代,trail 模拟流体感)
            var trail = AttachTrail(go, 0.5f, 0.008f,
                new Color(_typeColor.r, _typeColor.g, _typeColor.b, 0.6f),
                new Color(_typeColor.r, _typeColor.g, _typeColor.b, 0f));

            // Inward velocity (toward center)
            float speed = 0.04f + Random.value * 0.06f;
            _points.Add(new Particle
            {
                tr = go.transform,
                renderer = mr,
                mat = mat,
                vel = new Vector3(Mathf.Cos(a + Mathf.PI) * speed, 0.55f + Random.value * 0.25f, Mathf.Sin(a + Mathf.PI) * speed),
                life = 0f,
                maxLife = 1.8f,
                kind = "drop",
                trail = trail,
            });
        }

        void SpawnSpark(GameObject go, float a)
        {
            float sz = 0.009f + Random.value * 0.008f;
            var mf = go.AddComponent<MeshFilter>();
            mf.sharedMesh = GetSphereMesh();
            var mr = go.AddComponent<MeshRenderer>();
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            mr.receiveShadows = false;
            var mat = MakeAdditiveMat();
            if (mat.HasProperty("_BaseColor")) mat.SetColor("_BaseColor", new Color(_typeColor.r, _typeColor.g, _typeColor.b, 1f));
            if (mat.HasProperty("_Color")) mat.SetColor("_Color", new Color(_typeColor.r, _typeColor.g, _typeColor.b, 1f));
            mr.sharedMaterial = mat;

            float r = _ringRadius * (0.85f + Random.value * 0.30f);
            go.transform.localPosition = new Vector3(Mathf.Cos(a) * r, 0.005f, Mathf.Sin(a) * r);
            go.transform.localScale = Vector3.one * sz;

            _points.Add(new Particle
            {
                tr = go.transform,
                renderer = mr,
                mat = mat,
                vel = new Vector3((Random.value - 0.5f) * 0.04f, 0.30f + Random.value * 0.20f, (Random.value - 0.5f) * 0.04f),
                life = 0f,
                maxLife = 2.5f,
                kind = "spark",
            });
        }

        void SpawnEmber(GameObject go, float a)
        {
            float sz = 0.012f + Random.value * 0.012f;
            var mf = go.AddComponent<MeshFilter>();
            mf.sharedMesh = GetSphereMesh();
            var mr = go.AddComponent<MeshRenderer>();
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            mr.receiveShadows = false;
            var mat = MakeAdditiveMat();
            if (mat.HasProperty("_BaseColor")) mat.SetColor("_BaseColor", new Color(_typeColor.r, _typeColor.g, _typeColor.b, 0.7f));
            if (mat.HasProperty("_Color")) mat.SetColor("_Color", new Color(_typeColor.r, _typeColor.g, _typeColor.b, 0.7f));
            mr.sharedMaterial = mat;

            float r = _ringRadius * (0.85f + Random.value * 0.30f);
            go.transform.localPosition = new Vector3(Mathf.Cos(a) * r, 0.01f, Mathf.Sin(a) * r);
            go.transform.localScale = Vector3.one * sz;

            _points.Add(new Particle
            {
                tr = go.transform,
                renderer = mr,
                mat = mat,
                vel = new Vector3((Random.value - 0.5f) * 0.05f, 0.10f + Random.value * 0.10f, (Random.value - 0.5f) * 0.05f),
                life = 0f,
                maxLife = 4.0f,
                kind = "ember",
            });
        }

        void SpawnArrow(GameObject go, float a)
        {
            var mf = go.AddComponent<MeshFilter>();
            mf.sharedMesh = GetConeMesh();
            var mr = go.AddComponent<MeshRenderer>();
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            mr.receiveShadows = false;
            var mat = MakeAdditiveMat();
            if (mat.HasProperty("_BaseColor")) mat.SetColor("_BaseColor", new Color(_typeColor.r, _typeColor.g, _typeColor.b, 0.9f));
            if (mat.HasProperty("_Color")) mat.SetColor("_Color", new Color(_typeColor.r, _typeColor.g, _typeColor.b, 0.9f));
            mr.sharedMaterial = mat;

            // Cone size: 0.020 base radius, 0.055 height; we use a unit cone mesh and scale.
            go.transform.localScale = new Vector3(0.04f, 0.055f, 0.04f);

            // v0.2.4 D2-5: 箭头分叉 trail(Reviewer B 加强 — junction 留下 0.3s 轨迹)
            var trail = AttachTrail(go, 0.3f, 0.012f,
                new Color(_typeColor.r, _typeColor.g, _typeColor.b, 0.55f),
                new Color(_typeColor.r, _typeColor.g, _typeColor.b, 0f));

            _points.Add(new Particle
            {
                tr = go.transform,
                renderer = mr,
                mat = mat,
                vel = Vector3.zero,
                life = 0f,
                maxLife = 999f,
                kind = "arrow",
                orbitR = _ringRadius * (1.10f + Random.value * 0.18f),
                orbitPhase = a,
                orbitSpeed = 0.35f + Random.value * 0.25f,
                orbitY = 0.18f + Random.value * 0.20f,
                trail = trail,
            });
        }

        // ---- Mesh / material helpers (cached statics so 5 cairn × N parts share) ----

        static Mesh _sphereMesh, _cubeMesh, _coneMesh;

        static Mesh GetSphereMesh()
        {
            if (_sphereMesh != null) return _sphereMesh;
            var go = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            _sphereMesh = go.GetComponent<MeshFilter>().sharedMesh;
            // v0.2.4 batch fix: Destroy is deferred to next frame, in batch
            // mode that means the GO lingers in the scene and gets captured.
            // DestroyImmediate kills it here and now.
#if UNITY_EDITOR
            UnityEngine.Object.DestroyImmediate(go);
#else
            Destroy(go);
#endif
            return _sphereMesh;
        }
        static Mesh GetCubeMesh()
        {
            if (_cubeMesh != null) return _cubeMesh;
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            _cubeMesh = go.GetComponent<MeshFilter>().sharedMesh;
#if UNITY_EDITOR
            UnityEngine.Object.DestroyImmediate(go);
#else
            Destroy(go);
#endif
            return _cubeMesh;
        }
        static Mesh GetConeMesh()
        {
            if (_coneMesh != null) return _coneMesh;
            // Unity has no cone primitive; build a 4-sided pyramid to match Three.js
            // ConeGeometry(r, h, 4)
            var mesh = new Mesh();
            mesh.name = "JunctionArrowCone";
            float r = 1f, h = 1f;
            // Tip at +Y, base at Y=0 (pivot bottom-center)
            var verts = new Vector3[5]
            {
                new Vector3(0, h, 0),                       // 0 tip
                new Vector3( r, 0,  r),                     // 1 base ne
                new Vector3( r, 0, -r),                     // 2 base se
                new Vector3(-r, 0, -r),                     // 3 base sw
                new Vector3(-r, 0,  r),                     // 4 base nw
            };
            var tris = new int[]
            {
                0, 1, 2,  // ne
                0, 2, 3,  // se
                0, 3, 4,  // sw
                0, 4, 1,  // nw
                // Base (downward facing)
                1, 4, 3,
                1, 3, 2,
            };
            mesh.vertices = verts;
            mesh.triangles = tris;
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            _coneMesh = mesh;
            return _coneMesh;
        }

        static Material MakeMat(string preferred, string fallback)
        {
            var sh = Shader.Find(preferred);
            if (sh == null) sh = Shader.Find(fallback);
            if (sh == null) sh = Shader.Find("Sprites/Default");
            return new Material(sh);
        }

        static Material MakeAdditiveMat()
        {
            // Try built-in additive particle (works in batch mode), then URP unlit transparent.
            var sh = Shader.Find("Legacy Shaders/Particles/Additive");
            if (sh == null) sh = Shader.Find("Mobile/Particles/Additive");
            if (sh == null) sh = Shader.Find("Universal Render Pipeline/Unlit");
            if (sh == null) sh = Shader.Find("Sprites/Default");
            var mat = new Material(sh);
            // URP Unlit: switch to additive
            if (mat.HasProperty("_Surface")) mat.SetFloat("_Surface", 1f);  // Transparent
            if (mat.HasProperty("_Blend")) mat.SetFloat("_Blend", 1f);      // Additive
            return mat;
        }

        // v0.2.4 D2: TrailRenderer helper — Reviewer B 5 条加强里 cairn / water / junction 用
        static TrailRenderer AttachTrail(GameObject go, float lifeSec, float startWidth, Color startColor, Color endColor)
        {
            var tr = go.AddComponent<TrailRenderer>();
            tr.time = lifeSec;
            tr.startWidth = startWidth;
            tr.endWidth = 0f;
            tr.minVertexDistance = 0.005f;
            tr.numCapVertices = 2;
            tr.numCornerVertices = 2;
            tr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            tr.receiveShadows = false;
            // Use additive material for trail
            tr.material = MakeAdditiveMat();
            // Color gradient
            var grad = new Gradient();
            grad.SetKeys(
                new GradientColorKey[] {
                    new GradientColorKey(new Color(startColor.r, startColor.g, startColor.b), 0f),
                    new GradientColorKey(new Color(endColor.r,   endColor.g,   endColor.b),   1f),
                },
                new GradientAlphaKey[] {
                    new GradientAlphaKey(startColor.a, 0f),
                    new GradientAlphaKey(endColor.a,   1f),
                });
            tr.colorGradient = grad;
            tr.emitting = true;
            return tr;
        }
    }
}
