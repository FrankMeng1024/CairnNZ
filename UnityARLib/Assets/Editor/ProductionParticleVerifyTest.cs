#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;
using System.IO;

/// <summary>
/// v0.2.4 Phase 2 Final — 真机路径验证 harness.
///
/// 跟 AllTypesCinematicTest 区别:
///   - AllTypesCinematicTest 内嵌 ParticleSystem 创建逻辑 (CreateUnifiedSparks)
///   - 本 harness 直接实例化 production Cairn.AR.TypeParticleController + Configure + SetSpawnEnabled
///   - 真机 PortalSpawnerV199 走的就是 Configure + SetSpawnEnabled 路径
///
/// 如果本 harness 出来的 GIF 跟之前 AllTypesCinematicTest 出来的 GIF 视觉一致,
/// 说明 production TypeParticleController.cs 跟 harness 视觉对齐成功,真机 build 后用户能看到相同效果.
///
/// Output: Logs/production-particle-verify/{cairn,danger,water,hut,junction}/frame-NNN.png
///
/// 用法:
///   "C:/tools/Unity/6000.0.76f1/Editor/Unity.exe" -batchmode -projectPath UnityARLib \
///     -executeMethod ProductionParticleVerifyTest.RunHeadless -quit -logFile -
/// </summary>
public static class ProductionParticleVerifyTest
{
    const string OUT_BASE = "Logs/production-particle-verify";
    const int W = 1280, H = 720;
    const int FRAME_COUNT = 150;
    const float FRAME_DT = 1f / 30f;
    const float CEREMONY_DURATION = 0.85f;

    static readonly string[] TYPES = { "cairn", "danger", "water", "hut", "junction" };
    static readonly Color[] TYPE_COLORS = {
        HexToColor(0x8c6a3a), HexToColor(0xff7866), HexToColor(0x5fa8d8),
        HexToColor(0xff9d3d), HexToColor(0xa4d889),
    };
    static readonly int[] TYPE_INDEX_FOR_RING = { 0, 1, 3, 4, 2 };

    static Color HexToColor(int hex)
    {
        return new Color(((hex >> 16) & 0xFF) / 255f, ((hex >> 8) & 0xFF) / 255f, (hex & 0xFF) / 255f);
    }

    [MenuItem("Cairn/Production Particle Verify")]
    public static void RunFromMenu() { RunHeadless(); }

    public static void RunHeadless()
    {
        Debug.Log("[ProdVerify] === START ===");
        try
        {
            Directory.CreateDirectory(OUT_BASE);
            for (int i = 0; i < TYPES.Length; i++)
            {
                CaptureType(TYPES[i], TYPE_COLORS[i], TYPE_INDEX_FOR_RING[i]);
            }
            Debug.Log("[ProdVerify] === DONE ===");
            if (Application.isBatchMode) EditorApplication.Exit(0);
        }
        catch (System.Exception e)
        {
            Debug.LogError($"[ProdVerify] FAILED: {e}");
            if (Application.isBatchMode) EditorApplication.Exit(1);
        }
    }

    static void CaptureType(string type, Color tint, int ringTypeIndex)
    {
        var outDir = Path.Combine(OUT_BASE, type);
        Directory.CreateDirectory(outDir);

        var scene = UnityEditor.SceneManagement.EditorSceneManager.NewScene(
            UnityEditor.SceneManagement.NewSceneSetup.EmptyScene,
            UnityEditor.SceneManagement.NewSceneMode.Single);

        // 灯
        var sunGo = new GameObject("Sun");
        var sun = sunGo.AddComponent<Light>();
        sun.type = LightType.Directional;
        sun.intensity = 0.6f;
        sun.color = new Color(1.0f, 0.85f, 0.7f);
        sunGo.transform.rotation = Quaternion.Euler(50f, -30f, 0f);

        // 地
        var ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
        ground.name = "Ground";
        ground.transform.localScale = Vector3.one * 1.0f;
        var groundMat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
        groundMat.color = new Color(0.10f, 0.09f, 0.10f);
        ground.GetComponent<Renderer>().material = groundMat;

        // 阵图圆环
        var ringGo = GameObject.CreatePrimitive(PrimitiveType.Quad);
        ringGo.name = $"PortalRing-{type}";
        ringGo.transform.rotation = Quaternion.Euler(90, 0, 0);
        ringGo.transform.position = new Vector3(0, 0.001f, 0);
        ringGo.transform.localScale = new Vector3(2f, 2f, 1f);
        UnityEngine.Object.DestroyImmediate(ringGo.GetComponent<Collider>());
        var ringMat = new Material(Shader.Find("Cairn/PortalRingShader"));
        ringGo.GetComponent<Renderer>().material = ringMat;
        ringMat.SetColor("_BaseColor", new Color(tint.r * 1.5f, tint.g * 1.5f, tint.b * 1.5f, 1f));
        ringMat.SetFloat("_SweepAngle", 6.2831853f);
        ringMat.SetFloat("_Reveal", 1.0f);
        ringMat.SetFloat("_TypeIndex", ringTypeIndex);
        ringMat.SetFloat("_BloomBoost", 1.0f);
        ringMat.SetFloat("_CoreIntensity", 0.5f);

        // 相机
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

        // ════════════════════════════════════════════════════════════════════
        // 真机路径:实例化 production TypeParticleController
        // ════════════════════════════════════════════════════════════════════
        var clusterRoot = new GameObject($"CairnCluster-{type}");
        clusterRoot.transform.position = Vector3.zero;
        var tpGo = new GameObject("TypeParticles");
        tpGo.transform.SetParent(clusterRoot.transform, false);
        var tp = tpGo.AddComponent<Cairn.AR.TypeParticleController>();
        tp.Configure(type, tint, 0.55f);

        // 模拟 PortalSpawnerV199 → CeremonyController.SetTypeParticles 后 ribbon 阶段触发 SetSpawnEnabled
        // 这里直接模拟 ceremony 完成后调用
        bool sparksStarted = false;

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

            if (t >= CEREMONY_DURATION && !sparksStarted)
            {
                tp.SetSpawnEnabled(true);
                sparksStarted = true;
            }

            // production code 走 Update,batchmode 不触发 → 用 EditorManualTick
            if (sparksStarted)
            {
                tp.EditorManualTick(FRAME_DT);
            }

            CaptureToPng(cam, Path.Combine(outDir, $"frame-{frame:D3}.png"));
        }

        Debug.Log($"[ProdVerify] {type} done");
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
        File.WriteAllBytes(path, tex.EncodeToPNG());
        cam.targetTexture = null;
        RenderTexture.active = null;
        UnityEngine.Object.DestroyImmediate(rt);
        UnityEngine.Object.DestroyImmediate(tex);
    }
}
#endif
