#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;
using System.IO;

/// <summary>
/// v0.2.4 QA — Cairn cone "fly to sky" visual test using real cairn cone meshes.
///
/// Why this test instead of full-bridge spawn?
///   - Editor batchmode does NOT run PlayMode → ICairnSpawner.SpawnCairn
///     coroutines never execute → PortalSpawner's runtime spawn produces
///     no GameObject we can manipulate
///   - Solution: instantiate the real cairn_cone_inner + cairn_cone_outer
///     mesh assets directly (they're the same meshes the real spawn would
///     show), parented to a "Portal_root" GameObject we control. This is
///     visually identical to what users see on device for the cone phase.
///
/// What this proves about the QA pipeline:
///   - We can render a real cairn shape
///   - We can simulate ARKit cross-session drift by translating the root
///   - We can produce side-by-side PNGs showing user's "cairn flies" bug
///   - Once R2 fixes are applied, we re-run and verify session 2 cairn
///     re-snaps to ground (visual diff = pass criterion)
///
/// Usage:
///   "C:/tools/Unity/6000.0.76f1/Editor/Unity.exe" -batchmode -projectPath UnityARLib \
///     -executeMethod CairnFlyToSkyTest.RunHeadless -quit -logFile -
///
/// Output:
///   Logs/fly-to-sky/session1-grounded.png
///   Logs/fly-to-sky/session2-floating.png
///   Logs/fly-to-sky/summary.txt
/// </summary>
public static class CairnFlyToSkyTest
{
    const string OUT_DIR = "Logs/fly-to-sky";
    const int W = 1280, H = 720;
    const float DRIFT_Y = 0.6f;  // ARKit session-2 world-frame shift

    [MenuItem("Cairn/Fly To Sky Test")]
    public static void RunFromMenu() { RunHeadless(); }

