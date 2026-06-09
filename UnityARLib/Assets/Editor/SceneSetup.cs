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
/// v186 DS upgrade additions:
///   - ARRaycastManager component on XR Origin (required for Tier B
///     ground-Y resolution via .estimatedPlane raycast — see
///     GroundYResolver.cs)
///   - Halo + ShadowBlob shaders + materials + textures wired
///   - CairnGlobals + CairnThermalMonitor MonoBehaviours added to
///     CairnBridge GameObject
///   - URP Bloom retuned to v186 values (threshold 1.05 / intensity 0.7
///     / scatter 0.65) — masks ARCamera feed but blooms strand emissive
///   - URP HDR enabled assertion (bloom threshold > 1.0 needs HDR or
///     it's a no-op)
///   - All new shaders registered in m_AlwaysIncludedShaders so iOS
///     IL2CPP doesn't strip them as "unused"
/// </summary>
public static class SceneSetup
{
    public const string SCENE_PATH       = "Assets/Scenes/CairnAR.unity";
    public const string MAT_DIR          = "Assets/Materials";
    public const string MAT_PATH         = "Assets/Materials/StrandMaterial.mat";
    public const string MAT_HALO_PATH    = "Assets/Materials/CairnHalo.mat";
    public const string MAT_SHADOW_PATH  = "Assets/Materials/CairnShadow.mat";
    public const string MAT_PARTICLE_PATH = "Assets/Materials/CairnParticle.mat";

    // v199 — runtime-build shared materials from named shaders. Caches
    // by shader name so multiple PortalSpawner fields can share one
    // material instance per shader (matching SRP Batcher expectations).
    private static readonly System.Collections.Generic.Dictionary<string, Material> _v199MatCache
        = new System.Collections.Generic.Dictionary<string, Material>();

    private static Material MaterialFromShader(string shaderName)
    {
        if (_v199MatCache.TryGetValue(shaderName, out var cached) && cached != null) return cached;
        var sh = Shader.Find(shaderName);
        if (sh == null)
        {
            Debug.LogWarning($"[SceneSetup] Shader '{shaderName}' not found — v199 layer will be skipped at runtime");
            return null;
        }
        var m = new Material(sh) { name = shaderName.Replace('/', '_') };
        _v199MatCache[shaderName] = m;
        return m;
    }

    public const string TEX_DIR          = "Assets/Textures";
    public const string TEX_FLOW         = "Assets/Textures/strand_flow.png";
    public const string TEX_RUNE_NOISE   = "Assets/Textures/cairn_rune_noise.png";
    public const string TEX_SHADOW_BLOB  = "Assets/Textures/cairn_shadow_blob.png";
    public const string TEX_MOTE         = "Assets/Textures/mote_soft.png";
    public const string STRAND_SHADER    = "Cairn/StrandShader";
    public const string HALO_SHADER      = "Cairn/HaloShader";
    public const string SHADOW_SHADER    = "Cairn/ShadowBlobShader";
    public const string URP_LIT          = "Universal Render Pipeline/Lit";
    public const string URP_PARTICLE_UNLIT = "Universal Render Pipeline/Particles/Unlit";

    [MenuItem("Cairn/Build CairnAR Scene")]
    public static void BuildSceneFromMenu()
    {
        SetupAndSave();
        EditorUtility.DisplayDialog("Cairn", $"Scene built: {SCENE_PATH}", "OK");
    }

