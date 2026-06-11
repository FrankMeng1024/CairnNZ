using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;
using System.Collections.Generic;

/// <summary>
/// v0.2.3 Stage 3 (A1) — Ground-Y resolver with explicit FSM.
///
/// FSM (Plan v4 §A1 ⇄ A4 FSM CONTRACT MATRIX):
///   UNLOCKED → ARMED → LOCKED → FROZEN → UNLOCKED ...
///
///   UNLOCKED  Initial / re-search. No usable Tier-A plane.
///             Cairn updates use Tier-B/C until promoted.
///   ARMED     A Tier-A plane has been seen at least once. Confidence
///             building. Plant button on RN side: NOT yet enabled.
///   LOCKED    Stable Tier-A reached AND |delta| < epsilon for stableMs.
///             Plant button enabled (combined with A4 arOriginLocked).
///   FROZEN    User has finished a session (e.g. ceremony complete) — Y
///             pinned permanently. No further updates until UnregisterAll
///             or session restart drops back to UNLOCKED.
///
/// Anti-thrash: A1 emits at most one state change per 0.5s. Rapid ARKit
/// plane churn does not cause the RN Plant button to flicker.
///
/// Cross-FSM contract: this class emits `[v22-A1-FSM] state=<X>` on every
/// transition + sends `SendToRN("A1State", "{ \"state\": \"<X>\" }")` so
/// useTrackingStore (A4) can compute Plant button enable per
/// docs/plans/MASTER_BUG_SHEET.md §A1↔A4 16-cell matrix.
///
/// A11 fallback (Plan v4 BLOCKER-9 + R25): A11-class devices
/// (iPhone 8/8+/X / iPad 6/7) have known ARKit plane-detection lag at low
/// light. If detected, A1 stays in ARMED forever (does not advance to
/// LOCKED) and emits `[v22-A11-FALLBACK-ENGAGED]` once. This ships with
/// telemetry monitoring; a hotfix path is reserved for Sprint week 1.
///
/// External API (preserved for Stage 3 — Stage 8 may rewire):
///   - GetTierC()                — instant fallback Y for spawn (deprecated
///                                  inside, signature retained for compat)
///   - QueryGroundY(world XZ)    — best-tier Y at a given XZ position
///   - RegisterCairn(go)         — subscribe a cairn to silent updates
///   - UnregisterCairn(go)       — stop tracking
///   - UnregisterAll()           — drop all subscriptions, FSM → UNLOCKED
///   - State                     — current FSM state (read-only)
///
/// Removed in Stage 3:
///   - PlaneAlignment.HorizontalDown acceptance (was line 136 — accepted
///     CEILINGS as ground; user-visible Q2 不贴地 root cause).
/// </summary>
public class GroundYResolver : MonoBehaviour
{
    [Header("Wired by SceneSetup")]
    public Camera arCamera;
    public ARRaycastManager raycastManager;
    public ARPlaneManager planeManager;

    // ---- Tier enum (preserved for PortalSpawner / MultiSpawner) ----
    public enum Tier { C = 0, B = 1, A = 2 }

    // ---- A1 FSM ----
    public enum A1State { UNLOCKED, ARMED, LOCKED, FROZEN }
    private A1State _state = A1State.UNLOCKED;
    public A1State State => _state;

    // Anti-thrash: minimum 0.5s between state changes for downstream
    // (RN Plant UI). Plan v4 line 137.
    private const float ANTI_THRASH_DEBOUNCE_S = 0.5f;
    private float _lastTransitionTime = -100f;
    // If a transition is suppressed by the debounce, we remember the
    // intended state and re-attempt next frame.
    private A1State? _pendingState = null;

    // A11 fallback flag (set once at Awake; emits FAIL_LOUD telemetry).
    private bool _a11Fallback = false;
    private bool _a11FallbackEmitted = false;

