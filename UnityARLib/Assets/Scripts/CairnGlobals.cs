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
public partial class CairnGlobals : MonoBehaviour
{
    public static CairnGlobals Instance { get; private set; }

    // Default values — match shader Properties defaults so the visual
    // baseline is stable even if RN never sends a global update.
    public const float DEF_BLOOM_SCALE     = 1.0f;
    public const float DEF_ALPHA           = 1.0f;
    // v0.2.3 Stage 1 removed: DEF_LIGHT_ESTIMATE (orphan)
    public const float DEF_SCROLL_MUL      = 1.0f;
    public const float DEF_BREATH_FREQ     = 1.0f;  // multiplier on per-material _BreathFreq
    public const float DEF_THERMAL_SCALE   = 1.0f;
    public const float DEF_HALO_RADIUS_MUL = 1.0f;

    // v187 portal-specific OTA. Each is a float multiplier on a shader
    // parameter; default 1.0 means "use material baseline". Setting a
    // global to 0 should be safe — shaders coalesce 0 → 1.0 via _coalesce.
    public const float DEF_PORTAL_SPIN          = 1.0f;  // _CairnGlobalPortalSpin    — multiplies sigil spin speed
    public const float DEF_PORTAL_SIGIL_INT     = 1.0f;  // _CairnGlobalSigilIntensity — multiplies sigil brightness
    public const float DEF_WISP_INTENSITY       = 1.0f;  // _CairnGlobalWispIntensity — multiplies wisp bloom
    // v0.2.3 Stage 1 removed: DEF_WISP_FADE_NEAR / DEF_WISP_FADE_FAR (orphan)
    public const float DEF_TEXT_ALPHA           = 1.0f;  // _CairnGlobalTextAlpha     — multiplier on mark text alpha (RN can hide all text)
    // v0.2.3 Stage 1 removed: DEF_QUALITY_TIER / DEF_AMBIENT_LUX (orphan)
    public const float DEF_BUBBLE_SPEED         = 1.0f;  // _CairnGlobalBubbleSpeed — multiplies bubble period; 0.5=slow, 2=fast
    public const float DEF_BUBBLE_SIZE          = 1.0f;  // _CairnGlobalBubbleSize  — bubble glow concentration; <1 sharper, >1 softer
    // v187.7 — full OTA cover: text, wisp, portal layout
    public const float DEF_TEXT_SCALE           = 1.0f;  // _CairnGlobalTextScale   — multiplies text characterSize at LateUpdate
    public const float DEF_TEXT_HEIGHT          = 1.0f;  // _CairnGlobalTextHeight  — multiplies text Y position (1.3m baseline)
    public const float DEF_WISP_COUNT_MUL       = 1.0f;  // 0.3 = sparse, 1.5 = dense — applied at spawn time, requires re-spawn to take effect
    public const float DEF_WISP_THICKNESS       = 1.0f;  // multiplier on wisp tube radius
    public const float DEF_WISP_HEIGHT          = 1.0f;  // multiplier on wisp tube height
    public const float DEF_PORTAL_SCALE         = 1.0f;  // multiplier on ring quad scale
    public const float DEF_ICON_SCALE           = 1.0f;  // multiplier on the SDF icon size in the ring shader
    public const float DEF_HALO_INTENSITY       = 1.0f;  // multiplier on ground halo color/alpha
    public const float DEF_FIREFLY_RATE         = 1.0f;  // multiplier on emission rate (0=no fireflies, 2=double)

    // Range clamps — see plan §1.C
    public const float MIN_ALPHA           = 0.05f; // never invisible
    public const float MAX_ALPHA           = 1.0f;
    public const float MIN_BLOOM_SCALE     = 0.3f;
    public const float MAX_BLOOM_SCALE     = 2.0f;
    // v0.2.3 Stage 1 removed: MIN/MAX_LIGHT_ESTIMATE (orphan)
    public const float MIN_SCROLL_MUL      = 0.0f;
    public const float MAX_SCROLL_MUL      = 2.0f;
    public const float MIN_BREATH_FREQ     = 0.0f;
    public const float MAX_BREATH_FREQ     = 2.0f;
    public const float MIN_THERMAL_SCALE   = 0.0f;
    public const float MAX_THERMAL_SCALE   = 1.0f;
    public const float MIN_HALO_RADIUS_MUL = 0.5f;
    public const float MAX_HALO_RADIUS_MUL = 2.0f;

