using System.Collections;
using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;
using UnityEngine.XR.Management;

#if UNITY_IOS && !UNITY_EDITOR
using UnityEngine.XR.ARKit;
#endif

/// <summary>
/// v22-WORLDALIGN — Forces ARKit's session worldAlignment to
/// GravityAndHeading at session start.
///
/// Why: ARKit's default alignment is `Gravity`, which gives a deterministic
/// up-axis (-Y = down) but a NON-deterministic horizontal frame — +X / +Z
/// are randomly oriented relative to compass directions, varying per
/// session. This breaks any "cairn at world coordinate X,Z" persistence
/// across re-launches because what was East last session may now be
/// pointing Southwest.
///
/// `GravityAndHeading` aligns the world to compass directions. Apple ARKit
/// documentation defines: +X = True East, -Z = True North (right-handed,
/// matching Cairn's gpsToArkitWorld projection at unityCairnSpawn.ts:121
/// `z = -dN`). Unity ARFoundation passes ARKit world coords through to
/// Unity space transparently for the @azesmway/react-native-unity bridge,
/// so Cairn observes ARKit's right-handed convention. (Note: Unity's own
/// ARWorldAlignment.cs doc-comment uses left-handed +Z=North; that
/// applies to Unity's internal scene-graph but does NOT override ARKit's
/// raw camera/anchor coordinates passed via ARFoundation. Confirmed
/// against Cairn's working Viro-era code which used the same convention.)
///
/// This is the SAME alignment Viro used by default (via the
/// `worldAlignment="GravityAndHeading"` JSX prop on ViroARSceneNavigator).
/// Cairn's GPS-to-AR-world projection math (unityCairnSpawn.ts) assumes
/// these axes; without GravityAndHeading every cairn appears at a randomly
/// rotated bearing each session.
///
/// Pre-requisite: NSLocationWhenInUseUsageDescription must be in
/// Info.plist. Cairn's app.json declares it for GPS tracking, so this is
/// satisfied.
///
/// Lifecycle:
///   1. [DefaultExecutionOrder(-100)] — informational only. ARSession's
///      DefaultExecutionOrder is ARUpdateOrder.k_Session = int.MinValue,
///      so ARSession's Awake/OnEnable always runs FIRST regardless of
///      ARKitSessionInit's order. We rely on ARSession.stateChanged
///      event subscription instead — ARSession's Initialize() coroutine
///      yields before the state hits Ready, giving our OnEnable time to
///      subscribe. This pattern works correctly on iOS + Editor.
///   2. OnEnable subscribes to ARSession.stateChanged.
///   3. On state advancing to Ready (or higher) for the first time, we
///      read the session subsystem, cast to ARKitSessionSubsystem, and
///      set requestedWorldAlignment = GravityAndHeading.
///   4. Yield one frame, read currentWorldAlignment, verify match.
///   5. If mismatch: call ARSession.Reset() once and retry verification.
///      Beyond that we log and proceed — never block session init.
///
/// Idempotency: _attempted gates against multiple Ready transitions
/// (e.g. after OnApplicationPause(false) or ARSession.Reset elsewhere)
/// so we set requestedWorldAlignment exactly once per component lifetime.
///
/// Editor / non-iOS guard: #if UNITY_IOS && !UNITY_EDITOR — Windows
/// editor compiles this as a no-op. The ARKit subsystem types only
/// exist on iOS player builds.
/// </summary>
[DefaultExecutionOrder(-100)]
public class ARKitSessionInit : MonoBehaviour
{
    private const string TAG = "ARKitSessionInit";

    private bool _attempted = false;
    private Coroutine _verifyCo;

    private void OnEnable()
    {
        ARSession.stateChanged += OnStateChanged;
        if (ARSession.state >= ARSessionState.Ready)
        {
            TryApplyAlignment();
        }
    }

    private void OnDisable()
    {
        ARSession.stateChanged -= OnStateChanged;
        if (_verifyCo != null)
        {
            StopCoroutine(_verifyCo);
            _verifyCo = null;
        }
    }

    private void OnStateChanged(ARSessionStateChangedEventArgs args)
    {
        if (args.state >= ARSessionState.Ready)
        {
            TryApplyAlignment();
        }
    }

    private void TryApplyAlignment()
    {
        if (_attempted) return;
        _attempted = true;

#if UNITY_IOS && !UNITY_EDITOR
        try
        {
            ApplyAlignmentIOS(retryCount: 0);
        }
        catch (System.Exception e)
        {
            UnityLogger.E(TAG, "exception while applying worldAlignment", e);
        }
#else
        UnityLogger.IForward(TAG,
            $"[v22-WORLDALIGN] subsystem-unavailable platform={Application.platform}");
#endif
    }

#if UNITY_IOS && !UNITY_EDITOR
    private void ApplyAlignmentIOS(int retryCount)
    {
        var loader = XRGeneralSettings.Instance != null
            && XRGeneralSettings.Instance.Manager != null
                ? XRGeneralSettings.Instance.Manager.activeLoader
                : null;

        XRSessionSubsystem rawSubsys =
            loader != null ? loader.GetLoadedSubsystem<XRSessionSubsystem>() : null;

        if (rawSubsys == null)
        {
            UnityLogger.IForward(TAG,
                "[v22-WORLDALIGN] subsystem-unavailable platform=iOS (loader/subsystem null)");
            return;
        }

        var arkitSubsys = rawSubsys as ARKitSessionSubsystem;
        if (arkitSubsys == null)
        {
            UnityLogger.IForward(TAG,
                $"[v22-WORLDALIGN] cast-failed actualType={rawSubsys.GetType().Name}");
            return;
        }

        arkitSubsys.requestedWorldAlignment = ARWorldAlignment.GravityAndHeading;
        _verifyCo = StartCoroutine(VerifyNextFrame(arkitSubsys, retryCount));
    }

    private IEnumerator VerifyNextFrame(ARKitSessionSubsystem arkitSubsys, int retryCount)
    {
        yield return null;
        _verifyCo = null;

        ARWorldAlignment current;
        try
        {
            current = arkitSubsys.currentWorldAlignment;
        }
        catch (System.Exception e)
        {
            UnityLogger.E(TAG, "currentWorldAlignment getter threw", e);
            yield break;
        }

        bool verified = (current == ARWorldAlignment.GravityAndHeading);

        UnityLogger.IForward(TAG,
            $"[v22-WORLDALIGN] requested=GravityAndHeading current={current} " +
            $"verified={verified.ToString().ToLowerInvariant()} retry={retryCount}");

        if (verified) yield break;

        if (retryCount >= 1)
        {
            UnityLogger.W(TAG,
                $"[v22-WORLDALIGN] retry-exhausted current={current} — proceeding with mismatch");
            yield break;
        }

        UnityLogger.IForward(TAG, "[v22-WORLDALIGN] reset-retry-attempted");

        var arSession = GetComponent<ARSession>();
        if (arSession == null)
        {
            arSession = FindObjectOfType<ARSession>();
        }
        if (arSession == null)
        {
            UnityLogger.W(TAG, "[v22-WORLDALIGN] reset-retry: ARSession not found, abort");
            yield break;
        }

        try
        {
            arSession.Reset();
        }
        catch (System.Exception e)
        {
            UnityLogger.E(TAG, "ARSession.Reset() threw", e);
            yield break;
        }

        arkitSubsys.requestedWorldAlignment = ARWorldAlignment.GravityAndHeading;
        _verifyCo = StartCoroutine(VerifyNextFrame(arkitSubsys, retryCount: 1));
    }
#endif
}
