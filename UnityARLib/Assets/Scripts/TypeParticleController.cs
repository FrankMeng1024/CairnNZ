// Cairn AR — Type-specific particle controller (v0.2.4 Phase 2 Final)
//
// 真机视觉对齐 AllTypesCinematicTest.cs harness (用户从 GIF 验收的 5 type 视觉).
// 实现路径:Unity ParticleSystem + Billboard + 程序生成 SDF 纹理 + Additive shader
// (取代了 v0.2.4 之前 GO-per-particle + Mesh + Material 单独 spawn 的旧路径).
//
// 5 type 区分(动效完全统一,只换 SDF 纹理 + size + intensity):
//   * cairn    — 不规则 5 边形 SDF (实心), 翻滚旋转
//   * danger   — 软 mote SDF (圆形 1.6 power)
//   * water    — 水珠 + 反光高光斑 SDF, sizeMin/Max 0.16/0.26
//   * hut      — Ember Flecked 炭火床 (软圆 + hash-noise 颗粒亮斑), sizeMin/Max 0.18/0.30 (用户从 5 候选选定 v3 + 加大)
//   * junction — 锐利十字菱形 SDF
//
// 公共 API 保持兼容 (PortalSpawnerV199 + CeremonyController 调用方式不变):
//   - Configure(type, color, ringRadius)
//   - SetSpawnEnabled(bool)
//   - Clear()
//   - EditorManualTick(dt)
//
// Performance budget: 1 ParticleSystem GPU instancing × maxParticles=130 / cluster.
// 5 cluster visible = ~650 particles peak (GPU 端轻量, 远好于老路径 80 GO/cluster + GC).
//
// 资产依赖:
//   - Shader: "Cairn/CinematicParticleAdditive" (Assets/Shaders/CinematicParticleAdditive.shader, 已 link.xml preserve)
//   - 5 个 SDF 纹理: 程序生成,无外部 PNG 依赖,iOS IL2CPP / strip 安全.

using UnityEngine;

namespace Cairn.AR
{
    /// <summary>
    /// Per-type particle "soul" controller. One instance per cairn cluster.
    /// </summary>
    public class TypeParticleController : MonoBehaviour
    {
        [Header("Type")]
        [SerializeField] string _type = "cairn";  // cairn / water / danger / hut / junction
        [SerializeField] Color _typeColor = new Color(0.91f, 0.78f, 0.59f, 1f);
        [SerializeField] float _ringRadius = 0.55f;

        [Header("Behavior gates (driven by CeremonyController)")]
        [SerializeField] bool _spawnEnabled = false;

        // ════════════════════════════════════════════════════════════════════
        // 统一动效模板锁定 (跟 AllTypesCinematicTest 完全一致, 用户已 GIF 验收)
        // ════════════════════════════════════════════════════════════════════
        const float LIFETIME_MIN = 2.5f;
        const float LIFETIME_MAX = 3.5f;
        const float EMISSION_RATE_PEAK = 22f;
        const float EMISSION_RATE_INITIAL = 3f;
        const float EMISSION_RAMP_DURATION = 0.6f;
        const int MAX_PARTICLES = 130;
        const float DONUT_RADIUS = 0.85f;
        const float DONUT_TUBE_RADIUS = 0.18f;
        const float VEL_Y_MIN = 0.12f;
        const float VEL_Y_MAX = 0.25f;
        const float VEL_RADIAL_MIN = 0.02f;
        const float VEL_RADIAL_MAX = 0.10f;

        // ParticleSystem (取代老 GO-per-particle 路径)
        ParticleSystem _ps;
        ParticleSystem.MainModule _main;
        ParticleSystem.EmissionModule _emission;
        Material _matInstance;
        bool _initialized;
        float _spawnEnabledTime = -1f;  // 用于 ramp emission rate

        // ════════════════════════════════════════════════════════════════════
        // Public API (保持兼容 PortalSpawnerV199 + CeremonyController)
        // ════════════════════════════════════════════════════════════════════

        public void Configure(string type, Color color, float ringRadius = 0.55f)
        {
            bool typeChanged = (_type != type);
            _type = type;
            _typeColor = color;
            _ringRadius = ringRadius;

            if (typeChanged && _initialized)
            {
                // type 变了,重建 ParticleSystem(SDF 纹理 / size / intensity 都不一样)
                Clear();
            }
            EnsureParticleSystem();
            // 没启用 spawn 之前不显示
            if (_ps != null) _ps.gameObject.SetActive(_spawnEnabled);
        }

