// Phase 2A.8 — CairnBridgeV2 Unity-side unit tests.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using Unity.Mathematics;
using UnityEngine;
using Cairn.AR.V025.Bridge;
using Cairn.AR.V025.Core;
using Cairn.AR.V025.Session;
using Cairn.AR.V025.Spawn;
using Cairn.AR.V025.Visual;

namespace Cairn.AR.V025.Tests.Unit
{
    public class CairnBridgeV2Tests
    {
        private sealed class FakeTransport : IBridgeTransport
        {
            public List<string> Sent { get; } = new List<string>();
            private Action<string> _handler;
            public void Send(string p) => Sent.Add(p);
            public IDisposable Subscribe(Action<string> onMessage)
            {
                _handler = onMessage;
                return new Sub(() => _handler = null);
            }
            public void Emit(string raw) => _handler?.Invoke(raw);
            private sealed class Sub : IDisposable
            {
                private readonly Action _onDispose;
                public Sub(Action a) { _onDispose = a; }
                public void Dispose() => _onDispose?.Invoke();
            }
        }

        private sealed class StaticPlanes : IPlaneCandidateSource
        {
            private readonly PlaneCandidate[] _planes;
            public StaticPlanes(params PlaneCandidate[] planes) { _planes = planes ?? Array.Empty<PlaneCandidate>(); }
            public PlaneCandidate[] CurrentCandidates() => _planes;
        }

        private sealed class SuccessPersistence : IAnchorPersistence
        {
            public bool IsPlatformSupported => true;
            public Task<PersistenceResult> SaveAsync(string s, CancellationToken c) => Task.FromResult(PersistenceResult.Success());
            public Task<PersistenceResult> LoadAsync(string s, CancellationToken c) => Task.FromResult(PersistenceResult.Success());
        }

        private sealed class NoCachePersistence : IAnchorPersistence
        {
            public bool IsPlatformSupported => true;
            public Task<PersistenceResult> SaveAsync(string s, CancellationToken c) => Task.FromResult(PersistenceResult.IoError("t"));
            public Task<PersistenceResult> LoadAsync(string s, CancellationToken c) => Task.FromResult(PersistenceResult.NoCache());
        }

        private static (CairnBridgeV2 bridge, FakeTransport transport, ArSessionLifecycleV2 lifecycle, List<V025Event> emitted)
            MakeBridge(IAnchorPersistence persistence, PlaneCandidate[] planes)
        {
            var lifecycle = new ArSessionLifecycleV2(() => "test-session");
            lifecycle.BringUp();
            lifecycle.Activate();
            var validator = new FloorPlaneValidatorV2();
            var ground = new GroundResolverV2(uv => GroundResolverV2.RaycastResult.Miss);
            var strategy = new AnchorAttachStrategy(persistence, validator, ground);
            var emitted = new List<V025Event>();
            var spawner = new CairnSpawnerV2(strategy, lifecycle.Tracker, ev => emitted.Add(ev));
            var transport = new FakeTransport();
            var assemblyGo = new GameObject("TestAssembly");
            var assembly = assemblyGo.AddComponent<CairnAssemblyV2>();
            var bridge = new CairnBridgeV2(transport, spawner, assembly, new StaticPlanes(planes), lifecycle, ev => emitted.Add(ev));
            bridge.Start();
            return (bridge, transport, lifecycle, emitted);
        }

        [Test]
        public void SpawnRequest_TierSSuccess_EmitsSpawnOk()
        {
            var (bridge, transport, _, _) = MakeBridge(new SuccessPersistence(), Array.Empty<PlaneCandidate>());
            transport.Emit("{\"type\":\"v025/spawn\",\"spaceId\":\"s1\",\"cairnId\":\"c1\",\"targetXyz\":{\"x\":5,\"y\":0,\"z\":7}}");

            // Wait briefly for the async OnSpawnAsync to complete.
            var deadline = DateTime.UtcNow.AddMilliseconds(500);
            while (transport.Sent.Count == 0 && DateTime.UtcNow < deadline)
                Thread.Sleep(10);

            Assert.IsTrue(transport.Sent.Count >= 1, "expected at least one outbound message");
            var sent = transport.Sent[0];
            StringAssert.Contains("v025/spawn-ok", sent);
            StringAssert.Contains("\"cairnId\":\"c1\"", sent);
            StringAssert.Contains("\"outcomeKind\":\"AttachedTierS\"", sent);
            StringAssert.Contains("\"finalXyz\":{\"x\":5", sent);
            bridge.Dispose();
        }

        [Test]
        public void SpawnRequest_AllTiersFail_EmitsSpawnRefused()
        {
            var (bridge, transport, _, _) = MakeBridge(new NoCachePersistence(), Array.Empty<PlaneCandidate>());
            transport.Emit("{\"type\":\"v025/spawn\",\"spaceId\":\"s1\",\"cairnId\":\"c1\",\"targetXyz\":{\"x\":0,\"y\":0,\"z\":0}}");

            var deadline = DateTime.UtcNow.AddMilliseconds(500);
            while (transport.Sent.Count == 0 && DateTime.UtcNow < deadline)
                Thread.Sleep(10);

            Assert.IsTrue(transport.Sent.Count >= 1);
            StringAssert.Contains("v025/spawn-refused", transport.Sent[0]);
            StringAssert.Contains("\"cairnId\":\"c1\"", transport.Sent[0]);
            StringAssert.Contains("all tiers failed", transport.Sent[0]);
            bridge.Dispose();
        }

        [Test]
        public void NonV025Message_Ignored()
        {
            var (bridge, transport, _, _) = MakeBridge(new SuccessPersistence(), Array.Empty<PlaneCandidate>());
            transport.Emit("{\"type\":\"legacy/event\",\"foo\":\"bar\"}");
            transport.Emit("not-json");
            transport.Emit("{\"noTypeField\":true}");
            // No outbound messages expected
            Thread.Sleep(50);
            Assert.AreEqual(0, transport.Sent.Count);
            bridge.Dispose();
        }

        [Test]
        public void BeginSession_EmitsSessionReady()
        {
            // Set up bridge with idle lifecycle (manual control)
            var lifecycle = new ArSessionLifecycleV2(() => "fresh-session");
            var validator = new FloorPlaneValidatorV2();
            var ground = new GroundResolverV2(uv => GroundResolverV2.RaycastResult.Miss);
            var strategy = new AnchorAttachStrategy(new NoCachePersistence(), validator, ground);
            var transport = new FakeTransport();
            // Build a tracker placeholder; CairnSpawnerV2 needs a tracker but for this test it isn't invoked.
            var placeholderTracker = new PhaseStepTracker("placeholder");
            var spawner = new CairnSpawnerV2(strategy, placeholderTracker, _ => { });
            var assemblyGo = new GameObject("TestAssembly2");
            var assembly = assemblyGo.AddComponent<CairnAssemblyV2>();
            var bridge = new CairnBridgeV2(transport, spawner, assembly, new StaticPlanes(), lifecycle, _ => { });
            bridge.Start();

            transport.Emit("{\"type\":\"v025/begin-session\"}");

            Assert.AreEqual(1, transport.Sent.Count);
            StringAssert.Contains("v025/session-ready", transport.Sent[0]);
            StringAssert.Contains("\"sessionInstanceId\":\"fresh-session\"", transport.Sent[0]);
            Assert.AreEqual("fresh-session", lifecycle.SessionInstanceId);
            Assert.AreEqual(ArSessionStateV2.Active, lifecycle.State);
            bridge.Dispose();
        }
    }
}