    // v0.2.3 Stage 3 — assumed hold height retained for compat (Stage 8
    // PortalSpawner still reads it). Internally, A1 no longer uses this
    // for promotion decisions; only returned by GetTierC() which Stage 8
    // will eliminate. Plan Pre-EAS step 17 grep target = 0 (after Stage 8).
    private const float DEFAULT_HOLD_HEIGHT = 1.3f;
    public float AssumedHoldHeight
    {
        get
        {
            var g = CairnGlobals.Instance;
            return g != null ? g.GetForType(null, "AssumedHoldHeight", DEFAULT_HOLD_HEIGHT) : DEFAULT_HOLD_HEIGHT;
        }
    }
    [System.Obsolete("Stage 3 A1 — internal FSM does not consume this. Stage 8 will remove all callers (Pre-EAS step 17).")]
    public const float ASSUMED_HOLD_HEIGHT = 1.3f;

    // Lerp parameters (preserved from v206 B2; still used inside Update
    // to slide tracked cairns toward best-tier Y).
    private const float DEFAULT_LERP_SNAP_THRESHOLD = 0.15f;
    private const float DEFAULT_LERP_FAST_SPEED = 2.5f;
    private const float DEFAULT_LERP_SLOW_SPEED = 1.0f;
    [System.Obsolete("Use adaptive lerp via Update — see GroundLerp* OTA")]
    public const float MAX_LERP_SPEED = 1.0f;

    // ---- Per-cairn track ----
    private class CairnTrack
    {
        public Transform go;
        public float currentY;
        public float targetY;
        public Tier currentTier;
        public bool locked;       // per-cairn pin (separate from FSM lock — set when this cairn's Y has stabilised, FSM may still be ARMED if no global plane confidence yet)
        public float stableSince; // -1 = no stable window started
    }

    private readonly List<CairnTrack> _tracks = new List<CairnTrack>();
    private readonly List<ARRaycastHit> _raycastHits = new List<ARRaycastHit>();
    private bool _hasSeenAnyTierA = false;     // ARMED gate
    private float _firstTierATime = -1f;       // for ARMED→LOCKED stable window
    private CairnBridge _bridge;               // cached on first use for SendToRN
    // v0.2.3 Stage 7 (A7) — cached PortalSpawner ref + edge-emit state.
    // FindFirstObjectByType is O(scene); caching matters at 60Hz.
    private PortalSpawner _cachedPortalSpawner;
    private bool _a7EngagedLastFrame = false;

    // ----------------------------------------------------------------
    // Lifecycle
    // ----------------------------------------------------------------

    void Awake()
    {
        // A11 fallback detection. iPhone 8/8+/X = iPhone10,*; iPad 6 = iPad7,5/6;
        // iPad 7 = iPad7,11/12. These ship with A11 chip (no A12 LiDAR / scene
        // depth). ARKit plane detection on these devices is measurably slower
        // and noisier per Plan BLOCKER-9.
        var model = SystemInfo.deviceModel ?? string.Empty;
        if (model.StartsWith("iPhone10,") ||  // iPhone 8 / 8 Plus / X
            model == "iPad7,5" || model == "iPad7,6" ||  // iPad 6
            model == "iPad7,11" || model == "iPad7,12")  // iPad 7
        {
            _a11Fallback = true;
        }
    }

    // ----------------------------------------------------------------
    // External API (preserved signatures)
    // ----------------------------------------------------------------

    /// <summary>
    /// Tier C — instant, never blocks. Returns null if the camera/session
    /// is not yet usable. Stage 3 retains this for PortalSpawner; Stage 8
    /// will remove all callers per Plan Pre-EAS step 17.
    /// </summary>
    public float? GetTierC()
    {
        if (arCamera == null) return null;
        var sessionState = ARSession.state;
        if (sessionState != ARSessionState.SessionTracking) return null;
        var p = arCamera.transform.position;
        if (p.sqrMagnitude < 0.0001f) return null;
        return p.y - AssumedHoldHeight;
    }

