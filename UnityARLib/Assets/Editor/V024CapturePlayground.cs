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
using UnityEngine.Rendering.Universal;
using UnityEditor;
using UnityEditor.SceneManagement;

namespace Cairn.AR.Editor
{
    public static class V024CapturePlayground
    {
        struct TypeDef { public string id; public Color color; public string title; public string note; public string author; public string daysAgo; }
        static readonly TypeDef[] TYPES = new[]
        {
            new TypeDef { id = "cairn",    color = new Color(0.92f, 0.85f, 0.70f, 1f), title = "CAIRN",    note = "路过留念。视野很好。",   author = "Henare",   daysAgo = "5D"  },
            new TypeDef { id = "danger",   color = new Color(1.00f, 0.16f, 0.10f, 1f), title = "DANGER",   note = "湿滑。小心。",            author = "Sarah",    daysAgo = "12D" },
            new TypeDef { id = "water",    color = new Color(0.35f, 0.90f, 1.00f, 1f), title = "WATER",    note = "清澈溪水。可饮。",        author = "Te Aroha", daysAgo = "3D"  },
            new TypeDef { id = "junction", color = new Color(0.40f, 0.85f, 0.55f, 1f), title = "JUNCTION", note = "分叉路。北 → 山顶。",     author = "Manaia",   daysAgo = "7D"  },
            new TypeDef { id = "hut",      color = new Color(0.95f, 0.55f, 0.30f, 1f), title = "HUT",      note = "紧急避难所 200m 西北。",   author = "DOC",      daysAgo = "18D" },
            // V5.18 sub#2 F2 BLOCKER 撞色修:
            //   旧 cairn (0.91,0.78,0.59) 暖金 vs hut (0.83,0.63,0.42) 暖棕橙撞色
            //   修: cairn → (0.92, 0.85, 0.70) 偏白米色 (中性象征),hut → (0.95, 0.55, 0.30) 暖橙 (真"避难所暖光")
            //   junction → (0.40, 0.85, 0.55) 翠绿 (真"分叉路自然") 不再黄绿撞 cairn
            //   水蓝/危险红保持. 5 hue 在色相轮 ≥ 60° 分开
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
            // V4.1 fix: NZ 晨曦暖白 #E8DCC4 = (0.91, 0.86, 0.77) 对照 HTML demo line 90
            // 之前用深蓝 (0.02, 0.03, 0.10) 是 batch 测试便利,但用户基准是 HTML 暖白
            cam.backgroundColor = new Color(0.91f, 0.86f, 0.77f, 1f);
            cam.fieldOfView = 60f;
            cam.transform.position = new Vector3(0f, 1.4f, -2.8f);
            cam.transform.LookAt(new Vector3(0f, 0.85f, 0f));
            camGo.tag = "MainCamera";

            // V4.1 fix: 加暖金地面 plane(对照 HTML demo line 89-91 ground + same-color fog)
            // HTML CircleGeometry Ø40m + roughness=0.95 + 同色 fog FogExp2 0.012
            // Unity batch capture 用大 quad + 暖金 unlit material 即可(不需 PBR)
            var groundGo = GameObject.CreatePrimitive(PrimitiveType.Plane);
            groundGo.name = "V024Ground";
            UnityEngine.Object.DestroyImmediate(groundGo.GetComponent<Collider>());
            groundGo.transform.position = Vector3.zero;
            groundGo.transform.localScale = new Vector3(20f, 1f, 20f);  // 200m × 200m 远到雾里
            var groundMr = groundGo.GetComponent<MeshRenderer>();
            groundMr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            groundMr.receiveShadows = false;
            var groundMat = new Material(Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Unlit/Color"));
            // HTML 地面色 #C8AC75(暖金)估计 ≈ (0.78, 0.67, 0.46)
            if (groundMat.HasProperty("_BaseColor")) groundMat.SetColor("_BaseColor", new Color(0.78f, 0.67f, 0.46f, 1f));
            if (groundMat.HasProperty("_Color")) groundMat.SetColor("_Color", new Color(0.78f, 0.67f, 0.46f, 1f));
            groundMr.sharedMaterial = groundMat;

            // V4.1 fix: 同色 fog 远处淡入背景(模拟 HTML FogExp2)
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.ExponentialSquared;
            RenderSettings.fogColor = new Color(0.91f, 0.86f, 0.77f, 1f);  // 同 NZ 暖白
            RenderSettings.fogDensity = 0.012f;

            // V4.6 fix: URP Volume + ACES Filmic Tonemapping + Bloom
            var volumeGo = new GameObject("V024GlobalVolume");
            var volume = volumeGo.AddComponent<UnityEngine.Rendering.Volume>();
            volume.isGlobal = true;
            volume.priority = 1;
            var profile = ScriptableObject.CreateInstance<UnityEngine.Rendering.VolumeProfile>();
            // Tonemapping ACES
            var tonemap = profile.Add<Tonemapping>(true);
            tonemap.mode.Override(TonemappingMode.ACES);
            tonemap.mode.overrideState = true;
            // Bloom
            // V5.11 sub#1+sub#2 共识修: intensity 0.5 + threshold 0.9 让 16 ribbon 糊成 3 光柱
            //   intensity 0.5 → 0.30 减弱 halo radius 让 ribbon 间距 0.196m 不互相吞并
            //   threshold 0.9 → 1.10 只让真正高亮 (core+brightTint) 部分 trigger,halo 不参与 bloom
            // V5.20 sub#2 P0 修 (S11-N5): bloom 仍把 ribbon mid 段也合并白化
            //   intensity 0.30 → 0.15 (再减半 halo radius)
            //   threshold 1.10 → 1.6 只让 ribbon highlight band 进 bloom 保 silhouette
            var bloom = profile.Add<Bloom>(true);
            bloom.intensity.Override(0.15f);
            bloom.threshold.Override(1.6f);
            bloom.intensity.overrideState = true;
            bloom.threshold.overrideState = true;
            volume.sharedProfile = profile;

            // Camera 启用 post-processing(URP)
            var camData = cam.GetUniversalAdditionalCameraData();
            if (camData != null)
            {
                camData.renderPostProcessing = true;
                // V5.5 fix: 启用 depth texture 给 RibbonSilkV2.shader soft particle 用
                // batch capture 默认不开 → SampleSceneDepth 返回 0 → softFade=0 → ribbon 全消失
                camData.requiresDepthTexture = true;
            }

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
            // V4.3 fix: BaseTint 用提亮版本 (1.0, 0.92, 0.75) 不再用饱和 t.color
            // V5.17 sub#2 S8-N4 BLOCKER 修: brightTint Lerp(t.color, white, 0.4) 在 material 创建时
            //   就稀释 type color → 5 type 在屏幕上几乎无法区分 (water 失 60% 蓝, danger 变粉 等)
            //   V5.17: 删 brightTint, 直接用 t.color, 让 V5.16 SilkRibbonV2.cs:380 base*1.15 真起作用
            //   亮度由 shader _DayMul + bloom 处理, 不在 source 端稀释
            ribMat.SetColor("_BaseTint",      t.color);
            ribMat.SetColor("_TipTint",       new Color(1.0f, 1.0f, 0.95f, 1f));
            // V4.3 fix: _NightMul/_DayMul 同步 V4.2 shader default,不再用旧 1.6/0.55(2.9 倍切换)
            // V4.5 fix: _DayMul 1.5 → 2.5 让丝带白底下足够亮(_MaxLuma=1.6 clamp 后仍保白金高光)
            // V5.19 sub#2 S10-N3 BLOCKER 修: _DayMul=2.5 + _MaxLuma=1.6 clamp 让 cairn (0.92,0.85,0.70)
            //   * 2.5 = (2.30, 2.13, 1.75) clamp 1.6 → (1.6, 1.6, 1.6) 三通道全饱和成纯白,失色相
            //   修: _DayMul 2.5 → 1.4, _MaxLuma 1.6 → 2.5(实质关 clamp)
            //     cairn * 1.4 = (1.29, 1.19, 0.98) 不被 clamp,真米色保留
            ribMat.SetFloat("_NightMul",      1.10f);
            ribMat.SetFloat("_DayMul",        1.40f);
            ribMat.SetFloat("_MaxLuma",       2.50f);  // V5.19: 1.6 → 2.5 实质关 clamp 让 source 色相不被烧白
            // V4.3 fix: _FlowStrength 同步 V2.3 default 0.30(原 0.55 让 white texture 变 1.47 增亮)
            ribMat.SetFloat("_FlowStrength",  0.30f);
            ribMat.SetFloat("_BandFreq",      4.0f);
            // V4.3 fix: _BandIntensity 同步 V2.3 关闭 step bands(用户要柔和,Pokemon GO raid 横条不柔)
            // V4.5 fix: 0 → 0.10 弱化保留(关全没让丝带整体亮度降低,在白底下不可见)
            ribMat.SetFloat("_BandIntensity", 0.10f);
            // V5.5 fix(回归测):全部 V5.4/V2.5 临时关掉验证 ribbon 是否能渲染
            // V5.8 删(sub#1 BLOCKER): shader V5.5 已回退,_FresnelPower/_FresnelStrength/_SoftParticleFade
            //   property 不存在 → SetFloat silent no-op,误导 reader 以为 shader 在做 fresnel
            //   V2.3 fresnel 现在在 SilkRibbonV2.cs C# 路径(line ~331,viewPitch alpha)

            int typeId = TypeIdToInt(t.id);
            var runeMat = new Material(runeShader) { name = "RuneSDF_" + t.id };
            runeMat.SetFloat("_TypeId",    typeId);
            runeMat.SetColor("_TypeColor", t.color);
            runeMat.SetFloat("_Reveal",    1.0f);

            // --- Tier-1 圆环 (主环 + 内环,1:1 移植 Three.js demo line 142-166) ---
            // V5.12 sub#2 数学反推 (S2-N2 CRITICAL): V5.11 RING_RADIUS=0.50 + 16 ribbon
            //   → 邻接间距 周长/16 = π*0.5/8 = 0.196m,小于 maxWidth 0.16-0.21m → 几何重叠
            // V5.13 sub#1 几何反推 (S5-N2 BLOCKER): ringRadius 0.65 + cam 3.5m
            //   → 16 ribbon 屏幕宽度仅 160px, bloom halo 30px → 几何必然 3 群糊
            //   修法: 16→8 ribbon + ringRadius 1.0
            //     间距 π*1.0/8 = 0.39m, 屏幕宽 ~250px, 8 根每根 31px > bloom 30px 不糊
            //     8 根也匹配 HTML baseline 5-7 根的风格
            // V5.15 修: 8 ribbon viewing projection 5 distinct X 仍糊
            //   ringRadius 1.0 → 1.4, 12 ribbon 让 viewing projection 7 distinct X
            float RING_RADIUS = 1.7f;
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

            // V5.16 sub#2 S7-N1 BLOCKER 修 ring↔ribbon 视觉脱节 (250px 空白):
            //   sub#2 推荐: 加 cairn stones GameObject 真物理填充 ring → ribbon 之间空白
            //   3 个堆叠 cone (lower/middle/upper) 在 cluster 中心,高 y=0..0.5m
            //   匹配 HTML baseline cairn 石堆视觉
            for (int s = 0; s < 3; s++)
            {
                var stone = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                stone.name = $"CairnStone_{s}";
                UnityEngine.Object.DestroyImmediate(stone.GetComponent<Collider>());
                stone.transform.SetParent(root.transform, false);
                // 3 stones: 底大顶小 — radius 0.30/0.22/0.15, height 0.20/0.16/0.13
                float[] stoneR = { 0.30f, 0.22f, 0.15f };
                float[] stoneH = { 0.20f, 0.16f, 0.13f };
                float[] stoneY = { 0.10f, 0.28f, 0.44f };  // 累积 y centroid
                stone.transform.localPosition = new Vector3(0f, stoneY[s], 0f);
                // V5.17 sub#2 S8-N1 BLOCKER 修: Unity Cylinder primitive 默认 height=2m
                //   旧 scale.y = stoneH*0.5 让实际 height = stoneH*1m 仍偏矮
                //   修: scale.y = stoneH (让 Cylinder height = stoneH*2 倍 = 0.4/0.32/0.26m 真高)
                stone.transform.localScale = new Vector3(stoneR[s] * 2f, stoneH[s], stoneR[s] * 2f);
                var stoneMr = stone.GetComponent<MeshRenderer>();
                stoneMr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                stoneMr.receiveShadows = false;
                var stoneMat = new Material(Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Unlit/Color"));
                // 暖灰色 (0.55, 0.48, 0.40),与 cluster ground 区分但融入暖色调
                Color stoneColor = new Color(0.55f, 0.48f, 0.40f, 1f);
                if (stoneMat.HasProperty("_BaseColor")) stoneMat.SetColor("_BaseColor", stoneColor);
                if (stoneMat.HasProperty("_Color")) stoneMat.SetColor("_Color", stoneColor);
                stoneMr.sharedMaterial = stoneMat;
            }

            // --- 8 ribbons in a ring (V5.3: 5→8 加密) ---
            // 用户原话(40/100 review): "所有的丝线都是同时飘起 没有那种随机生成的错落
            //  而且很稀疏 所以看着很单薄"
            // V5.5 fix: phase 公式改 — 旧 (i*5)%8/8 让 i=3 phase=0.875 ribbon 起步就在 fade-out 区
            //   (SilkRibbonV2.cs:232 lifeT > 0.85 → globalFade 衰减)
            //   capture 2s 内 4 根 ribbon 几乎不可见 → 用户视觉只看到底座
            //   新公式:i*0.087 (1/RIBBON_COUNT * 0.7) 让全部 phase 在 0~0.61 起步可见区
            //   仍保持 8 根错落分布(0/0.087/0.174/...0.609)
            //
            // V5.9 sub#2 BLOCKER 修(用户 40/100 第 3 条 "稀疏单薄 同时飘起"):
            //   8 → 16 根 (密度 +100%, 解决稀疏)
            //   phaseOffset 公式改: 不再线性 i/N*0.7 让全部都从 stage1 起步,
            //     而用 (i/N + sin(i*0.7)*0.2) % 1 跨越 [0..1] 全周期 → 4-5 根在 stage1 接地、
            //     4-5 根在 stage2 中段、4-5 根在 stage3 高段 → 任意 capture 时刻都看到
            //     "升起 + 中段 + 飘空" 三阶段共存,真"错落生命感"
            //   maxWidth widthBase 0.18 → 0.16 微缩 (16 根更宽要避免互相挡光)
            // V5.20 sub#2 P0 几何根治: 12→6 ribbon + ringRadius 1.4→1.7
            //   sub#2 stall 第十一轮: 数量不解决合并问题, 几何间距才解决
            //   6 ribbon @ ringRadius 1.7 → 间距 π*1.7/3 = 1.78m, 屏幕宽 ~480px / 6 = 80px > bloom 30px 大幅
            int RIBBON_COUNT = 6;
            for (int i = 0; i < RIBBON_COUNT; i++)
            {
                // V5.18 sub#2 F1 BLOCKER 修: angle noise-driven 不再均匀
                //   均匀 i/N angle 让 viewing projection 对称 → 必合并成 3 光柱
                //   noise: angle = i/N + sin(i*1.3)*0.08 让 ribbon 角度不对称,屏幕投影 distinct
                // V5.19 sub#2 S10-N1 BLOCKER 修: 0.08 rad ≈ 4.6° 不足以打破对称
                //   改 0.08 → 0.20 (~11.5°) + Halton-like jitter 让分布更不规律
                float angleNoise = (Mathf.Sin(i * 1.3f) + Mathf.Cos(i * 2.7f) * 0.5f) * 0.20f;
                float angle = ((i / (float)RIBBON_COUNT) + angleNoise) * Mathf.PI * 2f;
                var rgo = new GameObject($"Ribbon_{i}");
                rgo.transform.SetParent(root.transform, false);
                // V5.15 ROLLBACK ribbon transform.y 0.35→0 (sub#2 S6-N5 BLOCKER):
                //   V5.14 transform.y=0.35 + 假设的 cairn stones 不存在 → 0.35m 物理空白
                //   V5.15: 回到 y=0, ribbon 起源贴 ground plane,ring↔ribbon 真正接地
                rgo.transform.localPosition = Vector3.zero;
                var rib = rgo.AddComponent<Cairn.AR.SilkRibbonV2>();
                rgo.GetComponent<MeshRenderer>().sharedMaterial = ribMat;
                // V5.9: phase 跨全周期 — 任意 capture 帧都同时看到 stage1/2/3 ribbon
                // V5.10b 修: V5.9 的 sin*0.13 抖动让 stage1 (phase<0.3) 只有 3 根
                //   → 改用纯 i/N 均匀分布: 16 根 → phase = 0, 0.0625, ... 0.9375
                //   → stage1 (0..0.30) 有 5 根升起、stage2 (0.30..0.65) 有 6 根中段、stage3 (0.65..1) 有 5 根高空
                //   → 任意 frame 都看到 5 根接地、6 根升空、5 根飘空,真"从阵法升起"
                // V5.20 sub#2 P0 修 phase 静态 (S11-N2):
                //   V5.19 phase [0, 0.4] 让 60帧 anim 都在 stage1/2 看不到生命周期
                //   V5.20: 回 [0, 1] 全周期跨度让 anim 60帧能看到任意时刻 stage1/2/3 共存
                float phaseOffset = (float)i / RIBBON_COUNT;
                float widthBase = 0.14f;
                float widthVar  = 0.04f * Mathf.Sin(phaseOffset * Mathf.PI * 3f + i * 1.7f);
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

            // V4.7 fix: Label 卡片(world-space quad + 预生成 PNG 文字图)
            // 直接用 quad 贴预生成 PNG(scripts/build_v024_labels.py 生成),batch mode 友好
            // 不用 TMP — 因为项目没装 TMP Essentials,fontMaterial null 报错
            var labelGo = GameObject.CreatePrimitive(PrimitiveType.Quad);
            labelGo.name = "Label";
            UnityEngine.Object.DestroyImmediate(labelGo.GetComponent<Collider>());
            labelGo.transform.SetParent(root.transform, false);
            // V5.2: 用户 40/100 review "中间的图标太大了" → 高度 1.45 → 1.6,scale 0.7x0.21 → 0.5x0.15
            // 同时 PNG 改成 500x150 (旧 700x210),包含 type icon (cairn=3stones, danger=triangle, etc.)
            labelGo.transform.localPosition = new Vector3(0f, 1.60f, 0f);
            labelGo.transform.localScale = new Vector3(0.5f, 0.15f, 1f);
            // V4.7 v5 fix: Unity Quad 默认 mesh 法线朝 -Z(背对 +Z),相机在 -Z 方向
            // 所以 Quad 法线 -Z 与相机视线方向 +Z 同向 = 背对相机被 backface culling 剔除
            // 加 180° rot 让法线朝 +Z = 朝相机
            labelGo.transform.localRotation = Quaternion.Euler(0f, 180f, 0f);
            var labelMr = labelGo.GetComponent<MeshRenderer>();
            labelMr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            labelMr.receiveShadows = false;
            // 加载预生成 label PNG(scripts/build_v024_labels.py 烘焙)
            var labelTex = AssetDatabase.LoadAssetAtPath<Texture2D>($"Assets/Textures/V4_label_{t.id}.png");
            // V4.7 v5 fix: Quad 法线确认朝相机后,改回 texture material
            // 用 Sprites/Default 内置 alpha blend 支持
            var labelMat = new Material(Shader.Find("Sprites/Default") ?? Shader.Find("Unlit/Transparent"));
            if (labelTex != null)
            {
                if (labelMat.HasProperty("_MainTex")) labelMat.SetTexture("_MainTex", labelTex);
                if (labelMat.HasProperty("_BaseMap")) labelMat.SetTexture("_BaseMap", labelTex);
            }
            labelMat.renderQueue = 3500;
            labelMr.sharedMaterial = labelMat;
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
            // V5.8 删 dead code(sub#1+sub#2 发现):
            //   _CairnGlobalAmbientLuma — shader 端从未声明也无人读取,纯 orphan
            //   _FresnelPower / _FresnelStrength / _SoftParticleFade — V5.5 shader 已回退,property 不存在,SetFloat silent no-op
            // V5.8 V2.5 光感自适应改在 SilkRibbonV2.cs C# 路径(读 RenderSettings.ambientLight,line 242)
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
                // V4.7 fix: lookAt y 1.0 → 1.2 让 label 卡片(放在 y=1.55)进入画面上 1/3
                // V5.10 sub#2 BLOCKER 修 ceremony invisible:
                //   V4.12 设的 (0,1.6,-3.2) 看 (0,1.2,0) 让圆环在画面下半被边缘化,
                //   ribbon 起源点 (y=0) 位于视野下方边缘,stage1 接地几乎看不到
                //   → 改用 type-stack 同款 (0,1.4,-2.8) 看 (0,0.85,0):
                //     - 看高度 0.85m → 圆环 + ribbon 接地点都在画面中下
                //     - 距离 2.8m 视野更紧凑,ribbon 升起轨迹完整可见 0..3m
                // V5.12c sub#2 第四轮 BLOCKER 修 ribbon-ring 视觉脱节:
                //   V5.10 (0,1.4,-2.8) 看 (0,0.85,0) ringRadius 0.85 → ribbon 后排离 cam 3.65m
                //     视差让远侧 ribbon 看起来更高,与圆环之间 200px 空白
                //   V5.12c 试 (0,1.0,-2.0) 看 (0,0.5,0) — 太近,ribbon 跑出画面
                // V5.12d 折中: (0,1.6,-3.5) 看 (0,1.0,0):
                //   - cam 距离 3.5m 视野够大,ribbon 全程 0..3m 在画面内
                //   - lookAt y=1.0m 让 ribbon 中段 (stage2 bottomY=0..1m) 在画面中部
                //   - 圆环 y=0 在画面下 1/3,接近 ribbon stage1 起源,真"从阵法升起"
                cam.transform.position = clusterPos + new Vector3(0f, 1.6f, -3.5f);
                cam.transform.LookAt(clusterPos + new Vector3(0f, 1.0f, 0f));

                // V2.2 P0a fix: 隐藏其他 cluster,避免相机视锥内出现穿帮(右下红色 danger 三角)
                // 5 cluster 摆在 (-6/-3/0/3/6) X 轴,相机俯拍当前 cluster 时其他 cluster 仍在视场内
                // V4.8 fix: GameObject.Find() 不找 inactive 对象,改用 transform 路径查找
                // 之前 bug: i=1 时 j=0 SetActive(false) 让 cairn inactive,然后 j=1 Find cluster_danger 因为前一轮被 SetActive(false) 找不到 → 不能 active 回来
                var clustersParent = GameObject.Find(CLUSTER_PARENT);
                if (clustersParent != null)
                {
                    for (int j = 0; j < clustersParent.transform.childCount; j++)
                    {
                        var clusterTr = clustersParent.transform.GetChild(j);
                        // 通过名字匹配 type id
                        bool isCurrent = clusterTr.name == $"Cluster_{t.id}";
                        clusterTr.gameObject.SetActive(isCurrent);
                    }
                }
                // v0.2.4 manual ticks: drive ribbons + particles since
                // batch mode does not fire MonoBehaviour Update / LateUpdate
                // V2.2 P1 fix: 跑 30 帧而非 60 帧截图
                // 60 帧 (3s) 后 5 根 ribbon 都已重生(_life > _lifeDuration),
                // 部分根处于 lifeT~0 globalFade 极淡 → screenshot 像 4 根
                // 30 帧 (1.5s) 后 5 根 lifeT = 0.3/0.5/0.7/0.9/1.1(根 4 刚重生 lifeT=0.1)
                // 仍有 1 根淡相位,但比 60 帧更接近"5 根都在场"
                // V4.8 fix: 用 clustersParent 路径查找,Find 不找 inactive
                GameObject clusterRoot = null;
                if (clustersParent != null)
                {
                    var clusterTr = clustersParent.transform.Find($"Cluster_{t.id}");
                    if (clusterTr != null) clusterRoot = clusterTr.gameObject;
                }
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
            // V5.1 fix(用户原话"仪式我看不到"根因):
            // 旧用 GameObject.Find — 但前一轮 capture 末尾把 4 个 cluster SetActive(false)
            // GameObject.Find 不返回 inactive → 4 个 cluster 永久 hidden
            // → ceremony 跑时 cairn cluster 是 inactive,ring/rune 全没渲染
            // → 画面只有底色 + 暖金 fog,24 帧像素全相同
            // 修法:用 clustersParent.transform.GetChild 遍历(能拿 inactive)
            var restoreParent = GameObject.Find(CLUSTER_PARENT);
            if (restoreParent != null)
            {
                for (int j = 0; j < restoreParent.transform.childCount; j++)
                {
                    restoreParent.transform.GetChild(j).gameObject.SetActive(true);
                }
                Debug.Log($"[v024-CAP] restored all {restoreParent.transform.childCount} clusters active=true before ceremony+anim");
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
            // V4.12 fix: 用 V4.x 相机设置(同 5 type capture)+ 在暖白底/暖金地面/fog 下截图
            // V5.10: 同 ceremony,相机改 (0,1.4,-2.8) 看 (0,0.85,0) 让 ribbon 起源点入视野
            // V5.12d: (0,1.6,-3.5) 看 (0,1.0,0) 让 ribbon 全程 + 圆环 同框
            cam.transform.position = clusterPos + new Vector3(0f, 1.6f, -3.5f);
            cam.transform.LookAt(clusterPos + new Vector3(0f, 1.0f, 0f));

            // V4.12 fix: 用 transform.Find 路径(GameObject.Find 不找 inactive,V4.8 同 bug)
            // 5 type capture 末尾把所有 cluster 都 SetActive(true) 但保险起见还是激活当前 cluster
            var clustersParent = GameObject.Find(CLUSTER_PARENT);
            GameObject clusterRoot = null;
            if (clustersParent != null)
            {
                // 激活 cairn 隐藏其他(避免穿帮)
                for (int j = 0; j < clustersParent.transform.childCount; j++)
                {
                    var c = clustersParent.transform.GetChild(j);
                    c.gameObject.SetActive(c.name == $"Cluster_{t.id}");
                }
                var clusterTr = clustersParent.transform.Find($"Cluster_{t.id}");
                if (clusterTr != null) clusterRoot = clusterTr.gameObject;
            }
            if (clusterRoot == null) return;

            var ribbons = clusterRoot.GetComponentsInChildren<Cairn.AR.SilkRibbonV2>();
            var parts   = clusterRoot.GetComponentsInChildren<Cairn.AR.TypeParticleController>();
            // V5.5 diag: 验证 ribbons 真存在 + 真 tick
            Debug.Log($"[v024-CAP-ANIM-DIAG] clusterRoot={clusterRoot.name} active={clusterRoot.activeSelf} ribbons={ribbons.Length} parts={parts.Length}");

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

            // V4.12 fix: restore 所有 cluster active
            if (clustersParent != null)
            {
                for (int j = 0; j < clustersParent.transform.childCount; j++)
                {
                    clustersParent.transform.GetChild(j).gameObject.SetActive(true);
                }
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

            // V5.1 fix:ceremony 期间只激活 cairn cluster,避免其他 4 个 type 在视场里穿帮
            // 用 transform.GetChild 遍历(GameObject.Find 不找 inactive,会漏)
            var clustersParent2 = GameObject.Find(CLUSTER_PARENT);
            if (clustersParent2 != null)
            {
                for (int j = 0; j < clustersParent2.transform.childCount; j++)
                {
                    var c = clustersParent2.transform.GetChild(j);
                    c.gameObject.SetActive(c.name == $"Cluster_{t.id}");
                }
            }

            // Find materials (rune + outer ring + inner ring)
            // V5.1 fix(用户原话"仪式我看不到"根因):GameObject.Find 不查嵌套 child
            // Cluster_cairn 是 V024Clusters 的 child → 用 clustersParent.transform.Find
            // 之前用 GameObject.Find 直接全场景搜,sharedMaterial 是 null,SetFloat 全 no-op
            // → 24 帧 ceremony PNG md5 全相同(用户看到的"仪式没动")
            var clustersParent = GameObject.Find(CLUSTER_PARENT);
            GameObject clusterRoot = null;
            if (clustersParent != null)
            {
                var ct = clustersParent.transform.Find($"Cluster_{t.id}");
                if (ct != null) clusterRoot = ct.gameObject;
            }
            Material runeMat = null, outerRingMat = null, innerRingMat = null;
            if (clusterRoot != null)
            {
                var rune = clusterRoot.transform.Find("Rune");
                if (rune != null) runeMat = rune.GetComponent<MeshRenderer>().sharedMaterial;
                var outerRing = clusterRoot.transform.Find("OuterRing");
                if (outerRing != null) outerRingMat = outerRing.GetComponent<MeshRenderer>().sharedMaterial;
                var innerRing = clusterRoot.transform.Find("InnerRing");
                if (innerRing != null) innerRingMat = innerRing.GetComponent<MeshRenderer>().sharedMaterial;
                Debug.Log($"[v024-CAP-CEREMONY] mats found: rune={runeMat!=null} outer={outerRingMat!=null} inner={innerRingMat!=null}");
            }
            else
            {
                Debug.LogError($"[v024-CAP-CEREMONY] Cluster_{t.id} NOT FOUND under {CLUSTER_PARENT} — ceremony will be static");
            }

            const int FRAMES = 24;
            // V5.1 fix: ceremony 也要看到 ribbon "活起来"(用户原话"仪式我看不到")
            // 拿 ribbons + particles 在 ceremony 后段(t>0.85)tick 起来
            var ribbons = clusterRoot != null ? clusterRoot.GetComponentsInChildren<Cairn.AR.SilkRibbonV2>() : new Cairn.AR.SilkRibbonV2[0];
            var parts   = clusterRoot != null ? clusterRoot.GetComponentsInChildren<Cairn.AR.TypeParticleController>() : new Cairn.AR.TypeParticleController[0];
            const float CEREMONY_DT = 1f / 24f;  // 24 frames over 1s
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

                // V5.1 diag: 验证 SetFloat 是否真生效
                if (f == 0 || f == 12 || f == 23)
                {
                    float gOuter = outerRingMat != null ? outerRingMat.GetFloat("_SweepProgress") : -1f;
                    float gInner = innerRingMat != null ? innerRingMat.GetFloat("_SweepProgress") : -1f;
                    float gRune  = runeMat != null ? runeMat.GetFloat("_Reveal") : -1f;
                    Debug.Log($"[v024-CAP-CEREMONY-DIAG] f={f} t={ceremonyT:F2} sweep={sweepProgress:F2} (got outer={gOuter:F2} inner={gInner:F2} rune={gRune:F2})");
                }

                // V5.1: ribbon 在 ceremony 后段开始动画(0.7+ 起 tick)
                // 让 24 帧 ceremony 末尾 ribbon 已经升起来,用户能看到"仪式 → ribbon 升起"过渡
                // V5.11 sub#1 第三轮抓出 真根因: ceremonyT>0.7 让前 17 帧 ribbon 静止
                //   → 用户"ceremony invisible"投诉的核心 — 前 70% ceremony ribbon 完全冻结
                //   → 改 ceremonyT > 0.0 让 ribbon 全程跟随 ceremony 升起,真"仪式中升起"
                if (ceremonyT > 0.0f)
                {
                    Shader.SetGlobalFloat("_CairnAnimTime", ceremonyT * 1.5f + 0.5f);
                    foreach (var rb in ribbons) rb.EditorManualTick(CEREMONY_DT);
                    foreach (var pc in parts)   pc.EditorManualTick(CEREMONY_DT);
                }

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
            // V5.8 删 dead code(sub#1+sub#2 发现):
            //   _CairnGlobalAmbientLuma — shader 端从未声明也无人读取,纯 orphan
            //   _FresnelPower / _FresnelStrength / _SoftParticleFade — V5.5 shader 已回退,property 不存在,SetFloat silent no-op
            // V5.8 V2.5 光感自适应改在 SilkRibbonV2.cs C# 路径(读 RenderSettings.ambientLight,line 242)
            Shader.SetGlobalFloat("_CairnGlobalCamDist",   2.5f);
            Shader.SetGlobalFloat("_CairnGlobalAlpha",        1.0f);
            Shader.SetGlobalFloat("_CairnGlobalThermalScale", 1.0f);
        }
    }
}
#endif
