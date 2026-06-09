using System;
using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// CairnGlobalsExt — v199 cinematic-rebuild OTA expansion of CairnGlobals.
///
/// CairnGlobals.cs (legacy) hand-codes ~25 named SetXxx methods + a switch.
/// Adding 110 more would balloon the file. This partial-class extension
/// uses a Dictionary<string, GlobalDef> to register all v199 globals
/// (color RGBAs, per-type overrides, kill-shot toggles, AR thresholds,
/// URP volume multipliers).
///
/// Per cinematic-ar-rebuild.md §G.1 + §G.4:
///   - SetGeneric(name, value)  — global float, clamped per registry
///   - SetForType(type, name, value) — per-type override (5 types)
///   - GetForType(type, name, fallback) — read with fallback to global
///   - SetColor(name, r,g,b,a) — wires 4 floats _R/_G/_B/_A to shader
///
/// CairnBridge.OnSetGlobal first tries the legacy switch in CairnGlobals.Set;
/// falls back to SetGeneric here on miss. CairnBridge.OnSetGlobalForType
/// + OnSetGlobalColor are new entry points for the per-type + RGBA paths.
/// </summary>
public partial class CairnGlobals
{
    public enum GlobalKind { Float, Color, Bool }

    public struct GlobalDef
    {
        public string Name;        // RN-side name, e.g. "WispRiseSpeed"
        public string ShaderUniform; // optional Shader uniform; null = component-only
        public GlobalKind Kind;
        public float Min;
        public float Max;
        public float Default;
        public bool PerTypeOverridable;
    }

    // Per-type overrides: type → name → value
    private readonly Dictionary<string, Dictionary<string, float>> _typeOverrides
        = new Dictionary<string, Dictionary<string, float>>();
    // Per-type colors: type → name → RGBA
    private readonly Dictionary<string, Dictionary<string, Color>> _typeColors
        = new Dictionary<string, Dictionary<string, Color>>();
    // Global colors: name → RGBA
    private readonly Dictionary<string, Color> _globalColors
        = new Dictionary<string, Color>();
    // Global float overrides for v199-registered names
    private readonly Dictionary<string, float> _floatExt
        = new Dictionary<string, float>();
    // Global bool overrides
    private readonly Dictionary<string, bool> _boolExt
        = new Dictionary<string, bool>();

    // Registry
    private static readonly Dictionary<string, GlobalDef> _registry = BuildRegistry();

