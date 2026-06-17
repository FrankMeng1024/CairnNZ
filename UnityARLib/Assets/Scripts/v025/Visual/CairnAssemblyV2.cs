// Phase 2B.6 — CairnAssemblyV2.
//
// Visual spawn dispatcher for v025 AR pipeline.
// The actual visual instantiation is injected via SetSpawnDelegate() so that
// v025.Runtime.asmdef (this assembly) does not depend on Assembly-CSharp types
// like PortalSpawner. V025VisualBridge.cs (Assembly-CSharp) wires the real
// PortalSpawner.SpawnStrand call.
//
// cairnType string: 'cairn' | 'danger' | 'water' | 'junction' | 'hut'

using System;
using System.Collections.Generic;
using UnityEngine;
using Unity.Mathematics;

namespace Cairn.AR.V025.Visual
{
    public sealed class CairnAssemblyV2 : MonoBehaviour
    {
        // Injected by V025VisualBridge (Assembly-CSharp). Signature: (cairnId, worldPos, cairnType)
        private Action<string, float3, string> _spawnDelegate;
        private readonly Dictionary<string, string> _instanceTypes = new Dictionary<string, string>();

        public void SetSpawnDelegate(Action<string, float3, string> del)
        {
            _spawnDelegate = del ?? throw new ArgumentNullException(nameof(del));
        }

        /// <summary>
        /// Spawn a cairn. Requires SetSpawnDelegate to have been called first.
        /// cairnType: 'cairn' | 'danger' | 'water' | 'junction' | 'hut'
        /// </summary>
        public void SpawnAtPosition(string cairnId, float3 worldPos, string cairnType)
        {
            if (cairnId == null) throw new ArgumentNullException(nameof(cairnId));
            if (_spawnDelegate == null)
            {
                Debug.LogError("[v025/CairnAssembly] SpawnDelegate not set — call SetSpawnDelegate first. cairnId=" + cairnId);
                return;
            }
            _spawnDelegate(cairnId, worldPos, cairnType);
            _instanceTypes[cairnId] = cairnType;
        }

        public void Despawn(string cairnId)
        {
            _instanceTypes.Remove(cairnId);
        }

        public bool HasInstance(string cairnId) => _instanceTypes.ContainsKey(cairnId);

        public IReadOnlyDictionary<string, string> InstanceTypes => _instanceTypes;
    }
}
