#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;
using System.IO;

/// <summary>
/// Hut 5 候选版本 capture harness.
/// 5 个独立 SDF 纹理候选, 都用 hut v7 模板动效 (跟 danger 一致).
///
/// Output: Logs/hut-candidates/v{1-5}/frame-NNN.png
///   v1: Smoke Plume   炊烟柱 (上窄下宽 + wispy)
///   v2: Woven Hearth  编织温暖 (方形 + cross-hatch lattice)
///   v3: Ember Flecked 炭火床 (软圆 + 颗粒亮斑)
///   v4: Brazier       火盆 (底横条 + 上火舌)
///   v5: Spiral Curl   暖光涡 (单旋臂螺旋)
/// </summary>
public static class HutCandidatesTest
{
    const string OUT_BASE = "Logs/hut-candidates";
    const int W = 1280, H = 720;
    const int FRAME_COUNT = 150;
    const float FRAME_DT = 1f / 30f;
    const float CEREMONY_DURATION = 0.85f;

    static readonly Color HUT_COLOR = HexToColor(0xff9d3d);

    static Color HexToColor(int hex)
    {
        return new Color(((hex >> 16) & 0xFF) / 255f, ((hex >> 8) & 0xFF) / 255f, (hex & 0xFF) / 255f);
    }

    [MenuItem("Cairn/Hut Candidates 5")]
    public static void RunFromMenu() { RunHeadless(); }

    public static void RunHeadless()
    {
        Debug.Log("[HutCands] === START ===");
        try
        {
            Directory.CreateDirectory(OUT_BASE);
            for (int v = 1; v <= 5; v++)
            {
                Debug.Log($"[HutCands] === Capturing v{v} ===");
                CaptureVariant(v);
            }
            Debug.Log("[HutCands] === DONE ===");
            if (Application.isBatchMode) EditorApplication.Exit(0);
        }
        catch (System.Exception e)
        {
            Debug.LogError($"[HutCands] FAILED: {e}");
            if (Application.isBatchMode) EditorApplication.Exit(1);
        }
    }

