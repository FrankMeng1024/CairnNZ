// Phase 2B.6 — CairnAssemblyV2.
//
// Visual spawn dispatcher for v025 AR pipeline.
// The actual visual instantiation is injected via SetSpawnDelegate() so that
// v025.Runtime.asmdef (this assembly) does not depend on Assembly-CSharp types
// like PortalSpawner. V025VisualBridge.cs (Assembly-CSharp) wires the real
// PortalSpawner.SpawnStrand call.
//
// Thread safety: SpawnAtPosition may be called from a thread-pool continuation
// (CairnBridgeV2.OnSpawnAsync uses ConfigureAwait(false)). The delegate itself
// calls Unity APIs (Instantiate, scene graph reads) which are main-thread-only.
// Fix: SpawnAtPosition enqueues into a ConcurrentQueue; Update() drains it on
// the Unity main thread.
//
// cairnType string: 'cairn' | 'danger' | 'water' | 'junction' | 'hut'

using System;
using System.Collections.Concurrent;
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

        // Thread-safe queue — SpawnAtPosition enqueues; Update() drains on main thread.
        private readonly ConcurrentQueue<SpawnCall> _pendingSpawns = new ConcurrentQueue<SpawnCall>();

        private readonly struct SpawnCall
        {
            public readonly string CairnId;
            public readonly float3 WorldPos;
            public readonly string CairnType;
            public SpawnCall(string cairnId, float3 worldPos, string cairnType)
            {
                CairnId = cairnId; WorldPos = worldPos; CairnType = cairnType;
            }
        }

        public void SetSpawnDelegate(Action<string, float3, string> del)
        {
            _spawnDelegate = del ?? throw new ArgumentNullException(nameof(del));
        }

        /// <summary>
        /// Thread-safe entry point. Enqueues the spawn; it will execute on the
        /// Unity main thread during the next Update() tick.
        /// cairnType: 'cairn' | 'danger' | 'water' | 'junction' | 'hut'
        /// </summary>
        public void SpawnAtPosition(string cairnId, float3 worldPos, string cairnType)
        {
            if (cairnId == null) throw new ArgumentNullException(nameof(cairnId));
            _pendingSpawns.Enqueue(new SpawnCall(cairnId, worldPos, cairnType ?? "cairn"));
        }

        private void Update()
        {
            while (_pendingSpawns.TryDequeue(out var call))
            {
                if (_spawnDelegate == null)
                {
                    Debug.LogError("[v025/CairnAssembly] SpawnDelegate not set — call SetSpawnDelegate first. cairnId=" + call.CairnId);
                    continue;
                }
                _spawnDelegate(call.CairnId, call.WorldPos, call.CairnType);
                _instanceTypes[call.CairnId] = call.CairnType;
            }
        }

        public void Despawn(string cairnId)
        {
            _instanceTypes.Remove(cairnId);
        }

        public bool HasInstance(string cairnId) => _instanceTypes.ContainsKey(cairnId);

        public IReadOnlyDictionary<string, string> InstanceTypes => _instanceTypes;
    }
}
