#if UNITY_EDITOR
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.Management;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.XR;
using UnityEditor;
using UnityEditor.SceneManagement;
using System.IO;

/// <summary>
/// Programmatic scene + project-settings setup. Replaces manual scene
/// authoring so CI and local always produce identical output.
///
/// Run from Editor menu:
///   Cairn > Build CairnAR Scene
/// Or invoked headlessly by BuildScript.BuildIOS via SetupAndSave().
///
/// What it does:
///   1. Creates Assets/Scenes/CairnAR.unity if missing.
///   2. Builds the scene graph (ARSession + XROrigin + AR Camera + Plane
///      Manager + CairnBridge + MultiSpawner + URP Volume with Bloom).
///   3. Wires references between bridge / spawner / camera / plane manager.
///   4. Saves the scene.
///   5. Adds the scene to EditorBuildSettings (enabled).
///   6. Pre-creates a strand material asset and wires it.
///   7. Adds Always-Include shaders (URP/Lit, StrandShader) so they aren't
///      stripped during iOS IL2CPP build.
/// </summary>
public static class SceneSetup
{
    public const string SCENE_PATH       = "Assets/Scenes/CairnAR.unity";
    public const string MAT_PATH         = "Assets/Materials/StrandMaterial.mat";
    public const string MAT_DIR          = "Assets/Materials";
    public const string STRAND_SHADER    = "Cairn/StrandShader";
    public const string URP_LIT          = "Universal Render Pipeline/Lit";

    [MenuItem("Cairn/Build CairnAR Scene")]
    public static void BuildSceneFromMenu()
    {
        SetupAndSave();
        EditorUtility.DisplayDialog("Cairn", $"Scene built: {SCENE_PATH}", "OK");
    }

