#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;
using System.IO;

/// <summary>
/// v0.2.4 Phase 2 — Danger 阵图 + 灰烬粒子 (跟 HTML 对齐版).
///
/// 用户铁律:
///   1. 粒子从 ring **周边** spawn (HTML line 437),不是中央
///   2. 仪式 0-1.0s sweep 期间**无粒子**,1.0s 完成后才 emit
///   3. 粒子要大要明显 (cinematic 大火星),不要密小
///
/// Timeline (3 段):
///   t=0.0s..1.0s (frame 0-29): 阵图 sweep 仪式,粒子完全不显
///   t=1.0s..1.0s (frame 30):    阵图完成,粒子开始 spawn
///   t=1.0s..3.0s (frame 30-89): 持续粒子,稳定输出 (但 60 帧 budget 只能跑到 t=2.0)
///
/// 帧总数从 60 升到 90 (3.0s @ 30fps) — 看到完整 sweep + 粒子两段
///
/// Output: Logs/danger-altar-cinematic-v3/frame-{00..89}.png
/// </summary>
public static class DangerAltarCinematicV2Test
{
    const string OUT_DIR = "Logs/danger-altar-cinematic-v3";
    const int W = 1280, H = 720;
    const int FRAME_COUNT = 150;  // 5.0s @ 30fps — 给电影级慢节奏更多时间
    const float FRAME_DT = 1f / 30f;
    const float CEREMONY_DURATION = 0.85f;  // sweep 末尾就启动粒子,跟 ring 完成共振
    static readonly Color DANGER_HEX = new Color(1.00f, 0.165f, 0.10f);

    [MenuItem("Cairn/Danger Altar Cinematic v2")]
    public static void RunFromMenu() { RunHeadless(); }

