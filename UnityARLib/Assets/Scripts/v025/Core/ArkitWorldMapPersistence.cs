// Phase 1A.3 + Phase 5 §A.1 — ArkitWorldMapPersistence (iOS, Tier-S anchor persistence).
//
// Phase 1A scope: shell only — Editor + Android NotSupported, iOS NoCache/IoError stubs.
// Phase 5 §A.1 scope: real ARKit ARWorldMap implementation gated by HAS_ARKIT_WORLDMAP
//   define + #if UNITY_IOS && !UNITY_EDITOR. Per ADR-014 + ADR-015 §A.1.
//
// API signatures verified against ARKit XR Plugin 6.0.5 PackageCache source:
//   - ARKitSessionSubsystem.GetARWorldMapAsync(Action<ARWorldMapRequestStatus, ARWorldMap>)
//     — callback pattern, NOT Task await
//   - ARWorldMap is struct + IDisposable, must Dispose to avoid native leak
//   - ARWorldMap.Serialize(Allocator) returns NativeArray<byte>; caller owns + must Dispose
//   - ARWorldMap.TryDeserialize(NativeArray<byte>, out ARWorldMap) — does NOT throw on bad bytes
//   - ARKitSessionSubsystem.ApplyWorldMap(ARWorldMap) — NOT SetWorldMap (drift fix per Test A)
//   - ARKitSessionSubsystem.worldMappingStatus — instance property
//   - ARWorldMap.worldMapSupported — static, requires iOS 12+
//
// File persistence: Application.persistentDataPath/v025/worldmaps/{spaceId}.arworldmap
// iCloud backup exclusion via ObjC bridge `Cairn_ExcludeFromBackup` (Plugins/iOS/CairnFileExclude.mm)
//
// 见 ADR-001(Tier-S 失败时 fallback 到 Tier-G GPS 路径)
// 见 ADR-014(Phase 4 deferred to Phase 5)
// 见 ADR-015(Phase 5 entry checklist)

using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;

#if HAS_ARKIT_WORLDMAP && UNITY_IOS && !UNITY_EDITOR
using Unity.Collections;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARKit;
#endif

namespace Cairn.AR.V025.Core
{
    public sealed class ArkitWorldMapPersistence : IAnchorPersistence
    {
#if HAS_ARKIT_WORLDMAP && UNITY_IOS && !UNITY_EDITOR
        // ObjC bridge from UnityARLib/Assets/Plugins/iOS/CairnFileExclude.mm
        // Returns 0 on success; non-zero = NSError code or sentinel (-1/-2/-3).
        [DllImport("__Internal", EntryPoint = "Cairn_ExcludeFromBackup")]
        private static extern int Cairn_ExcludeFromBackup(string path);

        // ARSession reference is needed to access ARKitSessionSubsystem. The composition
        // root (V025Bootstrap.cs) must call SetArSession before any Save/Load.
        private ARSession _arSession;
        public void SetArSession(ARSession session) { _arSession = session; }
#endif

        public bool IsPlatformSupported
        {
            get
            {
#if HAS_ARKIT_WORLDMAP && UNITY_IOS && !UNITY_EDITOR
                return ARWorldMap.worldMapSupported; // iOS 12+
#else
                return false;
#endif
            }
        }

        public static string LocalBlobPath(string spaceId)
        {
            // Application.persistentDataPath on iOS = <App>/Documents/ (per Unity docs;
            // Documents/ persists, not subject to iOS Caches/ eviction). Persistent data is
            // the right choice for ARWorldMap blobs.
            var dir = Path.Combine(Application.persistentDataPath, "v025", "worldmaps");
            return Path.Combine(dir, spaceId + ".arworldmap");
        }

        public Task<PersistenceResult> SaveAsync(string spaceId, CancellationToken cancel)
        {
            if (spaceId == null) throw new ArgumentNullException(nameof(spaceId));
            if (cancel.IsCancellationRequested) return Task.FromResult(PersistenceResult.Cancelled());

#if HAS_ARKIT_WORLDMAP && UNITY_IOS && !UNITY_EDITOR
            return SaveAsyncIOS(spaceId, cancel);
#else
            return Task.FromResult(PersistenceResult.NotSupported(
                "ARKit ARWorldMap requires iOS device build with HAS_ARKIT_WORLDMAP define"));
#endif
        }

