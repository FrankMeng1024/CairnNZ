using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;
using System.Collections.Generic;

/// <summary>
/// Three-tier silent ground-Y resolver. The user must NEVER perceive
/// "ARKit failed to find a plane" — instead, cairns spawn instantly at
/// a plausible ground Y and silently lerp upward as ARKit refines.
///
/// Tiers (highest confidence wins):
///   A — real ARPlaneAnchor whose XZ contains the cairn (best)
///   B — ARRaycastQuery(.estimatedPlane) hit (good — within ~1s in
///       textured environments)
///   C — camera.position.y - 1.5m (always available, never blocks)
///
/// The 1.5m hold-height matches Pokémon GO AR+ and Apple Measure
/// heuristics for an upright user. See docs/plans/DS_STRAND_V186_PLAN.md
/// §1.D and research/arkit_silent_fallback_report.md for full analysis.
///
/// API (called by MultiSpawner / CairnBridge):
///   - GetTierC()                — instant fallback Y for spawn
///   - QueryGroundY(world XZ)    — best-tier Y at a given XZ position
///   - RegisterCairn(go, target) — subscribe a cairn to silent updates
///   - UnregisterCairn(go)       — stop tracking
/// </summary>
public class GroundYResolver : MonoBehaviour
{
    [Header("Wired by SceneSetup")]
    public Camera arCamera;
    public ARRaycastManager raycastManager;
    public ARPlaneManager planeManager;

    // Standard "phone held at chest height" assumption — see industry
    // survey. Apple Measure / Pokémon GO use ~1.5m. Reset value documented
    // for OTA-tuning if telemetry shows users hold differently.
    public const float ASSUMED_HOLD_HEIGHT = 1.5f;

    // Lerp speed cap when promoting tier — prevents jarring jumps when
    // a real plane is found 50cm off our Tier C estimate. 1m/s = 1m
    // correction takes 1s, reads as natural settling.
    public const float MAX_LERP_SPEED = 1.0f;

    // Per-cairn state. We track current Y, current tier, and target Y
    // for in-progress lerps.
    private class CairnTrack
    {
        public Transform go;
        public float currentY;
        public float targetY;
        public Tier currentTier;
    }

    public enum Tier { C = 0, B = 1, A = 2 }

    private readonly List<CairnTrack> _tracks = new List<CairnTrack>();
    private readonly List<ARRaycastHit> _raycastHits = new List<ARRaycastHit>();

    /// <summary>
    /// Tier C is always available IF camera transform is valid. Returns
    /// the best Y we can produce right now, instantly, without blocking.
    /// Returns null if camera not yet usable (frame 1 before tracking).
    /// </summary>
    public float? GetTierC()
    {
        if (arCamera == null) return null;
        var p = arCamera.transform.position;
        // Reject the (0,0,0) sentinel that ARKit emits before the first
        // tracked frame. Once tracking starts, position diverges from 0
        // even if user is at the original anchor.
        if (p.sqrMagnitude < 0.0001f) return null;
        return p.y - ASSUMED_HOLD_HEIGHT;
    }

