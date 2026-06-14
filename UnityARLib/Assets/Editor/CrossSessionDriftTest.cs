#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;
using System.IO;

/// <summary>
/// v0.2.4 QA infrastructure spike — Cross-session ARKit drift simulation.
///
/// Goal: prove the QA pipeline can produce two side-by-side PNGs that
/// VISUALLY show the "cairn flies to sky on app restart" bug class.
///
/// Approach (per SPIKE-Q3b verdict):
///   - Edit-mode batch render only (no PlayMode — can't enter PlayMode in -batchmode)
///   - Scene: dark background + ground plane + red cube (simulated cairn at y=0)
///   - Session 1: camera at (0, 1.5, -3) looking at origin → screenshot
///   - Simulate ARKit world-frame drift between sessions: translate XROrigin's
///     transform (or here, the camera parent) by Δy=+0.5m
///   - Session 2: same camera relative pose, but world has shifted →
///     red cube now appears LOWER in frame (= "cairn floating to sky" from user's POV)
///   - Save both PNGs side-by-side for human eyeball verification
///
/// This is a DUMMY test: red cube stands in for cairn. If this pipeline
/// produces two different PNGs that show drift visually, the QA infra works.
/// Then we can swap red cube → real cairn spawn and trust the result.
///
/// Usage:
///   "C:/tools/Unity/6000.0.76f1/Editor/Unity.exe" -batchmode -projectPath UnityARLib \
///     -executeMethod CrossSessionDriftTest.RunHeadless -quit -logFile -
///
/// Output:
///   Logs/cross-session/session1.png
///   Logs/cross-session/session2.png
///   Logs/cross-session/diff-summary.txt
/// </summary>
public static class CrossSessionDriftTest
{
    const string OUT_DIR = "Logs/cross-session";
    const int W = 1280, H = 720;

    [MenuItem("Cairn/Cross-Session Drift Test")]
    public static void RunFromMenu() { RunHeadless(); }

