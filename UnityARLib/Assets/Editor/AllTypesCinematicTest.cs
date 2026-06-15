#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;
using System.Collections.Generic;
using System.IO;

/// <summary>
/// v0.2.4 Phase 2 — 5 type 抽象意象电影粒子全集 harness (HTML 基准对齐版).
///
/// 真实参照: design_v2026-06_variant_C_3D.html line 433-505 spawnOne() 真 spec
///
/// 5 type HTML spec:
///   cairn    : Box 0.018-0.032 棕 0xb89968, vy 0.45-0.75 重力下落, life 1.6s, rate 6/s — kind=stone "蹦起"
///   water    : Sphere 0.014-0.024 蓝 0x5fa8d8 additive, vy 0.55-0.80, vx/vz=cos(a+π)*0.04-0.10 内向 drift, life 1.8s, rate 14/s — kind=drop
///   danger   : Sphere 0.009-0.017 红 0xff7866 additive, vy 0.30-0.50, ±0.04 微散, life 2.5s, rate 16/s — kind=spark
///   hut      : Sphere 0.012-0.024 黄 0xe8c47a additive, vy 0.10-0.20, ±0.05 微散, life 4.0s, rate 4/s — kind=ember
///   junction : 6 个 Cone 0.020x0.055 绿 0xa4d889 additive, orbitR=1.10-1.28*RING, orbitY=0.18-0.38, 永生绕 ring 旋转 — kind=arrow
///
/// 5 type 视觉独立性 (颜色遮掉也能区分):
///   cairn   = 立方块 + 重力下落 (唯一 Box 几何 + 唯一下落)
///   water   = 蓝球 + 上升内聚 (vx 内向是 water 标志)
///   danger  = 小红球 + 慢升 (粒径最小 + 寿命最长 spark)
///   hut     = 大暖球 + 极慢升 (vy 最慢 + life 最长 4s)
///   junction= Cone 箭头 + 绕 ring 永生旋转 (唯一非粒子, 唯一 orbital)
///
/// Camera 跟 HTML 对齐: position(3.2, 2.0, 3.2), lookAt(0, 1.0, 0). FOV 60.
/// Background: HTML 是 0xE8DCC4 NZ 晨曦, Unity 复刻.
/// </summary>
public static class AllTypesCinematicTest
{
    const string OUT_BASE = "Logs/all-types-cinematic";
    const int W = 1280, H = 720;
    const int FRAME_COUNT = 150;
    const float FRAME_DT = 1f / 30f;
    const float CEREMONY_DURATION = 0.85f;
    const float RING_RADIUS = 0.85f;  // Unity ring quad scale=2 → mesh radius 1.0,但视觉 radius 接近 0.85 (PortalRingShader 内部)

    enum CairnType { cairn, danger, water, hut, junction }

    // Per-type 配色对齐 HTML line 80-86
    static readonly Color[] TYPE_COLORS = new Color[] {
        HexToColor(0xb89968), // cairn
        HexToColor(0xff7866), // danger
        HexToColor(0x5fa8d8), // water
        HexToColor(0xe8c47a), // hut
        HexToColor(0xa4d889), // junction
    };

    // PortalRingShader _TypeIndex 0=cairn 1=danger 2=junction 3=water 4=hut
    // enum 顺序: 0=cairn 1=danger 2=water 3=hut 4=junction → 映射:
    static readonly int[] TYPE_INDEX = new int[] { 0, 1, 3, 4, 2 };

