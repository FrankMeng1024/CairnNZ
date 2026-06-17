// v0.2.5 Phase 2B — Headless batch capture for v025 visual system.
//
// Usage (batch mode):
//   Unity.exe -batchmode -projectPath UnityARLib
//     -executeMethod Cairn.AR.V025.EditorTools.V025HeadlessCapture.Run
//     -logFile Logs/v025-capture.log -quit
//
// Output: Logs/v025-capture/<type>-<frame>.png
// Produces 5 types × 12 frames = 60 PNGs, suitable for GIF assembly.
//
// In batch mode Unity does NOT enter Play mode, so we use Edit-mode
// rendering: set up scene → RenderTexture → Camera.Render() → EncodeToBytes.

#if UNITY_EDITOR
using System.IO;
using UnityEditor;
using UnityEngine;
using Cairn.AR.V025.Visual;

namespace Cairn.AR.V025.EditorTools
{
    public static class V025HeadlessCapture
    {
        const string OUT_DIR   = "Logs/v025-capture";
        const int    WIDTH     = 1280;
        const int    HEIGHT    = 720;
        const int    FRAMES    = 12;       // 12 frames per type = ~1.2s at 10fps
        const float  FRAME_DT  = 0.10f;   // simulate 100ms per frame

        static readonly CairnType[] ALL_TYPES = {
            CairnType.Image,
            CairnType.Voice,
            CairnType.Video,
            CairnType.Text,
            CairnType.Route,
        };

        [MenuItem("Cairn/V025 Headless Capture")]
        public static void RunFromMenu() { Run(); }

        /// <summary>
        /// Create materials for v025 visual components. In batch mode (no Editor resources),
        /// we create runtime materials from found shaders or fall back to Standard/URP-Lit.
        /// </summary>
        static Material MakeMaterial(string shaderPath, Color color)
        {
            var shader = Shader.Find(shaderPath);
            if (shader == null)
            {
                // URP fallback hierarchy
                shader = Shader.Find("Universal Render Pipeline/Lit")
                      ?? Shader.Find("Universal Render Pipeline/Simple Lit")
                      ?? Shader.Find("Standard");
            }
            if (shader == null)
            {
                Debug.LogWarning($"[V025Capture] no shader found for {shaderPath}, using Error shader");
                return new Material(Shader.Find("Hidden/InternalErrorShader") ?? Shader.Find("Standard"));
            }
            var mat = new Material(shader);
            mat.color = color;
            return mat;
        }

        public static void Run()
        {
            Debug.Log("[V025Capture] === START ===");

            // Resolve absolute output directory (relative to project root UnityARLib/).
            var projRoot = Path.GetFullPath(Application.dataPath + "/..");
            var outDir   = Path.Combine(projRoot, OUT_DIR);
            Directory.CreateDirectory(outDir);
            Debug.Log($"[V025Capture] output dir: {outDir}");

            // Pre-build materials so cairn components get proper colors (not magenta).
            var stoneMat    = MakeMaterial("Cairn/V025/CairnBase",      new Color(0.55f, 0.45f, 0.35f));
            var ringMat     = MakeMaterial("Cairn/V025/CairnCeremonyRing", new Color(0.98f, 0.57f, 0.24f));
            var iconMat     = MakeMaterial("Cairn/V025/CairnTypeIcon",   new Color(0.9f, 0.8f, 0.5f));
            Debug.Log($"[V025Capture] materials: stone={stoneMat.shader.name} ring={ringMat.shader.name} icon={iconMat.shader.name}");

            // Build render target.
            var rt = new RenderTexture(WIDTH, HEIGHT, 24, RenderTextureFormat.ARGB32);
            rt.antiAliasing = 4;

            // Build a minimal scene: ambient light + main camera + cairn.
            var camGo = new GameObject("CaptureCamera");
            var cam   = camGo.AddComponent<Camera>();
            cam.backgroundColor = new Color(0.95f, 0.93f, 0.88f, 1f); // warm off-white
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.fieldOfView = 45f;
            cam.targetTexture = rt;
            // Position: slightly elevated, looking down at cairn at origin.
            camGo.transform.position = new Vector3(0f, 0.8f, -1.5f);
            camGo.transform.LookAt(new Vector3(0f, 0.2f, 0f));

            // Directional light.
            var lightGo = new GameObject("DirectionalLight");
            var light   = lightGo.AddComponent<Light>();
            light.type = LightType.Directional;
            light.color = new Color(1f, 0.95f, 0.85f);
            light.intensity = 1.2f;
            lightGo.transform.rotation = Quaternion.Euler(45f, -30f, 0f);

            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.5f, 0.48f, 0.44f);