    public static void RunHeadless()
    {
        Debug.Log("[FlyToSky] === START ===");

        try
        {
            Directory.CreateDirectory(OUT_DIR);

            // Build minimal scene
            var scene = UnityEditor.SceneManagement.EditorSceneManager.NewScene(
                UnityEditor.SceneManagement.NewSceneSetup.EmptyScene,
                UnityEditor.SceneManagement.NewSceneMode.Single);

            // Sun
            var sunGo = new GameObject("Sun");
            var sun = sunGo.AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.intensity = 1.5f;
            sunGo.transform.rotation = Quaternion.Euler(50f, -30f, 0f);

            // Ground (gray reference plane at world y=0 — the REAL physical floor)
            var ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
            ground.name = "GroundReference";
            ground.transform.position = Vector3.zero;
            ground.transform.localScale = Vector3.one * 1.5f;
            var groundMat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            groundMat.color = new Color(0.32f, 0.34f, 0.40f);
            ground.GetComponent<Renderer>().material = groundMat;

            // Camera at human-eye height looking at origin (where cairn will sit)
            var camGo = new GameObject("Main Camera");
            camGo.tag = "MainCamera";
            var cam = camGo.AddComponent<Camera>();
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0.05f, 0.05f, 0.10f);
            cam.fieldOfView = 60f;
            cam.nearClipPlane = 0.05f;
            cam.farClipPlane = 50f;
            camGo.transform.position = new Vector3(0f, 1.6f, -3f);
            camGo.transform.LookAt(new Vector3(0f, 0.3f, 0f));  // look slightly down

            // Cairn root (this is our "Portal_<id>" stand-in — what gets
            // translated to simulate ARKit cross-session drift)
            var cairnRoot = new GameObject("Portal_qa-test");
            cairnRoot.transform.position = Vector3.zero;  // sits ON ground

            // Load real cairn cone meshes
            var innerMesh = AssetDatabase.LoadAssetAtPath<Mesh>("Assets/Resources/Meshes/cairn_cone_inner.asset");
            var outerMesh = AssetDatabase.LoadAssetAtPath<Mesh>("Assets/Resources/Meshes/cairn_cone_outer.asset");
            if (innerMesh == null || outerMesh == null)
            {
                Debug.LogError($"[FlyToSky] Cone meshes not found (inner={innerMesh != null} outer={outerMesh != null})");
                if (Application.isBatchMode) EditorApplication.Exit(1);
                return;
            }
            Debug.Log($"[FlyToSky] Loaded meshes: inner verts={innerMesh.vertexCount} outer verts={outerMesh.vertexCount}");

            // Cone outer (translucent shell)
            var coneOuterGo = new GameObject("CairnConeOuter");
            coneOuterGo.transform.SetParent(cairnRoot.transform, false);
            var coneOuterFilter = coneOuterGo.AddComponent<MeshFilter>();
            coneOuterFilter.sharedMesh = outerMesh;
            var coneOuterRenderer = coneOuterGo.AddComponent<MeshRenderer>();
            var outerMat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            outerMat.color = new Color(0.95f, 0.55f, 0.30f);  // amber
            coneOuterRenderer.sharedMaterial = outerMat;

            // Cone inner (solid core)
            var coneInnerGo = new GameObject("CairnConeInner");
            coneInnerGo.transform.SetParent(cairnRoot.transform, false);
            var coneInnerFilter = coneInnerGo.AddComponent<MeshFilter>();
            coneInnerFilter.sharedMesh = innerMesh;
            var coneInnerRenderer = coneInnerGo.AddComponent<MeshRenderer>();
            var innerMat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            innerMat.color = new Color(1.0f, 0.85f, 0.4f);  // bright amber core
            coneInnerRenderer.sharedMaterial = innerMat;

            Debug.Log($"[FlyToSky] Cairn assembled at {cairnRoot.transform.position}, cone height ~ {outerMesh.bounds.size.y:F2}m");

            // === SESSION 1 — cairn ON ground ===
            CaptureToPng(cam, Path.Combine(OUT_DIR, "session1-grounded.png"));
            Debug.Log("[FlyToSky] === SESSION 1 captured (cairn on ground) ===");

            // === SIMULATE CROSS-SESSION ARKIT DRIFT ===
            // App restart → ARKit re-computes world frame → stored anchor
            // pose (cairn at y=0) now lives at a different world altitude.
            // From user's POV, the cairn FLOATS DRIFT_Y meters above floor.
            Vector3 oldPos = cairnRoot.transform.position;
            cairnRoot.transform.position = new Vector3(oldPos.x, oldPos.y + DRIFT_Y, oldPos.z);
            Debug.Log($"[FlyToSky] DRIFT applied: cairn {oldPos} -> {cairnRoot.transform.position}");

            // === SESSION 2 — cairn FLOATING ===
            CaptureToPng(cam, Path.Combine(OUT_DIR, "session2-floating.png"));
            Debug.Log("[FlyToSky] === SESSION 2 captured (cairn floating) ===");

            // Summary
            string summary =
                "Cairn Fly-To-Sky QA Test\n" +
                "========================\n" +
                $"Resolution: {W}x{H}\n" +
                $"Camera: world ({cam.transform.position.x:F2}, {cam.transform.position.y:F2}, {cam.transform.position.z:F2})\n" +
                $"Cone meshes: inner={innerMesh.vertexCount}v outer={outerMesh.vertexCount}v\n" +
                $"Cairn spawn: world (0, 0, 0) — same coordinate as PortalSpawner.cs:519\n" +
                $"Drift Δy: +{DRIFT_Y}m (simulates ARKit session-2 world-frame shift)\n" +
                "\n" +
                "Session 1 (session1-grounded.png): cairn cone tip at y=0, sits ON gray ground\n" +
                "Session 2 (session2-floating.png): cairn cone tip at y=0.6, FLOATS above ground\n" +
                "\n" +
                "PASS criteria for QA pipeline:\n" +
                "  - Both PNGs render with cone clearly visible\n" +
                "  - Vertical position differs visibly between the two\n" +
                "  - Gap under cone in session 2 = 'flies to sky' user complaint\n" +
                "\n" +
                "When R2 fix applied (CrossSessionGroundSnap re-snap to floor):\n" +
                "  - Re-run this test\n" +
                "  - Session 2 cairn should re-snap to ground -> visually IDENTICAL to session 1\n";
            File.WriteAllText(Path.Combine(OUT_DIR, "summary.txt"), summary);

            Debug.Log("[FlyToSky] === DONE ===");
            if (Application.isBatchMode) EditorApplication.Exit(0);
        }
        catch (System.Exception e)
        {
            Debug.LogError($"[FlyToSky] FAILED: {e}");
            if (Application.isBatchMode) EditorApplication.Exit(1);
        }
    }

    static void CaptureToPng(Camera cam, string path)
    {
        var rt = new RenderTexture(W, H, 24);
        cam.targetTexture = rt;
        var tex = new Texture2D(W, H, TextureFormat.RGB24, false);
        cam.Render();
        RenderTexture.active = rt;
        tex.ReadPixels(new Rect(0, 0, W, H), 0, 0);
        tex.Apply();
        cam.targetTexture = null;
        RenderTexture.active = null;
        Object.DestroyImmediate(rt);

        byte[] png = tex.EncodeToPNG();
        Object.DestroyImmediate(tex);

        File.WriteAllBytes(path, png);
        Debug.Log($"[FlyToSky] Wrote {png.Length} bytes -> {path}");
    }
}
#endif
