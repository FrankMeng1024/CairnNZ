#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;
using System.Collections;
using System.IO;
using UnityEditor.SceneManagement;

/// <summary>
/// v0.2.3 Branch C — PlayMode visual capture for cone strand review.
///
/// Auto-runs:
///   1. CairnConeStrandSetup.RunSetup() — generates mesh + materials + scene wiring
///   2. SceneSetup.SetupAndSave() — wires AR managers
///   3. EnterPlayMode → spawns 1 cairn at origin → captures 6 frames
///      across 4 day/night T values to verify visual under different lighting
///
/// Output: Logs/cone-frame-{day|night|noon|dusk}-NN.png
///
/// Usage (batch):
///   Unity.exe -batchmode -projectPath UnityARLib \
///     -executeMethod ConeStrandPlayCapture.RunCapture \
///     -logFile - -quit
/// </summary>
public static class ConeStrandPlayCapture
{
    [MenuItem("Cairn/Branch C/Auto-Capture Cone Strand Frames")]
    public static void RunCapture()
    {
        Debug.Log("[ConeStrandCapture] === START ===");

        // 1. Generate cone-strand assets if missing.
        try { Cairn.AR.Editor.CairnConeStrandSetup.RunSetup(); }
        catch (System.Exception e)
        {
            Debug.LogError($"[ConeStrandCapture] CairnConeStrandSetup threw: {e}");
            if (Application.isBatchMode) EditorApplication.Exit(1);
            return;
        }

        // 2. Setup AR scene.
        try { SceneSetup.SetupAndSave(); }
        catch (System.Exception e)
        {
            Debug.LogError($"[ConeStrandCapture] SetupAndSave threw: {e}");
            if (Application.isBatchMode) EditorApplication.Exit(1);
            return;
        }

        EditorSceneManager.OpenScene(SceneSetup.SCENE_PATH, OpenSceneMode.Single);

        EditorApplication.playModeStateChanged += OnPlayModeStateChanged;
        EditorApplication.EnterPlaymode();
    }

    private static void OnPlayModeStateChanged(PlayModeStateChange change)
    {
        if (change == PlayModeStateChange.EnteredPlayMode)
        {
            Debug.Log("[ConeStrandCapture] EnteredPlayMode");
            var go = new GameObject("__ConeCaptureRunner");
            Object.DontDestroyOnLoad(go);
            var runner = go.AddComponent<ConeCaptureRunner>();
            runner.StartCoroutine(runner.Run());
        }
    }
}

internal class ConeCaptureRunner : MonoBehaviour
{
    public IEnumerator Run()
    {
        yield return null;
        yield return null;

        var bridge = Object.FindFirstObjectByType<CairnBridge>();
        if (bridge == null) { Debug.LogError("[ConeStrandCapture] no CairnBridge"); ExitPlay(1); yield break; }
        var cam = bridge.arCamera != null ? bridge.arCamera : Camera.main;
        if (cam == null) { Debug.LogError("[ConeStrandCapture] no camera"); ExitPlay(1); yield break; }

        // Frame the cairn from eye height (1.6m), looking at base center.
        cam.transform.position = new Vector3(0f, 1.6f, -2.5f);
        cam.transform.LookAt(new Vector3(0f, 0.7f, 0f));
        cam.clearFlags = CameraClearFlags.SolidColor;

        // Disable AR camera so we get clean fill.
        var arBg = cam.GetComponent<UnityEngine.XR.ARFoundation.ARCameraBackground>();
        if (arBg != null) arBg.enabled = false;
        var arCam = cam.GetComponent<UnityEngine.XR.ARFoundation.ARCameraManager>();
        if (arCam != null) arCam.enabled = false;

        Directory.CreateDirectory("Logs");

        // Spawn 1 cairn at origin.
        var req = new CairnBridge.SpawnRequest
        {
            id = "cone_capture_cairn",
            type = "cairn",
            x = 0f, y = 0f, z = 0f,
        };
        try { bridge.OnSpawnStrand(JsonUtility.ToJson(req)); }
        catch (System.Exception e)
        {
            Debug.LogError($"[ConeStrandCapture] OnSpawnStrand threw: {e}");
            ExitPlay(1); yield break;
        }
        // Allow spawn to materialize.
        yield return new WaitForSeconds(0.5f);

        // Capture under 4 lighting conditions: night / dusk / noon / day-haze.
        var conditions = new[] {
            ("night",     0.0f, new Color(0.02f, 0.03f, 0.10f)),
            ("dusk",      0.5f, new Color(0.45f, 0.30f, 0.18f)),
            ("noon",      1.0f, new Color(0.91f, 0.86f, 0.77f)),  // NZ晨曦
            ("daybright", 1.0f, new Color(0.95f, 0.93f, 0.85f)),
        };

        foreach (var (label, dnT, bg) in conditions)
        {
            Shader.SetGlobalFloat(Shader.PropertyToID("_CairnGlobalDayNightT"), dnT);
            Shader.SetGlobalFloat(Shader.PropertyToID("_CairnGlobalCamDist"), 2.5f);
            cam.backgroundColor = bg;
            // 2 frames per condition (let flow noise advance between frames).
            for (int i = 0; i < 2; i++)
            {
                yield return new WaitForSeconds(0.3f);
                string path = $"Logs/cone-frame-{label}-{i:D2}.png";
                CaptureCameraToPng(cam, path);
                Debug.Log($"[ConeStrandCapture] saved {path}");
            }
        }

        Debug.Log("[ConeStrandCapture] ALL FRAMES CAPTURED");
        ExitPlay(0);
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
        Object.DestroyImmediate(rt);
        File.WriteAllBytes(path, tex.EncodeToPNG());
        Object.DestroyImmediate(tex);
    }

    private static void ExitPlay(int code)
    {
        EditorApplication.isPlaying = false;
        if (Application.isBatchMode)
        {
            EditorApplication.delayCall += () => EditorApplication.Exit(code);
        }
    }
}
#endif
