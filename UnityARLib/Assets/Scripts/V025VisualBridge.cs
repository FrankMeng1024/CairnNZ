// V025VisualBridge — Assembly-CSharp wiring layer.
//
// Connects v025.Runtime.asmdef (CairnAssemblyV2) to v0.2.4 visual pipeline
// (PortalSpawner + CairnTypePresets), avoiding a cross-asmdef reference.
//
// Place this MonoBehaviour on the same GameObject as V025Bootstrap (or any
// persistent AR scene GO). It runs Awake() and injects the spawn delegate.
//
// cairnType string: 'cairn' | 'danger' | 'water' | 'junction' | 'hut'

using UnityEngine;
using Unity.Mathematics;
using Cairn.AR.V025.Bootstrap;
using Cairn.AR.V025.Visual;

public sealed class V025VisualBridge : MonoBehaviour
{
    private void Awake()
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

        assembly.SetSpawnDelegate(SpawnViav024Visual);
        Debug.Log("[V025VisualBridge] SpawnDelegate wired to PortalSpawner v0.2.4 pipeline.");
    }

    private void SpawnViav024Visual(string cairnId, float3 worldPos, string cairnType)
    {
        var portalSpawner = Object.FindFirstObjectByType<PortalSpawner>();
        if (portalSpawner == null)
        {
            Debug.LogError("[V025VisualBridge] PortalSpawner not found in scene — cannot spawn cairnId=" + cairnId);
            return;
        }

        var preset = CairnTypePresets.Get(cairnType);
        var color  = preset.color;

        var data = new CairnBridge.SpawnRequest
        {
            id   = cairnId,
            type = cairnType,
            x    = worldPos.x,
            y    = worldPos.y,
            z    = worldPos.z,
            r    = color.r,
            g    = color.g,
            b    = color.b,
        };

        portalSpawner.SpawnStrand(data);
        Debug.Log($"[V025VisualBridge] SpawnStrand id={cairnId} type={cairnType} pos=({worldPos.x:F2},{worldPos.y:F2},{worldPos.z:F2})");
    }
}