    public const float MIN_PORTAL_SPIN      = 0.0f;
    public const float MAX_PORTAL_SPIN      = 4.0f;
    public const float MIN_PORTAL_SIGIL_INT = 0.0f;
    public const float MAX_PORTAL_SIGIL_INT = 3.0f;
    public const float MIN_WISP_INTENSITY   = 0.0f;
    public const float MAX_WISP_INTENSITY   = 3.0f;
    // v0.2.3 Stage 1 removed: MIN/MAX_WISP_FADE (orphan)
    public const float MIN_TEXT_ALPHA       = 0.0f;
    public const float MAX_TEXT_ALPHA       = 1.0f;
    // v0.2.3 Stage 1 removed: MIN/MAX_QUALITY_TIER, MIN/MAX_AMBIENT_LUX (orphan)
    public const float MIN_BUBBLE_SPEED     = 0.1f;
    public const float MAX_BUBBLE_SPEED     = 4.0f;
    public const float MIN_BUBBLE_SIZE      = 0.3f;
    public const float MAX_BUBBLE_SIZE      = 3.0f;
    public const float MIN_TEXT_SCALE       = 0.3f;
    public const float MAX_TEXT_SCALE       = 3.0f;
    public const float MIN_TEXT_HEIGHT      = 0.3f;
    public const float MAX_TEXT_HEIGHT      = 3.0f;
    public const float MIN_WISP_COUNT_MUL   = 0.0f;
    public const float MAX_WISP_COUNT_MUL   = 2.0f;
    public const float MIN_WISP_THICKNESS   = 0.3f;
    public const float MAX_WISP_THICKNESS   = 3.0f;
    public const float MIN_WISP_HEIGHT      = 0.3f;
    public const float MAX_WISP_HEIGHT      = 3.0f;
    public const float MIN_PORTAL_SCALE     = 0.3f;
    public const float MAX_PORTAL_SCALE     = 3.0f;
    public const float MIN_ICON_SCALE       = 0.3f;
    public const float MAX_ICON_SCALE       = 3.0f;
    public const float MIN_HALO_INTENSITY   = 0.0f;
    public const float MAX_HALO_INTENSITY   = 3.0f;
    public const float MIN_FIREFLY_RATE     = 0.0f;
    public const float MAX_FIREFLY_RATE     = 3.0f;

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
        // v0.2.3 Stage 1 removed: _CairnGlobalLightEstimate (orphan)
        Shader.SetGlobalFloat("_CairnGlobalScrollMul",    DEF_SCROLL_MUL);
        Shader.SetGlobalFloat("_CairnGlobalBreathFreq",   DEF_BREATH_FREQ);
        Shader.SetGlobalFloat("_CairnGlobalThermalScale", DEF_THERMAL_SCALE);
        Shader.SetGlobalFloat("_CairnGlobalHaloRadiusMul", DEF_HALO_RADIUS_MUL);

        // v187 portal globals — must default to non-zero so shaders'
        // _coalesce(0)→1 logic doesn't kick in unintentionally; we want
        // explicit "use material baseline" = 1.0.
        Shader.SetGlobalFloat("_CairnGlobalPortalSpin",     DEF_PORTAL_SPIN);
        Shader.SetGlobalFloat("_CairnGlobalSigilIntensity", DEF_PORTAL_SIGIL_INT);
        Shader.SetGlobalFloat("_CairnGlobalWispIntensity",  DEF_WISP_INTENSITY);
        // v0.2.3 Stage 1 removed: _CairnGlobalWispFadeNear/Far (orphan)
        Shader.SetGlobalFloat("_CairnGlobalTextAlpha",      DEF_TEXT_ALPHA);
        // v0.2.3 Stage 1 removed: _CairnGlobalQualityTier/AmbientLux (orphan)
        Shader.SetGlobalFloat("_CairnGlobalBubbleSpeed",    DEF_BUBBLE_SPEED);
        Shader.SetGlobalFloat("_CairnGlobalBubbleSize",     DEF_BUBBLE_SIZE);
        Shader.SetGlobalFloat("_CairnGlobalTextScale",      DEF_TEXT_SCALE);
        Shader.SetGlobalFloat("_CairnGlobalTextHeight",     DEF_TEXT_HEIGHT);
        Shader.SetGlobalFloat("_CairnGlobalWispCountMul",   DEF_WISP_COUNT_MUL);
        Shader.SetGlobalFloat("_CairnGlobalWispThickness",  DEF_WISP_THICKNESS);
        Shader.SetGlobalFloat("_CairnGlobalWispHeight",     DEF_WISP_HEIGHT);
        Shader.SetGlobalFloat("_CairnGlobalPortalScale",    DEF_PORTAL_SCALE);
        Shader.SetGlobalFloat("_CairnGlobalIconScale",      DEF_ICON_SCALE);
        Shader.SetGlobalFloat("_CairnGlobalHaloIntensity",  DEF_HALO_INTENSITY);
        Shader.SetGlobalFloat("_CairnGlobalFireflyRate",    DEF_FIREFLY_RATE);
        UnityLogger.IForward("CairnGlobals", "Initialized 7 base + 20 portal globals to defaults");

