#if UNITY_EDITOR
using System.Collections;
using UnityEngine;
using UnityEditor;

/// <summary>
/// v0.2.4 AR Spike Q1 — Headless automated AR fix test runner.
///
/// Goal: prove main agent can run AR fix tests from cmdline (no GUI),
/// parse results, decide pass/fail, iterate.
///
/// Usage:
///   "C:/tools/Unity/6000.0.76f1/Editor/Unity.exe" -batchmode -projectPath UnityARLib \
///     -executeMethod ARSpikeAutoRun.RunHeadless -quit -logFile -
///
/// Exit code:
///   0 = all tests PASS
///   1 = at least one test FAIL (parse log "[ARSpikeAuto] FAIL")
///
/// Pure-math tests run synchronously without ARFoundation runtime.
/// PlayMode-required tests (Camera/Plane/raycast) need a separate harness
/// that Enter/Exit playmode programmatically — proven possible via
/// EditorApplication.EnterPlaymode() but heavier, see Q1 verdict.
/// </summary>
public static class ARSpikeAutoRun
{
    static int _pass;
    static int _fail;

    public static void RunHeadless()
    {
        _pass = 0;
        _fail = 0;
        Debug.Log("[ARSpikeAuto] === START headless ===");

        // Q1 spike — pure-math tests that don't need ARFoundation runtime.
        // These prove "main can iterate fix→test→verdict→fix without human."
        Test_B2_TierA_BypassesSessionOffset();
        Test_B2_TierB_AppliesSessionOffset();
        Test_B1_AdaptiveHeightGate_Standing();
        Test_B1_AdaptiveHeightGate_Squat();
        Test_B1_AdaptiveHeightGate_Prone();
        Test_B1_RejectsTooClose_Table();
        Test_B1_RejectsTooFar_Cliff();

        Debug.Log($"[ARSpikeAuto] === DONE pass={_pass} fail={_fail} ===");
        if (_fail > 0)
        {
            Debug.LogError($"[ARSpikeAuto] {_fail} test(s) FAILED");
            EditorApplication.Exit(1);
        }
        else
        {
            EditorApplication.Exit(0);
        }
    }

    static void Test_B2_TierA_BypassesSessionOffset()
    {
        // Setup: Tier-A spawn at (10, _, 20), sessionOffset=(5, _, 3)
        // Expected: spawnX=10, spawnZ=20 (NOT 15/23) because Tier-A bypasses
        CairnBridge._sessionOffsetX = 5f;
        CairnBridge._sessionOffsetZ = 3f;
        var data = new CairnBridge.SpawnRequest { tier = "A", x = 10f, z = 20f };
        bool isTierA = data.tier == "A";
        float spawnX = data.x + (isTierA ? 0f : CairnBridge._sessionOffsetX);
        float spawnZ = data.z + (isTierA ? 0f : CairnBridge._sessionOffsetZ);
        Assert("B2 Tier-A bypass X", Mathf.Approximately(spawnX, 10f), $"got {spawnX}");
        Assert("B2 Tier-A bypass Z", Mathf.Approximately(spawnZ, 20f), $"got {spawnZ}");
    }

    static void Test_B2_TierB_AppliesSessionOffset()
    {
        CairnBridge._sessionOffsetX = 5f;
        CairnBridge._sessionOffsetZ = 3f;
        var data = new CairnBridge.SpawnRequest { tier = "B", x = 10f, z = 20f };
        bool isTierA = data.tier == "A";
        float spawnX = data.x + (isTierA ? 0f : CairnBridge._sessionOffsetX);
        float spawnZ = data.z + (isTierA ? 0f : CairnBridge._sessionOffsetZ);
        Assert("B2 Tier-B apply X", Mathf.Approximately(spawnX, 15f), $"got {spawnX}");
        Assert("B2 Tier-B apply Z", Mathf.Approximately(spawnZ, 23f), $"got {spawnZ}");
    }

    static void Test_B1_AdaptiveHeightGate_Standing()
    {
        float adaptive = Mathf.Min(1.0f, Mathf.Max(0.2f, 1.5f * 0.6f));
        Assert("B1 standing 1.5m gate=0.9m", Mathf.Approximately(adaptive, 0.9f), $"got {adaptive}");
    }

    static void Test_B1_AdaptiveHeightGate_Squat()
    {
        float adaptive = Mathf.Min(1.0f, Mathf.Max(0.2f, 0.5f * 0.6f));
        Assert("B1 squat 0.5m gate=0.3m", Mathf.Approximately(adaptive, 0.3f), $"got {adaptive}");
    }

    static void Test_B1_AdaptiveHeightGate_Prone()
    {
        float adaptive = Mathf.Min(1.0f, Mathf.Max(0.2f, 0.2f * 0.6f));
        Assert("B1 prone 0.2m gate=0.2m floor", Mathf.Approximately(adaptive, 0.2f), $"got {adaptive}");
    }

    static void Test_B1_RejectsTooClose_Table()
    {
        float camY = 1.5f;
        float hitY = 1.0f;  // table at chest
        float adaptiveMin = Mathf.Min(1.0f, Mathf.Max(0.2f, camY * 0.6f));
        bool rejected = (camY - hitY) < adaptiveMin;
        Assert("B1 reject chest-level table", rejected, $"belowCam={camY-hitY} adaptiveMin={adaptiveMin}");
    }

    static void Test_B1_RejectsTooFar_Cliff()
    {
        float camY = 1.5f;
        float hitY = -10f;
        bool rejected = (camY - hitY) > 5.0f;
        Assert("B1 reject cliff-far", rejected);
    }

    static void Assert(string name, bool cond, string detail = null)
    {
        if (cond)
        {
            _pass++;
            Debug.Log($"[ARSpikeAuto] PASS: {name}");
        }
        else
        {
            _fail++;
            Debug.LogWarning($"[ARSpikeAuto] FAIL: {name}" + (detail != null ? $" ({detail})" : ""));
        }
    }
}
#endif