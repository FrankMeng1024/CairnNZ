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

            // --- 5 ribbons in a ring ---
            int RIBBON_COUNT = 5;
            float RING_RADIUS = 0.55f;
            for (int i = 0; i < RIBBON_COUNT; i++)
            {
                float angle = (i / (float)RIBBON_COUNT) * Mathf.PI * 2f + Random.value * 0.3f;
                var rgo = new GameObject($"Ribbon_{i}");
                rgo.transform.SetParent(root.transform, false);
                rgo.transform.localPosition = Vector3.zero;
                var rib = rgo.AddComponent<Cairn.AR.SilkRibbonV2>();
                rgo.GetComponent<MeshRenderer>().sharedMaterial = ribMat;
                rib.Configure(RING_RADIUS, angle, Random.value, t.color, new Color(0.95f, 0.97f, 1.0f, 1f));
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
                cam.transform.position = clusterPos + new Vector3(0f, 1.4f, -2.8f);
                cam.transform.LookAt(clusterPos + new Vector3(0f, 0.85f, 0f));

                // v0.2.4 manual ticks: drive ribbons + particles since
                // batch mode does not fire MonoBehaviour Update / LateUpdate
                var clusterRoot = GameObject.Find($"Cluster_{t.id}");
                if (clusterRoot != null)
                {
                    var ribbons = clusterRoot.GetComponentsInChildren<Cairn.AR.SilkRibbonV2>();
                    var parts   = clusterRoot.GetComponentsInChildren<Cairn.AR.TypeParticleController>();
                    for (int frame = 0; frame < 60; frame++)
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

            // Ceremony flipbook (use cairn cluster, animate camera/material params per frame)
            CaptureCeremony(cam);

            Debug.Log("[v024-CAP] === DONE ===");
            if (Application.isBatchMode) EditorApplication.Exit(0);
        }

        static void CaptureCeremony(Camera cam)
        {
            // For ceremony, we'll point camera at cairn cluster (index 0) and
            // procedurally animate ring sweep + rune reveal across 24 frames.
            var t = TYPES[0];  // cairn
            Vector3 clusterPos = new Vector3((0 - 2) * 3f, 0f, 0f);
            cam.transform.position = clusterPos + new Vector3(0f, 1.4f, -2.8f);
            cam.transform.LookAt(clusterPos + new Vector3(0f, 0.85f, 0f));

            // Find the rune material and animate _Reveal
            var rune = GameObject.Find("Cluster_cairn/Rune");
            Material runeMat = rune != null ? rune.GetComponent<MeshRenderer>().sharedMaterial : null;

            const int FRAMES = 24;
            for (int f = 0; f < FRAMES; f++)
            {
                float ceremonyT = f / (float)(FRAMES - 1);
                float runeT = Mathf.Clamp01((ceremonyT - 0.5f) / 0.35f);
                if (runeMat != null) runeMat.SetFloat("_Reveal", runeT);

                for (int sub = 0; sub < 3; sub++) cam.Render();
                CaptureCameraToPng(cam, $"{OUT_DIR}/ceremony-{f:D2}.png");
            }

            // Reset reveal
            if (runeMat != null) runeMat.SetFloat("_Reveal", 1f);
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