    static void CaptureVariant(int variant)
    {
        var outDir = Path.Combine(OUT_BASE, $"v{variant}");
        Directory.CreateDirectory(outDir);

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

        var addShader = Shader.Find("Cairn/CinematicParticleAdditive");
        if (addShader == null) { Debug.LogError("addShader missing"); return; }

        var particleTex = GenerateVariantTex(variant);

        // Ring (PortalRingShader hut TypeIndex=4)
        var ringGo = GameObject.CreatePrimitive(PrimitiveType.Quad);
        ringGo.name = $"Ring-v{variant}";
        ringGo.transform.rotation = Quaternion.Euler(90, 0, 0);
        ringGo.transform.position = new Vector3(0, 0.001f, 0);
        ringGo.transform.localScale = new Vector3(2f, 2f, 1f);
        UnityEngine.Object.DestroyImmediate(ringGo.GetComponent<Collider>());
        var ringMat = new Material(Shader.Find("Cairn/PortalRingShader"));
        ringGo.GetComponent<Renderer>().material = ringMat;
        ringMat.SetColor("_BaseColor", new Color(HUT_COLOR.r * 1.5f, HUT_COLOR.g * 1.5f, HUT_COLOR.b * 1.5f, 1f));
        ringMat.SetFloat("_SweepAngle", 6.2831853f);
        ringMat.SetFloat("_Reveal", 1.0f);
        ringMat.SetFloat("_TypeIndex", 4);
        ringMat.SetFloat("_BloomBoost", 1.0f);
        ringMat.SetFloat("_CoreIntensity", 0.5f);

        // Camera
        var camGo = new GameObject("MainCamera");
        camGo.tag = "MainCamera";
        var cam = camGo.AddComponent<Camera>();
        cam.clearFlags = CameraClearFlags.SolidColor;
        cam.backgroundColor = new Color(0.05f, 0.04f, 0.05f);
        cam.fieldOfView = 50f;
        cam.transform.position = new Vector3(0f, 1.5f, -2.0f);
        cam.transform.LookAt(new Vector3(0, 0.5f, 0));

        var warmupRT = new RenderTexture(W, H, 24);
        cam.targetTexture = warmupRT;
        cam.Render();
        cam.targetTexture = null;
        UnityEngine.Object.DestroyImmediate(warmupRT);

        // Particle system (v7 模板锁定)
        var pRoot = new GameObject($"Particles-v{variant}");
        pRoot.transform.position = Vector3.zero;
        var ps = pRoot.AddComponent<ParticleSystem>();
        var main = ps.main;
        main.duration = 100f; main.loop = true;
        main.startLifetime = new ParticleSystem.MinMaxCurve(2.5f, 3.5f);
        main.startSpeed = 0.0f;
        main.startSize = new ParticleSystem.MinMaxCurve(0.13f, 0.22f);
        main.startColor = new Color(1.0f, 0.92f, 0.55f);
        main.maxParticles = 130;
        main.simulationSpace = ParticleSystemSimulationSpace.World;

        var emission = ps.emission;
        emission.rateOverTime = 22f;

        var shape = ps.shape;
        shape.shapeType = ParticleSystemShapeType.Donut;
        shape.radius = 0.85f;
        shape.donutRadius = 0.18f;
        shape.rotation = new Vector3(90, 0, 0);

        var velOverLife = ps.velocityOverLifetime;
        velOverLife.enabled = true;
        velOverLife.space = ParticleSystemSimulationSpace.World;
        velOverLife.y = new ParticleSystem.MinMaxCurve(0.12f, 0.25f);
        velOverLife.radial = new ParticleSystem.MinMaxCurve(0.02f, 0.10f);
        velOverLife.x = new ParticleSystem.MinMaxCurve(0f);
        velOverLife.z = new ParticleSystem.MinMaxCurve(0f);

        var noise = ps.noise;
        noise.enabled = true;
        noise.strength = 0.20f;
        noise.frequency = 1.2f;
        noise.scrollSpeed = 0.3f;
        noise.damping = true;
        noise.octaveCount = 2;

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
        var darken = new Color(HUT_COLOR.r * 0.4f, HUT_COLOR.g * 0.4f, HUT_COLOR.b * 0.4f);
        grad.SetKeys(
            new[] {
                new GradientColorKey(new Color(1.0f, 0.92f, 0.55f), 0f),
                new GradientColorKey(HUT_COLOR, 0.5f),
                new GradientColorKey(darken, 1.0f),
            },
            new[] {
                new GradientAlphaKey(0f, 0f),
                new GradientAlphaKey(0.92f, 0.25f),
                new GradientAlphaKey(0.60f, 0.7f),
                new GradientAlphaKey(0f, 1f),
            });
        colorOverLife.color = new ParticleSystem.MinMaxGradient(grad);

        var renderer = pRoot.GetComponent<ParticleSystemRenderer>();
        renderer.renderMode = ParticleSystemRenderMode.Billboard;
        var mat = new Material(addShader);
        mat.SetTexture("_MainTex", particleTex);
        mat.SetColor("_TintColor", Color.white);
        mat.SetFloat("_Intensity", 1.5f);
        renderer.material = mat;

        pRoot.SetActive(false);
        bool started = false;

        for (int frame = 0; frame < FRAME_COUNT; frame++)
        {
            float t = (float)frame / 30f;

            float sweepT = Mathf.Clamp01(t / 0.5f);
            float runeT;
            if (t < 0.5f) runeT = 0f;
            else if (t > 0.85f) runeT = 1f;
            else runeT = (t - 0.5f) / (0.85f - 0.5f);
            ringMat.SetFloat("_SweepAngle", sweepT * 2f * Mathf.PI);
            ringMat.SetFloat("_Reveal", runeT);

            if (t >= CEREMONY_DURATION && !started)
            {
                pRoot.SetActive(true);
                ps.Play();
                started = true;
            }

            if (t >= CEREMONY_DURATION)
            {
                float postT = t - CEREMONY_DURATION;
                float ramp = Mathf.Clamp01(postT / 0.6f);
                emission.rateOverTime = Mathf.Lerp(3f, 22f, ramp);
                ps.Simulate(FRAME_DT, true, false, true);
            }

            CaptureToPng(cam, Path.Combine(outDir, $"frame-{frame:D3}.png"));
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // 5 个候选纹理 (每个一个 SDF 思路)
    // ════════════════════════════════════════════════════════════════════
    static Texture2D GenerateVariantTex(int v)
    {
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
                float a = 0f;

                switch (v)
                {
                    case 1:
                    {
                        // Smoke Plume 炊烟柱: 上窄下宽 + wispy
                        float widthAtY = Mathf.Lerp(0.12f, 0.35f, (dy + 1f) * 0.5f);
                        float envX = Mathf.Clamp01((widthAtY - Mathf.Abs(dx)) / (widthAtY * 0.4f));
                        float envY = Mathf.Clamp01((0.50f - Mathf.Abs(dy)) / 0.10f);
                        float env = envX * envY;
                        float wisp = 0.7f + 0.3f * Mathf.Sin(dy * 9.0f + dx * 15.0f);
                        a = Mathf.Clamp01(env * wisp);
                        break;
                    }
                    case 2:
                    {
                        // Woven Hearth 编织温暖: 软方形 + cross-hatch
                        float maxAxis = Mathf.Max(Mathf.Abs(dx), Mathf.Abs(dy));
                        float mask = Mathf.Clamp01((0.42f - maxAxis) / 0.12f);
                        float horiz = 0.5f + 0.5f * Mathf.Sin(dy * 19.0f + 1.7f);
                        float vert = 0.5f + 0.5f * Mathf.Sin(dx * 19.0f);
                        float weave = horiz * 0.55f + vert * 0.55f - horiz * vert * 0.20f;
                        a = mask * (0.35f + 0.65f * weave);
                        break;
                    }
                    case 3:
                    {
                        // Ember Flecked 炭火床: 软圆 + 颗粒亮斑 (hash noise)
                        float r = Mathf.Sqrt(dx * dx + dy * dy);
                        float env = Mathf.Clamp01((0.42f - r) / 0.12f);
                        // hash noise
                        float h = Mathf.Repeat(Mathf.Sin(Mathf.Floor(dx * 8f) * 12.9f + Mathf.Floor(dy * 8f) * 78.2f) * 437.5f, 1f);
                        float fleck = Mathf.SmoothStep(0.55f, 0.85f, h);
                        a = env * (0.30f + 0.70f * fleck);
                        break;
                    }
                    case 4:
                    {
                        // Brazier 火盆: 底部横条 + 上方火舌
                        // 底部横条 (dy in [-0.40, -0.25], |dx| < 0.30)
                        float baseBar = 0f;
                        if (dy >= -0.40f && dy <= -0.25f && Mathf.Abs(dx) < 0.30f)
                        {
                            float bx = (0.30f - Mathf.Abs(dx)) / 0.30f;
                            float by = 1f - Mathf.Abs((dy + 0.325f) / 0.075f);
                            baseBar = Mathf.Clamp01(bx * by) * 0.9f;
                        }
                        // 上方 3 火舌 (中央大, 左右小, dy in [-0.20, 0.50])
                        float tongues = 0f;
                        if (dy >= -0.20f && dy <= 0.50f)
                        {
                            float tongueY = (dy + 0.20f) / 0.70f;  // 0..1
                            // 中央火舌
                            float midW = 0.15f * (1f - tongueY);
                            if (Mathf.Abs(dx) < midW) tongues = Mathf.Max(tongues, (1f - tongueY) * 0.85f);
                            // 左火舌 (dx 中心 -0.20)
                            float leftW = 0.10f * (1f - tongueY);
                            if (Mathf.Abs(dx + 0.20f) < leftW && tongueY < 0.7f) tongues = Mathf.Max(tongues, (1f - tongueY / 0.7f) * 0.7f);
                            // 右火舌 (dx 中心 0.20)
                            if (Mathf.Abs(dx - 0.20f) < leftW && tongueY < 0.7f) tongues = Mathf.Max(tongues, (1f - tongueY / 0.7f) * 0.7f);
                        }
                        a = Mathf.Max(baseBar, tongues);
                        break;
                    }
                    case 5:
                    {
                        // Spiral Curl 暖光涡: log-spiral 单旋臂
                        float r = Mathf.Sqrt(dx * dx + dy * dy);
                        float theta = Mathf.Atan2(dy, dx);
                        float arm = 0.5f + 0.5f * Mathf.Cos(theta * 1.0f + Mathf.Log(r + 0.05f) * 5.0f);
                        float env = Mathf.Clamp01((0.45f - r) / 0.25f);
                        a = env * Mathf.Pow(arm, 1.5f);
                        break;
                    }
                }
                pixels[y * sz + x] = new Color(a, a, a, a);
            }
        }
        tex.SetPixels(pixels);
        tex.Apply();
        return tex;
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
