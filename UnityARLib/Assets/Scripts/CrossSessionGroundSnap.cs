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
            if (planeMgr == null || cam == null)
            {
                Debug.LogWarning("[v22-CROSS-SESSION-SNAP] aborted: planeMgr or camera null");
                _coroutineRunning = false;
                yield break;
            }

            // 扫最大有效 floor plane(maxDist 米内)
            ARPlane bestPlane = null;
            float bestArea = 0f;
            foreach (var p in planeMgr.trackables)
            {
                float dist = Vector3.Distance(p.transform.position, cam.transform.position);
                if (dist > maxDist) continue;
                bool lidar = false;  // 保守:走 polygon 路径
                var v = FloorPlaneValidator.Validate(p, p.transform.position, cam.transform.position.y, lidar);
                if (!v.isValid) continue;
                if (v.planeArea > bestArea)
                {
                    bestPlane = p;
                    bestArea = v.planeArea;
                }
            }
            if (bestPlane == null)
            {
                Debug.Log("[v22-CROSS-SESSION-SNAP] no valid floor plane found within " + maxDist + "m");
                _coroutineRunning = false;
                yield break;
            }

            float planeY = bestPlane.center.y;

            // 枚举 IMMORTAL cairn
            var cairns = Object.FindObjectsByType<CairnAcquireController>(FindObjectsSortMode.None);
            int snapCount = 0;
            float startMs = Time.realtimeSinceStartup * 1000f;
            foreach (var c in cairns)
            {
                if (c == null) continue;
                if (c.CurrentState != CairnAcquireController.State.IMMORTAL) continue;

                Vector3 cairnPos = c.transform.position;
                float yDelta = cairnPos.y - planeY;
                if (Mathf.Abs(yDelta) < minDelta) continue;

                // 反 fight:cairn 在视野内不 snap
                Vector3 toCairn = (cairnPos - cam.transform.position).normalized;
                float dot = Vector3.Dot(cam.transform.forward, toCairn);
                float distToCairn = Vector3.Distance(cam.transform.position, cairnPos);
                bool inView = dot > 0.3f && distToCairn < 8f;
                if (inView) continue;

                Vector2 cairnXZ = new Vector2(cairnPos.x, cairnPos.z);
                Vector2 planeXZ = new Vector2(bestPlane.center.x, bestPlane.center.z);
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
                              + " xzDelta=" + xzDelta.ToString("F2") + "m");
                }
            }
            Debug.Log("[v22-CROSS-SESSION-SNAP] complete: " + snapCount + "/" + cairns.Length + " snapped, planeY=" + planeY.ToString("F3"));
            _coroutineRunning = false;
        }

        static string GetMarkerId(CairnAcquireController c)
        {
            // markerId 是 private field; 用 GO 名字回退(spawn 时 GO 名一般是 cairn-<id>)
            return c != null ? c.gameObject.name : "unknown";
        }
    }
}
