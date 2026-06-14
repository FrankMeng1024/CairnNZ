using UnityEngine;
using UnityEngine.XR.ARFoundation;

namespace Cairn.AR
{
    /// <summary>
    /// v0.2.3 Branch C — distance-based LOD adapter for the Cairn ribbon visual.
    ///
    /// Plan E-prime LOD bands:
    ///   • <6m   : full particles (rate=24), full cone, outline ON in day mode
    ///   • 6-12m : particles fade rate to 8, cone full, outline ON
    ///   • 12-25m: particles=0, cone scale ×1.3 (compensate distance), beacon-disc apex spawned
    ///   • >25m  : same as 12-25m + bloom boost ×1.5
    ///
    /// Sets shader globals:
    ///   _CairnGlobalCamDist   (float, metres)  — used by CairnConeCore + CairnConeOutline shaders
    ///
    /// 注 (2026-06-14 cleanup): _CairnGlobalLODBand 已删除. 0 shader 读取此 global,
    /// CairnRibbonLOD 字段 band0Max/band1Max/band2Max 仍保留供 OTA 后续 wire 用.
    ///
    /// Updates at 4Hz (every 0.25s) — distance changes slowly relative to AR
    /// frame rate, no need to re-evaluate every frame. Saves ~60Hz × 8 cairns
    /// of distance-vector math per second.
    /// </summary>
    [DefaultExecutionOrder(-100)] // run before spawners read globals
    public class CairnRibbonLOD : MonoBehaviour
    {
        [Header("Wiring")]
        public Camera arCamera;     // assigned by SceneSetup; falls back to Camera.main
        public Transform target;    // optional — distance to a specific cairn (leave null = camera-only mode for global setup)

        [Header("Distance Bands (metres)")]
        public float band0Max = 6f;   // <6 = full
        public float band1Max = 12f;  // 6-12 = mid
        public float band2Max = 25f;  // 12-25 = far
        // >25 = ultra-far (band 3)

        [Header("Sample Rate")]
        public float updateInterval = 0.25f;

        // Globals — registered once, written each tick.
        private static readonly int CamDistID  = Shader.PropertyToID("_CairnGlobalCamDist");

        // v3-review-fix: auto-instantiate at first scene load so distance
        // LOD works on every device build without editor menu prerequisite.
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void AutoBootstrap()
        {
            if (UnityEngine.Object.FindFirstObjectByType<CairnRibbonLOD>() != null) return;
            var go = new GameObject("CairnRibbonLOD (auto)");
            go.AddComponent<CairnRibbonLOD>();
            UnityEngine.Object.DontDestroyOnLoad(go);
        }

        private float _lastUpdate = -1f;
        private float _lastDist = -1f;

        void OnEnable()
        {
            if (arCamera == null) arCamera = Camera.main;
            // Init shader globals so first frame is sane (not stale 0).
            Shader.SetGlobalFloat(CamDistID, 5f);
            _lastUpdate = -1f;
        }

        void Update()
        {
            if (Time.time - _lastUpdate < updateInterval) return;
            _lastUpdate = Time.time;

            if (arCamera == null) arCamera = Camera.main;
            if (arCamera == null) return;

            // Distance: prefer to a specific target if wired (per-cairn LOD),
            // otherwise fall back to camera-relative origin (scene-wide global).
            Vector3 origin = (target != null) ? target.position : Vector3.zero;
            float dist = Vector3.Distance(arCamera.transform.position, origin);

            // Push to shader global if changed (cheap — global state is sticky
            // anyway; we just avoid redundant API calls).
            if (Mathf.Abs(dist - _lastDist) > 0.05f)
            {
                Shader.SetGlobalFloat(CamDistID, dist);
                _lastDist = dist;
            }
        }
    }
}