        public void SetSpawnEnabled(bool enabled)
        {
            _spawnEnabled = enabled;
            EnsureParticleSystem();
            if (_ps == null) return;

            if (enabled)
            {
                _spawnEnabledTime = Time.time;
                _ps.gameObject.SetActive(true);
                if (!_ps.isPlaying) _ps.Play();
                // 重置 emission 到 initial,Update 会 ramp
                var em = _ps.emission;
                em.rateOverTime = EMISSION_RATE_INITIAL;
            }
            else
            {
                // 停止新 spawn,留活粒子自然消失
                if (_ps.isPlaying) _ps.Stop(true, ParticleSystemStopBehavior.StopEmitting);
            }
        }

        public void Clear()
        {
            if (_ps != null)
            {
                _ps.Clear(true);
                Destroy(_ps.gameObject);
                _ps = null;
            }
            if (_matInstance != null)
            {
                Destroy(_matInstance);
                _matInstance = null;
            }
            _initialized = false;
            _spawnEnabledTime = -1f;
        }

        /// <summary>
        /// Editor batch capture support (legacy AllTypesCinematicTest 调用).
        /// 真机走 ParticleSystem 自带 Update,不需要这个。但保留 API 兼容性。
        /// </summary>
        public void EditorManualTick(float dt)
        {
            if (_ps != null && _spawnEnabled)
            {
                UpdateEmissionRamp();
                _ps.Simulate(dt, true, false, true);
            }
        }

        // ════════════════════════════════════════════════════════════════════
        // Lifecycle
        // ════════════════════════════════════════════════════════════════════

        void OnDestroy()
        {
            Clear();
        }

        void Update()
        {
            if (!_spawnEnabled) return;
            UpdateEmissionRamp();
        }

        void UpdateEmissionRamp()
        {
            if (_ps == null || _spawnEnabledTime < 0f) return;
            float elapsed = Time.time - _spawnEnabledTime;
            float ramp = Mathf.Clamp01(elapsed / EMISSION_RAMP_DURATION);
            var em = _ps.emission;
            em.rateOverTime = Mathf.Lerp(EMISSION_RATE_INITIAL, EMISSION_RATE_PEAK, ramp);
        }

        // ════════════════════════════════════════════════════════════════════
        // ParticleSystem 构造 (1 次, type 改变 / Clear 后重建)
        // ════════════════════════════════════════════════════════════════════

