#if UNITY_EDITOR
// v0.2.4 Branch C — Programmatic Scene Setup + Capture for new visual stack.
//
// Two entry points:
//   1. SetupScene — builds Assets/Scenes/V024Playground.unity, saves to disk.
//      User opens Editor → File → Open Scene → V024Playground → presses Play
//      to see ribbons / rune / particles live.
//   2. RunCapture — opens that scene + captures 5 type variants + ceremony flipbook.
//
// Output: Logs/v024-capture/

using System.Collections.Generic;
using System.IO;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEditor;
using UnityEditor.SceneManagement;

namespace Cairn.AR.Editor
{
    public static class V024CapturePlayground
    {
        struct TypeDef { public string id; public Color color; }
        static readonly TypeDef[] TYPES = new[]
        {
            new TypeDef { id = "cairn",    color = new Color(0.91f, 0.78f, 0.59f, 1f) },
            new TypeDef { id = "danger",   color = new Color(1.00f, 0.16f, 0.10f, 1f) },
            new TypeDef { id = "water",    color = new Color(0.35f, 0.90f, 1.00f, 1f) },
            new TypeDef { id = "junction", color = new Color(0.77f, 0.91f, 0.28f, 1f) },
            new TypeDef { id = "hut",      color = new Color(0.83f, 0.63f, 0.42f, 1f) },
        };

        const string OUT_DIR = "Logs/v024-capture";
        const string SCENE_PATH = "Assets/Scenes/V024Playground.unity";
        const int CAPTURE_W = 1280;
        const int CAPTURE_H = 720;

        // Per-type GameObject names (so we can cycle through them in capture)
        const string CLUSTER_PARENT = "V024Clusters";

        // ============================================================
        // SetupScene — builds + saves the scene for Editor inspection
        // ============================================================
        [MenuItem("Cairn/v024/Setup Scene (open after to see live)")]
        public static void SetupScene()
        {
            // Open / create scene
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            // Camera at fixed pos
            var camGo = new GameObject("V024Camera");
            var cam = camGo.AddComponent<Camera>();
            cam.clearFlags = CameraClearFlags.SolidColor;
            // Three.js demo bg = #E8DCC4 NZ 晨曦白麻布(line 90)
            // 但我们 capture 时仍用深蓝便于 ribbon additive 看清;ring 因为是
            // NormalBlending dark amber,深蓝底也能看清。
            // 增加白底 capture 可在 RunCapture 里二次跑。
            cam.backgroundColor = new Color(0.02f, 0.03f, 0.10f, 1f);
            cam.fieldOfView = 60f;
            cam.transform.position = new Vector3(0f, 1.4f, -2.8f);
            cam.transform.LookAt(new Vector3(0f, 0.85f, 0f));
            camGo.tag = "MainCamera";

            // Set day/night global once at scene load via a manager component
            var mgrGo = new GameObject("V024GlobalsManager");
            mgrGo.AddComponent<V024GlobalsApplier>();

            // Reimport shaders fresh
            AssetDatabase.ImportAsset("Assets/Shaders/RibbonSilkV2.shader",  ImportAssetOptions.ForceUpdate);
            AssetDatabase.ImportAsset("Assets/Shaders/RuneSDFShader.shader", ImportAssetOptions.ForceUpdate);
            AssetDatabase.Refresh();

            var ribbonShader = Shader.Find("Cairn/RibbonSilkV2");
            var runeShader   = Shader.Find("Cairn/RuneSDF");
            var flowTex = AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/Textures/strand_flow.png");
            if (flowTex == null) flowTex = AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/Textures/cairn_rune_noise.png");

            // Parent for all 5 type clusters
            var parent = new GameObject(CLUSTER_PARENT);

            // Lay out 5 clusters in a row (3m apart) so user can see all in scene view
            for (int i = 0; i < TYPES.Length; i++)
            {
                var t = TYPES[i];
                var clusterRoot = new GameObject($"Cluster_{t.id}");
                clusterRoot.transform.SetParent(parent.transform, false);
                clusterRoot.transform.localPosition = new Vector3((i - 2) * 3f, 0f, 0f);
                BuildCluster(clusterRoot, t, ribbonShader, runeShader, flowTex);
            }

            Directory.CreateDirectory("Assets/Scenes");
            EditorSceneManager.SaveScene(scene, SCENE_PATH);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();

            Debug.Log($"[v024-CAP] Scene saved to {SCENE_PATH}. Open in Editor + press Play to see live.");
            if (Application.isBatchMode) EditorApplication.Exit(0);
        }

