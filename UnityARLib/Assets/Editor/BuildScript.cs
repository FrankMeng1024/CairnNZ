using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.XR.Management;
using UnityEditor.XR.Management.Metadata;
using UnityEngine;
using UnityEngine.XR.Management;
using System;
using System.IO;

/// <summary>
/// CI iOS build entry. Invoked headlessly by game-ci/unity-builder via
/// -executeMethod BuildScript.BuildIOS.
///
/// Behavior:
///   1. Always re-runs SceneSetup.SetupAndSave() so CI is deterministic
///      regardless of what was committed (the scene asset itself is
///      committed but we still rebuild it to handle minor Unity-version
///      drift; CI Unity version is now pinned to 6000.0.76f1 to match
///      ProjectVersion.txt and avoid GUID/serialization skew).
///   2. Validates required files exist (StrandShader, scene, scripts).
///   3. Configures iOS player settings.
///   4. Runs BuildPipeline.BuildPlayer; fails loud if build report
///      indicates anything other than Succeeded.
/// </summary>
public class BuildScript
{
    public static void BuildIOS()
    {
        Console.WriteLine("[CairnUnity][BuildScript] === BuildIOS START ===");

        // Step 0: Ensure TMP Essential Resources are imported. CI fresh
        // checkout has the TMP package but NOT the project-side
        // "Assets/TextMesh Pro/Resources/Fonts & Materials/LiberationSans
        // SDF.asset" — that asset is generated when essentials are imported.
        // Without it SceneSetup's font lookup returns null and PortalSpawnerV199
        // silently skips RuneText + LikeBadge text rendering (fail-soft null
        // check). Idempotent — imports are silent and re-imports are a no-op
        // when the asset already exists.
        try
        {
            const string tmpProbe = "Assets/TextMesh Pro/Resources/Fonts & Materials/LiberationSans SDF.asset";
            if (!File.Exists(tmpProbe))
            {
                Console.WriteLine("[CairnUnity][BuildScript] TMP Essentials not present — importing silently");
                TMPro.TMP_PackageResourceImporter.ImportResources(
                    importEssentials: true, importExamples: false, interactive: false);
                AssetDatabase.Refresh();
                Console.WriteLine($"[CairnUnity][BuildScript] TMP Essentials import done; probe exists: {File.Exists(tmpProbe)}");
            }
            else
            {
                Console.WriteLine("[CairnUnity][BuildScript] TMP Essentials already present — skipping import");
            }
        }
        catch (Exception e)
        {
            // Non-fatal: SceneSetup will null-check and PortalSpawnerV199
            // already fail-soft skips. Log loud so CI Editor.log shows it.
            Console.WriteLine($"[CairnUnity][BuildScript][WARN] TMP Essentials import failed (non-fatal): {e}");
        }

        // Step 1: Run scene setup (programmatic, deterministic)
        try
        {
            SceneSetup.SetupAndSave();
        }
        catch (Exception e)
        {
            Console.WriteLine($"[CairnUnity][BuildScript][ERROR] SceneSetup failed: {e}");
            EditorApplication.Exit(1);
            return;
        }

        // Step 1b: Enable ARKit XR Loader for iOS so ARSession.state can
        // advance to SessionTracking on device. Without this, AR Foundation
        // initializes but never finds a working subsystem and ARSession
        // state stays at Unsupported.
        try
        {
            EnableArkitLoader();
        }
        catch (Exception e)
        {
            Console.WriteLine($"[CairnUnity][BuildScript][ERROR] EnableArkitLoader failed: {e}");
            EditorApplication.Exit(1);
            return;
        }

        // Step 2: Validate prerequisites
        if (!ValidatePrerequisites())
        {
            Console.WriteLine("[CairnUnity][BuildScript][ERROR] Prerequisites missing — abort");
            EditorApplication.Exit(1);
            return;
        }

        // Step 3: Configure iOS settings
        ConfigureIOSPlayer();

        // Step 4: Build
        var scenes = GetEnabledScenes();
        Console.WriteLine($"[CairnUnity][BuildScript] Building with {scenes.Length} scenes: {string.Join(",", scenes)}");

        var opts = new BuildPlayerOptions
        {
            scenes           = scenes,
            locationPathName = "builds/iOS",
            target           = BuildTarget.iOS,
            options          = BuildOptions.None,
        };

        BuildReport report = BuildPipeline.BuildPlayer(opts);

        if (report.summary.result != BuildResult.Succeeded)
        {
            Console.WriteLine($"[CairnUnity][BuildScript][ERROR] Build FAILED: {report.summary.result}");
            Console.WriteLine($"[CairnUnity][BuildScript][ERROR] errors={report.summary.totalErrors} warnings={report.summary.totalWarnings}");
            EditorApplication.Exit(1);
            return;
        }

        Console.WriteLine($"[CairnUnity][BuildScript] === BuildIOS SUCCEEDED size={report.summary.totalSize} bytes ===");
        EditorApplication.Exit(0);
    }

