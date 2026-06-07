using UnityEngine;

/// <summary>
/// OTA-tunable shader globals. RN side sends "OnSetGlobal" messages
/// to CairnBridge; CairnBridge dispatches to this MonoBehaviour which
/// pushes Shader.SetGlobalFloat for the shaders.
///
/// Defaults are applied in Awake so shaders sampling pre-RN-init
/// don't read 0 (which would invisible-disappear cairns or kill bloom).
///
/// All setters CLAMP to declared range — bad RN payload values are
/// logged at warning level and clamped, never passed through. Notably
/// _CairnGlobalAlpha minimum is 0.05 (never invisible — recovery path).
///
/// Per plan §1.C and amendment A3.
/// </summary>
public class CairnGlobals : MonoBehaviour
{
    public static CairnGlobals Instance { get; private set; }

    // Default values — match shader Properties defaults so the visual
    // baseline is stable even if RN never sends a global update.
    public const float DEF_BLOOM_SCALE     = 1.0f;
    public const float DEF_ALPHA           = 1.0f;
    public const float DEF_LIGHT_ESTIMATE  = 1.0f;
    public const float DEF_SCROLL_MUL      = 1.0f;
    public const float DEF_BREATH_FREQ     = 1.0f;  // multiplier on per-material _BreathFreq
    public const float DEF_THERMAL_SCALE   = 1.0f;
    public const float DEF_HALO_RADIUS_MUL = 1.0f;

    // Range clamps — see plan §1.C
    public const float MIN_ALPHA           = 0.05f; // never invisible
    public const float MAX_ALPHA           = 1.0f;
    public const float MIN_BLOOM_SCALE     = 0.3f;
    public const float MAX_BLOOM_SCALE     = 2.0f;
    public const float MIN_LIGHT_ESTIMATE  = 0.3f;
    public const float MAX_LIGHT_ESTIMATE  = 2.0f;
    public const float MIN_SCROLL_MUL      = 0.0f;
    public const float MAX_SCROLL_MUL      = 2.0f;
    public const float MIN_BREATH_FREQ     = 0.0f;
    public const float MAX_BREATH_FREQ     = 2.0f;
    public const float MIN_THERMAL_SCALE   = 0.0f;
    public const float MAX_THERMAL_SCALE   = 1.0f;
    public const float MIN_HALO_RADIUS_MUL = 0.5f;
    public const float MAX_HALO_RADIUS_MUL = 2.0f;

    void Awake()
    {
        if (Instance != null && Instance != this)
        {
            UnityLogger.W("CairnGlobals", "Duplicate instance, destroying new.");
            Destroy(gameObject);
            return;
        }
        Instance = this;

        // Initialize all globals so shaders sampling them pre-RN-init
        // get sane values, not 0.
        Shader.SetGlobalFloat("_CairnGlobalBloomScale",   DEF_BLOOM_SCALE);
        Shader.SetGlobalFloat("_CairnGlobalAlpha",        DEF_ALPHA);
        Shader.SetGlobalFloat("_CairnGlobalLightEstimate", DEF_LIGHT_ESTIMATE);
        Shader.SetGlobalFloat("_CairnGlobalScrollMul",    DEF_SCROLL_MUL);
        Shader.SetGlobalFloat("_CairnGlobalBreathFreq",   DEF_BREATH_FREQ);
        Shader.SetGlobalFloat("_CairnGlobalThermalScale", DEF_THERMAL_SCALE);
        Shader.SetGlobalFloat("_CairnGlobalHaloRadiusMul", DEF_HALO_RADIUS_MUL);
        UnityLogger.IForward("CairnGlobals", "Initialized 7 globals to defaults");
    }

    /// <summary>
    /// RN-driven setter dispatch. Called by CairnBridge.OnSetGlobal after
    /// JsonUtility-parsing the message. name → which global, value → new
    /// value (will be clamped).
    /// </summary>
    public void Set(string name, float value)
    {
        if (string.IsNullOrEmpty(name)) return;
        switch (name)
        {
            case "BloomScale":     SetBloomScale(value);    break;
            case "Alpha":          SetAlpha(value);          break;
            case "LightEstimate":  SetLightEstimate(value);  break;
            case "ScrollMul":      SetScrollMul(value);      break;
            case "BreathFreq":     SetBreathFreq(value);     break;
            case "HaloRadiusMul":  SetHaloRadiusMul(value);  break;
            // ThermalScale is internal-driven only; reject RN attempts to
            // set it directly.
            case "ThermalScale":
                UnityLogger.W("CairnGlobals", "ThermalScale is internal — ignoring RN set");
                break;
            default:
                UnityLogger.W("CairnGlobals", $"Unknown global '{name}' — ignored");
                break;
        }
    }

    public void SetBloomScale(float v)
    {
        v = SafeClamp(v, MIN_BLOOM_SCALE, MAX_BLOOM_SCALE, "BloomScale");
        Shader.SetGlobalFloat("_CairnGlobalBloomScale", v);
    }

    public void SetAlpha(float v)
    {
        v = SafeClamp(v, MIN_ALPHA, MAX_ALPHA, "Alpha");
        Shader.SetGlobalFloat("_CairnGlobalAlpha", v);
    }

    public void SetLightEstimate(float v)
    {
        v = SafeClamp(v, MIN_LIGHT_ESTIMATE, MAX_LIGHT_ESTIMATE, "LightEstimate");
        Shader.SetGlobalFloat("_CairnGlobalLightEstimate", v);
    }

    public void SetScrollMul(float v)
    {
        v = SafeClamp(v, MIN_SCROLL_MUL, MAX_SCROLL_MUL, "ScrollMul");
        Shader.SetGlobalFloat("_CairnGlobalScrollMul", v);
    }

    public void SetBreathFreq(float v)
    {
        v = SafeClamp(v, MIN_BREATH_FREQ, MAX_BREATH_FREQ, "BreathFreq");
        Shader.SetGlobalFloat("_CairnGlobalBreathFreq", v);
    }

    public void SetHaloRadiusMul(float v)
    {
        v = SafeClamp(v, MIN_HALO_RADIUS_MUL, MAX_HALO_RADIUS_MUL, "HaloRadiusMul");
        Shader.SetGlobalFloat("_CairnGlobalHaloRadiusMul", v);
    }

    /// <summary>
    /// Internal-only: ThermalMonitor pushes here.
    /// </summary>
    public void SetThermalScale(float v)
    {
        v = Mathf.Clamp(v, MIN_THERMAL_SCALE, MAX_THERMAL_SCALE);
        Shader.SetGlobalFloat("_CairnGlobalThermalScale", v);
    }

    private static float SafeClamp(float v, float min, float max, string name)
    {
        if (float.IsNaN(v) || float.IsInfinity(v))
        {
            UnityLogger.W("CairnGlobals", $"{name}: NaN/Inf input rejected");
            return (min + max) * 0.5f;
        }
        if (v < min || v > max)
        {
            UnityLogger.W("CairnGlobals", $"{name}: {v} out of [{min},{max}] — clamping");
            v = Mathf.Clamp(v, min, max);
        }
        return v;
    }
}