    public static void SetupAndSave()
    {
        Debug.Log("[CairnUnity][SceneSetup] === START ===");

        EnsureMaterial();
        EnsureAlwaysIncludedShaders();

        // Open or create scene
        Scene scene;
        if (File.Exists(SCENE_PATH))
        {
            scene = EditorSceneManager.OpenScene(SCENE_PATH, OpenSceneMode.Single);
            Debug.Log($"[CairnUnity][SceneSetup] Opened existing {SCENE_PATH}");
        }
        else
        {
            Directory.CreateDirectory(Path.GetDirectoryName(SCENE_PATH));
            scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            Debug.Log("[CairnUnity][SceneSetup] Created new empty scene");
        }

        // Strip default scene contents (camera/light from EmptyScene shouldn't exist
        // but be safe and remove anything left from a previous incarnation)
        foreach (var go in scene.GetRootGameObjects())
        {
            UnityEngine.Object.DestroyImmediate(go);
        }

        // ─── ARSession ───
        var sessionGo = new GameObject("ARSession");
        var arSession = sessionGo.AddComponent<ARSession>();
        sessionGo.AddComponent<ARInputManager>();
        Debug.Log("[CairnUnity][SceneSetup] ARSession + ARInputManager added");

        // ─── XR Origin (AR) ───
        var xrOriginGo = new GameObject("XR Origin (AR)");
        var xrOrigin   = xrOriginGo.AddComponent<Unity.XR.CoreUtils.XROrigin>();

        var camOffsetGo = new GameObject("Camera Offset");
        camOffsetGo.transform.SetParent(xrOriginGo.transform, false);
        xrOrigin.CameraFloorOffsetObject = camOffsetGo;

        var camGo = new GameObject("AR Camera");
        camGo.tag = "MainCamera";
        camGo.transform.SetParent(camOffsetGo.transform, false);
        var cam = camGo.AddComponent<Camera>();
        cam.clearFlags      = CameraClearFlags.SolidColor;
        cam.backgroundColor = Color.black;
        cam.nearClipPlane   = 0.05f;
        cam.farClipPlane    = 50.0f;
        cam.useOcclusionCulling = false;
        camGo.AddComponent<AudioListener>();
        camGo.AddComponent<ARCameraManager>();
        camGo.AddComponent<ARCameraBackground>();

        // TrackedPoseDriver requires bound InputActions for HMD position/rotation.
        // Without this binding the AR camera stays at world origin regardless
        // of device motion — the entire spike collapses. Bind to <XRHMD> device.
        var tpd = camGo.AddComponent<TrackedPoseDriver>();
        var posAction = new InputAction("Position", binding: "<XRHMD>/centerEyePosition");
        posAction.AddBinding("<HandheldARInputDevice>/devicePosition");
        var rotAction = new InputAction("Rotation", binding: "<XRHMD>/centerEyeRotation");
        rotAction.AddBinding("<HandheldARInputDevice>/deviceRotation");
        var trackingStateAction = new InputAction("TrackingState", expectedControlType: "Integer");
        trackingStateAction.AddBinding("<XRHMD>/trackingState");
        trackingStateAction.AddBinding("<HandheldARInputDevice>/trackingState");
        tpd.positionInput      = new InputActionProperty(posAction);
        tpd.rotationInput      = new InputActionProperty(rotAction);
        tpd.trackingStateInput = new InputActionProperty(trackingStateAction);
        tpd.trackingType       = TrackedPoseDriver.TrackingType.RotationAndPosition;
        tpd.updateType         = TrackedPoseDriver.UpdateType.UpdateAndBeforeRender;
        // Explicitly enable actions — Input System 1.7.0 may not auto-enable
        // when assigned via property setter; without this, pose data is not read.
        posAction.Enable();
        rotAction.Enable();
        trackingStateAction.Enable();
        Debug.Log("[CairnUnity][SceneSetup] TrackedPoseDriver bound to <XRHMD> + <HandheldARInputDevice>");

        xrOrigin.Camera = cam;
        Debug.Log("[CairnUnity][SceneSetup] AR Camera built");

        // Plane manager goes on the XR Origin
        var planeManager = xrOriginGo.AddComponent<ARPlaneManager>();
        planeManager.requestedDetectionMode = UnityEngine.XR.ARSubsystems.PlaneDetectionMode.Horizontal;
        Debug.Log("[CairnUnity][SceneSetup] ARPlaneManager added (Horizontal)");

        // ─── MultiSpawner ───
        var spawnerGo  = new GameObject("MultiSpawner");
        var spawner    = spawnerGo.AddComponent<MultiSpawner>();

        // Wire shader & material references
        var strandMat = AssetDatabase.LoadAssetAtPath<Material>(MAT_PATH);
        if (strandMat != null) spawner.strandMaterialBase = strandMat;
        spawner.urpLitShader = Shader.Find(URP_LIT);
        Debug.Log($"[CairnUnity][SceneSetup] MultiSpawner wired: strandMat={strandMat!=null} urpLit={spawner.urpLitShader!=null}");

        // ─── CairnBridge ───
        var bridgeGo = new GameObject(CairnBridge.GAMEOBJECT_NAME);
        var bridge   = bridgeGo.AddComponent<CairnBridge>();
        bridge.arCamera     = cam;
        bridge.arSession    = arSession;
        bridge.planeManager = planeManager;
        bridge.spawner      = spawner;
        Debug.Log("[CairnUnity][SceneSetup] CairnBridge wired");

        // ─── URP Volume w/ Bloom ───
        var volumeGo = new GameObject("Global Volume (Bloom)");
        var volume   = volumeGo.AddComponent<Volume>();
        volume.isGlobal = true;

        // Try to load existing profile or create one
        string profilePath = "Assets/Settings/CairnVolumeProfile.asset";
        var profile = AssetDatabase.LoadAssetAtPath<VolumeProfile>(profilePath);
        if (profile == null)
        {
            Directory.CreateDirectory("Assets/Settings");
            profile = ScriptableObject.CreateInstance<VolumeProfile>();
            AssetDatabase.CreateAsset(profile, profilePath);
            Debug.Log($"[CairnUnity][SceneSetup] Created Volume profile at {profilePath}");
        }
        // Add Bloom if not present
        UnityEngine.Rendering.Universal.Bloom bloom;
        if (!profile.TryGet(out bloom))
        {
            bloom = profile.Add<UnityEngine.Rendering.Universal.Bloom>(true);
        }
        bloom.intensity.overrideState = true; bloom.intensity.value = 1.5f;
        bloom.threshold.overrideState = true; bloom.threshold.value = 0.7f;
        bloom.scatter.overrideState   = true; bloom.scatter.value   = 0.7f;
        EditorUtility.SetDirty(profile);
        AssetDatabase.SaveAssets();

        volume.sharedProfile = profile;
        Debug.Log("[CairnUnity][SceneSetup] Volume + Bloom configured");

        // ─── Save scene ───
        Directory.CreateDirectory(Path.GetDirectoryName(SCENE_PATH));
        bool saved = EditorSceneManager.SaveScene(scene, SCENE_PATH);
        Debug.Log($"[CairnUnity][SceneSetup] Scene saved: {saved} -> {SCENE_PATH}");

        AddSceneToBuildSettings(SCENE_PATH);

        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();
        Debug.Log("[CairnUnity][SceneSetup] === COMPLETE ===");
    }

