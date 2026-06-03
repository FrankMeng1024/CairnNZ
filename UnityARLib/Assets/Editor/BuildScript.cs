using UnityEditor;
using UnityEditor.Build.Reporting;
using System;

public class BuildScript
{
    public static void BuildIOS()
    {
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

        // Unity as a Library export mode
        PlayerSettings.iOS.allowHTTPDownload = false;

        BuildReport report = BuildPipeline.BuildPlayer(opts);
        if (report.summary.result != BuildResult.Succeeded)
        {
            Console.WriteLine("[BuildScript] Build FAILED: " + report.summary.result);
            EditorApplication.Exit(1);
        }

        Console.WriteLine("[BuildScript] Build SUCCEEDED");
        EditorApplication.Exit(0);
    }

    private static string[] GetScenes()
    {
        var scenes = new System.Collections.Generic.List<string>();
        foreach (var s in EditorBuildSettings.scenes)
            if (s.enabled) scenes.Add(s.path);
        return scenes.ToArray();
    }
}