    private static Dictionary<string, GlobalDef> BuildRegistry()
    {
        var r = new Dictionary<string, GlobalDef>();
        // Helper
        void F(string name, string uniform, float min, float max, float def, bool perType = false)
        {
            r[name] = new GlobalDef {
                Name = name, ShaderUniform = uniform, Kind = GlobalKind.Float,
                Min = min, Max = max, Default = def, PerTypeOverridable = perType,
            };
        }
        void C(string name, string uniformBase, bool perType = false)
        {
            // Colors register as Color kind; uniformBase is e.g. "_CairnGlobalWispBirthColor"
            // — wired at runtime via SetColor() to 4 floats _R/_G/_B/_A or as
            // single Vector4 uniform. PerType colors don't write Shader.SetGlobal
            // (they go via MaterialPropertyBlock at spawn time per §G.4).
            r[name] = new GlobalDef {
                Name = name, ShaderUniform = uniformBase, Kind = GlobalKind.Color,
                Min = 0, Max = 1, Default = 0, PerTypeOverridable = perType,
            };
        }
        void B(string name, bool def)
        {
            r[name] = new GlobalDef {
                Name = name, ShaderUniform = null, Kind = GlobalKind.Bool,
                Min = 0, Max = 1, Default = def ? 1f : 0f, PerTypeOverridable = false,
            };
        }

        // §G.1a Strand visual (18)
        F("RingEmitRate",          null, 2,  60,   14);
        F("WispLifetime",          null, 1,  10,   3.5f);
        F("WispRiseSpeed",         null, 0.2f, 4,  1.2f);
        F("WispCurlStrength",      null, 0,  1,    0.15f);
        F("WispTrailWidth",        null, 0.01f, 0.3f, 0.08f);
        F("WispTrailLifetime",     null, 0.3f, 6,  2.0f);
        C("WispBirthColor", "_CairnGlobalWispBirthColor", perType: true);
        C("WispMidColor",   "_CairnGlobalWispMidColor",   perType: true);
        C("WispEndColor",   "_CairnGlobalWispEndColor",   perType: true);
        F("WispBirthIntensity",    null, 0,  4,    1.0f);
        F("WispMidIntensity",      null, 0,  4,    1.5f);
        F("WispEndIntensity",      null, 0,  4,    0.7f);
        F("HeroRibbonCount",       null, 0,  12,   6);
        F("HeroRibbonHeight",      null, 0.5f, 3,  1.5f);
        F("HeroRibbonCurl",        null, 0,  1,    0.20f);
        F("FarShaftMinDist",       null, 5,  80,   12);
        F("FarShaftPixelHeight",   null, 20, 300,  80);
        B("WispEnabled", true);
        B("HeroRibbonEnabled", true);
        B("FarShaftEnabled", true);

        // §G.1b Per-type colors (5×8 = 40)
        C("PebbleColor",         "_CairnGlobalPebbleColor",     perType: true);
        C("PebbleRimColor",      "_CairnGlobalPebbleRimColor",  perType: true);
        C("PebbleEmissiveColor", "_CairnGlobalPebbleEmissive",  perType: true);
        C("TypeChipColor",       "_CairnGlobalTypeChipColor",   perType: true);
        C("HaloColor",           "_CairnGlobalHaloColor",       perType: true);

        // §G.1c Anchor/geometry (12)
        F("SummonRiseDistance",   null, 0,    1.5f, 0.6f);
        F("SummonDuration",       null, 0.1f, 1.5f, 0.4f);
        B("SummonEnabled", true);
        F("RaycastMaxAttempts",   null, 1,    20,   6);
        B("GroundLockEnabled", true);
        F("GroundLockStableMs",   null, 100,  10000, 1000);
        F("GroundLockEpsilon",    null, 0.005f, 0.5f, 0.05f);
        F("ArOriginAccuracyMaxM", null, 1,    100,  15);
        F("ArOriginStalenessKm",  null, 0.1f, 50,   1.0f);
        B("ArOriginCompensationEnabled", true);
        B("ConfidenceRingEnabled", true);
        F("ConfidenceRingAlpha",  null, 0,    1,    0.6f);

        // §G.1d Text (additions to existing TextScale/Height/Alpha — 8 new)
        F("TextBevelDepth",       null, 0,    1,    0.5f);
        F("TextGlowIntensity",    null, 0,    3,    1.0f);
        C("TextGlowColor",        "_CairnGlobalTextGlowColor");
        F("TextOutlineWidth",     null, 0,    0.5f, 0.05f);
        C("TextOutlineColor",     "_CairnGlobalTextOutlineColor");
        F("TextBackplateAlpha",   null, 0,    1,    0.7f);
        C("TextBackplateRimColor","_CairnGlobalTextBackplateRim");
        C("TextFaceColor",        "_CairnGlobalTextFaceColor");

        // §G.1e Kill-shots (~25)
        F("SeedCount",            null, 0,    20,   7);
        F("SeedRiseSpeed",        null, 0.1f, 3,    0.5f);
        C("SeedColor",            "_CairnGlobalSeedColor");
        F("SeedScaleMul",         null, 0.3f, 3,    1.0f);
        B("SeedEnabled", true);
        F("StarMoteCount",        null, 0,    600,  300);
        F("StarMoteDuration",     null, 0.5f, 6,    2.5f);
        F("StarMoteRadius",       null, 1,    10,   4.0f);
        B("StarMoteEnabled", true);
        F("LODSwapDistance",      null, 10,   200,  40);
        B("LanternEnabled", true);
        C("HandshakeBeamColor",   "_CairnGlobalHandshakeColor");
        F("HandshakeBeamWidth",   null, 0.005f, 0.2f, 0.04f);
        F("HandshakeBeamDuration",null, 0.2f, 3,    1.0f);
        F("HandshakeBeamPulseHz", null, 0.1f, 4,    1.0f);
        B("HandshakeBeamEnabled", true);
        C("RippleColor",          "_CairnGlobalRippleColor");
        F("RippleRadiusM",        null, 0.5f, 6,    3.0f);
        F("RippleDurationMs",     null, 200,  4000, 1500);
        B("RippleEnabled", true);
        C("ScanGridColor",        "_CairnGlobalScanGridColor");
        F("ScanGridPulseHz",      null, 0.1f, 4,    0.8f);
        F("ScanGridHexSize",      null, 0.05f, 1,   0.25f);
        B("ScanGridEnabled", true);
        F("ContactShadowAlpha",   null, 0,    1,    0.55f);
        F("ContactShadowRadiusMul", null, 0.3f, 3,  1.0f);
        B("ContactShadowEnabled", true);

        // §G.1f Like/report (10)
        F("AimConeRad",           null, 0.05f, 1.5f, 0.087f);
        F("AimHoldMs",            null, 100,  3000, 600);
        F("ArInteractRangeM",     null, 5,    100,  30);
        B("LikeReportEnabled", true);
        F("LikeReportPollMs",     null, 1000, 60000, 8000);
        F("LikeUndoToastMs",      null, 0,    15000, 5000);
        F("LikeBadgeScale",       null, 0.3f, 3,    1.0f);
        C("LikeBadgeColor",       "_CairnGlobalLikeBadgeColor");
        F("LikeBadgeFloatHeight", null, 0,    3,    1.6f);
        B("LikeBadgeEnabled", true);
        // Status-tint colors (3 RGBAs)
        C("StatusTintHealthy",    "_CairnGlobalStatusHealthy");
        C("StatusTintSuspicious", "_CairnGlobalStatusSuspicious");
        C("StatusTintHidden",     "_CairnGlobalStatusHidden");

        // §G.1g URP volume (12)
        F("BloomIntensity",       null, 0,    3,    0.7f);
        F("BloomThreshold",       null, 0.5f, 2,    1.2f);
        F("BloomScatter",         null, 0,    1,    0.45f);
        C("BloomTint",            null);
        F("VignetteIntensity",    null, 0,    0.6f, 0.18f);
        F("VignetteSmoothness",   null, 0,    1,    0.45f);
        F("ColorAdjContrast",     null, -30,  30,   8);
        F("ColorAdjSaturation",   null, -50,  50,   12);
        F("ColorAdjPostExposure", null, -2,   2,    0);
        B("BloomEnabled", true);
        B("VignetteEnabled", true);
        B("ColorAdjEnabled", true);

        // §G.1c continued — Ring details (refit)
        F("RingThickness",        null, 0.005f, 0.05f, 0.02f);
        F("RingDashCount",        null, 0,    24,   12);
        F("RingDashSpeed",        null, -2,   2,    0.5f);
        F("RingInnerPulseHz",     null, 0.1f, 4,    1.0f);
        F("RingEdgeSoftness",     null, 0.001f, 0.1f, 0.01f);

        // Confidence ring + ScanGrid float uniforms (review: shader reads
        // _CairnGlobalConfidenceRingAlpha / _CairnGlobalScanGridPulseHz /
        // _CairnGlobalScanGridHexSize / _CairnGlobalScanGridActive — without
        // ShaderUniform binding, OTA setting these silently fails).
        F("ConfidenceRingAlphaUni", "_CairnGlobalConfidenceRingAlpha", 0, 1, 0.6f);
        F("ScanGridPulseHzUni",   "_CairnGlobalScanGridPulseHz", 0.1f, 4, 0.8f);
        F("ScanGridHexSizeUni",   "_CairnGlobalScanGridHexSize", 0.05f, 1, 0.10f);
        F("ScanGridActiveUni",    "_CairnGlobalScanGridActive", 0, 1, 0f);
        // _CairnGlobalArConfidence — written by CairnBridge ARSession poll,
        // not by RN OTA. Registered for completeness (default 1 = full).
        F("ArConfidenceUni",      "_CairnGlobalArConfidence", 0, 1, 1.0f);

        // Halo per-type extras
        F("HaloPulseAmp",         null, 0,    1,    0.2f);
        F("HaloPulseHz",          null, 0.1f, 4,    1.2f);

        // Pebble shader extras
        F("PebbleRimPower",       null, 1,    8,    3);
        F("PebbleSubsurfaceStrength", null, 0, 1,   0.3f);

        // Pebble + TypeChip layout
        F("TypeChipScale",        null, 0.3f, 3,    1.0f);
        F("TypeChipFloatHeight",  null, 0,    2,    1.4f);
        F("TypeChipGlow",         null, 0,    3,    1.0f, perType: true);

        // v199 review: master kill-switches — required so OTA can disable
        // any v199 system if it misbehaves on real device, falling back to
        // v187 baseline visual without a rebuild.
        B("V199LayerEnabled", true);
        B("RuneTextEnabled", true);
        B("PebbleStackEnabled", true);
        B("TypeChipEnabledOTA", true);
        B("AnchorAttachEnabled", true);
        B("VerboseLogForward", false);

        return r;
    }