    public static void SetupAndSave()
    {
        Debug.Log("[CairnUnity][SceneSetup] === START ===");

        EnsureURPRenderPipelineAsset();   // v186: ensure RP asset exists + wired
        EnsureTextureImportSettings();
        EnsureStrandMaterial();
        EnsureHaloMaterial();
        EnsureShadowMaterial();
        EnsureParticleMaterial();
        EnsureAlwaysIncludedShaders();
        EnsureURPHDRAndBloom();

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

        // ARPlaneManager + ARRaycastManager + ARAnchorManager on XR Origin.
        // ARRaycastManager is REQUIRED for GroundYResolver Tier B raycasts.
        // ARAnchorManager added in v199 (review B2 fix) — without it,
        // PortalSpawnerV199.TryAddAnchorAsync silently no-ops and cairns
        // never anchor to real-world planes (drift with camera).
        var planeManager = xrOriginGo.AddComponent<ARPlaneManager>();
        planeManager.requestedDetectionMode = UnityEngine.XR.ARSubsystems.PlaneDetectionMode.Horizontal;
        var raycastManager = xrOriginGo.AddComponent<ARRaycastManager>();
        var anchorManager  = xrOriginGo.AddComponent<ARAnchorManager>();
        Debug.Log($"[CairnUnity][SceneSetup] ARPlaneManager + ARRaycastManager + ARAnchorManager added");

        // ─── PortalSpawner (v187 base + v199 superlayer) ───
        var spawnerGo  = new GameObject("PortalSpawner");
        var spawner    = spawnerGo.AddComponent<PortalSpawner>();

        // v199 inspector fields wiring (review B1 fix). Without these,
        // PortalSpawnerV199.AddV199Layers null-checks fall through and
        // every cinematic layer (pebble/typeChip/runeText/heroRibbons/
        // farShaft/contactShadow/confidenceRing/likeBadge) is skipped at
        // runtime — cairn renders as v187 magic-circle only.
        spawner.arRaycastManagerRef = raycastManager;
        spawner.arAnchorManagerRef  = anchorManager;
        spawner.arPlaneManagerRef   = planeManager;
        spawner.arCameraRef         = cam;
        spawner.pebbleSmallMesh         = AssetDatabase.LoadAssetAtPath<Mesh>("Assets/Meshes/Pebble_S.asset");
        spawner.pebbleMediumMesh        = AssetDatabase.LoadAssetAtPath<Mesh>("Assets/Meshes/Pebble_M.asset");
        spawner.pebbleLargeMesh         = AssetDatabase.LoadAssetAtPath<Mesh>("Assets/Meshes/Pebble_L.asset");
        spawner.pebbleMaterial          = MaterialFromShader("Cairn/PebbleShader");
        spawner.typeChipMaterial        = MaterialFromShader("Cairn/TypeChipShader");
        spawner.stoneBackplateMaterial  = MaterialFromShader("Cairn/StoneBackplateShader");
        spawner.ribbonStrandMaterial    = MaterialFromShader("Cairn/RibbonStrandShader");
        spawner.lightShaftMaterial      = MaterialFromShader("Cairn/LightShaftShader");
        spawner.confidenceRingMaterial  = MaterialFromShader("Cairn/ConfidenceRingShader");
        spawner.contactShadowMaterial   = MaterialFromShader("Cairn/ShadowBlobShader");
        // TMP SDF font asset — bundled with TextMeshPro Essentials at first import.
        // Fallback to runtime null-check warn in PortalSpawnerV199 if missing.
        var runeFont = AssetDatabase.LoadAssetAtPath<TMPro.TMP_FontAsset>(
            "Assets/TextMesh Pro/Resources/Fonts & Materials/LiberationSans SDF.asset");
        if (runeFont == null) runeFont = AssetDatabase.LoadAssetAtPath<TMPro.TMP_FontAsset>(
            "Assets/Resources/Fonts/LiberationSans SDF.asset");
        spawner.runeFontAsset = runeFont;
        Debug.Log($"[CairnUnity][SceneSetup] PortalSpawner v199 wired " +
                  $"(pebble={spawner.pebbleMaterial!=null} typeChip={spawner.typeChipMaterial!=null} " +
                  $"runeFont={spawner.runeFontAsset!=null} ribbon={spawner.ribbonStrandMaterial!=null} " +
                  $"anchor={spawner.arAnchorManagerRef!=null})");

        // ─── CairnBridge + CairnGlobals + CairnThermalMonitor ───
        var bridgeGo = new GameObject(CairnBridge.GAMEOBJECT_NAME);
        var bridge   = bridgeGo.AddComponent<CairnBridge>();
        bridge.arCamera     = cam;
        bridge.arSession    = arSession;
        bridge.planeManager = planeManager;
        bridge.spawnerBehaviour = spawner;   // ICairnSpawner editor slot — bridge.Awake binds the interface
        // CairnGlobals owns Shader.SetGlobalFloat for the OTA-tunable knobs.
        // CairnThermalMonitor drives _CairnGlobalThermalScale based on
        // iOS thermal state. Both are siblings on the bridge GO.
        bridgeGo.AddComponent<CairnGlobals>();
        bridgeGo.AddComponent<CairnThermalMonitor>();
        // v199 cinematic-rebuild — siblings on the bridge GO. These
        // MonoBehaviours self-subscribe to CairnBridge static events
        // in OnEnable; without instantiation the static events have no
        // listener and RN postMessages are no-ops (Phase 7 review B1).
        bridgeGo.AddComponent<CairnVolumeOverrides>();
        // SpiritHandshake requires LineRenderer — own GameObject so it
        // can hold its own renderer without conflicting with bridge GO.
        var handshakeGo = new GameObject("CairnSpiritHandshake");
        handshakeGo.transform.SetParent(bridgeGo.transform, false);
        handshakeGo.AddComponent<LineRenderer>();
        handshakeGo.AddComponent<SpiritHandshake>();
        // GlobalScanGridController needs a child quad with the scan grid
        // shader — own GO so the renderer transform is independent of
        // the bridge GO transform (the controller positions it relative
        // to the AR camera each frame).
        var scanGridGo = new GameObject("CairnScanGrid");
        scanGridGo.transform.SetParent(bridgeGo.transform, false);
        var scanGridQuad = GameObject.CreatePrimitive(PrimitiveType.Quad);
        scanGridQuad.name = "ScanGridQuad";
        UnityEngine.Object.DestroyImmediate(scanGridQuad.GetComponent<Collider>());
        scanGridQuad.transform.SetParent(scanGridGo.transform, false);
        scanGridQuad.transform.localScale = new Vector3(1.5f, 1.5f, 1f);
        var scanGridShader = Shader.Find("Cairn/ScanningGridShader");
        if (scanGridShader != null)
        {
            scanGridQuad.GetComponent<MeshRenderer>().sharedMaterial = new Material(scanGridShader);
        }
        var scanGridCtl = scanGridGo.AddComponent<GlobalScanGridController>();
        scanGridCtl.arCamera = cam;
        scanGridCtl.gridRenderer = scanGridQuad.GetComponent<MeshRenderer>();
        // GroundYResolver lives on the spawner GO so its Update runs after
        // raycasts have populated this frame's data.
        var resolver = spawnerGo.AddComponent<GroundYResolver>();
        resolver.arCamera = cam;
        resolver.raycastManager = raycastManager;
        resolver.planeManager = planeManager;
        spawner.groundYResolver = resolver;
        Debug.Log("[CairnUnity][SceneSetup] CairnBridge + CairnGlobals + CairnThermalMonitor + GroundYResolver wired");

        // ─── URP Volume w/ Bloom ───
        var volumeGo = new GameObject("Global Volume (Bloom)");
        var volume   = volumeGo.AddComponent<Volume>();
        volume.isGlobal = true;
        volume.sharedProfile = LoadOrCreateVolumeProfile();
        Debug.Log("[CairnUnity][SceneSetup] Volume wired");

        // ─── Save scene ───
        Directory.CreateDirectory(Path.GetDirectoryName(SCENE_PATH));
        bool saved = EditorSceneManager.SaveScene(scene, SCENE_PATH);
        Debug.Log($"[CairnUnity][SceneSetup] Scene saved: {saved} -> {SCENE_PATH}");

        AddSceneToBuildSettings(SCENE_PATH);

        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();
        Debug.Log("[CairnUnity][SceneSetup] === COMPLETE ===");
    }

