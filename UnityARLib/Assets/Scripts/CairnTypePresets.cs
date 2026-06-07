using UnityEngine;
using System.Collections.Generic;

/// <summary>
/// Single source of truth for per-cairn-type visual identity.
///
/// 5 types: danger / junction / water / hut / cairn — each with a distinct
/// "DS personality" expressed via shader uniforms + particle behavior +
/// halo color. RN side (unityCairnSpawn.ts) sends the type string in
/// SpawnRequest and Unity looks up the preset here.
///
/// Why centralize: avoids the "RN says one set of values, Unity defaults
/// to another" drift bug. RN can override individual fields in
/// SpawnRequest (color, scrollSpeed, bloomBoost) for OTA tuning, but the
/// preset is the authoritative baseline.
///
/// Per-type rationale (matches docs/plans/DS_STRAND_V186_PLAN.md §1.B):
///   danger    → hot red, urgent flicker, dense particles
///   junction  → molten gold, slow sway
///   water     → cyan flow, downward drift, droplets
///   hut       → warm sepia hearth, deep breathing
///   cairn     → neutral sepia, default canonical look
/// </summary>
public static class CairnTypePresets
{
    public struct Preset
    {
        public Color color;
        public float scrollSpeed;
        public float bloomBoost;
        public float fresnelPow;
        public float fresnelIntensity;
        public float breathFreq;
        public Color haloColor;
        public float haloIntensity;
        public float particleRate;
        public Color particleStartColor;
    }

    // Hex helper
    private static Color FromHex(string hex)
    {
        if (ColorUtility.TryParseHtmlString(hex, out var c)) return c;
        return Color.magenta; // obvious "wrong" color so missing-hex bugs are visible
    }

    // Static dictionary of presets keyed by lowercase type id.
    // Match the type strings used by RN's MarkerType enum:
    //   'danger' | 'junction' | 'water' | 'hut' | 'cairn'.
    private static readonly Dictionary<string, Preset> _presets = new Dictionary<string, Preset>
    {
        ["danger"] = new Preset
        {
            color              = FromHex("#FF2A1A"),
            scrollSpeed        = 1.6f,
            bloomBoost         = 3.5f,
            fresnelPow         = 1.2f,
            fresnelIntensity   = 1.0f,
            breathFreq         = 1.4f,    // urgent
            haloColor          = FromHex("#3A0A05"),
            haloIntensity      = 2.5f,
            particleRate       = 30f,
            particleStartColor = FromHex("#FF6633"),
        },
        ["junction"] = new Preset
        {
            color              = FromHex("#FFB347"),
            scrollSpeed        = 0.7f,
            bloomBoost         = 3.0f,
            fresnelPow         = 1.8f,
            fresnelIntensity   = 0.9f,
            breathFreq         = 0.6f,
            haloColor          = FromHex("#5C3A12"),
            haloIntensity      = 2.0f,
            particleRate       = 25f,
            particleStartColor = FromHex("#FFCC66"),
        },
        ["water"] = new Preset
        {
            color              = FromHex("#5AE6FF"),
            scrollSpeed        = 0.45f,
            bloomBoost         = 2.2f,
            fresnelPow         = 2.5f,
            fresnelIntensity   = 1.2f,
            breathFreq         = 0.3f,
            haloColor          = FromHex("#0F3540"),
            haloIntensity      = 1.8f,
            particleRate       = 35f,
            particleStartColor = FromHex("#7AEEFF"),
        },
        ["hut"] = new Preset
        {
            color              = FromHex("#D4A06B"),
            scrollSpeed        = 0.35f,
            bloomBoost         = 2.0f,
            fresnelPow         = 1.5f,
            fresnelIntensity   = 0.7f,
            breathFreq         = 0.4f,
            haloColor          = FromHex("#3E2814"),
            haloIntensity      = 1.6f,
            particleRate       = 15f,
            particleStartColor = FromHex("#E0BE8C"),
        },
        ["cairn"] = new Preset
        {
            color              = FromHex("#E8C896"),
            scrollSpeed        = 0.6f,
            bloomBoost         = 2.5f,
            fresnelPow         = 1.6f,
            fresnelIntensity   = 0.85f,
            breathFreq         = 0.5f,
            haloColor          = FromHex("#2E1F12"),
            haloIntensity      = 1.8f,
            particleRate       = 20f,
            particleStartColor = FromHex("#F0DAB0"),
        },
    };

    /// <summary>
    /// Return preset for the given type. Falls back to "cairn" if unknown.
    /// </summary>
    public static Preset Get(string type)
    {
        if (string.IsNullOrEmpty(type)) return _presets["cairn"];
        if (_presets.TryGetValue(type.ToLowerInvariant(), out var p)) return p;
        return _presets["cairn"];
    }
}
