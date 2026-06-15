// Cairn AR — CrossSessionGroundSnap (v0.2.4 Block F)
//
// 铁律 #2 实施(最小可行版,不需 ARWorldMap native plugin)。
//
// 行为:
//   1. App 冷启动 → ARSession 进入 Tracking → 启动 5s 倒计时
//   2. 5s 后扫 ARPlaneManager.trackables,找 maxDist 内最大 floor plane
//   3. 枚举所有 IMMORTAL 状态 cairn,如果 |cairn.y - plane.y| > minDeltaY,
//      且 cairn 不在视野内 → SnapToFloorY(plane.center.y)
//   4. emit v22-CROSS-SESSION-SNAP 埋点
//
// OTA 配置(已注册到 CairnGlobalsExt.cs §G.2):
//   - CrossSessionSnapEnabled (bool, default true) kill-switch
//   - CrossSessionSnapDelaySec (1-30, default 5)
//   - CrossSessionSnapMaxDistM (2-30, default 8)
//   - CrossSessionSnapMinDeltaY (0.02-0.5, default 0.10)
//
// 由 CairnBridge 在 ArReady 时通过 EnsureRunning() 自动启动(单例)。
// 不需要手动挂到 GameObject — RuntimeInitializeOnLoadMethod 自动创建持有 GO。

using System.Collections;
using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

namespace Cairn.AR
{
    public class CrossSessionGroundSnap : MonoBehaviour
    {
        static CrossSessionGroundSnap _instance;
        bool _coroutineRunning = false;

        // 第三轮 review BLOCKER #2 修复:
        //   原设计 _ranThisSession 永远 true → 第二个 ARSession (用户后台返回触发新 session)
        //   EnsureRunning 直接 short-circuit return → 跨 session snap 永不再跑
        //   修复策略:每次 EnsureRunning 调用都视为 "新 ARSession 启动事件",重启 snap 流程
        //   (CairnBridge 在 ArReady emit 时调用,所以一次 ArReady → 一次 snap 协程)
        //   _coroutineRunning 防同一 session 内重复 ArReady 重叠 coroutine

        public static void EnsureRunning()
        {
            if (_instance == null)
            {
                var go = new GameObject("CrossSessionGroundSnap");
                DontDestroyOnLoad(go);
                _instance = go.AddComponent<CrossSessionGroundSnap>();
            }
            // v0.2.4 Phase 3 LOG: 每次 ArReady 触发都记录 — 真机看 EnsureRunning 调用次数 + 间隔
            UnityLogger.ICritical("v22-PHASE3-CROSSSNAP-ENSURE-RUNNING",
                $"instance={(_instance != null ? "ok" : "NULL")} " +
                $"coroutineRunning={(_instance != null && _instance._coroutineRunning ? "true" : "false")}");
            // 每次都尝试启动 — 如果 coroutine 还在跑就跳过,否则重启
            _instance.TryStartSnap();
        }

        void TryStartSnap()
        {
            if (_coroutineRunning) return;  // 同一 session ArReady 重叠保护

            var globals = CairnGlobals.Instance;
            if (globals != null && !globals.GetBool("CrossSessionSnapEnabled", true))
            {
                Debug.Log("[v22-CROSS-SESSION-SNAP] disabled by OTA kill-switch");
                return;
            }
            float delaySec = globals != null
                ? globals.GetForType(null, "CrossSessionSnapDelaySec", 5f)
                : 5f;
            _coroutineRunning = true;
            StartCoroutine(SnapAfterDelay(delaySec));
        }

