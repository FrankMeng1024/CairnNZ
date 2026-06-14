#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;
using System.IO;

/// <summary>
/// v0.2.4 R2-followup — Q3a-equivalent: 60-frame flipbook of cairn under
/// continuous synthetic SLAM-refine drift.
///
/// Spike Q3a §3 推荐 SimulationCameraPoseProvider 反射 pose 注入,但 Editor batchmode
/// 没 SimulationLoader native 路径 (DllImport XRSimulationSubsystem 调不到)。
/// 等价方案: 直接 mutate cairn parent transform.position 模拟 ARKit anchor refine
/// (真机上 anchor.transform.position 是 native subsystem 写入,我们直接写等价)。
///
/// 60 帧 flipbook 出 PNG 序列 — 用户能直接看到 cairn "慢慢漂走" 还是 "焊死":
///   - 没 self-correct 路径 (R2 当前决策 trust ARKit): cairn 沿合成 drift 函数走
///   - 加 sliding-window snap 后: cairn 偶尔抖一下被拉回
///
/// Usage:
///   "C:/tools/Unity/6000.0.76f1/Editor/Unity.exe" -batchmode -projectPath UnityARLib \
///     -executeMethod SlamDriftFlipbookTest.RunHeadless -quit -logFile -
///
/// Output:
///   Logs/slam-drift-flipbook/frame-00.png ... frame-59.png
///   Logs/slam-drift-flipbook/summary.txt
/// </summary>
public static class SlamDriftFlipbookTest
{
    const string OUT_DIR = "Logs/slam-drift-flipbook";
    const int W = 1280, H = 720;
    const int FRAME_COUNT = 60;
    const float TOTAL_DRIFT_M = 0.3f;  // 60 帧累计 30cm drift (relocalize 量级)

    [MenuItem("Cairn/SLAM Drift Flipbook Test")]
    public static void RunFromMenu() { RunHeadless(); }

    public static void RunHeadless()
    {
        Debug.Log("[Flipbook] === START ===");

        try
        {
            Directory.CreateDirectory(OUT_DIR);

            var scene = UnityEditor.SceneManagement.EditorSceneManager.NewScene(
                UnityEditor.SceneManagement.NewSceneSetup.EmptyScene,
                UnityEditor.SceneManagement.NewSceneMode.Single);

            // Lights
            var sunGo = new GameObject("Sun");
            var sun = sunGo.AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.intensity = 1.5f;
            sunGo.transform.rotation = Quaternion.Euler(50f, -30f, 0f);

            // Ground
            var ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
            ground.name = "GroundReference";
            ground.transform.position = Vector3.zero;
            ground.transform.localScale = Vector3.one * 1.5f;
            var groundMat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            groundMat.color = new Color(0.32f, 0.34f, 0.40f);
            ground.GetComponent<Renderer>().material = groundMat;

            // Cairn cone — parent root we'll drift
            var cairnRoot = new GameObject("Portal_drift-test");
            var initialPos = Vector3.zero;
            cairnRoot.transform.position = initialPos;

            var innerMesh = AssetDatabase.LoadAssetAtPath<Mesh>("Assets/Resources/Meshes/cairn_cone_inner.asset");
            var outerMesh = AssetDatabase.LoadAssetAtPath<Mesh>("Assets/Resources/Meshes/cairn_cone_outer.asset");
            AddCone(outerMesh, "ConeOuter", new Color(0.95f, 0.55f, 0.30f), cairnRoot);
            AddCone(innerMesh, "ConeInner", new Color(1.0f, 0.85f, 0.4f), cairnRoot);

            // Camera
            var camGo = new GameObject("MainCamera");
            camGo.tag = "MainCamera";
            var cam = camGo.AddComponent<Camera>();
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0.05f, 0.05f, 0.10f);
            cam.fieldOfView = 60f;
            cam.nearClipPlane = 0.05f;
            cam.farClipPlane = 50f;
            camGo.transform.position = new Vector3(0f, 1.6f, -3f);
            camGo.transform.LookAt(new Vector3(0f, 0.3f, 0f));

            // Warm up URP material 1 frame so first PNG isn't yellow fallback
            var warmupRT = new RenderTexture(W, H, 24);
            cam.targetTexture = warmupRT;
            cam.Render();
            cam.targetTexture = null;
            UnityEngine.Object.DestroyImmediate(warmupRT);

            // ─── 60-frame loop, synthetic SLAM drift ───
            // Drift function: combine slow accumulating + small per-frame jitter
            // simulates real ARKit refine behavior (mostly cm-level + occasional dm jumps).
            for (int frame = 0; frame < FRAME_COUNT; frame++)
            {
                float t = (float)frame / FRAME_COUNT;
                // Y drift: slow accumulating to TOTAL_DRIFT_M (cubic ease for visible motion)
                float yDrift = TOTAL_DRIFT_M * (t * t * (3f - 2f * t));
                // X drift: small lateral jitter (reproduces real ARKit anchor refine sideways)
                float xJitter = Mathf.Sin(frame * 0.3f) * 0.02f;
                cairnRoot.transform.position = initialPos + new Vector3(xJitter, yDrift, 0);

                CaptureToPng(cam, Path.Combine(OUT_DIR, $"frame-{frame:D2}.png"));
            }

            // Summary
            string summary =
                "SLAM Drift 60-frame Flipbook Test\n" +
                "==================================\n" +
                $"Frames: {FRAME_COUNT}\n" +
                $"Total Y drift: {TOTAL_DRIFT_M}m (cubic ease in)\n" +
                "X jitter: ±0.02m (sin wave, simulates anchor refine sideways)\n" +
                "Camera: world (0, 1.6, -3) static\n" +
                "Cairn: starts at y=0, drifts to y=" + TOTAL_DRIFT_M + " over 60 frames\n" +
                "\n" +
                "PASS criteria (visual inspection):\n" +
                "  - frame-00 to frame-15: cairn 锥底贴地 (drift < 5cm 用户感知不到)\n" +
                "  - frame-30: cairn 微微离地 (~7cm,边缘可见)\n" +
                "  - frame-50 to frame-59: cairn 明显离地 (drift > 15cm,飞天 bug 可见)\n" +
                "\n" +
                "如果 R2 当前 trust-ARKit 决策成立 (用户感知阈值 = 5cm),\n" +
                "frame-00 ~ frame-15 没问题,frame-50+ 才需要 v0.2.5 fix。\n";
            File.WriteAllText(Path.Combine(OUT_DIR, "summary.txt"), summary);

            Debug.Log($"[Flipbook] === DONE: {FRAME_COUNT} frames written ===");
            if (Application.isBatchMode) EditorApplication.Exit(0);
        }
        catch (System.Exception e)
        {
            Debug.LogError($"[Flipbook] FAILED: {e}");
            if (Application.isBatchMode) EditorApplication.Exit(1);
        }
    }

    static void AddCone(Mesh mesh, string name, Color color, GameObject parent)
    {
        var go = new GameObject(name);
        go.transform.SetParent(parent.transform, false);
        go.AddComponent<MeshFilter>().sharedMesh = mesh;
        var renderer = go.AddComponent<MeshRenderer>();
        var m = new Material(Shader.Find("Universal Render Pipeline/Lit"));
        m.color = color;
        renderer.sharedMaterial = m;
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
