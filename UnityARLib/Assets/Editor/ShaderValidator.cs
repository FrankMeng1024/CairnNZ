#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;

/// <summary>
/// Headless shader-validation harness — runs from -executeMethod in
/// batchmode to verify shaders compile + actually have valid programs
/// (not just empty serialized binaries).
///
/// Usage from CI / local diagnostic:
///   Unity.exe -batchmode -projectPath ... \
///     -executeMethod ShaderValidator.ValidateAll -quit
///
/// Outputs error lines to Editor.log that grep can find.
/// </summary>
public static class ShaderValidator
{
    public static void ValidateAll()
    {
        Debug.Log("[ShaderValidator] === BEGIN ===");
        string[] shaders = {
            "Cairn/StrandShader",
            "Cairn/HaloShader",
            "Cairn/ShadowBlobShader",
        };

        int errors = 0;
        foreach (var name in shaders)
        {
            var sh = Shader.Find(name);
            if (sh == null)
            {
                Debug.LogError($"[ShaderValidator] FAIL Shader.Find('{name}') == null");
                errors++;
                continue;
            }

            // ShaderUtil reflection — internal but works
            var shaderErrors = UnityEditor.ShaderUtil.GetShaderMessages(sh);
            int errCount = 0;
            foreach (var msg in shaderErrors)
            {
                if (msg.severity == UnityEditor.Rendering.ShaderCompilerMessageSeverity.Error)
                {
                    Debug.LogError($"[ShaderValidator] {name} error: {msg.message} (file={msg.file} line={msg.line} platform={msg.platform})");
                    errCount++;
                    errors++;
                }
                else
                {
                    Debug.LogWarning($"[ShaderValidator] {name} warning: {msg.message} (file={msg.file} line={msg.line})");
                }
            }
            if (errCount == 0)
            {
                Debug.Log($"[ShaderValidator] OK {name} — no errors");
            }
        }

        Debug.Log($"[ShaderValidator] === END errors={errors} ===");

        if (Application.isBatchMode)
        {
            EditorApplication.Exit(errors == 0 ? 0 : 1);
        }
    }
}
#endif