    /// <summary>
    /// Texture import settings: ensure flow + rune noise are clamp/repeat
    /// appropriately. Strand flow tiles along V (repeat). Rune noise +
    /// shadow blob + mote use clamp.
    /// </summary>
    /// <summary>
    /// Create UniversalRenderPipelineAsset + Renderer Data, save to disk,
    /// and wire into GraphicsSettings.m_CustomRenderPipeline. Without
    /// this, GraphicsSettings.currentRenderPipeline is null, all URP
    /// shaders fall back to magenta in standalone player builds. v186
    /// fix — diagnosed via testbed exe rendering all-magenta.
    /// </summary>
    private static void EnsureURPRenderPipelineAsset()
    {
        const string DIR = "Assets/Settings";
        const string RP_ASSET_PATH       = "Assets/Settings/CairnURP.asset";
        const string RENDERER_ASSET_PATH = "Assets/Settings/CairnURPRenderer.asset";
        Directory.CreateDirectory(DIR);

        // Create renderer first; URP asset references it
        var renderer = AssetDatabase.LoadAssetAtPath<UnityEngine.Rendering.Universal.UniversalRendererData>(RENDERER_ASSET_PATH);
        if (renderer == null)
        {
            renderer = ScriptableObject.CreateInstance<UnityEngine.Rendering.Universal.UniversalRendererData>();
            AssetDatabase.CreateAsset(renderer, RENDERER_ASSET_PATH);
            Debug.Log($"[CairnUnity][SceneSetup] Created URP Renderer at {RENDERER_ASSET_PATH}");
        }

        // Create URP asset
        var rpAsset = AssetDatabase.LoadAssetAtPath<UnityEngine.Rendering.Universal.UniversalRenderPipelineAsset>(RP_ASSET_PATH);
        if (rpAsset == null)
        {
            // UniversalRenderPipelineAsset.Create requires renderer; use
            // reflection-friendly factory if available, else newer API.
            rpAsset = UnityEngine.Rendering.Universal.UniversalRenderPipelineAsset.Create(renderer);
            AssetDatabase.CreateAsset(rpAsset, RP_ASSET_PATH);
            Debug.Log($"[CairnUnity][SceneSetup] Created URP asset at {RP_ASSET_PATH}");
        }

        // HDR + bloom-friendly settings
        var soURP = new SerializedObject(rpAsset);
        var hdrProp = soURP.FindProperty("m_SupportsHDR");
        if (hdrProp != null) hdrProp.boolValue = true;
        soURP.ApplyModifiedProperties();
        EditorUtility.SetDirty(rpAsset);

        // v187.7.10 — CRITICAL FIX (Subagent A diagnosis): ensure
        // ARBackgroundRendererFeature is in the renderer's feature list.
        // Without it, ARCameraBackground component is enabled but no URP
        // RenderPass blits the iOS camera image to the color buffer →
        // user sees uninitialized HDR float16 framebuffer memory (yellow/
        // brown noise amplified by bloom). Was the v187 production yellow-
        // screen bug. Reference: ARCameraBackground.cs lines 18-34 in
        // com.unity.xr.arfoundation — explicitly required under URP.
        EnsureARBackgroundRendererFeature(renderer);

        // v187.7.2 — DO NOT set GraphicsSettings.defaultRenderPipeline.
        // Setting it causes Unity to enumerate the FULL URP keyword matrix
        // at build time (294,912 variants, 8+ hour iOS build). The standalone
        // testbed needed it to render — but on iOS we already wire the URP
        // asset through QualitySettings below, which is the path Unity 6
        // production AR has used since v186. Avoiding the GraphicsSettings
        // path keeps iOS variant collection bounded (~6k variants, 5 min build).
        //
        // STANDALONE-ONLY override: ShaderTestbedSceneBuilder OR a build-time
        // hook can set it, but the production scene path leaves it unset.
        // (This block was previously: GraphicsSettings.defaultRenderPipeline = rpAsset)

        // Wire into all QualitySettings levels so the player picks it up
        // regardless of quality level. This is the v186-proven path.
        for (int i = 0; i < QualitySettings.names.Length; i++)
        {
            QualitySettings.SetQualityLevel(i, false);
            QualitySettings.renderPipeline = rpAsset;
        }

        AssetDatabase.SaveAssets();
        Debug.Log("[CairnUnity][SceneSetup] URP RP asset wired to all QualitySettings levels (GraphicsSettings.defaultRenderPipeline intentionally NOT set — see comment).");
    }

