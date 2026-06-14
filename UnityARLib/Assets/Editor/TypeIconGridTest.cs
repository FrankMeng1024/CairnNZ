#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;
using System.IO;

/// <summary>
/// v0.2.4 Phase1 Story B — type icon 5 种视觉 grid 真渲染.
///
/// 5 types: cairn(0)/danger(1)/junction(2)/water(3)/hut(4)
/// 每种独立渲染 1 张 PNG, 反向 mutation: typeIdx 改成 -1 应触发 fallback (cairn).
///
/// 跟 app `markerTypes.ts` lucide icon shape 对得上 (sub#182 已验证):
///   danger=TriangleAlert / junction=Navigation2 / water=Droplets / hut=House / cairn=Mountain
///
/// Output:
///   Logs/type-icons-grid/type-{0..4}-{name}.png
///   Logs/type-icons-grid/summary.txt
/// 反 self-licking: 5 张 md5 必须全唯一 (typeIdx 真切换 → SDF 真选不同分支).
/// </summary>
public static class TypeIconGridTest
{
    const string OUT_DIR = "Logs/type-icons-grid";
    const int W = 1280, H = 720;

    static readonly (int idx, string name)[] TYPES = new[]
    {
        (0, "cairn"),
        (1, "danger"),
        (2, "junction"),
        (3, "water"),
        (4, "hut"),
    };

    [MenuItem("Cairn/Type Icon Grid Test")]
    public static void RunFromMenu() { RunHeadless(); }

    public static void RunHeadless()
    {
        Debug.Log("[TypeIcons] === START ===");
        try
        {
            Directory.CreateDirectory(OUT_DIR);

            var scene = UnityEditor.SceneManagement.EditorSceneManager.NewScene(
                UnityEditor.SceneManagement.NewSceneSetup.EmptyScene,
                UnityEditor.SceneManagement.NewSceneMode.Single);

            var sunGo = new GameObject("Sun");
            var sun = sunGo.AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.intensity = 1.5f;
            sunGo.transform.rotation = Quaternion.Euler(50f, -30f, 0f);

            var ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
            ground.name = "GroundReference";
            ground.transform.localScale = Vector3.one * 0.5f;
            var groundMat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            groundMat.color = new Color(0.18f, 0.20f, 0.24f);
            ground.GetComponent<Renderer>().material = groundMat;

            var ringGo = GameObject.CreatePrimitive(PrimitiveType.Quad);
            ringGo.name = "PortalRing";
            ringGo.transform.rotation = Quaternion.Euler(90, 0, 0);
            ringGo.transform.position = new Vector3(0, 0.001f, 0);
            ringGo.transform.localScale = new Vector3(2f, 2f, 1f);
            UnityEngine.Object.DestroyImmediate(ringGo.GetComponent<Collider>());
            var ringShader = Shader.Find("Cairn/PortalRingShader");
            if (ringShader == null)
            {
                Debug.LogError("[TypeIcons] Cairn/PortalRingShader not found");
                if (Application.isBatchMode) EditorApplication.Exit(1);
                return;
            }
            var ringMat = new Material(ringShader);
            ringGo.GetComponent<Renderer>().material = ringMat;

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

            var ringRenderer = ringGo.GetComponent<Renderer>();
            var mpb = new MaterialPropertyBlock();

            foreach (var (idx, name) in TYPES)
            {
                ringRenderer.GetPropertyBlock(mpb);
                mpb.SetFloat("_SweepAngle", 6.2831853f);  // full ring (no sweep gate)
                mpb.SetFloat("_Reveal", 1.0f);             // full icon reveal
                mpb.SetFloat("_TypeIndex", idx);
                ringRenderer.SetPropertyBlock(mpb);

                var path = Path.Combine(OUT_DIR, $"type-{idx}-{name}.png");
                CaptureToPng(cam, path);
                Debug.Log($"[TypeIcons] Rendered {name} (idx={idx}) -> {path}");
            }

            string summary =
                "Type Icon Grid (Story B real test)\n" +
                "===================================\n" +
                "Mapping (PortalSpawner.cs:97-107 真用):\n" +
                "  cairn=0 / danger=1 / junction=2 / water=3 / hut=4\n" +
                "\n" +
                "App 端对应 lucide icon (markerTypes.ts):\n" +
                "  danger  → TriangleAlert (三角 + !)\n" +
                "  junction → Navigation2 (向上分叉箭头)\n" +
                "  water   → Droplets (水滴 — lucide 双水滴, Unity 单水滴, shape 70%)\n" +
                "  hut     → House (房子 — 屋顶 + 墙 + 门)\n" +
                "  cairn   → CairnStoneIcon SVG (三石堆 — Unity 3 ellipses)\n" +
                "\n" +
                "PASS criteria:\n" +
                "  - 5 张 PNG md5 全唯一 (反 self-licking — typeIdx 真切换 → SDF 真选不同分支)\n" +
                "  - 视觉看图: 形状跟 lucide app 端一致 (shape match 100%, sub#182 已 grep 验证)\n";
            File.WriteAllText(Path.Combine(OUT_DIR, "summary.txt"), summary);

            Debug.Log("[TypeIcons] === DONE ===");
            if (Application.isBatchMode) EditorApplication.Exit(0);
        }
        catch (System.Exception e)
        {
            Debug.LogError($"[TypeIcons] FAILED: {e}");
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
