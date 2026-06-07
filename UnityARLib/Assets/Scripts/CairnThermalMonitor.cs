using UnityEngine;

/// <summary>
/// Drives _CairnGlobalThermalScale based on iOS thermal state. Strands
/// auto-dim when the device gets hot — escape valve preventing 5-minute+
/// AR sessions from triggering thermal throttling on iPhone 12.
///
/// Thermal scale → applied multiplicatively in StrandShader / HaloShader
/// to color output:
///   Nominal/Fair → 1.0  (full quality)
///   Serious      → 0.6  (bloom drops, particles half emission)
///   Critical     → 0.3  (particles off, bloom near-off; strand still
///                        visible but quiet)
///
/// Per plan §3 thermal escape valve.
///
/// Implementation note: Application.lowMemory and Application.targetFrameRate
/// are cross-platform. iOS thermal state is exposed via
/// UnityEngine.iOS.Device.thermalState (iOS-only — guard with #if).
/// </summary>
public class CairnThermalMonitor : MonoBehaviour
{
    private const float NOMINAL_SCALE  = 1.0f;
    private const float FAIR_SCALE     = 1.0f;  // same as nominal — no need to throttle
    private const float SERIOUS_SCALE  = 0.6f;
    private const float CRITICAL_SCALE = 0.3f;

    // Re-poll every 2s — thermal state changes slowly, no need to spam.
    private const float POLL_INTERVAL = 2.0f;

    private float _lastPollTime;
    private float _currentScale = NOMINAL_SCALE;

    void Awake()
    {
        // Subscribe to lowMemory as an additional safety net — lowMemory
        // means iOS will start aggressive caches eviction; assume serious
        // thermal/perf condition and clamp.
        Application.lowMemory += OnLowMemory;
    }

    void OnDestroy()
    {
        Application.lowMemory -= OnLowMemory;
    }

    void Update()
    {
        if (Time.realtimeSinceStartup - _lastPollTime < POLL_INTERVAL) return;
        _lastPollTime = Time.realtimeSinceStartup;

        float newScale = NOMINAL_SCALE;
#if UNITY_IOS && !UNITY_EDITOR
        try
        {
            var state = UnityEngine.iOS.Device.thermalState;
            switch (state)
            {
                case UnityEngine.iOS.DeviceThermalState.Nominal:
                    newScale = NOMINAL_SCALE; break;
                case UnityEngine.iOS.DeviceThermalState.Fair:
                    newScale = FAIR_SCALE; break;
                case UnityEngine.iOS.DeviceThermalState.Serious:
                    newScale = SERIOUS_SCALE; break;
                case UnityEngine.iOS.DeviceThermalState.Critical:
                    newScale = CRITICAL_SCALE; break;
                default:
                    newScale = NOMINAL_SCALE; break;
            }
        }
        catch (System.Exception e)
        {
            // Thermal API can throw on simulator or older iOS — treat as nominal.
            UnityLogger.W("CairnThermalMonitor", $"thermalState read failed: {e.Message}");
            newScale = NOMINAL_SCALE;
        }
#endif

        if (Mathf.Abs(newScale - _currentScale) > 0.01f)
        {
            _currentScale = newScale;
            if (CairnGlobals.Instance != null)
            {
                CairnGlobals.Instance.SetThermalScale(newScale);
            }
            UnityLogger.IForward("CairnThermalMonitor",
                $"Thermal scale → {newScale:F2}");
        }
    }

    private void OnLowMemory()
    {
        // Memory warning treated as Serious thermal state.
        _currentScale = SERIOUS_SCALE;
        if (CairnGlobals.Instance != null)
        {
            CairnGlobals.Instance.SetThermalScale(SERIOUS_SCALE);
        }
        UnityLogger.W("CairnThermalMonitor",
            $"Low memory warning — clamping thermal scale to {SERIOUS_SCALE}");
    }
}
