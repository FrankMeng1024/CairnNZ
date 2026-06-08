#if UNITY_EDITOR
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Rendering;
using UnityEngine.Rendering;

/// <summary>
/// Aggressive shader variant stripper — STANDALONE BUILDS ONLY.
///
/// CRITICAL safety gate (Arch review v187 Blocker #3):
///   IPreprocessShaders runs for EVERY build target including iOS. Without
///   the BuildTarget guard, this stripper would aggressively kill URP/Lit
///   variants on the iOS production build, breaking ARCameraBackground and
///   any URP/Lit ground/marker materials → black screen on device.
///
/// We use EditorUserBuildSettings.activeBuildTarget to detect that the
/// current build is targeting Windows/Mac standalone — only then do we
/// strip. iOS / Android / WebGL pass through unchanged so URP keeps its
/// full keyword matrix for the production AR scene.
///
/// On standalone we drop:
///   • Everything outside Cairn/* and a few Hidden/URP essentials
///   • All but 1 variant of URP/Lit, URP/Simple Lit, URP/Complex Lit,
///     URP/Unlit, URP/Particles/*  — since the testbed scene only uses a
///     dark ground plane, the bare variant is fine
/// Net standalone build time: 2.5h → ~80s.
/// </summary>
public class ShaderVariantStripper : IPreprocessShaders
{
    public int callbackOrder => 0;

    public void OnProcessShader(UnityEngine.Shader shader,
                                ShaderSnippetData snippet,
                                IList<ShaderCompilerData> data)
    {
        // Hard gate: do nothing on non-standalone (iOS/Android/WebGL).
        var t = EditorUserBuildSettings.activeBuildTarget;
        bool isStandalone = t == BuildTarget.StandaloneWindows64
                         || t == BuildTarget.StandaloneWindows
                         || t == BuildTarget.StandaloneOSX
                         || t == BuildTarget.StandaloneLinux64;
        if (!isStandalone) return;

        string name = shader.name;

        // Keep all Cairn shader variants — these are what we're testing.
        if (name.StartsWith("Cairn/")) return;

        // Keep absolute essentials for URP to render anything at all
        // (depth/copy/blit/etc). These are tiny.
        if (name.StartsWith("Hidden/Universal Render Pipeline/")) return;
        if (name.StartsWith("Hidden/Core/")) return;
        if (name.StartsWith("Hidden/BlitCopy")) return;

        // For URP Lit and Particles: strip everything but 1 variant. Testbed
        // ground is a static dark color — it will render with whatever single
        // variant URP keeps internally.
        if (name == "Universal Render Pipeline/Lit" ||
            name == "Universal Render Pipeline/Simple Lit" ||
            name == "Universal Render Pipeline/Complex Lit" ||
            name == "Universal Render Pipeline/Unlit" ||
            name.StartsWith("Universal Render Pipeline/Particles"))
        {
            while (data.Count > 1) data.RemoveAt(data.Count - 1);
            return;
        }

        // For everything else (legacy, Standard, etc): drop entirely.
        // Testbed doesn't use them.
        data.Clear();
    }
}
#endif
