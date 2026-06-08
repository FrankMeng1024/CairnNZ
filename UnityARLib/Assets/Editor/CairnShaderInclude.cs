#if UNITY_EDITOR
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.Rendering;
using UnityEngine;
using UnityEngine.Rendering;
using System.Collections.Generic;

/// <summary>
/// At build time, ensure all Cairn/* shaders are present in the
/// "Always Included Shaders" list of GraphicsSettings. Otherwise, runtime
/// Shader.Find("Cairn/PortalRingShader") returns null in the standalone
/// player because no scene-loaded material directly references the shader,
/// and Unity strips it.
///
/// This runs before any build (BuildPipeline.BuildPlayer triggered manually
/// or via ShaderTestbedBuilder). It mutates GraphicsSettings.asset; the
/// change is committed on disk and shows up in the player.
/// </summary>
public class CairnShaderInclude : IPreprocessBuildWithReport
{
    public int callbackOrder => 0;

    public void OnPreprocessBuild(BuildReport report)
    {
        EnsureCairnShadersIncluded();
    }

    [MenuItem("Cairn/Sync Always-Included Shaders")]
    public static void SyncFromMenu() { EnsureCairnShadersIncluded(); }

    private static readonly string[] CAIRN_SHADER_NAMES = new[]
    {
        "Cairn/PortalRingShader",
        "Cairn/WispShader",
        "Cairn/StrandShader",
        "Cairn/HaloShader",
        "Cairn/ShadowBlobShader",
        // v187.7 fix Arch Critical #6: PortalSpawner runtime calls
        // Shader.Find("Universal Render Pipeline/Particles/Unlit") for
        // both firefly material and ground halo material. Sprites/Default
        // is the secondary fallback. Both must be in AlwaysIncludedShaders
        // for Shader.Find() to resolve in IL2CPP iOS build, or fireflies +
        // halo render magenta.
        "Universal Render Pipeline/Particles/Unlit",
        "Sprites/Default",
    };

    private static void EnsureCairnShadersIncluded()
    {
        var graphicsSettings = AssetDatabase.LoadAssetAtPath<GraphicsSettings>(
            "ProjectSettings/GraphicsSettings.asset");
        if (graphicsSettings == null)
        {
            Debug.LogError("[CairnShaderInclude] GraphicsSettings.asset not found");
            return;
        }

        var so = new SerializedObject(graphicsSettings);
        var arr = so.FindProperty("m_AlwaysIncludedShaders");
        if (arr == null) { Debug.LogError("[CairnShaderInclude] m_AlwaysIncludedShaders not found"); return; }

        // Build set of currently included shader assets to dedupe.
        var existing = new HashSet<Object>();
        for (int i = 0; i < arr.arraySize; i++)
        {
            var elem = arr.GetArrayElementAtIndex(i);
            var obj = elem.objectReferenceValue;
            if (obj != null) existing.Add(obj);
        }

        int added = 0;
        foreach (var name in CAIRN_SHADER_NAMES)
        {
            var shader = Shader.Find(name);
            if (shader == null)
            {
                Debug.LogWarning($"[CairnShaderInclude] {name} not found — skipping");
                continue;
            }
            if (existing.Contains(shader))
            {
                Debug.Log($"[CairnShaderInclude] {name} already included");
                continue;
            }
            arr.arraySize++;
            arr.GetArrayElementAtIndex(arr.arraySize - 1).objectReferenceValue = shader;
            added++;
            Debug.Log($"[CairnShaderInclude] + {name}");
        }

        if (added > 0)
        {
            so.ApplyModifiedProperties();
            AssetDatabase.SaveAssets();
            Debug.Log($"[CairnShaderInclude] Added {added} shader(s) to AlwaysIncludedShaders");
        }
        else
        {
            Debug.Log($"[CairnShaderInclude] All Cairn shaders already in AlwaysIncludedShaders");
        }
    }
}
#endif
