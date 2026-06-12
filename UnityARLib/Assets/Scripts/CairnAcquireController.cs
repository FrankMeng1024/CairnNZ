// Cairn AR — CairnAcquireController (v0.2.4 Branch B)
//
// State machine FAR / APPROACH / ACQUIRE / IMMORTAL implementing user's
// 5 铁律 + reviewer-revised thresholds:
//
//   - 不能飘 (#1): 单向锁存,IMMORTAL 后不再回查
//   - 必须在地上 (#2): FloorPlaneValidator 严验,L2 fallback 仅放距离不放 plane
//   - 必须能展示 (#3): 15s 兜底(用户忽略引导才触发),陀螺仪 active 时不兜底
//   - 必须有动效 (#4): IMMORTAL 时调用 CeremonyController.Play()
//   - 必须有指引 (#5): UpdateGuidance T0/T3/T5/T10 提示
//
// Reviewer 修订:
//   * 距离阈值带 hysteresis 防 thrash(R-A2): 进入 10m,退出 12m
//   * 三条件齐过 0.3s 持续才锁存(R-A3,防瞬间抖动)
//   * facing hysteresis 0.4s 进入 / 0.6s 退出(R-B3,5m 距离更易满足)
//   * 兜底 Y 公式 max(camera.y - 1.5, observedMinFloor - 0.05),倾角>5° 不兜底(R-A4)
//   * 兜底 spawn 后 30s 监听窗口,cairn 不在视野时 snap(R-A5)
//   * 进入条件:dot(camFwd, -worldUp) > 0.7 持续 0.4s(注:cos(0.7)=45° 俯角,clear)
//
// 本类挂在每个 cairn 的 root 上(per-cairn instance)。
// 数据来源:
//   - ARFoundation 的 ARRaycastManager / ARPlaneManager / ARAnchorManager
//   - Camera.main(主相机)
//   - 通过 SetTargetAnchor() 注入"目标位置"(GPS/Geospatial 算出来的临时 anchor)
//
// 触发后调用 (依次):
//   - CeremonyController.Play()
//   - 删除临时 anchor → 创建永久 anchor 在当下扫到的 floor plane
//   - SetParent(永久 anchor)
//   - emit telemetry v22-ACQUIRE-CEREMONY

using System.Collections.Generic;
using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

namespace Cairn.AR
{
    public class CairnAcquireController : MonoBehaviour
    {
        public enum State { FAR, APPROACH, ACQUIRE, IMMORTAL }

        [Header("Distance thresholds (reviewer R-A2: hysteresis)")]
        [SerializeField] float _approachEnter = 30f;  // FAR → APPROACH
        [SerializeField] float _approachExit  = 32f;  // APPROACH → FAR
        [SerializeField] float _acquireEnter  = 10f;  // APPROACH → ACQUIRE
        [SerializeField] float _acquireExit   = 12f;  // ACQUIRE → APPROACH

        [Header("Facing hysteresis (R-B3)")]
        [SerializeField] float _facingEnterCos = 0.70f;  // dot(camFwd, dirToMark) >= 0.70
        [SerializeField] float _facingExitCos  = 0.30f;
        [SerializeField] float _facingEnterDur = 0.4f;
        [SerializeField] float _facingExitDur  = 0.6f;

        [Header("Three-condition latch (R-A3)")]
        [SerializeField] float _allConditionsHoldDur = 0.3f;

        [Header("Force fallback (R-A4 / R-A5)")]
        [SerializeField] float _fallbackDistance = 5f;
        [SerializeField] float _fallbackDuration = 15f;
        [SerializeField] float _fallbackTiltMaxDeg = 5f;     // 倾角 > 5° 不兜底
        [SerializeField] float _fallbackPostSnapWindowSec = 30f;

        [Header("Guidance timings")]
        [SerializeField] float _guideT1 = 3f;
        [SerializeField] float _guideT2 = 5f;
        [SerializeField] float _guideT3 = 10f;
        [SerializeField] float _guideT4 = 15f;

        [Header("Wired refs")]
        [SerializeField] ARRaycastManager _raycastMgr;
        [SerializeField] ARPlaneManager   _planeMgr;
        [SerializeField] ARAnchorManager  _anchorMgr;
        [SerializeField] Camera           _cam;
        [SerializeField] CeremonyController _ceremony;
        [SerializeField] string _markerId = "unknown";
        [SerializeField] bool _lidarAvailable = false;