        // ============================================================
        // BuildCluster — creates one cairn cluster (used by both setup + capture)
        // ============================================================
        static void BuildCluster(GameObject root, TypeDef t, Shader ribbonShader, Shader runeShader, Texture2D flowTex)
        {
            // --- Materials (saved as instances per-cluster, persistent in scene) ---
            var ribMat = new Material(ribbonShader) { name = "RibbonV2_" + t.id };
            ribMat.SetTexture("_FlowTex",     flowTex);
            ribMat.SetColor("_BaseTint",      t.color);
            ribMat.SetColor("_TipTint",       new Color(0.95f, 0.97f, 1.0f, 1f));
            ribMat.SetFloat("_NightMul",      1.6f);
            ribMat.SetFloat("_DayMul",        0.55f);
            ribMat.SetFloat("_FlowStrength",  0.55f);
            ribMat.SetFloat("_BandFreq",      4.0f);
            ribMat.SetFloat("_BandIntensity", 0.4f);

            int typeId = TypeIdToInt(t.id);
            var runeMat = new Material(runeShader) { name = "RuneSDF_" + t.id };
            runeMat.SetFloat("_TypeId",    typeId);
            runeMat.SetColor("_TypeColor", t.color);
            runeMat.SetFloat("_Reveal",    1.0f);

            // --- Tier-1 圆环 (主环 + 内环,1:1 移植 Three.js demo line 142-166) ---
            float RING_RADIUS = 0.55f;
            Color darkAmber = LerpToDarkAmber(t.color);

            var ringShader = Shader.Find("Cairn/RingFlat");
            if (ringShader != null)
            {
                // 主环 — RingGeometry(R - 0.013, R, 96) at y=0.001
                var outerRing = new GameObject("OuterRing");
                outerRing.transform.SetParent(root.transform, false);
                outerRing.transform.localPosition = new Vector3(0f, 0.001f, 0f);
                var outerMf = outerRing.AddComponent<MeshFilter>();
                outerMf.sharedMesh = Cairn.AR.RingMeshBuilder.Build(RING_RADIUS, RING_RADIUS - 0.013f, 96);
                var outerMr = outerRing.AddComponent<MeshRenderer>();
                outerMr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                outerMr.receiveShadows = false;
                var outerRingMat = new Material(ringShader) { name = "OuterRing_" + t.id };
                outerRingMat.SetColor("_RingColor",   darkAmber);
                outerRingMat.SetFloat("_RingOpacity", 0.85f);
                outerRingMat.SetFloat("_SweepProgress", 1.0f);  // static = full
                outerMr.sharedMaterial = outerRingMat;

                // 内环 — RingGeometry(R*0.65, R*0.665, 64) at y=0.0008
                var innerRing = new GameObject("InnerRing");
                innerRing.transform.SetParent(root.transform, false);
                innerRing.transform.localPosition = new Vector3(0f, 0.0008f, 0f);
                var innerMf = innerRing.AddComponent<MeshFilter>();
                innerMf.sharedMesh = Cairn.AR.RingMeshBuilder.Build(RING_RADIUS * 0.665f, RING_RADIUS * 0.65f, 64);
                var innerMr = innerRing.AddComponent<MeshRenderer>();
                innerMr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                innerMr.receiveShadows = false;
                var innerRingMat = new Material(ringShader) { name = "InnerRing_" + t.id };
                innerRingMat.SetColor("_RingColor",   darkAmber);
                innerRingMat.SetFloat("_RingOpacity", 0.70f);
                innerRingMat.SetFloat("_SweepProgress", 1.0f);
                innerMr.sharedMaterial = innerRingMat;
            }

            // --- 5 ribbons in a ring ---
            int RIBBON_COUNT = 5;
            // RING_RADIUS already declared above (in Tier-1 ring block)
            for (int i = 0; i < RIBBON_COUNT; i++)
            {
                // V2.2 G12 fix: 删 + Random.value * 0.3f 扰动
                // V2.1 sub#2 抓出:扰动让 5 根可能重合(±0.15 rad ≈ 8.6°),圆周 72° 间距下高概率 2 根挤近
                // → 视觉看 4 根 (而非 5 根)
                float angle = (i / (float)RIBBON_COUNT) * Mathf.PI * 2f;
                var rgo = new GameObject($"Ribbon_{i}");
                rgo.transform.SetParent(root.transform, false);
                rgo.transform.localPosition = Vector3.zero;
                var rib = rgo.AddComponent<Cairn.AR.SilkRibbonV2>();
                rgo.GetComponent<MeshRenderer>().sharedMaterial = ribMat;
                // V2.2 G11 fix: phaseOffset 改均匀分配 0/0.2/0.4/0.6/0.8(原 Random.value 让错峰失效)
                // V2.1 sub#2 抓出:5 根 phaseOffset 是 Random.value 完全独立随机 → 高概率 2-3 根同步
                float phaseOffset = i / (float)RIBBON_COUNT;
                // V2.2 P1c fix: maxWidth 每根用 phaseOffset 衍生(确定性,但 5 根 0.10/0.115/0.13/0.115/0.10 略变化)
                // V2.3-B 加宽: base 0.10 → 0.15(+50%),让丝带更厚重像绸缎不像细金线
                float widthBase = 0.15f;
                float widthVar  = 0.05f * Mathf.Sin(phaseOffset * Mathf.PI);  // 0/0.029/0.048/0.029/0
                float maxWidth  = widthBase + Mathf.Abs(widthVar);
                rib.Configure(RING_RADIUS, angle, phaseOffset, t.color, new Color(0.95f, 0.97f, 1.0f, 1f), maxWidth);
            }

            // --- Rune SDF quad lying flat on ground ---
            var runeGo = GameObject.CreatePrimitive(PrimitiveType.Quad);
            runeGo.name = "Rune";
            UnityEngine.Object.DestroyImmediate(runeGo.GetComponent<Collider>());
            runeGo.transform.SetParent(root.transform, false);
            runeGo.transform.localPosition = new Vector3(0f, 0.01f, 0f);
            runeGo.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
            runeGo.transform.localScale = new Vector3(RING_RADIUS * 1.7f, RING_RADIUS * 1.7f, 1f);
            runeGo.GetComponent<MeshRenderer>().sharedMaterial = runeMat;

            // --- Type particles ---
            var partGo = new GameObject("TypeParticles");
            partGo.transform.SetParent(root.transform, false);
            var ctrl = partGo.AddComponent<Cairn.AR.TypeParticleController>();
            ctrl.Configure(t.id, t.color, RING_RADIUS);
            ctrl.SetSpawnEnabled(true);
        }