        // v0.2.5 — also push defaults for every Float global registered
        // in CairnGlobalsExt that has a ShaderUniform binding. Without this,
        // shaders sampling extension uniforms (e.g. _CairnGlobalArConfidence)
        // see Unity's default 0 instead of the registry's intended default.
        // Concrete bug this caused: ConfidenceRingShader saturated 0 → red,
        // so the ring appeared red on every cairn even though the registry
        // default for ArConfidenceUni is 1.0 (which would saturate to green).
        // Subagent C1-10 traced this.
        try
        {
            int pushed = 0;
            foreach (var def in EnumerateDefs())
            {
                if (string.IsNullOrEmpty(def.ShaderUniform)) continue;
                if (def.Kind == GlobalKind.Float)
                {
                    Shader.SetGlobalFloat(def.ShaderUniform, def.Default);
                    pushed++;
                }
            }
            UnityLogger.IForward("CairnGlobals", $"v0.2.5 ext-defaults pushed={pushed} (Float uniforms)");
        }
        catch (System.NullReferenceException e)
        {
            UnityLogger.W("CairnGlobals", "ext-defaults push failed (null): " + e.Message);
        }
        catch (System.InvalidOperationException e)
        {
            UnityLogger.W("CairnGlobals", "ext-defaults push failed (invalid op): " + e.Message);
        }
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
            // v0.2.3 Stage 1 removed: LightEstimate (no shader consumer)
            case "ScrollMul":      SetScrollMul(value);      break;
            case "BreathFreq":     SetBreathFreq(value);     break;
            case "HaloRadiusMul":     SetHaloRadiusMul(value);     break;
            // v187 portal-specific
            case "PortalSpin":        SetPortalSpin(value);        break;
            case "SigilIntensity":    SetSigilIntensity(value);    break;
            case "WispIntensity":     SetWispIntensity(value);     break;
            // v0.2.3 Stage 1 removed: WispFadeNear/WispFadeFar (orphan, never consumed by WispShader)
            case "TextAlpha":         SetTextAlpha(value);         break;
            // v0.2.3 Stage 1 removed: QualityTier/AmbientLux (no shader consumer)
            case "BubbleSpeed":       SetBubbleSpeed(value);       break;
            case "BubbleSize":        SetBubbleSize(value);        break;
            case "TextScale":         SetTextScale(value);         break;
            case "TextHeight":        SetTextHeight(value);        break;
            case "WispCountMul":      SetWispCountMul(value);      break;
            case "WispThickness":     SetWispThickness(value);     break;
            case "WispHeight":        SetWispHeight(value);        break;
            case "PortalScale":       SetPortalScale(value);       break;
            case "IconScale":         SetIconScale(value);         break;
            case "HaloIntensity":     SetHaloIntensity(value);     break;
            case "FireflyRate":       SetFireflyRate(value);       break;
            // ThermalScale is internal-driven only; reject RN attempts to
            // set it directly.
            case "ThermalScale":
                UnityLogger.W("CairnGlobals", "ThermalScale is internal — ignoring RN set");
                break;
            default:
                // v199: fallback to extension registry (110+ new globals
                // registered in CairnGlobalsExt). If still unknown,
                // SetGeneric warns + ignores.
                SetGeneric(name, value);
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

    // v0.2.3 Stage 1 removed: SetLightEstimate (orphan, no shader consumer).

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

