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
            _markerId = markerId;
            _intendedXZ = intendedXZ;
            _intendedY = intendedY;
            _deadline = Time.time + deadlineSec;
            _raycast = raycast;
            _anchorMgr = anchorMgr;
            _planeMgr = planeMgr;
            _cam = cam;

            // Hide cairn while pending — user shouldn't see it half-placed
            _hiddenRenderers = GetComponentsInChildren<Renderer>(includeInactive: false);
            foreach (var r in _hiddenRenderers)
                r.enabled = false;

            if (!_started)
            {
                _started = true;
                StartCoroutine(RetryCoroutine());
            }
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
                                var validation = FloorPlaneValidator.Validate(
                                    plane, h.pose.position, _cam.transform.position.y,
                                    lidarAvailable: false /* unknown here, treat conservatively */);
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
            transform.position = new Vector3(_intendedXZ.x, _intendedY, _intendedXZ.z);
            foreach (var r in _hiddenRenderers)
                if (r != null) r.enabled = true;
            Debug.LogWarning($"[v22-RETRY-DEADLINE] id={_markerId} 1s reached, spawn estimated_ground at y={_intendedY:F2}");

            // Notify RN so it can show "请扫描地面 重新对准" toast
            var bridge = Object.FindFirstObjectByType<CairnBridge>();
            if (bridge != null)
            {
                bridge.SendToRN("SpawnDegraded", $"{{\"id\":\"{_markerId}\",\"reason\":\"anchor-retry-exhausted\"}}");
            }
            Destroy(this);
        }
    }
}
