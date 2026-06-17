// V025VisualBridge — Assembly-CSharp wiring layer.
//
// Connects v025.Runtime.asmdef (CairnAssemblyV2) to v0.2.4 visual pipeline
// (PortalSpawner + CairnTypePresets), avoiding a cross-asmdef reference.
//
// Place this MonoBehaviour on the same GameObject as V025Bootstrap (or any
// persistent AR scene GO).
//
// Lifecycle: wiring is done in Start() (not Awake()) so that V025Bootstrap.Awake()
// is guaranteed to have completed and Assembly is non-null before wiring.
//
// cairnType string: 'cairn' | 'danger' | 'water' | 'junction' | 'hut'

using UnityEngine;
using Unity.Mathematics;
using Cairn.AR.V025.Bootstrap;
using Cairn.AR.V025.Visual;

public sealed class V025VisualBridge : MonoBehaviour
{
    private PortalSpawner _portalSpawner;

    private void Start()
    {
        var bootstrap = GetComponent<V025Bootstrap>()
                     ?? Object.FindFirstObjectByType<V025Bootstrap>();
        if (bootstrap == null)
        {
            Debug.LogError("[V025VisualBridge] V025Bootstrap not found — visual spawn delegate not wired.");
            return;
        }

        var assembly = bootstrap.Assembly;
        if (assembly == null)
        {
            Debug.LogError("[V025VisualBridge] V025Bootstrap.Assembly is null — not yet initialised.");
            return;
        }

        _portalSpawner = Object.FindFirstObjectByType<PortalSpawner>();
        if (_portalSpawner == null)
        {
            Debug.LogError("[V025VisualBridge] PortalSpawner not found in scene at Start — visual spawn will fail.");
        }

        assembly.SetSpawnDelegate(SpawnViav024Visual);
        Debug.Log("[V025VisualBridge] SpawnDelegate wired to PortalSpawner v0.2.4 pipeline.");
    }

    // Called by CairnAssemblyV2.Update() on the Unity main thread.
    private void SpawnViav024Visual(string cairnId, float3 worldPos, string cairnType)
    {
        if (_portalSpawner == null)
        {
            Debug.LogError("[V025VisualBridge] PortalSpawner not found in scene — cannot spawn cairnId=" + cairnId);
            return;
        }

        var preset = CairnTypePresets.Get(cairnType);
        var color  = preset.color;

        var data = new CairnBridge.SpawnRequest
        {
            id          = cairnId,
            type        = cairnType,
            x           = worldPos.x,
            y           = worldPos.y,
            z           = worldPos.z,
            r           = color.r,
            g           = color.g,
            b           = color.b,
            scrollSpeed = preset.scrollSpeed,
            bloomBoost  = preset.bloomBoost,
            tier        = "A",   // AR-anchored XYZ from AnchorAttachStrategy — bypass sessionOffset
        };

        _portalSpawner.SpawnStrand(data);
        Debug.Log($"[V025VisualBridge] SpawnStrand id={cairnId} type={cairnType} pos=({worldPos.x:F2},{worldPos.y:F2},{worldPos.z:F2})");
    }
}
