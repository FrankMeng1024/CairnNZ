using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

/// <summary>
/// CairnVolumeOverrides — runtime URP volume tuner driven by CairnGlobals.
///
/// Per cinematic-ar-rebuild.md §B.4 + §G.1g. Bloom / Vignette / Color
/// Adjustments values are OTA-tunable (BloomIntensity, BloomThreshold,
/// BloomScatter, BloomTint, VignetteIntensity, VignetteSmoothness,
/// ColorAdjContrast, ColorAdjSaturation, ColorAdjPostExposure +
/// 3 Enabled flags).
///
/// On Awake: locate the global Volume + bake initial values from
/// registry defaults. Update: poll CairnGlobals for changes (cheap —
/// 2Hz — values won't change often via OTA).
/// </summary>
public class CairnVolumeOverrides : MonoBehaviour
{
    [Header("Wired by SceneSetup")]
    public Volume volume;

    private Bloom _bloom;
    private Vignette _vignette;
    private ColorAdjustments _colorAdj;
    private float _lastPoll;

    void OnEnable()
    {
        if (volume == null)
        {
            // Try to find any active Volume in the scene
            volume = FindAnyObjectByType<Volume>();
        }
        if (volume == null || volume.profile == null)
        {
            UnityLogger.W("CairnVolumeOverrides", "No Volume + profile found; OTA bloom inert");
            return;
        }
        volume.profile.TryGet(out _bloom);
        volume.profile.TryGet(out _vignette);
        volume.profile.TryGet(out _colorAdj);
        ApplyAll();
    }

    void Update()
    {
        if (Time.time - _lastPoll < 0.5f) return;
        _lastPoll = Time.time;
        ApplyAll();
    }

    private void ApplyAll()
    {
        var g = CairnGlobals.Instance;
        if (g == null) return;
        if (_bloom != null)
        {
            bool en = g.GetBool("BloomEnabled");
            _bloom.active = en;
            if (en)
            {
                _bloom.intensity.Override(g.GetForType(null, "BloomIntensity", 0.7f));
                _bloom.threshold.Override(g.GetForType(null, "BloomThreshold", 1.2f));
                _bloom.scatter.Override(g.GetForType(null, "BloomScatter", 0.45f));
                Color tint = g.GetColorForType(null, "BloomTint", new Color(0.5f, 0.9f, 1f, 1f));
                _bloom.tint.Override(tint);
            }
        }
        if (_vignette != null)
        {
            bool en = g.GetBool("VignetteEnabled");
            _vignette.active = en;
            if (en)
            {
                _vignette.intensity.Override(g.GetForType(null, "VignetteIntensity", 0.18f));
                _vignette.smoothness.Override(g.GetForType(null, "VignetteSmoothness", 0.45f));
            }
        }
        if (_colorAdj != null)
        {
            bool en = g.GetBool("ColorAdjEnabled");
            _colorAdj.active = en;
            if (en)
            {
                _colorAdj.contrast.Override(g.GetForType(null, "ColorAdjContrast", 8f));
                _colorAdj.saturation.Override(g.GetForType(null, "ColorAdjSaturation", 12f));
                _colorAdj.postExposure.Override(g.GetForType(null, "ColorAdjPostExposure", 0f));
            }
        }
    }
}
