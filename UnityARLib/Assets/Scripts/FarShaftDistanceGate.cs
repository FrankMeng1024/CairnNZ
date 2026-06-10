using UnityEngine;

/// <summary>
/// FarShaftDistanceGate — runtime distance gate for v199 LightShaft (FarShaft).
///
/// Why: FarShaft is meant for distance-LOD visibility (see distant cairns
/// from 12m+ via the additive light column). At close range (<6m) the
/// 0.6×2.5m additive billboard fills the upper viewport with white,
/// occluding the actual scene — the user-reported "上方白色遮挡".
///
/// Old code (v205): AttachFarShaft spawned the GO unconditionally; the
/// FarShaftMinDist OTA was registered but never consulted.
///
/// New behavior (v206): this component reads FarShaftMinDist OTA every
/// few frames and toggles the renderer enabled flag. Cairn closer than
/// the threshold has its FarShaft hidden; walking away beyond the
/// threshold pops it back in. Cheap (5Hz check, no GC, no per-frame
/// material work).
///
/// OTA: FarShaftMinDist (default 6m, was registered as 12m but never used).
/// </summary>
public class FarShaftDistanceGate : MonoBehaviour
{
    public Renderer shaftRenderer;
    private float _pollT;

    void Awake()
    {
        if (shaftRenderer == null) shaftRenderer = GetComponent<Renderer>();
    }

    void Update()
    {
        // 5Hz poll — cairn distance changes slowly relative to frame rate.
        if (Time.unscaledTime - _pollT < 0.2f) return;
        _pollT = Time.unscaledTime;

        var cam = Camera.main;
        if (cam == null || shaftRenderer == null) return;

        var globals = CairnGlobals.Instance;
        float minDist = globals != null
            ? globals.GetForType(null, "FarShaftMinDist", 6f)
            : 6f;

        float dist = Vector3.Distance(cam.transform.position, transform.position);
        bool shouldRender = dist >= minDist;
        if (shaftRenderer.enabled != shouldRender)
        {
            shaftRenderer.enabled = shouldRender;
        }
    }
}
