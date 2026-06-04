#if UNITY_EDITOR && UNITY_IOS
using UnityEditor;
using UnityEditor.Callbacks;
using UnityEditor.iOS.Xcode;
using UnityEditor.iOS.Xcode.Extensions;
using UnityEngine;
using System.IO;

/// <summary>
/// Post-process Unity's iOS export so the resulting UnityFramework.xcframework
/// is consumable by @azesmway/react-native-unity:
///
///   1. NativeCallProxy.h marked as PUBLIC header in UnityFramework target
///      -> ends up in UnityFramework.framework/Headers/NativeCallProxy.h
///   2. NativeCallProxy.mm compiled into UnityFramework binary (and removed
///      from Unity-iPhone app target to avoid duplicate symbols)
///   3. Data folder added to UnityFramework's Resources Copy phase (and
///      removed from app target) so scenes load at runtime
///   4. UnityFramework target build settings hardened for archive
/// </summary>
public static class IOSPostProcess
{
    [PostProcessBuild(999)]
    public static void OnPostProcessBuild(BuildTarget target, string pathToBuiltProject)
    {
        if (target != BuildTarget.iOS) return;

        Debug.Log("[CairnUnity][IOSPostProcess] === START ===");

        var pbxPath = PBXProject.GetPBXProjectPath(pathToBuiltProject);
        if (!File.Exists(pbxPath))
        {
            Debug.LogError($"[CairnUnity][IOSPostProcess] pbxproj not found at {pbxPath}");
            return;
        }

        var pbx = new PBXProject();
        pbx.ReadFromFile(pbxPath);

        var appTargetGuid = pbx.GetUnityMainTargetGuid();
        var fwTargetGuid  = pbx.GetUnityFrameworkTargetGuid();
        Debug.Log($"[CairnUnity][IOSPostProcess] App target GUID: {appTargetGuid}");
        Debug.Log($"[CairnUnity][IOSPostProcess] Framework target GUID: {fwTargetGuid}");

        // ─── 1. Make NativeCallProxy.h public in UnityFramework ────────────
        // Unity exports plugins under "Libraries/Plugins/iOS/...". If a
        // different layout is encountered, the FindFileGuid lookup returns
        // null and we log loud — better than silent failure.
        FixNativeCallProxyHeader(pbx, fwTargetGuid);

        // ─── 2. Compile NativeCallProxy.mm into UnityFramework only ───────
        FixNativeCallProxyImpl(pbx, appTargetGuid, fwTargetGuid);

        // ─── 3. Move Data folder to UnityFramework Resources ──────────────
        FixDataFolder(pbx, appTargetGuid, fwTargetGuid, pathToBuiltProject);

        // ─── 4. UnityFramework build settings for distribution ────────────
        // Note: BUILD_LIBRARY_FOR_DISTRIBUTION is NOT set here — it's known to
        // break Unity UaaL archive (Unity's ObjC++ TUs are not annotated for
        // distribution). xcodebuild archive sets it via flags if needed.
        pbx.SetBuildProperty(fwTargetGuid,  "DEFINES_MODULE",        "YES");
        pbx.SetBuildProperty(fwTargetGuid,  "ENABLE_BITCODE",        "NO");
        pbx.SetBuildProperty(fwTargetGuid,  "SKIP_INSTALL",          "NO");
        pbx.SetBuildProperty(fwTargetGuid,  "CODE_SIGNING_ALLOWED",  "NO");
        pbx.SetBuildProperty(appTargetGuid, "ENABLE_BITCODE",        "NO");
        Debug.Log("[CairnUnity][IOSPostProcess] UnityFramework build settings configured");

        try
        {
            pbx.WriteToFile(pbxPath);
        }
        catch (System.Exception e)
        {
            Debug.LogError($"[CairnUnity][IOSPostProcess] Failed to write pbxproj: {e}");
            throw;
        }

        Debug.Log("[CairnUnity][IOSPostProcess] === COMPLETE ===");
    }