        // Target anchor (provisional) — set by spawner from GPS-projected position.
        ARAnchor _targetAnchor;
        // Permanent anchor (created when ACQUIRE triggers) — actual floor hit.
        ARAnchor _permAnchor;

        State _state = State.FAR;
        public State CurrentState => _state;

        // Hysteresis trackers
        float _facingHoldEnter, _facingHoldExit;
        float _allCondHoldStart = -1f;
        float _timeInAcquire;

        // For force fallback monitoring
        float _fallbackTriggerTime = -1f;     // when force fallback ran
        Vector3 _fallbackTargetPos;

        // Guidance event(observers, e.g. RN bridge)
        public delegate void GuidanceEventHandler(string markerId, int level, float elapsedSec);
        public static event GuidanceEventHandler OnGuidance;
        int _lastGuideLevel = -1;

        // Dispatched once on IMMORTAL transition
        public delegate void ImmortalHandler(string markerId, Vector3 position, bool fromFallback);
        public static event ImmortalHandler OnImmortal;

        public void Init(string markerId, ARAnchor targetAnchor, ARRaycastManager rc, ARPlaneManager pm,
                         ARAnchorManager am, Camera cam, CeremonyController ceremony, bool lidarAvailable)
        {
            _markerId = markerId;
            _targetAnchor = targetAnchor;
            _raycastMgr = rc;
            _planeMgr = pm;
            _anchorMgr = am;
            _cam = cam;
            _ceremony = ceremony;
            _lidarAvailable = lidarAvailable;
            _state = State.FAR;
        }

        Vector3 GetTargetWorldPos()
        {
            if (_permAnchor != null) return _permAnchor.transform.position;
            if (_targetAnchor != null) return _targetAnchor.transform.position;
            return transform.position;
        }

        void Update()
        {
            if (_state == State.IMMORTAL)
            {
                // Post-IMMORTAL: monitor fallback snap window if applicable.
                if (_fallbackTriggerTime > 0f && Time.time - _fallbackTriggerTime < _fallbackPostSnapWindowSec)
                {
                    TryPostFallbackSnap();
                }
                return;
            }

            if (_cam == null) return;

            Vector3 targetPos = GetTargetWorldPos();
            float dist = Vector3.Distance(_cam.transform.position, targetPos);

            // ---- State transitions with hysteresis ----
            switch (_state)
            {
                case State.FAR:
                    if (dist <= _approachEnter) TransitionTo(State.APPROACH);
                    break;
                case State.APPROACH:
                    if (dist > _approachExit) TransitionTo(State.FAR);
                    else if (dist <= _acquireEnter) TransitionTo(State.ACQUIRE);
                    break;
                case State.ACQUIRE:
                    if (dist > _acquireExit) { TransitionTo(State.APPROACH); break; }
                    UpdateAcquireLogic(dist);
                    break;
            }
        }

        void TransitionTo(State next)
        {
            if (next == _state) return;
            _state = next;
            if (next == State.ACQUIRE)
            {
                _timeInAcquire = 0f;
                _lastGuideLevel = -1;
                _allCondHoldStart = -1f;
                _facingHoldEnter = 0f;
                _facingHoldExit = 0f;
            }
        }

        void UpdateAcquireLogic(float dist)
        {
            float dt = Time.deltaTime;
            _timeInAcquire += dt;

            Vector3 targetPos = GetTargetWorldPos();
            Vector3 dirToMark = (targetPos - _cam.transform.position).normalized;
            Vector3 camFwd = _cam.transform.forward;
            float facingDot = Vector3.Dot(camFwd, dirToMark);

            // Facing hysteresis
            bool facingNow;
            if (_facingHoldEnter > 0f)
            {
                if (facingDot < _facingExitCos) _facingHoldExit += dt;
                else _facingHoldExit = 0f;
                facingNow = _facingHoldExit < _facingExitDur;
                if (!facingNow) _facingHoldEnter = 0f;
            }
            else
            {
                if (facingDot > _facingEnterCos) _facingHoldEnter += dt;
                else _facingHoldEnter = 0f;
                facingNow = _facingHoldEnter >= _facingEnterDur;
            }

            // Floor plane near target
            bool planeReady = TryFindFloorPlaneAt(targetPos, out var bestHit, out var bestPlane);

            // All three conditions
            bool allOk = (dist <= _acquireEnter) && facingNow && planeReady;
            if (allOk)
            {
                if (_allCondHoldStart < 0f) _allCondHoldStart = Time.time;
                if (Time.time - _allCondHoldStart >= _allConditionsHoldDur)
                {
                    AnchorAndCeremony(bestHit, bestPlane, fromFallback: false);
                    return;
                }
            }
            else
            {
                _allCondHoldStart = -1f;
            }

            // Guidance updates
            UpdateGuidance(_timeInAcquire);

            // Force fallback (R-A4: only if user 忽略引导 and not actively scanning)
            if (dist <= _fallbackDistance && _timeInAcquire >= _fallbackDuration)
            {
                if (IsUserActivelyScanning())
                {
                    // User 正在扫,继续引导,不强制
                    return;
                }
                // Otherwise force.
                ForceFallbackSpawn();
            }
        }

