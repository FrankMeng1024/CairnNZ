#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;
using UnityEditor.Build.Reporting;
using System.IO;

/// <summary>
/// Build a standalone Win64 player containing only the ShaderTestbed
/// scene. The player runs the real URP pipeline with a real GPU device,
/// bypassing all batchmode rendering limitations.
///
/// Usage from CLI:
///   Unity.exe -batchmode -projectPath UnityARLib \
///     -executeMethod ShaderTestbedBuilder.BuildWindowsPlayer -quit
///
/// Output: Builds/ShaderTestbed/ShaderTestbed.exe
///
/// Then run the player:
///   ShaderTestbed.exe --type danger --out frame.png
/// </summary>
public static class ShaderTestbedBuilder
{
    public const string OUTPUT_DIR = "Builds/ShaderTestbed";
    public const string EXE_NAME   = "ShaderTestbed.exe";
    public const string TESTBED_SCENE = "Assets/Scenes/ShaderTestbed.unity";

    [MenuItem("Cairn/Build Shader Testbed Player")]
    public static void BuildFromMenu() { BuildWindowsPlayer(); }

    public static void BuildWindowsPlayer()
    {
        Debug.Log("[TestbedBuilder] === START ===");

        // 1. Build ShaderTestbed scene (idempotent)
        try
        {
            ShaderTestbedSceneBuilder.BuildScene();
        }
        catch (System.Exception e)
        {
            Debug.LogError($"[TestbedBuilder] BuildScene threw: {e}");
            if (Application.isBatchMode) EditorApplication.Exit(1);
            return;
        }

        Directory.CreateDirectory(OUTPUT_DIR);

        // v187.7.2 — Testbed needs GraphicsSettings.defaultRenderPipeline
        // wired so the standalone player's first frame finds URP. iOS
        // production deliberately leaves it null (avoids 294k URP variant
        // explosion → 8h build). Save + restore around the standalone
        // build so we don't dirty the production checkout.
        var savedDefaultRP = UnityEngine.Rendering.GraphicsSettings.defaultRenderPipeline;
        var rpAsset = AssetDatabase.LoadAssetAtPath<UnityEngine.Rendering.Universal.UniversalRenderPipelineAsset>("Assets/Settings/CairnURP.asset");
        if (rpAsset != null)
        {
            UnityEngine.Rendering.GraphicsSettings.defaultRenderPipeline = rpAsset;
            Debug.Log("[TestbedBuilder] GraphicsSettings.defaultRenderPipeline → CairnURP (testbed-only)");
        }
        try
        {

        // 2. Configure build settings
        var buildOptions = new BuildPlayerOptions
        {
            scenes = new[] { TESTBED_SCENE },
            locationPathName = Path.Combine(OUTPUT_DIR, EXE_NAME),
            target = BuildTarget.StandaloneWindows64,
            targetGroup = BuildTargetGroup.Standalone,
            options = BuildOptions.Development | BuildOptions.AllowDebugging,
        };

        // Force the standalone player to use URP (the active RP asset
        // wired by SceneSetup). Without this, standalone fallback may
        // pick up the legacy built-in pipeline.
        // (The URP asset is already in GraphicsSettings, so just trust it.)

        Debug.Log($"[TestbedBuilder] Building {EXE_NAME} → {OUTPUT_DIR}/");
        BuildReport report = BuildPipeline.BuildPlayer(buildOptions);
        BuildSummary summary = report.summary;

        Debug.Log($"[TestbedBuilder] Build result: {summary.result}");
        Debug.Log($"[TestbedBuilder] Total size: {summary.totalSize} bytes");
        Debug.Log($"[TestbedBuilder] Total time: {summary.totalTime}");
        Debug.Log($"[TestbedBuilder] Errors: {summary.totalErrors}");
        Debug.Log($"[TestbedBuilder] Warnings: {summary.totalWarnings}");

        if (summary.result != BuildResult.Succeeded)
        {
            Debug.LogError("[TestbedBuilder] BUILD FAILED");
            // Restore default RP before exit
            UnityEngine.Rendering.GraphicsSettings.defaultRenderPipeline = savedDefaultRP;
            if (Application.isBatchMode) EditorApplication.Exit(1);
            return;
        }

        Debug.Log($"[TestbedBuilder] === SUCCESS — exe at {OUTPUT_DIR}/{EXE_NAME} ===");
        }
        finally
        {
            // Always restore the production GraphicsSettings.defaultRenderPipeline
            // (null for iOS) so subsequent iOS builds don't pick up the testbed
            // setting. v187.7.2 critical: without this, the testbed run would
            // leave master with the URP wired into GraphicsSettings → next
            // iOS CI re-introduces the 294k variant explosion.
            UnityEngine.Rendering.GraphicsSettings.defaultRenderPipeline = savedDefaultRP;
            Debug.Log("[TestbedBuilder] Restored GraphicsSettings.defaultRenderPipeline to pre-testbed state.");
        }
        if (Application.isBatchMode) EditorApplication.Exit(0);
    }
}
#endif