        void EnsureParticleSystem()
        {
            if (_initialized && _ps != null) return;

            var addShader = Shader.Find("Cairn/CinematicParticleAdditive");
            if (addShader == null)
            {
                Debug.LogError("[TypeParticles] Cairn/CinematicParticleAdditive shader missing — link.xml strip?");
                return;
            }

            var psGo = new GameObject($"UnifiedSparks-{_type}");
            psGo.transform.SetParent(transform, false);
            psGo.transform.localPosition = Vector3.zero;

            _ps = psGo.AddComponent<ParticleSystem>();

            // ════ Main module (5 type 完全一致,size 在 per-type 段微调) ════
            _main = _ps.main;
            _main.duration = 100f;
            _main.loop = true;
            _main.startLifetime = new ParticleSystem.MinMaxCurve(LIFETIME_MIN, LIFETIME_MAX);
            _main.startSpeed = 0f;
            _main.startColor = Color.white;
            _main.maxParticles = MAX_PARTICLES;
            _main.simulationSpace = ParticleSystemSimulationSpace.World;

            // ════ Emission ════
            _emission = _ps.emission;
            _emission.rateOverTime = EMISSION_RATE_INITIAL;

            // ════ Shape (Donut 围底座圆环) ════
            var shape = _ps.shape;
            shape.shapeType = ParticleSystemShapeType.Donut;
            shape.radius = DONUT_RADIUS * (_ringRadius / 0.55f);
            shape.donutRadius = DONUT_TUBE_RADIUS * (_ringRadius / 0.55f);
            shape.rotation = new Vector3(90, 0, 0);

            // ════ Velocity (上升 + radial 散开) ════
            var velOverLife = _ps.velocityOverLifetime;
            velOverLife.enabled = true;
            velOverLife.space = ParticleSystemSimulationSpace.World;
            velOverLife.y = new ParticleSystem.MinMaxCurve(VEL_Y_MIN, VEL_Y_MAX);
            velOverLife.radial = new ParticleSystem.MinMaxCurve(VEL_RADIAL_MIN, VEL_RADIAL_MAX);
            velOverLife.x = new ParticleSystem.MinMaxCurve(0f);
            velOverLife.z = new ParticleSystem.MinMaxCurve(0f);

            // ════ Noise (柔和扰动) ════
            var noise = _ps.noise;
            noise.enabled = true;
            noise.strength = 0.20f;
            noise.frequency = 1.2f;
            noise.scrollSpeed = 0.3f;
            noise.damping = true;
            noise.octaveCount = 2;

            // ════ Size over life (生→长→消) ════
            var sizeOverLife = _ps.sizeOverLifetime;
            sizeOverLife.enabled = true;
            var sizeCurve = new AnimationCurve();
            sizeCurve.AddKey(0f, 0.3f);
            sizeCurve.AddKey(0.45f, 1.0f);
            sizeCurve.AddKey(1f, 0.4f);
            sizeOverLife.size = new ParticleSystem.MinMaxCurve(1f, sizeCurve);

            // ════ Per-type 元素差异化 ════
            var renderer = psGo.GetComponent<ParticleSystemRenderer>();
            renderer.renderMode = ParticleSystemRenderMode.Billboard;
            // 关闭 shadow & reflection probes (避免 mobile 性能问题)
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            renderer.lightProbeUsage = UnityEngine.Rendering.LightProbeUsage.Off;
            renderer.reflectionProbeUsage = UnityEngine.Rendering.ReflectionProbeUsage.Off;

            Texture2D particleTex;
            float intensity;
            float alphaPeak;
            Color particleStartColor;
            float sizeMin, sizeMax;

            switch (_type)
            {
                case "danger":
                    particleTex = GenMoteSdf();
                    intensity = 1.2f; alphaPeak = 0.85f;
                    particleStartColor = new Color(1.0f, 0.85f, 0.5f);
                    sizeMin = 0.10f; sizeMax = 0.22f;
                    break;
                case "junction":
                    particleTex = GenJunctionDiamondSdf();
                    intensity = 1.4f; alphaPeak = 0.95f;
                    particleStartColor = new Color(0.85f, 1.0f, 0.7f);
                    sizeMin = 0.10f; sizeMax = 0.22f;
                    break;
                case "water":
                    particleTex = GenWaterDropSdf();
                    intensity = 1.5f; alphaPeak = 0.85f;
                    particleStartColor = new Color(0.7f, 0.95f, 1.0f);
                    sizeMin = 0.16f; sizeMax = 0.26f;
                    break;
                case "hut":
                    // v3 Ember Flecked 加大 (用户从 5 候选选定)
                    particleTex = GenEmberFleckedSdf();
                    intensity = 1.5f; alphaPeak = 0.92f;
                    particleStartColor = new Color(1.0f, 0.92f, 0.55f);
                    sizeMin = 0.18f; sizeMax = 0.30f;
                    break;
                case "cairn":
                default:
                    particleTex = GenCairnRockSdf();
                    intensity = 1.0f; alphaPeak = 0.95f;
                    particleStartColor = new Color(0.95f, 0.85f, 0.65f);
                    sizeMin = 0.10f; sizeMax = 0.22f;
                    // cairn 翻滚 2D 旋转
                    _main.startRotation = new ParticleSystem.MinMaxCurve(0f, Mathf.PI * 2f);
                    var rotLife = _ps.rotationOverLifetime;
                    rotLife.enabled = true;
                    rotLife.z = new ParticleSystem.MinMaxCurve(-0.5f, 0.5f);
                    break;
            }

            _main.startSize = new ParticleSystem.MinMaxCurve(sizeMin, sizeMax);

            // ════ Color over life (gradient — start tint → mid tint → fade) ════
            var colorOverLife = _ps.colorOverLifetime;
            colorOverLife.enabled = true;
            var grad = new Gradient();
            var darken = new Color(_typeColor.r * 0.4f, _typeColor.g * 0.4f, _typeColor.b * 0.4f);
            grad.SetKeys(
                new[] {
                    new GradientColorKey(particleStartColor, 0f),
                    new GradientColorKey(_typeColor, 0.5f),
                    new GradientColorKey(darken, 1.0f),
                },
                new[] {
                    new GradientAlphaKey(0f, 0f),
                    new GradientAlphaKey(alphaPeak, 0.25f),
                    new GradientAlphaKey(alphaPeak * 0.65f, 0.7f),
                    new GradientAlphaKey(0f, 1f),
                });
            colorOverLife.color = new ParticleSystem.MinMaxGradient(grad);

            // ════ Material (一份 instance, OnDestroy 会 cleanup) ════
            _matInstance = new Material(addShader);
            _matInstance.SetTexture("_MainTex", particleTex);
            _matInstance.SetColor("_TintColor", Color.white);
            _matInstance.SetFloat("_Intensity", intensity);
            renderer.material = _matInstance;

            psGo.SetActive(false);  // 等 SetSpawnEnabled(true) 才显示
            _initialized = true;
        }

