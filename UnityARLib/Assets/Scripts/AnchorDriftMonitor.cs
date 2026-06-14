// Cairn AR — AnchorDriftMonitor (v0.2.4 Part 2 A2.4)
//
// 用户原话: "之前 mark 用 GPS 不是 ARKit world coord → 每次开 app 飘 / 飞天
//          同一次 app 操作:mark 必须在同一点位,手机怎么摆都不动"
// 用户铁律 (v0.2.4 cleanup): "plant 在哪 cairn 永远在哪". 任何漂移 = 违规.
//
// 这个组件挂在每个已 anchor 的 cairn container 上,监控 same-session
// 内 anchor world pose 的 frame-to-frame 漂移。ARKit SLAM refine 让 anchor
// 在小范围内调整是正常的(< ~5cm/frame),但如果 frame delta 超过阈值,
// emit v22-PLANT-ANCHOR-DRIFT-DETECTED + **self-correct snap 回 initialWorldPos**.
//
// 触发条件:
//   1. accumulated 漂移 > driftThresholdM (默认 0.5m, 典型 ARKit refine 远小于)
//   2. single-frame 漂移 > singleFrameThresholdM (默认 0.2m, 异常跳变)
//
// v0.2.4 B4-2 self-correct (用户铁律):
//   超过阈值不只是 telemetry 上报, 直接 SetParent 父 anchor 不动 →
//   强制 transform.position = _initialWorldPos. ARKit refine 是 anchor 内部 frame 漂移,
//   把 transform.position 写回 = 拉回 cairn 视觉位置. 真 anchor 重 attach 才能根本修.
//
// 监控周期: 每 1 秒检查一次, session 内累积 emit cap 5 次 防止 spam.
//   correct 不限 cap (用户铁律 cairn 必须不动).

using UnityEngine;
using UnityEngine.XR.ARFoundation;

namespace Cairn.AR
{
    public class AnchorDriftMonitor : MonoBehaviour
    {
        [SerializeField] float _driftThresholdM = 0.5f;
        [SerializeField] float _singleFrameThresholdM = 0.2f;
        [SerializeField] float _checkIntervalSec = 1.0f;
        [SerializeField] int _maxEmitsPerSession = 5;
        // v0.2.4 B4-2: 是否启用 self-correct snap. OTA 可关 (调试用).
        [SerializeField] bool _selfCorrectEnabled = true;

        string _markerId;
        Vector3 _initialWorldPos;
        Vector3 _lastWorldPos;
        float _lastCheckTime;
        int _emitCount;
        int _correctCount;
        bool _initialized;

        public void Init(string markerId)
        {
            _markerId = markerId;
            _initialWorldPos = transform.position;
            _lastWorldPos = _initialWorldPos;
            _lastCheckTime = Time.time;
            _emitCount = 0;
            _correctCount = 0;
            _initialized = true;
        }

        void Update()
        {
            if (!_initialized) return;
            if (Time.time - _lastCheckTime < _checkIntervalSec) return;

            Vector3 now = transform.position;
            float frameDelta = Vector3.Distance(now, _lastWorldPos);
            float totalDrift = Vector3.Distance(now, _initialWorldPos);

            bool driftDetected = false;
            string reason = "";
            if (frameDelta > _singleFrameThresholdM)
            {
                driftDetected = true;
                reason = $"single-frame-jump deltaM={frameDelta:F2}";
            }
            else if (totalDrift > _driftThresholdM)
            {
                driftDetected = true;
                reason = $"accumulated-drift totalM={totalDrift:F2}";
            }

            if (driftDetected)
            {
                // Telemetry (cap 5 per session 防 spam)
                if (_emitCount < _maxEmitsPerSession)
                {
                    UnityLogger.IForward("v22-PLANT-ANCHOR-DRIFT-DETECTED",
                        $"id={_markerId} reason={reason} initial=({_initialWorldPos.x:F2},{_initialWorldPos.y:F2},{_initialWorldPos.z:F2}) now=({now.x:F2},{now.y:F2},{now.z:F2}) correct={_selfCorrectEnabled} emit={_emitCount + 1}/{_maxEmitsPerSession}");
                    _emitCount++;
                }
                // v0.2.4 B4-2 self-correct: 强制把 transform.position 拉回 initialWorldPos.
                // 不限 cap — 用户铁律 cairn 必须不动, 任何 drift 都修.
                if (_selfCorrectEnabled)
                {
                    transform.position = _initialWorldPos;
                    _correctCount++;
                    if (_correctCount % 10 == 1)  // 每 10 次 correct 报一次, 防 log spam
                    {
                        UnityLogger.IForward("v22-PLANT-ANCHOR-DRIFT-CORRECTED",
                            $"id={_markerId} correctCount={_correctCount} reason={reason}");
                    }
                    // correct 完更新 lastWorldPos = initial (避免下次检查再触发 single-frame)
                    _lastWorldPos = _initialWorldPos;
                    _lastCheckTime = Time.time;
                    return;
                }
            }

            _lastWorldPos = now;
            _lastCheckTime = Time.time;
        }
    }
}
