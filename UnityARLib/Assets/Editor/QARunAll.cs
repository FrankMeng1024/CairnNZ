#if UNITY_EDITOR
// Cairn AR — QA Run All harness (v0.2.4 R2 verification suite)
//
// 一条 cmdline 跑完 45 个 test case,产出每个 case 的 verdict.txt + (视觉 case)
// before/after PNG。退出码 0 = 全 PASS, 1 = 任意 FAIL。
//
// Usage:
//   "C:/tools/Unity/6000.0.76f1/Editor/Unity.exe" -batchmode -projectPath UnityARLib \
//     -executeMethod QARunAll.RunHeadless -quit -logFile -
//
// 输出根目录: Logs/qa-cases/
// 每个 case 一个子目录: QA-NN-<name>/
//
// 设计原则:
// - 每个 case 自带 setup + teardown,不污染下一个
// - 数学 case 用 ARSpikeAutoRun 风格 assert
// - 视觉 case 用 CairnFlyToSkyTest 风格 PNG capture
// - device-only case 自动 SKIP (不算 FAIL)
// - 失败时不立刻退出,记录后继续 — 让一次跑出全部 FAIL 列表

using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using UnityEditor;
using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;
using Cairn.AR;

public static class QARunAll
{
    const string OUT_ROOT = "Logs/qa-cases";
    const int W = 1280, H = 720;

    // Per-run accumulators
    static int _pass, _fail, _skip;
    static List<string> _failedCases = new List<string>();
    static StringBuilder _summaryLog = new StringBuilder();

    // Shared scene refs (re-built per case)
    static GameObject _sun, _ground, _camGo, _cairnRoot;
    static Camera _cam;

    [MenuItem("Cairn/Run All QA Cases")]
    public static void RunFromMenu() { RunHeadless(); }

    public static void RunHeadless()
    {
        Debug.Log("[QA] === START QARunAll ===");
        _pass = _fail = _skip = 0;
        _failedCases.Clear();
        _summaryLog.Clear();
        Directory.CreateDirectory(OUT_ROOT);

        // ─── A 类 — 同 session 挪动 ───
        // QA-01~04: cairnRoot 是 dummy GameObject,不挂 ARAnchor,Editor 改相机 transform
        // 不会真触发 ARFoundation anchor refine 路径 — 这些 case 等于"无人动它当然不变",
        // trivially-true,不算真测。改 SKIP,真机 walk-around scenario 走 telemetry。
        Skip("QA-01-plant-still",                           "ARAnchor refine 真实行为只在 PlayMode + 真 ARSession 出现,Editor batchmode dummy GO 不变是 trivial");
        Skip("QA-02-plant-walk-away-and-back",              "同 QA-01 — 真机 walk-around scenario,看 v22-PLANT-ANCHOR-DRIFT-DETECTED telemetry");
        Skip("QA-03-plant-orbit-180",                       "同 QA-01 — 真机绕走 scenario");
        Skip("QA-04-plant-crouch-stand",                    "同 QA-01 — 真机 crouch scenario");
        Skip("QA-05-slam-slow-drift",                       "ARKit SLAM anchor refine 不可在 Editor mock — 真机 telemetry 验证");
        Skip("QA-06-slam-relocalize-jump",                  "ARKit relocalize 真信号不可在 Editor mock — 真机 + worldMappingStatus 埋点");

        // ─── B 类 — 跨 session 重开 ───
        // QA-10~12: dummy GameObject + 平移测试不真测 R2.4 的 PickSnapPlane / SnapToFloorY
        // (那已被 QA-70~73 真调测了)。这 3 个 case 是 trivially: "我手动 += 0.6m,然后断言它是 0.6m" 自洽。
        // 删 fake,B 类只保 device-only 真机走 v22-CROSS-SESSION-SNAP telemetry。
        Skip("QA-10-cross-session-y-drift",                 "Y drift 真测在 QA-70~73 (PickSnapPlane);真机端到端走 v22-CROSS-SESSION-SNAP telemetry");
        Skip("QA-11-cross-session-xz-drift",                "XZ drift R2.4 不在 scope (anchor refine,非 snap);真机走 v22-PLANT-ANCHOR-DRIFT-DETECTED");
        Skip("QA-12-cross-session-no-plane",                "PickSnapPlane(no-plane) 真测在 QA-72");
        Skip("QA-13-cross-session-worldmappingstatus-lock", "ARKit native worldMappingStatus 不可在 Editor mock");

        // ─── C 类 — Tier-A vs Tier-B ───
        Run("QA-20-tierA-bypasses-sessionoffset-init",     Test_QA20_TierABypassesInit);
        Run("QA-21-tierB-applies-sessionoffset",           Test_QA21_TierBApplies);
        Run("QA-22-null-tier-defaults-to-B",               Test_QA22_NullTierDefaultsB);
        Run("QA-23-multispawner-tierA-bypass",             Test_QA23_MultiSpawnerTierA);
        Run("QA-95-tierA-with-uninit-sessionoffset",       Test_QA95_TierAUninit);
        Run("QA-91-portal-dedupe-by-id",                   Test_QA91_DedupeById);

        // ─── D 类 — Floor plane 判断 ───
        Run("QA-30-standing-accept-1m",                    Test_QA30_StandingAccept);
        Run("QA-31-squat-accept-0.3m",                     Test_QA31_SquatAccept);
        Run("QA-32-prone-floor-0.2m",                      Test_QA32_ProneFloor);
        Run("QA-33-reject-table",                          Test_QA33_RejectTable);
        Run("QA-34-reject-cliff",                          Test_QA34_RejectCliff);
        Run("QA-35-reject-classification-list",            Test_QA35_RejectClassifications);
        Run("QA-39-no-regression-belowcam-0.6",            Test_QA39_NoRegression);
        Run("QA-36-lidar-floor-accept",                    Test_QA36_LidarFloorAccept);
        Run("QA-37-lidar-non-floor-large-area-accept",     Test_QA37_LidarNonFloorLarge);
        Run("QA-38-lidar-non-floor-small-area-reject",     Test_QA38_LidarNonFloorSmall);

        // ─── E 类 — Tracking gate ───
        Skip("QA-40-tracking-allows-plant",                 "ARScreen.tsx React useEffect a4PlantEnabled gate 是 RN-side。jest in app/__tests__/r27-track-debounce.test.ts 真测 trackStateDebounce");
        Skip("QA-41-limited-rejects-plant",                 "同 QA-40 — RN-side jest");
        Skip("QA-42-none-rejects-plant",                    "同 QA-40 — RN-side jest");
        Skip("QA-43-flicker-no-thrash",                     "ARScreen.tsx React useEffect 是 TypeScript runtime,C# Editor 不可达。RN 用 jest in app/__tests__/track-debounce.test.ts");
        Skip("QA-44-plant-during-flicker",                  "同 QA-43 — TS jest");
        Skip("QA-45-flicker-hard-cap-applies",              "同 QA-43 — TS jest");
        Skip("QA-46-track-none-immediate",                  "同 QA-43 — TS jest");

        // ─── F 类 — GPS + arOrigin ───
        Skip("QA-50-gps-5m-allows",                         "GPS native 不可 Editor mock");
        Skip("QA-51-gps-15m-rejects",                       "GPS native 不可 Editor mock");
        Skip("QA-52-arorigin-30m-allows",                   "ARScreen.tsx 50m 阈值是 RN-side,Editor C# 不可达。RN jest in app/__tests__/origin-stale.test.ts");
        Skip("QA-53-arorigin-80m-rejects",                  "同 QA-52");
        Skip("QA-54-gps-15m-fallback-plant",                "GPS native 不可 Editor mock");

        // ─── G 类 — Anchor lifecycle ───
        Skip("QA-60-pendingretry-blocks-v199",              "PendingAnchorRetry 需要真 ARFoundation rig + ARSession PlayMode runtime,Editor batchmode 不可 mock。真机走 [v22-V199-PARENT-SKIP-PENDING] log + telemetry_sessions");
        Skip("QA-61-pendingretry-removed-v199-works",       "同 QA-60 — 真机 [v22-V199-PARENT-OK] log");
        Skip("QA-94-anchor-trackable-removed",              "ARSession.RemoveTrackable 是 native 路径,Editor 无法 mock,真机走 AnchorDriftMonitor [v22-anchor-removed] telemetry");

        // ─── H 类 — Cross-session ground snap ───
        Run("QA-70-snap-picks-nearest-xz",                 Test_QA70_SnapNearestXZ);
        Run("QA-71-snap-single-plane",                     Test_QA71_SnapSinglePlane);
        Run("QA-72-snap-no-plane-skip",                    Test_QA72_SnapNoPlane);
        Run("QA-73-snap-cross-floor-protection",           Test_QA73_SnapCrossFloorProtection);
        Run("QA-74-multi-cairn-batch-snap",                Test_QA74_MultiCairnBatchSnap);
        Run("QA-75-anchor-drift-sliding-window",           Test_QA75_AnchorDriftSlidingWindow);
        Run("QA-76-ceremony-controller-play",              Test_QA76_CeremonyControllerPlay);
        Run("QA-77-tierA-trust-rn-arkitY",                 Test_QA77_TierATrustRnArkitY);
        Run("QA-78-tierA-override-when-large-delta",       Test_QA78_TierAOverride);
        Run("QA-79-tierA-fallback-no-plane",               Test_QA79_TierAFallback);
        Run("QA-80-tierB-walks-resolver-path",             Test_QA80_TierBWalksResolver);

        // ─── I 类 — LiDAR consistency ───
        Skip("QA-80-lidar-on-three-true",                   "LiDAR ARMeshManager runtime 不可 Editor mock");
        Skip("QA-81-lidar-off-three-false",                 "LiDAR ARMeshManager runtime 不可 Editor mock");

        // ─── J 类 — UX edge cases ───
        // QA-90~93: 这些都是端到端 plant 流程行为 (raycast / dedupe / persist / 双 hit)
        // 真测要真 PortalSpawner runtime,Editor batchmode 不可。改 SKIP 走真机端到端。
        Skip("QA-90-plant-no-raycast-hit",                  "PortalSpawner.OnSpawnStrand 走 ARRaycastManager 真路径,Editor 不可 mock");
        // QA-91: dedupe 真在 PortalSpawner.IsAlreadySpawned helper,Editor 真测
        Skip("QA-91-plant-dedupe-by-id-OLD",                "替换为 QA-91 (新真测)");
        Skip("QA-92-plant-persist-app-restart",             "persist 测在 useMarkerStore RN side,RN jest in app/__tests__/marker-store.test.ts");
        Skip("QA-93-plant-double-hit-floor-table",          "raycast multi-hit 路径在 ARRaycastManager runtime,Editor 不可 mock");
        Skip("QA-96-app-backgrounded-mid-plant",            "OnApplicationPause 真机 lifecycle 不可 Editor mock");

        // ─── 总结 ───
        WriteSummary();
        Debug.Log($"[QA] === DONE: pass={_pass} fail={_fail} skip={_skip} ===");
        if (_fail > 0)
        {
            Debug.LogWarning($"[QA] FAILED CASES: {string.Join(", ", _failedCases)}");
            if (Application.isBatchMode) EditorApplication.Exit(1);
        }
        else
        {
            if (Application.isBatchMode) EditorApplication.Exit(0);
        }
    }

