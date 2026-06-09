using UnityEngine;

/// <summary>
/// SpiritHandshake — LineRenderer beam from screen-bottom-center to a
/// targeted cairn (per cinematic-ar-rebuild.md §D.10 kill-shot).
///
/// Triggered by RN postMessage OnHandshakeBeamShow{ id } when aim-locked.
/// Animated noise via Cairn/HandshakeBeamShader (vertical UV scroll for
/// energy flow). Lifecycle: 0.4s draw-out, hold while aim-locked, 0.3s
/// retract on hide. OTA-toggleable via HandshakeBeamEnabled.
/// </summary>
[RequireComponent(typeof(LineRenderer))]
public class SpiritHandshake : MonoBehaviour
{
    private LineRenderer _line;
    private Camera _cam;
    private Transform _target;
    private float _animT; // 0..1 draw-out, 1 hold, 1..0 retract
    private float _direction; // +1 drawing, -1 retracting, 0 idle
    private const float DrawOutSec = 0.4f;
    private const float RetractSec = 0.3f;

    void Awake()
    {
        _line = GetComponent<LineRenderer>();
        _line.useWorldSpace = true;
        _line.positionCount = 2;
        _line.enabled = false;
    }

    void OnEnable()
    {
        if (Camera.main != null) _cam = Camera.main;
        CairnBridge.OnHandshakeBeamShowRequested += OnShow;
        CairnBridge.OnHandshakeBeamHideRequested += OnHide;
    }

    void OnDisable()
    {
        CairnBridge.OnHandshakeBeamShowRequested -= OnShow;
        CairnBridge.OnHandshakeBeamHideRequested -= OnHide;
    }

    private void OnShow(string cairnId)
    {
        if (string.IsNullOrEmpty(cairnId)) return;
        if (CairnGlobals.Instance != null && !CairnGlobals.Instance.GetBool("HandshakeBeamEnabled"))
            return;
        // Look up cairn root by name (PortalSpawner names them "Portal_<id>")
        var go = GameObject.Find($"Portal_{cairnId}");
        if (go == null)
        {
            UnityLogger.W("SpiritHandshake", $"target '{cairnId}' not found");
            return;
        }
        _target = go.transform;
        _direction = +1;
        _line.enabled = true;
    }

    private void OnHide()
    {
        if (_direction == 0 && _animT == 0) return;
        _direction = -1;
    }

    void Update()
    {
        if (_target == null) { _line.enabled = false; return; }
        if (_cam == null) _cam = Camera.main;
        if (_cam == null) return;

        float dt = Time.deltaTime;
        if (_direction > 0)
        {
            _animT += dt / DrawOutSec;
            if (_animT >= 1) { _animT = 1; _direction = 0; }
        }
        else if (_direction < 0)
        {
            _animT -= dt / RetractSec;
            if (_animT <= 0) { _animT = 0; _line.enabled = false; _target = null; return; }
        }

        // Origin: bottom-center of screen, projected 0.6m forward of camera
        Vector3 origin = _cam.ScreenToWorldPoint(
            new Vector3(Screen.width * 0.5f, Screen.height * 0.05f, 0.6f));
        Vector3 destFull = _target.position + Vector3.up * 0.6f;
        Vector3 dest = Vector3.Lerp(origin, destFull, _animT);

        _line.SetPosition(0, origin);
        _line.SetPosition(1, dest);

        // OTA-tunable width (HandshakeBeamWidth)
        float w = CairnGlobals.Instance != null
            ? CairnGlobals.Instance.GetForType(null, "HandshakeBeamWidth", 0.04f)
            : 0.04f;
        _line.startWidth = w;
        _line.endWidth = w * 0.5f;
    }
}