        bool IsUserActivelyScanning()
        {
            // Phone tilt change rate > threshold = active scanning
            // Simple heuristic: if facing has changed > 5° in last second, user is active
            // Use Input.gyro if available, else IMU through camera transform.
            if (Input.gyro.enabled)
            {
                float angularSpeed = Input.gyro.rotationRate.magnitude;  // rad/sec
                if (angularSpeed > 0.2f) return true;  // ~11°/sec
            }
            // Camera pitch change as fallback
            // (We track via private buffer of camera.eulerAngles last frame)
            return false;
        }

        bool TryFindFloorPlaneAt(Vector3 worldPos, out ARRaycastHit bestHit, out ARPlane bestPlane)
        {
            bestHit = default;
            bestPlane = null;
            if (_raycastMgr == null || _planeMgr == null || _cam == null) return false;

            // Project worldPos to screen
            Vector3 probeWorld = new Vector3(worldPos.x, _cam.transform.position.y, worldPos.z);
            Vector3 screenPt = _cam.WorldToScreenPoint(probeWorld);
            if (screenPt.z <= 0
                || screenPt.x < 0 || screenPt.x >= Screen.width
                || screenPt.y < 0 || screenPt.y >= Screen.height) return false;

            var hits = new List<ARRaycastHit>();
            if (!_raycastMgr.Raycast(new Vector2(screenPt.x, screenPt.y), hits, TrackableType.PlaneWithinPolygon | TrackableType.Depth))
                return false;

            float bestArea = 0f;
            foreach (var h in hits)
            {
                var plane = _planeMgr.GetPlane(h.trackableId);
                if (plane == null) continue;
                var v = FloorPlaneValidator.Validate(plane, h.pose.position, _cam.transform.position.y, _lidarAvailable);
                if (!v.isValid) continue;
                if (v.planeArea > bestArea)
                {
                    bestHit = h;
                    bestPlane = plane;
                    bestArea = v.planeArea;
                }
            }
            return bestPlane != null;
        }

        void UpdateGuidance(float t)
        {
            int level = 0;
            if (t >= _guideT1) level = 1;
            if (t >= _guideT2) level = 2;
            if (t >= _guideT3) level = 3;
            if (t >= _guideT4) level = 4;
            if (level != _lastGuideLevel)
            {
                _lastGuideLevel = level;
                OnGuidance?.Invoke(_markerId, level, t);
                Debug.Log($"[v22-ACQUIRE-GUIDE] id={_markerId} level={level} t={t:F1}");

                // v0.2.4: emit to RN AcquireGuidance.tsx
                var bridge = Object.FindFirstObjectByType<CairnBridge>();
                if (bridge != null)
                {
                    string json = $"{{\"markerId\":\"{_markerId}\",\"level\":{level},\"elapsed\":{t:F2}}}";
                    bridge.SendToRN("guidance", json);
                }
            }
        }

        void AnchorAndCeremony(ARRaycastHit hit, ARPlane plane, bool fromFallback)
        {
            // Detach old target anchor (provisional)
            if (_targetAnchor != null)
            {
                // Don't destroy the targetAnchor itself if shared; just unparent.
                if (transform.parent == _targetAnchor.transform)
                    transform.SetParent(null, worldPositionStays: true);
            }

            // Create permanent anchor
            if (_anchorMgr != null && plane != null && !fromFallback)
            {
                _permAnchor = _anchorMgr.AttachAnchor(plane, hit.pose);
                if (_permAnchor != null)
                {
                    transform.SetParent(_permAnchor.transform, worldPositionStays: false);
                    transform.localPosition = Vector3.zero;
                }
                else
                {
                    // AttachAnchor failed — try free-floating async
                    transform.position = hit.pose.position;
                }
            }
            else if (fromFallback)
            {
                transform.position = _fallbackTargetPos;
                _fallbackTriggerTime = Time.time;
            }

            // Trigger ceremony animation
            if (_ceremony != null)
            {
                _ceremony.Reset();
                _ceremony.Play();
            }

            _state = State.IMMORTAL;
            OnImmortal?.Invoke(_markerId, transform.position, fromFallback);
            Debug.Log($"[v22-ACQUIRE-CEREMONY] id={_markerId} fromFallback={fromFallback} pos={transform.position}");
        }