    // v187 portal-specific OTA setters.
    public void SetPortalSpin(float v)
    {
        v = SafeClamp(v, MIN_PORTAL_SPIN, MAX_PORTAL_SPIN, "PortalSpin");
        Shader.SetGlobalFloat("_CairnGlobalPortalSpin", v);
    }
    public void SetSigilIntensity(float v)
    {
        v = SafeClamp(v, MIN_PORTAL_SIGIL_INT, MAX_PORTAL_SIGIL_INT, "SigilIntensity");
        Shader.SetGlobalFloat("_CairnGlobalSigilIntensity", v);
    }
    public void SetWispIntensity(float v)
    {
        v = SafeClamp(v, MIN_WISP_INTENSITY, MAX_WISP_INTENSITY, "WispIntensity");
        Shader.SetGlobalFloat("_CairnGlobalWispIntensity", v);
    }
    // v0.2.3 Stage 1 removed: SetWispFadeNear/SetWispFadeFar (orphan, WispShader uses per-material _CamFadeNear/_CamFadeFar; OTA never reached shader).
    public void SetTextAlpha(float v)
    {
        v = SafeClamp(v, MIN_TEXT_ALPHA, MAX_TEXT_ALPHA, "TextAlpha");
        Shader.SetGlobalFloat("_CairnGlobalTextAlpha", v);
    }
    // v0.2.3 Stage 1 removed: SetQualityTier/SetAmbientLux (orphan, no shader consumer).
    public void SetBubbleSpeed(float v)
    {
        v = SafeClamp(v, MIN_BUBBLE_SPEED, MAX_BUBBLE_SPEED, "BubbleSpeed");
        Shader.SetGlobalFloat("_CairnGlobalBubbleSpeed", v);
    }
    public void SetBubbleSize(float v)
    {
        v = SafeClamp(v, MIN_BUBBLE_SIZE, MAX_BUBBLE_SIZE, "BubbleSize");
        Shader.SetGlobalFloat("_CairnGlobalBubbleSize", v);
    }
    public void SetTextScale(float v)      { v = SafeClamp(v, MIN_TEXT_SCALE,     MAX_TEXT_SCALE,     "TextScale");     Shader.SetGlobalFloat("_CairnGlobalTextScale",     v); }
    public void SetTextHeight(float v)     { v = SafeClamp(v, MIN_TEXT_HEIGHT,    MAX_TEXT_HEIGHT,    "TextHeight");    Shader.SetGlobalFloat("_CairnGlobalTextHeight",    v); }
    public void SetWispCountMul(float v)   { v = SafeClamp(v, MIN_WISP_COUNT_MUL, MAX_WISP_COUNT_MUL, "WispCountMul");  Shader.SetGlobalFloat("_CairnGlobalWispCountMul",  v); }
    public void SetWispThickness(float v)  { v = SafeClamp(v, MIN_WISP_THICKNESS, MAX_WISP_THICKNESS, "WispThickness"); Shader.SetGlobalFloat("_CairnGlobalWispThickness", v); }
    public void SetWispHeight(float v)     { v = SafeClamp(v, MIN_WISP_HEIGHT,    MAX_WISP_HEIGHT,    "WispHeight");    Shader.SetGlobalFloat("_CairnGlobalWispHeight",    v); }
    public void SetPortalScale(float v)    { v = SafeClamp(v, MIN_PORTAL_SCALE,   MAX_PORTAL_SCALE,   "PortalScale");   Shader.SetGlobalFloat("_CairnGlobalPortalScale",   v); }
    public void SetIconScale(float v)      { v = SafeClamp(v, MIN_ICON_SCALE,     MAX_ICON_SCALE,     "IconScale");     Shader.SetGlobalFloat("_CairnGlobalIconScale",     v); }
    public void SetHaloIntensity(float v)  { v = SafeClamp(v, MIN_HALO_INTENSITY, MAX_HALO_INTENSITY, "HaloIntensity"); Shader.SetGlobalFloat("_CairnGlobalHaloIntensity", v); }
    public void SetFireflyRate(float v)    { v = SafeClamp(v, MIN_FIREFLY_RATE,   MAX_FIREFLY_RATE,   "FireflyRate");   Shader.SetGlobalFloat("_CairnGlobalFireflyRate",   v); }

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
