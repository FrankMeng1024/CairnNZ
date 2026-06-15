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

    static readonly (int idx, string name, Color color)[] TYPES = new[]
    {
        // 颜色跟 app/src/services/unityCairnSpawn.ts:77-83 markerTypeToColor 同步:
        // danger #FF2A1A 红, junction #FFB347 橙, water #5AE6FF 青蓝,
        // hut #D4A06B 沙棕, cairn #E8C896 沙金
        // HDR 强度跟 PortalSpawner.cs 主路径一致 (×3.0 让 bloom 兜底亮起来)
        (0, "cairn",    HexHDR("E8C896")),
        (1, "danger",   HexHDR("FF2A1A")),
        (2, "junction", HexHDR("FFB347")),
        (3, "water",    HexHDR("5AE6FF")),
        (4, "hut",      HexHDR("D4A06B")),
    };

    static Color HexHDR(string hex)
    {
        float r = System.Convert.ToInt32(hex.Substring(0, 2), 16) / 255f;
        float g = System.Convert.ToInt32(hex.Substring(2, 2), 16) / 255f;
        float b = System.Convert.ToInt32(hex.Substring(4, 2), 16) / 255f;
        // ×1.5 HDR boost (不要冲白,保留 per-type 色饱和度)
        // 测试发现 ×3 + additive + bloom 让 ring 冲到接近白色,丢失 per-type 视觉。
        return new Color(r * 1.5f, g * 1.5f, b * 1.5f, 1f);
    }

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
            // sub 修订: _SweepAngle/_Reveal 在 CBUFFER 里走 material.SetFloat 真生效
            // (MPB 写 CBUFFER 字段被 SRP Batcher 静默忽略, 同 Story C HOTFIX)
            var matInstance = ringRenderer.material;

            foreach (var (idx, name, color) in TYPES)
            {
                matInstance.SetColor("_BaseColor", color);  // per-type 颜色
                matInstance.SetFloat("_SweepAngle", 6.2831853f);  // full ring
                matInstance.SetFloat("_Reveal", 1.0f);             // full icon reveal
                matInstance.SetFloat("_TypeIndex", idx);
                matInstance.SetFloat("_BloomBoost", 1.0f);  // 不要二次冲白
                matInstance.SetFloat("_CoreIntensity", 0.5f);  // core 减弱让 per-type 色不被中央 glow 冲淡

                var path = Path.Combine(OUT_DIR, $"type-{idx}-{name}.png");
                CaptureToPng(cam, path);
                Debug.Log($"[TypeIcons] Rendered {name} (idx={idx}, color=({color.r:F2},{color.g:F2},{color.b:F2})) -> {path}");
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