    static Color HexToColor(int hex)
    {
        return new Color(
            ((hex >> 16) & 0xFF) / 255f,
            ((hex >> 8) & 0xFF) / 255f,
            (hex & 0xFF) / 255f);
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

        // Sun — HTML 晨曦 (line 109-112)
        var sunGo = new GameObject("Sun");
        var sun = sunGo.AddComponent<Light>();
        sun.type = LightType.Directional;
        sun.intensity = 0.7f;
        sun.color = HexToColor(0xFFE9C0);  // HTML directional
        sunGo.transform.position = new Vector3(3, 6, 2);
        sunGo.transform.LookAt(Vector3.zero);

        // Ambient — HTML 强 ambient (line 109)
        RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
        RenderSettings.ambientLight = HexToColor(0xD8C8A4);
        RenderSettings.ambientIntensity = 1.0f;

        // Ground — HTML 晨曦色 (line 117)
        var ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
        ground.name = "Ground";
        ground.transform.localScale = Vector3.one * 8.0f;  // 大平面
        var groundMat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
        groundMat.color = HexToColor(0xD8C8A4);
        ground.GetComponent<Renderer>().material = groundMat;

        var moteTex = AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/Textures/mote_soft.png");
        if (moteTex == null) { Debug.LogError("[AllTypes] mote_soft.png missing"); return; }

        var addShader = Shader.Find("Cairn/CinematicParticleAdditive");
        var alphaShader = Shader.Find("Cairn/CinematicParticleAlpha");
        if (addShader == null || alphaShader == null) { Debug.LogError("[AllTypes] shaders missing"); return; }

        // ─── 阵图 (per-type 配色) ───
        var typeColor = TYPE_COLORS[(int)type];
        var ringGo = GameObject.CreatePrimitive(PrimitiveType.Quad);
        ringGo.name = $"PortalRing-{type}";
        ringGo.transform.rotation = Quaternion.Euler(90, 0, 0);
        ringGo.transform.position = new Vector3(0, 0.001f, 0);
        ringGo.transform.localScale = new Vector3(2f * RING_RADIUS / 0.85f, 2f * RING_RADIUS / 0.85f, 1f);
        UnityEngine.Object.DestroyImmediate(ringGo.GetComponent<Collider>());
        var ringMat = new Material(Shader.Find("Cairn/PortalRingShader"));
        ringGo.GetComponent<Renderer>().material = ringMat;
        ringMat.SetColor("_BaseColor", typeColor);
        ringMat.SetFloat("_SweepAngle", 6.2831853f);
        ringMat.SetFloat("_Reveal", 1.0f);
        ringMat.SetFloat("_TypeIndex", TYPE_INDEX[(int)type]);
        ringMat.SetFloat("_BloomBoost", 1.2f);
        ringMat.SetFloat("_CoreIntensity", 0.6f);

        // Camera — 比 HTML 略近以便单图看清粒子细节, 角度跟 HTML 一致
        var camGo = new GameObject("MainCamera");
        camGo.tag = "MainCamera";
        var cam = camGo.AddComponent<Camera>();
        cam.clearFlags = CameraClearFlags.SolidColor;
        cam.backgroundColor = HexToColor(0xE8DCC4);  // HTML NZ 晨曦
        cam.fieldOfView = 50f;
        cam.transform.position = new Vector3(1.6f, 1.2f, 1.6f);
        cam.transform.LookAt(new Vector3(0, 0.4f, 0));

        var warmupRT = new RenderTexture(W, H, 24);
        cam.targetTexture = warmupRT;
        cam.Render();
        cam.targetTexture = null;
        UnityEngine.Object.DestroyImmediate(warmupRT);

        // ─── per-type 粒子 spawn pipeline (HTML 真实 rate 驱动) ───
        var pRoot = new GameObject($"Particles-{type}");
        var emitter = new TypeEmitter(type, pRoot.transform, addShader, alphaShader, moteTex, typeColor);

        // 仪式期间 hide
        pRoot.SetActive(false);
        bool started = false;

        for (int frame = 0; frame < FRAME_COUNT; frame++)
        {
            float t = (float)frame / 30f;

            // ring sweep + reveal
            float sweepT = Mathf.Clamp01(t / 0.5f);
            float runeT;
            if (t < 0.5f) runeT = 0f;
            else if (t > 0.85f) runeT = 1f;
            else runeT = (t - 0.5f) / (0.85f - 0.5f);
            ringMat.SetFloat("_SweepAngle", sweepT * 2f * Mathf.PI);
            ringMat.SetFloat("_Reveal", runeT);

            // 启动粒子 — emission ramp 渐入 (反"凭空")
            if (t >= CEREMONY_DURATION && !started)
            {
                pRoot.SetActive(true);
                started = true;
            }

            if (started)
            {
                float postT = t - CEREMONY_DURATION;
                float ramp = Mathf.Clamp01(postT / 0.5f);  // 前 0.5s 渐入
                emitter.Update(FRAME_DT, ramp);
            }

            CaptureToPng(cam, Path.Combine(outDir, $"frame-{frame:D3}.png"));
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // TypeEmitter — 严格对齐 HTML spawnOne() spec, 不依赖 ParticleSystem
    // ════════════════════════════════════════════════════════════════════
    class Particle
    {
        public GameObject go;
        public Vector3 vel;
        public float life;
        public float maxLife;
        public string kind;
        // junction-specific orbital
        public float orbitR, orbitPhase, orbitSpeed, orbitY;
    }

    class TypeEmitter
    {
        readonly CairnType type;
        readonly Transform parent;
        readonly Shader addShader;
        readonly Shader alphaShader;
        readonly Texture2D tex;
        readonly Color color;
        readonly List<Particle> particles = new List<Particle>();
        float spawnAccum = 0f;

        public TypeEmitter(CairnType t, Transform p, Shader sh_add, Shader sh_alpha, Texture2D tx, Color col)
        {
            type = t; parent = p; addShader = sh_add; alphaShader = sh_alpha; tex = tx; color = col;
        }

        public void Update(float dt, float ramp)
        {
            // HTML rates (line 511): cairn 6, water 14, danger 16, hut 4, junction 0 (维持 6 个)
            float baseRate = 0f;
            switch (type)
            {
                case CairnType.cairn: baseRate = 6f; break;
                case CairnType.water: baseRate = 14f; break;
                case CairnType.danger: baseRate = 16f; break;
                case CairnType.hut: baseRate = 4f; break;
                case CairnType.junction: baseRate = 0f; break;
            }
            float rate = baseRate * ramp;
            spawnAccum += dt * rate;
            while (spawnAccum >= 1f) { spawnAccum -= 1f; SpawnOne(); }

            // junction maintain 6 arrows (line 516-518)
            if (type == CairnType.junction)
            {
                int arrows = particles.Count;
                for (int i = arrows; i < 6; i++) SpawnOne();
            }

            // simulate
            for (int i = particles.Count - 1; i >= 0; i--)
            {
                var p = particles[i];
                p.life += dt;
                if (p.kind == "arrow")
                {
                    // junction orbit (HTML line 530-540 ish — 这里实现 orbital 真公式)
                    p.orbitPhase += p.orbitSpeed * dt;
                    var pos = new Vector3(
                        Mathf.Cos(p.orbitPhase) * p.orbitR,
                        p.orbitY,
                        Mathf.Sin(p.orbitPhase) * p.orbitR);
                    p.go.transform.position = pos;
                    // arrow 朝 orbit 切线方向 (沿运动轨迹)
                    var tangent = new Vector3(-Mathf.Sin(p.orbitPhase), 0, Mathf.Cos(p.orbitPhase));
                    p.go.transform.rotation = Quaternion.LookRotation(tangent, Vector3.up) * Quaternion.Euler(90, 0, 0);
                }
                else if (p.kind == "stone")
                {
                    // cairn: 重力 (HTML line 524-528 推测)
                    p.vel.y -= 0.8f * dt;  // gravity
                    p.go.transform.position += p.vel * dt;
                    if (p.go.transform.position.y < 0.005f) { p.go.transform.position = new Vector3(p.go.transform.position.x, 0.005f, p.go.transform.position.z); p.vel.y = 0f; }
                    p.go.transform.Rotate(p.life * 100f * dt, p.life * 80f * dt, 0);  // 自旋
                }
                else
                {
                    // 普通: 直接位移
                    p.go.transform.position += p.vel * dt;
                }

                // alpha fade by life
                float lifeRatio = p.life / p.maxLife;
                if (p.life >= p.maxLife)
                {
                    UnityEngine.Object.DestroyImmediate(p.go);
                    particles.RemoveAt(i);
                    continue;
                }
                // alpha curve
                var renderer = p.go.GetComponent<Renderer>();
                if (renderer != null && renderer.sharedMaterial != null && p.kind != "arrow")
                {
                    float alpha = 1f - lifeRatio;
                    var mat = renderer.sharedMaterial;
                    if (mat.HasProperty("_TintColor"))
                    {
                        var c = mat.GetColor("_TintColor");
                        c.a = alpha;
                        mat.SetColor("_TintColor", c);
                    }
                }
            }
        }

        void SpawnOne()
        {
            // HTML line 435-437: a = random angle, r = RING_RADIUS * (0.85..1.15)
            float a = Random.value * Mathf.PI * 2f;
            float r = RING_RADIUS * (0.85f + Random.value * 0.30f);
            float x0 = Mathf.Cos(a) * r;
            float z0 = Mathf.Sin(a) * r;
            float y0 = 0.005f;
            Vector3 vel = Vector3.zero;
            float maxLife = 1.0f;
            string kind = "";
            GameObject go = null;
            Material mat;

            switch (type)
            {
                case CairnType.cairn:
                {
                    // HTML line 439-451: Box 0.018-0.032 棕 emissive, vy 0.45-0.75 蹦起+重力, life 1.6
                    float sz = 0.018f + Random.value * 0.014f;
                    go = GameObject.CreatePrimitive(PrimitiveType.Cube);
                    go.transform.localScale = Vector3.one * sz;
                    UnityEngine.Object.DestroyImmediate(go.GetComponent<Collider>());
                    var litMat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
                    litMat.color = HexToColor(0x6e5a3a);
                    if (litMat.HasProperty("_EmissionColor")) {
                        litMat.EnableKeyword("_EMISSION");
                        litMat.SetColor("_EmissionColor", HexToColor(0x1a1208) * 0.4f);
                    }
                    go.GetComponent<Renderer>().material = litMat;
                    vel = new Vector3((Random.value - 0.5f) * 0.10f, 0.45f + Random.value * 0.30f, (Random.value - 0.5f) * 0.10f);
                    maxLife = 1.6f;
                    kind = "stone";
                    break;
                }
                case CairnType.water:
                {
                    // HTML line 452-464: Sphere 0.014-0.024 蓝 additive, vy 0.55-0.80, vx/vz cos(a+π) 内向
                    float sz = 0.014f + Random.value * 0.010f;
                    go = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                    go.transform.localScale = Vector3.one * sz * 2f;  // billboard 等价
                    UnityEngine.Object.DestroyImmediate(go.GetComponent<Collider>());
                    mat = new Material(alphaShader);
                    mat.SetTexture("_MainTex", tex);
                    mat.SetColor("_TintColor", new Color(color.r, color.g, color.b, 0.85f));
                    mat.SetFloat("_Intensity", 0.9f);
                    go.GetComponent<Renderer>().material = mat;
                    float inwardSpeed = 0.04f + Random.value * 0.06f;
                    vel = new Vector3(
                        Mathf.Cos(a + Mathf.PI) * inwardSpeed,
                        0.55f + Random.value * 0.25f,
                        Mathf.Sin(a + Mathf.PI) * inwardSpeed);
                    maxLife = 1.8f;
                    kind = "drop";
                    break;
                }
                case CairnType.danger:
                {
                    // HTML line 465-477: Sphere 0.009-0.017 红 additive, vy 0.30-0.50, ±0.04 微散
                    float sz = 0.009f + Random.value * 0.008f;
                    go = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                    go.transform.localScale = Vector3.one * sz * 2f;
                    UnityEngine.Object.DestroyImmediate(go.GetComponent<Collider>());
                    mat = new Material(alphaShader);
                    mat.SetTexture("_MainTex", tex);
                    mat.SetColor("_TintColor", new Color(color.r, color.g, color.b, 1.0f));
                    mat.SetFloat("_Intensity", 1.2f);
                    go.GetComponent<Renderer>().material = mat;
                    vel = new Vector3((Random.value - 0.5f) * 0.04f, 0.30f + Random.value * 0.20f, (Random.value - 0.5f) * 0.04f);
                    maxLife = 2.5f;
                    kind = "spark";
                    break;
                }
                case CairnType.hut:
                {
                    // HTML line 478-490: Sphere 0.012-0.024 黄 additive opacity 0.7, vy 0.10-0.20, ±0.05 微散
                    float sz = 0.012f + Random.value * 0.012f;
                    go = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                    go.transform.localScale = Vector3.one * sz * 2f;
                    UnityEngine.Object.DestroyImmediate(go.GetComponent<Collider>());
                    mat = new Material(alphaShader);
                    mat.SetTexture("_MainTex", tex);
                    mat.SetColor("_TintColor", new Color(color.r, color.g, color.b, 0.95f));
                    mat.SetFloat("_Intensity", 1.0f);
                    go.GetComponent<Renderer>().material = mat;
                    y0 = 0.01f;
                    vel = new Vector3((Random.value - 0.5f) * 0.05f, 0.10f + Random.value * 0.10f, (Random.value - 0.5f) * 0.05f);
                    maxLife = 4.0f;
                    kind = "ember";
                    break;
                }
                case CairnType.junction:
                {
                    // HTML line 491-505: Cone 0.020x0.055, 4面, 绿 additive, orbitR=1.10-1.28*RING, orbitY=0.18-0.38, life 999
                    go = CreateConeMesh(0.020f, 0.055f);
                    var coneMat = new Material(alphaShader);
                    coneMat.SetTexture("_MainTex", null);  // cone 不要软圆纹理
                    coneMat.SetColor("_TintColor", new Color(color.r, color.g, color.b, 0.9f));
                    coneMat.SetFloat("_Intensity", 1.0f);
                    go.GetComponent<Renderer>().material = coneMat;
                    float orbitR = RING_RADIUS * (1.10f + Random.value * 0.18f);
                    float orbitPhase = a;
                    float orbitSpeed = 0.35f + Random.value * 0.25f;
                    float orbitY = 0.18f + Random.value * 0.20f;
                    y0 = orbitY;
                    x0 = Mathf.Cos(orbitPhase) * orbitR;
                    z0 = Mathf.Sin(orbitPhase) * orbitR;
                    vel = Vector3.zero;
                    maxLife = 999f;
                    kind = "arrow";

                    var p = new Particle
                    {
                        go = go, vel = vel, life = 0, maxLife = maxLife, kind = kind,
                        orbitR = orbitR, orbitPhase = orbitPhase, orbitSpeed = orbitSpeed, orbitY = orbitY,
                    };
                    go.transform.SetParent(parent, false);
                    go.transform.position = new Vector3(x0, y0, z0);
                    var tangent = new Vector3(-Mathf.Sin(orbitPhase), 0, Mathf.Cos(orbitPhase));
                    go.transform.rotation = Quaternion.LookRotation(tangent, Vector3.up) * Quaternion.Euler(90, 0, 0);
                    particles.Add(p);
                    return;  // junction 已 add, 跳过下面通用 add
                }
            }

            go.transform.SetParent(parent, false);
            go.transform.position = new Vector3(x0, y0, z0);
            particles.Add(new Particle
            {
                go = go, vel = vel, life = 0, maxLife = maxLife, kind = kind,
            });
        }

        // 程序生成 cone mesh (HTML ConeGeometry 4-segment 等价)
        static GameObject CreateConeMesh(float radius, float height)
        {
            var go = new GameObject("Cone");
            var mf = go.AddComponent<MeshFilter>();
            var mr = go.AddComponent<MeshRenderer>();
            var mesh = new Mesh();
            mesh.name = "Cone4";
            // 4 底面顶点 + 1 顶点 = 5 个 vertices, 但 unity 共享要分裂为每面独立 (法线正确)
            // 简化: 4 三角形侧面
            const int seg = 4;
            var verts = new List<Vector3>();
            var tris = new List<int>();
            verts.Add(new Vector3(0, height * 0.5f, 0));  // 顶点
            for (int i = 0; i < seg; i++)
            {
                float ang = i * Mathf.PI * 2f / seg;
                verts.Add(new Vector3(Mathf.Cos(ang) * radius, -height * 0.5f, Mathf.Sin(ang) * radius));
            }
            // 4 侧三角
            for (int i = 0; i < seg; i++)
            {
                tris.Add(0); tris.Add(1 + i); tris.Add(1 + (i + 1) % seg);
            }
            // 底面 (2 三角)
            tris.Add(1); tris.Add(3); tris.Add(2);
            tris.Add(1); tris.Add(4); tris.Add(3);
            mesh.SetVertices(verts);
            mesh.SetTriangles(tris, 0);
            mesh.RecalculateNormals();
            mf.sharedMesh = mesh;
            return go;
        }
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
