// Cairn AR v0.2.5 Core canary — Phase 0 stub.
// This file's only purpose is to force the v025.Runtime.asmdef references list to
// resolve at compile time, so a missing reference does not lurk until Phase 1A.
//
// Phase 1A.1 will replace this with the real IAnchorPersistence interface.
// Until then, the using-directives below import each ref'd assembly's namespace
// minimally — if any reference is wrong, Editor compilation will fail here.

using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;
using Unity.XR.CoreUtils;
using UnityEngine.Rendering.Universal;
using Unity.Mathematics;
using UnityEngine.InputSystem;

namespace Cairn.AR.V025.Core
{
    /// <summary>
    /// Phase 0 canary — proves the v025 asmdef references list resolves.
    /// Holds zero state; replace with real Phase 1A code.
    /// </summary>
    internal static class V025BuildCanary
    {
        /// <summary>Proves the type-system can see ARSession.</summary>
        public static System.Type ArSessionType()
        {
            return typeof(ARSession);
        }

        /// <summary>Proves URP renderer feature types are reachable.</summary>
        public static System.Type UrpRendererType()
        {
            return typeof(UniversalRenderPipelineAsset);
        }

        /// <summary>Proves Unity.Mathematics is reachable.</summary>
        public static float3 ZeroFloat3()
        {
            return float3.zero;
        }

        /// <summary>Proves XR Core utilities are reachable.</summary>
        public static System.Type XrOriginType()
        {
            return typeof(XROrigin);
        }

        /// <summary>Proves InputSystem is reachable.</summary>
        public static System.Type InputActionType()
        {
            return typeof(InputAction);
        }

        /// <summary>Proves ARSubsystems trackable types are reachable.</summary>
        public static TrackingState ZeroTrackingState()
        {
            return TrackingState.None;
        }
    }
}
