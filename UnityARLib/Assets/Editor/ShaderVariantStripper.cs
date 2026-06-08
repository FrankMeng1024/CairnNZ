#if UNITY_EDITOR
using System.Collections.Generic;
using UnityEditor.Build;
using UnityEditor.Rendering;
using UnityEngine.Rendering;

/// <summary>
/// Aggressive shader variant stripper for the ShaderTestbed standalone player.
///
/// Without this, Unity attempts to compile ~294,912 variants for the URP Lit
/// shader alone (every keyword combo across every quality level). The testbed
/// scene only needs:
///   • Cairn/* shaders (Strand, Halo, ShadowBlob, Particle) — keep ALL
///   • Universal Render Pipeline/Lit — only the bare minimum (1 variant)
///   • Hidden/Internal-* and Sprites — let URP keep its defaults
///
/// This stripper drops ANY variant for URP Lit/Particles/Unlit because the
/// testbed scene's only URP/Lit usage is a static dark ground plane that
/// renders fine with the fallback. Net effect: build drops from ~2.5h to
/// ~30s.
/// </summary>
public class ShaderVariantStripper : IPreprocessShaders
{
    public int callbackOrder => 0;

    public void OnProcessShader(UnityEngine.Shader shader,
                                ShaderSnippetData snippet,
                                IList<ShaderCompilerData> data)
    {
        string name = shader.name;

        // Keep all Cairn shader variants — these are what we're testing.
        if (name.StartsWith("Cairn/")) return;

        // Keep absolute essentials for URP to render anything at all
        // (depth/copy/blit/etc). These are tiny.
        if (name.StartsWith("Hidden/Universal Render Pipeline/")) return;
        if (name.StartsWith("Hidden/Core/")) return;
        if (name.StartsWith("Hidden/BlitCopy")) return;

        // For URP Lit and Particles: strip everything. Testbed ground is a
        // static dark color — it will render with whatever single variant
        // URP keeps internally. If ground renders magenta, that's fine —
        // we are looking at the Cairn strands, not the ground.
        if (name == "Universal Render Pipeline/Lit" ||
            name == "Universal Render Pipeline/Simple Lit" ||
            name == "Universal Render Pipeline/Complex Lit" ||
            name == "Universal Render Pipeline/Unlit" ||
            name.StartsWith("Universal Render Pipeline/Particles"))
        {
            // Keep only 1 variant (the first one) so the shader loads at
            // all but doesn't blow build time.
            while (data.Count > 1) data.RemoveAt(data.Count - 1);
            return;
        }

        // For everything else (legacy, Standard, etc): drop entirely.
        // Testbed doesn't use them.
        data.Clear();
    }
}
#endif