        // ============================================================
        // RunCapture — uses saved scene to capture stills
        // ============================================================
        [MenuItem("Cairn/v024/Run Capture")]
        public static void RunCapture()
        {
            // Make sure scene exists
            if (!File.Exists(SCENE_PATH))
            {
                SetupScene();
            }
            EditorSceneManager.OpenScene(SCENE_PATH, OpenSceneMode.Single);

            Directory.CreateDirectory(OUT_DIR);

            // Set globals
            Shader.SetGlobalFloat("_CairnGlobalDayNightT", 0.0f);
            Shader.SetGlobalFloat("_CairnGlobalCamDist",   2.5f);
            Shader.SetGlobalFloat("_CairnGlobalAlpha",        1.0f);
            Shader.SetGlobalFloat("_CairnGlobalThermalScale", 1.0f);

            var cam = Camera.main;
            if (cam == null)
            {
                Debug.LogError("[v024-CAP] No main camera!");
                if (Application.isBatchMode) EditorApplication.Exit(1);
                return;
            }

            // Per-type capture: move camera to look at each cluster
            for (int i = 0; i < TYPES.Length; i++)
            {
                var t = TYPES[i];
                Vector3 clusterPos = new Vector3((i - 2) * 3f, 0f, 0f);
                // V2.2 P0b fix: 相机距离 2.8m → 3.2m,匹配 HTML demo 4.5m 紧凑感
                // HTML camera.position (3.2, 2.0, 3.2) lookAt (0, 1.0, 0) 透视让 5 根紧凑
                // Unity 旧版 (0, 1.4, -2.8) lookAt (0, 0.85, 0) 太近,5 根分散像独立柱子
                cam.transform.position = clusterPos + new Vector3(0f, 1.6f, -3.2f);
                cam.transform.LookAt(clusterPos + new Vector3(0f, 1.0f, 0f));

                // V2.2 P0a fix: 隐藏其他 cluster,避免相机视锥内出现穿帮(右下红色 danger 三角)
                // 5 cluster 摆在 (-6/-3/0/3/6) X 轴,相机俯拍当前 cluster 时其他 cluster 仍在视场内
                for (int j = 0; j < TYPES.Length; j++)
                {
                    var otherClusterRoot = GameObject.Find($"Cluster_{TYPES[j].id}");
                    if (otherClusterRoot != null) otherClusterRoot.SetActive(j == i);
                }
                // v0.2.4 manual ticks: drive ribbons + particles since
                // batch mode does not fire MonoBehaviour Update / LateUpdate
                // V2.2 P1 fix: 跑 30 帧而非 60 帧截图
                // 60 帧 (3s) 后 5 根 ribbon 都已重生(_life > _lifeDuration),
                // 部分根处于 lifeT~0 globalFade 极淡 → screenshot 像 4 根
                // 30 帧 (1.5s) 后 5 根 lifeT = 0.3/0.5/0.7/0.9/1.1(根 4 刚重生 lifeT=0.1)
                // 仍有 1 根淡相位,但比 60 帧更接近"5 根都在场"
                var clusterRoot = GameObject.Find($"Cluster_{t.id}");
                if (clusterRoot != null)
                {
                    var ribbons = clusterRoot.GetComponentsInChildren<Cairn.AR.SilkRibbonV2>();
                    var parts   = clusterRoot.GetComponentsInChildren<Cairn.AR.TypeParticleController>();
                    // V2.2 P1c fix: frame 30 → 45,2.25s 让 5 根 lifeDuration 4-6s 都还在 lifeT < 0.6 中段强光
                    for (int frame = 0; frame < 45; frame++)
                    {
                        // Advance shader animation time for flow noise
                        Shader.SetGlobalFloat("_CairnAnimTime", frame * 0.05f + 0.5f);
                        foreach (var rb in ribbons) rb.EditorManualTick(0.05f);
                        foreach (var pc in parts)   pc.EditorManualTick(0.05f);
                    }
                }

                // Render multiple times to flush GPU
                for (int sub = 0; sub < 5; sub++) cam.Render();

                CaptureCameraToPng(cam, $"{OUT_DIR}/type-{t.id}.png");
            }

            // V2.2 P0a fix: capture 完成后 restore 所有 cluster active(给后续 ceremony / anim 用)
            for (int j = 0; j < TYPES.Length; j++)
            {
                var anyClusterRoot = GameObject.Find($"Cluster_{TYPES[j].id}");
                if (anyClusterRoot != null) anyClusterRoot.SetActive(true);
            }

            // Ceremony flipbook (use cairn cluster, animate camera/material params per frame)
            CaptureCeremony(cam);

            // 60-frame cairn animation flipbook: ribbons rising + particles emitting + flow noise
            CaptureAnimationFlipbook(cam);

            Debug.Log("[v024-CAP] === DONE ===");
            if (Application.isBatchMode) EditorApplication.Exit(0);
        }

