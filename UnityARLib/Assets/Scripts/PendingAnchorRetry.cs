// Cairn AR — PendingAnchorRetry (v0.2.4 Branch A)
//
// Replaces v0.2.3 behaviour where anchor-async-FAIL → Destroy(container).
// Per Reviewer 1 critique: destroying = mark 消失 = bad UX.
//
// New flow:
//   * cairn spawned but plane raycast didn't hit → container hidden
//     (renderer disabled), this component attached
//   * Every 0.1s: retry raycast at intended XZ
//   * Hit → AttachAnchor + reparent + show + Destroy(this)
//   * 1s deadline reached → SendToRN("SpawnRejected") + actually destroy
//
// User contract:
//   "概率不大选 1" — 找不到时 retry 1s → 大多数情况用户感受不到
//   "找不到率 = 0% 才及格" — 1s retry 大幅降低 0 概率失败

using System.Collections;
using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

namespace Cairn.AR
{
    public class PendingAnchorRetry : MonoBehaviour
    {
        Vector3 _intendedXZ;       // x, _, z (y will come from raycast hit)
        float _intendedY;          // best guess Y if all retries fail (estimated_ground)
        float _deadline;
        string _markerId;

        ARRaycastManager _raycast;
        ARAnchorManager _anchorMgr;
        ARPlaneManager _planeMgr;
        Camera _cam;
        bool _started;
        Renderer[] _hiddenRenderers;

        public void Init(string markerId, Vector3 intendedXZ, float intendedY, float deadlineSec,
                         ARRaycastManager raycast, ARAnchorManager anchorMgr, ARPlaneManager planeMgr, Camera cam)
        {
            // V4.13 sub#2 N4 fix: Init 二次调用守护
            // 旧实现:_started 防协程重启,但其他字段无条件覆盖 → 旧协程用新坐标继续跑,
            // _hiddenRenderers 状态不一致。早 return 让二次 Init 成 no-op。
            if (_started) return;

            _markerId = markerId;
            _intendedXZ = intendedXZ;
            _intendedY = intendedY;
            _deadline = Time.time + deadlineSec;
            _raycast = raycast;
            _anchorMgr = anchorMgr;
            _planeMgr = planeMgr;
            _cam = cam;

            // v0.2.5 — DO NOT hide the cairn during retry. User feedback:
            // "感觉对于相机角度等要求很高 ... 如果用户在 mark 上方不扫
            //  mark, mark 会不展示么 理论上用户在范围内就应该展示了".
            // The previous behavior hid all renderers while RetryCoroutine
            // tried to find a plane to attach to; if the user wasn't aiming
            // at the cairn, the retry took up to 30s during which the cairn
            // was invisible. Showing the cairn at the estimated XYZ from
            // the start (parented to the GameObject's current transform)
            // gives immediate feedback. If a plane is found later, the
            // retry's AttachAnchor reparents the cairn to the real anchor —
            // the visible position barely changes (estimated pose is
            // already correct within ARKit jitter).
            _hiddenRenderers = System.Array.Empty<Renderer>();
            UnityLogger.IForward("v288-PENDING-RETRY-START",
                $"id={_markerId} xz=({intendedXZ.x:F2},{intendedXZ.z:F2}) y={intendedY:F2} deadline={deadlineSec:F1}s visible-from-start=true");

            _started = true;
            StartCoroutine(RetryCoroutine());
        }

