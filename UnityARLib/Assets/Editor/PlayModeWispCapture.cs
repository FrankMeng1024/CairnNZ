#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;
using System.Collections;
using System.IO;
using UnityEditor.SceneManagement;

/// <summary>
/// v0.2.3 Stage 8 — PlayMode visual capture for Q3 wisp ribbon review.
///
/// HeadlessRender.cs uses Edit mode which cannot run ParticleSystem,
/// MonoBehaviour Update/Awake, or any animated visual. To verify
/// AttachWispRibbons (the ParticleSystem-based ribbon flow) we MUST
/// enter PlayMode and capture frames at regular intervals so the
/// ribbons are visible mid-flight.
///
/// Output: Logs/wisp-frame-NN.png (5 frames over ~3 seconds = "flipbook"
/// suitable for verifying S-curve animation across time).
///
/// Usage:
///   Unity.exe -batchmode -projectPath UnityARLib \
///     -executeMethod PlayModeWispCapture.RunPlayModeCapture \
///     -logFile - -quit
/// </summary>
public static class PlayModeWispCapture
{
    private const string OUTPUT_DIR = "Logs";
    private const string FRAME_PREFIX = "wisp-frame";
    private const int FRAME_COUNT = 5;
    private const float FRAME_INTERVAL_S = 0.6f;

    [MenuItem("Cairn/PlayMode Wisp Capture")]
    public static void RunPlayModeCapture()
    {
        Debug.Log("[WispCapture] === START ===");

        // 1. Setup scene (force-rebuild so wiring includes V199 layer fields).
        try { SceneSetup.SetupAndSave(); }
        catch (System.Exception e)
        {
            Debug.LogError($"[WispCapture] SetupAndSave threw: {e}");
            if (Application.isBatchMode) EditorApplication.Exit(1);
            return;
        }

        // 2. Open scene.
        EditorSceneManager.OpenScene(SceneSetup.SCENE_PATH, OpenSceneMode.Single);

        // 3. Register the PlayMode-state callback that drives capture.
        EditorApplication.playModeStateChanged += OnPlayModeStateChanged;

        // 4. Enter PlayMode. Capture coroutine fires once we're in.
        EditorApplication.EnterPlaymode();
    }

    private static void OnPlayModeStateChanged(PlayModeStateChange change)
    {
        if (change == PlayModeStateChange.EnteredPlayMode)
        {
            Debug.Log("[WispCapture] EnteredPlayMode — starting capture");
            // Find or create a runner GameObject to host the coroutine.
            var go = new GameObject("__WispCaptureRunner");
            Object.DontDestroyOnLoad(go);
            var runner = go.AddComponent<WispCaptureRunner>();
            runner.StartCoroutine(runner.Run());
        }
        else if (change == PlayModeStateChange.ExitingPlayMode)
        {
            Debug.Log("[WispCapture] ExitingPlayMode");
        }
    }
}

internal class WispCaptureRunner : MonoBehaviour
{
    public IEnumerator Run()
    {
        // Wait one frame so MonoBehaviour Awakes / scene wires up.
        yield return null;
        yield return null;

        // Find bridge to spawn cairns.
        var bridge = Object.FindFirstObjectByType<CairnBridge>();
        if (bridge == null)
        {
            Debug.LogError("[WispCapture] CairnBridge not found");
            ExitPlay(1);
            yield break;
        }

        // Place camera so ribbons (rising from ground around y=0 to y=1.5)
        // are framed: looking slightly down at cairn, not too close.
        var cam = bridge.arCamera != null ? bridge.arCamera : Camera.main;
        if (cam == null)
        {
            Debug.LogError("[WispCapture] No camera!");
            ExitPlay(1);
            yield break;
        }
        cam.transform.position = new Vector3(0f, 1.6f, -2.8f);
        cam.transform.LookAt(new Vector3(0f, 0.7f, 0f));
        cam.clearFlags = CameraClearFlags.SolidColor;
        cam.backgroundColor = new Color(0.04f, 0.04f, 0.08f);

        // Disable AR camera background so we get clean fill, not AR feed.
        var arBg = cam.GetComponent<UnityEngine.XR.ARFoundation.ARCameraBackground>();
        if (arBg != null) arBg.enabled = false;
        var arCam = cam.GetComponent<UnityEngine.XR.ARFoundation.ARCameraManager>();
        if (arCam != null) arCam.enabled = false;

        // Spawn 1 cairn at origin so we can study the ribbons closely.
        // (5-cairn variant produces too many overlapping ribbons to judge
        // a single flow.) Stage 8 commit-2 adds a 5-cairn variant after
        // the 1-cairn flow is approved.
        var req = new CairnBridge.SpawnRequest
        {
            id = "wisp_capture_cairn",
            type = "cairn",
            x = 0f, y = 0f, z = 0f,
            r = 0f, g = 0f, b = 0f,
            scrollSpeed = 0f, bloomBoost = 0f,
        };
        var json = JsonUtility.ToJson(req);
        try { bridge.OnSpawnStrand(json); }
        catch (System.Exception e)
        {
            Debug.LogError($"[WispCapture] OnSpawnStrand threw: {e}");
            ExitPlay(1);
            yield break;
        }

        Debug.Log("[WispCapture] Cairn spawned, beginning frame capture");

        // Ensure output directory exists.
        Directory.CreateDirectory("Logs");

        // Capture FRAME_COUNT frames at FRAME_INTERVAL_S apart.
        // First frame at t=0.5s so ribbon system has emitted some particles.
        yield return new WaitForSeconds(0.5f);

        for (int i = 0; i < 5; i++)
        {
            yield return new WaitForSeconds(0.6f);
            string path = $"Logs/wisp-frame-{i:D2}.png";
            CaptureCameraToPng(cam, path);
            Debug.Log($"[WispCapture] saved {path}");
        }

        Debug.Log("[WispCapture] ALL FRAMES CAPTURED — exiting PlayMode");
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