        /// <summary>
        /// 60 frames @ 30fps → 2 second animation. Each frame:
        ///   * Advance _CairnAnimTime so shader flow noise scrolls
        ///   * Tick all SilkRibbonV2 + TypeParticleController forward
        ///   * Render + save
        /// </summary>
        static void CaptureAnimationFlipbook(Camera cam)
        {
            string animDir = $"{OUT_DIR}/anim";
            Directory.CreateDirectory(animDir);

            var t = TYPES[0];  // cairn
            Vector3 clusterPos = new Vector3((0 - 2) * 3f, 0f, 0f);
            cam.transform.position = clusterPos + new Vector3(0f, 1.4f, -2.8f);
            cam.transform.LookAt(clusterPos + new Vector3(0f, 0.85f, 0f));

            var clusterRoot = GameObject.Find($"Cluster_{t.id}");
            if (clusterRoot == null) return;

            var ribbons = clusterRoot.GetComponentsInChildren<Cairn.AR.SilkRibbonV2>();
            var parts   = clusterRoot.GetComponentsInChildren<Cairn.AR.TypeParticleController>();

            const int FRAMES = 60;
            const float DT = 1f / 30f;  // 30fps

            for (int f = 0; f < FRAMES; f++)
            {
                Shader.SetGlobalFloat("_CairnAnimTime", f * DT + 0.5f);
                foreach (var rb in ribbons) rb.EditorManualTick(DT);
                foreach (var pc in parts)   pc.EditorManualTick(DT);
                for (int sub = 0; sub < 2; sub++) cam.Render();
                CaptureCameraToPng(cam, $"{animDir}/frame-{f:D2}.png");
            }
        }