        public Task<PersistenceResult> LoadAsync(string spaceId, CancellationToken cancel)
        {
            if (spaceId == null) throw new ArgumentNullException(nameof(spaceId));
            if (cancel.IsCancellationRequested) return Task.FromResult(PersistenceResult.Cancelled());

#if HAS_ARKIT_WORLDMAP && UNITY_IOS && !UNITY_EDITOR
            return LoadAsyncIOS(spaceId, cancel);
#else
            return Task.FromResult(PersistenceResult.NotSupported(
                "ARKit ARWorldMap requires iOS device build with HAS_ARKIT_WORLDMAP define"));
#endif
        }

#if HAS_ARKIT_WORLDMAP && UNITY_IOS && !UNITY_EDITOR
        private async Task<PersistenceResult> SaveAsyncIOS(string spaceId, CancellationToken cancel)
        {
            // Pre-call guards (Test A R3): worldMapSupported + subsystem + tracking + status.
            if (!ARWorldMap.worldMapSupported)
                return PersistenceResult.NotSupported("ARWorldMap requires iOS 12+");
            if (_arSession == null)
                return PersistenceResult.IoError("ARSession not wired (V025Bootstrap.SetArSession not called)");
            var subsystem = _arSession.subsystem as ARKitSessionSubsystem;
            if (subsystem == null)
                return PersistenceResult.NotSupported("ARKitSessionSubsystem unavailable (non-iOS or not loaded)");
            if (!subsystem.running)
                return PersistenceResult.IoError("ARSession subsystem not running");
            // worldMappingStatus must be Mapped or Extending — saving from Limited / NotAvailable
            // produces a useless map.
            var status = subsystem.worldMappingStatus;
            if (status != ARWorldMappingStatus.Mapped && status != ARWorldMappingStatus.Extending)
                return PersistenceResult.IoError($"worldMappingStatus={status} (need Mapped or Extending)");

            // Bridge ARKitSessionSubsystem.GetARWorldMapAsync(callback) to a TaskCompletionSource
            // so we can await it. The callback may fire on the main thread; we don't assume.
            var tcs = new TaskCompletionSource<(ARWorldMapRequestStatus status, ARWorldMap map)>(
                TaskCreationOptions.RunContinuationsAsynchronously);
            subsystem.GetARWorldMapAsync((s, m) => tcs.TrySetResult((s, m)));

            // Honor cancellation while waiting for the callback.
            using (cancel.Register(() => tcs.TrySetCanceled()))
            {
                (ARWorldMapRequestStatus reqStatus, ARWorldMap map) result;
                try
                {
                    result = await tcs.Task.ConfigureAwait(false);
                }
                catch (TaskCanceledException)
                {
                    return PersistenceResult.Cancelled();
                }

                if (result.reqStatus != ARWorldMapRequestStatus.Success)
                {
                    return PersistenceResult.IoError($"GetARWorldMapAsync status={result.reqStatus}");
                }

                using (var map = result.map)
                {
                    if (!map.valid)
                    {
                        return PersistenceResult.IoError("ARWorldMap is not valid");
                    }

                    byte[] managedBytes;
                    try
                    {
                        // Serialize requires Allocator.Temp / Persistent; we copy out then dispose.
                        using (var nativeBytes = map.Serialize(Allocator.Temp))
                        {
                            managedBytes = nativeBytes.ToArray();
                        }
                    }
                    catch (InvalidOperationException ioe)
                    {
                        return PersistenceResult.IoError("Serialize failed: " + ioe.Message);
                    }

                    if (managedBytes == null || managedBytes.Length == 0)
                    {
                        return PersistenceResult.IoError("Serialize produced empty bytes");
                    }

                    var path = LocalBlobPath(spaceId);
                    var dir = Path.GetDirectoryName(path);
                    if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);

                    try
                    {
                        File.WriteAllBytes(path, managedBytes);
                    }
                    catch (UnauthorizedAccessException uae)
                    {
                        return PersistenceResult.IoError("write permission denied: " + uae.Message);
                    }
                    catch (IOException ioex)
                    {
                        return PersistenceResult.IoError("write io: " + ioex.Message);
                    }

                    // Mark file no-iCloud-backup. Non-zero = warning, not fatal — file already written.
                    int rc = Cairn_ExcludeFromBackup(path);
                    if (rc != 0)
                    {
                        Debug.LogWarning($"[v025/Arkit] Cairn_ExcludeFromBackup rc={rc} for {path}");
                    }
                    Debug.Log($"[v025/Arkit] Save OK spaceId={spaceId} bytes={managedBytes.Length}");
                    return PersistenceResult.Success();
                }
            }
        }

