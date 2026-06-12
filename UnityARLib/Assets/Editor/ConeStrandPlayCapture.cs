#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;
using System.IO;

/// <summary>
/// v0.2.3 Branch C — EDIT MODE visual capture for cone strand review.
///
/// Why Edit mode (not PlayMode): Unity batchmode does NOT actually enter
/// Play mode (EnterPlaymode is a no-op when -batchmode -quit chain is used).
/// HeadlessRender.cs already proves this pattern works for the v186/v199 path.
///
/// Auto-runs:
///   1. CairnConeStrandSetup.RunSetup → mesh + materials + scene wiring
///   2. SceneSetup.SetupAndSave → AR managers
///   3. Open scene, force shader globals defaults
///   4. Spawn 1 cairn at origin via CairnBridge.OnSpawnStrand
///   5. For each lighting condition (night/dusk/noon/day-bright):
///      set _CairnGlobalDayNightT + camera background → render PNG
///
/// Output: Logs/cone-frame-{condition}.png
///
/// Usage (batchmode):
///   Unity.exe -batchmode -projectPath UnityARLib \\
///     -executeMethod ConeStrandPlayCapture.RunCapture -logFile - -quit
/// </summary>
public static class ConeStrandPlayCapture
{
    [MenuItem("Cairn/Branch C/Auto-Capture Cone Strand Frames")]
    public static void RunCapture()
    {
        Debug.Log("[ConeStrandCapture] === START ===");

        // 1. Generate cone-strand assets (idempotent). Skip if env CAIRN_SKIP_SETUP=1.
        if (System.Environment.GetEnvironmentVariable("CAIRN_SKIP_SETUP") != "1")
        {
            try { Cairn.AR.Editor.CairnConeStrandSetup.RunSetup(); }
            catch (System.Exception e)
            {
                Debug.LogError($"[ConeStrandCapture] CairnConeStrandSetup threw: {e}");
                if (Application.isBatchMode) EditorApplication.Exit(1);
                return;
            }
            Debug.Log("[ConeStrandCapture] CairnConeStrandSetup OK");
        }

        // 2. Setup AR scene.
        try { SceneSetup.SetupAndSave(); }
        catch (System.Exception e)
        {
            Debug.LogError($"[ConeStrandCapture] SetupAndSave threw: {e}");
            if (Application.isBatchMode) EditorApplication.Exit(1);
            return;
        }
        Debug.Log("[ConeStrandCapture] SceneSetup OK");

        var scene = UnityEditor.SceneManagement.EditorSceneManager.OpenScene(
            SceneSetup.SCENE_PATH,
            UnityEditor.SceneManagement.OpenSceneMode.Single);
        Debug.Log($"[ConeStrandCapture] Scene opened: {scene.path}");

        // 3. Force shader globals defaults (Edit mode skips MonoBehaviour Awake).
        Shader.SetGlobalFloat("_CairnGlobalBloomScale",   1.0f);
        Shader.SetGlobalFloat("_CairnGlobalAlpha",        1.0f);
        Shader.SetGlobalFloat("_CairnGlobalScrollMul",    1.0f);
        Shader.SetGlobalFloat("_CairnGlobalBreathFreq",   1.0f);
        Shader.SetGlobalFloat("_CairnGlobalThermalScale", 1.0f);
        Shader.SetGlobalFloat("_CairnGlobalHaloRadiusMul", 1.0f);

        // 4. Reimport our 2 new shaders + cone mesh in case Editor cached old.
        AssetDatabase.ImportAsset("Assets/Shaders/CairnConeCore.shader",     ImportAssetOptions.ForceUpdate);
        AssetDatabase.ImportAsset("Assets/Shaders/CairnConeOutline.shader",  ImportAssetOptions.ForceUpdate);
        AssetDatabase.ImportAsset("Assets/Resources/Meshes/cairn_cone_strand.asset", ImportAssetOptions.ForceUpdate);
        AssetDatabase.Refresh();
        Debug.Log("[ConeStrandCapture] Reimported cone shaders + mesh");

        // 5. Find bridge + camera.
        var bridge = UnityEngine.Object.FindFirstObjectByType<CairnBridge>();
        if (bridge == null)
        {
            Debug.LogError("[ConeStrandCapture] CairnBridge not found");
            if (Application.isBatchMode) EditorApplication.Exit(1);
            return;
        }
        var cam = bridge.arCamera != null ? bridge.arCamera : Camera.main;
        if (cam == null)
        {
            Debug.LogError("[ConeStrandCapture] No camera!");
            if (Application.isBatchMode) EditorApplication.Exit(1);
            return;
        }

        // Frame the cairn from eye height.
        cam.transform.position = new Vector3(0f, 1.6f, -2.5f);
        cam.transform.LookAt(new Vector3(0f, 0.7f, 0f));
        cam.clearFlags = CameraClearFlags.SolidColor;

        // Disable AR camera so we get clean fill.
        var arBg = cam.GetComponent<UnityEngine.XR.ARFoundation.ARCameraBackground>();
        if (arBg != null) arBg.enabled = false;
        var arCam = cam.GetComponent<UnityEngine.XR.ARFoundation.ARCameraManager>();
        if (arCam != null) arCam.enabled = false;

        // 6. Spawn 1 cairn at origin DIRECTLY via PortalSpawner.
        // CairnBridge.OnSpawnStrand routes to spawnerBehaviour but in Edit mode
        // Awake hasn't run so the dynamic resolution may fail. Direct call is
        // more reliable for visual capture.
        var spawner = UnityEngine.Object.FindFirstObjectByType<PortalSpawner>();
        if (spawner == null)
        {
            Debug.LogError("[ConeStrandCapture] PortalSpawner not found in scene");
            if (Application.isBatchMode) EditorApplication.Exit(1);
            return;
        }
        var req = new CairnBridge.SpawnRequest
        {
            id = "cone_capture_cairn",
            type = "cairn",
            x = 0f, y = 0f, z = 0f,
        };
        try
        {
            spawner.SpawnStrand(req);
            Debug.Log("[ConeStrandCapture] PortalSpawner.SpawnStrand called");
        }
        catch (System.Exception e)
        {
            Debug.LogError($"[ConeStrandCapture] SpawnStrand threw: {e}");
            if (Application.isBatchMode) EditorApplication.Exit(1);
            return;
        }

        // Verify cone strand was attached.
        var coneStrandsRoot = GameObject.Find("ConeStrands");
        if (coneStrandsRoot == null)
        {
            Debug.LogWarning("[ConeStrandCapture] ConeStrands GameObject not found — cone strand visual may not be present");
        }
        else
        {
            Debug.Log($"[ConeStrandCapture] ConeStrands root has {coneStrandsRoot.transform.childCount} cones");
        }

        Directory.CreateDirectory("Logs");

        // 7. Capture under 4 lighting conditions.
        var conditions = new (string label, float dnT, Color bg)[] {
            ("night",     0.0f, new Color(0.02f, 0.03f, 0.10f)),
            ("dusk",      0.5f, new Color(0.45f, 0.30f, 0.18f)),
            ("noon",      1.0f, new Color(0.91f, 0.86f, 0.77f)),  // NZ晨曦 #E8DCC4
            ("daybright", 1.0f, new Color(0.95f, 0.93f, 0.85f)),
        };

        foreach (var c in conditions)
        {
            Shader.SetGlobalFloat("_CairnGlobalDayNightT", c.dnT);
            Shader.SetGlobalFloat("_CairnGlobalCamDist", 2.5f);
            cam.backgroundColor = c.bg;

            string path = $"Logs/cone-frame-{c.label}.png";
            CaptureCameraToPng(cam, path);
            Debug.Log($"[ConeStrandCapture] saved {path}");
        }

        Debug.Log("[ConeStrandCapture] === DONE ===");
        if (Application.isBatchMode) EditorApplication.Exit(0);
    }

    private static void CaptureCameraToPng(Camera cam, string path)
    {
        int w = 1280, h = 720;
        var rt = new RenderTexture(w, h, 24);
        cam.targetTexture = rt;
        var tex = new Texture2D(w, h, TextureFormat.RGB24, false);
        cam.Render();
        RenderTexture.active = rt;
        tex.ReadPixels(new Rect(0, 0, w, h), 0, 0);
        tex.Apply();
        cam.targetTexture = null;
        RenderTexture.active = null;
        UnityEngine.Object.DestroyImmediate(rt);
        File.WriteAllBytes(path, tex.EncodeToPNG());
        UnityEngine.Object.DestroyImmediate(tex);
    }
}
#endif
