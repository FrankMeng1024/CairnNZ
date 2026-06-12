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
    ///   _CairnGlobalCamDist   (float, metres)
    ///   _CairnGlobalLODBand   (int, 0-3)
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
        private static readonly int LODBandID  = Shader.PropertyToID("_CairnGlobalLODBand");

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
        private int _lastBand = -1;

        void OnEnable()
        {
            if (arCamera == null) arCamera = Camera.main;
            // Init shader globals so first frame is sane (not stale 0).
            Shader.SetGlobalFloat(CamDistID, 5f);
            Shader.SetGlobalInt(LODBandID, 0);
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

            // Compute band 0..3.
            int band;
            if      (dist < band0Max) band = 0;
            else if (dist < band1Max) band = 1;
            else if (dist < band2Max) band = 2;
            else                       band = 3;

            // Push to shader globals if changed (cheap — global state is sticky
            // anyway; we just avoid redundant API calls).
            if (Mathf.Abs(dist - _lastDist) > 0.05f)
            {
                Shader.SetGlobalFloat(CamDistID, dist);
                _lastDist = dist;
            }
            if (band != _lastBand)
            {
                Shader.SetGlobalInt(LODBandID, band);
                _lastBand = band;
            }
        }
    }
}
