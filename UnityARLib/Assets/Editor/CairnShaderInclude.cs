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
        // v199 cinematic-rebuild Phase 2 shaders. Same reasoning: Unity
        // strips these without a scene-loaded material reference unless
        // we explicitly add them to AlwaysIncludedShaders.
        "Cairn/PebbleShader",
        "Cairn/TypeChipShader",
        "Cairn/StoneBackplateShader",
        "Cairn/RibbonStrandShader",
        "Cairn/LightShaftShader",
        "Cairn/ScanningGridShader",
        "Cairn/ConfidenceRingShader",
        "Cairn/HandshakeBeamShader",
        // v187.7.3 — DO NOT add "Universal Render Pipeline/*" shaders here.
        // Doing so forces Unity 6 to compile the full URP keyword matrix
        // (URP/Lit alone = 294,912 variants → 8h iOS build, root cause of
        // CI run #26). URP package's own ShaderStrippers correctly keep
        // only the variants the project actually uses.
        // Sprites/Default is a Unity built-in (fileID 10753 already in the
        // legacy include block above), no need to add by GUID.
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
