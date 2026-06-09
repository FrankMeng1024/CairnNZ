using System.Threading;
using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

/// <summary>
/// SpikeAnchorHarness — Spike-1 validation per cinematic-ar-rebuild.md V2.B1.
///
/// Validates AR Foundation 6.0.5 anchor APIs that PortalSpawner Phase 4
/// will rely on:
///   - ARAnchorManager.AttachAnchor(ARPlane, Pose) — synchronous, NOT
///     obsolete in 6.0.5 (verified by reading package source at
///     Library/PackageCache/com.unity.xr.arfoundation@b18f5959dab1).
///   - ARAnchorManager.TryAddAnchorAsync(Pose) — async, returns
///     Awaitable&lt;Result&lt;ARAnchor&gt;&gt;. Replaces removed AddAnchor(Pose).
///
/// Two specific risks this spike validates:
///   (1) async/await interaction with Unity main thread + lifecycle —
///       TryAddAnchorAsync may resolve after the spawning component is
///       destroyed; cancellation must abandon spawn cleanly.
///   (2) ARKit provider behavior on iOS may return Result.IsSuccess()
///       with a delayed-tracking anchor whose transform is identity for
///       the first frame — verify whether parenting is safe immediately.
///
/// This harness compiles into the Editor + Win64 batch build (verified
/// via ShaderTestbedBuilder.BuildWindowsPlayer) to prove API surface.
/// True iOS-runtime validation happens in the Phase 7 EAS build by
/// observing ARDebugOverlay diagnostics emitted by SpikeAnchorReport.
/// </summary>
public class SpikeAnchorHarness : MonoBehaviour
{
    [Header("Wired by SceneSetup or test scene")]
    public ARRaycastManager raycastManager;
    public ARAnchorManager anchorManager;
    public ARPlaneManager planeManager;
    public Camera arCamera;

    private CancellationTokenSource _cts;
    private bool _spikeRan;

    void OnEnable()
    {
        _cts = new CancellationTokenSource();
    }

    void OnDisable()
    {
        // Abandon any in-flight TryAddAnchorAsync.
        try { _cts?.Cancel(); _cts?.Dispose(); } catch { /* ignore */ }
        _cts = null;
    }

    /// <summary>
    /// Trigger the spike — call from a debug menu or after AR-ready.
    /// Logs results via UnityLogger so they surface in ARDebugOverlay.
    /// </summary>
    public async void RunSpike()
    {
        if (_spikeRan) return;
        _spikeRan = true;

        UnityLogger.I("Spike1", "begin");

        // ── Test 1: TryAddAnchorAsync at arbitrary pose (no plane) ──
        Pose pose = new Pose(
            arCamera != null ? arCamera.transform.position + arCamera.transform.forward * 1.0f
                             : Vector3.zero,
            Quaternion.identity);
        try
        {
            // The Awaitable<T> pattern in ARF 6: await directly. No
            // CancellationToken parameter on TryAddAnchorAsync(Pose) in
            // 6.0.5 — cancellation handled by destroying the spawner.
            // We catch OperationCanceledException for parity with future
            // versions that may add a CT overload.
            UnityEngine.XR.ARSubsystems.Result<ARAnchor> result =
                await anchorManager.TryAddAnchorAsync(pose);

            if (result.status.IsSuccess() && result.value != null)
            {
                ARAnchor anchor = result.value;
                Vector3 p = anchor.transform.position;
                UnityLogger.I("Spike1",
                    $"TryAddAnchorAsync OK pose=({p.x:F2},{p.y:F2},{p.z:F2}) " +
                    $"trackingState={anchor.trackingState} " +
                    $"trackableId={anchor.trackableId}");
            }
            else
            {
                UnityLogger.I("Spike1",
                    $"TryAddAnchorAsync NOT-OK status={result.status.statusCode}");
            }
        }
        catch (System.OperationCanceledException)
        {
            UnityLogger.I("Spike1", "TryAddAnchorAsync canceled (expected on disable)");
            return;
        }
        catch (System.Exception e)
        {
            UnityLogger.I("Spike1", $"TryAddAnchorAsync threw: {e.GetType().Name} {e.Message}");
        }

        // ── Test 2: AttachAnchor against a plane (if any detected) ──
        if (planeManager != null)
        {
            ARPlane plane = null;
            foreach (var p in planeManager.trackables)
            {
                if (p.alignment == PlaneAlignment.HorizontalUp)
                {
                    plane = p;
                    break;
                }
            }
            if (plane != null)
            {
                Pose attachPose = new Pose(plane.center, Quaternion.identity);
                ARAnchor attached = anchorManager.AttachAnchor(plane, attachPose);
                if (attached != null)
                {
                    UnityLogger.I("Spike1",
                        $"AttachAnchor OK plane.center=({plane.center.x:F2}," +
                        $"{plane.center.y:F2},{plane.center.z:F2}) " +
                        $"anchorState={attached.trackingState}");
                }
                else
                {
                    UnityLogger.I("Spike1", "AttachAnchor returned null");
                }
            }
            else
            {
                UnityLogger.I("Spike1", "AttachAnchor skipped — no horizontal plane found");
            }
        }

        UnityLogger.I("Spike1", "end");
    }
}
