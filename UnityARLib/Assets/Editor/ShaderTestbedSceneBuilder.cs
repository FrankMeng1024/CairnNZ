#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine.SceneManagement;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using System.IO;

/// <summary>
/// Programmatic ShaderTestbed scene — minimal, no AR, just a camera +
/// MultiSpawner + Bloom volume + harness. Built into ShaderTestbed.exe
/// for visual validation outside Editor batchmode.
/// </summary>
public static class ShaderTestbedSceneBuilder
{
    public const string SCENE_PATH = "Assets/Scenes/ShaderTestbed.unity";

    [MenuItem("Cairn/Build Shader Testbed Scene")]
    public static void BuildSceneFromMenu() { BuildScene(); }

    public static void BuildScene()
    {
        Debug.Log("[TestbedSceneBuilder] === START ===");

        // Ensure TMP essentials so runtime TextMeshPro creation in PortalSpawner works.
        TMPEssentialsImporter.Run();

        // Reuse strand material and other assets from main SceneSetup
        SceneSetup.SetupAndSave();

        Scene scene;
        if (File.Exists(SCENE_PATH))
        {
            scene = EditorSceneManager.OpenScene(SCENE_PATH, OpenSceneMode.Single);
        }
        else
        {
            Directory.CreateDirectory(Path.GetDirectoryName(SCENE_PATH));
            scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        }
        foreach (var go in scene.GetRootGameObjects()) Object.DestroyImmediate(go);

        // Camera
        var camGo = new GameObject("MainCamera");
        camGo.tag = "MainCamera";
        var cam = camGo.AddComponent<Camera>();
        cam.transform.position = new Vector3(0f, 2f, -5f);
        cam.transform.LookAt(new Vector3(0f, 1f, 0f));
        cam.clearFlags = CameraClearFlags.SolidColor;
        cam.backgroundColor = new Color(0.05f, 0.05f, 0.10f);
        cam.nearClipPlane = 0.1f;
        cam.farClipPlane = 100f;
        cam.allowHDR = true;
        cam.allowMSAA = true;
        camGo.AddComponent<AudioListener>();

        // Enable URP camera post-processing (bloom only takes effect when this is on).
        var camData = camGo.AddComponent<UniversalAdditionalCameraData>();
        camData.renderPostProcessing = true;
        camData.antialiasing         = AntialiasingMode.SubpixelMorphologicalAntiAliasing;
        camData.antialiasingQuality  = AntialiasingQuality.High;

        // Directional light (so URP sees lighting; strand is unlit but
        // helps any URP fallback behavior)
        var lightGo = new GameObject("DirectionalLight");
        var light = lightGo.AddComponent<Light>();
        light.type = LightType.Directional;
        light.intensity = 1.0f;
        lightGo.transform.rotation = Quaternion.Euler(50f, -30f, 0f);

        // Ground reference quad (helps see if shaders render at all)
        var ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
        ground.name = "GroundReference";
        ground.transform.position = new Vector3(0f, -0.01f, 0f);
        ground.transform.localScale = new Vector3(2f, 1f, 2f);
        var groundMat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
        groundMat.color = new Color(0.18f, 0.16f, 0.14f);
        ground.GetComponent<Renderer>().sharedMaterial = groundMat;

        // PortalSpawner — v187 magic-circle cairn.
        var spawnerGo = new GameObject("PortalSpawner");
        var spawner = spawnerGo.AddComponent<PortalSpawner>();
        // Particle material left null — PortalSpawner.EnsureMaterials creates
        // a fresh runtime material with a built-in soft-circle sprite. This
        // bypasses the v186 CairnParticle.mat which renders as black squares.
        Debug.Log($"[TestbedSceneBuilder] PortalSpawner wired (all materials self-create at Awake)");

        // CairnGlobals (for Awake to set defaults at Start)
        var globalsGo = new GameObject("CairnGlobals");
        globalsGo.AddComponent<CairnGlobals>();

        // Harness
        var harnessGo = new GameObject("Harness");
        var harness = harnessGo.AddComponent<ShaderTestbedHarness>();
        harness.portalSpawner = spawner;
        harness.cam = cam;

        // Volume (Bloom) — testbed override profile with stronger bloom
        // than production AR. We want to evaluate "best possible" visual,
        // production scene can dial down if too costly.
        var volumeGo = new GameObject("GlobalVolume");
        var volume = volumeGo.AddComponent<Volume>();
        volume.isGlobal = true;
        var profile = LoadOrCreateTestbedVolumeProfile();
        if (profile != null) volume.sharedProfile = profile;

        // Save scene
        Directory.CreateDirectory(Path.GetDirectoryName(SCENE_PATH));
        bool saved = EditorSceneManager.SaveScene(scene, SCENE_PATH);
        Debug.Log($"[TestbedSceneBuilder] Scene saved: {saved}");

        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();
        Debug.Log("[TestbedSceneBuilder] === DONE ===");
    }

    /// <summary>
    /// Testbed-only volume profile with aggressive Bloom + Tonemapping.
    /// Production AR uses CairnVolumeProfile.asset; this is the upper bound
    /// "showcase" version for the standalone testbed.
    /// </summary>
    private static UnityEngine.Rendering.VolumeProfile LoadOrCreateTestbedVolumeProfile()
    {
        const string PATH = "Assets/Settings/TestbedVolumeProfile.asset";
        var existing = AssetDatabase.LoadAssetAtPath<UnityEngine.Rendering.VolumeProfile>(PATH);
        if (existing != null) return existing;

        var profile = ScriptableObject.CreateInstance<UnityEngine.Rendering.VolumeProfile>();
        AssetDatabase.CreateAsset(profile, PATH);

        var bloom = profile.Add<UnityEngine.Rendering.Universal.Bloom>(true);
        bloom.intensity.overrideState  = true;
        bloom.intensity.value          = 1.4f;          // strong but not blown out
        bloom.threshold.overrideState  = true;
        bloom.threshold.value          = 0.7f;          // pick up emissive (HDR > 1)
        bloom.scatter.overrideState    = true;
        bloom.scatter.value            = 0.85f;         // wide diffuse glow
        bloom.tint.overrideState       = true;
        bloom.tint.value               = Color.white;
        bloom.highQualityFiltering.overrideState = true;
        bloom.highQualityFiltering.value         = true;

        var tonemap = profile.Add<UnityEngine.Rendering.Universal.Tonemapping>(true);
        tonemap.mode.overrideState = true;
        tonemap.mode.value         = UnityEngine.Rendering.Universal.TonemappingMode.ACES;

        var colorAdj = profile.Add<UnityEngine.Rendering.Universal.ColorAdjustments>(true);
        colorAdj.postExposure.overrideState = true;
        colorAdj.postExposure.value         = 0.4f;     // slight HDR bias
        colorAdj.saturation.overrideState   = true;
        colorAdj.saturation.value           = 12f;      // colors more vivid

        AssetDatabase.SaveAssets();
        return profile;
    }
}
#endif
