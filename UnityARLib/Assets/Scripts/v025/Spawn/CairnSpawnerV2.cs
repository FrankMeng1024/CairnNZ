// Phase 2A.3 — CairnSpawnerV2.
//
// Bridges incoming v025/spawn requests (from CairnBridgeV2) to AnchorAttachStrategy
// and emits SpawnResponse. CairnSpawnerV2 does NOT instantiate the cairn prefab —
// CairnBridgeV2 (Phase 2A.8) sends v025/spawn-ok/refused over the wire and Phase
// 2B's CairnAssemblyV2 will subscribe to those wire messages to perform the
// actual GameObject.Instantiate at outcome.Position.
//
// Composition root (Phase 3 will formalize):
//   ArSessionLifecycleV2 owns the PhaseStepTracker (per-session sessionInstanceId).
//   TelemetryBatcherV2 (Phase 3.3) owns the Action<V025Event> emit delegate.
//   The composition wires them: new CairnSpawnerV2(strategy, lifecycle.Tracker, batcher.AddEvent).
//
// Phase 1A 4-eye concerns_for_phase_2A:
//   - PendingAnchorRetryV2 calls BlockerSentinel.RaiseRefuseSpawn → catch
//     BlockerSentinelException specifically (NOT catch (Exception) per Rule C.2)
//   - sessionInstanceId comes from PhaseStepTracker passed in via DI (no static)

using System;
using System.Threading;
using System.Threading.Tasks;
using Unity.Mathematics;

namespace Cairn.AR.V025.Spawn
{
    using Cairn.AR.V025.Core;

    public sealed class CairnSpawnerV2
    {
        private readonly AnchorAttachStrategy _strategy;
        private readonly PhaseStepTracker _tracker;
        private readonly Action<V025Event> _emitTelemetry;

        public CairnSpawnerV2(
            AnchorAttachStrategy strategy,
            PhaseStepTracker tracker,
            Action<V025Event> emitTelemetry)
        {
            _strategy = strategy ?? throw new ArgumentNullException(nameof(strategy));
            _tracker = tracker ?? throw new ArgumentNullException(nameof(tracker));
            _emitTelemetry = emitTelemetry ?? throw new ArgumentNullException(nameof(emitTelemetry));
        }

        public readonly struct SpawnRequest
        {
            public string SpaceId { get; }
            public string CairnId { get; }
            public float3 TargetXyz { get; }
            public PlaneCandidate[] CandidatePlanes { get; }

            public SpawnRequest(string spaceId, string cairnId, float3 targetXyz, PlaneCandidate[] candidatePlanes)
            {
                SpaceId = spaceId;
                CairnId = cairnId;
                TargetXyz = targetXyz;
                CandidatePlanes = candidatePlanes ?? Array.Empty<PlaneCandidate>();
            }
        }

        public readonly struct SpawnResponse
        {
            public bool Ok { get; }
            public string CairnId { get; }
            public AttachOutcomeKind Kind { get; }
            public float3 FinalXyz { get; }
            public string Diagnostic { get; }

            private SpawnResponse(bool ok, string cairnId, AttachOutcomeKind kind, float3 xyz, string diag)
            {
                Ok = ok;
                CairnId = cairnId;
                Kind = kind;
                FinalXyz = xyz;
                Diagnostic = diag ?? string.Empty;
            }

            public static SpawnResponse OkResp(string cairnId, AttachOutcomeKind kind, float3 xyz, string diag)
                => new SpawnResponse(true, cairnId, kind, xyz, diag);
            public static SpawnResponse Refused(string cairnId, string diag)
                => new SpawnResponse(false, cairnId, AttachOutcomeKind.Refused, float3.zero, diag);
        }

        public async Task<SpawnResponse> HandleAsync(SpawnRequest req, CancellationToken cancel)
        {
            if (req.SpaceId == null) throw new ArgumentNullException(nameof(req.SpaceId));
            if (req.CairnId == null) throw new ArgumentNullException(nameof(req.CairnId));

            _tracker.EnterPhase(V025Phases.Spawn, "request");
            _emitTelemetry(_tracker.NextEvent(V025Outcomes.Success, $"cairnId={req.CairnId}"));

            var outcome = await _strategy.AttachAsync(
                req.SpaceId,
                req.TargetXyz,
                req.CandidatePlanes,
                cancel).ConfigureAwait(false);

            _tracker.EnterPhase(V025Phases.Spawn, "outcome");
            if (outcome.Kind == AttachOutcomeKind.Refused)
            {
                _emitTelemetry(_tracker.NextEvent(V025Outcomes.Failure, outcome.Diagnostic));
                return SpawnResponse.Refused(req.CairnId, outcome.Diagnostic);
            }

            _emitTelemetry(_tracker.NextEvent(V025Outcomes.Success,
                $"kind={outcome.Kind} xyz=({outcome.Position.x:F2},{outcome.Position.y:F2},{outcome.Position.z:F2})"));
            return SpawnResponse.OkResp(req.CairnId, outcome.Kind, outcome.Position, outcome.Diagnostic);
        }
    }
}