    /// <summary>
    /// v187.7.10 fix — make sure the URP renderer has ARBackgroundRendererFeature
    /// in its feature list. ScriptableObject.CreateInstance<UniversalRendererData>()
    /// creates an empty feature list; AR Foundation 6 + URP requires this
    /// feature to be present for the camera-feed blit pass to run.
    ///
    /// Idempotent: re-runs every scene-setup; if a feature of this type is
    /// already present, exits without modification. Adds the feature as a
    /// sub-asset of CairnURPRenderer.asset so it serializes correctly across
    /// build pipelines.
    /// </summary>
    private static void EnsureARBackgroundRendererFeature(
        UnityEngine.Rendering.Universal.UniversalRendererData renderer)
    {
        if (renderer == null) return;

        // Check if already present.
        bool already = false;
        foreach (var f in renderer.rendererFeatures)
        {
            if (f is UnityEngine.XR.ARFoundation.ARBackgroundRendererFeature)
            {
                already = true;
                break;
            }
        }
        if (already)
        {
            Debug.Log("[CairnUnity][SceneSetup] ARBackgroundRendererFeature already in renderer feature list");
            return;
        }

        var feature = ScriptableObject.CreateInstance<UnityEngine.XR.ARFoundation.ARBackgroundRendererFeature>();
        feature.name = "ARBackgroundRendererFeature";
        // Persist as sub-asset of the renderer so .meta GUIDs survive CI rebuilds.
        AssetDatabase.AddObjectToAsset(feature, renderer);
        renderer.rendererFeatures.Add(feature);
        EditorUtility.SetDirty(renderer);
        AssetDatabase.SaveAssets();
        Debug.Log("[CairnUnity][SceneSetup] ARBackgroundRendererFeature added to renderer feature list (was empty — yellow-screen bug fix)");
    }

