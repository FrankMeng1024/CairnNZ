#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;
using System.IO;

/// <summary>
/// v0.2.4 Phase 2 — 5 type 电影粒子全集 harness (最终版).
///
/// 用户铁律 (final):
///   1. 动效完全一致 (=danger v7 用户认可基准)
///   2. 粒子元素有特色 (区分靠 mesh + 纹理 + intensity, 不靠动效)
///   3. danger 保留不动 (mote_soft.png billboard)
///   4. junction 用 SDF 十字菱形 billboard (用户之前认可)
///   5. water Sphere mesh + 高透明度 (像真水, 不像塑料)
///   6. hut 暖光柔球 (Sphere mesh + 高 intensity, 不要 cube)
///   7. cairn 不规则石块 mesh (8 顶点 random polyhedron + 翻滚)
///
/// 动效模板 (5 type 完全一致):
///   - shape Donut radius=0.85 donutRadius=0.18
///   - vy 0.12-0.25, radial 0.02-0.10
///   - Noise 0.20/1.2/0.3
///   - emission rate 22/s, ramp 3→22 over 0.6s
///   - maxParticles 130
///   - lifetime 2.5-3.5s
///   - size 0.10-0.22 (per-type 微调)
///   - 启动 t=0.85s 跟 ring 完成共振
/// </summary>
public static class AllTypesCinematicTest
{
    const string OUT_BASE = "Logs/all-types-cinematic";
    const int W = 1280, H = 720;
    const int FRAME_COUNT = 150;
    const float FRAME_DT = 1f / 30f;
    const float CEREMONY_DURATION = 0.85f;

    enum CairnType { cairn, danger, water, hut, junction }

    static readonly Color[] TYPE_COLORS = new Color[] {
        HexToColor(0x8c6a3a), // cairn   深褐
        HexToColor(0xff7866), // danger  红橙
        HexToColor(0x5fa8d8), // water   蓝
        HexToColor(0xff9d3d), // hut     暖橙
        HexToColor(0xa4d889), // junction 绿
    };

    static readonly int[] TYPE_INDEX = new int[] { 0, 1, 3, 4, 2 };

    static Color HexToColor(int hex)
    {
        return new Color(((hex >> 16) & 0xFF) / 255f, ((hex >> 8) & 0xFF) / 255f, (hex & 0xFF) / 255f);
    }

    // ════════════════════════════════════════════════════════════════════
    // Per-type mesh / texture (粒子元素差异化)
    // ════════════════════════════════════════════════════════════════════
    static Mesh _sphereMesh, _rockMesh;
    static Texture2D _junctionDiamondTex;

    static Mesh GetSphereMesh()
    {
        if (_sphereMesh != null) return _sphereMesh;
        var go = GameObject.CreatePrimitive(PrimitiveType.Sphere);
        _sphereMesh = go.GetComponent<MeshFilter>().sharedMesh;
        UnityEngine.Object.DestroyImmediate(go);
        return _sphereMesh;
    }

    // 不规则石块 mesh: 8 顶点 cube 但每顶点 random 扰动 → 真石头形状
    static Mesh GetRockMesh()
    {
        if (_rockMesh != null) return _rockMesh;
        var mesh = new Mesh { name = "Rock" };
        var verts = new System.Collections.Generic.List<Vector3>();
        var tris = new System.Collections.Generic.List<int>();
        var seed = new System.Random(42);
        Vector3[] baseVerts = {
            new Vector3(-0.5f, -0.5f, -0.5f), new Vector3( 0.5f, -0.5f, -0.5f),
            new Vector3( 0.5f, -0.5f,  0.5f), new Vector3(-0.5f, -0.5f,  0.5f),
            new Vector3(-0.5f,  0.5f, -0.5f), new Vector3( 0.5f,  0.5f, -0.5f),
            new Vector3( 0.5f,  0.5f,  0.5f), new Vector3(-0.5f,  0.5f,  0.5f),
        };
        for (int i = 0; i < 8; i++)
        {
            var v = baseVerts[i] + new Vector3(
                (float)(seed.NextDouble() - 0.5) * 0.3f,
                (float)(seed.NextDouble() - 0.5) * 0.3f,
                (float)(seed.NextDouble() - 0.5) * 0.3f);
            verts.Add(v);
        }
        int[] cubeIdx = {
            0,2,1, 0,3,2,  4,5,6, 4,6,7,
            0,1,5, 0,5,4,  2,3,7, 2,7,6,
            1,2,6, 1,6,5,  0,4,7, 0,7,3,
        };
        foreach (var idx in cubeIdx) tris.Add(idx);
        mesh.SetVertices(verts);
        mesh.SetTriangles(tris, 0);
        mesh.RecalculateNormals();
        _rockMesh = mesh;
        return mesh;
    }