    /// <summary>Get registry definition (read-only; null if unknown name).</summary>
    public static bool TryGetDef(string name, out GlobalDef def)
        => _registry.TryGetValue(name, out def);

    /// <summary>Total registered v199 globals (for diagnostic).</summary>
    public static int RegistryCount => _registry.Count;

    /// <summary>
    /// Generic float setter — looked up in registry. Called from CairnBridge
    /// after legacy CairnGlobals.Set switch misses. Clamps + writes shader
    /// uniform if registered.
    /// </summary>
    public void SetGeneric(string name, float value)
    {
        if (!_registry.TryGetValue(name, out GlobalDef def))
        {
            UnityLogger.W("CairnGlobals", $"SetGeneric: unknown '{name}'");
            return;
        }
        if (def.Kind == GlobalKind.Color)
        {
            UnityLogger.W("CairnGlobals", $"SetGeneric: '{name}' is Color, use SetColor");
            return;
        }
        if (float.IsNaN(value) || float.IsInfinity(value))
        {
            UnityLogger.W("CairnGlobals", $"SetGeneric '{name}': NaN/Inf rejected");
            return;
        }
        if (def.Kind == GlobalKind.Bool)
        {
            bool b = value > 0.5f;
            _boolExt[name] = b;
            return;
        }
        // Float
        if (value < def.Min || value > def.Max)
        {
            UnityLogger.W("CairnGlobals",
                $"SetGeneric '{name}': {value} out of [{def.Min},{def.Max}] — clamping");
            value = Mathf.Clamp(value, def.Min, def.Max);
        }
        _floatExt[name] = value;
        if (!string.IsNullOrEmpty(def.ShaderUniform))
        {
            Shader.SetGlobalFloat(def.ShaderUniform, value);
        }
    }

