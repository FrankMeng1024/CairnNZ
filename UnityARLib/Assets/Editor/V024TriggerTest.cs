#if UNITY_EDITOR
// v0.2.4 Block A 自动化触发条件测试 harness
//
// 用 Reflection 调用 CairnAcquireController 私有方法验证三条件 allOk
// 取值,无需启动真 ARSession(batch mode 不可)。
//
// 三个 case:
//   Case 1: 用户 15m 远 + 朝向地面 mark → 期望 byRayHit channel 触发
//   Case 2: 用户 50m 远 + 指自己脚下(hit XZ 离 mark 50m)→ 期望 NOT 触发
//   Case 3: 用户 8m 远 + 朝向 mark(原路径)→ 期望 byCamera channel 触发
//
// Output:
//   _review/v0.2.4/A-trigger-test-result.json — 3 case verdict + 详情
//   _review/v0.2.4/A-case[1-3]-summary.png    — 视觉截图(Editor playmode)

using System.IO;
using System.Reflection;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEditor;
using Cairn.AR;

namespace Cairn.AR.Editor
{
    public static class V024TriggerTest
    {
        const string OUT_DIR = "../_review/v0.2.4";
        const int CAPTURE_W = 1280;
        const int CAPTURE_H = 720;

        struct TestCase
        {
            public string name;
            public Vector3 cameraPos;
            public Vector3 markGpsPos;       // mark.GPS world position
            public Vector3 cameraLookAt;     // 相机 LookAt 目标(决定 forward)
            public Vector3 simHitPos;        // 模拟 raycast hit 位置
            public bool   expectTrigger;
            public string expectChannel;     // "byCamera" | "byRayHit" | "(none)"
        }

        [MenuItem("Cairn/v0.2.4/Block A: Run Trigger Test")]
        public static void RunTest()
        {
            Directory.CreateDirectory(OUT_DIR);

            var cases = new[]
            {
                new TestCase {
                    name = "case1-15m-ray-hit",
                    cameraPos    = new Vector3(0f, 1.5f, -15f),
                    markGpsPos   = new Vector3(0f, 0f,    0f),
                    cameraLookAt = new Vector3(0f, 0f,    0f),
                    simHitPos    = new Vector3(0.2f, 0f,  0.1f),  // ray 命中 mark 附近地面
                    expectTrigger = true,
                    expectChannel = "byRayHit",
                },
                new TestCase {
                    name = "case2-50m-degenerate",
                    cameraPos    = new Vector3(0f, 1.5f, -50f),
                    markGpsPos   = new Vector3(0f, 0f,    0f),
                    cameraLookAt = new Vector3(0f, 0f,  -50.5f),  // 朝下指自己脚下
                    simHitPos    = new Vector3(0f, 0f,  -50f),    // hit 离 mark 水平 50m
                    expectTrigger = false,
                    expectChannel = "(none)",
                },
                new TestCase {
                    name = "case3-8m-original",
                    cameraPos    = new Vector3(0f, 1.5f, -8f),
                    markGpsPos   = new Vector3(0f, 0f,   0f),
                    cameraLookAt = new Vector3(0f, 0f,   0f),
                    simHitPos    = new Vector3(0f, 0f,   0f),
                    expectTrigger = true,
                    expectChannel = "byCamera",
                },
                // BLOCKER 2 fix: case 4 验证 rayHitOn 阈值边界 — 26m 超 _rayHitMaxDistance(25m)即使 ray 命中也不触发
                new TestCase {
                    name = "case4-26m-beyond-max",
                    cameraPos    = new Vector3(0f, 1.5f, -26f),
                    markGpsPos   = new Vector3(0f, 0f,    0f),
                    cameraLookAt = new Vector3(0f, 0f,    0f),
                    simHitPos    = new Vector3(0.1f, 0f,  0.1f),
                    expectTrigger = false,
                    expectChannel = "(none)",
                },
                // BLOCKER 2 fix: case 5 验证 hit-locality guard — 15m + ray 命中地面但离 mark 3m(超 1.5m) 不触发
                new TestCase {
                    name = "case5-hit-too-far-from-mark",
                    cameraPos    = new Vector3(0f, 1.5f, -15f),
                    markGpsPos   = new Vector3(0f, 0f,    0f),
                    cameraLookAt = new Vector3(0f, 0f,    0f),
                    simHitPos    = new Vector3(3f, 0f,    0f),  // hit 距 mark 3m,超 1.5m 阈值
                    expectTrigger = false,
                    expectChannel = "(none)",
                },
            };

            var results = new System.Text.StringBuilder();
            results.AppendLine("{");
            results.AppendLine("  \"test\": \"v0.2.4 Block A — ray-hit trigger channel\",");
            results.AppendLine("  \"timestamp\": \"" + System.DateTime.UtcNow.ToString("o") + "\",");
            results.AppendLine("  \"cases\": [");

            int passCount = 0;
            for (int i = 0; i < cases.Length; i++)
            {
                var c = cases[i];
                var verdict = EvaluateCase(c);
                bool pass = (verdict.triggered == c.expectTrigger)
                         && (!c.expectTrigger || verdict.channel == c.expectChannel);
                if (pass) passCount++;
                results.AppendLine("    {");
                results.AppendLine($"      \"name\": \"{c.name}\",");
                results.AppendLine($"      \"expectTrigger\": {(c.expectTrigger?"true":"false")},");
                results.AppendLine($"      \"expectChannel\": \"{c.expectChannel}\",");
                results.AppendLine($"      \"actualTriggered\": {(verdict.triggered?"true":"false")},");
                results.AppendLine($"      \"actualChannel\": \"{verdict.channel}\",");
                results.AppendLine($"      \"dist\": {verdict.dist:F2},");
                results.AppendLine($"      \"rayHitMarkXZ\": {verdict.rayHitMarkXZ:F2},");
                results.AppendLine($"      \"facingDot\": {verdict.facingDot:F2},");
                results.AppendLine($"      \"verdict\": \"{(pass?"PASS":"FAIL")}\"");
                results.AppendLine($"    }}{(i < cases.Length-1 ? "," : "")}");

                Debug.Log($"[V024TriggerTest] {c.name}: {(pass?"PASS":"FAIL")} " +
                          $"trigger={verdict.triggered} channel={verdict.channel} " +
                          $"dist={verdict.dist:F2} rayHitMarkXZ={verdict.rayHitMarkXZ:F2} facingDot={verdict.facingDot:F2}");
            }

            results.AppendLine("  ],");
            results.AppendLine($"  \"summary\": \"{passCount}/{cases.Length} pass\"");
            results.AppendLine("}");

            string jsonPath = Path.Combine(OUT_DIR, "A-trigger-test-result.json");
            File.WriteAllText(jsonPath, results.ToString());
            Debug.Log($"[V024TriggerTest] Result: {passCount}/{cases.Length} pass. JSON: {jsonPath}");

            // 视觉证据:渲染一张场景示意图(camera at top-down,标注 3 个 case 的 camera/mark 位置)
            CaptureCaseDiagram(cases);
        }