        // ════════════════════════════════════════════════════════════════════
        // 程序生成 SDF 纹理 (无外部 PNG 依赖, iOS IL2CPP 安全)
        // 跟 AllTypesCinematicTest 保持完全一致(逐 pixel 对齐)
        // ════════════════════════════════════════════════════════════════════

        static Texture2D _moteSdf, _junctionDiamondSdf, _waterDropSdf, _emberFleckedSdf, _cairnRockSdf;

        static Texture2D GenMoteSdf()
        {
            if (_moteSdf != null) return _moteSdf;
            const int sz = 64;
            var tex = new Texture2D(sz, sz, TextureFormat.RGBA32, false);
            tex.filterMode = FilterMode.Bilinear;
            var pixels = new Color[sz * sz];
            float cx = sz * 0.5f, cy = sz * 0.5f;
            for (int y = 0; y < sz; y++)
            {
                for (int x = 0; x < sz; x++)
                {
                    float dx = (x - cx) / cx;
                    float dy = (y - cy) / cy;
                    float r = Mathf.Sqrt(dx * dx + dy * dy);
                    // 软圆 (mote_soft 等价): r=0 → 1.0, r=1 → 0,中间 1.6 power 锐边
                    float a = Mathf.Pow(Mathf.Clamp01(1f - r), 1.6f);
                    pixels[y * sz + x] = new Color(a, a, a, a);
                }
            }
            tex.SetPixels(pixels);
            tex.Apply();
            _moteSdf = tex;
            return tex;
        }

        static Texture2D GenJunctionDiamondSdf()
        {
            if (_junctionDiamondSdf != null) return _junctionDiamondSdf;
            const int sz = 64;
            var tex = new Texture2D(sz, sz, TextureFormat.RGBA32, false);
            tex.filterMode = FilterMode.Bilinear;
            var pixels = new Color[sz * sz];
            float cx = sz * 0.5f, cy = sz * 0.5f;
            for (int y = 0; y < sz; y++)
            {
                for (int x = 0; x < sz; x++)
                {
                    float dx = (x - cx) / cx;
                    float dy = (y - cy) / cy;
                    float r = Mathf.Abs(dx) + Mathf.Abs(dy);  // L1 norm = 菱形
                    float a = Mathf.Pow(Mathf.Clamp01(1f - r), 1.8f);
                    pixels[y * sz + x] = new Color(a, a, a, a);
                }
            }
            tex.SetPixels(pixels);
            tex.Apply();
            _junctionDiamondSdf = tex;
            return tex;
        }

