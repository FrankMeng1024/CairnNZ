#if UNITY_EDITOR
using UnityEditor;
using UnityEngine;
using System.IO;

/// <summary>
/// TMP requires a "TMP Essentials" package import once per project (creates
/// TMP Settings + default font asset). Without it, runtime TMP creation
/// throws NullReferenceException on TMP_Settings.autoSizeTextContainer.
///
/// Unity does not expose a stable public API for this, so we extract the
/// TMP Essentials.unitypackage shipped with com.unity.ugui to a known path
/// and use AssetDatabase.ImportPackage. Idempotent: skips if TMP_Settings
/// already exists.
/// </summary>
public static class TMPEssentialsImporter
{
    [MenuItem("Cairn/Import TMP Essentials")]
    public static void Run()
    {
        if (TMPro.TMP_Settings.instance != null && TMPro.TMP_Settings.defaultFontAsset != null)
        {
            Debug.Log("[TMPEssentialsImporter] TMP_Settings + defaultFontAsset already present — skipping.");
            return;
        }

        // Locate the TMP Essentials package inside com.unity.ugui Package Resources.
        string[] guids = AssetDatabase.FindAssets("TMP Essential Resources t:DefaultAsset");
        string packagePath = null;
        foreach (var guid in guids)
        {
            var p = AssetDatabase.GUIDToAssetPath(guid);
            if (p.EndsWith(".unitypackage") || p.EndsWith("Resources"))
            {
                packagePath = p; break;
            }
        }

        if (packagePath == null)
        {
            // Try direct package paths.
            string[] tryPaths = new[]
            {
                "Packages/com.unity.ugui/Package Resources/TMP Essential Resources.unitypackage",
                "Library/PackageCache/com.unity.ugui/Package Resources/TMP Essential Resources.unitypackage",
            };
            foreach (var p in tryPaths)
            {
                if (File.Exists(p)) { packagePath = p; break; }
            }
            // Glob the PackageCache hash-suffixed dir.
            if (packagePath == null)
            {
                var pkgCache = "Library/PackageCache";
                if (Directory.Exists(pkgCache))
                {
                    foreach (var dir in Directory.GetDirectories(pkgCache, "com.unity.ugui*"))
                    {
                        var p = Path.Combine(dir, "Package Resources", "TMP Essential Resources.unitypackage");
                        if (File.Exists(p)) { packagePath = p; break; }
                    }
                }
            }
        }

        if (packagePath != null)
        {
            Debug.Log($"[TMPEssentialsImporter] Importing {packagePath} ...");
            AssetDatabase.ImportPackage(packagePath, false); // false = no interactive dialog
            AssetDatabase.Refresh();
        }
        else
        {
            Debug.LogWarning("[TMPEssentialsImporter] Could not locate TMP Essentials package — falling back to manual font creation.");
            CreateMinimalFallbackFont();
        }
    }

    /// <summary>
    /// If TMP package import isn't available, create a minimal TMP_FontAsset
    /// from Unity's built-in Arial. This is a fallback path; full import is
    /// preferred. Saves to Assets/TMPFallback/.
    /// </summary>
    private static void CreateMinimalFallbackFont()
    {
        const string DIR = "Assets/TMPFallback";
        Directory.CreateDirectory(DIR);

        // Unity 6 removed Arial.ttf from Resources, but LiberationSans is the
        // built-in default. Try to locate a system TTF.
        var builtin = Resources.GetBuiltinResource<Font>("LiberationSans.ttf");
        if (builtin == null)
        {
            Debug.LogError("[TMPEssentialsImporter] LiberationSans.ttf not found");
            return;
        }
        var asset = TMPro.TMP_FontAsset.CreateFontAsset(builtin);
        AssetDatabase.CreateAsset(asset, $"{DIR}/FallbackFont.asset");
        AssetDatabase.SaveAssets();
        Debug.Log($"[TMPEssentialsImporter] Created fallback font asset at {DIR}/FallbackFont.asset");
    }
}
#endif