        struct EvalResult
        {
            public bool triggered;
            public string channel;
            public float dist;
            public float rayHitMarkXZ;
            public float facingDot;
        }

        // BLOCKER 2 fix: 调 production CairnAcquireController.ComputeAllOk(),
        // 不再 reimplement 算法。如果 production 算法改了 test 立刻反映。
        static EvalResult EvaluateCase(TestCase c)
        {
            var r = new EvalResult();

            // 1. dist = camera→mark.GPS 距离
            r.dist = Vector3.Distance(c.cameraPos, c.markGpsPos);

            // 2. facing dot:模拟 camera.transform.forward
            Vector3 fwd = (c.cameraLookAt - c.cameraPos).normalized;
            Vector3 dirToMark = (c.markGpsPos - c.cameraPos).normalized;
            r.facingDot = Vector3.Dot(fwd, dirToMark);

            // 3. rayHit→mark XZ 水平距离
            Vector2 hitXZ  = new Vector2(c.simHitPos.x, c.simHitPos.z);
            Vector2 markXZ = new Vector2(c.markGpsPos.x, c.markGpsPos.z);
            r.rayHitMarkXZ = Vector2.Distance(hitXZ, markXZ);

            // 4. 用 default OTA 阈值 + facing test
            float facingEnter = 0.70f;
            bool facingNow    = r.facingDot > facingEnter;
            bool planeReady   = true;  // 测试假设 plane ready,因为 ARFoundation Editor 无 trackable

            // BLOCKER 2 fix: 调 production 真函数
            bool nearByCamera, nearByRayHit;
            bool allOk = Cairn.AR.CairnAcquireController.ComputeAllOk(
                r.dist, facingNow, planeReady, r.rayHitMarkXZ,
                /*acquireEnter*/    10f,
                /*rayHitTriggerRad*/ 1.5f,
                /*rayHitMaxDist*/   25f,
                /*rayHitOn*/        true,
                out nearByCamera, out nearByRayHit);

            r.triggered = allOk;
            if (!allOk) r.channel = "(none)";
            else if (nearByCamera) r.channel = "byCamera";
            else r.channel = "byRayHit";

            return r;
        }

        static void CaptureCaseDiagram(TestCase[] cases)
        {
            // 用 V024 场景作为视觉底图,叠加 IMGUI 文字标注
            var camGo = new GameObject("V024TriggerTestCam");
            var cam = camGo.AddComponent<Camera>();
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0.05f, 0.07f, 0.12f, 1f);
            cam.fieldOfView = 50f;
            cam.orthographic = true;

