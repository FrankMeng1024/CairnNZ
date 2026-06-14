#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;
using System.IO;

/// <summary>
/// v0.2.4 R2-followup Story C — Ceremony sweep flipbook.
///
/// 验证 PortalRingShader._SweepAngle + _Reveal 真生效:
///   24 帧 (1.0s @ 24fps), 每帧 MPB 设 sweepT 跟 HTML 基准 timeline:
///     t=0..0.50: sweepAngle 0..2π (clockwise sweep), reveal=0
///     t=0.50..0.85: sweepAngle=2π (full circle), reveal=0..1 (icon fade)
///     t=0.85..1.0: sweepAngle=2π, reveal=1 (full)
///
/// 跟 HTML design_v2026-06_variant_C_3D.html line 626-666 timeline 一致。
///
/// Output: Logs/ceremony-sweep-flipbook/frame-{00..23}.png
/// 反 self-licking: 24 帧 md5 必须全唯一 (sweepAngle 每帧不同 → 视觉不同)。
/// 反向 mutation: 把 shader sweepGate 改成 1.0 (强制 always full),flipbook
///   md5 应大量重复 = sweep 没生效 = self-licking 暴露。
/// </summary>
public static class CeremonySweepFlipbookTest
{
    const string OUT_DIR = "Logs/ceremony-sweep-flipbook";
    const int W = 1280, H = 720;
    const int FRAME_COUNT = 24;
    const float CEREMONY_DURATION = 1.0f;
    const float RING_SWEEP_END_T = 0.50f;
    const float RUNE_START_T = 0.50f;
    const float RUNE_END_T = 0.85f;

    [MenuItem("Cairn/Ceremony Sweep Flipbook")]
    public static void RunFromMenu() { RunHeadless(); }

    public static void RunHeadless()
    {
        Debug.Log("[Ceremony] === START ===");
        try
        {
            Directory.CreateDirectory(OUT_DIR);

            var scene = UnityEditor.SceneManagement.EditorSceneManager.NewScene(
                UnityEditor.SceneManagement.NewSceneSetup.EmptyScene,
                UnityEditor.SceneManagement.NewSceneMode.Single);

            // Sun
            var sunGo = new GameObject("Sun");
            var sun = sunGo.AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.intensity = 1.5f;
            sunGo.transform.rotation = Quaternion.Euler(50f, -30f, 0f);

            // Ground (gray ref)
            var ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
            ground.name = "GroundReference";
            ground.transform.localScale = Vector3.one * 0.5f;
            var groundMat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            groundMat.color = new Color(0.18f, 0.20f, 0.24f);
            ground.GetComponent<Renderer>().material = groundMat;

            // Portal ring quad — 2x2m flat XZ plane on ground
            var ringGo = GameObject.CreatePrimitive(PrimitiveType.Quad);
            ringGo.name = "PortalRing";
            // Quad default normal = -Z; rotate 90° on X so it lies flat (normal +Y)
            ringGo.transform.rotation = Quaternion.Euler(90, 0, 0);
            ringGo.transform.position = new Vector3(0, 0.001f, 0);  // slightly above ground
            ringGo.transform.localScale = new Vector3(2f, 2f, 1f);
            UnityEngine.Object.DestroyImmediate(ringGo.GetComponent<Collider>());
            var ringShader = Shader.Find("Cairn/PortalRingShader");
            if (ringShader == null)
            {
                Debug.LogError("[Ceremony] Cairn/PortalRingShader not found");
                if (Application.isBatchMode) EditorApplication.Exit(1);
                return;
            }
            var ringMat = new Material(ringShader);
            ringGo.GetComponent<Renderer>().material = ringMat;

            // Camera looks down at ring from above-front
            var camGo = new GameObject("MainCamera");
            camGo.tag = "MainCamera";
            var cam = camGo.AddComponent<Camera>();
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0.05f, 0.05f, 0.10f);
            cam.fieldOfView = 50f;
            cam.transform.position = new Vector3(0f, 1.4f, -1.2f);
            cam.transform.LookAt(Vector3.zero);

            // Warmup URP
            var warmupRT = new RenderTexture(W, H, 24);
            cam.targetTexture = warmupRT;
            cam.Render();
            cam.targetTexture = null;
            UnityEngine.Object.DestroyImmediate(warmupRT);

            // ─── 24 frames timeline ───
            // 跟 HTML design_v2026-06_variant_C_3D.html line 626-666 一致
            var ringRenderer = ringGo.GetComponent<Renderer>();
            var mpb = new MaterialPropertyBlock();
            for (int frame = 0; frame < FRAME_COUNT; frame++)
            {
                float t = (float)frame / (FRAME_COUNT - 1);  // 0..1 over 24 frames

                // Phase 1 (0..0.50): ring sweep, no rune yet
                // Phase 2 (0.50..0.85): full ring + rune fade in
                // Phase 3 (0.85..1.0): all visible
                float sweepT = Mathf.Clamp01(t / RING_SWEEP_END_T);   // 0..1 maps to 0..0.50
                float runeT;
                if (t < RUNE_START_T) runeT = 0f;
                else if (t > RUNE_END_T) runeT = 1f;
                else runeT = (t - RUNE_START_T) / (RUNE_END_T - RUNE_START_T);

                float sweepAngle = sweepT * 2f * Mathf.PI;  // 0..2π
                float reveal = runeT;

                ringRenderer.GetPropertyBlock(mpb);
                mpb.SetFloat("_SweepAngle", sweepAngle);
                mpb.SetFloat("_Reveal", reveal);
                mpb.SetFloat("_TypeIndex", 0);  // cairn for first test
                ringRenderer.SetPropertyBlock(mpb);

                CaptureToPng(cam, Path.Combine(OUT_DIR, $"frame-{frame:D2}.png"));
            }

            string summary =
                "Ceremony Sweep Flipbook (Story C real test)\n" +
                "============================================\n" +
                $"Frames: {FRAME_COUNT} (1.0s @ 24fps)\n" +
                "HTML basis: design_v2026-06_variant_C_3D.html line 626-666\n" +
                "Phase 1 (frame 0..11, t<0.50): ring clockwise sweep, rune=0\n" +
                "Phase 2 (frame 12..20, t=0.50..0.85): full ring + rune fade in\n" +
                "Phase 3 (frame 21..23, t>0.85): all reveal\n" +
                "\n" +
                "PASS criteria:\n" +
                "  - 24 frames PNG md5 全唯一 (sweep 真注入)\n" +
                "  - frame-00 几乎全黑 (sweepAngle=0,ring 不可见)\n" +
                "  - frame-11 半圈 (sweepAngle=π)\n" +
                "  - frame-12+ 完整 ring,icon 开始浮现\n" +
                "  - frame-23 ring + icon 都满\n";
            File.WriteAllText(Path.Combine(OUT_DIR, "summary.txt"), summary);

            Debug.Log("[Ceremony] === DONE ===");
            if (Application.isBatchMode) EditorApplication.Exit(0);
        }
        catch (System.Exception e)
        {
            Debug.LogError($"[Ceremony] FAILED: {e}");
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
        UnityEngine.Object.DestroyImmediate(rt);
        byte[] png = tex.EncodeToPNG();
        UnityEngine.Object.DestroyImmediate(tex);
        File.WriteAllBytes(path, png);
    }
}
#endif
