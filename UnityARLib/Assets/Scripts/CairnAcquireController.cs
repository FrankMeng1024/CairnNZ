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
// v0.2.4 Block A 新约束(用户原话):
//   * "用户站在 mark 10m 开外,但是手机的角度射线朝向 mark 所在地面 → 应该展示 mark"
//   * 旧逻辑:dist(camera, mark.GPS) <= 10m 才触发,不满足该需求
//   * 新逻辑:三条件 allOk = (nearByCamera || nearByRayHit) && facingNow && planeReady
//     - nearByRayHit = (rayHitToMarkXZ <= 1.5m) && (dist <= 25m)  // 水平距离防退化
//     - 状态机 entry/exit 也加 ray-hit 通道,否则永远进不到 ACQUIRE
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

        [Header("Block A: ray-hit trigger channel (用户 10m 外但 ray 朝下命中地面)")]
        [SerializeField] bool  _rayHitTriggerEnabled = true;
        [SerializeField] float _rayHitTriggerRadius  = 1.5f;   // hit→mark XZ tolerance (m)
        [SerializeField] float _rayHitMaxDistance    = 25f;    // safety: 防 50m 外指自己脚下也触发

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
        // A6 顺手:L3 提示提前 — ≤3m 停留 3s 触发"扫描周围地面"提示
        [SerializeField] float _guideLingerDist = 3f;
        [SerializeField] float _guideLingerSec  = 3f;

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

        // A6: linger 提示 emit 一次 per ACQUIRE entry
        bool _lingerEmitted = false;

        // A8: pitch fallback for IsUserActivelyScanning(陀螺仪不可用时)
        float _lastCamEulerX = float.NaN;

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

        // Block F: 跨 session re-snap 公开接口 — CrossSessionGroundSnap 调用
        public void SnapToFloorY(float newY)
        {
            Vector3 p = transform.position;
            p.y = newY;
            transform.position = p;
        }

        /// <summary>
        /// Block A 三条件 allOk 算法(纯函数,无 Unity 上下文依赖)。
        /// production code 调,test harness 也调 — 消除 BLOCKER 2 测试自欺。
        /// </summary>
        public static bool ComputeAllOk(
            float dist, bool facingNow, bool planeReady, float rayHitMarkXZ,
            float acquireEnter, float rayHitTriggerRad, float rayHitMaxDist, bool rayHitOn,
            out bool nearByCamera, out bool nearByRayHit)
        {
            nearByCamera = dist <= acquireEnter;
            nearByRayHit = rayHitOn
                        && planeReady
                        && rayHitMarkXZ <= rayHitTriggerRad
                        && dist <= rayHitMaxDist;
            return (nearByCamera || nearByRayHit) && facingNow && planeReady;
        }

        Vector3 GetTargetWorldPos()
        {
            if (_permAnchor != null) return _permAnchor.transform.position;
            if (_targetAnchor != null) return _targetAnchor.transform.position;
            return transform.position;
        }

        // Block B: OTA 助手 — 运行时读 CairnGlobals,fallback 到 SerializeField 默认
        float Cfg(string name, float fallback)
        {
            var g = CairnGlobals.Instance;
            return g != null ? g.GetForType(null, name, fallback) : fallback;
        }
        bool CfgBool(string name, bool fallback)
        {
            var g = CairnGlobals.Instance;
            return g != null ? g.GetBool(name, fallback) : fallback;
        }

        // 第三轮 review HIGH #4 修复:CairnBridge 缓存
        // 8 个 emit 点都调 FindFirstObjectByType 太浪费,改为 lazy-cached
        // null 时记一次 warning 让运维知道 emit 通道断了
        CairnBridge _cachedBridge;
        bool _bridgeWarnLogged;
        CairnBridge Bridge()
        {
            if (_cachedBridge != null) return _cachedBridge;
            _cachedBridge = Object.FindFirstObjectByType<CairnBridge>();
            if (_cachedBridge == null && !_bridgeWarnLogged)
            {
                _bridgeWarnLogged = true;
                Debug.LogWarning("[CairnAcquireController] CairnBridge not found — telemetry emits will be Debug.Log only");
            }
            return _cachedBridge;
        }

        void Update()
        {
            if (_state == State.IMMORTAL)
            {
                // Post-IMMORTAL: monitor fallback snap window if applicable.
                if (_fallbackTriggerTime > 0f && Time.time - _fallbackTriggerTime < Cfg("AcquireFallbackPostSnapWindowSec", _fallbackPostSnapWindowSec))
                {
                    TryPostFallbackSnap();
                }
                return;
            }

            if (_cam == null) return;

            Vector3 targetPos = GetTargetWorldPos();
            float dist = Vector3.Distance(_cam.transform.position, targetPos);

            float approachEnter = Cfg("AcquireApproachEnter", _approachEnter);
            float approachExit  = Cfg("AcquireApproachExit",  _approachExit);
            float acquireEnter  = Cfg("AcquireEnter",         _acquireEnter);
            float acquireExit   = Cfg("AcquireExit",          _acquireExit);
            float rayHitMaxDist = Cfg("AcquireRayHitMaxDistance", _rayHitMaxDistance);
            bool  rayHitOn      = CfgBool("AcquireRayHitTriggerEnabled", _rayHitTriggerEnabled);

            // ---- State transitions with hysteresis ----
            switch (_state)
            {
                case State.FAR:
                    if (dist <= approachEnter) TransitionTo(State.APPROACH);
                    break;
                case State.APPROACH:
                    if (dist > approachExit) TransitionTo(State.FAR);
                    else if (dist <= acquireEnter) TransitionTo(State.ACQUIRE);
                    else if (rayHitOn && dist <= rayHitMaxDist)
                    {
                        // Block A: 用户 10-25m 时若已经朝向 mark,让 ACQUIRE 接管
                        // 重的 plane raycast 在 ACQUIRE 内做(每帧),这里只用 dot 做轻量预检
                        Vector3 dir = (targetPos - _cam.transform.position).normalized;
                        float facingEnterCos = Cfg("AcquireFacingEnterCos", _facingEnterCos);
                        if (Vector3.Dot(_cam.transform.forward, dir) > facingEnterCos)
                            TransitionTo(State.ACQUIRE);
                    }
                    break;
                case State.ACQUIRE:
                    // ray-hit 通道开启时,放宽退出条件(不能因为 dist > 12m 就立刻退出,否则永远触发不了)
                    if (dist > acquireExit && (!rayHitOn || dist > rayHitMaxDist))
                    {
                        TransitionTo(State.APPROACH);
                        break;
                    }
                    UpdateAcquireLogic(dist);
                    break;
            }
        }

        void TransitionTo(State next)
        {
            if (next == _state) return;
            State prev = _state;
            _state = next;
            // v0.2.4 Phase 3 LOG: subagent B Critical #7 fix — FSM transition emit。
            // 用 IForward (5/s 速率限制) 防 cluster plant 100 cairn × 4 transition 风暴。
            // 单 cairn FSM transition 频率低,5/s 限速对于真用户场景足够。
            UnityLogger.IForward("v22-PHASE3-ACQUIRE-FSM-TRANSITION",
                $"id={_markerId} {prev} → {next}");
            if (next == State.ACQUIRE)
            {
                _timeInAcquire = 0f;
                _lastGuideLevel = -1;
                _allCondHoldStart = -1f;
                _facingHoldEnter = 0f;
                _facingHoldExit = 0f;
                _lingerEmitted = false;
                if (_cam != null) _lastCamEulerX = _cam.transform.eulerAngles.x;
            }

            // Block C: emit v22-ACQUIRE-STATE
            if (CfgBool("AcquireTelemetryEnabled", true))
            {
                float dist = (_cam != null) ? Vector3.Distance(_cam.transform.position, GetTargetWorldPos()) : -1f;
                Debug.Log($"[v22-ACQUIRE-STATE] id={_markerId} from={prev} to={next} dist={dist:F2}");
                var bridge = Bridge();
                if (bridge != null)
                {
                    string json = $"{{\"markerId\":\"{_markerId}\",\"from\":\"{prev}\",\"to\":\"{next}\",\"dist\":{dist:F2},\"tInAcquire\":{_timeInAcquire:F2}}}";
                    bridge.SendToRN("v22-ACQUIRE-STATE", json);
                }
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

            float facingEnterCos = Cfg("AcquireFacingEnterCos", _facingEnterCos);
            float facingExitCos  = Cfg("AcquireFacingExitCos",  _facingExitCos);
            float facingEnterDur = Cfg("AcquireFacingEnterDur", _facingEnterDur);
            float facingExitDur  = Cfg("AcquireFacingExitDur",  _facingExitDur);

            // Facing hysteresis
            bool facingNow;
            if (_facingHoldEnter > 0f)
            {
                if (facingDot < facingExitCos) _facingHoldExit += dt;
                else _facingHoldExit = 0f;
                facingNow = _facingHoldExit < facingExitDur;
                if (!facingNow) _facingHoldEnter = 0f;
            }
            else
            {
                if (facingDot > facingEnterCos) _facingHoldEnter += dt;
                else _facingHoldEnter = 0f;
                facingNow = _facingHoldEnter >= facingEnterDur;
            }

            // Floor plane near target
            bool planeReady = TryFindFloorPlaneAt(targetPos, out var bestHit, out var bestPlane, out float rayHitMarkXZ, out float bestPlaneArea);

            // Block A: 三条件 — nearByCamera || nearByRayHit
            float acquireEnter      = Cfg("AcquireEnter",                 _acquireEnter);
            float rayHitTriggerRad  = Cfg("AcquireRayHitTriggerRadius",   _rayHitTriggerRadius);
            float rayHitMaxDist     = Cfg("AcquireRayHitMaxDistance",     _rayHitMaxDistance);
            bool  rayHitOn          = CfgBool("AcquireRayHitTriggerEnabled", _rayHitTriggerEnabled);

            // BLOCKER 2 fix: 抽到 public static 方法,production + test 用同一份算法
            bool nearByCamera, nearByRayHit;
            bool allOk = ComputeAllOk(
                dist, facingNow, planeReady, rayHitMarkXZ,
                acquireEnter, rayHitTriggerRad, rayHitMaxDist, rayHitOn,
                out nearByCamera, out nearByRayHit);

            float allHoldDur = Cfg("AcquireAllCondHoldDur", _allConditionsHoldDur);
            if (allOk)
            {
                if (_allCondHoldStart < 0f)
                {
                    _allCondHoldStart = Time.time;
                    // Block C: emit v22-ACQUIRE-LATCH-PROGRESS(三条件齐时刻)
                    if (CfgBool("AcquireTelemetryEnabled", true))
                    {
                        Debug.Log($"[v22-ACQUIRE-LATCH-PROGRESS] id={_markerId} rayHitMarkXZ={rayHitMarkXZ:F2} facingDot={facingDot:F2} planeArea={bestPlaneArea:F2} dist={dist:F2}");
                        var bridge = Bridge();
                        if (bridge != null)
                        {
                            string j = $"{{\"markerId\":\"{_markerId}\",\"rayHitMarkXZ\":{rayHitMarkXZ:F2},\"facingDot\":{facingDot:F2},\"planeArea\":{bestPlaneArea:F2},\"dist\":{dist:F2}}}";
                            bridge.SendToRN("v22-ACQUIRE-LATCH-PROGRESS", j);
                        }
                    }
                }
                if (Time.time - _allCondHoldStart >= allHoldDur)
                {
                    // Block C: emit v22-ACQUIRE-TRIGGER 在 AnchorAndCeremony 之前
                    string channel = nearByCamera ? "byCamera" : "byRayHit";
                    if (CfgBool("AcquireTelemetryEnabled", true))
                    {
                        Debug.Log($"[v22-ACQUIRE-TRIGGER] id={_markerId} channel={channel} rayHitMarkXZ={rayHitMarkXZ:F2} planeArea={bestPlaneArea:F2} facingDot={facingDot:F2} dist={dist:F2} t={_timeInAcquire:F2}");
                        var bridge = Bridge();
                        if (bridge != null)
                        {
                            string j = $"{{\"markerId\":\"{_markerId}\",\"channel\":\"{channel}\",\"rayHitMarkXZ\":{rayHitMarkXZ:F2},\"planeArea\":{bestPlaneArea:F2},\"facingDot\":{facingDot:F2},\"dist\":{dist:F2},\"tFromAcquireEntry\":{_timeInAcquire:F2}}}";
                            bridge.SendToRN("v22-ACQUIRE-TRIGGER", j);
                        }
                    }
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

            // A6: linger 提示 — ≤3m 停留 3s emit 一次
            float lingerDist = Cfg("AcquireGuideLingerDist", _guideLingerDist);
            float lingerSec  = Cfg("AcquireGuideLingerSec",  _guideLingerSec);
            if (!_lingerEmitted && dist <= lingerDist && _timeInAcquire >= lingerSec)
            {
                _lingerEmitted = true;
                if (CfgBool("AcquireTelemetryEnabled", true))
                {
                    Debug.Log($"[v22-ACQUIRE-LINGER] id={_markerId} dist={dist:F2} elapsed={_timeInAcquire:F2}");
                    var bridge = Bridge();
                    if (bridge != null)
                    {
                        string j = $"{{\"markerId\":\"{_markerId}\",\"dist\":{dist:F2},\"elapsed\":{_timeInAcquire:F2}}}";
                        bridge.SendToRN("v22-ACQUIRE-LINGER", j);
                    }
                }
            }

            // Force fallback (R-A4: only if user 忽略引导 and not actively scanning)
            float fallbackDist = Cfg("AcquireFallbackDistance", _fallbackDistance);
            float fallbackDur  = Cfg("AcquireFallbackDuration", _fallbackDuration);
            if (dist <= fallbackDist && _timeInAcquire >= fallbackDur)
            {
                if (IsUserActivelyScanning())
                {
                    return;
                }
                ForceFallbackSpawn();
            }
        }

        // A8: 完成 pitch fallback — 陀螺仪不可用时用相机 eulerX 变化率检测
        // v0.2.4 Phase 3 LOG: subagent A BLOCKER fix — 真机 25-30fps 帧间噪声可能误触发,
        // 加 emit 看 false positive。0.5s 节流防风暴。
        // Round 3 fix: 改 static 全局节流(原 instance field 100 cairn cluster 时仍能 200/s)
        static float _phase3LastA8EmitTimeStatic = -1f;
        bool IsUserActivelyScanning()
        {
            // Phone tilt change rate > threshold = active scanning
            if (Input.gyro.enabled)
            {
                float angularSpeed = Input.gyro.rotationRate.magnitude;  // rad/sec
                if (angularSpeed > 0.2f) return true;  // ~11°/sec
            }

            // A8 fallback: 相机 pitch (eulerX) 变化率 > 5°/s 视为 active scanning
            if (_cam != null && Time.deltaTime > 0f)
            {
                float currentEulerX = _cam.transform.eulerAngles.x;
                if (!float.IsNaN(_lastCamEulerX))
                {
                    float pitchDelta = Mathf.DeltaAngle(_lastCamEulerX, currentEulerX);
                    _lastCamEulerX = currentEulerX;
                    // pitchDelta 单位=度, Time.deltaTime 单位=秒, 阈值 5°/s
                    float pitchRateDegPerSec = Mathf.Abs(pitchDelta) / Time.deltaTime;
                    // v0.2.4 Phase 3 LOG: 边界值 emit (3-7°/s 区间) 看 false positive 频率
                    // 0.5s 节流防风暴
                    if (pitchRateDegPerSec >= 3f && pitchRateDegPerSec <= 7f &&
                        Time.time - _phase3LastA8EmitTimeStatic > 0.5f)
                    {
                        UnityLogger.ICritical("v22-PHASE3-A8-PITCH-BOUNDARY",
                            $"id={_markerId} pitchRateDegPerSec={pitchRateDegPerSec:F1} dt={Time.deltaTime:F3} fps={1f/Time.deltaTime:F1} thresh=5.0");
                        _phase3LastA8EmitTimeStatic = Time.time;
                    }
                    if (pitchRateDegPerSec > 5f)
                        return true;
                }
                else
                {
                    _lastCamEulerX = currentEulerX;
                }
            }
            return false;
        }

        // Block A: 签名加 hitToMarkXZ + bestPlaneArea 输出
        bool TryFindFloorPlaneAt(Vector3 worldPos, out ARRaycastHit bestHit, out ARPlane bestPlane, out float hitToMarkXZ, out float bestPlaneArea)
        {
            bestHit = default;
            bestPlane = null;
            hitToMarkXZ = float.MaxValue;
            bestPlaneArea = 0f;
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
                    bestPlaneArea = v.planeArea;
                    // Block A: 计算 hit→mark XZ 水平距离
                    Vector2 hitXZ  = new Vector2(h.pose.position.x, h.pose.position.z);
                    Vector2 markXZ = new Vector2(worldPos.x, worldPos.z);
                    hitToMarkXZ = Vector2.Distance(hitXZ, markXZ);
                }
            }
            return bestPlane != null;
        }

        void UpdateGuidance(float t)
        {
            int level = 0;
            if (t >= Cfg("AcquireGuideT1", _guideT1)) level = 1;
            if (t >= Cfg("AcquireGuideT2", _guideT2)) level = 2;
            if (t >= Cfg("AcquireGuideT3", _guideT3)) level = 3;
            if (t >= Cfg("AcquireGuideT4", _guideT4)) level = 4;
            if (level != _lastGuideLevel)
            {
                _lastGuideLevel = level;
                OnGuidance?.Invoke(_markerId, level, t);
                Debug.Log($"[v22-ACQUIRE-GUIDE] id={_markerId} level={level} t={t:F1}");

                // v0.2.4: emit to RN AcquireGuidance.tsx
                var bridge = Bridge();
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
                if (transform.parent == _targetAnchor.transform)
                    transform.SetParent(null, worldPositionStays: true);
            }

            // Block C: 测量 anchor 创建延迟 + 失败原因
            float anchorStartMs = Time.realtimeSinceStartup * 1000f;
            string anchorReason = "ok";
            bool anchorOk = false;

            // Create permanent anchor
            if (_anchorMgr != null && plane != null && !fromFallback)
            {
                _permAnchor = _anchorMgr.AttachAnchor(plane, hit.pose);
                if (_permAnchor != null)
                {
                    transform.SetParent(_permAnchor.transform, worldPositionStays: false);
                    transform.localPosition = Vector3.zero;
                    anchorOk = true;
                }
                else
                {
                    // AttachAnchor failed — fallback to free-floating
                    transform.position = hit.pose.position;
                    anchorReason = "attach-returned-null";
                }
            }
            else if (fromFallback)
            {
                transform.position = _fallbackTargetPos;
                _fallbackTriggerTime = Time.time;
                anchorReason = "fallback-no-plane";
            }
            else
            {
                anchorReason = (plane == null) ? "no-plane" : "no-anchor-mgr";
            }

            float anchorLatencyMs = Time.realtimeSinceStartup * 1000f - anchorStartMs;
            if (CfgBool("AcquireTelemetryEnabled", true))
            {
                Debug.Log($"[v22-ACQUIRE-ANCHOR] id={_markerId} ok={anchorOk} latencyMs={anchorLatencyMs:F1} reason={anchorReason}");
                var bridge = Bridge();
                if (bridge != null)
                {
                    string j = $"{{\"markerId\":\"{_markerId}\",\"ok\":{(anchorOk?"true":"false")},\"latencyMs\":{anchorLatencyMs:F1},\"reason\":\"{anchorReason}\"}}";
                    bridge.SendToRN("v22-ACQUIRE-ANCHOR", j);
                }
            }

            // Trigger ceremony animation
            if (_ceremony != null)
            {
                _ceremony.Reset();
                _ceremony.Play();
                StartCoroutine(EmitCeremonyDoneAfter(_ceremony.TotalDuration, fromFallback));
            }

            _state = State.IMMORTAL;
            // v0.2.4 Phase 3 LOG: subagent A BLOCKER fix — IMMORTAL ≠ has anchor parent。
            // AnchorAndCeremony 失败时 transform.parent 可能是 null 或非 ARAnchor。
            // GroundYResolver 检查 ARAnchor parent 跳过 lerp,如果没 anchor parent 就 lerp = 飞天根因。
            // 真机回来对账,如果 immortal_has_anchor_parent=false 多就是这个 bug。
            var parentAnchor = transform.parent != null ? transform.parent.GetComponent<UnityEngine.XR.ARFoundation.ARAnchor>() : null;
            UnityLogger.ICritical("v22-PHASE3-IMMORTAL-TRANSITION",
                $"id={_markerId} fromFallback={fromFallback} immortal_has_anchor_parent={(parentAnchor != null)} " +
                $"parent_name={(transform.parent != null ? transform.parent.name : "NULL")} " +
                $"pos=({transform.position.x:F2},{transform.position.y:F2},{transform.position.z:F2})");
            OnImmortal?.Invoke(_markerId, transform.position, fromFallback);
            Debug.Log($"[v22-ACQUIRE-CEREMONY] id={_markerId} fromFallback={fromFallback} pos={transform.position}");
        }

        // Block C: ceremony 播放完成埋点
        System.Collections.IEnumerator EmitCeremonyDoneAfter(float seconds, bool fromFallback)
        {
            yield return new WaitForSeconds(seconds);
            if (CfgBool("AcquireTelemetryEnabled", true))
            {
                Vector3 p = transform.position;
                Debug.Log($"[v22-CEREMONY-DONE] id={_markerId} pos=({p.x:F2},{p.y:F2},{p.z:F2}) fromFallback={fromFallback}");
                var bridge = Bridge();
                if (bridge != null)
                {
                    string j = $"{{\"markerId\":\"{_markerId}\",\"atPos\":[{p.x:F2},{p.y:F2},{p.z:F2}],\"fromFallback\":{(fromFallback?"true":"false")}}}";
                    bridge.SendToRN("v22-CEREMONY-DONE", j);
                }
            }
        }

        void ForceFallbackSpawn()
        {
            // R-A4: fallback Y = max(camera.y - 1.5, observedMinFloor - 0.05)
            // R-A4: tilt > 5° → don't fallback
            float fallbackTiltMax = Cfg("AcquireFallbackTiltMaxDeg", _fallbackTiltMaxDeg);
            float pitchDeg = Vector3.Angle(_cam.transform.forward, Vector3.down) - 90f;
            if (Mathf.Abs(pitchDeg) > 90f - fallbackTiltMax)
            {
                Debug.LogWarning($"[v22-FALLBACK-REJECTED] id={_markerId} tilt too high");
                return;
            }

            Vector3 targetPos = GetTargetWorldPos();
            // V4.13 G2.1 (G1.1 Root Cause #2 修):raycast 优先,1.5m 持机高度仅最后兜底
            // 旧逻辑:fallbackY = camera.y - 1.5 然后 Min(...,hit.y-0.05) → 没 raycast hit 时
            // 直接用持机高度,斜坡/蹲下/举高时错 0.2-0.8m,用户原话"离地一段距离"根因
            // 新逻辑:raycast hit + FloorPlaneValidator pass → 用 hit.y(权威)
            //         没 hit/没 pass → 才回退 camera.y - 1.5(并埋点 tier=heuristic)
            float fallbackY = float.NaN;
            string fallbackTier = "heuristic-camera-minus-1.5";

            // A7: observedMinFloor — top-down raycast, 但**必须经过 FloorPlaneValidator**
            // (铁律 #1 修订:L2 仅放距离不放 plane)
            var hits = new List<ARRaycastHit>();
            if (_raycastMgr != null
                && _raycastMgr.Raycast(new Ray(_cam.transform.position, Vector3.down), hits, TrackableType.PlaneWithinPolygon | TrackableType.Depth))
            {
                if (hits.Count > 0)
                {
                    var plane = _planeMgr != null ? _planeMgr.GetPlane(hits[0].trackableId) : null;
                    if (plane != null)
                    {
                        var v = FloorPlaneValidator.Validate(plane, hits[0].pose.position, _cam.transform.position.y, _lidarAvailable);
                        if (v.isValid)
                        {
                            // 通过 FloorPlaneValidator 的 raycast hit = Tier-A 权威 ground Y
                            fallbackY = hits[0].pose.position.y;
                            fallbackTier = "raycast-hit-floor-validated";
                        }
                    }
                    else if (_planeMgr == null)
                    {
                        // Depth-only hit (LiDAR / iOS Depth API) — 无 plane 但 hit 真
                        // pose,信任度高于 camera-1.5 启发
                        fallbackY = hits[0].pose.position.y;
                        fallbackTier = "raycast-hit-depth";
                    }
                }
            }

            // Tier-C 最后兜底:raycast 完全失败才用持机高度启发
            if (float.IsNaN(fallbackY))
            {
                fallbackY = _cam.transform.position.y - 1.5f;
                fallbackTier = "heuristic-camera-minus-1.5";
            }
            // V4.13 G2.5 埋点:ground Y 来源 tier 真机对账
            UnityLogger.IForward("v22-GROUND-Y-SOURCE",
                $"id={_markerId} tier={fallbackTier} y={fallbackY:F2} camY={_cam.transform.position.y:F2} delta={(_cam.transform.position.y - fallbackY):F2}");

            _fallbackTargetPos = new Vector3(targetPos.x, fallbackY, targetPos.z);

            // Block C: emit v22-ACQUIRE-L2 (兜底触发埋点)
            if (CfgBool("AcquireTelemetryEnabled", true))
            {
                bool gyroActive = IsUserActivelyScanning();
                Debug.LogWarning($"[v22-ACQUIRE-L2] id={_markerId} elapsed={_timeInAcquire:F2} userActivelyScanning={gyroActive} tiltDeg={pitchDeg:F1} fallbackY={fallbackY:F2}");
                var bridge = Bridge();
                if (bridge != null)
                {
                    string j = $"{{\"markerId\":\"{_markerId}\",\"elapsed\":{_timeInAcquire:F2},\"userActivelyScanning\":{(gyroActive?"true":"false")},\"tiltDeg\":{pitchDeg:F1},\"fallbackY\":{fallbackY:F2}}}";
                    bridge.SendToRN("v22-ACQUIRE-L2", j);
                }
            }

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
                        if (_anchorMgr != null)
                        {
                            var newAnchor = _anchorMgr.AttachAnchor(plane, h.pose);
                            if (newAnchor != null)
                            {
                                _permAnchor = newAnchor;
                                transform.SetParent(newAnchor.transform, worldPositionStays: false);
                                transform.localPosition = Vector3.zero;
                                _fallbackTriggerTime = -1f;
                                Debug.Log($"[v22-FALLBACK-SNAP-OK] id={_markerId} silent re-anchor to floor");
                            }
                        }
                    }
                }
            }
        }
    }
}
