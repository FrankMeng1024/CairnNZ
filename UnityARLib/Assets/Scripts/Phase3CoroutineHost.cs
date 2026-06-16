// Cairn AR — v0.2.4 Phase 3 Round 7 — Persistent coroutine host
//
// Round 7 audit B BLOCKER #1 fix: PortalSpawner / PendingAnchorRetry
// 启动的 1s/5s/30s ANCHOR-FREE-FLOATING-CHECK coroutine 在用户短停留 plant
// 后退出 AR 时,Unity scene unload / GameObject destroy 触发 coroutine 立即
// 终止 → 30s tick 永不 emit → 飞天根因诊断链断 (用户报飞天但查不到 anchor
// trackingState 演变).
//
// 修法:用一个 DontDestroyOnLoad 的 singleton MonoBehaviour 跑这些诊断
// coroutine。即使 cairn 容器或 spawner 被 destroy,host 仍然活着,
// coroutine 跑完 emit log 才结束。

using System.Collections;
using UnityEngine;
using UnityEngine.XR.ARFoundation;

namespace Cairn.AR
{
    public class Phase3CoroutineHost : MonoBehaviour
    {
        static Phase3CoroutineHost _instance;

        public static Phase3CoroutineHost Instance
        {
            get
            {
                if (_instance == null)
                {
                    var go = new GameObject("Phase3CoroutineHost");
                    DontDestroyOnLoad(go);
                    _instance = go.AddComponent<Phase3CoroutineHost>();
                }
                return _instance;
            }
        }

        /// <summary>
        /// 持久 coroutine: 等 N 秒后检查 ARAnchor.trackingState + pos,
        /// emit v22-PHASE3-ANCHOR-FREE-FLOATING-CHECK / DESTROYED。
        /// 即使原 spawner / cairn container 被 destroy,本 host 仍 alive,
        /// coroutine 跑完 emit。
        /// </summary>
        public void StartAnchorTrackingCheck(string id, ARAnchor anchor, float delay, string path)
        {
            StartCoroutine(CheckAnchorTrackingStateDelayed(id, anchor, delay, path));
        }

        IEnumerator CheckAnchorTrackingStateDelayed(string id, ARAnchor anchor, float delay, string path)
        {
            yield return new WaitForSeconds(delay);
            if (anchor == null)
            {
                UnityLogger.ICritical("v22-PHASE3-ANCHOR-FREE-FLOATING-DESTROYED",
                    $"id={id} path={path} delay={delay:F1}s anchor was destroyed");
                yield break;
            }
            UnityLogger.ICritical("v22-PHASE3-ANCHOR-FREE-FLOATING-CHECK",
                $"id={id} path={path} delay={delay:F1}s state-after-{delay:F0}s={anchor.trackingState} " +
                $"trackableId={anchor.trackableId} pos=({anchor.transform.position.x:F2}," +
                $"{anchor.transform.position.y:F2},{anchor.transform.position.z:F2})");
        }
    }
}
