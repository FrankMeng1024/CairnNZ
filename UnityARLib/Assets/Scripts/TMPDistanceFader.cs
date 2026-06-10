using TMPro;
using UnityEngine;

/// <summary>
/// TMPDistanceFader — TMP_Text-aware port of MarkTextDistanceFader for the
/// v199 cinematic rune-text path. Same OTA contract as the legacy fader:
///   _CairnGlobalTextScale  → multiplier on transform.localScale
///   _CairnGlobalTextHeight → multiplier on Y position
///   _CairnGlobalTextAlpha  → multiplier on alpha
///
/// Why a separate component instead of reusing MarkTextDistanceFader:
/// the legacy fader's GetComponent<TextMesh>() returns null when attached
/// to a TMP GameObject (TextMesh and TMP_Text are unrelated types), so its
/// first guard returns and the entire billboard + fade + OTA pipeline is
/// dead silently. v199 rune text needs a TMP_Text-typed reference, and
/// crucially must write alpha through TMP_Text.color (which routes through
/// the property block / mesh vertex colors) rather than Renderer.material
/// (which would mutate the shared TMP atlas material across every cairn
/// in the scene — confirmed by subagent3 review M-FADER-1).
///
/// Distance contract identical to the legacy fader so the visual feel
/// matches v187:
///   - Fully visible at ≤ fadeStartFar
///   - Linear fade to 0 between fadeStartFar and fadeOutFar
/// Billboard locked to Y axis.
/// </summary>
public class TMPDistanceFader : MonoBehaviour
{
    public TMP_Text tmp;
    public float fadeStartFar = 8f;
    public float fadeOutFar   = 20f;

    private Camera _cam;
    private Vector3 _baselineLocalPos;
    private Vector3 _baselineScale;
    private Color   _baselineColor;

    void OnEnable()
    {
        if (tmp == null) tmp = GetComponent<TMP_Text>();
        _baselineLocalPos = transform.localPosition;
        _baselineScale    = transform.localScale;
        if (_baselineScale == Vector3.zero) _baselineScale = Vector3.one;
        if (tmp != null) _baselineColor = tmp.color;
    }

    void LateUpdate()
    {
        // Same Camera.main re-resolution pattern as MarkTextDistanceFader —
        // ARSession restart can destroy the cached camera; Unity's overridden
        // == handles the destroyed reference correctly.
        if (_cam == null)
        {
            _cam = Camera.main;
            if (_cam == null) return;
        }
        if (tmp == null) return;

        // ── OTA: scale + height ──
        float scaleMul  = SafePos(Shader.GetGlobalFloat("_CairnGlobalTextScale"));
        float heightMul = SafePos(Shader.GetGlobalFloat("_CairnGlobalTextHeight"));
        transform.localScale = _baselineScale * scaleMul;
        var lp = _baselineLocalPos;
        lp.y = _baselineLocalPos.y * heightMul;
        transform.localPosition = lp;

        Vector3 toCam = _cam.transform.position - transform.position;
        float dist = toCam.magnitude;

        // Billboard, Y-locked.
        Vector3 lookDir = -toCam;
        lookDir.y = 0f;
        if (lookDir.sqrMagnitude > 0.0001f)
            transform.rotation = Quaternion.LookRotation(lookDir, Vector3.up);

        // Distance alpha.
        float a;
        if (dist <= fadeStartFar) a = 1f;
        else if (dist >= fadeOutFar) a = 0f;
        else a = 1f - Mathf.InverseLerp(fadeStartFar, fadeOutFar, dist);

        // OTA alpha multiplier.
        a *= SafePos(Shader.GetGlobalFloat("_CairnGlobalTextAlpha"));
        a = Mathf.Clamp01(a);

        // Write through TMP_Text.color so the change goes through TMP's
        // property block / vertex color path — does NOT mutate the shared
        // TMP atlas material that other rune labels reference.
        var c = _baselineColor;
        c.a = a * _baselineColor.a;
        tmp.color = c;
    }

    private static float SafePos(float v) => v > 0.0001f ? v : 1f;
}
