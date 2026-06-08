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
            if (Application.isBatchMode) EditorApplication.Exit(1);
            return;
        }

        Debug.Log($"[TestbedBuilder] === SUCCESS — exe at {OUTPUT_DIR}/{EXE_NAME} ===");
        if (Application.isBatchMode) EditorApplication.Exit(0);
    }
}
#endif
