using UnityEngine;

/// <summary>
/// MarkTextDistanceFader v3 — billboard + distance-fade + OTA scale/height.
///
/// Reads two globals each frame:
///   _CairnGlobalTextScale  — multiplier on the visual size (applied via
///                            transform.localScale.xy, preserves baseline
///                            characterSize so the OTA only nudges)
///   _CairnGlobalTextHeight — multiplier on Y position relative to
///                            spawned baseline (1.3m default)
/// Both default to 1.0; if Awake hasn't run, _coalesce-style fallback.
///
/// Distance contract:
///   - Fully visible at ≤ fadeStartFar
///   - Linear fade to 0 between fadeStartFar and fadeOutFar
/// Plus the global _CairnGlobalTextAlpha multiplies the result.
/// Billboard: Y-axis locked.
/// </summary>
public class MarkTextDistanceFader : MonoBehaviour
{
    public TextMesh tm;
    public float fadeFullNear = 1.5f;
    public float fadeStartFar = 8f;
    public float fadeOutFar   = 20f;

    private Camera _cam;
    private Vector3 _baselineLocalPos;
    private Vector3 _baselineScale;

    void OnEnable()
    {
        if (tm == null) tm = GetComponent<TextMesh>();
        _baselineLocalPos = transform.localPosition;
        _baselineScale    = transform.localScale;
        if (_baselineScale == Vector3.zero) _baselineScale = Vector3.one;
    }

    void LateUpdate()
    {
        if (_cam == null) { _cam = Camera.main; if (_cam == null) return; }
        if (tm == null) return;

        // ── OTA: text scale + height ──
        float scaleMul = SafePos(Shader.GetGlobalFloat("_CairnGlobalTextScale"));
        float heightMul = SafePos(Shader.GetGlobalFloat("_CairnGlobalTextHeight"));
        transform.localScale = _baselineScale * scaleMul;
        var lp = _baselineLocalPos;
        // Apply height multiplier on the Y component only.
        lp.y = _baselineLocalPos.y * heightMul;
        transform.localPosition = lp;

        Vector3 toCam = _cam.transform.position - transform.position;
        float dist = toCam.magnitude;

        // Billboard.
        Vector3 lookDir = -toCam;
        lookDir.y = 0f;
        if (lookDir.sqrMagnitude > 0.0001f)
            transform.rotation = Quaternion.LookRotation(lookDir, Vector3.up);

        // Distance alpha.
        float a;
        if (dist <= fadeStartFar) a = 1f;
        else if (dist >= fadeOutFar) a = 0f;
        else a = 1f - Mathf.InverseLerp(fadeStartFar, fadeOutFar, dist);

        // Apply global TextAlpha multiplier.
        a *= SafePos(Shader.GetGlobalFloat("_CairnGlobalTextAlpha"));
        a = Mathf.Clamp01(a);

        var c = tm.color;
        c.a = a;
        tm.color = c;
    }

    private static float SafePos(float v) => v > 0.0001f ? v : 1f;
}
