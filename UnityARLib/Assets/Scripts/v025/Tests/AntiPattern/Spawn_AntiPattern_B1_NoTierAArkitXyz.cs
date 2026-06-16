// Phase 2A.9 — AntiPattern B1: spawn must NEVER store ARKit-XYZ-from-LatLng-only.
//
// v0.2.4 bug regressed to: cairnSpawnV2 computed XYZ purely from GPS lat/lng
// deltas without any plane / raycast / ARWorldMap, then asked Unity to spawn
// at that XYZ. Cairns appeared underground.
//
// v0.2.5 contract: AnchorAttachStrategy is the ONLY way to get an attach
// position. CairnSpawnerV2.HandleAsync is the ONLY entry point that consumes
// SpawnRequest.TargetXyz, and HandleAsync passes it through to AttachStrategy
// (which only honors it on Tier-S Success). This test pins that contract.

using System.Linq;
using NUnit.Framework;
using Cairn.AR.V025.Core;

namespace Cairn.AR.V025.Tests.AntiPattern
{
    public class Spawn_AntiPattern_B1_NoTierAArkitXyz
    {
        // Static-sniff test: assert that within v025 namespace, the only public method
        // that returns AnchorAttachOutcome.AttachedTierS / TierGPlane / TierGRaycast /
        // TierGFeature is AnchorAttachStrategy.AttachAsync.
        // We achieve this by reflection: enumerate all v025 types, for each public
        // async method whose return type is Task<AnchorAttachOutcome>, assert the
        // declaring type is AnchorAttachStrategy.

        [Test]
        public void OnlyAnchorAttachStrategyReturnsAttachOutcome()
        {
            var asm = typeof(AnchorAttachStrategy).Assembly;
            var attachReturnMethods = asm.GetTypes()
                .SelectMany(t => t.GetMethods(System.Reflection.BindingFlags.Public |
                                              System.Reflection.BindingFlags.Instance |
                                              System.Reflection.BindingFlags.Static |
                                              System.Reflection.BindingFlags.DeclaredOnly))
                .Where(m =>
                {
                    var rt = m.ReturnType;
                    if (!rt.IsGenericType) return false;
                    if (rt.GetGenericTypeDefinition() != typeof(System.Threading.Tasks.Task<>)) return false;
                    return rt.GetGenericArguments()[0] == typeof(AnchorAttachOutcome);
                })
                .ToArray();

            // Exactly one such method, declared on AnchorAttachStrategy
            Assert.AreEqual(1, attachReturnMethods.Length,
                "Exactly one async method should return Task<AnchorAttachOutcome> across the entire v025 assembly");
            Assert.AreEqual(typeof(AnchorAttachStrategy), attachReturnMethods[0].DeclaringType,
                "AnchorAttachStrategy must be the only producer of AnchorAttachOutcome");
        }

        [Test]
        public void AttachOutcomeKind_DoesNotIncludeNakedGpsXyz()
        {
            // Static enum sanity: ensure no value named *Gps*, *Naked*, *Raw*, *LatLng*
            var names = System.Enum.GetNames(typeof(AttachOutcomeKind));
            foreach (var n in names)
            {
                var lower = n.ToLowerInvariant();
                Assert.IsFalse(lower.Contains("gps"), $"AttachOutcomeKind contains forbidden 'gps' label: {n}");
                Assert.IsFalse(lower.Contains("naked"), $"AttachOutcomeKind contains forbidden 'naked' label: {n}");
                Assert.IsFalse(lower.Contains("raw"), $"AttachOutcomeKind contains forbidden 'raw' label: {n}");
                Assert.IsFalse(lower.Contains("latlng"), $"AttachOutcomeKind contains forbidden 'latlng' label: {n}");
            }
        }
    }
}
