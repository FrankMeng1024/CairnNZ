using UnityEngine;
using UnityEngine.XR.ARFoundation;

/// <summary>
/// GlobalScanGridController — single world-space "scanning grid" quad
/// rendered while ARSession ≠ SessionTracking (per V2 review of §B.1
/// + §D.12).
///
/// Visible only during AR-init phase. Replaces the old grey blocking
/// overlay with a positive Avatar-style "system is alive" cue.
///
/// Hex grid pattern + outward pulse driven by Cairn/ScanningGridShader
/// reading _Time.y. C# side just toggles enabled state based on
/// ARSession.state and pushes _CairnGlobalScanGridActive uniform.
/// OTA-toggleable via ScanGridEnabled.
/// </summary>
public class GlobalScanGridController : MonoBehaviour
{
    [Header("Wired by SceneSetup")]
    public MeshRenderer gridRenderer;   // child quad with ScanningGridShader
    public Camera arCamera;

    [Header("Distance in front of camera to render the grid")]
    public float forwardDistance = 2.0f;

    private float _pollT;

    void OnEnable()
    {
        if (gridRenderer == null) gridRenderer = GetComponentInChildren<MeshRenderer>();
        if (arCamera == null && Camera.main != null) arCamera = Camera.main;
    }

    void Update()
    {
        if (Time.time - _pollT < 0.2f) return; // 5Hz
        _pollT = Time.time;

        // Visible only when ARSession hasn't reached SessionTracking yet.
        bool active = ARSession.state != ARSessionState.SessionTracking;
        bool otaEnabled = CairnGlobals.Instance == null
            || CairnGlobals.Instance.GetBool("ScanGridEnabled", true);
        bool show = active && otaEnabled;

        if (gridRenderer != null) gridRenderer.enabled = show;
        Shader.SetGlobalFloat("_CairnGlobalScanGridActive", show ? 1f : 0f);
        // Forward OTA pulse Hz + hex size to shader globals. CairnGlobalsExt
        // registry binds ScanGridPulseHzUni → _CairnGlobalScanGridPulseHz
        // and ScanGridHexSizeUni → _CairnGlobalScanGridHexSize, so SetGeneric
        // does Shader.SetGlobalFloat for them on OTA — but only if RN has
        // sent a value. Push defaults from registry on every poll for safety.
        if (CairnGlobals.Instance != null)
        {
            float hz = CairnGlobals.Instance.GetForType(null, "ScanGridPulseHzUni", 0.8f);
            float hex = CairnGlobals.Instance.GetForType(null, "ScanGridHexSizeUni", 0.10f);
            Shader.SetGlobalFloat("_CairnGlobalScanGridPulseHz", hz);
            Shader.SetGlobalFloat("_CairnGlobalScanGridHexSize", hex);
        }

        // Position the grid quad in front of the camera so it's always
        // in view during init (camera-attached behavior without parenting
        // to camera which would lose AR scene anchor).
        if (show && arCamera != null && gridRenderer != null)
        {
            Vector3 fwd = arCamera.transform.forward;
            fwd.y = 0; // keep grid horizontal-facing, no vertical lean
            if (fwd.sqrMagnitude < 0.001f) fwd = Vector3.forward;
            fwd.Normalize();
            gridRenderer.transform.position = arCamera.transform.position + fwd * forwardDistance;
            gridRenderer.transform.rotation = Quaternion.LookRotation(fwd, Vector3.up);
        }
    }
}
