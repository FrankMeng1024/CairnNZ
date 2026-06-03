using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using System;
using System.IO;

public class BuildScript
{
    public static void BuildIOS()
    {
        // Ensure at least one scene exists and is in build settings
        EnsureSpikeSceneExists();

        BuildPlayerOptions opts = new BuildPlayerOptions
        {
            scenes = GetScenes(),
            locationPathName = "builds/iOS",
            target = BuildTarget.iOS,
            options = BuildOptions.None
        };

        PlayerSettings.SetScriptingBackend(
            BuildTargetGroup.iOS, ScriptingImplementation.IL2CPP);
        PlayerSettings.iOS.sdkVersion = iOSSdkVersion.DeviceSDK;
        PlayerSettings.iOS.targetOSVersionString = "14.0";

        BuildReport report = BuildPipeline.BuildPlayer(opts);
        if (report.summary.result != BuildResult.Succeeded)
        {
            Console.WriteLine("[BuildScript] Build FAILED: " + report.summary.result);
            EditorApplication.Exit(1);
        }

        Console.WriteLine("[BuildScript] Build SUCCEEDED");
        EditorApplication.Exit(0);
    }

    private static void EnsureSpikeSceneExists()
    {
        const string scenePath = "Assets/Scenes/SpikeScene.unity";

        // Create empty scene file if missing
        if (!File.Exists(scenePath))
        {
            Directory.CreateDirectory("Assets/Scenes");
            var newScene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);
            EditorSceneManager.SaveScene(newScene, scenePath);
            Console.WriteLine("[BuildScript] Created spike scene at " + scenePath);
        }

        // Ensure the scene is enabled in EditorBuildSettings
        var existing = EditorBuildSettings.scenes;
        bool found = false;
        for (int i = 0; i < existing.Length; i++)
        {
            if (existing[i].path == scenePath)
            {
                existing[i] = new EditorBuildSettingsScene(scenePath, true);
                found = true;
                break;
            }
        }

        if (!found)
        {
            var list = new System.Collections.Generic.List<EditorBuildSettingsScene>(existing);
            list.Add(new EditorBuildSettingsScene(scenePath, true));
            EditorBuildSettings.scenes = list.ToArray();
            Console.WriteLine("[BuildScript] Added spike scene to EditorBuildSettings");
        }
    }

    private static string[] GetScenes()
    {
        var scenes = new System.Collections.Generic.List<string>();
        foreach (var s in EditorBuildSettings.scenes)
            if (s.enabled) scenes.Add(s.path);
        return scenes.ToArray();
    }
}