    /// <summary>
    /// Per-type override. Stored per-type; consumed at spawn-time via
    /// MaterialPropertyBlock or by reading GetForType. Requires re-spawn
    /// to take effect on already-spawned cairns.
    /// </summary>
    public void SetForType(string type, string name, float value)
    {
        if (string.IsNullOrEmpty(type) || string.IsNullOrEmpty(name)) return;
        if (!_registry.TryGetValue(name, out GlobalDef def))
        {
            UnityLogger.W("CairnGlobals", $"SetForType: unknown '{name}'");
            return;
        }
        if (!def.PerTypeOverridable)
        {
            UnityLogger.W("CairnGlobals", $"SetForType: '{name}' not per-type-overridable");
            return;
        }
        if (float.IsNaN(value) || float.IsInfinity(value)) return;
        value = Mathf.Clamp(value, def.Min, def.Max);
        if (!_typeOverrides.TryGetValue(type, out var dict))
        {
            dict = new Dictionary<string, float>();
            _typeOverrides[type] = dict;
        }
        dict[name] = value;
    }

    /// <summary>
    /// Read per-type with fallback. Order: per-type override → global
    /// extension → registry default → fallback param.
    /// </summary>
    public float GetForType(string type, string name, float fallback)
    {
        if (!string.IsNullOrEmpty(type) &&
            _typeOverrides.TryGetValue(type, out var dict) &&
            dict.TryGetValue(name, out float v))
        {
            return v;
        }
        if (_floatExt.TryGetValue(name, out float g)) return g;
        if (_registry.TryGetValue(name, out GlobalDef def)) return def.Default;
        return fallback;
    }