    private static void FixNativeCallProxyHeader(PBXProject pbx, string fwTargetGuid)
    {
        // Try common locations
        var paths = new[] {
            "Libraries/Plugins/iOS/NativeCallProxy.h",
            "Plugins/iOS/NativeCallProxy.h",
        };
        string headerGuid = null;
        string foundPath  = null;
        foreach (var p in paths)
        {
            headerGuid = pbx.FindFileGuidByProjectPath(p);
            if (headerGuid != null) { foundPath = p; break; }
        }

        if (headerGuid == null)
        {
            Debug.LogError("[CairnUnity][IOSPostProcess] NativeCallProxy.h not found in pbxproj — RN bridge will not compile");
            return;
        }
        Debug.Log($"[CairnUnity][IOSPostProcess] Found NativeCallProxy.h at: {foundPath}");

        // PBXProjectExtensions.AddPublicHeaderToBuild adds the file to the
        // target's Headers build phase (creating it if missing) and sets
        // ATTRIBUTES = (Public,). This is the canonical Unity API for
        // marking a header as a framework public header.
        pbx.AddPublicHeaderToBuild(fwTargetGuid, headerGuid);
        Debug.Log("[CairnUnity][IOSPostProcess] NativeCallProxy.h marked PUBLIC for UnityFramework");
    }

    private static void FixNativeCallProxyImpl(PBXProject pbx, string appTargetGuid, string fwTargetGuid)
    {
        var paths = new[] {
            "Libraries/Plugins/iOS/NativeCallProxy.mm",
            "Plugins/iOS/NativeCallProxy.mm",
        };
        string mmGuid    = null;
        string foundPath = null;
        foreach (var p in paths)
        {
            mmGuid = pbx.FindFileGuidByProjectPath(p);
            if (mmGuid != null) { foundPath = p; break; }
        }

        if (mmGuid == null)
        {
            Debug.LogError("[CairnUnity][IOSPostProcess] NativeCallProxy.mm not found in pbxproj");
            return;
        }
        Debug.Log($"[CairnUnity][IOSPostProcess] Found NativeCallProxy.mm at: {foundPath}");

        // Add to UnityFramework Sources (AddFileToBuild auto-detects .mm => Sources)
        pbx.AddFileToBuild(fwTargetGuid, mmGuid);
        // Remove from app target Sources to prevent duplicate-symbol link errors
        pbx.RemoveFileFromBuild(appTargetGuid, mmGuid);
        Debug.Log("[CairnUnity][IOSPostProcess] NativeCallProxy.mm: added to UnityFramework, removed from app target");
    }

    private static void FixDataFolder(PBXProject pbx, string appTargetGuid, string fwTargetGuid, string pathToBuiltProject)
    {
        // Unity exports always include "Data" as a folder reference at the
        // project root. Find by project path; if missing, create one.
        const string dataProjectPath = "Data";
        var dataGuid = pbx.FindFileGuidByProjectPath(dataProjectPath);

        if (dataGuid == null)
        {
            var fullPath = Path.Combine(pathToBuiltProject, "Data");
            if (!Directory.Exists(fullPath))
            {
                Debug.LogError($"[CairnUnity][IOSPostProcess] Data folder not found on disk at {fullPath}");
                return;
            }
            // Use absolute path source tree since the on-disk path is absolute
            dataGuid = pbx.AddFolderReference(fullPath, dataProjectPath, PBXSourceTree.Absolute);
            Debug.Log($"[CairnUnity][IOSPostProcess] Created Data folder reference: {dataGuid}");
        }
        else
        {
            Debug.Log($"[CairnUnity][IOSPostProcess] Found existing Data folder reference: {dataGuid}");
        }

        // Remove from app target's Resources phase (no-op if absent)
        pbx.RemoveFileFromBuild(appTargetGuid, dataGuid);

        // Add to UnityFramework's Resources phase (create if needed)
        var fwResourcesPhase = pbx.GetResourcesBuildPhaseByTarget(fwTargetGuid);
        if (string.IsNullOrEmpty(fwResourcesPhase))
        {
            fwResourcesPhase = pbx.AddResourcesBuildPhase(fwTargetGuid);
            Debug.Log("[CairnUnity][IOSPostProcess] Created Resources build phase for UnityFramework");
        }
        pbx.AddFileToBuildSection(fwTargetGuid, fwResourcesPhase, dataGuid);
        Debug.Log("[CairnUnity][IOSPostProcess] Data folder moved from app target to UnityFramework Resources");
    }
}
#endif
