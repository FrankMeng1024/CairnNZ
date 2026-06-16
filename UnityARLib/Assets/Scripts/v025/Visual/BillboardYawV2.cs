// Phase 2B.5 — BillboardYawV2.
//
// Forces the cairn's transform to face the camera on the Y axis only (yaw),
// so type icons and ceremony rings always point at the user. X/Z rotation
// preserved so the cairn doesn't lean.
//
// PURE-LOGIC core: ComputeYawDegrees() is a static method consumed by both
// the MonoBehaviour wrapper AND EditMode unit tests.

using UnityEngine;
using Unity.Mathematics;

namespace Cairn.AR.V025.Visual
{
    public static class BillboardYawMath
    {
        /// <summary>
        /// Compute the yaw angle (in degrees) such that an object placed at
        /// <paramref name="targetPos"/> faces the camera at <paramref name="cameraPos"/>.
        /// Returns 0 when camera is directly above the target (atan2(0,0)=0 by convention).
        /// </summary>
        public static float ComputeYawDegrees(float3 targetPos, float3 cameraPos)
        {
            var dx = cameraPos.x - targetPos.x;
            var dz = cameraPos.z - targetPos.z;
            // atan2(dx, dz) — standard convention for yaw with +Z forward.
            var yawRad = math.atan2(dx, dz);
            return math.degrees(yawRad);
        }

        /// <summary>
        /// Smooth a yaw value toward a target with framerate-independent damping.
        /// Returns the new current value. dampingPerSecond=0 = snap, large = sluggish.
        /// </summary>
        public static float DampYaw(float current, float target, float dampingPerSecond, float deltaSeconds)
        {
            // Wrap target to be within ±180° of current to avoid 358→2 spinning the long way.
            var diff = math.fmod(target - current + 540.0f, 360.0f) - 180.0f;
            // exponential decay: factor = 1 - exp(-damping * dt) (frame-rate independent)
            var factor = 1.0f - math.exp(-dampingPerSecond * deltaSeconds);
            return current + diff * factor;
        }
    }

    /// <summary>
    /// MonoBehaviour wrapper that applies yaw billboard each frame.
    /// </summary>
    public sealed class BillboardYawV2 : MonoBehaviour
    {
        [SerializeField] private Camera _targetCamera;
        [SerializeField] private float _dampingPerSecond = 12.0f;
        private float _currentYawDeg;

        public Camera TargetCamera
        {
            get => _targetCamera;
            set => _targetCamera = value;
        }

        private void LateUpdate()
        {
            var cam = _targetCamera ?? Camera.main;
            if (cam == null) return;
            float3 myPos = transform.position;
            float3 camPos = cam.transform.position;
            var target = BillboardYawMath.ComputeYawDegrees(myPos, camPos);
            _currentYawDeg = BillboardYawMath.DampYaw(_currentYawDeg, target, _dampingPerSecond, Time.deltaTime);
            transform.rotation = Quaternion.Euler(0, _currentYawDeg, 0);
        }
    }
}