    private static void EnsureMaterial()
    {
        var sh = Shader.Find(STRAND_SHADER);
        if (sh == null)
        {
            Debug.LogError($"[CairnUnity][SceneSetup] Shader '{STRAND_SHADER}' not found. " +
                           "Make sure StrandShader.shader is in Assets/Shaders/");
            return;
        }

        if (!Directory.Exists(MAT_DIR))
        {
            Directory.CreateDirectory(MAT_DIR);
        }

        var mat = AssetDatabase.LoadAssetAtPath<Material>(MAT_PATH);
        if (mat == null)
        {
            mat = new Material(sh);
            AssetDatabase.CreateAsset(mat, MAT_PATH);
            Debug.Log($"[CairnUnity][SceneSetup] Created strand material at {MAT_PATH}");
        }
        else if (mat.shader != sh)
        {
            mat.shader = sh;
            EditorUtility.SetDirty(mat);
            Debug.Log("[CairnUnity][SceneSetup] Updated existing material shader -> StrandShader");
        }

        AssetDatabase.SaveAssets();
    }

    private static void EnsureAlwaysIncludedShaders()
    {
        // Load GraphicsSettings asset to manipulate AlwaysIncludedShaders
        const string path = "ProjectSettings/GraphicsSettings.asset";
        var gsObj = AssetDatabase.LoadAllAssetsAtPath(path);
        if (gsObj == null || gsObj.Length == 0)
        {
            Debug.LogWarning($"[CairnUnity][SceneSetup] Could not load {path}; skipping AlwaysIncludedShaders update.");
            return;
        }

        var so = new SerializedObject(gsObj[0]);
        var arr = so.FindProperty("m_AlwaysIncludedShaders");
        if (arr == null)
        {
            Debug.LogWarning("[CairnUnity][SceneSetup] m_AlwaysIncludedShaders not found");
            return;
        }

        AddShaderIfMissing(arr, STRAND_SHADER);
        AddShaderIfMissing(arr, URP_LIT);
        so.ApplyModifiedProperties();
        AssetDatabase.SaveAssets();
        Debug.Log("[CairnUnity][SceneSetup] AlwaysIncludedShaders updated");
    }

    private static void AddShaderIfMissing(SerializedProperty arr, string shaderName)
    {
        var sh = Shader.Find(shaderName);
        if (sh == null)
        {
            Debug.LogWarning($"[CairnUnity][SceneSetup] Shader not found: {shaderName}");
            return;
        }

        // Check if already present
        for (int i = 0; i < arr.arraySize; i++)
        {
            var el = arr.GetArrayElementAtIndex(i);
            if (el.objectReferenceValue == sh) return;
        }

        arr.InsertArrayElementAtIndex(arr.arraySize);
        var newEl = arr.GetArrayElementAtIndex(arr.arraySize - 1);
        newEl.objectReferenceValue = sh;
        Debug.Log($"[CairnUnity][SceneSetup] Added to AlwaysIncluded: {shaderName}");
    }

    private static void AddSceneToBuildSettings(string scenePath)
    {
        var existing = EditorBuildSettings.scenes;
        for (int i = 0; i < existing.Length; i++)
        {
            if (existing[i].path == scenePath)
            {
                existing[i] = new EditorBuildSettingsScene(scenePath, true);
                EditorBuildSettings.scenes = existing;
                Debug.Log($"[CairnUnity][SceneSetup] {scenePath} already in build settings (re-enabled)");
                return;
            }
        }

        var list = new System.Collections.Generic.List<EditorBuildSettingsScene>(existing);
        list.Add(new EditorBuildSettingsScene(scenePath, true));
        EditorBuildSettings.scenes = list.ToArray();
        Debug.Log($"[CairnUnity][SceneSetup] Added {scenePath} to build settings");
    }
}
#endif