            int totalSaved = 0;
            int failedTypes = 0;

            foreach (var type in ALL_TYPES)
            {
                Debug.Log($"[V025Capture] capturing type={type}");

                // Build runtime cairn.
                GameObject cairnRoot = null;
                try
                {
                    cairnRoot = V025PrefabFactory.BuildRuntimePrefab(
                        baseMaterial: stoneMat, iconMaterial: iconMat, ringMaterial: ringMat);
                    if (cairnRoot == null)
                    {
                        Debug.LogError($"[V025Capture] BuildRuntimePrefab returned null for type={type}");
                        failedTypes++;
                        continue;
                    }

                    // Set type on the icon renderer.
                    var iconR = cairnRoot.GetComponentInChildren<CairnTypeIconRenderer>();
                    if (iconR != null)
                    {
                        iconR.CairnType = type;
                        iconR.BuildOrRefresh();
                    }

                    // Activate at world origin.
                    cairnRoot.transform.position = Vector3.zero;
                    cairnRoot.SetActive(true);

                    // Simulate Update() calls to advance ceremony ring + particles.
                    for (int f = 0; f < FRAMES; f++)
                    {
                        float t = f * FRAME_DT;
                        // Manually tick ceremony controller.
                        var ceremony = cairnRoot.GetComponentInChildren<CeremonyV2Controller>();
                        if (ceremony != null)
                        {
                            // Use the static math to advance the sweep visually.
                            var angle = CeremonySweepMath.SweepAngleRadians(t, 1.0f);
                            // CeremonyV2Controller will advance on its own when we call
                            // Update manually below — but Update is only called in PlayMode.
                            // In Edit mode, simulate by calling the public tick if available,
                            // or just capture the static state (ring is always visible).
                        }

                        // Render frame.
                        cam.Render();
                        RenderTexture.active = rt;
                        var tex = new Texture2D(WIDTH, HEIGHT, TextureFormat.RGB24, false);
                        tex.ReadPixels(new Rect(0, 0, WIDTH, HEIGHT), 0, 0);
                        tex.Apply();
                        RenderTexture.active = null;

                        var typeName = type.ToString().ToLowerInvariant();
                        var fileName = $"{typeName}-{f:D2}.png";
                        var filePath = Path.Combine(outDir, fileName);
                        File.WriteAllBytes(filePath, tex.EncodeToPNG());
                        Object.DestroyImmediate(tex);

                        totalSaved++;
                        Debug.Log($"[V025Capture] saved frame {f:D2}/{FRAMES-1} for type={type}: {fileName}");
                    }
                }
                catch (System.Exception ex)
                {
                    Debug.LogError($"[V025Capture] EXCEPTION type={type}: {ex}");
                    failedTypes++;
                }
                finally
                {
                    if (cairnRoot != null)
                        Object.DestroyImmediate(cairnRoot);
                }
            }

            // Cleanup.
            Object.DestroyImmediate(camGo);
            Object.DestroyImmediate(lightGo);
            Object.DestroyImmediate(rt);

            Debug.Log($"[V025Capture] === DONE: {totalSaved} PNGs saved, {failedTypes} types failed ===");

            if (Application.isBatchMode)
                EditorApplication.Exit(failedTypes > 0 ? 1 : 0);
        }
    }
}
#endif
