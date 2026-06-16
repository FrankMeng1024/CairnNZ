// Phase 2B.8 — Editor capture playground for v025 visual tuning.
//
// Menu: Window → Cairn V025 → Capture Playground
//   - Spawn buttons: place a cairn at world origin with selected CairnType
//   - Capture button: take screenshot of Game view + Scene view, write to
//     _review/v0.2.5/visual/phase2/t<ms>.png at 4 timepoints (0/0.5/1/1.5s).
//   - SSIM compare button: invoke `python scripts/visual_compare.py compare`.

#if UNITY_EDITOR
using System;
using System.Collections;
using System.Diagnostics;
using System.IO;
using UnityEditor;
using UnityEngine;
using Cairn.AR.V025.Visual;
using Debug = UnityEngine.Debug;

namespace Cairn.AR.V025.EditorTools
{
    public sealed class V025CaptureWindow : EditorWindow
    {
        private CairnType _selectedType = CairnType.Image;
        private GameObject _activeCairn;
        private string _outputDir = "../_review/v0.2.5/visual/phase2";

        [MenuItem("Window/Cairn V025/Capture Playground")]
        public static void Open()
        {
            var w = GetWindow<V025CaptureWindow>("Cairn V025 Capture");
            w.minSize = new Vector2(320, 240);
        }

        private void OnGUI()
        {
            GUILayout.Label("Cairn v025 Capture Playground", EditorStyles.boldLabel);
            EditorGUILayout.Space();

            _selectedType = (CairnType)EditorGUILayout.EnumPopup("Type", _selectedType);

            using (new EditorGUI.DisabledScope(!Application.isPlaying))
            {
                if (GUILayout.Button("Spawn at origin"))
                {
                    SpawnCairn();
                }

                if (GUILayout.Button("Despawn"))
                {
                    DespawnCairn();
                }
            }

            EditorGUILayout.Space();
            _outputDir = EditorGUILayout.TextField("Output dir (relative)", _outputDir);

            using (new EditorGUI.DisabledScope(!Application.isPlaying))
            {
                if (GUILayout.Button("Capture 4 timepoints (0 / 0.5 / 1 / 1.5s)"))
                {
                    EditorCoroutineHost.Start(Capture4Timepoints());
                }
            }

            EditorGUILayout.Space();
            if (GUILayout.Button("Run SSIM compare (vs HTML demo baseline)"))
            {
                RunSsimCompare();
            }

            EditorGUILayout.Space();
            EditorGUILayout.HelpBox(
                "Editor PlayMode required for spawn + capture. SSIM compare reads from " +
                "_review/v0.2.5/visual/baseline (Playwright capture must run first via " +
                "`python scripts/visual_compare.py capture-baseline`).", MessageType.Info);
        }

        private void SpawnCairn()
        {
            DespawnCairn();
            // Build a minimal cairn: GameObject root + Base + TypeIcon stub.
            var root = new GameObject($"V025_Cairn_{_selectedType}");
            var baseGo = new GameObject("Base");
            baseGo.transform.SetParent(root.transform, false);
            baseGo.AddComponent<MeshFilter>();
            baseGo.AddComponent<MeshRenderer>();
            var baseR = baseGo.AddComponent<CairnBaseRenderer>();
            baseR.BuildOrRefresh();

            var iconGo = new GameObject("TypeIcon");
            iconGo.transform.SetParent(root.transform, false);
            iconGo.AddComponent<MeshFilter>();
            iconGo.AddComponent<MeshRenderer>();
            var iconR = iconGo.AddComponent<CairnTypeIconRenderer>();
            iconR.CairnType = _selectedType;
            iconR.BuildOrRefresh();

            // Position the root at world origin
            root.transform.position = Vector3.zero;
            _activeCairn = root;
            Debug.Log($"[v025/capture] Spawned cairn type={_selectedType}");
        }

        private void DespawnCairn()
        {
            if (_activeCairn != null)
            {
                DestroyImmediate(_activeCairn);
                _activeCairn = null;
            }
        }

        private IEnumerator Capture4Timepoints()
        {
            var dir = Path.GetFullPath(Path.Combine(Application.dataPath, _outputDir));
            Directory.CreateDirectory(dir);
            int[] timepointsMs = { 0, 500, 1000, 1500 };
            float startTime = Time.time;
            int idx = 0;
            foreach (var ms in timepointsMs)
            {
                yield return new WaitUntil(() => (Time.time - startTime) * 1000f >= ms);
                var path = Path.Combine(dir, $"t{ms:D4}.png");
                ScreenCapture.CaptureScreenshot(path);
                Debug.Log($"[v025/capture] saved {path}");
                idx++;
            }
        }

        private void RunSsimCompare()
        {
            var repoRoot = Path.GetFullPath(Path.Combine(Application.dataPath, "../.."));
            var script = Path.Combine(repoRoot, "scripts", "visual_compare.py");
            if (!File.Exists(script))
            {
                Debug.LogError($"[v025/capture] visual_compare.py not found at {script}");
                return;
            }
            var editorDir = Path.GetFullPath(Path.Combine(Application.dataPath, _outputDir));
            try
            {
                var p = new Process
                {
                    StartInfo = new ProcessStartInfo
                    {
                        FileName = "python",
                        Arguments = $"\"{script}\" compare --editor-dir \"{editorDir}\"",
                        WorkingDirectory = repoRoot,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                        UseShellExecute = false,
                        CreateNoWindow = true,
                    }
                };
                p.Start();
                var stdout = p.StandardOutput.ReadToEnd();
                var stderr = p.StandardError.ReadToEnd();
                p.WaitForExit(30000);
                Debug.Log("[v025/capture] SSIM stdout:\n" + stdout);
                if (!string.IsNullOrEmpty(stderr)) Debug.LogWarning("[v025/capture] SSIM stderr:\n" + stderr);
            }
            catch (System.ComponentModel.Win32Exception we)
            {
                Debug.LogError("[v025/capture] python not found in PATH; install Python 3 + pip install -r scripts/requirements.txt. " + we.Message);
            }
        }
    }

    /// <summary>
    /// Minimal coroutine host for EditorWindow — Unity's EditorCoroutines package
    /// not assumed; we drive yields via EditorApplication.update.
    /// </summary>
    internal static class EditorCoroutineHost
    {
        public static void Start(IEnumerator routine)
        {
            EditorApplication.CallbackFunction step = null;
            step = () =>
            {
                if (routine.MoveNext()) return;
                EditorApplication.update -= step;
            };
            EditorApplication.update += step;
        }
    }
}
#endif
