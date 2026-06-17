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

using System.Reflection;
using UnityEngine;

namespace Cairn.AR.V025.Visual
{
    public static class V025PrefabFactory
    {
        /// <summary>
        /// Build a complete inactive cairn prefab GameObject. Caller is responsible for
        /// activating + parenting + positioning. Returns the root.
        /// </summary>
        public static GameObject BuildRuntimePrefab(Material baseMaterial = null, Material iconMaterial = null, Material ringMaterial = null, Material particleMaterial = null)
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
            if (iconMaterial != null)
            {
                var iconMatField = typeof(CairnTypeIconRenderer).GetField("_iconMaterial",
                    System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
                if (iconMatField != null) iconMatField.SetValue(iconRenderer, iconMaterial);
            }
            iconRenderer.BuildOrRefresh();
            // Add billboard so icon faces camera
            iconGo.AddComponent<BillboardYawV2>();

            // Ceremony ring
            var ringGo = new GameObject("CeremonyRing");
            ringGo.transform.SetParent(root.transform, false);
            ringGo.AddComponent<MeshFilter>();
            ringGo.AddComponent<MeshRenderer>();
            var ceremonyCtrl = ringGo.AddComponent<CeremonyV2Controller>();
            if (ringMaterial != null)
            {
                var ringMatField = typeof(CeremonyV2Controller).GetField("_ringMaterial",
                    System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
                if (ringMatField != null) ringMatField.SetValue(ceremonyCtrl, ringMaterial);
            }

            // Type particles — ambient per-type particle effect.
            // CairnAssemblyV2.ApplyTypeToChildren searches for TypeParticleV2Controller
            // in children; it must exist in the prefab hierarchy for the type effect to fire.
            var particlesGo = new GameObject("TypeParticles");
            particlesGo.transform.SetParent(root.transform, false);
            var ps = particlesGo.AddComponent<ParticleSystem>();
            particlesGo.AddComponent<TypeParticleV2Controller>();
            var psMain = ps.main;
            psMain.playOnAwake = false;
            // Assign particle material to the auto-added ParticleSystemRenderer.
            // Without a material, the renderer uses Unity's Default-Particle which is pink in URP.
            if (particleMaterial != null)
            {
                var psRenderer = particlesGo.GetComponent<ParticleSystemRenderer>();
                if (psRenderer != null) psRenderer.sharedMaterial = particleMaterial;
            }

            // Distance fader applied at root for global alpha
            // (children read shader _Alpha property via property block)
            root.AddComponent<DistanceFaderV2>();

            return root;
        }
    }
}