    // junction: SDF 十字菱形纹理 (用户之前认可的"4 角锐利菱形"形态)
    static Texture2D GetJunctionDiamondTex()
    {
        if (_junctionDiamondTex != null) return _junctionDiamondTex;
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
                float r = Mathf.Abs(dx) + Mathf.Abs(dy);
                float a = Mathf.Pow(Mathf.Clamp01(1f - r), 1.8f);
                pixels[y * sz + x] = new Color(a, a, a, a);
            }
        }
        tex.SetPixels(pixels);
        tex.Apply();
        _junctionDiamondTex = tex;
        return tex;
    }

    [MenuItem("Cairn/All Types Cinematic")]
    public static void RunFromMenu() { RunHeadless(); }

    public static void RunHeadless()
    {
        Debug.Log("[AllTypes] === START ===");
        try
        {
            Directory.CreateDirectory(OUT_BASE);
            for (int i = 0; i < 5; i++)
            {
                var type = (CairnType)i;
                Debug.Log($"[AllTypes] === Capturing {type} ===");
                CaptureType(type);
            }
            Debug.Log("[AllTypes] === DONE ===");
            if (Application.isBatchMode) EditorApplication.Exit(0);
        }
        catch (System.Exception e)
        {
            Debug.LogError($"[AllTypes] FAILED: {e}");
            if (Application.isBatchMode) EditorApplication.Exit(1);
        }
    }

    static void CaptureType(CairnType type)
    {
        var outDir = Path.Combine(OUT_BASE, type.ToString());
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

        var moteTex = AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/Textures/mote_soft.png");
        if (moteTex == null) { Debug.LogError("[AllTypes] mote_soft.png missing"); return; }

        var addShader = Shader.Find("Cairn/CinematicParticleAdditive");
        if (addShader == null) { Debug.LogError("[AllTypes] addShader missing"); return; }

        var typeColor = TYPE_COLORS[(int)type];
        var ringGo = GameObject.CreatePrimitive(PrimitiveType.Quad);
        ringGo.name = $"PortalRing-{type}";
        ringGo.transform.rotation = Quaternion.Euler(90, 0, 0);
        ringGo.transform.position = new Vector3(0, 0.001f, 0);
        ringGo.transform.localScale = new Vector3(2f, 2f, 1f);
        UnityEngine.Object.DestroyImmediate(ringGo.GetComponent<Collider>());
        var ringMat = new Material(Shader.Find("Cairn/PortalRingShader"));
        ringGo.GetComponent<Renderer>().material = ringMat;
        ringMat.SetColor("_BaseColor", new Color(typeColor.r * 1.5f, typeColor.g * 1.5f, typeColor.b * 1.5f, 1f));
        ringMat.SetFloat("_SweepAngle", 6.2831853f);
        ringMat.SetFloat("_Reveal", 1.0f);
        ringMat.SetFloat("_TypeIndex", TYPE_INDEX[(int)type]);
        ringMat.SetFloat("_BloomBoost", 1.0f);
        ringMat.SetFloat("_CoreIntensity", 0.5f);

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

        var pRoot = new GameObject($"Particles-{type}");
        pRoot.transform.position = new Vector3(0, 0.0f, 0);

        var sparksGo = CreateUnifiedSparks(pRoot.transform, addShader, moteTex, typeColor, type);
        var sparksPS = sparksGo.GetComponent<ParticleSystem>();

        sparksGo.SetActive(false);

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

            if (t >= CEREMONY_DURATION && !sparksGo.activeSelf)
            {
                sparksGo.SetActive(true);
                sparksPS.Play();
            }

            if (t >= CEREMONY_DURATION)
            {
                float postT = t - CEREMONY_DURATION;
                float ramp = Mathf.Clamp01(postT / 0.6f);
                var emission = sparksPS.emission;
                emission.rateOverTime = Mathf.Lerp(3f, 22f, ramp);
                sparksPS.Simulate(FRAME_DT, true, false, true);
            }

            CaptureToPng(cam, Path.Combine(outDir, $"frame-{frame:D3}.png"));
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // 统一动效模板 — 5 type 用同一份代码
    // 区别只在: render mode (Billboard/Mesh) + texture + mesh + intensity + alpha
    // ════════════════════════════════════════════════════════════════════
    static GameObject CreateUnifiedSparks(Transform parent, Shader shader, Texture2D moteTex, Color tint, CairnType type)
    {
        var go = new GameObject("UnifiedSparks");
        go.transform.SetParent(parent, false);
        var ps = go.AddComponent<ParticleSystem>();
        var main = ps.main;
        main.duration = 100f; main.loop = true;
        // ════ 动效统一锁定 ════
        main.startLifetime = new ParticleSystem.MinMaxCurve(2.5f, 3.5f);
        main.startSpeed = 0.0f;
        main.startColor = Color.white;
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

        // ════ Per-type 元素差异化 (动效统一前提下唯一变化点) ════
        var renderer = go.GetComponent<ParticleSystemRenderer>();
        Texture2D particleTex = moteTex;
        float intensity = 1.2f;
        float alphaPeak = 0.85f;
        Color particleStartColor = new Color(1.0f, 0.85f, 0.5f);
        float sizeMin = 0.10f, sizeMax = 0.22f;

        switch (type)
        {
            case CairnType.danger:
                // =v7 用户认可基准: Billboard mote_soft 火星
                renderer.renderMode = ParticleSystemRenderMode.Billboard;
                particleTex = moteTex;
                intensity = 1.2f; alphaPeak = 0.85f;
                particleStartColor = new Color(1.0f, 0.85f, 0.5f);
                break;

            case CairnType.junction:
                // 用户认可的锐利十字菱形 (Billboard + SDF diamond texture)
                renderer.renderMode = ParticleSystemRenderMode.Billboard;
                particleTex = GetJunctionDiamondTex();
                intensity = 1.4f; alphaPeak = 0.95f;
                particleStartColor = new Color(0.85f, 1.0f, 0.7f);
                break;

            case CairnType.water:
                // Sphere mesh + 高 intensity / 低 alpha → 真水透明发光
                renderer.renderMode = ParticleSystemRenderMode.Mesh;
                renderer.mesh = GetSphereMesh();
                particleTex = moteTex;  // mesh 也 sample texture 但 sphere 顶点 UV 是球面
                intensity = 2.0f;       // 高 intensity 让 additive 透出"水内部发光"
                alphaPeak = 0.40f;      // 低 alpha → 真透明感
                particleStartColor = new Color(0.7f, 0.95f, 1.0f);
                sizeMin = 0.13f; sizeMax = 0.25f;
                break;

            case CairnType.hut:
                // 暖光柔球 (Sphere mesh, 高 intensity 暖光)
                renderer.renderMode = ParticleSystemRenderMode.Mesh;
                renderer.mesh = GetSphereMesh();
                particleTex = moteTex;
                intensity = 1.8f;       // 强暖光
                alphaPeak = 0.80f;
                particleStartColor = new Color(1.0f, 0.92f, 0.6f);
                sizeMin = 0.13f; sizeMax = 0.26f;
                break;

            case CairnType.cairn:
                // 不规则石块 mesh + 翻滚
                renderer.renderMode = ParticleSystemRenderMode.Mesh;
                renderer.mesh = GetRockMesh();
                particleTex = moteTex;
                intensity = 0.85f;
                alphaPeak = 0.95f;
                particleStartColor = new Color(0.95f, 0.85f, 0.65f);
                main.startRotation3D = true;
                main.startRotationX = new ParticleSystem.MinMaxCurve(0f, Mathf.PI * 2f);
                main.startRotationY = new ParticleSystem.MinMaxCurve(0f, Mathf.PI * 2f);
                main.startRotationZ = new ParticleSystem.MinMaxCurve(0f, Mathf.PI * 2f);
                var rotLife = ps.rotationOverLifetime;
                rotLife.enabled = true;
                rotLife.separateAxes = true;
                rotLife.x = new ParticleSystem.MinMaxCurve(-0.4f, 0.4f);
                rotLife.y = new ParticleSystem.MinMaxCurve(-0.4f, 0.4f);
                rotLife.z = new ParticleSystem.MinMaxCurve(-0.4f, 0.4f);
                break;
        }

        main.startSize = new ParticleSystem.MinMaxCurve(sizeMin, sizeMax);

        var colorOverLife = ps.colorOverLifetime;
        colorOverLife.enabled = true;
        var grad = new Gradient();
        var darken = new Color(tint.r * 0.4f, tint.g * 0.4f, tint.b * 0.4f);
        grad.SetKeys(
            new[] {
                new GradientColorKey(particleStartColor, 0f),
                new GradientColorKey(tint, 0.5f),
                new GradientColorKey(darken, 1.0f),
            },
            new[] {
                new GradientAlphaKey(0f, 0f),
                new GradientAlphaKey(alphaPeak, 0.25f),
                new GradientAlphaKey(alphaPeak * 0.65f, 0.7f),
                new GradientAlphaKey(0f, 1f),
            });
        colorOverLife.color = new ParticleSystem.MinMaxGradient(grad);

        var mat = new Material(shader);
        mat.SetTexture("_MainTex", particleTex);
        mat.SetColor("_TintColor", Color.white);
        mat.SetFloat("_Intensity", intensity);
        renderer.material = mat;
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
