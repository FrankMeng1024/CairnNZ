// Phase 2B.6 — CairnAssemblyV2.
//
// Composes a complete cairn from a SpawnResponse received over CairnBridgeV2:
//   1. Subscribe to v025/spawn-ok wire messages (Phase 2A.8 bridge)
//   2. On message: instantiate a prefab at outcome.FinalXyz with the right
//      CairnType selected for child renderers (Base + TypeIcon + Ceremony +
//      TypeParticle + BillboardYaw + DistanceFader)
//   3. Track instances by cairnId so re-spawn replaces in place
//
// Phase 2A 4-eye sub#2A-2 concern: CairnSpawnerV2 emits SpawnResponse but does
// NOT instantiate. CairnAssemblyV2 is the consumer.
//
// SCOPE LIMITATION: this file does the wiring + instantiation logic. The actual
// prefab + materials must be authored in Unity Editor. CairnAssemblyV2.RegisterPrefab
// allows tests/composition root to inject a runtime-built prefab when no Editor
// asset is available.

using System;
using System.Collections.Generic;
using UnityEngine;
using Unity.Mathematics;

namespace Cairn.AR.V025.Visual
{
    public sealed class CairnAssemblyV2 : MonoBehaviour
    {
        [SerializeField] private GameObject _cairnPrefab;
        private readonly Dictionary<string, GameObject> _instances = new Dictionary<string, GameObject>();

        public void RegisterPrefab(GameObject prefab) { _cairnPrefab = prefab; }

        /// <summary>
        /// Ensure a prefab is available — if none was registered, build a runtime
        /// fallback via V025PrefabFactory. Phase 4 EAS build #1 will register an
        /// Editor-authored prefab; until then runtime build is the path.
        /// (Round-2 fix #2B-2-D)
        /// </summary>
        public GameObject EnsurePrefab()
        {
            if (_cairnPrefab == null)
            {
                _cairnPrefab = V025PrefabFactory.BuildRuntimePrefab();
            }
            return _cairnPrefab;
        }

        /// <summary>
        /// Spawn or replace a cairn at the given world position.
        /// Returns the GameObject root (caller can attach AR anchor / parent it elsewhere).
        /// </summary>
        public GameObject SpawnAtPosition(string cairnId, float3 worldPos, CairnType type)
        {
            if (cairnId == null) throw new ArgumentNullException(nameof(cairnId));
            EnsurePrefab();
            if (_cairnPrefab == null)
            {
                Debug.LogError("[v025/CairnAssembly] no prefab registered AND runtime build failed — cannot spawn cairnId=" + cairnId);
                return null;
            }

            // Despawn existing if present
            if (_instances.TryGetValue(cairnId, out var existing) && existing != null)
            {
                Destroy(existing);
            }

            var go = Instantiate(_cairnPrefab, new Vector3(worldPos.x, worldPos.y, worldPos.z), Quaternion.identity);
            go.SetActive(true);
            go.name = $"Cairn_{cairnId}";
            ApplyTypeToChildren(go, type);
            _instances[cairnId] = go;
            return go;
        }

        public void Despawn(string cairnId)
        {
            if (_instances.TryGetValue(cairnId, out var go) && go != null)
            {
                Destroy(go);
            }
            _instances.Remove(cairnId);
        }

        public bool TryGetInstance(string cairnId, out GameObject instance)
        {
            return _instances.TryGetValue(cairnId, out instance);
        }

        public IReadOnlyDictionary<string, GameObject> Instances => _instances;

        private static void ApplyTypeToChildren(GameObject root, CairnType type)
        {
            var iconRenderer = root.GetComponentInChildren<CairnTypeIconRenderer>();
            if (iconRenderer != null) iconRenderer.CairnType = type;
            var particleController = root.GetComponentInChildren<TypeParticleV2Controller>();
            if (particleController != null) particleController.CairnType = type;
        }
    }
}
