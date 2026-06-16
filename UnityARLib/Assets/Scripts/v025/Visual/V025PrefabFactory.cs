// Phase 2B (round-2 fix #2B-2.D) — Runtime-built cairn prefab.
//
// Problem: Phase 2B did not author a Unity prefab asset; CairnAssemblyV2.SpawnAtPosition
// returns null when _cairnPrefab is null.
//
// Fix: V025PrefabFactory.BuildRuntimePrefab() constructs the full hierarchy
// programmatically — Base + TypeIcon + (future: Ceremony + TypeParticle billboard
// children). Phase 4 EAS build #1 may replace this with an Editor-authored prefab
// for performance, but the runtime build path stays as the fallback so EditorWindow
// playground always works.

using UnityEngine;

namespace Cairn.AR.V025.Visual
{
    public static class V025PrefabFactory
    {
        /// <summary>
        /// Build a complete inactive cairn prefab GameObject. Caller is responsible for
        /// activating + parenting + positioning. Returns the root.
        /// </summary>
        public static GameObject BuildRuntimePrefab(Material baseMaterial = null, Material iconMaterial = null, Material ringMaterial = null)
        {
            var root = new GameObject("V025_Cairn_Prefab") { hideFlags = HideFlags.None };
            root.SetActive(false); // caller activates after positioning

            // Base
            var baseGo = new GameObject("Base");
            baseGo.transform.SetParent(root.transform, false);
            baseGo.AddComponent<MeshFilter>();
            baseGo.AddComponent<MeshRenderer>();
            var baseRenderer = baseGo.AddComponent<CairnBaseRenderer>();
            if (baseMaterial != null) baseRenderer.BaseMaterial = baseMaterial;
            baseRenderer.BuildOrRefresh();

            // Type icon
            var iconGo = new GameObject("TypeIcon");
            iconGo.transform.SetParent(root.transform, false);
            iconGo.AddComponent<MeshFilter>();
            iconGo.AddComponent<MeshRenderer>();
            var iconRenderer = iconGo.AddComponent<CairnTypeIconRenderer>();
            iconRenderer.BuildOrRefresh();
            // Add billboard so icon faces camera
            iconGo.AddComponent<BillboardYawV2>();

            // Ceremony ring
            var ringGo = new GameObject("CeremonyRing");
            ringGo.transform.SetParent(root.transform, false);
            ringGo.AddComponent<MeshFilter>();
            ringGo.AddComponent<MeshRenderer>();
            ringGo.AddComponent<CeremonyV2Controller>();

            // Distance fader applied at root for global alpha
            // (children read shader _Alpha property via property block)
            root.AddComponent<DistanceFaderV2>();

            return root;
        }
    }
}