    /// <summary>
    /// Best ground Y at the given world XZ. Tries Tier A (real plane)
    /// first, then Tier B (estimated plane raycast), then Tier C.
    /// Returns the chosen Y and the tier that produced it.
    /// </summary>
    public bool QueryGroundY(Vector3 worldXZ, out float y, out Tier tier)
    {
        // Tier A: scan known plane anchors for one whose XZ contains worldXZ
        if (planeManager != null)
        {
            foreach (var plane in planeManager.trackables)
            {
                if (plane.alignment != PlaneAlignment.HorizontalUp &&
                    plane.alignment != PlaneAlignment.HorizontalDown) continue;
                // Crude AABB containment check on plane's bounds in XZ.
                // ARPlane.center is world space; size is in plane-local XY
                // (which for horizontal planes is XZ in world).
                var c = plane.center;
                var s = plane.size; // X = width, Y = depth (in plane local)
                float halfX = s.x * 0.5f;
                float halfZ = s.y * 0.5f;
                if (Mathf.Abs(worldXZ.x - c.x) <= halfX &&
                    Mathf.Abs(worldXZ.z - c.z) <= halfZ)
                {
                    y = c.y;
                    tier = Tier.A;
                    return true;
                }
            }
        }

        // Tier B: raycast from above worldXZ down, against estimated plane
        if (raycastManager != null && arCamera != null)
        {
            // We need a screen-space query for ARRaycastManager. Project
            // worldXZ-from-above to screen. If off-screen, skip Tier B
            // for this position (estimatedPlane is screen-derived anyway).
            var probeWorld = new Vector3(worldXZ.x, arCamera.transform.position.y + 1f, worldXZ.z);
            var screenPt = arCamera.WorldToScreenPoint(probeWorld);
            if (screenPt.z > 0 &&
                screenPt.x >= 0 && screenPt.x <= Screen.width &&
                screenPt.y >= 0 && screenPt.y <= Screen.height)
            {
                _raycastHits.Clear();
                if (raycastManager.Raycast(new Vector2(screenPt.x, screenPt.y),
                                           _raycastHits,
                                           TrackableType.PlaneEstimated))
                {
                    if (_raycastHits.Count > 0)
                    {
                        y = _raycastHits[0].pose.position.y;
                        tier = Tier.B;
                        return true;
                    }
                }
            }
        }

        // Tier C: always available if camera valid
        var tierC = GetTierC();
        if (tierC.HasValue)
        {
            y = tierC.Value;
            tier = Tier.C;
            return true;
        }

        y = 0f;
        tier = Tier.C;
        return false; // Not even Tier C — caller should defer spawn
    }

    /// <summary>
    /// Register a cairn for ongoing silent ground-Y refinement. The
    /// resolver tracks its world XZ (we re-query each frame), and will
    /// silently lerp the cairn's transform.position.y toward the
    /// best-available Y. Caller passes the cairn's GameObject (we'll
    /// move its transform.position.y).
    /// </summary>
    public void RegisterCairn(Transform cairnTransform)
    {
        if (cairnTransform == null) return;
        // Don't double-register
        for (int i = 0; i < _tracks.Count; i++)
        {
            if (_tracks[i].go == cairnTransform) return;
        }
        _tracks.Add(new CairnTrack
        {
            go = cairnTransform,
            currentY = cairnTransform.position.y,
            targetY = cairnTransform.position.y,
            currentTier = Tier.C, // assume worst tier at register time
        });
    }

    public void UnregisterCairn(Transform cairnTransform)
    {
        for (int i = _tracks.Count - 1; i >= 0; i--)
        {
            if (_tracks[i].go == null || _tracks[i].go == cairnTransform)
            {
                _tracks.RemoveAt(i);
            }
        }
    }

    public void UnregisterAll()
    {
        _tracks.Clear();
    }

    void Update()
    {
        if (_tracks.Count == 0) return;
        float dt = Time.deltaTime;

        // Throttle expensive queries: re-query best tier ~5Hz, lerp every frame.
        // _frameCount is just a local counter; we don't need precision.
        bool requeryThisFrame = (Time.frameCount % 12) == 0;

        for (int i = _tracks.Count - 1; i >= 0; i--)
        {
            var t = _tracks[i];
            if (t.go == null)
            {
                _tracks.RemoveAt(i);
                continue;
            }

            if (requeryThisFrame)
            {
                if (QueryGroundY(t.go.position, out float bestY, out Tier bestTier))
                {
                    // Never demote (e.g., A → B). Only update target if same
                    // or higher tier, OR if same tier but Y has drifted >5cm.
                    bool higher = (int)bestTier > (int)t.currentTier;
                    bool same   = bestTier == t.currentTier &&
                                  Mathf.Abs(bestY - t.targetY) > 0.05f;
                    if (higher || same)
                    {
                        t.targetY = bestY;
                        t.currentTier = bestTier;
                    }
                }
            }

            // Lerp current Y toward target at capped speed (so big jumps
            // don't snap visibly — they settle smoothly).
            float maxStep = MAX_LERP_SPEED * dt;
            float delta = t.targetY - t.currentY;
            if (Mathf.Abs(delta) > 0.001f)
            {
                t.currentY += Mathf.Clamp(delta, -maxStep, maxStep);
                var p = t.go.position;
                p.y = t.currentY;
                t.go.position = p;
            }
        }
    }
}
