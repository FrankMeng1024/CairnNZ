#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;

/// <summary>
/// Editor-only test harness for v186 DS strand visuals. Lets you see
/// the new look without an EAS Build / device.
///
/// Usage:
///   1. Cairn > Build CairnAR Scene  (one-time scene + materials setup)
///   2. Open Assets/Scenes/CairnAR.unity
///   3. Press Play
///   4. Cairn > Spawn 5 Test Cairns  (places one of each type in front
///      of the camera)
///   5. View in Game window — you'll see 5 strands × halo × shadow ×
///      particles, each with the per-type personality (danger flicker,
///      water flow, hut warm breathe, etc.)
///
/// Note: Unity Editor doesn't run ARKit, so the camera is just a
/// regular Unity Camera. Tier C ground-Y resolver gives a constant
/// camera.y - 1.5m. The visuals (shader + halo + particles + bloom)
/// are 1:1 what you'll see on device.
///
/// All editor-only — does NOT ship in iOS build.
/// </summary>
public static class StrandTestHarness
{
    [MenuItem("Cairn/Spawn 5 Test Cairns")]
    public static void Spawn5TestCairns()
    {
        if (!Application.isPlaying)
        {
            EditorUtility.DisplayDialog(
                "Cairn Test Harness",
                "Enter Play mode first (open CairnAR.unity, click Play), then run this command again.",
                "OK");
            return;
        }

        var bridge = Object.FindFirstObjectByType<CairnBridge>();
        if (bridge == null)
        {
            EditorUtility.DisplayDialog(
                "Cairn Test Harness",
                "CairnBridge not found in scene. Run 'Cairn > Build CairnAR Scene' first.",
                "OK");
            return;
        }

        var cam = bridge.arCamera != null ? bridge.arCamera : Camera.main;
        if (cam == null)
        {
            EditorUtility.DisplayDialog(
                "Cairn Test Harness",
                "No camera found in scene.",
                "OK");
            return;
        }

        // Spawn 5 cairns in a fan in front of the camera at ~3m, spaced
        // 1.5m apart. Each is a different type so per-type recipes show.
        var camPos = cam.transform.position;
        var camFwd = cam.transform.forward;
        var camRight = cam.transform.right;
        // Project forward onto horizontal plane
        camFwd.y = 0; camFwd.Normalize();

        string[] types = { "danger", "junction", "water", "hut", "cairn" };
        for (int i = 0; i < types.Length; i++)
        {
            float xOffset = (i - 2) * 1.5f;  // -3, -1.5, 0, 1.5, 3
            var pos = camPos + camFwd * 3.0f + camRight * xOffset;
            // Tier C ground (no ARKit in editor)
            float groundY = camPos.y - 1.5f;

            var req = new CairnBridge.SpawnRequest
            {
                id          = $"test_{types[i]}_{i}",
                type        = types[i],
                x           = pos.x,
                y           = groundY,
                z           = pos.z,
                // Pass r=g=b=0 to let CairnTypePresets supply the per-type color
                r           = 0f,
                g           = 0f,
                b           = 0f,
                scrollSpeed = 0f, // 0 = use preset
                bloomBoost  = 0f,
            };

            // Send via the same path RN uses
            var json = JsonUtility.ToJson(req);
            bridge.OnSpawnStrand(json);

            Debug.Log($"[TestHarness] Spawned {types[i]} at ({pos.x:F2},{groundY:F2},{pos.z:F2})");
        }

        EditorUtility.DisplayDialog(
            "Cairn Test Harness",
            "Spawned 5 cairns (danger / junction / water / hut / cairn) in front of camera. " +
            "Look at the Game view!",
            "OK");
    }

    [MenuItem("Cairn/Clear All Cairns")]
    public static void ClearAllCairns()
    {
        if (!Application.isPlaying) return;
        var bridge = Object.FindFirstObjectByType<CairnBridge>();
        if (bridge == null) return;
        bridge.OnClearAll("");
        Debug.Log("[TestHarness] Cleared all cairns");
    }

    [MenuItem("Cairn/Test OTA Globals/BloomScale 0.5x")]
    public static void Bloom05x()
    {
        if (!Application.isPlaying) return;
        if (CairnGlobals.Instance != null) CairnGlobals.Instance.SetBloomScale(0.5f);
    }

    [MenuItem("Cairn/Test OTA Globals/BloomScale 1.0x")]
    public static void Bloom1x()
    {
        if (!Application.isPlaying) return;
        if (CairnGlobals.Instance != null) CairnGlobals.Instance.SetBloomScale(1.0f);
    }

    [MenuItem("Cairn/Test OTA Globals/BloomScale 2.0x")]
    public static void Bloom2x()
    {
        if (!Application.isPlaying) return;
        if (CairnGlobals.Instance != null) CairnGlobals.Instance.SetBloomScale(2.0f);
    }

    [MenuItem("Cairn/Test OTA Globals/Stop Strand Flow (Screenshot)")]
    public static void StopFlow()
    {
        if (!Application.isPlaying) return;
        if (CairnGlobals.Instance != null) CairnGlobals.Instance.SetScrollMul(0f);
    }

    [MenuItem("Cairn/Test OTA Globals/Resume Strand Flow")]
    public static void ResumeFlow()
    {
        if (!Application.isPlaying) return;
        if (CairnGlobals.Instance != null) CairnGlobals.Instance.SetScrollMul(1f);
    }
}
#endif
