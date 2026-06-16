// Phase 1A.3 — ArkitWorldMapPersistence (iOS, Tier-S anchor persistence).
//
// PHASE 1A SCOPE: SHELL ONLY.
//   - Methods exist, signatures correct.
//   - Methods return NotSupported on Editor + Android.
//   - On iOS Phase 1A: returns NoCache (no map saved yet) for Load, IoError stub for Save.
//   - Phase 4.2 fills the real GetARWorldMapAsync wrapper / Serialize / TryDeserialize.
//
// Contract MUST hold even in stub form:
//   - Never throws on expected paths (only on null arg).
//   - Always emits telemetry envelope (Phase 3 wiring pending; Phase 1A logs to
//     UnityEngine.Debug so unit tests can observe).
//
// Anti-pattern guard: this class is NOT a Monitor/Validator/Observer (Rule P
// does not apply); it is a Persistence backend.

using System;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;

namespace Cairn.AR.V025.Core
{
    public sealed class ArkitWorldMapPersistence : IAnchorPersistence
    {
        public bool IsPlatformSupported
        {
            get
            {
#if UNITY_IOS && !UNITY_EDITOR
                return true;
#else
                return false;
#endif
            }
        }

        public Task<PersistenceResult> SaveAsync(string spaceId, CancellationToken cancel)
        {
            if (spaceId == null) throw new ArgumentNullException(nameof(spaceId));
            if (cancel.IsCancellationRequested) return Task.FromResult(PersistenceResult.Cancelled());

#if UNITY_IOS && !UNITY_EDITOR
            // Phase 4.2 will fill in:
            //   1. ARSession.GetARWorldMapAsync
            //   2. NSData -> base64 serialize
            //   3. write to FileSystem.documentDirectory + Cairn_ExcludeFromBackup
            //   4. emit v22-PERSIST/save/success
            // 见 ADR-001(Tier-S 失败时 fallback 到 Tier-G GPS 路径)
            Debug.Log($"[v025/Arkit] SaveAsync stub spaceId={spaceId} — Phase 4 will implement");
            return Task.FromResult(PersistenceResult.IoError("ArkitWorldMap save not yet implemented (Phase 4.2)"));
#else
            return Task.FromResult(PersistenceResult.NotSupported("ARKit only available on iOS device build"));
#endif
        }

        public Task<PersistenceResult> LoadAsync(string spaceId, CancellationToken cancel)
        {
            if (spaceId == null) throw new ArgumentNullException(nameof(spaceId));
            if (cancel.IsCancellationRequested) return Task.FromResult(PersistenceResult.Cancelled());

#if UNITY_IOS && !UNITY_EDITOR
            // Phase 4.2/4.3 will fill in:
            //   1. read base64 blob from disk
            //   2. ARWorldMap.SerializationFromBase64
            //   3. ARSession.SetWorldMap + WorldMapLoadGateV2 wait worldMappingStatus=Mapped
            //   4. emit v22-PERSIST/load/(success|timeout)
            // 见 ADR-001(Tier-S 失败时 fallback 到 Tier-G GPS 路径)
            Debug.Log($"[v025/Arkit] LoadAsync stub spaceId={spaceId} — Phase 4 will implement");
            return Task.FromResult(PersistenceResult.NoCache());
#else
            return Task.FromResult(PersistenceResult.NotSupported("ARKit only available on iOS device build"));
#endif
        }
    }
}