        IEnumerator SnapAfterDelay(float delay)
        {
            yield return new WaitForSeconds(delay);

            // 第三轮 BLOCKER #2 修复:每条退出路径都 reset _coroutineRunning,
            // 让下次 ArReady 能再次启动 snap 流程(用户后台返回触发新 ARSession)
            var globals = CairnGlobals.Instance;
            float maxDist  = globals != null ? globals.GetForType(null, "CrossSessionSnapMaxDistM",  8f)    : 8f;
            float minDelta = globals != null ? globals.GetForType(null, "CrossSessionSnapMinDeltaY", 0.10f) : 0.10f;

            var planeMgr = Object.FindFirstObjectByType<ARPlaneManager>();
            var cam      = Camera.main;

            // v0.2.4 Phase 3 LOG: subagent#2 BLOCKER fix — emit 完整环境快照
            // 真机回来对账:确认 SnapAfterDelay 真触发 + 当前 cairn 状态分布
            // 用户报"重开 app cairn 飞天" 时,如果 snap 没跑或全 skip,这条 log 直接定位
            int totalCairnCount = Object.FindObjectsByType<CairnAcquireController>(FindObjectsSortMode.None).Length;
            int immortalCount = 0;
            int farCount = 0;
            int otherCount = 0;
            foreach (var cAll in Object.FindObjectsByType<CairnAcquireController>(FindObjectsSortMode.None))
            {
                if (cAll == null) continue;
                if (cAll.CurrentState == CairnAcquireController.State.IMMORTAL) immortalCount++;
                else if (cAll.CurrentState == CairnAcquireController.State.FAR) farCount++;
                else otherCount++;
            }
            int planeCountTotal = 0;
            if (planeMgr != null)
            {
                foreach (var _p in planeMgr.trackables) planeCountTotal++;
            }
            UnityLogger.ICritical("v22-PHASE3-CROSSSNAP-INVOKE",
                $"delay={delay:F1}s planeMgr={(planeMgr != null ? "ok" : "NULL")} " +
                $"cam={(cam != null ? "ok" : "NULL")} totalCairns={totalCairnCount} " +
                $"immortal={immortalCount} far={farCount} otherStates={otherCount} " +
                $"planeCountTotal={planeCountTotal} maxDist={maxDist} minDelta={minDelta}");

            if (planeMgr == null || cam == null)
            {
                Debug.LogWarning("[v22-CROSS-SESSION-SNAP] aborted: planeMgr or camera null");
                _coroutineRunning = false;
                yield break;
            }

            // v0.2.4 R2.4 fix:
            //   原算法 = 全场景找 area-largest floor plane → 所有 cairn 用这同一个 Y。
            //   QA-70 抓到:多 plane 时,远但大的 plane 会赢小但贴 cairn 的 plane。
            //   修法 = 先收集所有合法 floor plane,然后**每个 cairn 单独**找 nearest-XZ
            //   的 plane 来 snap。这样每个 cairn 都贴着自己脚下的真实地面,不会被
            //   远处的大 plane 错拉。
            //   单 plane case 退化等价 — 唯一 plane 一定就是 nearest。

            // Pass 1 — 收集 maxDist 内合法 floor planes
            var validPlanes = new System.Collections.Generic.List<ARPlane>();
            foreach (var p in planeMgr.trackables)
            {
                float dist = Vector3.Distance(p.transform.position, cam.transform.position);
                if (dist > maxDist) continue;
                bool lidar = false;  // 保守:走 polygon 路径
                var v = FloorPlaneValidator.Validate(p, p.transform.position, cam.transform.position.y, lidar);
                if (!v.isValid) continue;
                validPlanes.Add(p);
            }
            if (validPlanes.Count == 0)
            {
                Debug.Log("[v22-CROSS-SESSION-SNAP] no valid floor plane found within " + maxDist + "m");
                // v0.2.4 Phase 3 LOG: 无 valid plane 是飞天根因之一(ARSession 重开后 plane 检测慢)
                UnityLogger.ICritical("v22-PHASE3-CROSSSNAP-NO-PLANE",
                    $"planeCountTotal={planeCountTotal} maxDist={maxDist} immortalCount={immortalCount} " +
                    $"reason=ARSession-just-restarted-plane-not-yet-detected-OR-maxDist-too-small");
                _coroutineRunning = false;
                yield break;
            }
            Debug.Log("[v22-CROSS-SESSION-SNAP] found " + validPlanes.Count + " valid floor planes");

            // 枚举 IMMORTAL cairn
            var cairns = Object.FindObjectsByType<CairnAcquireController>(FindObjectsSortMode.None);
            int snapCount = 0;
            float startMs = Time.realtimeSinceStartup * 1000f;
            float maxSnapDeltaY = (globals != null)
                ? globals.GetForType(null, "CrossSessionSnapMaxDeltaY", 1.5f)
                : 1.5f;
            foreach (var c in cairns)
            {
                if (c == null) continue;
                if (c.CurrentState != CairnAcquireController.State.IMMORTAL) continue;

                Vector3 cairnPos = c.transform.position;

                // R2.4: 这个 cairn 单独找 nearest-XZ plane(不用全场景 area-largest)
                // R2.4 sub#B: cross-floor protection (yDelta > maxSnapDeltaY 不 snap)
                // 抽到 PickSnapPlane public helper, case 直接复用 (反 self-licking)
                var pick = PickSnapPlane(validPlanes, cairnPos, minDelta, maxSnapDeltaY);
                if (pick.action == SnapAction.NoPlaneFound) continue;
                if (pick.action == SnapAction.WithinMinDelta) continue;
                if (pick.action == SnapAction.CrossFloorBlocked)
                {
                    Debug.Log($"[v22-CROSS-SESSION-SNAP] skip cairn={GetMarkerId(c)} yDelta={pick.yDelta:F2}m exceeds maxSnapDeltaY={maxSnapDeltaY}m (cross-floor protection)");
                    continue;
                }
                ARPlane nearestPlane = pick.plane;

                float planeY = nearestPlane.center.y;

                // 反 fight:cairn 在视野内不 snap
                Vector3 toCairn = (cairnPos - cam.transform.position).normalized;
                float dot = Vector3.Dot(cam.transform.forward, toCairn);
                float distToCairn = Vector3.Distance(cam.transform.position, cairnPos);
                bool inView = dot > 0.3f && distToCairn < 8f;
                if (inView) continue;

                Vector2 cairnXZ = new Vector2(cairnPos.x, cairnPos.z);
                Vector2 planeXZ = new Vector2(nearestPlane.center.x, nearestPlane.center.z);
                float xzDelta = Vector2.Distance(cairnXZ, planeXZ);

                float oldY = cairnPos.y;
                c.SnapToFloorY(planeY);
                snapCount++;

                // C8 埋点
                if (globals == null || globals.GetBool("AcquireTelemetryEnabled", true))
                {
                    float lat = Time.realtimeSinceStartup * 1000f - startMs;
                    var bridge = Object.FindFirstObjectByType<CairnBridge>();
                    if (bridge != null)
                    {
                        string j = "{\"markerId\":\"" + GetMarkerId(c)
                                + "\",\"oldY\":" + oldY.ToString("F3")
                                + ",\"newY\":" + planeY.ToString("F3")
                                + ",\"xzDelta\":" + xzDelta.ToString("F2")
                                + ",\"latencyMs\":" + lat.ToString("F1") + "}";
                        bridge.SendToRN("v22-CROSS-SESSION-SNAP", j);
                    }
                    Debug.Log("[v22-CROSS-SESSION-SNAP] markerId=" + GetMarkerId(c)
                              + " oldY=" + oldY.ToString("F3") + " newY=" + planeY.ToString("F3")
                              + " xzDelta=" + xzDelta.ToString("F2") + "m"
                              + " picked=nearest-xz");
                }
            }
            Debug.Log("[v22-CROSS-SESSION-SNAP] complete: " + snapCount + "/" + cairns.Length + " snapped");
            _coroutineRunning = false;
        }

