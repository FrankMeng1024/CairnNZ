// Cairn AR — AnchorDriftMonitor (v0.2.4 Part 2 A2.4)
//
// 用户原话: "之前 mark 用 GPS 不是 ARKit world coord → 每次开 app 飘 / 飞天
//          同一次 app 操作:mark 必须在同一点位,手机怎么摆都不动"
// 用户铁律 (v0.2.4): "plant 在哪 cairn 永远在哪". 任何漂移 = 违规.
//
// v0.2.4 R2 修 (sub 抓 self-correct 反 ARKit 设计):
//   先前 R1 让 drift > 阈值时强制 transform.position = _initialWorldPos snap 回去.
//   但 cairn parent 是 ARAnchor, ARKit 持续 SLAM refine anchor pose 让 drift 变小,
//   self-correct 跟 refine 打架: snap 一帧, anchor 又 refine, 又 snap... 永久 tug-of-war.
//   更糟: ARKit 合法 relocalize (e.g. 用户重新进入房间, anchor 30-50cm 修正回真实位置)
//   时 self-correct 把 cairn 推离真实位置, 反而违反用户铁律.
//
// R2 决策: trust ARKit. 这个 monitor 只 emit telemetry, 真有大漂移让 telemetry 上报到
// aliyun debug_snapshots, 让我们看到真实数据再决定怎么修. 真正修法是 "重 attach anchor"
// 不是 "改 transform" — 但需要 v0.2.5 EAS build + 真机数据.
//
// 监控周期: 每 1 秒检查一次, session 内累积 emit cap 5 次 防止 spam.

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