        static void CaptureCeremony(Camera cam)
        {
            // For ceremony, we'll point camera at cairn cluster (index 0) and
            // procedurally animate ring sweep + rune reveal across 24 frames.
            // Three.js demo timeline (line 629-666):
            //   0.00 - 0.50: ring + inner ring clockwise sweep stencil
            //   0.50 - 0.85: rune fades in + scale 0.7 → 1.0
            //   0.85 - 1.00: ribbons activate
            var t = TYPES[0];  // cairn
            Vector3 clusterPos = new Vector3((0 - 2) * 3f, 0f, 0f);
            cam.transform.position = clusterPos + new Vector3(0f, 1.4f, -2.8f);
            cam.transform.LookAt(clusterPos + new Vector3(0f, 0.85f, 0f));

            // Find materials (rune + outer ring + inner ring)
            var clusterRoot = GameObject.Find($"Cluster_{t.id}");
            Material runeMat = null, outerRingMat = null, innerRingMat = null;
            if (clusterRoot != null)
            {
                var rune = clusterRoot.transform.Find("Rune");
                if (rune != null) runeMat = rune.GetComponent<MeshRenderer>().sharedMaterial;
                var outerRing = clusterRoot.transform.Find("OuterRing");
                if (outerRing != null) outerRingMat = outerRing.GetComponent<MeshRenderer>().sharedMaterial;
                var innerRing = clusterRoot.transform.Find("InnerRing");
                if (innerRing != null) innerRingMat = innerRing.GetComponent<MeshRenderer>().sharedMaterial;
            }

            const int FRAMES = 24;
            for (int f = 0; f < FRAMES; f++)
            {
                float ceremonyT = f / (float)(FRAMES - 1);

                // Ring sweep 0..0.5 of ceremony → 0..1 progress
                float sweepProgress = Mathf.Clamp01(ceremonyT / 0.5f);
                if (outerRingMat != null) outerRingMat.SetFloat("_SweepProgress", sweepProgress);
                if (innerRingMat != null) innerRingMat.SetFloat("_SweepProgress", sweepProgress);
                // Slight opacity boost during sweep (less prominent while drawing)
                float sweepOpacity = Mathf.Lerp(0.55f, 0.85f, sweepProgress);
                if (outerRingMat != null) outerRingMat.SetFloat("_RingOpacity", sweepOpacity);
                if (innerRingMat != null) innerRingMat.SetFloat("_RingOpacity", sweepOpacity * (0.70f / 0.85f));

                // Rune fade in 0.5..0.85
                float runeT = Mathf.Clamp01((ceremonyT - 0.5f) / 0.35f);
                if (runeMat != null) runeMat.SetFloat("_Reveal", runeT);

                for (int sub = 0; sub < 3; sub++) cam.Render();
                CaptureCameraToPng(cam, $"{OUT_DIR}/ceremony-{f:D2}.png");
            }

            // Reset to static state
            if (runeMat != null) runeMat.SetFloat("_Reveal", 1f);
            if (outerRingMat != null) { outerRingMat.SetFloat("_SweepProgress", 1f); outerRingMat.SetFloat("_RingOpacity", 0.85f); }
            if (innerRingMat != null) { innerRingMat.SetFloat("_SweepProgress", 1f); innerRingMat.SetFloat("_RingOpacity", 0.70f); }
        }