    private static void EnsureTextureImportSettings()
    {
        if (!Directory.Exists(TEX_DIR))
        {
            Directory.CreateDirectory(TEX_DIR);
            AssetDatabase.Refresh();
        }
        SetTextureImport(TEX_FLOW,        wrap: TextureWrapMode.Repeat, sRGB: false);
        SetTextureImport(TEX_RUNE_NOISE,  wrap: TextureWrapMode.Repeat, sRGB: false);
        SetTextureImport(TEX_SHADOW_BLOB, wrap: TextureWrapMode.Clamp,  sRGB: false);
        SetTextureImport(TEX_MOTE,        wrap: TextureWrapMode.Clamp,  sRGB: false);
    }

    private static void SetTextureImport(string path, TextureWrapMode wrap, bool sRGB)
    {
        var importer = AssetImporter.GetAtPath(path) as TextureImporter;
        if (importer == null)
        {
            Debug.LogWarning($"[CairnUnity][SceneSetup] Could not get importer for {path} (file missing?)");
            return;
        }
        bool dirty = false;
        if (importer.wrapMode != wrap) { importer.wrapMode = wrap; dirty = true; }
        if (importer.sRGBTexture != sRGB) { importer.sRGBTexture = sRGB; dirty = true; }
        if (importer.textureCompression != TextureImporterCompression.Uncompressed)
        {
            // R8 textures: use uncompressed for predictability across versions
            importer.textureCompression = TextureImporterCompression.Uncompressed;
            dirty = true;
        }
        if (dirty)
        {
            importer.SaveAndReimport();
            Debug.Log($"[CairnUnity][SceneSetup] Texture import updated: {path}");
        }
    }

