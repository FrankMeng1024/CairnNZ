#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;
using System.IO;

/// <summary>
/// V025AllTypesCaptureTest — 5 type v0.2.4 真实视觉截帧。
///
/// 直接打开 CairnAR.unity，找 PortalSpawner，对每个 type 调 SpawnStrand，
/// 模拟粒子 + CeremonyController，输出 120 帧 PNG。
/// 用 ffmpeg 转 GIF。
///
/// Output: Logs/v025-all-types/{type}/frame-{000..119}.png
/// </summary>
public static class V025AllTypesCaptureTest
{
    const string OUT_BASE  = "Logs/v025-all-types";
    const int    W          = 1280;
    const int    H          = 720;
    const int    FRAME_COUNT = 120;   // 4s @ 30fps
    const float  FRAME_DT   = 1f / 30f;
    const float  PREWARM    = 1.2f;   // ceremony sweep takes ~0.85s

    static readonly string[] TYPES  = { "cairn", "danger", "water", "junction", "hut" };

    [MenuItem("Cairn/V025 All Types Capture")]
    public static void RunFromMenu() { Run(); }

    public static void Run()
    {
        Debug.Log("[V025AllTypesCap] === START ===");
        try
        {
            // Open production AR scene (has PortalSpawner already configured)
            var scene = UnityEditor.SceneManagement.EditorSceneManager.OpenScene(
                "Assets/Scenes/CairnAR.unity",
                UnityEditor.SceneManagement.OpenSceneMode.Single);
            Debug.Log($"[V025AllTypesCap] scene opened: {scene.path}");

            // Set global shader defaults (Edit mode workaround)
            Shader.SetGlobalFloat("_CairnGlobalBloomScale",    1.0f);
            Shader.SetGlobalFloat("_CairnGlobalAlpha",         1.0f);
            Shader.SetGlobalFloat("_CairnGlobalScrollMul",     1.0f);
            Shader.SetGlobalFloat("_CairnGlobalBreathFreq",    1.0f);
            Shader.SetGlobalFloat("_CairnGlobalThermalScale",  1.0f);
            Shader.SetGlobalFloat("_CairnGlobalHaloRadiusMul", 1.0f);

            var spawner = Object.FindFirstObjectByType<PortalSpawner>();
            if (spawner == null)
            {
                Debug.LogError("[V025AllTypesCap] PortalSpawner not found in scene!");
                if (Application.isBatchMode) EditorApplication.Exit(1);
                return;
            }
            Debug.Log("[V025AllTypesCap] PortalSpawner found: " + spawner.name);

            // Camera setup: nice 3/4 view of the spawn point
            var camGo = new GameObject("CaptureCam");
            var cam   = camGo.AddComponent<Camera>();
            cam.clearFlags       = CameraClearFlags.SolidColor;
            cam.backgroundColor  = new Color(0.05f, 0.05f, 0.10f);
            cam.fieldOfView      = 50f;
            cam.nearClipPlane    = 0.05f;
            cam.farClipPlane     = 50f;
            cam.transform.position = new Vector3(0f, 1.4f, -1.8f);
            cam.transform.LookAt(new Vector3(0f, 0.5f, 0f));

            Directory.CreateDirectory(OUT_BASE);

            foreach (var typeName in TYPES)
            {
                string outDir = Path.Combine(OUT_BASE, typeName);
                Directory.CreateDirectory(outDir);

                // Build SpawnRequest using CairnTypePresets for the correct color
                var preset = CairnTypePresets.Get(typeName);
                var req = new CairnBridge.SpawnRequest
                {
                    id          = "cap-" + typeName,
                    type        = typeName,
                    x           = 0f,
                    y           = 0f,
                    z           = 0f,
                    r           = preset.color.r,
                    g           = preset.color.g,
                    b           = preset.color.b,
                    scrollSpeed = preset.scrollSpeed,
                    bloomBoost  = preset.bloomBoost,
                    tier        = "A",
                };

                spawner.SpawnStrand(req);
                Debug.Log($"[V025AllTypesCap] SpawnStrand type={typeName} color=({preset.color.r:F2},{preset.color.g:F2},{preset.color.b:F2})");

                // Simulate particle systems to get past ceremony sweep
                SimulateAllParticles(PREWARM);

                // Capture FRAME_COUNT frames
                for (int frame = 0; frame < FRAME_COUNT; frame++)
                {
                    SimulateAllParticles(FRAME_DT);
                    string path = Path.Combine(outDir, $"frame-{frame:D3}.png");
                    CaptureToPng(cam, path);
                }

                Debug.Log($"[V025AllTypesCap] {typeName}: {FRAME_COUNT} frames → {outDir}");

                // Remove spawned cairn so next type starts clean
                // PortalSpawner child is named "Portal_<id>"
                var child = spawner.transform.Find("Portal_cap-" + typeName);
                if (child != null) Object.DestroyImmediate(child.gameObject);
            }

            Object.DestroyImmediate(camGo);

            // Write ffmpeg commands for GIF conversion
            var sb = new System.Text.StringBuilder();
            sb.AppendLine("#!/bin/bash");
            sb.AppendLine("# Convert frame sequences to GIFs");
            sb.AppendLine($"cd {Path.GetFullPath(OUT_BASE)}");
            foreach (var typeName in TYPES)
            {
                sb.AppendLine($"ffmpeg -y -framerate 30 -i {typeName}/frame-%03d.png -vf \"fps=15,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse\" {typeName}.gif");
            }
            string scriptPath = Path.Combine(OUT_BASE, "make_gifs.sh");
            File.WriteAllText(scriptPath, sb.ToString());
            Debug.Log($"[V025AllTypesCap] GIF script → {scriptPath}");

            Debug.Log("[V025AllTypesCap] === DONE ===");
            if (Application.isBatchMode) EditorApplication.Exit(0);
        }
        catch (System.Exception e)
        {
            Debug.LogError($"[V025AllTypesCap] FAILED: {e}");
            if (Application.isBatchMode) EditorApplication.Exit(1);
        }
    }

    static void SimulateAllParticles(float dt)
    {
        // Advance all active ParticleSystems by dt
        foreach (var ps in Object.FindObjectsByType<ParticleSystem>(FindObjectsSortMode.None))
        {
            if (ps.gameObject.activeInHierarchy)
                ps.Simulate(dt, false, false, true);
        }
    }

    static void CaptureToPng(Camera cam, string path)
    {
        var rt  = new RenderTexture(W, H, 24);
        cam.targetTexture = rt;
        var tex = new Texture2D(W, H, TextureFormat.RGB24, false);
        cam.Render();
        RenderTexture.active = rt;
        tex.ReadPixels(new Rect(0, 0, W, H), 0, 0);
        tex.Apply();
        cam.targetTexture = null;
        RenderTexture.active = null;
        Object.DestroyImmediate(rt);
        byte[] png = tex.EncodeToPNG();
        Object.DestroyImmediate(tex);
        File.WriteAllBytes(path, png);
    }
}
#endif
