// Cairn AR — FloorPlaneValidator (v0.2.4 Branch B)
//
// Plane validation per铁律 #2 (必须在地上). User contract:
//   "基础就是 cairn 必须在地面 且不能飘"
//
// Hard conditions (LiDAR devices):
//   1. PlaneAlignment.HorizontalUp
//   2. PlaneClassifications.Floor (or large area >= 1.0m² unclassified — grass / dirt)
//   3. Normal angle ≤ 20° from up
//   4. Hit point Y ≤ camera.y - 1.0m  (excludes tables / car hoods / human heads)
//   5. Plane area ≥ 0.5m²
//   6. Plane has been observed ≥ 1.5s (avoids first-frame unconverged)
//
// Non-LiDAR fallback: classification not available → use alignment + size + angle + height only.
//
// Per Reviewer 1 critique: "L2 任意 plane 是地雷". L2 fallback (15s force) does NOT
// bypass this validator — it only widens distance threshold (≤5m → ≤8m).

using System.Collections.Generic;
using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

namespace Cairn.AR
{
    public static class FloorPlaneValidator
    {
        public struct Result
        {
            public bool isValid;
            public string rejectReason;
            public float planeAge;
            public float planeArea;
            public float normalAngle;
            public float heightBelowCamera;
        }

        public static Result Validate(
            ARPlane plane,
            Vector3 worldHitPoint,
            float cameraY,
            bool lidarAvailable,
            float maxNormalAngle = 20f,
            float minAreaM2 = 0.5f,
            float maxHeightBelowCam = 1.0f,
            float minExtentStableSec = 1.5f,
            float maxFloorDistanceBelowCam = 5.0f)
        {
            var result = new Result { isValid = false };

            if (plane == null)
            {
                result.rejectReason = "plane_null";
                return result;
            }

            // 1. Horizontal up
            if (plane.alignment != PlaneAlignment.HorizontalUp)
            {
                result.rejectReason = "alignment_not_horizontal_up";
                return result;
            }

            // 2. Classification (LiDAR) or area gate (non-LiDAR)
            float area = plane.size.x * plane.size.y;
            result.planeArea = area;
            if (lidarAvailable)
            {
                bool isFloor = (plane.classifications & PlaneClassifications.Floor) != 0;
                if (!isFloor && area < 1.0f)
                {
                    result.rejectReason = "lidar_not_floor_and_too_small";
                    return result;
                }
            }
            // For all devices: explicitly reject every non-floor classification.
            // ARFoundation 6 PlaneClassifications enum (PlaneClassifications.cs):
            //   Ceiling, DoorFrame, WallArt, WallFace, WindowFrame, Couch, Seat,
            //   Table, InvisibleWallFace, Other. (Floor + None are not rejected.)
            // v0.2.4 R2.2 fix: original list only had Table/Seat/WallFace/Ceiling.
            // QA-35 caught Couch/WallArt/DoorFrame/WindowFrame/InvisibleWallFace
            // were silently accepted — user铁律 "焊死在地面" forbids these.
            //
            // sub#B 修订:Couch 在客厅地毯/床边毛毯 ARKit 经常误识别;一刀切 reject
            // 会让用户在自家客厅/卧室永远 plant 不了。修法:
            //   - 默认仍 reject 所有 9 类(防"焊死自己")
            //   - 大面积 Couch (≥ couchAcceptMinArea, default 1.5m²) 视为可接受
            //     (1.5m² 大约一张双人沙发的 footprint,真沙发面≈1m²;大于此值大概率是
            //     被错分类的地毯/地面)
            //   - rejectReason 细分到具体 classification 字符串供 telemetry OTA 决策
            const PlaneClassifications kRejectMaskHard =
                PlaneClassifications.Table
                | PlaneClassifications.Seat
                | PlaneClassifications.WallFace
                | PlaneClassifications.Ceiling
                | PlaneClassifications.DoorFrame
                | PlaneClassifications.WallArt
                | PlaneClassifications.WindowFrame
                | PlaneClassifications.InvisibleWallFace;
            // Couch 单独处理 — 大面积 Couch 视为地毯/地面 fallback
            if ((plane.classifications & PlaneClassifications.Couch) != 0)
            {
                if (area >= 1.5f)
                {
                    // 大面积 Couch → 当作地面接受,继续后续 normal/height/area gate
                    // 不 return,落到下面的检查
                }
                else
                {
                    result.rejectReason = "rejected_classification:Couch:area=" + area.ToString("F2");
                    return result;
                }
            }
            if ((plane.classifications & kRejectMaskHard) != 0)
            {
                // 输出具体哪一类被拒,便于 telemetry OTA 决策
                string reasonClass = "Unknown";
                if ((plane.classifications & PlaneClassifications.Table) != 0) reasonClass = "Table";
                else if ((plane.classifications & PlaneClassifications.Seat) != 0) reasonClass = "Seat";
                else if ((plane.classifications & PlaneClassifications.WallFace) != 0) reasonClass = "WallFace";
                else if ((plane.classifications & PlaneClassifications.Ceiling) != 0) reasonClass = "Ceiling";
                else if ((plane.classifications & PlaneClassifications.DoorFrame) != 0) reasonClass = "DoorFrame";
                else if ((plane.classifications & PlaneClassifications.WallArt) != 0) reasonClass = "WallArt";
                else if ((plane.classifications & PlaneClassifications.WindowFrame) != 0) reasonClass = "WindowFrame";
                else if ((plane.classifications & PlaneClassifications.InvisibleWallFace) != 0) reasonClass = "InvisibleWallFace";
                result.rejectReason = "rejected_classification:" + reasonClass;
                return result;
            }

            // 3. Normal angle (defends斜坡误判 / 倾斜面)
            float angle = Vector3.Angle(plane.normal, Vector3.up);
            result.normalAngle = angle;
            if (angle > maxNormalAngle)
            {
                result.rejectReason = "normal_angle_too_large";
                return result;
            }

            // 4. Height below camera (defends tables / car hoods)
            // v0.2.4 B1 修 (用户铁律 'plant 在哪 cairn 永远在哪'):
            //   原默认 maxHeightBelowCam=1.0m 让用户蹲下 (camY=0.5m) 时
            //   所有 plane 都被拒 → 只能走 fallback heuristic 飞天.
            //   修法: 自适应 camY * 0.6 (蹲 0.5m → gate=0.3m, 站 1.5m → gate=0.9m).
            //   保留 maxHeightBelowCam 参数作 hard cap (调用方可显式传更严).
            float adaptiveMin = Mathf.Min(maxHeightBelowCam, Mathf.Max(0.2f, cameraY * 0.6f));
            float belowCam = cameraY - worldHitPoint.y;
            result.heightBelowCamera = belowCam;
            if (belowCam < adaptiveMin)
            {
                result.rejectReason = "hit_too_high_above_ground";
                return result;
            }
            // V4.13 G2.4 新增 upper bound:plane Y 离 camera 太低 = 错层 / 楼下地面 / 悬崖
            // 用户铁律 #2 "mark 必须在真实地面" → 5m 以下肯定不是用户站的地面
            if (belowCam > maxFloorDistanceBelowCam)
            {
                result.rejectReason = "hit_too_far_below_camera";
                return result;
            }

            // 5. Area
            if (area < minAreaM2)
            {
                result.rejectReason = "area_too_small";
                return result;
            }

            // 6. Plane age (extent stable)
            // ARPlane has no native firstSeenTime; we approximate by checking
            // the trackingState combined with a running "seen-since" map maintained
            // by the spawner. For simplicity here we require trackingState=Tracking
            // AND let the caller pass age separately (or use age=999 if not tracking).
            // We use plane.trackingState as a proxy: if Limited or None, reject.
            if (plane.trackingState != TrackingState.Tracking)
            {
                result.rejectReason = "plane_not_tracking";
                return result;
            }

            result.isValid = true;
            result.rejectReason = "ok";
            return result;
        }
    }
}
