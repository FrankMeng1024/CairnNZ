// Cairn AR — AnchorDriftMonitor (v0.2.4 Part 2 A2.4)
//
// 用户原话: "之前 mark 用 GPS 不是 ARKit world coord → 每次开 app 飘 / 飞天
//          同一次 app 操作:mark 必须在同一点位,手机怎么摆都不动"
//
// 这个组件挂在每个已 anchor 的 cairn container 上,监控 same-session
// 内 anchor world pose 的 frame-to-frame 漂移。ARKit SLAM refine 让 anchor
// 在小范围内调整是正常的(< ~5cm/frame),但如果 frame delta 超过阈值,
// emit v22-PLANT-ANCHOR-DRIFT-DETECTED,真机 telemetry 对账用。
//
// 触发条件:
//   1. accumulated 漂移 > driftThresholdM (默认 0.5m,典型 ARKit refine 远小于)
//   2. single-frame 漂移 > singleFrameThresholdM (默认 0.2m,异常跳变)
//
// 监控周期:每 1 秒检查一次(不每帧,省 CPU),session 内累积 emit cap 5 次
// 防止 spam。

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

        string _markerId;
        Vector3 _initialWorldPos;
        Vector3 _lastWorldPos;
        float _lastCheckTime;
        int _emitCount;
        bool _initialized;

        public void Init(string markerId)
        {
            _markerId = markerId;
            _initialWorldPos = transform.position;
            _lastWorldPos = _initialWorldPos;
            _lastCheckTime = Time.time;
            _emitCount = 0;
            _initialized = true;
        }

        void Update()
        {
            if (!_initialized) return;
            if (_emitCount >= _maxEmitsPerSession) return;
            if (Time.time - _lastCheckTime < _checkIntervalSec) return;

            Vector3 now = transform.position;
            float frameDelta = Vector3.Distance(now, _lastWorldPos);
            float totalDrift = Vector3.Distance(now, _initialWorldPos);

            bool emit = false;
            string reason = "";
            if (frameDelta > _singleFrameThresholdM)
            {
                emit = true;
                reason = $"single-frame-jump deltaM={frameDelta:F2}";
            }
            else if (totalDrift > _driftThresholdM)
            {
                emit = true;
                reason = $"accumulated-drift totalM={totalDrift:F2}";
            }

            if (emit)
            {
                UnityLogger.IForward("v22-PLANT-ANCHOR-DRIFT-DETECTED",
                    $"id={_markerId} reason={reason} initial=({_initialWorldPos.x:F2},{_initialWorldPos.y:F2},{_initialWorldPos.z:F2}) now=({now.x:F2},{now.y:F2},{now.z:F2}) emit={_emitCount + 1}/{_maxEmitsPerSession}");
                _emitCount++;
            }

            _lastWorldPos = now;
            _lastCheckTime = Time.time;
        }
    }
}