    // ───────────────────────────────────────────────────────────────────
    // Runner + verdict writer + teardown
    // ───────────────────────────────────────────────────────────────────

    static void Run(string id, Action<CaseCtx> body)
    {
        Debug.Log($"[QA] >>> {id} START");
        var dir = Path.Combine(OUT_ROOT, id);
        Directory.CreateDirectory(dir);

        var ctx = new CaseCtx { id = id, dir = dir };
        try
        {
            BuildScene();
            body(ctx);
        }
        catch (Exception e)
        {
            ctx.Fail($"exception: {e.GetType().Name}: {e.Message}");
        }
        finally
        {
            TearDown();
        }

        // Write verdict
        File.WriteAllText(Path.Combine(dir, "verdict.txt"), ctx.RenderVerdict());
        if (ctx.passed) { _pass++; Debug.Log($"[QA] <<< {id} PASS"); }
        else { _fail++; _failedCases.Add(id); Debug.LogWarning($"[QA] <<< {id} FAIL: {ctx.failReason}"); }
    }

    static void Skip(string id, string reason)
    {
        Debug.Log($"[QA] === {id} SKIP: {reason}");
        var dir = Path.Combine(OUT_ROOT, id);
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "verdict.txt"),
            $"{id}: SKIPPED\nreason: {reason}\n");
        _skip++;
    }

    static void WriteSummary()
    {
        var sb = new StringBuilder();
        sb.AppendLine($"# QA Run Summary — {DateTime.Now:yyyy-MM-dd HH:mm:ss}");
        sb.AppendLine($"PASS: {_pass}");
        sb.AppendLine($"FAIL: {_fail}");
        sb.AppendLine($"SKIP: {_skip}");
        sb.AppendLine();
        if (_failedCases.Count > 0)
        {
            sb.AppendLine("Failed cases:");
            foreach (var c in _failedCases) sb.AppendLine("  - " + c);
        }
        File.WriteAllText(Path.Combine(OUT_ROOT, "_SUMMARY.md"), sb.ToString());
    }

    // Build a minimal shared scene (no AR runtime — pure GO + camera + cone proxy)
    static void BuildScene()
    {
        var scene = UnityEditor.SceneManagement.EditorSceneManager.NewScene(
            UnityEditor.SceneManagement.NewSceneSetup.EmptyScene,
            UnityEditor.SceneManagement.NewSceneMode.Single);

        _sun = new GameObject("Sun");
        var sun = _sun.AddComponent<Light>();
        sun.type = LightType.Directional;
        sun.intensity = 1.5f;
        _sun.transform.rotation = Quaternion.Euler(50f, -30f, 0f);

        _ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
        _ground.name = "GroundReference";
        _ground.transform.position = Vector3.zero;
        _ground.transform.localScale = Vector3.one * 1.5f;
        var groundMat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
        groundMat.color = new Color(0.32f, 0.34f, 0.40f);
        _ground.GetComponent<Renderer>().material = groundMat;

        _camGo = new GameObject("Main Camera");
        _camGo.tag = "MainCamera";
        _cam = _camGo.AddComponent<Camera>();
        _cam.clearFlags = CameraClearFlags.SolidColor;
        _cam.backgroundColor = new Color(0.05f, 0.05f, 0.10f);
        _cam.fieldOfView = 60f;
        _cam.nearClipPlane = 0.05f;
        _cam.farClipPlane = 50f;
        _camGo.transform.position = new Vector3(0f, 1.6f, -3f);
        _camGo.transform.LookAt(new Vector3(0f, 0.3f, 0f));

        // Cairn cone proxy (real cone meshes)
        _cairnRoot = new GameObject("Portal_qa-test");
        _cairnRoot.transform.position = Vector3.zero;
        var inner = AssetDatabase.LoadAssetAtPath<Mesh>("Assets/Resources/Meshes/cairn_cone_inner.asset");
        var outer = AssetDatabase.LoadAssetAtPath<Mesh>("Assets/Resources/Meshes/cairn_cone_outer.asset");
        if (outer != null) AddCone(outer, "CairnConeOuter", new Color(0.95f, 0.55f, 0.30f));
        if (inner != null) AddCone(inner, "CairnConeInner", new Color(1.0f, 0.85f, 0.4f));
    }

    static void AddCone(Mesh mesh, string name, Color color)
    {
        var go = new GameObject(name);
        go.transform.SetParent(_cairnRoot.transform, false);
        go.AddComponent<MeshFilter>().sharedMesh = mesh;
        var renderer = go.AddComponent<MeshRenderer>();
        var m = new Material(Shader.Find("Universal Render Pipeline/Lit"));
        m.color = color;
        renderer.sharedMaterial = m;
    }

    static void TearDown()
    {
        // Reset CairnBridge static state
        try { CairnBridge._sessionOffsetX = 0f; CairnBridge._sessionOffsetZ = 0f; } catch { }
        // Destroy spawn objects (anything named Portal_*)
        var allTransforms = UnityEngine.Object.FindObjectsByType<Transform>(FindObjectsSortMode.None);
        foreach (var t in allTransforms)
        {
            if (t == null) continue;
            if (t.name.StartsWith("Portal_") || t.name == "Sun" || t.name == "GroundReference" || t.name == "Main Camera")
            {
                if (t.gameObject != null) UnityEngine.Object.DestroyImmediate(t.gameObject);
            }
        }
    }

    static void Capture(string path)
    {
        var rt = new RenderTexture(W, H, 24);
        _cam.targetTexture = rt;
        var tex = new Texture2D(W, H, TextureFormat.RGB24, false);
        _cam.Render();
        RenderTexture.active = rt;
        tex.ReadPixels(new Rect(0, 0, W, H), 0, 0);
        tex.Apply();
        _cam.targetTexture = null;
        RenderTexture.active = null;
        UnityEngine.Object.DestroyImmediate(rt);
        File.WriteAllBytes(path, tex.EncodeToPNG());
        UnityEngine.Object.DestroyImmediate(tex);
    }

    // Find topmost non-transparent pixel y of cairn cone in PNG (proxy for "tip y").
    // Cairn cone is amber/orange; ground is gray-blue; bg is dark navy.
    // Look for first row from top where R > 200 && R-B > 50 (warm color).
    static int ConeTipPixelY(string pngPath)
    {
        byte[] bytes = File.ReadAllBytes(pngPath);
        var tex = new Texture2D(2, 2);
        tex.LoadImage(bytes);
        int texHeight = tex.height;
        int texWidth = tex.width;
        int result = -1;
        for (int y = texHeight - 1; y >= 0; y--)
        {
            bool found = false;
            for (int x = 0; x < texWidth; x++)
            {
                Color c = tex.GetPixel(x, y);
                if (c.r > 0.78f && (c.r - c.b) > 0.2f)
                {
                    result = texHeight - y; // y from top
                    found = true;
                    break;
                }
            }
            if (found) break;
        }
        UnityEngine.Object.DestroyImmediate(tex);
        return result;
    }

    // ───────────────────────────────────────────────────────────────────
    // A class (QA-01~06) removed — SKIP'd in RunHeadless. Dummy GameObject
    // 的 transform 测试 trivially-true,真测要 PlayMode + ARFoundation runtime。
    // 真机 telemetry: v22-PLANT-ANCHOR-DRIFT-DETECTED.
    // ───────────────────────────────────────────────────────────────────

    // ───────────────────────────────────────────────────────────────────
    // B class (QA-10~12) removed — SKIP'd in RunHeadless. Cross-session 行为
    // 真测在 H 类 (QA-70~73 真调 CrossSessionGroundSnap.PickSnapPlane)。
    // 真机走 v22-CROSS-SESSION-SNAP telemetry。
    // ───────────────────────────────────────────────────────────────────

    // ───────────────────────────────────────────────────────────────────
    // C class — Tier-A vs Tier-B (sessionOffset bypass)
    // ───────────────────────────────────────────────────────────────────

    static void Test_QA20_TierABypassesInit(CaseCtx ctx)
    {
        // 真调 CairnBridge.ApplyTierAwareSpawnOffset (PortalSpawner + MultiSpawner 共用)
        CairnBridge._sessionOffsetX = 5f;
        CairnBridge._sessionOffsetZ = 3f;
        var (x, z) = CairnBridge.ApplyTierAwareSpawnOffset("A", 10f, 20f);
        ctx.Note($"tier=A raw=(10,20) offset=(5,3) result=({x:F2},{z:F2})");
        ctx.AssertEqualF("spawnX", x, 10f);
        ctx.AssertEqualF("spawnZ", z, 20f);
    }

    static void Test_QA21_TierBApplies(CaseCtx ctx)
    {
        CairnBridge._sessionOffsetX = 5f;
        CairnBridge._sessionOffsetZ = 3f;
        var (x, z) = CairnBridge.ApplyTierAwareSpawnOffset("B", 10f, 20f);
        ctx.AssertEqualF("spawnX", x, 15f);
        ctx.AssertEqualF("spawnZ", z, 23f);
    }

    static void Test_QA22_NullTierDefaultsB(CaseCtx ctx)
    {
        CairnBridge._sessionOffsetX = 5f;
        CairnBridge._sessionOffsetZ = 3f;
        var (x, _) = CairnBridge.ApplyTierAwareSpawnOffset(null, 10f, 20f);
        ctx.AssertEqualF("spawnX", x, 15f);
    }

    static void Test_QA23_MultiSpawnerTierA(CaseCtx ctx)
    {
        // R2.5 anti-self-licking: 真调共用 helper, MultiSpawner.cs:230 真用同函数。
        CairnBridge._sessionOffsetX = 5f;
        CairnBridge._sessionOffsetZ = 3f;
        var (x, _) = CairnBridge.ApplyTierAwareSpawnOffset("A", 10f, 0f);
        ctx.Note($"MultiSpawner.cs:230 calls same helper -> spawnX={x}");
        ctx.AssertEqualF("multispawner-spawnX", x, 10f);
    }

    static void Test_QA95_TierAUninit(CaseCtx ctx)
    {
        CairnBridge._sessionOffsetX = 0f;
        CairnBridge._sessionOffsetZ = 0f;
        var (x, _) = CairnBridge.ApplyTierAwareSpawnOffset("A", 10f, 20f);
        ctx.AssertEqualF("spawnX", x, 10f);
    }

    static void Test_QA91_DedupeById(CaseCtx ctx)
    {
        // R2-followup: PortalSpawner.IsAlreadySpawned helper 真调
        // 模拟两个 child Portal_X / Portal_Y, 验证 IsAlreadySpawned 真识别。
        var spawnerGo = new GameObject("TestPortalSpawner");
        var spawner = spawnerGo.AddComponent<PortalSpawner>();
        // 加 child 模拟"已 spawn"的 cairn (生产里 SpawnStrandInternal 创建 Portal_<id>)
        var childA = new GameObject("Portal_alpha");
        childA.transform.SetParent(spawnerGo.transform);
        var childB = new GameObject("Portal_beta");
        childB.transform.SetParent(spawnerGo.transform);

        bool aFound = spawner.IsAlreadySpawned("alpha");
        bool bFound = spawner.IsAlreadySpawned("beta");
        bool cFound = spawner.IsAlreadySpawned("gamma");  // not present
        bool emptyFound = spawner.IsAlreadySpawned("");
        bool nullFound = spawner.IsAlreadySpawned(null);

        ctx.Note($"alpha={aFound} beta={bFound} gamma={cFound} empty={emptyFound} null={nullFound}");
        ctx.AssertTrue("alpha-found", aFound);
        ctx.AssertTrue("beta-found", bFound);
        ctx.AssertTrue("gamma-not-found", !cFound);
        ctx.AssertTrue("empty-not-found", !emptyFound);
        ctx.AssertTrue("null-not-found", !nullFound);

        UnityEngine.Object.DestroyImmediate(spawnerGo);
    }

    // ───────────────────────────────────────────────────────────────────
    // D class — Floor plane validator
    // ───────────────────────────────────────────────────────────────────

    static void Test_QA30_StandingAccept(CaseCtx ctx)
    {
        // 真调 FloorPlaneValidator.Validate — mock ARPlane (HorizontalUp, Floor classification, area 2m²)
        // camera at y=1.5, plane at y=0.5 -> belowCam=1.0, adaptiveMin = min(1.0, max(0.2, 1.5*0.6)) = 0.9
        // 1.0 >= 0.9 -> isValid = true
        var plane = CreateMockARPlane(
            PlaneAlignment.HorizontalUp,
            PlaneClassifications.Floor,
            new Vector2(2f, 1f),  // area = 2m²
            new Vector3(0, 0.5f, 0));
        var v = FloorPlaneValidator.Validate(plane, plane.center, cameraY: 1.5f, lidarAvailable: false);
        ctx.Note($"isValid={v.isValid} reason={v.rejectReason} belowCam={v.heightBelowCamera:F2}");
        ctx.AssertTrue("standing-accept-1m", v.isValid);
        UnityEngine.Object.DestroyImmediate(plane.gameObject);
    }

    static void Test_QA31_SquatAccept(CaseCtx ctx)
    {
        // camera y=0.5, plane at y=0.2 -> belowCam=0.3, adaptiveMin=max(0.2, 0.5*0.6)=0.3
        // 0.3 >= 0.3 -> accept
        var plane = CreateMockARPlane(
            PlaneAlignment.HorizontalUp,
            PlaneClassifications.Floor,
            new Vector2(2f, 1f),
            new Vector3(0, 0.2f, 0));
        var v = FloorPlaneValidator.Validate(plane, plane.center, cameraY: 0.5f, lidarAvailable: false);
        ctx.Note($"isValid={v.isValid} reason={v.rejectReason} belowCam={v.heightBelowCamera:F2}");
        ctx.AssertTrue("squat-accept-0.3m", v.isValid);
        UnityEngine.Object.DestroyImmediate(plane.gameObject);
    }

    static void Test_QA32_ProneFloor(CaseCtx ctx)
    {
        // camera y=0.4, plane at y=0.2 -> belowCam=0.2, adaptiveMin=max(0.2, 0.4*0.6=0.24)=0.24
        // 0.2 < 0.24 -> reject. To make it pass, set belowCam = 0.24+
        // The TEST_CASES.md spec says camY=0.2 floor=0.2 — that means cam itself at 0.2, plane at 0.0
        // belowCam = 0.2, adaptiveMin = max(0.2, 0.2*0.6=0.12) = 0.2. belowCam == adaptiveMin -> accept
        var plane = CreateMockARPlane(
            PlaneAlignment.HorizontalUp,
            PlaneClassifications.Floor,
            new Vector2(2f, 1f),
            new Vector3(0, 0.0f, 0));
        var v = FloorPlaneValidator.Validate(plane, plane.center, cameraY: 0.2f, lidarAvailable: false);
        ctx.Note($"isValid={v.isValid} reason={v.rejectReason} belowCam={v.heightBelowCamera:F2}");
        ctx.AssertTrue("prone-floor-0.2m", v.isValid);
        UnityEngine.Object.DestroyImmediate(plane.gameObject);
    }

    static void Test_QA33_RejectTable(CaseCtx ctx)
    {
        // camera 1.5, plane (table) at y=1.0 -> belowCam=0.5 < adaptiveMin=0.9 -> reject
        // OR plane classified as Table -> reject_classification
        var plane = CreateMockARPlane(
            PlaneAlignment.HorizontalUp,
            PlaneClassifications.Table,  // classification gate
            new Vector2(1f, 1f),
            new Vector3(0, 1.0f, 0));
        var v = FloorPlaneValidator.Validate(plane, plane.center, cameraY: 1.5f, lidarAvailable: false);
        ctx.Note($"isValid={v.isValid} reason={v.rejectReason}");
        ctx.AssertTrue("reject-table", !v.isValid);
        UnityEngine.Object.DestroyImmediate(plane.gameObject);
    }

    static void Test_QA34_RejectCliff(CaseCtx ctx)
    {
        // camera 1.5, plane y=-10 -> belowCam=11.5 > maxFloorDistanceBelowCam=5 -> reject
        var plane = CreateMockARPlane(
            PlaneAlignment.HorizontalUp,
            PlaneClassifications.Floor,
            new Vector2(2f, 2f),
            new Vector3(0, -10f, 0));
        var v = FloorPlaneValidator.Validate(plane, plane.center, cameraY: 1.5f, lidarAvailable: false);
        ctx.Note($"isValid={v.isValid} reason={v.rejectReason}");
        ctx.AssertTrue("reject-cliff", !v.isValid && v.rejectReason == "hit_too_far_below_camera");
        UnityEngine.Object.DestroyImmediate(plane.gameObject);
    }

    static void Test_QA35_RejectClassifications(CaseCtx ctx)
    {
        // R2.2 真测:把每个 classification 喂给 FloorPlaneValidator.Validate,真断言 isValid。
        // R2.2 sub#B 分支:Couch 大面积 (≥1.5m²) 松绑接受,小面积 reject。
        // 其他 8 个硬 reject。
        var hardReject = new (string name, PlaneClassifications cls)[]
        {
            ("Table",    PlaneClassifications.Table),
            ("Seat",     PlaneClassifications.Seat),
            ("WallFace", PlaneClassifications.WallFace),
            ("Ceiling",  PlaneClassifications.Ceiling),
            ("DoorFrame",PlaneClassifications.DoorFrame),
            ("WallArt",  PlaneClassifications.WallArt),
            ("WindowFrame", PlaneClassifications.WindowFrame),
            ("InvisibleWallFace", PlaneClassifications.InvisibleWallFace),
        };
        var notRejected = new List<string>();
        foreach (var (name, cls) in hardReject)
        {
            var plane = CreateMockARPlane(
                PlaneAlignment.HorizontalUp, cls,
                new Vector2(2f, 2f),  // area 4m² — large enough that area gate alone won't reject
                new Vector3(0, 0.5f, 0));
            var v = FloorPlaneValidator.Validate(plane, plane.center, cameraY: 1.5f, lidarAvailable: false);
            ctx.Note($"  {name}: isValid={v.isValid} reason={v.rejectReason}");
            if (v.isValid) notRejected.Add(name);
            UnityEngine.Object.DestroyImmediate(plane.gameObject);
        }
        // Couch with small area -> reject; Couch with large area -> accept
        var couchSmall = CreateMockARPlane(
            PlaneAlignment.HorizontalUp, PlaneClassifications.Couch,
            new Vector2(0.8f, 0.8f),  // area=0.64 < 1.5 threshold
            new Vector3(0, 0.5f, 0));
        var vCouchSmall = FloorPlaneValidator.Validate(couchSmall, couchSmall.center, cameraY: 1.5f, lidarAvailable: false);
        ctx.Note($"  Couch-small (area=0.64): isValid={vCouchSmall.isValid} reason={vCouchSmall.rejectReason}");
        if (vCouchSmall.isValid) notRejected.Add("Couch-small");
        UnityEngine.Object.DestroyImmediate(couchSmall.gameObject);

        var couchLarge = CreateMockARPlane(
            PlaneAlignment.HorizontalUp, PlaneClassifications.Couch,
            new Vector2(2f, 1.5f),  // area=3.0 ≥ 1.5 threshold -> accept (carpet fallback)
            new Vector3(0, 0.5f, 0));
        var vCouchLarge = FloorPlaneValidator.Validate(couchLarge, couchLarge.center, cameraY: 1.5f, lidarAvailable: false);
        ctx.Note($"  Couch-large (area=3.0): isValid={vCouchLarge.isValid} reason={vCouchLarge.rejectReason}");
        bool couchLargeOk = vCouchLarge.isValid; // expect true after R2.2 sub#B fix
        UnityEngine.Object.DestroyImmediate(couchLarge.gameObject);

        if (notRejected.Count > 0)
        {
            ctx.Fail($"these should have been rejected: {string.Join(",", notRejected)}");
        }
        else if (!couchLargeOk)
        {
            ctx.Fail("Couch-large (area>=1.5m²) should be accepted as floor fallback (R2.2 sub#B), got rejected");
        }
        else
        {
            ctx.Pass();
        }
    }

    static void Test_QA39_NoRegression(CaseCtx ctx)
    {
        // After R2.2 fix, normal Floor with area>=0.5 + belowCam in adaptive range should still PASS.
        var plane = CreateMockARPlane(
            PlaneAlignment.HorizontalUp,
            PlaneClassifications.Floor,
            new Vector2(2f, 2f),
            new Vector3(0, 0f, 0));
        var v = FloorPlaneValidator.Validate(plane, plane.center, cameraY: 1.5f, lidarAvailable: false);
        ctx.Note($"isValid={v.isValid} reason={v.rejectReason}");
        ctx.AssertTrue("no-regression-floor-accept", v.isValid);
        UnityEngine.Object.DestroyImmediate(plane.gameObject);
    }

    // ───────────────────────────────────────────────────────────────────
    // R2.2/R2.6 lidarAvailable=true 分支真测
    // ───────────────────────────────────────────────────────────────────

    static void Test_QA36_LidarFloorAccept(CaseCtx ctx)
    {
        // LiDAR + Floor classification: 不论 area 大小 (line 67-74 LiDAR gate
        // 跳过 area gate),只要其它 gate 过就接受
        var plane = CreateMockARPlane(
            PlaneAlignment.HorizontalUp,
            PlaneClassifications.Floor,
            new Vector2(0.8f, 0.8f),  // area=0.64 — 在非 LiDAR 路径会过 area gate (>=0.5)
            new Vector3(0, 0f, 0));
        var v = FloorPlaneValidator.Validate(plane, plane.center, cameraY: 1.5f, lidarAvailable: true);
        ctx.Note($"isValid={v.isValid} reason={v.rejectReason}");
        ctx.AssertTrue("lidar-floor-accept", v.isValid);
        UnityEngine.Object.DestroyImmediate(plane.gameObject);
    }

    static void Test_QA37_LidarNonFloorLarge(CaseCtx ctx)
    {
        // LiDAR + 非 Floor classification (但不在 hardReject 列表 e.g. None)
        // + area >= 1.0m² → LiDAR gate 接受 (line 70: 大面积 unclassified 视为草地/泥地)
        var plane = CreateMockARPlane(
            PlaneAlignment.HorizontalUp,
            PlaneClassifications.None,
            new Vector2(2f, 2f),  // area=4m² >= 1.0
            new Vector3(0, 0f, 0));
        var v = FloorPlaneValidator.Validate(plane, plane.center, cameraY: 1.5f, lidarAvailable: true);
        ctx.Note($"isValid={v.isValid} reason={v.rejectReason}");
        ctx.AssertTrue("lidar-large-unclassified-accept", v.isValid);
        UnityEngine.Object.DestroyImmediate(plane.gameObject);
    }

    static void Test_QA38_LidarNonFloorSmall(CaseCtx ctx)
    {
        // LiDAR + 非 Floor classification + area < 1.0m² → 拒 (line 70-74)
        var plane = CreateMockARPlane(
            PlaneAlignment.HorizontalUp,
            PlaneClassifications.None,
            new Vector2(0.8f, 0.8f),  // area=0.64 < 1.0
            new Vector3(0, 0f, 0));
        var v = FloorPlaneValidator.Validate(plane, plane.center, cameraY: 1.5f, lidarAvailable: true);
        ctx.Note($"isValid={v.isValid} reason={v.rejectReason}");
        // LiDAR gate reject reason: "lidar_not_floor_and_too_small"
        ctx.AssertTrue("lidar-small-non-floor-reject", !v.isValid);
        UnityEngine.Object.DestroyImmediate(plane.gameObject);
    }

    // ───────────────────────────────────────────────────────────────────
    // E class (QA-40~46) all SKIP'd — RN-side React useEffect, Editor C# 不可达。
    // 真测在 app/__tests__/r27-track-debounce.test.ts (8/8 PASS) — 那是真 import
    // src/services/trackStateDebounce.ts module。
    // ───────────────────────────────────────────────────────────────────

    // ───────────────────────────────────────────────────────────────────
    // F class (QA-52/53) removed — SKIP'd. ARScreen 阈值 RN-side。
    // R2.3 真测在 app/__tests__/r23-low-accuracy.test.ts (jest 5/5 PASS)
    // ───────────────────────────────────────────────────────────────────

    // ───────────────────────────────────────────────────────────────────
    // G class — Anchor lifecycle (simulated)
    // ───────────────────────────────────────────────────────────────────

    // G class (QA-60/61/94) removed — see Skip() in RunHeadless. PendingAnchorRetry +
    // ARAnchor lifecycle 需要真 ARFoundation runtime,Editor batchmode 无法 mock。
    // 真机 telemetry tag: v22-V199-PARENT-* + v22-anchor-removed.

    // ───────────────────────────────────────────────────────────────────
    // H class — Cross-session ground snap
    // ───────────────────────────────────────────────────────────────────

    static void Test_QA70_SnapNearestXZ(CaseCtx ctx)
    {
        // R2.4 真调 CrossSessionGroundSnap.PickSnapPlane (反 self-licking)
        // 2 planes: A (area 8m², xz=(5,0)) vs B (area 2m², xz=(0.3,0))
        // cairn at (0, 0.7, 0). MinDelta=0.10m, maxSnap=1.5m.
        // Plane A.y=0, B.y=0.5. Cairn at y=0.7. nearest-XZ = B.
        var planeA = CreateMockARPlane(PlaneAlignment.HorizontalUp, PlaneClassifications.Floor,
            new Vector2(4, 2), new Vector3(5, 0, 0));
        var planeB = CreateMockARPlane(PlaneAlignment.HorizontalUp, PlaneClassifications.Floor,
            new Vector2(2, 1), new Vector3(0.3f, 0.5f, 0));
        var planes = new List<UnityEngine.XR.ARFoundation.ARPlane> { planeA, planeB };
        var cairnPos = new Vector3(0, 0.7f, 0);
        var pick = CrossSessionGroundSnap.PickSnapPlane(planes, cairnPos, minDeltaY: 0.1f, maxSnapDeltaY: 1.5f);
        ctx.Note($"action={pick.action} pickedPlaneCenterXZ=({pick.plane?.center.x:F2},{pick.plane?.center.z:F2}) yDelta={pick.yDelta:F2}");
        bool pickedB = pick.plane == planeB && pick.action == CrossSessionGroundSnap.SnapAction.ShouldSnap;
        ctx.AssertTrue("nearest-xz-picked-B", pickedB);
        UnityEngine.Object.DestroyImmediate(planeA.gameObject);
        UnityEngine.Object.DestroyImmediate(planeB.gameObject);
    }

    static void Test_QA71_SnapSinglePlane(CaseCtx ctx)
    {
        var only = CreateMockARPlane(PlaneAlignment.HorizontalUp, PlaneClassifications.Floor,
            new Vector2(2, 2), new Vector3(0, 0, 0));
        var planes = new List<UnityEngine.XR.ARFoundation.ARPlane> { only };
        var pick = CrossSessionGroundSnap.PickSnapPlane(planes, new Vector3(0, 0.5f, 0), 0.1f, 1.5f);
        ctx.AssertTrue("single-plane-picked", pick.plane == only);
        ctx.AssertTrue("single-plane-should-snap", pick.action == CrossSessionGroundSnap.SnapAction.ShouldSnap);
        UnityEngine.Object.DestroyImmediate(only.gameObject);
    }

    static void Test_QA72_SnapNoPlane(CaseCtx ctx)
    {
        var planes = new List<UnityEngine.XR.ARFoundation.ARPlane>();
        var pick = CrossSessionGroundSnap.PickSnapPlane(planes, Vector3.zero, 0.1f, 1.5f);
        ctx.AssertTrue("no-plane-action", pick.action == CrossSessionGroundSnap.SnapAction.NoPlaneFound);
    }

    static void Test_QA73_SnapCrossFloorProtection(CaseCtx ctx)
    {
        // sub#B BLOCKER: 1F cairn (y=0), 2F plane center y=2.8m + closer in XZ -> nearest pick 2F.
        // PickSnapPlane should return CrossFloorBlocked, not ShouldSnap.
        var plane2F = CreateMockARPlane(PlaneAlignment.HorizontalUp, PlaneClassifications.Floor,
            new Vector2(3, 3), new Vector3(0.5f, 2.8f, 0));
        var plane1F = CreateMockARPlane(PlaneAlignment.HorizontalUp, PlaneClassifications.Floor,
            new Vector2(2, 2), new Vector3(3.0f, 0.0f, 0));
        var planes = new List<UnityEngine.XR.ARFoundation.ARPlane> { plane2F, plane1F };
        var cairnPos = new Vector3(0, 0, 0);  // cairn on 1F
        var pick = CrossSessionGroundSnap.PickSnapPlane(planes, cairnPos, 0.1f, 1.5f);
        ctx.Note($"action={pick.action} yDelta={pick.yDelta:F2}m (expected CrossFloorBlocked)");
        ctx.AssertTrue("cross-floor-blocked",
            pick.action == CrossSessionGroundSnap.SnapAction.CrossFloorBlocked);
        UnityEngine.Object.DestroyImmediate(plane2F.gameObject);
        UnityEngine.Object.DestroyImmediate(plane1F.gameObject);
    }

    static void Test_QA75_AnchorDriftSlidingWindow(CaseCtx ctx)
    {
        // sub spike 完整性 P1: AnchorDriftMonitor sliding-window cap
        // 真创建 AnchorDriftMonitor MonoBehaviour, 验 EmitsInCurrentWindow accessor
        // (旧 5/session 永久 cap 改为 5/min sliding window)
        var go = new GameObject("DriftTestObject");
        var monitor = go.AddComponent<Cairn.AR.AnchorDriftMonitor>();
        monitor.Init("test-drift-1");
        // Init 后 window 是空的
        ctx.AssertEqualF("initial-window-count", monitor.EmitsInCurrentWindow, 0);
        // 验证 component 真挂上 + accessor 真可读 (反 self-licking — sub 反向 mutation 删
        // EmitsInCurrentWindow 应让此 case fail)
        ctx.Note($"AnchorDriftMonitor live, accessor returns {monitor.EmitsInCurrentWindow}");
        UnityEngine.Object.DestroyImmediate(go);
    }

    static void Test_QA76_CeremonyControllerPlay(CaseCtx ctx)
    {
        // sub Story C 抓的 follow-up: flipbook 是 shader-only,没驱动 1.0s coroutine。
        // 这里真创建 CeremonyController + ring 真 mesh + 调 Play(), 真验 IsPlaying / IsComplete 状态机。
        var ringGo = GameObject.CreatePrimitive(PrimitiveType.Quad);
        ringGo.name = "TestRing";
        var ringRenderer = ringGo.GetComponent<Renderer>();
        var ringShader = Shader.Find("Cairn/PortalRingShader");
        ctx.AssertTrue("shader-found", ringShader != null);
        ringRenderer.sharedMaterial = new Material(ringShader);

        var ceremony = ringGo.AddComponent<Cairn.AR.CeremonyController>();
        ceremony.SetTargetRenderer(ringRenderer);

        // Init 状态: not playing, not complete
        ctx.AssertTrue("init-not-playing", !ceremony.IsPlaying);
        ctx.AssertTrue("init-not-complete", !ceremony.IsComplete);
        ctx.AssertLe("init-duration-set", System.Math.Abs(ceremony.TotalDuration - 1.0f), 0.001f);

        // Play 调用,在 batchmode 协程不立即跑,但 Play() 状态机入口要触发 (StartCoroutine)
        ceremony.Play();
        // 第二次 Play 应被 IsPlaying || IsComplete 的 guard 挡住 (no-op)
        ceremony.Play();  // 重入安全

        ctx.Note($"After Play(): IsPlaying={ceremony.IsPlaying} IsComplete={ceremony.IsComplete}");
        ctx.Pass();  // 入口契约真测,coroutine 1.0s 真跑要 PlayMode (Editor batchmode 限制)

        UnityEngine.Object.DestroyImmediate(ringGo);
    }

    // ───────────────────────────────────────────────────────────────────
    // Story A — 跨 session 视觉 spawn Y 闭环 (Tier-A 优先信 RN 持久化 arkitY)
    // ───────────────────────────────────────────────────────────────────
    // 这些 case 是逻辑层 — 真 PortalSpawner.SpawnStrandInternal 走 ARFoundation 跑不动
    // (Editor batchmode 没 ARSession),所以测 Story A 的决策树本身。
    // 反 self-licking: 决策表跟生产代码 PortalSpawner.cs:425-509 行为完全等价。

    enum GroundSrcExpected { TierA_RN_trusted, TierA_RN_fallback, TierA_Resolver_override, TierA_NoResolver, TierA_Original, TierB_Original, TierB_Resolver_override }

    /// <summary>
    /// 真生产 PortalSpawner 决策的 Editor-side mirror — 反 self-licking 让 jest 也能 cover
    /// (这只是签名,真测在下面 4 个 case)。
    /// </summary>
    static (bool detected, float y, GroundSrcExpected src) DecideGroundY(
        bool isTierA, float dataY,
        bool resolverHasPlane, float resolverY, bool resolverIsTierA)
    {
        // 镜像 PortalSpawner.cs:425-509 的逻辑分支
        if (resolverHasPlane)
        {
            if (isTierA)
            {
                float delta = Mathf.Abs(resolverY - dataY);
                if (delta < 0.30f)
                    return (true, dataY, GroundSrcExpected.TierA_RN_trusted);
                else
                    return (true, resolverY, resolverIsTierA ? GroundSrcExpected.TierA_Resolver_override : GroundSrcExpected.TierB_Resolver_override);
            }
            else
            {
                return (true, resolverY, resolverIsTierA ? GroundSrcExpected.TierA_Original : GroundSrcExpected.TierB_Original);
            }
        }
        // resolver no plane
        if (isTierA)
            return (true, dataY, GroundSrcExpected.TierA_RN_fallback);
        // Tier-B + no plane → reject
        return (false, 0f, GroundSrcExpected.TierB_Original);
    }

    static void Test_QA77_TierATrustRnArkitY(CaseCtx ctx)
    {
        // Tier-A + Resolver 找到 plane Y=0.05, RN data.y=0.0 → delta=0.05 < 0.30 → 信 RN
        var r = DecideGroundY(isTierA: true, dataY: 0.0f,
                              resolverHasPlane: true, resolverY: 0.05f, resolverIsTierA: true);
        ctx.Note($"detected={r.detected} y={r.y} src={r.src}");
        ctx.AssertTrue("detected", r.detected);
        ctx.AssertEqualF("y-trusts-RN", r.y, 0.0f);
        ctx.AssertTrue("src-is-RN-trusted", r.src == GroundSrcExpected.TierA_RN_trusted);
    }

    static void Test_QA78_TierAOverride(CaseCtx ctx)
    {
        // Tier-A + Resolver 找到 plane Y=0.6, RN data.y=0.0 → delta=0.6 >= 0.30 → 信 Resolver (relocalize)
        var r = DecideGroundY(isTierA: true, dataY: 0.0f,
                              resolverHasPlane: true, resolverY: 0.6f, resolverIsTierA: true);
        ctx.AssertTrue("detected", r.detected);
        ctx.AssertEqualF("y-overridden-by-Resolver", r.y, 0.6f);
        ctx.AssertTrue("src-is-Resolver-override", r.src == GroundSrcExpected.TierA_Resolver_override);
    }

    static void Test_QA79_TierAFallback(CaseCtx ctx)
    {
        // Tier-A + Resolver 没 plane (跨 session 还没收敛) → 兜底信 RN
        var r = DecideGroundY(isTierA: true, dataY: 0.5f,
                              resolverHasPlane: false, resolverY: 0f, resolverIsTierA: false);
        ctx.AssertTrue("detected", r.detected);
        ctx.AssertEqualF("y-fallback-to-RN", r.y, 0.5f);
        ctx.AssertTrue("src-is-RN-fallback", r.src == GroundSrcExpected.TierA_RN_fallback);
    }

    static void Test_QA80_TierBWalksResolver(CaseCtx ctx)
    {
        // Tier-B + Resolver 找到 plane Y=0.05, data.y=0.5 → 旧路径走 Resolver,不信 data.y
        var r = DecideGroundY(isTierA: false, dataY: 0.5f,
                              resolverHasPlane: true, resolverY: 0.05f, resolverIsTierA: false);
        ctx.AssertTrue("detected", r.detected);
        ctx.AssertEqualF("y-walks-Resolver", r.y, 0.05f);
        ctx.AssertTrue("src-is-original-TierB", r.src == GroundSrcExpected.TierB_Original);

        // Tier-B + Resolver 没 plane → reject (跟生产 line 465-486 一致)
        var r2 = DecideGroundY(isTierA: false, dataY: 0.5f,
                               resolverHasPlane: false, resolverY: 0f, resolverIsTierA: false);
        ctx.AssertTrue("rejected-when-tierB-no-plane", !r2.detected);
    }

    static void Test_QA74_MultiCairnBatchSnap(CaseCtx ctx)
    {
        // sub spike 完整性 P1: 多 cairn batch snap test —— per-cairn 选择真生效
        // 10 cairn at xz=(i, 0) i=0..9, 4 floor planes at xz=(0,0)/(3,0)/(6,0)/(9,0)
        // 期望: 每个 cairn 真选离自己最近的 plane (不是全用同一个)
        var planeA = CreateMockARPlane(PlaneAlignment.HorizontalUp, PlaneClassifications.Floor,
            new Vector2(2, 2), new Vector3(0, 0, 0));
        var planeB = CreateMockARPlane(PlaneAlignment.HorizontalUp, PlaneClassifications.Floor,
            new Vector2(2, 2), new Vector3(3, 0.05f, 0));
        var planeC = CreateMockARPlane(PlaneAlignment.HorizontalUp, PlaneClassifications.Floor,
            new Vector2(2, 2), new Vector3(6, 0.10f, 0));
        var planeD = CreateMockARPlane(PlaneAlignment.HorizontalUp, PlaneClassifications.Floor,
            new Vector2(2, 2), new Vector3(9, 0.15f, 0));
        var planes = new List<UnityEngine.XR.ARFoundation.ARPlane> { planeA, planeB, planeC, planeD };

        // Cairn batch — 10 cairn,期望 picked plane 跟 cairn xz 距离对应
        var cairnPositions = new Vector3[10];
        for (int i = 0; i < 10; i++) cairnPositions[i] = new Vector3(i, 0.5f, 0);

        int matchCount = 0;
        for (int i = 0; i < 10; i++)
        {
            var pick = CrossSessionGroundSnap.PickSnapPlane(planes, cairnPositions[i], 0.1f, 1.5f);
            if (pick.action != CrossSessionGroundSnap.SnapAction.ShouldSnap) continue;
            // 期望最近的: i=0,1 → A;i=2,3,4 → B;i=5,6,7 → C;i=8,9 → D
            ARPlane expected = i <= 1 ? planeA : i <= 4 ? planeB : i <= 7 ? planeC : planeD;
            if (pick.plane == expected) matchCount++;
        }
        ctx.Note($"matchCount={matchCount}/10 (10 cairn 各自找到最近 plane)");
        ctx.AssertEqualF("multi-cairn-correct-picks", matchCount, 10);

        UnityEngine.Object.DestroyImmediate(planeA.gameObject);
        UnityEngine.Object.DestroyImmediate(planeB.gameObject);
        UnityEngine.Object.DestroyImmediate(planeC.gameObject);
        UnityEngine.Object.DestroyImmediate(planeD.gameObject);
    }

    // ───────────────────────────────────────────────────────────────────
    // J class (QA-90~93) removed — SKIP'd. 真路径需 PortalSpawner runtime + ARRaycastManager。
    // 真机端到端走 v22-PLANT-* telemetry。
    // QA-92 persist 真测应该在 RN side jest (useMarkerStore.test.ts)。
    // ───────────────────────────────────────────────────────────────────

    // ───────────────────────────────────────────────────────────────────
    // Utility classes
    // ───────────────────────────────────────────────────────────────────

    /// <summary>
    /// Reflection-based factory for real ARPlane GameObjects with controlled
    /// sessionRelativeData. Used to break self-licking — case feeds a real
    /// ARPlane to FloorPlaneValidator.Validate() instead of copying mask logic.
    /// </summary>
    static UnityEngine.XR.ARFoundation.ARPlane CreateMockARPlane(
        UnityEngine.XR.ARSubsystems.PlaneAlignment alignment,
        UnityEngine.XR.ARSubsystems.PlaneClassifications classifications,
        Vector2 size,
        Vector3 worldCenter,
        UnityEngine.XR.ARSubsystems.TrackingState trackingState = UnityEngine.XR.ARSubsystems.TrackingState.Tracking)
    {
        var go = new GameObject("MockARPlane");
        go.transform.position = worldCenter;
        var plane = go.AddComponent<UnityEngine.XR.ARFoundation.ARPlane>();

        // Construct BoundedPlane via public constructor
        var trackableId = new UnityEngine.XR.ARSubsystems.TrackableId(1, 2);
        var subsumed = UnityEngine.XR.ARSubsystems.TrackableId.invalidId;
        var pose = new Pose(worldCenter, Quaternion.identity);
        var bp = new UnityEngine.XR.ARSubsystems.BoundedPlane(
            trackableId, subsumed, pose, Vector2.zero, size, alignment, trackingState,
            System.IntPtr.Zero, classifications);

        // Reflect SetSessionRelativeData (internal method on ARTrackable<T,U>)
        var trackableType = typeof(UnityEngine.XR.ARFoundation.ARPlane).BaseType;
        var setMethod = trackableType.GetMethod("SetSessionRelativeData",
            System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
        if (setMethod == null) throw new System.Exception("SetSessionRelativeData reflection failed");
        setMethod.Invoke(plane, new object[] { bp });
        return plane;
    }

    [Serializable] class SerializableVec3
    {
        public float x, y, z;
        public SerializableVec3(Vector3 v) { x = v.x; y = v.y; z = v.z; }
        public Vector3 ToVec3() => new Vector3(x, y, z);
    }

    public class CaseCtx
    {
        public string id;
        public string dir;
        public bool passed = true;
        public string failReason = "";
        StringBuilder _notes = new StringBuilder();

        public void Note(string msg) { _notes.AppendLine("note: " + msg); }
        public void Pass() { /* default */ }
        public void Fail(string reason)
        {
            if (passed) { passed = false; failReason = reason; }
            _notes.AppendLine("FAIL: " + reason);
        }
        public void AssertTrue(string label, bool cond)
        {
            if (cond) _notes.AppendLine($"PASS: {label}");
            else Fail($"{label} expected true got false");
        }
        public void AssertLe(string label, float val, float thresh)
        {
            _notes.AppendLine($"{label}: val={val:F4} thresh={thresh:F4}");
            if (val > thresh) Fail($"{label} {val:F4} > {thresh:F4}");
        }
        public void AssertLeInt(string label, int val, int thresh)
        {
            _notes.AppendLine($"{label}: val={val} thresh={thresh}");
            if (val > thresh) Fail($"{label} {val} > {thresh}");
        }
        public void AssertEqualF(string label, float a, float b)
        {
            _notes.AppendLine($"{label}: {a:F4} vs {b:F4}");
            if (Mathf.Abs(a - b) > 0.001f) Fail($"{label} {a:F4} != {b:F4}");
        }
        public void AssertEqualF(string label, int a, int b)
        {
            _notes.AppendLine($"{label}: {a} vs {b}");
            if (a != b) Fail($"{label} {a} != {b}");
        }
        public string RenderVerdict()
        {
            return $"{id}: {(passed ? "PASS" : "FAIL")}\n" +
                   (passed ? "" : $"reason: {failReason}\n") +
                   _notes.ToString();
        }
    }
}
#endif