    public static void RunHeadless()
    {
        Debug.Log("[DangerAltarV2] === START ===");
        try
        {
            Directory.CreateDirectory(OUT_DIR);

            var scene = UnityEditor.SceneManagement.EditorSceneManager.NewScene(
                UnityEditor.SceneManagement.NewSceneSetup.EmptyScene,
                UnityEditor.SceneManagement.NewSceneMode.Single);

            var sunGo = new GameObject("Sun");
            var sun = sunGo.AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.intensity = 0.6f;
            sun.color = new Color(1.0f, 0.85f, 0.7f);
            sunGo.transform.rotation = Quaternion.Euler(50f, -30f, 0f);

            var ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
            ground.name = "Ground";
            ground.transform.localScale = Vector3.one * 1.0f;
            var groundMat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            groundMat.color = new Color(0.10f, 0.09f, 0.10f);
            ground.GetComponent<Renderer>().material = groundMat;

            // Mote 软圆 alpha 纹理 (项目已有)
            var moteTex = AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/Textures/mote_soft.png");
            if (moteTex == null)
            {
                Debug.LogError("[DangerAltarV2] mote_soft.png not found — REQUIRED");
                if (Application.isBatchMode) EditorApplication.Exit(1);
                return;
            }
            Debug.Log($"[DangerAltarV2] Loaded mote_soft.png: {moteTex.width}x{moteTex.height}");

            // 自定义 shader (URP 6 兼容)
            var addShader = Shader.Find("Cairn/CinematicParticleAdditive");
            var alphaShader = Shader.Find("Cairn/CinematicParticleAlpha");
            if (addShader == null || alphaShader == null)
            {
                Debug.LogError($"[DangerAltarV2] Shader missing: additive={addShader!=null} alpha={alphaShader!=null}");
                if (Application.isBatchMode) EditorApplication.Exit(1);
                return;
            }

            // ─── 阵图 ───
            var ringGo = GameObject.CreatePrimitive(PrimitiveType.Quad);
            ringGo.name = "PortalRing-Danger";
            ringGo.transform.rotation = Quaternion.Euler(90, 0, 0);
            ringGo.transform.position = new Vector3(0, 0.001f, 0);
            ringGo.transform.localScale = new Vector3(2f, 2f, 1f);
            UnityEngine.Object.DestroyImmediate(ringGo.GetComponent<Collider>());
            var ringMat = new Material(Shader.Find("Cairn/PortalRingShader"));
            ringGo.GetComponent<Renderer>().material = ringMat;
            ringMat.SetColor("_BaseColor", new Color(DANGER_HEX.r * 1.5f, DANGER_HEX.g * 1.5f, DANGER_HEX.b * 1.5f, 1f));
            ringMat.SetFloat("_SweepAngle", 6.2831853f);
            ringMat.SetFloat("_Reveal", 1.0f);
            ringMat.SetFloat("_TypeIndex", 1);
            ringMat.SetFloat("_BloomBoost", 1.0f);
            ringMat.SetFloat("_CoreIntensity", 0.5f);

            // Camera (略远 + 偏俯角,看到阵图全貌 + 上方粒子柱)
            var camGo = new GameObject("MainCamera");
            camGo.tag = "MainCamera";
            var cam = camGo.AddComponent<Camera>();
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0.05f, 0.04f, 0.05f);
            cam.fieldOfView = 50f;
            cam.transform.position = new Vector3(0f, 1.5f, -2.0f);
            cam.transform.LookAt(new Vector3(0, 0.5f, 0));

            // Warmup
            var warmupRT = new RenderTexture(W, H, 24);
            cam.targetTexture = warmupRT;
            cam.Render();
            cam.targetTexture = null;
            UnityEngine.Object.DestroyImmediate(warmupRT);

            // ─── 5 层粒子 ───
            var pRoot = new GameObject("DangerParticles");
            pRoot.transform.position = new Vector3(0, 0.0f, 0);  // 紧贴 ring 地面 — 粒子从底座升起

            var ashesGo = CreateAshes(pRoot.transform, moteTex, addShader);
            var sparksGo = CreateSparks(pRoot.transform, moteTex, addShader);
            var smokeGo = CreateSmoke(pRoot.transform, moteTex, alphaShader);
            // L4 GroundHalo 删掉 — 60 个静止 billboard 在窄 donut 上从透视相机看会拼成水平亮线条,
            // 不是云团特效. 地面光晕由 PortalRingShader 的 _BloomBoost + Reveal 自己提供.
            var haloGo = (GameObject)null;
            // L5 heat haze 删掉 — HTML 没有, 之前是主 agent 自加.
            // 真"电影级"加成留给后续 RenderFeature 真 refraction 路径.
            var hazeGo = (GameObject)null;

            var ashesPS = ashesGo.GetComponent<ParticleSystem>();
            var sparksPS = sparksGo.GetComponent<ParticleSystem>();
            var smokePS = smokeGo.GetComponent<ParticleSystem>();

            // ─── timing: 0-1.0s sweep 仪式 (粒子不显), 1.0s+ 粒子 emit ───
            // 仪式期间隐藏所有粒子层,让用户先看到完整 ring 仪式
            ashesGo.SetActive(false);
            sparksGo.SetActive(false);
            smokeGo.SetActive(false);

            for (int frame = 0; frame < FRAME_COUNT; frame++)
            {
                float t = (float)frame / 30f;  // seconds elapsed

                // 仪式 sweep + reveal (Story C 做的)
                float sweepT = Mathf.Clamp01(t / 0.5f);  // 0-0.5s clockwise sweep
                float runeT;
                if (t < 0.5f) runeT = 0f;
                else if (t > 0.85f) runeT = 1f;
                else runeT = (t - 0.5f) / (0.85f - 0.5f);
                ringMat.SetFloat("_SweepAngle", sweepT * 2f * Mathf.PI);
                ringMat.SetFloat("_Reveal", runeT);

                // 仪式完成 (t >= 0.85s) 才启动粒子 — 不 pre-warm,从 0 自然涌出
                if (t >= CEREMONY_DURATION && !ashesGo.activeSelf)
                {
                    ashesGo.SetActive(true);
                    sparksGo.SetActive(true);
                    smokeGo.SetActive(true);
                    // 不 pre-warm — 让粒子从 ring 表面自然涌出, 不是凭空一片出现
                    ashesPS.Play();
                    sparksPS.Play();
                    smokePS.Play();
                }

                // 粒子 tick (仪式期间不 tick)
                if (t >= CEREMONY_DURATION)
                {
                    // emission ramp: 启动后前 0.6s 从低渐升到目标 rate, 形成"涌出"感而非"炸出"感
                    float postT = t - CEREMONY_DURATION;
                    float ramp = Mathf.Clamp01(postT / 0.6f);  // 0..1 over 0.6s
                    var ashesEmission = ashesPS.emission;
                    var sparksEmission = sparksPS.emission;
                    var smokeEmission = smokePS.emission;
                    ashesEmission.rateOverTime = Mathf.Lerp(5f, 38f, ramp);
                    sparksEmission.rateOverTime = Mathf.Lerp(3f, 22f, ramp);
                    smokeEmission.rateOverTime = Mathf.Lerp(1f, 6f, ramp);

                    ashesPS.Simulate(FRAME_DT, true, false, true);
                    sparksPS.Simulate(FRAME_DT, true, false, true);
                    smokePS.Simulate(FRAME_DT, true, false, true);
                }

                // L4 halo 已删除 (静止 billboard 拼成线条 — 不要)

                CaptureToPng(cam, Path.Combine(OUT_DIR, $"frame-{frame:D3}.png"));
            }

            string summary =
                "Danger 阵图 + 灰烬粒子 (Phase 2 v2 — 自定义 shader)\n" +
                "==================================================\n" +
                $"Frames: {FRAME_COUNT} (2.0s @ 30fps)\n" +
                "shader 路径: Cairn/CinematicParticleAdditive + Cairn/CinematicParticleAlpha\n" +
                "5 layers + danger 阵图同场景渲染.\n" +
                "Heat haze v2 是 fake (alpha + UV sin 扰动), 真 refraction 待 RenderFeature wire.\n";
            File.WriteAllText(Path.Combine(OUT_DIR, "summary.txt"), summary);

            Debug.Log("[DangerAltarV2] === DONE ===");
            if (Application.isBatchMode) EditorApplication.Exit(0);
        }
        catch (System.Exception e)
        {
            Debug.LogError($"[DangerAltarV2] FAILED: {e}");
            if (Application.isBatchMode) EditorApplication.Exit(1);
        }
    }

    static GameObject CreateAshes(Transform parent, Texture2D tex, Shader shader)
    {
        var go = new GameObject("L1_Ashes");
        go.transform.SetParent(parent, false);
        var ps = go.AddComponent<ParticleSystem>();
        var main = ps.main;
        main.duration = 2.0f; main.loop = true;
        main.startLifetime = 1.5f;
        main.startSpeed = 0.45f;
        main.startSize = new ParticleSystem.MinMaxCurve(0.04f, 0.08f);
        main.startColor = new Color(1.0f, 0.55f, 0.20f);
        main.maxParticles = 130;
        main.simulationSpace = ParticleSystemSimulationSpace.World;

        var emission = ps.emission;
        emission.rateOverTime = 60f;

        // HTML line 435-437: a = random angle, r = RING_RADIUS * (0.85..1.15)
        // → 从 ring **周边** spawn,不是中心。
        // Unity ring quad scale 2x2,RING_RADIUS shader 默认 0.85 → 真实 0.85*1.0=0.85m
        // 这里粒子在 ring world 外圈 spawn (y=0 高度,从地面起)
        var shape = ps.shape;
        shape.shapeType = ParticleSystemShapeType.Donut;  // 环带 spawn
        shape.radius = 0.85f;          // ring outer radius
        shape.donutRadius = 0.13f;     // 0.85*0.15 一圈宽度,跟 HTML 0.85R..1.15R 一致
        shape.rotation = new Vector3(90, 0, 0);  // donut 平躺在地面
        shape.position = Vector3.zero;

        var sizeOverLife = ps.sizeOverLifetime;
        sizeOverLife.enabled = true;
        var sizeCurve = new AnimationCurve();
        sizeCurve.AddKey(0f, 0.4f);
        sizeCurve.AddKey(0.3f, 1.0f);
        sizeCurve.AddKey(1f, 0.2f);
        sizeOverLife.size = new ParticleSystem.MinMaxCurve(1f, sizeCurve);

        var colorOverLife = ps.colorOverLifetime;
        colorOverLife.enabled = true;
        var grad = new Gradient();
        grad.SetKeys(
            new[] {
                new GradientColorKey(new Color(1.0f, 0.7f, 0.3f), 0f),
                new GradientColorKey(new Color(0.6f, 0.3f, 0.15f), 0.4f),
                new GradientColorKey(new Color(0.15f, 0.10f, 0.08f), 1f),
            },
            new[] {
                new GradientAlphaKey(0f, 0f),
                new GradientAlphaKey(0.95f, 0.15f),
                new GradientAlphaKey(0.6f, 0.6f),
                new GradientAlphaKey(0f, 1f),
            });
        colorOverLife.color = new ParticleSystem.MinMaxGradient(grad);

        var renderer = go.GetComponent<ParticleSystemRenderer>();
        renderer.renderMode = ParticleSystemRenderMode.Billboard;
        var mat = new Material(shader);
        mat.SetTexture("_MainTex", tex);
        mat.SetColor("_TintColor", Color.white);
        mat.SetFloat("_Intensity", 1.5f);
        renderer.material = mat;
        return go;
    }

    static GameObject CreateSparks(Transform parent, Texture2D tex, Shader shader)
    {
        var go = new GameObject("L2_Sparks");
        go.transform.SetParent(parent, false);
        var ps = go.AddComponent<ParticleSystem>();
        var main = ps.main;
        main.duration = 100f; main.loop = true;
        // 抽象意象 = 灼烧躁动云团 (上升主导, 单粒微扰, 不集体横漂)
        main.startLifetime = new ParticleSystem.MinMaxCurve(2.5f, 3.5f);
        main.startSpeed = 0.0f;
        // 大软光斑做"云团"密度感
        main.startSize = new ParticleSystem.MinMaxCurve(0.10f, 0.22f);
        main.startColor = new Color(1.0f, 0.85f, 0.45f);
        main.maxParticles = 130;
        main.simulationSpace = ParticleSystemSimulationSpace.World;

        // 持续稳定 emission
        var emission = ps.emission;
        emission.rateOverTime = 35f;

        // 火星从 ring 周边 spawn
        var shape = ps.shape;
        shape.shapeType = ParticleSystemShapeType.Donut;
        shape.radius = 0.85f;
        shape.donutRadius = 0.18f;
        shape.rotation = new Vector3(90, 0, 0);
        shape.position = Vector3.zero;

        // velocityOverLifetime: 上升主导 + 径向向外偏置 (多向外飘, 不向中心拥挤)
        var velOverLife = ps.velocityOverLifetime;
        velOverLife.enabled = true;
        velOverLife.space = ParticleSystemSimulationSpace.World;
        velOverLife.y = new ParticleSystem.MinMaxCurve(0.12f, 0.25f);
        // 径向向外: min=0.02 max=0.10 → 全部正向(向外), 没有向内飘的
        velOverLife.radial = new ParticleSystem.MinMaxCurve(0.02f, 0.10f);
        // x/z 全方向噪声留给 Noise module, 这里清零避免随机内飘
        velOverLife.x = new ParticleSystem.MinMaxCurve(0f);
        velOverLife.z = new ParticleSystem.MinMaxCurve(0f);

        // Noise: 缓慢大尺度湍流, 让单个粒子轨迹微扰但不集体方向偏移
        var noise = ps.noise;
        noise.enabled = true;
        noise.strength = 0.20f;       // 减弱
        noise.frequency = 1.2f;       // 更大尺度
        noise.scrollSpeed = 0.3f;     // 缓慢推进, 不"刷过"
        noise.damping = true;
        noise.octaveCount = 2;

        // sizeOverLifetime: 柔和呼吸 (出生小, 中段大, 消散小)
        var sizeOverLife = ps.sizeOverLifetime;
        sizeOverLife.enabled = true;
        var sizeCurve = new AnimationCurve();
        sizeCurve.AddKey(0f, 0.3f);
        sizeCurve.AddKey(0.45f, 1.0f);
        sizeCurve.AddKey(1f, 0.4f);
        sizeOverLife.size = new ParticleSystem.MinMaxCurve(1f, sizeCurve);

        var colorOverLife = ps.colorOverLifetime;
        colorOverLife.enabled = true;
        var grad = new Gradient();
        grad.SetKeys(
            new[] {
                new GradientColorKey(new Color(1.0f, 0.85f, 0.5f), 0f),
                new GradientColorKey(new Color(1.0f, 0.45f, 0.15f), 0.5f),
                new GradientColorKey(new Color(0.4f, 0.15f, 0.05f), 1.0f),
            },
            new[] {
                new GradientAlphaKey(0f, 0f),
                new GradientAlphaKey(0.85f, 0.25f),
                new GradientAlphaKey(0.55f, 0.7f),
                new GradientAlphaKey(0f, 1f),
            });
        colorOverLife.color = new ParticleSystem.MinMaxGradient(grad);

        var renderer = go.GetComponent<ParticleSystemRenderer>();
        renderer.renderMode = ParticleSystemRenderMode.Billboard;
        var mat = new Material(shader);
        mat.SetTexture("_MainTex", tex);
        mat.SetColor("_TintColor", Color.white);
        mat.SetFloat("_Intensity", 2.0f);
        renderer.material = mat;
        return go;
    }

    static GameObject CreateSmoke(Transform parent, Texture2D tex, Shader shader)
    {
        var go = new GameObject("L3_Smoke");
        go.transform.SetParent(parent, false);
        var ps = go.AddComponent<ParticleSystem>();
        var main = ps.main;
        main.duration = 2.0f; main.loop = true;
        main.startLifetime = 3.5f;
        main.startSpeed = 0.0f;
        main.startSize = new ParticleSystem.MinMaxCurve(0.25f, 0.45f);
        main.startColor = new Color(0.20f, 0.18f, 0.18f);
        main.maxParticles = 80;
        main.simulationSpace = ParticleSystemSimulationSpace.World;

        var emission = ps.emission;
        emission.rateOverTime = 10f;

        // 烟雾也从 ring 周边 spawn,但跟火星一样 (跟随火星升腾就在原位)
        var shape = ps.shape;
        shape.shapeType = ParticleSystemShapeType.Donut;
        shape.radius = 0.85f;
        shape.donutRadius = 0.13f;
        shape.rotation = new Vector3(90, 0, 0);
        shape.position = Vector3.zero;

        var velOverLife = ps.velocityOverLifetime;
        velOverLife.enabled = true;
        velOverLife.space = ParticleSystemSimulationSpace.World;
        velOverLife.y = new ParticleSystem.MinMaxCurve(0.05f, 0.12f);  // 烟雾几乎飘
        // 径向向外偏置 (烟雾也跟火星一样不向 ring 中心拥)
        velOverLife.radial = new ParticleSystem.MinMaxCurve(0.015f, 0.06f);
        velOverLife.x = new ParticleSystem.MinMaxCurve(0f);
        velOverLife.z = new ParticleSystem.MinMaxCurve(0f);

        var sizeOverLife = ps.sizeOverLifetime;
        sizeOverLife.enabled = true;
        sizeOverLife.size = new ParticleSystem.MinMaxCurve(1f, AnimationCurve.Linear(0, 0.5f, 1, 1.8f));

        var colorOverLife = ps.colorOverLifetime;
        colorOverLife.enabled = true;
        var grad = new Gradient();
        grad.SetKeys(
            new[] {
                new GradientColorKey(new Color(0.22f, 0.18f, 0.15f), 0f),
                new GradientColorKey(new Color(0.10f, 0.10f, 0.10f), 1.0f),
            },
            new[] {
                new GradientAlphaKey(0f, 0f),
                new GradientAlphaKey(0.55f, 0.3f),
                new GradientAlphaKey(0.2f, 0.85f),
                new GradientAlphaKey(0f, 1f),
            });
        colorOverLife.color = new ParticleSystem.MinMaxGradient(grad);

        var renderer = go.GetComponent<ParticleSystemRenderer>();
        renderer.renderMode = ParticleSystemRenderMode.Billboard;
        var mat = new Material(shader);
        mat.SetTexture("_MainTex", tex);
        mat.SetColor("_TintColor", Color.white);
        renderer.material = mat;
        return go;
    }

    static GameObject CreateGroundHalo(Transform parent, Texture2D tex, Shader shader)
    {
        // HTML 没有 "ground halo",但 cinematic 用 — ring 外圈 dim red glow 衬底
        // 形状改为 ring 状 (donut quad) 不是圆盘 — 跟 ring 周边粒子源对齐
        var go = new GameObject("L4_GroundHaloRing");
        go.transform.SetParent(parent, false);
        go.transform.localPosition = new Vector3(0, -0.04f, 0);

        // 用一个圆环 (donut shaped quad) — 内径 0.7 外径 1.05,刚好罩住 ring 外圈
        // 简化: 用 ParticleSystem one-shot static ring 模拟
        var ps = go.AddComponent<ParticleSystem>();
        var main = ps.main;
        main.duration = 100f; main.loop = false;
        main.startLifetime = 999f;
        main.startSpeed = 0f;
        main.startSize = 0.30f;        // 大粒子让 ring 周边真发光成一圈
        main.startColor = new Color(1f, 0.4f, 0.1f);
        main.maxParticles = 60;
        main.simulationSpace = ParticleSystemSimulationSpace.Local;

        var emission = ps.emission;
        emission.rateOverTime = 0f;
        var burst = new ParticleSystem.Burst(0f, 60);
        emission.SetBurst(0, burst);

        var shape = ps.shape;
        shape.shapeType = ParticleSystemShapeType.Donut;
        shape.radius = 0.85f;
        shape.donutRadius = 0.05f;     // 紧贴 ring 一圈窄环
        shape.rotation = new Vector3(90, 0, 0);

        var renderer = go.GetComponent<ParticleSystemRenderer>();
        renderer.renderMode = ParticleSystemRenderMode.Billboard;
        var mat = new Material(shader);
        mat.SetTexture("_MainTex", tex);
        mat.SetColor("_TintColor", new Color(1f, 0.35f, 0.10f, 0.8f));
        mat.SetFloat("_Intensity", 1.5f);
        renderer.material = mat;
        return go;
    }

    static GameObject CreateHeatHaze(Transform parent, Texture2D tex, Shader shader)
    {
        var go = GameObject.CreatePrimitive(PrimitiveType.Quad);
        go.name = "L5_HeatHaze";
        go.transform.SetParent(parent, false);
        go.transform.localPosition = new Vector3(0, 0.55f, 0f);
        go.transform.localScale = new Vector3(0.5f, 1.0f, 1f);  // tall thin
        UnityEngine.Object.DestroyImmediate(go.GetComponent<Collider>());
        var mat = new Material(shader);
        mat.SetTexture("_MainTex", tex);
        mat.SetColor("_TintColor", new Color(1f, 0.55f, 0.25f, 0.15f));
        mat.SetFloat("_Intensity", 1.0f);
        go.GetComponent<Renderer>().material = mat;
        return go;
    }

    static void CaptureToPng(Camera cam, string path)
    {
        var rt = new RenderTexture(W, H, 24);
        cam.targetTexture = rt;
        var tex = new Texture2D(W, H, TextureFormat.RGB24, false);
        cam.Render();
        RenderTexture.active = rt;
        tex.ReadPixels(new Rect(0, 0, W, H), 0, 0);
        tex.Apply();
        cam.targetTexture = null;
        RenderTexture.active = null;
        UnityEngine.Object.DestroyImmediate(rt);
        byte[] png = tex.EncodeToPNG();
        UnityEngine.Object.DestroyImmediate(tex);
        File.WriteAllBytes(path, png);
    }
}
#endif