        private async Task<PersistenceResult> LoadAsyncIOS(string spaceId, CancellationToken cancel)
        {
            if (_arSession == null)
                return PersistenceResult.IoError("ARSession not wired");
            var subsystem = _arSession.subsystem as ARKitSessionSubsystem;
            if (subsystem == null)
                return PersistenceResult.NotSupported("ARKitSessionSubsystem unavailable");

            var path = LocalBlobPath(spaceId);
            if (!File.Exists(path)) return PersistenceResult.NoCache();

            byte[] managedBytes;
            try
            {
                managedBytes = File.ReadAllBytes(path);
            }
            catch (IOException ioex)
            {
                return PersistenceResult.IoError("load io: " + ioex.Message);
            }

            if (managedBytes.Length == 0)
            {
                return PersistenceResult.MapCorrupt("empty blob");
            }

            // Deserialize: managed bytes → NativeArray<byte> → ARWorldMap.TryDeserialize.
            // Test A: TryDeserialize does NOT throw on bad bytes; returns false.
            ARWorldMap map;
            using (var nativeBytes = new NativeArray<byte>(managedBytes, Allocator.Temp))
            {
                if (!ARWorldMap.TryDeserialize(nativeBytes, out map))
                {
                    // The most common cause of TryDeserialize=false is iOS version drift
                    // (saved on iOS 17 vs loaded on iOS 18). Surface as MapVersionMismatch
                    // so caller can choose to delete + re-save.
                    return PersistenceResult.MapVersionMismatch(
                        "ARWorldMap.TryDeserialize=false (likely version drift or corrupt blob)");
                }
            }

            using (map)
            {
                if (!map.valid)
                {
                    return PersistenceResult.MapCorrupt("deserialized but ARWorldMap.valid=false");
                }

                // Apply triggers ARKit relocalization. Returns immediately; relocalization
                // happens asynchronously and is observed via worldMappingStatus → Mapped.
                subsystem.ApplyWorldMap(map);
            }

            // Wait for relocalize via load gate.
            var gate = new Cairn.AR.V025.Anchor.WorldMapLoadGateV2(timeoutMs: 6000);
            while (!cancel.IsCancellationRequested)
            {
                var status = subsystem.worldMappingStatus;
                Cairn.AR.V025.Anchor.WorldMappingStatus mapped;
                switch (status)
                {
                    case ARWorldMappingStatus.Mapped:
                        mapped = Cairn.AR.V025.Anchor.WorldMappingStatus.Mapped;
                        break;
                    case ARWorldMappingStatus.Extending:
                        mapped = Cairn.AR.V025.Anchor.WorldMappingStatus.Extending;
                        break;
                    case ARWorldMappingStatus.Limited:
                        mapped = Cairn.AR.V025.Anchor.WorldMappingStatus.Limited;
                        break;
                    default:
                        mapped = Cairn.AR.V025.Anchor.WorldMappingStatus.NotAvailable;
                        break;
                }

                var outcome = gate.OnStatusUpdate(mapped);
                if (outcome == Cairn.AR.V025.Anchor.LoadGateOutcome.Ready) return PersistenceResult.Success();
                if (outcome == Cairn.AR.V025.Anchor.LoadGateOutcome.Timeout)
                    return PersistenceResult.RelocalizeTimeout("worldMappingStatus did not reach Mapped within timeout");

                try
                {
                    await Task.Delay(100, cancel).ConfigureAwait(false);
                }
                catch (TaskCanceledException)
                {
                    return PersistenceResult.Cancelled();
                }
            }
            return PersistenceResult.Cancelled();
        }
#endif
    }
}
