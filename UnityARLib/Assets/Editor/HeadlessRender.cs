#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;
using System.IO;

/// <summary>
/// Headless visual-test driver — Edit mode only.
///
/// Unity batchmode does NOT actually enter Play mode (EnterPlaymode is
/// a no-op when -batchmode -quit chain is used). Instead, we instantiate
/// the spawn flow in Edit mode by manually invoking CairnBridge.OnSpawnStrand
/// and rendering the scene's main camera to a PNG.
///
/// MonoBehaviour Awake/OnEnable DO run when AddComponent fires in Edit
/// mode (after we open the scene), so CairnGlobals.Awake will set the
/// global float defaults BEFORE we capture.
///
/// Usage from CLI:
///   Unity.exe -batchmode -projectPath UnityARLib \
///     -executeMethod HeadlessRender.RenderTest \
///     -logFile ... -quit
///
/// Output: Logs/cairn-test.png at project root.
/// </summary>
public static class HeadlessRender
{
    public const string OUTPUT_PATH = "Logs/cairn-test.png";

    [MenuItem("Cairn/Headless Render Test")]
    public static void RunFromMenu() { RenderTest(); }

    public static void RenderTest()
    {
        Debug.Log("[HeadlessRender] === START ===");

        try { SceneSetup.SetupAndSave(); Debug.Log("[HeadlessRender] SetupAndSave OK"); }
        catch (System.Exception e)
        {
            Debug.LogError($"[HeadlessRender] SetupAndSave threw: {e}");
            if (Application.isBatchMode) EditorApplication.Exit(1);
            return;
        }

        var scene = UnityEditor.SceneManagement.EditorSceneManager.OpenScene(
            SceneSetup.SCENE_PATH,
            UnityEditor.SceneManagement.OpenSceneMode.Single);
        Debug.Log($"[HeadlessRender] Scene opened: {scene.path}");

        // In Edit mode, MonoBehaviour Awake DOES run for active GameObjects
        // when the scene is loaded. CairnGlobals.Awake should fire and
        // set the global float defaults. Verify:
        var globals = Object.FindFirstObjectByType<CairnGlobals>();
        Debug.Log($"[HeadlessRender] CairnGlobals.Instance = {(CairnGlobals.Instance != null ? "OK" : "NULL")} via FindFirstObjectByType={globals != null}");

        // Edit mode does NOT auto-fire MonoBehaviour.Awake. Manually
        // initialize globals so shaders sample sane defaults.
        Shader.SetGlobalFloat("_CairnGlobalBloomScale",   1.0f);
        Shader.SetGlobalFloat("_CairnGlobalAlpha",        1.0f);
        Shader.SetGlobalFloat("_CairnGlobalLightEstimate", 1.0f);
        Shader.SetGlobalFloat("_CairnGlobalScrollMul",    1.0f);
        Shader.SetGlobalFloat("_CairnGlobalBreathFreq",   1.0f);
        Shader.SetGlobalFloat("_CairnGlobalThermalScale", 1.0f);
        Shader.SetGlobalFloat("_CairnGlobalHaloRadiusMul", 1.0f);
        Debug.Log("[HeadlessRender] Forced 7 globals to default 1.0 (Edit mode workaround)");

        // Force re-import all our custom shaders (in case Unity has stale
        // cached compile from before today's edits)
        AssetDatabase.ImportAsset("Assets/Shaders/StrandShader.shader", ImportAssetOptions.ForceUpdate);
        AssetDatabase.ImportAsset("Assets/Shaders/HaloShader.shader",   ImportAssetOptions.ForceUpdate);
        AssetDatabase.ImportAsset("Assets/Shaders/ShadowBlobShader.shader", ImportAssetOptions.ForceUpdate);
        Debug.Log("[HeadlessRender] Force-reimported 3 shaders");

        // Force Awake by enabling the GameObject if disabled
        var bridge = Object.FindFirstObjectByType<CairnBridge>();
        if (bridge == null)
        {
            Debug.LogError("[HeadlessRender] CairnBridge not found — SetupAndSave didn't wire it");
            if (Application.isBatchMode) EditorApplication.Exit(1);
            return;
        }
        Debug.Log($"[HeadlessRender] CairnBridge wired: arCamera={(bridge.arCamera != null ? "OK" : "NULL")} spawner={(bridge.spawner != null ? "OK" : "NULL")}");

        // Manually spawn 5 cairns. We bypass StrandTestHarness's Play-mode
        // gate and call OnSpawnStrand directly.
        var cam = bridge.arCamera != null ? bridge.arCamera : Camera.main;
        if (cam == null)
        {
            Debug.LogError("[HeadlessRender] No camera!");
            if (Application.isBatchMode) EditorApplication.Exit(1);
            return;
        }

        // Reset camera to a known framing — Edit-mode default Camera
        // position is (0,1,-10) which doesn't see anything we spawn at
        // origin. Place camera at (0, 2, -5) looking forward+slightly-down.
        cam.transform.position = new Vector3(0f, 2f, -5f);
        cam.transform.LookAt(new Vector3(0f, 1f, 0f));
        cam.clearFlags = CameraClearFlags.SolidColor;
        cam.backgroundColor = new Color(0.05f, 0.05f, 0.10f); // dark navy not pure black

        // Disable ARCameraBackground in Editor — it clears to AR feed
        // (which doesn't exist in Editor) and may blank out our spawn.
        var arBg = cam.GetComponent<UnityEngine.XR.ARFoundation.ARCameraBackground>();
        if (arBg != null) arBg.enabled = false;
        // Also disable ARCameraManager so it doesn't interfere
        var arCam = cam.GetComponent<UnityEngine.XR.ARFoundation.ARCameraManager>();
        if (arCam != null) arCam.enabled = false;
        Debug.Log($"[HeadlessRender] Camera prepped: arBg={arBg!=null} arCam={arCam!=null}");

        // Spawn 5 cairns at ground y=0, spread along world X axis
        string[] types = { "danger", "junction", "water", "hut", "cairn" };
        for (int i = 0; i < types.Length; i++)
        {
            float xOffset = (i - 2) * 1.2f;  // -2.4 to 2.4
            var pos = new Vector3(xOffset, 0f, 0f);

            var req = new CairnBridge.SpawnRequest
            {
                id          = $"test_{types[i]}_{i}",
                type        = types[i],
                x           = pos.x,
                y           = pos.y,
                z           = pos.z,
                r = 0f, g = 0f, b = 0f,
                scrollSpeed = 0f, bloomBoost = 0f,
            };
            var json = JsonUtility.ToJson(req);
            try
            {
                bridge.OnSpawnStrand(json);
                Debug.Log($"[HeadlessRender] Spawned {types[i]} at ({pos.x:F2},{pos.y:F2},{pos.z:F2})");
            }
            catch (System.Exception e)
            {
                Debug.LogError($"[HeadlessRender] OnSpawnStrand({types[i]}) threw: {e}");
            }
        }

        // Verify children created
        var spawner = Object.FindFirstObjectByType<MultiSpawner>();
        if (spawner != null)
        {
            int children = spawner.transform.childCount;
            Debug.Log($"[HeadlessRender] MultiSpawner has {children} children after spawn");
            for (int i = 0; i < children; i++)
            {
                var c = spawner.transform.GetChild(i);
                Debug.Log($"  child[{i}]: {c.name} pos={c.position} active={c.gameObject.activeInHierarchy}");
                // Inspect Strand child material+mpb
                var strand = c.Find("Strand");
                if (strand != null)
                {
                    var r = strand.GetComponent<Renderer>();
                    if (r != null)
                    {
                        var sh = r.sharedMaterial != null ? r.sharedMaterial.shader.name : "NULL_MAT";
                        var hasFlow = r.sharedMaterial != null && r.sharedMaterial.HasProperty("_FlowTex") ? r.sharedMaterial.GetTexture("_FlowTex") : null;
                        Debug.Log($"    Strand renderer: shader={sh} flowTex={(hasFlow != null ? hasFlow.name : "NONE")} bounds={r.bounds} layer={strand.gameObject.layer}");
                        var mpb = new MaterialPropertyBlock();
                        r.GetPropertyBlock(mpb);
                        var col = mpb.GetColor(Shader.PropertyToID("_BaseColor"));
                        Debug.Log("    Strand MPB BaseColor=" + col);
                    }
                }
            }
        }

        // Inspect strand material asset itself
        var strandMatAsset = AssetDatabase.LoadAssetAtPath<Material>("Assets/Materials/StrandMaterial.mat");
        if (strandMatAsset != null)
        {
            var t = strandMatAsset.GetTexture("_FlowTex");
            Debug.Log("[HeadlessRender] StrandMaterial.mat: shader=" + strandMatAsset.shader.name + " _FlowTex=" + (t != null ? t.name : "NULL"));
        }
        else
        {
            Debug.LogError("[HeadlessRender] StrandMaterial.mat asset not found");
        }

        // Sanity test: also drop a default URP/Lit cube right at the
        // origin to verify the camera + render pipeline work AT ALL.
        // If our Cairn shaders are broken, the cube should still appear.
        var cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
        cube.name = "SanityCube";
        cube.transform.position = new Vector3(0f, 1f, 0f);
        cube.transform.localScale = Vector3.one * 0.5f;
        var cubeRenderer = cube.GetComponent<Renderer>();
        // Use URP/Lit explicitly to verify URP pipeline is active.
        var litShader = Shader.Find("Universal Render Pipeline/Lit");
        if (litShader != null)
        {
            cubeRenderer.material = new Material(litShader);
            cubeRenderer.material.color = Color.cyan;
            Debug.Log("[HeadlessRender] Sanity cube: URP/Lit cyan");
        }
        else
        {
            Debug.LogError("[HeadlessRender] Universal Render Pipeline/Lit not found");
        }

        // Also add a directional light so URP/Lit cube isn't pitch black
        var lightGo = new GameObject("DirectionalLight");
        var light = lightGo.AddComponent<Light>();
        light.type = LightType.Directional;
        light.intensity = 1.5f;
        lightGo.transform.rotation = Quaternion.Euler(50f, -30f, 0f);

        // Render
        CaptureGameView(cam);

        Debug.Log("[HeadlessRender] === DONE ===");
        if (Application.isBatchMode) EditorApplication.Exit(0);
    }

    private static void CaptureGameView(Camera cam)
    {
        try
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

            byte[] png = tex.EncodeToPNG();
            Object.DestroyImmediate(tex);

            Directory.CreateDirectory("Logs");
            File.WriteAllBytes(OUTPUT_PATH, png);
            Debug.Log($"[HeadlessRender] Saved {png.Length} bytes to {OUTPUT_PATH}");
        }
        catch (System.Exception e)
        {
            Debug.LogError($"[HeadlessRender] Capture failed: {e}");
        }
    }
}
#endif
