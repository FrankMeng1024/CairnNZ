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
// 监控周期 (v0.2.4 R2-followup):
//   - drift detection: 每 1 秒检查; sliding-window cap 5 / 分钟 (sub#173 推荐)
//     替换原 5/session 永久 cap (旧设计静默 5min+ 完全无信号)
//   - LIVE-POSE emit: 每 10 秒 emit cairn world pos (准备 v0.2.5 收真机 drift 量级分布)

using System.Collections.Generic;
using UnityEngine;
using UnityEngine.XR.ARFoundation;

namespace Cairn.AR
{
    public class AnchorDriftMonitor : MonoBehaviour
    {
        [SerializeField] float _driftThresholdM = 0.5f;
        [SerializeField] float _singleFrameThresholdM = 0.2f;
        [SerializeField] float _checkIntervalSec = 1.0f;
        // v0.2.4 R2-followup sub#B P1: sliding-window 替换原 5/session 永久 cap
        [SerializeField] int _maxEmitsPerWindow = 5;
        [SerializeField] float _emitWindowSec = 60f;
        // v0.2.4 R2-followup Q3c §5 #1: 10s 周期 LIVE-POSE emit (v0.2.5 真机 drift 数据基础)
        [SerializeField] float _livePoseIntervalSec = 10f;

        string _markerId;
        Vector3 _initialWorldPos;
        Vector3 _lastWorldPos;
        float _lastCheckTime;
        float _lastLivePoseTime;
        readonly Queue<float> _emitTimestamps = new Queue<float>();
        bool _initialized;
        bool _anchorRemovedEmitted;

        public void Init(string markerId)
        {
            _markerId = markerId;
            _initialWorldPos = transform.position;
            _lastWorldPos = _initialWorldPos;
            _lastCheckTime = Time.time;
            _lastLivePoseTime = Time.time;
            _emitTimestamps.Clear();
            _initialized = true;
            _anchorRemovedEmitted = false;
        }

        void Update()
        {
            if (!_initialized) return;

            // v0.2.4 R2-followup: anchor-removed 埋点
            if (!_anchorRemovedEmitted)
            {
                var anchorParent = GetComponentInParent<UnityEngine.XR.ARFoundation.ARAnchor>();
                if (anchorParent == null && transform.parent == null)
                {
                    UnityLogger.IForward("v22-anchor-removed",
                        $"id={_markerId} pos=({transform.position.x:F2},{transform.position.y:F2},{transform.position.z:F2})");
                    _anchorRemovedEmitted = true;
                }
            }

            // v0.2.4 R2-followup: v22-CAIRN-LIVE-POSE 10s 周期 emit (Q3c §5 #1)
            // 这是 v0.2.5 真机收 drift 量级分布的关键数据源,不依赖 drift 是否超阈值
            if (Time.time - _lastLivePoseTime >= _livePoseIntervalSec)
            {
                Vector3 nowPos = transform.position;
                float driftFromInit = Vector3.Distance(nowPos, _initialWorldPos);
                UnityLogger.IForward("v22-CAIRN-LIVE-POSE",
                    $"id={_markerId} now=({nowPos.x:F3},{nowPos.y:F3},{nowPos.z:F3}) initial=({_initialWorldPos.x:F3},{_initialWorldPos.y:F3},{_initialWorldPos.z:F3}) driftM={driftFromInit:F3} sessionAgeSec={Time.time:F1}");
                _lastLivePoseTime = Time.time;
            }

            if (Time.time - _lastCheckTime < _checkIntervalSec) return;

            // sliding-window cap: drop emits older than _emitWindowSec
            float windowStart = Time.time - _emitWindowSec;
            while (_emitTimestamps.Count > 0 && _emitTimestamps.Peek() < windowStart)
            {
                _emitTimestamps.Dequeue();
            }
            bool capReached = _emitTimestamps.Count >= _maxEmitsPerWindow;

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

            if (emit && !capReached)
            {
                UnityLogger.IForward("v22-PLANT-ANCHOR-DRIFT-DETECTED",
                    $"id={_markerId} reason={reason} initial=({_initialWorldPos.x:F2},{_initialWorldPos.y:F2},{_initialWorldPos.z:F2}) now=({now.x:F2},{now.y:F2},{now.z:F2}) emitInWindow={_emitTimestamps.Count + 1}/{_maxEmitsPerWindow} (window={_emitWindowSec}s)");
                _emitTimestamps.Enqueue(Time.time);
            }

            _lastWorldPos = now;
            _lastCheckTime = Time.time;
        }

        // v0.2.4 R2-followup: testable accessor — sub jest/Editor 可独立验证 sliding-window 行为
        public int EmitsInCurrentWindow => _emitTimestamps.Count;
    }
}
