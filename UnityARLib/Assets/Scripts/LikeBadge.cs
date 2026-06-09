using TMPro;
using UnityEngine;

/// <summary>
/// LikeBadge — per-cairn floating "♥ N" status badge (per cinematic-ar-
/// rebuild.md §F.5).
///
/// TMP SDF text + small heart sprite, billboarded yaw-only via
/// BillboardYaw. Updated when CairnBridge.OnCommunityStateUpdate fires
/// for matching cairn id. Distance-fade and OTA-toggleable.
///
/// PortalSpawner attaches one of these to each cairn at spawn time and
/// sets `cairnId` so this component knows which postMessage payload to
/// listen for.
/// </summary>
public class LikeBadge : MonoBehaviour
{
    public string cairnId;           // assigned by PortalSpawner at spawn
    public TextMeshPro text;          // assigned in prefab/programmatic build
    public Transform iconTransform;   // optional heart sprite quad
    public float fadeNear = 1.5f;
    public float fadeFar = 40f;       // hidden past this; LOD lantern takes over
    public float baseFontSize = 4f;   // TMP fontSize at distance 1m

    private int _helpfulCount;
    private int _reportCount;
    private string _status = "healthy";
    private Camera _cam;
    private MaterialPropertyBlock _mpb;

    void Awake()
    {
        if (text == null) text = GetComponentInChildren<TextMeshPro>();
        if (text != null) text.alignment = TextAlignmentOptions.Center;
    }

    void OnEnable()
    {
        if (Camera.main != null) _cam = Camera.main;
        CairnBridge.OnCommunityStateUpdate += OnState;
        Refresh();
    }

    void OnDisable()
    {
        CairnBridge.OnCommunityStateUpdate -= OnState;
    }

    private void OnState(CairnBridge.CommunityStateUpdate u)
    {
        if (u == null || u.id != cairnId) return;
        _helpfulCount = u.helpful_count;
        _reportCount = u.report_count;
        _status = u.status ?? "healthy";
        Refresh();
    }

    void Update()
    {
        if (_cam == null && Camera.main != null) _cam = Camera.main;
        if (_cam == null || text == null) return;

        // Distance fade
        float dist = Vector3.Distance(_cam.transform.position, transform.position);
        bool otaEnabled = CairnGlobals.Instance == null
            || CairnGlobals.Instance.GetBool("LikeBadgeEnabled", true);
        float distAlpha = otaEnabled ? Mathf.Clamp01(1f - Mathf.InverseLerp(fadeFar * 0.7f, fadeFar, dist)) : 0f;
        if (distAlpha < 0.02f)
        {
            text.gameObject.SetActive(false);
            return;
        }
        text.gameObject.SetActive(true);

        // OTA scale + per-status color
        float scaleMul = CairnGlobals.Instance != null
            ? CairnGlobals.Instance.GetForType(null, "LikeBadgeScale", 1.0f)
            : 1.0f;
        text.fontSize = baseFontSize * scaleMul * Mathf.Clamp(dist * 0.4f, 1f, 4f);

        Color baseCol = CairnGlobals.Instance != null
            ? CairnGlobals.Instance.GetColorForType(null, "LikeBadgeColor", new Color(1, 0.4f, 0.5f, 1f))
            : new Color(1, 0.4f, 0.5f, 1f);
        baseCol.a *= distAlpha;
        text.color = baseCol;
    }

    private void Refresh()
    {
        if (text == null) return;
        // Format: "♥ 12" or "♥ 12 · ⚠ 2" if reported
        string s = $"♥ {_helpfulCount}";
        if (_reportCount > 0) s += $"  ⚠ {_reportCount}";
        text.text = s;
    }
}