        static Texture2D GenWaterDropSdf()
        {
            if (_waterDropSdf != null) return _waterDropSdf;
            const int sz = 64;
            var tex = new Texture2D(sz, sz, TextureFormat.RGBA32, false);
            tex.filterMode = FilterMode.Bilinear;
            var pixels = new Color[sz * sz];
            float cx = sz * 0.5f, cy = sz * 0.5f;
            for (int y = 0; y < sz; y++)
            {
                for (int x = 0; x < sz; x++)
                {
                    float dx = (x - cx) / cx;
                    float dy = (y - cy) / cy;
                    float r = Mathf.Sqrt(dx * dx + dy * dy);
                    // 主体软圆
                    float body = Mathf.Pow(Mathf.Clamp01(1f - r), 1.6f);
                    // 偏左上反光高光斑 (真水珠特征)
                    float hx = dx + 0.30f, hy = dy + 0.30f;
                    float hr = Mathf.Sqrt(hx * hx + hy * hy);
                    float highlight = hr < 0.25f ? Mathf.Pow(1f - hr / 0.25f, 1.3f) * 0.8f : 0f;
                    float a = Mathf.Clamp01(body * 0.65f + highlight);
                    pixels[y * sz + x] = new Color(a, a, a, a);
                }
            }
            tex.SetPixels(pixels);
            tex.Apply();
            _waterDropSdf = tex;
            return tex;
        }

        static Texture2D GenEmberFleckedSdf()
        {
            if (_emberFleckedSdf != null) return _emberFleckedSdf;
            const int sz = 64;
            var tex = new Texture2D(sz, sz, TextureFormat.RGBA32, false);
            tex.filterMode = FilterMode.Bilinear;
            var pixels = new Color[sz * sz];
            float cx = sz * 0.5f, cy = sz * 0.5f;
            for (int y = 0; y < sz; y++)
            {
                for (int x = 0; x < sz; x++)
                {
                    float dx = (x - cx) / cx;
                    float dy = (y - cy) / cy;
                    // v3 Ember Flecked 炭火床: 软圆 envelope + hash-noise 颗粒亮斑
                    float r = Mathf.Sqrt(dx * dx + dy * dy);
                    float env = Mathf.Clamp01((0.42f - r) / 0.12f);
                    float h = Mathf.Repeat(Mathf.Sin(Mathf.Floor(dx * 8f) * 12.9f + Mathf.Floor(dy * 8f) * 78.2f) * 437.5f, 1f);
                    float fleck = Mathf.SmoothStep(0.55f, 0.85f, h);
                    float a = env * (0.30f + 0.70f * fleck);
                    pixels[y * sz + x] = new Color(a, a, a, a);
                }
            }
            tex.SetPixels(pixels);
            tex.Apply();
            _emberFleckedSdf = tex;
            return tex;
        }

        static Texture2D GenCairnRockSdf()
        {
            if (_cairnRockSdf != null) return _cairnRockSdf;
            const int sz = 64;
            var tex = new Texture2D(sz, sz, TextureFormat.RGBA32, false);
            tex.filterMode = FilterMode.Bilinear;
            var pixels = new Color[sz * sz];
            float cx = sz * 0.5f, cy = sz * 0.5f;
            // 5 顶点多边形 (deterministic)
            float[] vertAngles = { -2.4f, -0.7f, 0.5f, 1.8f, 2.9f };
            float[] vertRadii  = {  0.85f, 0.95f, 0.78f, 0.92f, 0.88f };
            for (int y = 0; y < sz; y++)
            {
                for (int x = 0; x < sz; x++)
                {
                    float dx = (x - cx) / cx;
                    float dy = (y - cy) / cy;
                    float r = Mathf.Sqrt(dx * dx + dy * dy);
                    float angle = Mathf.Atan2(dy, dx);
                    float boundary = 0.85f;
                    for (int i = 0; i < 5; i++)
                    {
                        int j = (i + 1) % 5;
                        float a1 = vertAngles[i], a2 = vertAngles[j];
                        if (a2 < a1) a2 += Mathf.PI * 2f;
                        float ang = angle;
                        if (ang < a1) ang += Mathf.PI * 2f;
                        if (ang >= a1 && ang <= a2)
                        {
                            boundary = Mathf.Lerp(vertRadii[i], vertRadii[j], (ang - a1) / (a2 - a1));
                            break;
                        }
                    }
                    float aVal;
                    if (r <= boundary - 0.05f) aVal = 1.0f;        // 实心
                    else if (r <= boundary) aVal = (boundary - r) / 0.05f;  // 边缘软化
                    else aVal = 0f;
                    pixels[y * sz + x] = new Color(aVal, aVal, aVal, aVal);
                }
            }
            tex.SetPixels(pixels);
            tex.Apply();
            _cairnRockSdf = tex;
            return tex;
        }
    }
}