        IEnumerator RetryCoroutine()
        {
            var hits = new System.Collections.Generic.List<ARRaycastHit>();
            while (Time.time < _deadline)
            {
                if (_cam != null && _raycast != null)
                {
                    Vector3 probeWorld = new Vector3(_intendedXZ.x, _cam.transform.position.y, _intendedXZ.z);
                    Vector3 screenPt = _cam.WorldToScreenPoint(probeWorld);
                    if (screenPt.z > 0
                        && screenPt.x >= 0 && screenPt.x < Screen.width
                        && screenPt.y >= 0 && screenPt.y < Screen.height)
                    {
                        hits.Clear();
                        if (_raycast.Raycast(new Vector2(screenPt.x, screenPt.y), hits, TrackableType.PlaneWithinPolygon | TrackableType.Depth))
                        {
                            ARRaycastHit best = default;
                            bool hasBest = false;
                            float bestArea = 0f;
                            foreach (var h in hits)
                            {
                                var plane = _planeMgr != null ? _planeMgr.GetPlane(h.trackableId) : null;
                                if (plane == null) continue;
                                // v0.2.4 R2.6 fix:
                                //   原写死 lidarAvailable=false → LiDAR 设备的 Floor 分类
                                //   优势用不上,跟 PortalSpawnerV199.cs:251 runtime 检测不一致。
                                //   统一为 runtime 检测 ARMeshManager 是否在跑。
                                var meshMgr = UnityEngine.Object.FindFirstObjectByType<UnityEngine.XR.ARFoundation.ARMeshManager>();
                                bool lidar = meshMgr != null && meshMgr.enabled
                                          && meshMgr.subsystem != null && meshMgr.subsystem.running;
                                var validation = FloorPlaneValidator.Validate(
                                    plane, h.pose.position, _cam.transform.position.y,
                                    lidarAvailable: lidar);
                                if (!validation.isValid) continue;
                                if (validation.planeArea > bestArea)
                                {
                                    best = h;
                                    hasBest = true;
                                    bestArea = validation.planeArea;
                                }
                            }
                            if (hasBest && _anchorMgr != null && _planeMgr != null)
                            {
                                var plane = _planeMgr.GetPlane(best.trackableId);
                                var anchor = _anchorMgr.AttachAnchor(plane, best.pose);
                                if (anchor != null)
                                {
                                    transform.SetParent(anchor.transform, worldPositionStays: false);
                                    transform.localPosition = Vector3.zero;
                                    foreach (var r in _hiddenRenderers)
                                        if (r != null) r.enabled = true;
                                    Debug.Log($"[v22-RETRY-OK] id={_markerId} after {(_deadline - Time.time):F2}s remaining");
                                    // V4.13 A2.4 埋点 + drift monitor (retry 成功路径)
                                    UnityLogger.IForward("v22-PLANT-ANCHOR-CREATE",
                                        $"id={_markerId} tier=retry-plane-attached pos=({best.pose.position.x:F2},{best.pose.position.y:F2},{best.pose.position.z:F2}) trackableId={anchor.trackableId}");
                                    var driftMon = GetComponent<AnchorDriftMonitor>();
                                    if (driftMon == null) driftMon = gameObject.AddComponent<AnchorDriftMonitor>();
                                    driftMon.Init(_markerId);
                                    Destroy(this);
                                    yield break;
                                }
                            }
                        }
                    }
                }
                yield return new WaitForSeconds(0.1f);
            }

            // Deadline reached — fall back to estimated ground spawn rather than destroy.
            // 铁律 #5 (必须能展示) > 铁律 #2 (必须在地上) when it's truly hopeless.
            // User: "至少给个 retry,概率不大选 1"
            //
            // V4.13 sub#2 4 眼 review Finding #1 (Blocker) 修复:
            // 旧实现:transform.position = 裸坐标 + 显示 → 等于 v0.2.3 飘逸 bug 复活
            // 用户原话:"不存在移动 变换 飞天" → deadline 分支必须仍有 ARAnchor 锚定
            // 镜像 PortalSpawner.cs:591-598 DepthAnchor 路径:
            //   new GameObject + AddComponent<ARAnchor> 在 estimated pose 上
            //   SetParent worldPositionStays:false → ARKit world frame 锁定 cairn
            // 即使没 plane 命中,ARKit 也会 pin 住 anchor 不让 cairn 飘
            Vector3 estimatedPose = new Vector3(_intendedXZ.x, _intendedY, _intendedXZ.z);
            // V4.13 sub#2 N3 fix: name 加 frameCount 后缀避免重名 markerId 二次失败时 Find 拿错
            var anchorGo = new GameObject($"DegradedAnchor_{_markerId}_{Time.frameCount}");
            anchorGo.transform.position = estimatedPose;
            anchorGo.transform.rotation = Quaternion.identity;
            var degradedAnchor = anchorGo.AddComponent<ARAnchor>();
            if (degradedAnchor != null)
            {
                transform.SetParent(anchorGo.transform, worldPositionStays: false);
                transform.localPosition = Vector3.zero;
                // V4.13 sub#2 N1 fix: 注册到 PortalSpawner._spawned,ClearAll 时一起 Destroy
                // 否则 free-floating ARAnchor 残留在 scene root → ARKit tracking budget 累积泄漏
                // (镜像 PortalSpawner.cs:598 R2 fix DepthAnchor 路径同种 pattern)
                var spawner = Object.FindFirstObjectByType<PortalSpawner>();
                if (spawner != null) spawner.RegisterAuxiliaryAnchor(anchorGo);
                Debug.LogWarning($"[v22-RETRY-DEADLINE-ANCHORED] id={_markerId} estimated_ground y={_intendedY:F2} pinned to free-floating ARAnchor");
                // V4.13 A2.4 埋点 + drift monitor (deadline-anchor 路径)
                UnityLogger.IForward("v22-PLANT-ANCHOR-CREATE",
                    $"id={_markerId} tier=deadline-free-floating pos=({estimatedPose.x:F2},{estimatedPose.y:F2},{estimatedPose.z:F2})");
                // v0.2.4 Phase 3 LOG: subagent#2 BLOCKER — DegradedAnchor 是 plane 检测彻底失败后的 fallback,
                // free-floating ARAnchor 不被 ARAnchorSubsystem 注册的概率最高,**飞天最高风险路径**。
                // 跟 PortalSpawner.cs DepthAnchor 同步加 trackingState 1s/5s/30s 检查。
                UnityLogger.ICritical("v22-PHASE3-ANCHOR-FREE-FLOATING-CREATE",
                    $"id={_markerId} path=DegradedAnchor pos=({estimatedPose.x:F2},{estimatedPose.y:F2},{estimatedPose.z:F2}) " +
                    $"state-when-created={degradedAnchor.trackingState}(expected-None-async-init) " +
                    $"trackableId-when-created={degradedAnchor.trackableId}");
                // Round 7 fix: 用持久 Phase3CoroutineHost 跑 delayed check
                Phase3CoroutineHost.Instance.StartAnchorTrackingCheck(_markerId, degradedAnchor, 1.0f, "DegradedAnchor");
                Phase3CoroutineHost.Instance.StartAnchorTrackingCheck(_markerId, degradedAnchor, 5.0f, "DegradedAnchor");
                Phase3CoroutineHost.Instance.StartAnchorTrackingCheck(_markerId, degradedAnchor, 30.0f, "DegradedAnchor");
                var driftMon = GetComponent<AnchorDriftMonitor>();
                if (driftMon == null) driftMon = gameObject.AddComponent<AnchorDriftMonitor>();
                driftMon.Init(_markerId);
            }
            else
            {
                // ARAnchor AddComponent 极少数失败:回退到裸坐标(原 v0.2.3 行为)
                // 至少 cairn 能 show,不至于完全消失
                Destroy(anchorGo);
                transform.position = estimatedPose;
                Debug.LogError($"[v22-RETRY-DEADLINE-BARE] id={_markerId} ARAnchor AddComponent failed, bare coords (FALLBACK OF FALLBACK)");
            }
            foreach (var r in _hiddenRenderers)
                if (r != null) r.enabled = true;

            // Notify RN so it can show "请扫描地面 重新对准" toast
            var bridge = Object.FindFirstObjectByType<CairnBridge>();
            if (bridge != null)
            {
                bridge.SendToRN("SpawnDegraded", $"{{\"id\":\"{_markerId}\",\"reason\":\"anchor-retry-exhausted\"}}");
            }
            Destroy(this);
        }

        /// <summary>
        /// v0.2.4 Phase 3 LOG — 检查 DegradedAnchor (free-floating, deadline path)
        /// trackingState。subagent#2 警告这是飞天最高风险路径。
        /// </summary>
        System.Collections.IEnumerator CheckDegradedAnchorTrackingStateDelayed(string id, ARAnchor anchor, float delay)
        {
            yield return new WaitForSeconds(delay);
            if (anchor == null)
            {
                UnityLogger.ICritical("v22-PHASE3-ANCHOR-FREE-FLOATING-DESTROYED",
                    $"id={id} path=DegradedAnchor delay={delay:F1}s anchor was destroyed");
                yield break;
            }
            UnityLogger.ICritical("v22-PHASE3-ANCHOR-FREE-FLOATING-CHECK",
                $"id={id} path=DegradedAnchor delay={delay:F1}s state-after-{delay:F0}s={anchor.trackingState} " +
                $"trackableId={anchor.trackableId} pos=({anchor.transform.position.x:F2}," +
                $"{anchor.transform.position.y:F2},{anchor.transform.position.z:F2})");
        }
    }
}