        static int TypeIdToInt(string id)
        {
            switch (id)
            {
                case "cairn":    return 0;
                case "danger":   return 1;
                case "water":    return 2;
                case "hut":      return 3;
                case "junction": return 4;
                default:         return 0;
            }
        }

        /// <summary>
        /// Demo line 583-585: ringMat.color = lerp(typeColor, dark amber 0x2B1810, 0.55)
        /// 白底友好 dark color for ring + rune.
        /// </summary>
        static Color LerpToDarkAmber(Color typeColor)
        {
            Color darkAmber = new Color(0x2B / 255f, 0x18 / 255f, 0x10 / 255f, 1f);
            return Color.Lerp(typeColor, darkAmber, 0.55f);
        }

        static void CaptureCameraToPng(Camera cam, string path)
        {
            var rt = new RenderTexture(CAPTURE_W, CAPTURE_H, 24);
            cam.targetTexture = rt;
            var tex = new Texture2D(CAPTURE_W, CAPTURE_H, TextureFormat.RGB24, false);
            cam.Render();
            RenderTexture.active = rt;
            tex.ReadPixels(new Rect(0, 0, CAPTURE_W, CAPTURE_H), 0, 0);
            tex.Apply();
            cam.targetTexture = null;
            RenderTexture.active = null;
            UnityEngine.Object.DestroyImmediate(rt);
            File.WriteAllBytes(path, tex.EncodeToPNG());
            UnityEngine.Object.DestroyImmediate(tex);
            Debug.Log($"[v024-CAP] saved {path}");
        }
    }

    /// <summary>
    /// Sets Cairn shader globals at scene Awake. Without this, the V024
    /// playground shows wrong day/night state when the user opens Editor
    /// from cold.
    /// </summary>
    public class V024GlobalsApplier : MonoBehaviour
    {
        void Awake()
        {
            Shader.SetGlobalFloat("_CairnGlobalDayNightT", 0.0f);
            Shader.SetGlobalFloat("_CairnGlobalCamDist",   2.5f);
            Shader.SetGlobalFloat("_CairnGlobalAlpha",        1.0f);
            Shader.SetGlobalFloat("_CairnGlobalThermalScale", 1.0f);
        }
    }
}
#endif