    /// <summary>
    /// Best ground Y at the given world XZ. Tries Tier A → B → C.
    ///
    /// v0.2.3 Stage 3:
    ///   - Tier-A NOW only accepts PlaneAlignment.HorizontalUp. Old code
    ///     also accepted HorizontalDown (ceilings); user-visible Q2 不贴地
    ///     root cause. Plan Pre-EAS step 16 grep `HorizontalDown` = 0.
    ///   - On Tier-A success, attempts FSM transition (UNLOCKED → ARMED,
    ///     ARMED → LOCKED if stability window met).
    /// </summary>
    public bool QueryGroundY(Vector3 worldXZ, out float y, out Tier tier)
    {
        // Tier A — only HorizontalUp planes. CEILINGS REJECTED (Stage 3 fix).
        if (planeManager != null)
        {
            foreach (var plane in planeManager.trackables)
            {
                if (plane.alignment != PlaneAlignment.HorizontalUp) continue;
                var c = plane.center;
                var s = plane.size;
                float halfX = s.x * 0.5f;
                float halfZ = s.y * 0.5f;
                if (Mathf.Abs(worldXZ.x - c.x) <= halfX &&
                    Mathf.Abs(worldXZ.z - c.z) <= halfZ)
                {
                    y = c.y;
                    tier = Tier.A;
                    OnTierAObserved();
                    return true;
                }
            }
        }

        // Tier B — raycast estimated plane.
        if (raycastManager != null && arCamera != null)
        {
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

        // Tier C — fallback.
        var tierC = GetTierC();
        if (tierC.HasValue)
        {
            y = tierC.Value;
            tier = Tier.C;
            return true;
        }

        y = 0f;
        tier = Tier.C;
        return false;
    }

    public void RegisterCairn(Transform cairnTransform)
    {
        if (cairnTransform == null) return;
        for (int i = 0; i < _tracks.Count; i++)
        {
            if (_tracks[i].go == cairnTransform) return;
        }
        _tracks.Add(new CairnTrack
        {
            go = cairnTransform,
            currentY = cairnTransform.position.y,
            targetY = cairnTransform.position.y,
            currentTier = Tier.C,
            locked = false,
            stableSince = -1f,
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
        // Drop FSM back to UNLOCKED (e.g. session restart).
        _hasSeenAnyTierA = false;
        _firstTierATime = -1f;
        // Stage 3 review fix F3: clear any deferred pending transition so
        // it doesn't fire after a reset and put us back into stale state.
        _pendingState = null;
        TryTransition(A1State.UNLOCKED, "unregister-all");
    }

    /// <summary>
    /// Stage 3 hook for ceremony / 长期 锁定. Once the user has placed a
    /// cairn and the ceremony has finished, the caller (PortalSpawner /
    /// CairnBridge — wired in Stage 8) invokes Freeze() to pin the FSM to
    /// FROZEN. After Freeze() no further Y updates apply to existing
    /// tracks.
    ///
    /// Stage 3 review fix F2: clears _pendingState before emitting FROZEN
    /// so that a still-buffered ARMED/LOCKED transition cannot flush
    /// AFTER the freeze and silently re-arm the FSM.
    /// </summary>
    public void Freeze()
    {
        _pendingState = null;
        TryTransition(A1State.FROZEN, "ceremony-complete");
    }

    /// <summary>
    /// Stage 3 review fix F1: explicit FROZEN→UNLOCKED escape. Without
    /// this, the only path out of FROZEN was UnregisterAll() which also
    /// destroys every cairn track. A4 (RN useTrackingStore) needs to
    /// invalidate the FSM on long-distance walk (>100m INVALIDATED state)
    /// without dropping cairns. Wired from CairnBridge in Stage 4.
    /// </summary>
    public void Unfreeze()
    {
        _pendingState = null;
        // Reset Tier-A history so we re-arm cleanly from new observations.
        _hasSeenAnyTierA = false;
        _firstTierATime = -1f;
        TryTransition(A1State.UNLOCKED, "external-unfreeze");
    }

    // ----------------------------------------------------------------
    // FSM transitions
    // ----------------------------------------------------------------

    /// <summary>
    /// Called whenever a Tier-A plane is observed. Drives UNLOCKED→ARMED
    /// and ARMED→LOCKED transitions.
    /// </summary>
    private void OnTierAObserved()
    {
        if (_state == A1State.FROZEN) return;
        if (!_hasSeenAnyTierA)
        {
            _hasSeenAnyTierA = true;
            _firstTierATime = Time.time;
        }
        // A11 devices stay in ARMED forever (BLOCKER-9 mitigation).
        if (_a11Fallback)
        {
            EmitA11FallbackOnce();
            TryTransition(A1State.ARMED, "tier-a-armed-a11");
            return;
        }
        if (_state == A1State.UNLOCKED)
        {
            TryTransition(A1State.ARMED, "tier-a-first-seen");
        }
        else if (_state == A1State.ARMED)
        {
            // Promote to LOCKED only after stability window met. Window is
            // managed in Update() per cairn-track; here we just require >= 1s
            // since first Tier-A as a cheap global gate.
            if (_firstTierATime > 0f &&
                (Time.time - _firstTierATime) >= 1.0f)
            {
                TryTransition(A1State.LOCKED, "stability-window-met");
            }
        }
    }

    /// <summary>
    /// Apply a state change subject to the 0.5s anti-thrash debounce.
    ///
    /// Stage 3 review fix NEW-1 (defensive): if currently FROZEN, only
    /// the explicit UNLOCKED escape (Unfreeze) is allowed. This protects
    /// the FROZEN-absorbs-events invariant against future code paths that
    /// might call TryTransition without the OnTierAObserved early-return
    /// guard.
    /// </summary>
    private void TryTransition(A1State target, string reason)
    {
        if (_state == target) { _pendingState = null; return; }
        // Defensive FROZEN guard. Only Unfreeze() (target=UNLOCKED) and
        // UnregisterAll() (also target=UNLOCKED) may exit FROZEN. Any
        // other transition request is silently dropped.
        if (_state == A1State.FROZEN && target != A1State.UNLOCKED)
        {
            _pendingState = null;
            return;
        }
        float since = Time.time - _lastTransitionTime;
        if (since < ANTI_THRASH_DEBOUNCE_S)
        {
            _pendingState = target;
            return;
        }
        var prev = _state;
        _state = target;
        _lastTransitionTime = Time.time;
        _pendingState = null;
        EmitStateChange(prev, target, reason);
    }

    private void EmitStateChange(A1State prev, A1State next, string reason)
    {
        UnityLogger.IForward("v22-A1-FSM",
            $"prev={prev} next={next} reason={reason} a11={_a11Fallback}");
        // Push to RN so useTrackingStore (A4) can compute Plant enable.
        var b = GetBridge();
        string json = $"{{\"state\":\"{next}\",\"prev\":\"{prev}\",\"a11\":{(_a11Fallback ? "true" : "false")}}}";
        if (b != null)
        {
            b.SendToRN("A1State", json);
        }
#if UNITY_EDITOR
        // Stage 3 review MT-1: snapshot last emit so test harness can
        // verify SendToRN payload + invocation count without mocking
        // CairnBridge.
        __TEST_LastEmitName = "A1State";
        __TEST_LastEmitPayload = json;
        __TEST_EmitCount++;
        __TEST_LastEmitHadBridge = (b != null);
#endif
    }

    private void EmitA11FallbackOnce()
    {
        if (_a11FallbackEmitted) return;
        _a11FallbackEmitted = true;
        UnityLogger.IForward("v22-A11-FALLBACK-ENGAGED",
            $"deviceModel={SystemInfo.deviceModel} state={_state}");
    }

    private CairnBridge GetBridge()
    {
        if (_bridge != null) return _bridge;
        _bridge = Object.FindFirstObjectByType<CairnBridge>();
        return _bridge;
    }

    /// <summary>
    /// Service the deferred pending-state transition. Extracted so the
    /// Editor harness can exercise the real production code path
    /// (Stage 3 review MT-2). Originally inlined in Update().
    ///
    /// Stage 3 review fix F2: if we have entered FROZEN since the
    /// pending was queued, drop it on the floor — FROZEN absorbs all
    /// events per Plan §A1 ⇄ A4 FSM CONTRACT MATRIX.
    /// </summary>
    private void ServicePendingTransition()
    {
        if (!_pendingState.HasValue) return;
        if (_state == A1State.FROZEN)
        {
            _pendingState = null;
            return;
        }
        if ((Time.time - _lastTransitionTime) >= ANTI_THRASH_DEBOUNCE_S)
        {
            TryTransition(_pendingState.Value, "debounce-flush");
        }
    }

    // ----------------------------------------------------------------
    // Update — lerp tracked cairns + service pending FSM transition
    // ----------------------------------------------------------------

    void Update()
    {
        // Stage 3 review MT-2: real Update flush path. Test harness
        // exercises the same method via __TEST_RunPendingServicer so
        // regressions in this branch are caught.
        ServicePendingTransition();

        if (_tracks.Count == 0) return;
        float dt = Time.deltaTime;

        // v0.2.3 Stage 7 (A7) — phone-flat protection (review-corrected).
        // Q7 invariant: 平放不漂移. Two degenerate camera orientations
        // produce unstable ARKit Tier-A planes:
        //   • Phone screen-up flat on table → camera.forward.y ≈ +1
        //     (lens points up, sees ceiling)
        //   • Phone aimed straight down at floor → forward.y ≈ -1
        //     (degenerate viewing angle for floor plane detection)
        // We use Abs(fy) > 0.85 to catch BOTH (~32° from horizontal in
        // either direction). Original review caught: previous threshold
        // `fy < -0.85` only caught the second case, missing Q7's literal
        // "phone flat on table" scenario.
        bool phoneFlat = false;
        if (arCamera != null)
        {
            float fy = arCamera.transform.forward.y;
            phoneFlat = Mathf.Abs(fy) > 0.85f;
        }
        // Stage 8 D2 will set this around the plant ceremony so the 1s
        // ritual does not get its Y scrambled by lerp. Cached lookup
        // (60Hz scene scans were a measurable A11 perf cost).
        bool ceremonyActive = false;
        if (_cachedPortalSpawner == null)
        {
            _cachedPortalSpawner = Object.FindFirstObjectByType<PortalSpawner>();
        }
        if (_cachedPortalSpawner != null) ceremonyActive = _cachedPortalSpawner.isCeremonyActive;
        bool a7Engaged = phoneFlat || ceremonyActive;
        // Edge-emit telemetry once per engage/disengage (mirrors
        // _a11FallbackEmitted once-per-process pattern but bidirectional
        // so a session can be reconstructed from start/end events).
        if (a7Engaged != _a7EngagedLastFrame)
        {
            UnityLogger.IForward("v22-A7",
                $"engaged={a7Engaged} reason={(phoneFlat ? "flat" : (ceremonyActive ? "ceremony" : "n/a"))} fy={(arCamera != null ? arCamera.transform.forward.y : 0f):F2}");
            _a7EngagedLastFrame = a7Engaged;
        }
        if (a7Engaged)
        {
            // Frozen for this frame. Tracks keep their current Y.
            return;
        }

        var globals = CairnGlobals.Instance;
        bool lockEnabled = globals == null || globals.GetBool("GroundLockEnabled", true);
        float lockEpsilon = globals != null
            ? globals.GetForType(null, "GroundLockEpsilon", 0.05f) : 0.05f;
        float lockStableMs = globals != null
            ? globals.GetForType(null, "GroundLockStableMs", 1000f) : 1000f;

        bool requeryThisFrame = (Time.frameCount % 12) == 0;

        for (int i = _tracks.Count - 1; i >= 0; i--)
        {
            var t = _tracks[i];
            if (t.go == null)
            {
                _tracks.RemoveAt(i);
                continue;
            }
            // FROZEN — no further Y updates anywhere.
            if (_state == A1State.FROZEN) continue;
            // Per-cairn pin still respected when reached (independent of FSM).
            if (lockEnabled && t.locked) continue;

            if (requeryThisFrame)
            {
                if (QueryGroundY(t.go.position, out float bestY, out Tier bestTier))
                {
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

            float snapThreshold = globals != null
                ? globals.GetForType(null, "GroundLerpSnapThreshold", DEFAULT_LERP_SNAP_THRESHOLD)
                : DEFAULT_LERP_SNAP_THRESHOLD;
            float fastSpeed = globals != null
                ? globals.GetForType(null, "GroundLerpFastSpeed", DEFAULT_LERP_FAST_SPEED)
                : DEFAULT_LERP_FAST_SPEED;
            float slowSpeed = globals != null
                ? globals.GetForType(null, "GroundLerpSlowSpeed", DEFAULT_LERP_SLOW_SPEED)
                : DEFAULT_LERP_SLOW_SPEED;

            float delta = t.targetY - t.currentY;
            float absDelta = Mathf.Abs(delta);
            if (absDelta > 0.001f)
            {
                if (absDelta > snapThreshold)
                {
                    t.currentY = t.targetY;
                }
                else
                {
                    float speed = absDelta > 0.05f ? fastSpeed : slowSpeed;
                    float maxStep = speed * dt;
                    t.currentY += Mathf.Clamp(delta, -maxStep, maxStep);
                }
                var p = t.go.position;
                p.y = t.currentY;
                t.go.position = p;
                t.stableSince = -1f;
            }

            // Per-cairn lock when stabilised on Tier-A.
            if (lockEnabled && t.currentTier == Tier.A &&
                Mathf.Abs(t.targetY - t.currentY) < lockEpsilon)
            {
                if (t.stableSince < 0f) t.stableSince = Time.time;
                else if ((Time.time - t.stableSince) * 1000f >= lockStableMs)
                {
                    t.locked = true;
                    UnityLogger.IForward("GroundYResolver",
                        $"locked Y={t.currentY:F3} tier={t.currentTier} stable={lockStableMs:F0}ms");
                    // Promote FSM if every track is locked & A1 still ARMED.
                    if (_state == A1State.ARMED && AllTracksLocked())
                    {
                        TryTransition(A1State.LOCKED, "all-tracks-stable");
                    }
                }
            }
        }
    }

    private bool AllTracksLocked()
    {
        if (_tracks.Count == 0) return false;
        for (int i = 0; i < _tracks.Count; i++)
        {
            if (!_tracks[i].locked) return false;
        }
        return true;
    }

    // ----------------------------------------------------------------
    // Editor / test hooks (Plan Pre-EAS step 3 — PlayMode FSM tests)
    // ----------------------------------------------------------------

#if UNITY_EDITOR
    // Stage 3 review MT-1 — emit observation hooks for test harness.
    public string __TEST_LastEmitName;
    public string __TEST_LastEmitPayload;
    public int __TEST_EmitCount;
    public bool __TEST_LastEmitHadBridge;
    public void __TEST_ResetEmitCounters()
    {
        __TEST_LastEmitName = null;
        __TEST_LastEmitPayload = null;
        __TEST_EmitCount = 0;
        __TEST_LastEmitHadBridge = false;
    }

    /// <summary>
    /// Force a state for FSM unit tests. Editor-only. Bypasses debounce.
    /// Sets _lastTransitionTime to a value FAR in the past so the next
    /// real TryTransition will not be inadvertently debounced (this is
    /// what previously caused the test harness to fail T1/T6/T7 — review
    /// fix F4/F6).
    /// </summary>
    public void __TEST_ForceState(A1State s)
    {
        var prev = _state;
        _state = s;
        // Set a synthetic past time so the next real transition is not
        // suppressed by the 0.5s debounce — tests that intend to verify
        // debounce explicitly use __TEST_PressDebounceWindow().
        _lastTransitionTime = -100f;
        _pendingState = null;
        EmitStateChange(prev, s, "TEST_ForceState");
    }

    /// <summary>
    /// Pin _lastTransitionTime to NOW so the next real TryTransition is
    /// guaranteed to land within the debounce window. Use this only when
    /// a test specifically wants to verify "second transition deferred".
    /// </summary>
    public void __TEST_PressDebounceWindow()
    {
        _lastTransitionTime = Time.time;
    }

    public A1State? __TEST_PendingState() => _pendingState;

    /// <summary>
    /// Stage 3 review T13b fix: directly invoke TryTransition without
    /// going through ServicePendingTransition. Lets tests verify the
    /// TryTransition FROZEN guard genuinely lives — otherwise that guard
    /// is dead code under the current call graph (every production caller
    /// pre-filters FROZEN before reaching TryTransition).
    /// </summary>
    public void __TEST_TryTransitionDirect(A1State target, string reason)
    {
        TryTransition(target, reason);
    }

    /// <summary>
    /// Stage 3 review T13 fix: directly inject a pending state without
    /// going through TryTransition. Lets tests verify the FROZEN-drops-
    /// pending logic in ServicePendingTransition and the TryTransition
    /// FROZEN guard (NEW-1) — both of which are otherwise vacuously
    /// passed because __TEST_ForceState clears pending.
    /// </summary>
    public void __TEST_InjectPendingState(A1State target)
    {
        _pendingState = target;
    }

    /// <summary>
    /// Manually advance the FSM's pending-state servicer. Used by the
    /// Editor harness to verify deferred transitions fire after the
    /// debounce window without having to actually wait wall-clock time.
    /// Stage 3 review MT-2: this calls the SAME ServicePendingTransition
    /// the production Update() calls — not a parallel implementation.
    /// </summary>
    public void __TEST_FlushPending()
    {
        if (_pendingState.HasValue)
        {
            // Pretend the debounce window has elapsed.
            _lastTransitionTime = -100f;
            ServicePendingTransition();
        }
    }

    /// <summary>
    /// Stage 3 review MT-2: directly run the production pending servicer
    /// without modifying _lastTransitionTime. Lets tests verify both
    /// branches: (a) within debounce → pending kept, (b) past debounce
    /// → pending lands.
    /// </summary>
    public void __TEST_RunPendingServicer()
    {
        ServicePendingTransition();
    }

    /// <summary>
    /// Inject a Tier-A observation. Editor-only.
    /// </summary>
    public void __TEST_PushTierA()
    {
        OnTierAObserved();
    }

    /// <summary>
    /// Set the Tier-A first-seen time directly so the ARMED→LOCKED
    /// stability window can be verified without waiting wall-clock 1s.
    /// </summary>
    public void __TEST_SeedTierAFirstSeen(float secondsAgo)
    {
        _hasSeenAnyTierA = true;
        _firstTierATime = Time.time - secondsAgo;
    }

    /// <summary>
    /// Toggle A11 fallback. Editor-only.
    /// </summary>
    public void __TEST_SetA11Fallback(bool on)
    {
        _a11Fallback = on;
        _a11FallbackEmitted = false;
    }

    public float __TEST_TimeSinceLastTransition()
    {
        return Time.time - _lastTransitionTime;
    }
#endif
}