    public static void RunHeadless()
    {
        Debug.Log("[CrossSession] === START ===");

        try
        {
            Directory.CreateDirectory(OUT_DIR);

            // Build a minimal scene — no AR dependencies, just camera + ground + cube
            var scene = UnityEditor.SceneManagement.EditorSceneManager.NewScene(
                UnityEditor.SceneManagement.NewSceneSetup.EmptyScene,
                UnityEditor.SceneManagement.NewSceneMode.Single);

            // Directional light
            var lightGo = new GameObject("Sun");
            var light = lightGo.AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 1.2f;
            lightGo.transform.rotation = Quaternion.Euler(50f, -30f, 0f);

            // Ground plane (gray, 10x10)
            var ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
            ground.name = "Ground";
            ground.transform.position = Vector3.zero;
            ground.transform.localScale = Vector3.one * 1.5f;
            var groundMat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            groundMat.color = new Color(0.3f, 0.3f, 0.35f);
            ground.GetComponent<Renderer>().material = groundMat;

            // The "cairn" = a tall red cube at origin, standing on ground
            var cairn = GameObject.CreatePrimitive(PrimitiveType.Cube);
            cairn.name = "FakeCairn";
            cairn.transform.position = new Vector3(0f, 0.5f, 0f);  // bottom on ground (y=0)
            cairn.transform.localScale = new Vector3(0.3f, 1.0f, 0.3f);
            var cairnMat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            cairnMat.color = new Color(0.9f, 0.2f, 0.2f);
            cairn.GetComponent<Renderer>().material = cairnMat;

            // "XROrigin" parent — what we translate to simulate ARKit world drift
            var xrOrigin = new GameObject("XROrigin");
            xrOrigin.transform.position = Vector3.zero;

            // Camera as child of XROrigin (mimics ARFoundation hierarchy)
            var camGo = new GameObject("Main Camera");
            camGo.transform.SetParent(xrOrigin.transform, worldPositionStays: false);
            var cam = camGo.AddComponent<Camera>();
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0.05f, 0.05f, 0.10f);
            cam.fieldOfView = 60f;
            cam.nearClipPlane = 0.1f;
            cam.farClipPlane = 100f;
            // Camera local pos: (0, 1.5, -3), looking at world origin (0,0.5,0)
            camGo.transform.localPosition = new Vector3(0f, 1.5f, -3f);
            camGo.transform.LookAt(new Vector3(0f, 0.5f, 0f));

            Debug.Log($"[CrossSession] Scene built: cairn at y=0.5, camera at world {camGo.transform.position}");

            // === SESSION 1 ===
            // ARKit's world-frame says ground is at y=0; cairn at y=0.5.
            // User plants cairn here. Snapshot.
            CaptureToPng(cam, Path.Combine(OUT_DIR, "session1.png"));
            Debug.Log("[CrossSession] Session 1 captured (cairn ON ground)");

            // === SIMULATE CROSS-SESSION ARKIT DRIFT ===
            // ARKit on app restart re-computes world frame. The same anchor
            // (which is parented to the cairn) used to be at world y=0.5
            // (touching ground), but ARKit's new world frame is shifted.
            //
            // From the USER's view, the cairn now appears to FLOAT 0.5m
            // above the ground because the cairn's stored anchor pose is
            // y=0.5 but the new floor is at y=0 PLUS the drift Δ.
            //
            // We simulate by lowering XROrigin (and hence camera+ground)
            // while keeping the cairn at world y=0.5. Visually: cairn
            // hovers above ground.
            float driftY = 0.5f;  // ARKit world frame shifted down 0.5m
            xrOrigin.transform.position = new Vector3(0f, -driftY, 0f);
            // Now camera world pos is (0, 1.5 - 0.5, -3) = (0, 1.0, -3)
            // Ground stays at world y=0 (it's NOT a child of XROrigin —
            // ground represents the REAL physical floor we just walked on).
            // But wait — ground in real life is what ARKit's plane detection
            // tells us it is. So in session 2, ground IS at y=-0.5 from
            // ARKit's perspective. Let me make this more realistic:
            //
            // Actually, the cleanest way: keep XROrigin at zero, and
            // raise the cairn by driftY. That visually = cairn floats up.
            xrOrigin.transform.position = Vector3.zero;
            cairn.transform.position = new Vector3(0f, 0.5f + driftY, 0f);
            Debug.Log($"[CrossSession] Drift applied: cairn now at y={cairn.transform.position.y} (was 0.5)");

            // === SESSION 2 ===
            CaptureToPng(cam, Path.Combine(OUT_DIR, "session2.png"));
            Debug.Log("[CrossSession] Session 2 captured (cairn FLOATING 0.5m above ground)");

            // Write summary
            string summary =
                "Cross-Session Drift Test — Dummy harness\n" +
                "=========================================\n" +
                $"Resolution: {W}x{H}\n" +
                $"Camera: world pos (0, 1.5, -3), looking at origin\n" +
                $"Session 1: cairn at y=0.5 (touching ground)\n" +
                $"Session 2: cairn at y={0.5f + driftY:F2} (after {driftY:F2}m simulated ARKit drift)\n" +
                "\n" +
                "PASS criteria: session1.png shows red cube ON ground;\n" +
                "               session2.png shows red cube FLOATING above ground.\n" +
                "\n" +
                "If both PNGs render and look different, the QA pipeline works.\n";
            File.WriteAllText(Path.Combine(OUT_DIR, "diff-summary.txt"), summary);

            Debug.Log("[CrossSession] === DONE ===");
            if (Application.isBatchMode) EditorApplication.Exit(0);
        }
        catch (System.Exception e)
        {
            Debug.LogError($"[CrossSession] FAILED: {e}");
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
        Debug.Log($"[CrossSession] Wrote {png.Length} bytes -> {path}");
    }
}
#endif
