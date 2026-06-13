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
            new TypeDef { id = "cairn",    color = new Color(0.91f, 0.78f, 0.59f, 1f), title = "CAIRN",    note = "路过留念。视野很好。",   author = "Henare",   daysAgo = "5D"  },
            new TypeDef { id = "danger",   color = new Color(1.00f, 0.16f, 0.10f, 1f), title = "DANGER",   note = "湿滑。小心。",            author = "Sarah",    daysAgo = "12D" },
            new TypeDef { id = "water",    color = new Color(0.35f, 0.90f, 1.00f, 1f), title = "WATER",    note = "清澈溪水。可饮。",        author = "Te Aroha", daysAgo = "3D"  },
            new TypeDef { id = "junction", color = new Color(0.77f, 0.91f, 0.28f, 1f), title = "JUNCTION", note = "分叉路。北 → 山顶。",     author = "Manaia",   daysAgo = "7D"  },
            new TypeDef { id = "hut",      color = new Color(0.83f, 0.63f, 0.42f, 1f), title = "HUT",      note = "紧急避难所 200m 西北。",   author = "DOC",      daysAgo = "18D" },
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
            var bloom = profile.Add<Bloom>(true);
            bloom.intensity.Override(0.5f);
            bloom.threshold.Override(0.9f);
            bloom.intensity.overrideState = true;
            bloom.threshold.overrideState = true;
            volume.sharedProfile = profile;

            // Camera 启用 post-processing(URP)
            var camData = cam.GetUniversalAdditionalCameraData();
            if (camData != null) camData.renderPostProcessing = true;

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
            // 原代码用 t.color 让 cairn=(0.91,0.78,0.59) 在白底上不够亮,V4.2 shader 改 default 1.0/0.92/0.75 但 SetColor 覆盖了
            // 现在主动 lerp t.color 与白光 (1.0,1.0,0.95) 0.4 比例,得到亮版 type color
            Color brightTint = Color.Lerp(t.color, new Color(1.0f, 1.0f, 0.95f, 1f), 0.4f);
            ribMat.SetColor("_BaseTint",      brightTint);
            ribMat.SetColor("_TipTint",       new Color(1.0f, 1.0f, 0.95f, 1f));
            // V4.3 fix: _NightMul/_DayMul 同步 V4.2 shader default,不再用旧 1.6/0.55(2.9 倍切换)
            // V4.5 fix: _DayMul 1.5 → 2.5 让丝带白底下足够亮(_MaxLuma=1.6 clamp 后仍保白金高光)
            ribMat.SetFloat("_NightMul",      1.10f);
            ribMat.SetFloat("_DayMul",        2.50f);
            // V4.3 fix: _FlowStrength 同步 V2.3 default 0.30(原 0.55 让 white texture 变 1.47 增亮)
            ribMat.SetFloat("_FlowStrength",  0.30f);
            ribMat.SetFloat("_BandFreq",      4.0f);
            // V4.3 fix: _BandIntensity 同步 V2.3 关闭 step bands(用户要柔和,Pokemon GO raid 横条不柔)
            // V4.5 fix: 0 → 0.10 弱化保留(关全没让丝带整体亮度降低,在白底下不可见)
            ribMat.SetFloat("_BandIntensity", 0.10f);
            // V5.4 电影丝绸感参数(用户 40/100 review 后)
            ribMat.SetFloat("_FresnelPower",     2.5f);
            ribMat.SetFloat("_FresnelStrength",  0.8f);
            ribMat.SetFloat("_SoftParticleFade", 0.30f);

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

            // --- 8 ribbons in a ring (V5.3: 5→8 加密) ---
            // 用户原话(40/100 review): "所有的丝线都是同时飘起 没有那种随机生成的错落
            //  而且很稀疏 所以看着很单薄"
            // 修法:
            //   1. 5 根 → 8 根(密度 +60%)解决"稀疏单薄"
            //   2. phaseOffset 不再用 i/N 均匀(0/0.2/0.4/0.6/0.8 看起来是 5 个相位组),
            //      改用 (i * 5 % 8) / 8 黄金质数错落,8 根 phase 分布
            //      = 0, 5/8, 2/8, 7/8, 4/8, 1/8, 6/8, 3/8 → 视觉无对称无组,
            //      生命周期完全错开,任一时刻 8 根处于 8 个不同 stage
            int RIBBON_COUNT = 8;
            for (int i = 0; i < RIBBON_COUNT; i++)
            {
                float angle = (i / (float)RIBBON_COUNT) * Mathf.PI * 2f;
                var rgo = new GameObject($"Ribbon_{i}");
                rgo.transform.SetParent(root.transform, false);
                rgo.transform.localPosition = Vector3.zero;
                var rib = rgo.AddComponent<Cairn.AR.SilkRibbonV2>();
                rgo.GetComponent<MeshRenderer>().sharedMaterial = ribMat;
                // V5.3: 黄金质数错落,8 根 phase 在 (0, 1) 区间无对称分布
                float phaseOffset = ((i * 5) % RIBBON_COUNT) / (float)RIBBON_COUNT;
                // V5.3 加宽 + per-ribbon 噪声:base 0.15 → 0.18(+20%),每根 ±0.05 让"花束感"
                float widthBase = 0.18f;
                float widthVar  = 0.05f * Mathf.Sin(phaseOffset * Mathf.PI * 3f + i * 1.7f);  // 8 根独立扰动
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
                cam.transform.position = clusterPos + new Vector3(0f, 1.6f, -3.2f);
                cam.transform.LookAt(clusterPos + new Vector3(0f, 1.2f, 0f));

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
            cam.transform.position = clusterPos + new Vector3(0f, 1.6f, -3.2f);
            cam.transform.LookAt(clusterPos + new Vector3(0f, 1.2f, 0f));

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
                if (ceremonyT > 0.7f)
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
            Shader.SetGlobalFloat("_CairnGlobalCamDist",   2.5f);
            Shader.SetGlobalFloat("_CairnGlobalAlpha",        1.0f);
            Shader.SetGlobalFloat("_CairnGlobalThermalScale", 1.0f);
        }
    }
}
#endif