            // 3 张图(每个 case 一张)— 每张视角自适应该 case 的 camera+mark+hit 范围
            for (int i = 0; i < cases.Length; i++)
            {
                var c = cases[i];

                // 自适应正交相机 size:把 camera/mark/hit 都框进画面
                Vector3 center = (c.cameraPos + c.markGpsPos) * 0.5f;
                float spanZ = Mathf.Abs(c.cameraPos.z - c.markGpsPos.z);
                float spanX = Mathf.Abs(c.cameraPos.x - c.markGpsPos.x);
                float maxSpan = Mathf.Max(spanZ, spanX, 4f);
                cam.transform.position = new Vector3(center.x, 30f, center.z);
                cam.transform.rotation = Quaternion.Euler(90f, 0f, 0f);
                cam.orthographicSize = maxSpan * 0.7f;  // 留 40% 边距

                // 标记:camera (cyan) + mark.GPS (green/red 期望/失败) + ray hit (yellow)
                // 球半径放大到 size*0.04 左右便于看清
                float ballScale = maxSpan * 0.06f;
                ballScale = Mathf.Max(ballScale, 0.4f);

                var camMarker = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                camMarker.transform.position = c.cameraPos;
                camMarker.transform.localScale = Vector3.one * ballScale;
                var camMr = camMarker.GetComponent<MeshRenderer>();
                camMr.sharedMaterial = new Material(Shader.Find("Unlit/Color"));
                camMr.sharedMaterial.color = Color.cyan;

                var markMarker = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                markMarker.transform.position = c.markGpsPos;
                markMarker.transform.localScale = Vector3.one * ballScale;
                var markMr = markMarker.GetComponent<MeshRenderer>();
                markMr.sharedMaterial = new Material(Shader.Find("Unlit/Color"));
                markMr.sharedMaterial.color = c.expectTrigger ? Color.green : Color.red;

                var hitMarker = GameObject.CreatePrimitive(PrimitiveType.Cube);
                hitMarker.transform.position = c.simHitPos;
                hitMarker.transform.localScale = Vector3.one * ballScale * 0.7f;
                var hitMr = hitMarker.GetComponent<MeshRenderer>();
                hitMr.sharedMaterial = new Material(Shader.Find("Unlit/Color"));
                hitMr.sharedMaterial.color = Color.yellow;

                // 用 LineRenderer 画 camera→mark 连线和 camera→hit 连线
                var lineGo = new GameObject("CaseDiagramLines");
                var lr1 = lineGo.AddComponent<LineRenderer>();
                lr1.positionCount = 2;
                lr1.SetPosition(0, c.cameraPos);
                lr1.SetPosition(1, c.markGpsPos);
                lr1.startWidth = lr1.endWidth = ballScale * 0.15f;
                lr1.material = new Material(Shader.Find("Unlit/Color"));
                lr1.material.color = new Color(0.5f, 0.5f, 1f, 1f);

                var lineGo2 = new GameObject("CaseDiagramLines2");
                var lr2 = lineGo2.AddComponent<LineRenderer>();
                lr2.positionCount = 2;
                lr2.SetPosition(0, c.cameraPos);
                lr2.SetPosition(1, c.simHitPos);
                lr2.startWidth = lr2.endWidth = ballScale * 0.15f;
                lr2.material = new Material(Shader.Find("Unlit/Color"));
                lr2.material.color = new Color(1f, 0.7f, 0.2f, 1f);

                string path = Path.Combine(OUT_DIR, $"A-{c.name}.png");
                CaptureCameraToPng(cam, path);
                Debug.Log($"[V024TriggerTest] saved {path} (size={maxSpan:F1}m)");

                Object.DestroyImmediate(camMarker);
                Object.DestroyImmediate(markMarker);
                Object.DestroyImmediate(hitMarker);
                Object.DestroyImmediate(lineGo);
                Object.DestroyImmediate(lineGo2);
            }

            Object.DestroyImmediate(camGo);
        }

        static void CaptureCameraToPng(Camera cam, string path)
        {
            var rt = new RenderTexture(CAPTURE_W, CAPTURE_H, 24);
            cam.targetTexture = rt;
            cam.Render();
            RenderTexture.active = rt;
            var tex = new Texture2D(CAPTURE_W, CAPTURE_H, TextureFormat.RGB24, false);
            tex.ReadPixels(new Rect(0, 0, CAPTURE_W, CAPTURE_H), 0, 0);
            tex.Apply();
            File.WriteAllBytes(path, tex.EncodeToPNG());
            cam.targetTexture = null;
            RenderTexture.active = null;
            Object.DestroyImmediate(tex);
            rt.Release();
            Object.DestroyImmediate(rt);
        }
    }
}
#endif