    private static bool ValidatePrerequisites()
    {
        var required = new[]
        {
            "Assets/Shaders/StrandShader.shader",
            "Assets/Scripts/CairnBridge.cs",
            "Assets/Scripts/MultiSpawner.cs",
            "Assets/Scripts/UnityLogger.cs",
            "Assets/Scripts/UnityNativeBridge.cs",
            "Assets/Editor/SceneSetup.cs",
            "Assets/Scenes/CairnAR.unity",
        };

        bool ok = true;
        foreach (var path in required)
        {
            if (!File.Exists(path))
            {
                Console.WriteLine($"[CairnUnity][BuildScript][ERROR] Missing required file: {path}");
                ok = false;
            }
        }

        // Verify shader is loadable
        var shader = Shader.Find("Cairn/StrandShader");
        if (shader == null)
        {
            Console.WriteLine("[CairnUnity][BuildScript][ERROR] Cairn/StrandShader cannot be loaded by name.");
            ok = false;
        }

        return ok;
    }

    private static void ConfigureIOSPlayer()
    {
        PlayerSettings.SetScriptingBackend(BuildTargetGroup.iOS, ScriptingImplementation.IL2CPP);

        // Target SDK: real device
        PlayerSettings.iOS.sdkVersion           = iOSSdkVersion.DeviceSDK;
        PlayerSettings.iOS.targetOSVersionString = "14.0";
        PlayerSettings.iOS.requiresPersistentWiFi = false;

        // Required for ARKit
        PlayerSettings.iOS.cameraUsageDescription = "Cairn uses the camera for AR.";

        // Disable bitcode (deprecated in modern Xcode)
        // (PlayerSettings exposes this as an iOS-specific bool only via SerializedObject in some
        // versions; we leave it default and let xcodebuild strip if needed.)

        Console.WriteLine("[CairnUnity][BuildScript] iOS player configured: IL2CPP, iOS 14+, camera permission set");
    }

    private static string[] GetEnabledScenes()
    {
        var list = new System.Collections.Generic.List<string>();
        foreach (var s in EditorBuildSettings.scenes)
        {
            if (s.enabled) list.Add(s.path);
        }
        return list.ToArray();
    }

    /// <summary>
    /// Programmatically enable the ARKit XR Loader for iOS in XR Plug-in
    /// Management. Without this, ARSession.state stays at Unsupported on
    /// device and the entire Spike collapses.
    /// </summary>
    private static void EnableArkitLoader()
    {
        const string ARKitLoaderType = "UnityEngine.XR.ARKit.ARKitLoader";

        // Get-or-create XRGeneralSettings asset for iOS build target group.
        var settings = XRGeneralSettingsPerBuildTarget.XRGeneralSettingsForBuildTarget(BuildTargetGroup.iOS);
        if (settings == null)
        {
            Console.WriteLine("[CairnUnity][BuildScript] Creating new XRGeneralSettings for iOS");
            // Create the settings for iOS via XRGeneralSettingsPerBuildTarget
            XRGeneralSettingsPerBuildTarget perBuildTarget;
            if (!EditorBuildSettings.TryGetConfigObject(XRGeneralSettings.k_SettingsKey, out perBuildTarget))
            {
                perBuildTarget = ScriptableObject.CreateInstance<XRGeneralSettingsPerBuildTarget>();
                const string assetPath = "Assets/XR/XRGeneralSettingsPerBuildTarget.asset";
                Directory.CreateDirectory(Path.GetDirectoryName(assetPath));
                AssetDatabase.CreateAsset(perBuildTarget, assetPath);
                EditorBuildSettings.AddConfigObject(XRGeneralSettings.k_SettingsKey, perBuildTarget, true);
            }
            // Create general settings for iOS
            var general = ScriptableObject.CreateInstance<XRGeneralSettings>();
            general.Manager = ScriptableObject.CreateInstance<XRManagerSettings>();
            general.Manager.name = "iOS XR Manager";
            AssetDatabase.AddObjectToAsset(general,         perBuildTarget);
            AssetDatabase.AddObjectToAsset(general.Manager, perBuildTarget);
            perBuildTarget.SetSettingsForBuildTarget(BuildTargetGroup.iOS, general);
            settings = general;
        }

        if (settings.Manager == null)
        {
            settings.Manager = ScriptableObject.CreateInstance<XRManagerSettings>();
            Console.WriteLine("[CairnUnity][BuildScript] Created XRManagerSettings for iOS");
        }

        // Assign the ARKit loader (idempotent — no-op if already assigned)
        bool ok = XRPackageMetadataStore.AssignLoader(settings.Manager, ARKitLoaderType, BuildTargetGroup.iOS);
        if (!ok)
        {
            // Could be already assigned, or package metadata not yet loaded.
            // Try waiting for package metadata to populate.
            Console.WriteLine($"[CairnUnity][BuildScript] AssignLoader returned false (loader may already be assigned)");
        }
        else
        {
            Console.WriteLine($"[CairnUnity][BuildScript] ARKit loader assigned to iOS");
        }

        EditorUtility.SetDirty(settings);
        EditorUtility.SetDirty(settings.Manager);
        AssetDatabase.SaveAssets();

        // Verify
        bool present = false;
        if (settings.Manager.activeLoaders != null)
        {
            foreach (var loader in settings.Manager.activeLoaders)
            {
                if (loader != null && loader.GetType().FullName == ARKitLoaderType)
                {
                    present = true;
                    break;
                }
            }
        }
        Console.WriteLine($"[CairnUnity][BuildScript] ARKit loader active in XRManager: {present}");

        if (!present)
        {
            Console.WriteLine("[CairnUnity][BuildScript][ERROR] ARKit loader could not be verified active. " +
                              "Build would produce a non-functional xcframework — failing now.");
            throw new System.InvalidOperationException("ARKit XR loader not active after assignment");
        }
    }
}