        static string GetMarkerId(CairnAcquireController c)
        {
            // markerId 是 private field; 用 GO 名字回退(spawn 时 GO 名一般是 cairn-<id>)
            return c != null ? c.gameObject.name : "unknown";
        }

        // ────────────────────────────────────────────────────────────────
        // R2.4 testable extraction (anti-self-licking).
        //
        // PickSnapPlane: 从 valid floor planes 中找一个 cairn 应该 snap 到的 plane,
        // 同时应用 minDelta + maxSnapDeltaY (cross-floor protection)。
        // 公开 API 让 QA case 真调,而不是把算法复制到 case 自己 simulator。
        // ────────────────────────────────────────────────────────────────

        public enum SnapAction
        {
            ShouldSnap,         // pick.plane 是 nearest-XZ + yDelta 在合法 snap 范围
            NoPlaneFound,       // validPlanes 为空
            WithinMinDelta,     // 离 nearest plane Y 太近,不需 snap
            CrossFloorBlocked,  // yDelta > maxSnapDeltaY,可能跨层 (1F vs 2F),不 snap 防飞天
        }

        public struct SnapPick
        {
            public ARPlane plane;
            public SnapAction action;
            public float yDelta;
            public float xzDistance;
        }

        /// <summary>
        /// Pure decision function: 从 valid floor planes 给定一个 cairn world position,
        /// 决定要 snap 到哪个 plane (R2.4 nearest-XZ + sub#B cross-floor protection)。
        /// 不读 trackables / globals,纯输入 → 输出。
        /// </summary>
        public static SnapPick PickSnapPlane(
            System.Collections.Generic.IList<ARPlane> validPlanes,
            Vector3 cairnPos,
            float minDeltaY,
            float maxSnapDeltaY)
        {
            if (validPlanes == null || validPlanes.Count == 0)
                return new SnapPick { action = SnapAction.NoPlaneFound };

            Vector2 cairnXZ = new Vector2(cairnPos.x, cairnPos.z);
            ARPlane nearestPlane = null;
            float nearestDist = float.MaxValue;
            foreach (var p in validPlanes)
            {
                if (p == null) continue;
                Vector2 pXZ = new Vector2(p.center.x, p.center.z);
                float d = Vector2.Distance(cairnXZ, pXZ);
                if (d < nearestDist) { nearestDist = d; nearestPlane = p; }
            }
            if (nearestPlane == null)
                return new SnapPick { action = SnapAction.NoPlaneFound };

            float yDelta = cairnPos.y - nearestPlane.center.y;
            float absYDelta = Mathf.Abs(yDelta);
            if (absYDelta < minDeltaY)
                return new SnapPick { plane = nearestPlane, action = SnapAction.WithinMinDelta, yDelta = yDelta, xzDistance = nearestDist };
            if (absYDelta > maxSnapDeltaY)
                return new SnapPick { plane = nearestPlane, action = SnapAction.CrossFloorBlocked, yDelta = yDelta, xzDistance = nearestDist };
            return new SnapPick { plane = nearestPlane, action = SnapAction.ShouldSnap, yDelta = yDelta, xzDistance = nearestDist };
        }
    }
}