    /// <summary>
    /// Read bool flag (kill-switches). Defaults to true if name unknown.
    /// </summary>
    public bool GetBool(string name, bool fallback = true)
    {
        if (_boolExt.TryGetValue(name, out bool b)) return b;
        if (_registry.TryGetValue(name, out GlobalDef def))
            return def.Default > 0.5f;
        return fallback;
    }

    /// <summary>
    /// Set a Color global (4 floats r/g/b/a, 0..1 each). Writes a
    /// Vector4 shader global named def.ShaderUniform if registered.
    /// </summary>
    public void SetColor(string name, float r, float g, float b, float a)
    {
        if (!_registry.TryGetValue(name, out GlobalDef def))
        {
            UnityLogger.W("CairnGlobals", $"SetColor: unknown '{name}'");
            return;
        }
        if (def.Kind != GlobalKind.Color)
        {
            UnityLogger.W("CairnGlobals", $"SetColor: '{name}' not a color");
            return;
        }
        Color c = new Color(
            Mathf.Clamp01(SafeFloat(r)),
            Mathf.Clamp01(SafeFloat(g)),
            Mathf.Clamp01(SafeFloat(b)),
            Mathf.Clamp01(SafeFloat(a))
        );
        _globalColors[name] = c;
        if (!string.IsNullOrEmpty(def.ShaderUniform))
        {
            Shader.SetGlobalVector(def.ShaderUniform, new Vector4(c.r, c.g, c.b, c.a));
        }
    }

    /// <summary>Per-type color override — not written to Shader.SetGlobal
    /// (per §G.4: per-type values applied via MaterialPropertyBlock at
    /// spawn time so types don't bleed into each other).</summary>
    public void SetColorForType(string type, string name, float r, float g, float b, float a)
    {
        if (string.IsNullOrEmpty(type)) return;
        if (!_registry.TryGetValue(name, out GlobalDef def) || !def.PerTypeOverridable
            || def.Kind != GlobalKind.Color)
        {
            UnityLogger.W("CairnGlobals", $"SetColorForType: '{name}' invalid");
            return;
        }
        Color c = new Color(
            Mathf.Clamp01(SafeFloat(r)),
            Mathf.Clamp01(SafeFloat(g)),
            Mathf.Clamp01(SafeFloat(b)),
            Mathf.Clamp01(SafeFloat(a))
        );
        if (!_typeColors.TryGetValue(type, out var dict))
        {
            dict = new Dictionary<string, Color>();
            _typeColors[type] = dict;
        }
        dict[name] = c;
    }

    /// <summary>Read per-type color with fallback.</summary>
    public Color GetColorForType(string type, string name, Color fallback)
    {
        if (!string.IsNullOrEmpty(type) &&
            _typeColors.TryGetValue(type, out var dict) &&
            dict.TryGetValue(name, out Color c))
        {
            return c;
        }
        if (_globalColors.TryGetValue(name, out Color g)) return g;
        return fallback;
    }

    private static float SafeFloat(float v)
        => float.IsNaN(v) || float.IsInfinity(v) ? 0f : v;
}