    private static void EnsureStrandMaterial()
    {
        var sh = Shader.Find(STRAND_SHADER);
        if (sh == null)
        {
            Debug.LogError($"[CairnUnity][SceneSetup] Shader '{STRAND_SHADER}' not found.");
            return;
        }
        if (!Directory.Exists(MAT_DIR)) Directory.CreateDirectory(MAT_DIR);

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
        }
        // Wire flow texture
        var flowTex = AssetDatabase.LoadAssetAtPath<Texture2D>(TEX_FLOW);
        if (flowTex != null) mat.SetTexture("_FlowTex", flowTex);
        EditorUtility.SetDirty(mat);
        AssetDatabase.SaveAssets();
    }

    private static void EnsureHaloMaterial()
    {
        var sh = Shader.Find(HALO_SHADER);
        if (sh == null) { Debug.LogError($"[CairnUnity][SceneSetup] Shader '{HALO_SHADER}' not found."); return; }
        if (!Directory.Exists(MAT_DIR)) Directory.CreateDirectory(MAT_DIR);

        var mat = AssetDatabase.LoadAssetAtPath<Material>(MAT_HALO_PATH);
        if (mat == null) { mat = new Material(sh); AssetDatabase.CreateAsset(mat, MAT_HALO_PATH); }
        else if (mat.shader != sh) mat.shader = sh;

        var noiseTex = AssetDatabase.LoadAssetAtPath<Texture2D>(TEX_RUNE_NOISE);
        if (noiseTex != null) mat.SetTexture("_NoiseTex", noiseTex);
        EditorUtility.SetDirty(mat);
        AssetDatabase.SaveAssets();
        Debug.Log($"[CairnUnity][SceneSetup] Halo material ensured at {MAT_HALO_PATH}");
    }

    private static void EnsureShadowMaterial()
    {
        var sh = Shader.Find(SHADOW_SHADER);
        if (sh == null) { Debug.LogError($"[CairnUnity][SceneSetup] Shader '{SHADOW_SHADER}' not found."); return; }
        if (!Directory.Exists(MAT_DIR)) Directory.CreateDirectory(MAT_DIR);

        var mat = AssetDatabase.LoadAssetAtPath<Material>(MAT_SHADOW_PATH);
        if (mat == null) { mat = new Material(sh); AssetDatabase.CreateAsset(mat, MAT_SHADOW_PATH); }
        else if (mat.shader != sh) mat.shader = sh;
        EditorUtility.SetDirty(mat);
        AssetDatabase.SaveAssets();
        Debug.Log($"[CairnUnity][SceneSetup] Shadow material ensured at {MAT_SHADOW_PATH}");
    }

    private static void EnsureParticleMaterial()
    {
        // URP/Particles/Unlit Additive with mote_soft.png
        var sh = Shader.Find(URP_PARTICLE_UNLIT);
        if (sh == null)
        {
            // Fall back to URP Lit if particle shader missing (shouldn't happen
            // with URP installed; warn loudly so we know).
            Debug.LogWarning($"[CairnUnity][SceneSetup] '{URP_PARTICLE_UNLIT}' not found; particles may not look correct.");
            sh = Shader.Find(URP_LIT);
        }
        if (sh == null) return;
        if (!Directory.Exists(MAT_DIR)) Directory.CreateDirectory(MAT_DIR);

        var mat = AssetDatabase.LoadAssetAtPath<Material>(MAT_PARTICLE_PATH);
        if (mat == null) { mat = new Material(sh); AssetDatabase.CreateAsset(mat, MAT_PARTICLE_PATH); }
        else if (mat.shader != sh) mat.shader = sh;

        var moteTex = AssetDatabase.LoadAssetAtPath<Texture2D>(TEX_MOTE);
        if (moteTex != null && mat.HasProperty("_BaseMap")) mat.SetTexture("_BaseMap", moteTex);
        // Set surface to Transparent + Additive blend if URP/Particles/Unlit
        if (mat.HasProperty("_Surface")) mat.SetFloat("_Surface", 1.0f); // 1=Transparent
        if (mat.HasProperty("_Blend"))   mat.SetFloat("_Blend",   1.0f); // 1=Additive
        EditorUtility.SetDirty(mat);
        AssetDatabase.SaveAssets();
        Debug.Log($"[CairnUnity][SceneSetup] Particle material ensured at {MAT_PARTICLE_PATH}");
    }

    private static VolumeProfile LoadOrCreateVolumeProfile()
    {
        const string profilePath = "Assets/Settings/CairnVolumeProfile.asset";
        var profile = AssetDatabase.LoadAssetAtPath<VolumeProfile>(profilePath);
        if (profile == null)
        {
            Directory.CreateDirectory("Assets/Settings");
            profile = ScriptableObject.CreateInstance<VolumeProfile>();
            AssetDatabase.CreateAsset(profile, profilePath);
            Debug.Log($"[CairnUnity][SceneSetup] Created Volume profile at {profilePath}");
        }
        // v186: retuned bloom for AR camera feed.
        // Threshold 1.05 means ONLY strand-emissive output (which exceeds 1.0
        // via _BloomBoost) blooms; ARCamera feed clamped 0-1 doesn't.
        // Without this, bloom blows out the whole camera feed.
        UnityEngine.Rendering.Universal.Bloom bloom;
        if (!profile.TryGet(out bloom))
        {
            bloom = profile.Add<UnityEngine.Rendering.Universal.Bloom>(true);
        }
        bloom.intensity.overrideState = true; bloom.intensity.value = 0.7f;   // was 1.5
        bloom.threshold.overrideState = true; bloom.threshold.value = 1.05f;  // was 0.7 (HDR-required)
        bloom.scatter.overrideState   = true; bloom.scatter.value   = 0.65f;  // was 0.7
        bloom.tint.overrideState      = true; bloom.tint.value      = Color.white;
        bloom.clamp.overrideState     = true; bloom.clamp.value     = 65472f; // max — don't pre-clip HDR

        // v199 review C5 fix: add Vignette + ColorAdjustments overrides
        // so CairnVolumeOverrides.OnEnable can profile.TryGet them.
        // Without these, OTA Vignette/ColorAdj toggles are inert at runtime.
        UnityEngine.Rendering.Universal.Vignette vignette;
        if (!profile.TryGet(out vignette))
        {
            vignette = profile.Add<UnityEngine.Rendering.Universal.Vignette>(true);
        }
        vignette.intensity.overrideState  = true; vignette.intensity.value  = 0.18f;
        vignette.smoothness.overrideState = true; vignette.smoothness.value = 0.45f;
        vignette.color.overrideState      = true; vignette.color.value      = Color.black;

        UnityEngine.Rendering.Universal.ColorAdjustments colorAdj;
        if (!profile.TryGet(out colorAdj))
        {
            colorAdj = profile.Add<UnityEngine.Rendering.Universal.ColorAdjustments>(true);
        }
        colorAdj.contrast.overrideState     = true; colorAdj.contrast.value     = 8f;
        colorAdj.saturation.overrideState   = true; colorAdj.saturation.value   = 12f;
        colorAdj.postExposure.overrideState = true; colorAdj.postExposure.value = 0f;

        EditorUtility.SetDirty(profile);
        AssetDatabase.SaveAssets();
        Debug.Log("[CairnUnity][SceneSetup] Volume configured (Bloom + Vignette + ColorAdjustments)");
        return profile;
    }

    /// <summary>
    /// Bloom threshold > 1.0 only works in HDR — otherwise the buffer
    /// clamps to 1.0 before the bloom pass samples it, and threshold 1.05
    /// becomes a silent no-op. Force HDR on the URP asset.
    /// </summary>
    private static void EnsureURPHDRAndBloom()
    {
        var rp = GraphicsSettings.currentRenderPipeline as UnityEngine.Rendering.Universal.UniversalRenderPipelineAsset;
        if (rp == null)
        {
            Debug.LogWarning("[CairnUnity][SceneSetup] currentRenderPipeline is not URP — bloom may not work as expected");
            return;
        }
        if (!rp.supportsHDR)
        {
            // HDR support is an internal field; expose via SerializedObject.
            var so = new SerializedObject(rp);
            var hdrProp = so.FindProperty("m_SupportsHDR");
            if (hdrProp != null)
            {
                hdrProp.boolValue = true;
                so.ApplyModifiedProperties();
                EditorUtility.SetDirty(rp);
                AssetDatabase.SaveAssets();
                Debug.Log("[CairnUnity][SceneSetup] URP HDR enabled (was off — bloom threshold>1.0 needs HDR)");
            }
            else
            {
                Debug.LogWarning("[CairnUnity][SceneSetup] Could not find m_SupportsHDR field on URP asset — verify HDR is enabled manually");
            }
        }
        else
        {
            Debug.Log("[CairnUnity][SceneSetup] URP HDR already enabled");
        }
    }

    private static void EnsureAlwaysIncludedShaders()
    {
        // Load GraphicsSettings asset to manipulate AlwaysIncludedShaders.
        // Without this, iOS IL2CPP build strips shaders not referenced in
        // an editor scene asset — and our halo/shadow shaders are referenced
        // only by runtime materials, which IS lossy.
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
        AddShaderIfMissing(arr, HALO_SHADER);
        AddShaderIfMissing(arr, SHADOW_SHADER);
        // v187.7.3 — DO NOT add URP/Lit or URP/Particles/Unlit to
        // AlwaysIncludedShaders. Adding them forces Unity 6 to compile
        // the FULL URP keyword matrix (294,912 variants for URP/Lit alone,
        // 8h iOS build). URP package's own ShaderStrippers correctly keep
        // the variants we actually use. Confirmed root cause of CI run #26
        // building 294K variants — the URP/Lit GUID was in the included
        // list, defeating URP's own stripper.
        // The Particles/Unlit material we use at runtime is created via
        // Shader.Find at PortalSpawner.EnsureMaterials(); URP package
        // shipping ensures it's available to Shader.Find on iOS players.
        so.ApplyModifiedProperties();
        AssetDatabase.SaveAssets();
        Debug.Log("[CairnUnity][SceneSetup] AlwaysIncludedShaders updated (strand+halo+shadow only — URP shaders left to URP package)");
    }

    private static void AddShaderIfMissing(SerializedProperty arr, string shaderName)
    {
        var sh = Shader.Find(shaderName);
        if (sh == null)
        {
            Debug.LogWarning($"[CairnUnity][SceneSetup] Shader not found: {shaderName} (will be skipped from AlwaysIncluded)");
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
