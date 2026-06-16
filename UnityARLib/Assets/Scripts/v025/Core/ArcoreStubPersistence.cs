// Phase 1A.4 — ArcoreStubPersistence (Android, NotSupported until v0.2.6).
//
// 见 ADR-002(Android 不 build, 留代码位置)
// 见 ADR-003(Android stub 测试范围)
//
// All methods return NotSupported. Anti-pattern test
// Spawn_AntiPattern_C_NoTierAArkitXyzInArcore validates that no path returns
// Success here.

using System;
using System.Threading;
using System.Threading.Tasks;

namespace Cairn.AR.V025.Core
{
    public sealed class ArcoreStubPersistence : IAnchorPersistence
    {
        public bool IsPlatformSupported => false;

        public Task<PersistenceResult> SaveAsync(string spaceId, CancellationToken cancel)
        {
            if (spaceId == null) throw new ArgumentNullException(nameof(spaceId));
            if (cancel.IsCancellationRequested) return Task.FromResult(PersistenceResult.Cancelled());
            return Task.FromResult(PersistenceResult.NotSupported(
                "Android ARCore persistence not implemented in v0.2.5; deferred to v0.2.6 见 ADR-002(Android 不 build)"));
        }

        public Task<PersistenceResult> LoadAsync(string spaceId, CancellationToken cancel)
        {
            if (spaceId == null) throw new ArgumentNullException(nameof(spaceId));
            if (cancel.IsCancellationRequested) return Task.FromResult(PersistenceResult.Cancelled());
            return Task.FromResult(PersistenceResult.NotSupported(
                "Android ARCore persistence not implemented in v0.2.5; deferred to v0.2.6 见 ADR-002(Android 不 build)"));
        }
    }
}