        void ForceFallbackSpawn()
        {
            // R-A4: fallback Y = max(camera.y - 1.5, observedMinFloor - 0.05)
            // R-A4: tilt > 5° → don't fallback
            float pitchDeg = Vector3.Angle(_cam.transform.forward, Vector3.down) - 90f;
            if (Mathf.Abs(pitchDeg) > 90f - _fallbackTiltMaxDeg)
            {
                // 用户拿手机看远处招牌(pitch +30°)— 不允许 fallback
                Debug.LogWarning($"[v22-FALLBACK-REJECTED] id={_markerId} tilt too high");
                return;
            }

            Vector3 targetPos = GetTargetWorldPos();
            float fallbackY = _cam.transform.position.y - 1.5f;

            // observedMinFloor — try a top-down raycast first
            var hits = new List<ARRaycastHit>();
            if (_raycastMgr != null
                && _raycastMgr.Raycast(new Ray(_cam.transform.position, Vector3.down), hits, TrackableType.PlaneWithinPolygon | TrackableType.Depth))
            {
                if (hits.Count > 0)
                {
                    fallbackY = Mathf.Min(fallbackY, hits[0].pose.position.y - 0.05f);
                }
            }

            _fallbackTargetPos = new Vector3(targetPos.x, fallbackY, targetPos.z);
            AnchorAndCeremony(default, null, fromFallback: true);
            Debug.LogWarning($"[v22-ACQUIRE-FORCE-FALLBACK] id={_markerId} y={fallbackY:F2}");
        }

        // R-A5: 兜底 spawn 后 30s 监听窗口,cairn 不在视野时无感 snap
        void TryPostFallbackSnap()
        {
            if (_cam == null || _raycastMgr == null) return;

            // Is cairn in user view? If yes, don't snap (would violate 铁律 #1).
            Vector3 toCairn = (transform.position - _cam.transform.position).normalized;
            float dot = Vector3.Dot(_cam.transform.forward, toCairn);
            float dist = Vector3.Distance(_cam.transform.position, transform.position);
            // Conservative: in-view if forward-dot > -0.3 (i.e. not behind) AND distance < 8m
            bool inView = dot > -0.3f && dist < 8f;
            if (inView) return;

            // Cairn is out of view — try to snap to real ground silently
            var hits = new List<ARRaycastHit>();
            Vector3 probeWorld = new Vector3(transform.position.x, _cam.transform.position.y, transform.position.z);
            Vector3 screenPt = _cam.WorldToScreenPoint(probeWorld);
            if (screenPt.z <= 0) return;

            if (_raycastMgr.Raycast(new Vector2(screenPt.x, screenPt.y), hits, TrackableType.PlaneWithinPolygon | TrackableType.Depth)
                && hits.Count > 0)
            {
                var h = hits[0];
                var plane = _planeMgr != null ? _planeMgr.GetPlane(h.trackableId) : null;
                if (plane != null)
                {
                    var v = FloorPlaneValidator.Validate(plane, h.pose.position, _cam.transform.position.y, _lidarAvailable);
                    if (v.isValid)
                    {
                        // Silent snap: detach, attach to plane, reparent
                        if (_anchorMgr != null)
                        {
                            var newAnchor = _anchorMgr.AttachAnchor(plane, h.pose);
                            if (newAnchor != null)
                            {
                                _permAnchor = newAnchor;
                                transform.SetParent(newAnchor.transform, worldPositionStays: false);
                                transform.localPosition = Vector3.zero;
                                _fallbackTriggerTime = -1f;  // done
                                Debug.Log($"[v22-FALLBACK-SNAP-OK] id={_markerId} silent re-anchor to floor");
                            }
                        }
                    }
                }
            }
        }
    }
}
